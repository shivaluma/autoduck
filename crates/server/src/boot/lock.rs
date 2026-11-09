//! Single-instance lock (D21): an exclusive advisory lock on `/app/data/autoduck.lock`, taken
//! before any DB guard runs and held for the life of the process.
//!
//! While holding the lock, the owner writes `pid=… host=… since=…` into the file, so a second
//! instance can log who holds it while it retries.

use std::fs::{File, OpenOptions, TryLockError};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use crate::db::DbTime;

#[derive(Debug, thiserror::Error)]
pub enum LockError {
    #[error("cannot open lock file {path}: {source}")]
    Open {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("cannot lock {path}: {source}")]
    Lock {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error(
        "{path} is still held by another instance ({holder}) after {waited:?}; refusing to start"
    )]
    Held {
        path: PathBuf,
        holder: String,
        waited: Duration,
    },
}

/// Held for the life of the process; dropping it (or exiting) releases the lock.
#[derive(Debug)]
pub struct InstanceLock {
    _file: File,
    pub path: PathBuf,
}

/// Tries once. `Ok(None)` means another process (or another open file description) holds it.
pub fn try_acquire(path: &Path) -> Result<Option<InstanceLock>, LockError> {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let mut file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)
        .map_err(|source| LockError::Open {
            path: path.to_path_buf(),
            source,
        })?;
    match file.try_lock() {
        Ok(()) => {
            let note = format!(
                "pid={} host={} since={}\n",
                std::process::id(),
                hostname(),
                DbTime::now()
            );
            // Best effort: the lock itself is what matters.
            let _ = file
                .set_len(0)
                .and_then(|()| file.seek(SeekFrom::Start(0)).map(drop))
                .and_then(|()| file.write_all(note.as_bytes()))
                .and_then(|()| file.flush());
            Ok(Some(InstanceLock {
                _file: file,
                path: path.to_path_buf(),
            }))
        }
        Err(TryLockError::WouldBlock) => Ok(None),
        Err(TryLockError::Error(source)) => Err(LockError::Lock {
            path: path.to_path_buf(),
            source,
        }),
    }
}

/// Who holds the lock, from the note the holder wrote.
pub fn holder(path: &Path) -> String {
    let mut text = String::new();
    match File::open(path).and_then(|mut file| file.read_to_string(&mut text)) {
        Ok(_) if !text.trim().is_empty() => text.trim().to_owned(),
        _ => "unknown holder".to_owned(),
    }
}

/// Retries every second for up to `wait` (D21: 150 s), logging the holder.
pub async fn acquire(path: &Path, wait: Duration) -> Result<InstanceLock, LockError> {
    let started = Instant::now();
    let mut logged = false;
    loop {
        if let Some(lock) = try_acquire(path)? {
            tracing::info!(path = %path.display(), "instance lock acquired");
            return Ok(lock);
        }
        let held_by = holder(path);
        let waited = started.elapsed();
        if waited >= wait {
            return Err(LockError::Held {
                path: path.to_path_buf(),
                holder: held_by,
                waited,
            });
        }
        if !logged || waited.as_secs().is_multiple_of(15) {
            tracing::warn!(
                path = %path.display(),
                holder = %held_by,
                waited_secs = waited.as_secs(),
                limit_secs = wait.as_secs(),
                "instance lock is held by another instance; retrying"
            );
            logged = true;
        }
        tokio::time::sleep(Duration::from_secs(1).min(wait.saturating_sub(waited))).await;
    }
}

fn hostname() -> String {
    let mut buf = [0u8; 256];
    // SAFETY: the buffer is valid for `buf.len()` bytes; gethostname NUL-terminates on success
    // (and we cap at the first NUL or the buffer end either way).
    let rc = unsafe { libc::gethostname(buf.as_mut_ptr().cast(), buf.len()) };
    if rc != 0 {
        return "unknown-host".to_owned();
    }
    let end = buf.iter().position(|b| *b == 0).unwrap_or(buf.len());
    String::from_utf8_lossy(&buf[..end]).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn second_open_file_description_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("autoduck.lock");
        let first = try_acquire(&path).unwrap().expect("first lock");
        assert!(try_acquire(&path).unwrap().is_none());
        assert!(holder(&path).contains(&format!("pid={}", std::process::id())));
        drop(first);
        assert!(try_acquire(&path).unwrap().is_some());
    }

    #[tokio::test]
    async fn gives_up_after_wait() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("autoduck.lock");
        let _held = try_acquire(&path).unwrap().unwrap();
        let err = acquire(&path, Duration::from_millis(1200))
            .await
            .unwrap_err();
        assert!(matches!(err, LockError::Held { .. }), "{err}");
    }
}
