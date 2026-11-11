//! Boot backup (D29): `VACUUM INTO <backup dir>/boot-<UTC ts>.db`, best effort.
//!
//! Same rules as the retired TS `scripts/ops/backup.mjs` (tag `ts-engine-final`):
//! - skip when any backup (`boot-*` or the TS `pre-migrate-*`) is younger than 6 h, so a crash
//!   loop can't fill the disk;
//! - skip, loudly, when free space is under 3× the DB size;
//! - keep the newest 10 `boot-*` backups (the TS script prunes its own prefix), but prune
//!   only once `integrity_check` has passed ([`prune_old`], called by the boot after step 7):
//!   a crash loop on a corrupt DB must not rotate the good backups out (review 1, finding 4);
//! - write to `<name>.partial`, fsync it, rename, fsync the directory (`VACUUM INTO` itself
//!   doesn't sync; review 1, finding 3), removing leftover partials first;
//! - the directory is 0700 and backups 0600: they hold every access token (review 2, finding 6);
//! - never fail the boot.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use sqlx::SqliteConnection;

use crate::db::DbTime;

pub const BOOT_PREFIX: &str = "boot-";
pub const TS_PREFIX: &str = "pre-migrate-";
pub const SUFFIX: &str = ".db";

#[derive(Clone, Debug)]
pub struct BackupPolicy {
    pub min_age: Duration,
    pub free_space_factor: u64,
    pub keep: usize,
    /// Tests override the measured free space.
    pub free_space_override: Option<u64>,
}

impl Default for BackupPolicy {
    fn default() -> Self {
        BackupPolicy {
            min_age: Duration::from_secs(6 * 60 * 60),
            free_space_factor: 3,
            keep: 10,
            free_space_override: None,
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum BackupOutcome {
    Written { path: PathBuf },
    SkippedRecent { newest: PathBuf, age: Duration },
    SkippedLowSpace { free: u64, needed: u64 },
    Disabled,
    Failed(String),
}

struct Entry {
    path: PathBuf,
    name: String,
    modified: SystemTime,
}

fn list(dir: &Path, prefixes: &[&str]) -> Vec<Entry> {
    let Ok(read) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut entries: Vec<Entry> = read
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let matches =
                name.ends_with(SUFFIX) && prefixes.iter().any(|prefix| name.starts_with(prefix));
            if !matches {
                return None;
            }
            let modified = entry.metadata().ok()?.modified().ok()?;
            Some(Entry {
                path: entry.path(),
                name,
                modified,
            })
        })
        .collect();
    // Newest first; ties broken by name, descending (matches backup.mjs).
    entries.sort_by(|a, b| {
        b.modified
            .cmp(&a.modified)
            .then_with(|| b.name.cmp(&a.name))
    });
    entries
}

/// Free bytes available to an unprivileged writer in `dir`.
pub fn free_space(dir: &Path) -> std::io::Result<u64> {
    use std::os::unix::ffi::OsStrExt;
    let c_path = std::ffi::CString::new(dir.as_os_str().as_bytes())
        .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidInput, "path contains NUL"))?;
    // SAFETY: `c_path` is a valid NUL-terminated string and `stat` is a valid out pointer.
    let mut stat: libc::statvfs = unsafe { std::mem::zeroed() };
    let rc = unsafe { libc::statvfs(c_path.as_ptr(), &mut stat) };
    if rc != 0 {
        return Err(std::io::Error::last_os_error());
    }
    #[allow(clippy::unnecessary_cast)] // the field widths differ between Linux and macOS
    Ok((stat.f_bavail as u64).saturating_mul(stat.f_frsize as u64))
}

/// `boot-20261109T080102Z.db`
pub fn backup_name(now: DbTime) -> String {
    let iso = now.to_iso_string(); // 2026-11-09T08:01:02.345Z
    let compact: String = iso[..19]
        .chars()
        .filter(|c| *c != '-' && *c != ':')
        .collect();
    format!("{BOOT_PREFIX}{compact}Z{SUFFIX}")
}

fn remove_partials(dir: &Path) {
    let Ok(read) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in read.filter_map(Result::ok) {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with(BOOT_PREFIX) && name.ends_with(".db.partial") {
            match std::fs::remove_file(entry.path()) {
                Ok(()) => tracing::info!(file = %name, "removed leftover partial backup"),
                Err(error) => {
                    tracing::warn!(file = %name, %error, "could not remove leftover partial backup")
                }
            }
        }
    }
}

/// Keeps the newest `keep` `boot-*` backups. Call only after `integrity_check` passed.
pub fn prune_old(dir: &Path, keep: usize) -> Vec<PathBuf> {
    let mut pruned = Vec::new();
    for stale in list(dir, &[BOOT_PREFIX]).into_iter().skip(keep) {
        match std::fs::remove_file(&stale.path) {
            Ok(()) => {
                tracing::info!(file = %stale.name, "pruned old boot backup");
                pruned.push(stale.path);
            }
            Err(error) => tracing::warn!(file = %stale.name, %error, "could not prune old backup"),
        }
    }
    pruned
}

/// Runs the backup on `conn` (the writer connection, idle during boot). Never returns an error:
/// every failure becomes [`BackupOutcome::Failed`] and a log line.
pub async fn run(
    conn: &mut SqliteConnection,
    db_path: &Path,
    dir: &Path,
    policy: &BackupPolicy,
) -> BackupOutcome {
    let outcome = attempt(conn, db_path, dir, policy).await;
    match &outcome {
        BackupOutcome::Written { path } => {
            tracing::info!(file = %path.display(), "boot backup written")
        }
        BackupOutcome::SkippedRecent { newest, age } => tracing::info!(
            newest = %newest.display(),
            age_min = age.as_secs() / 60,
            "boot backup skipped: a backup younger than 6 h exists"
        ),
        BackupOutcome::SkippedLowSpace { free, needed } => tracing::error!(
            free,
            needed,
            dir = %dir.display(),
            "SKIPPING BOOT BACKUP: free space is under 3x the database size; booting WITHOUT a fresh backup"
        ),
        BackupOutcome::Disabled => tracing::warn!("boot backup disabled (AUTODUCK_BACKUP=0)"),
        BackupOutcome::Failed(error) => {
            tracing::error!(%error, "boot backup failed; continuing boot without a fresh backup")
        }
    }
    outcome
}

async fn attempt(
    conn: &mut SqliteConnection,
    db_path: &Path,
    dir: &Path,
    policy: &BackupPolicy,
) -> BackupOutcome {
    if let Err(error) = std::fs::create_dir_all(dir) {
        return BackupOutcome::Failed(format!("cannot create {}: {error}", dir.display()));
    }
    restrict(dir, 0o700);
    remove_partials(dir);

    if let Some(newest) = list(dir, &[BOOT_PREFIX, TS_PREFIX]).into_iter().next() {
        let age = SystemTime::now()
            .duration_since(newest.modified)
            .unwrap_or_default();
        if age < policy.min_age {
            return BackupOutcome::SkippedRecent {
                newest: newest.path,
                age,
            };
        }
    }

    let db_size = match std::fs::metadata(db_path) {
        Ok(meta) => meta.len(),
        Err(error) => {
            return BackupOutcome::Failed(format!("cannot stat {}: {error}", db_path.display()));
        }
    };
    let free = match policy.free_space_override {
        Some(free) => free,
        None => match free_space(dir) {
            Ok(free) => free,
            Err(error) => {
                return BackupOutcome::Failed(format!("cannot measure free space: {error}"));
            }
        },
    };
    let needed = db_size.saturating_mul(policy.free_space_factor);
    if free < needed {
        return BackupOutcome::SkippedLowSpace { free, needed };
    }

    let target = dir.join(backup_name(DbTime::now()));
    match vacuum_into_durable(conn, &target).await {
        Ok(()) => BackupOutcome::Written { path: target },
        Err(error) => BackupOutcome::Failed(error),
    }
}

/// `VACUUM INTO <target>.partial`, `chmod 0600`, fsync, rename to `target`, fsync the directory.
/// A consistent snapshot in `DELETE` and `WAL` mode alike (never a file copy). On failure the
/// partial file is removed and `target` doesn't exist.
pub async fn vacuum_into_durable(conn: &mut SqliteConnection, target: &Path) -> Result<(), String> {
    let partial = PathBuf::from(format!("{}.partial", target.display()));
    let Some(partial_str) = partial.to_str() else {
        return Err("backup path is not UTF-8".to_owned());
    };
    if let Err(error) = sqlx::query("VACUUM INTO ?")
        .bind(partial_str)
        .execute(&mut *conn)
        .await
    {
        let _ = std::fs::remove_file(&partial);
        return Err(format!("VACUUM INTO failed: {error}"));
    }
    restrict(&partial, 0o600);
    if let Err(error) = std::fs::File::open(&partial).and_then(|file| file.sync_all()) {
        let _ = std::fs::remove_file(&partial);
        return Err(format!("cannot fsync the partial backup: {error}"));
    }
    if let Err(error) = std::fs::rename(&partial, target) {
        let _ = std::fs::remove_file(&partial);
        return Err(format!("cannot rename the partial backup: {error}"));
    }
    // Make the rename itself durable. A failure here leaves a complete, synced file.
    if let Some(dir) = target.parent()
        && let Err(error) = std::fs::File::open(dir).and_then(|dir| dir.sync_all())
    {
        tracing::warn!(%error, dir = %dir.display(), "could not fsync the backup directory");
    }
    Ok(())
}

/// Best-effort `chmod`; a failure (foreign owner, odd filesystem) is logged, not fatal.
pub(crate) fn restrict(path: &Path, mode: u32) {
    use std::os::unix::fs::PermissionsExt;
    if let Err(error) = std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode)) {
        tracing::warn!(%error, path = %path.display(), "could not restrict permissions");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::Connection;
    use sqlx::sqlite::SqliteConnectOptions;
    use std::fs::File;

    async fn source_db(dir: &Path) -> (PathBuf, SqliteConnection) {
        let path = dir.join("autoduck.db");
        let mut conn = SqliteConnection::connect_with(
            &SqliteConnectOptions::new()
                .filename(&path)
                .create_if_missing(true),
        )
        .await
        .unwrap();
        sqlx::raw_sql(r#"CREATE TABLE "T" ("v" TEXT); INSERT INTO "T" VALUES ('backed up');"#)
            .execute(&mut conn)
            .await
            .unwrap();
        (path, conn)
    }

    fn fake_backup(dir: &Path, name: &str, age: Duration) -> PathBuf {
        let path = dir.join(name);
        let file = File::create(&path).unwrap();
        file.set_modified(SystemTime::now() - age).unwrap();
        path
    }

    #[test]
    fn name_format() {
        let t = DbTime::parse("2026-11-09T08:01:02.345Z").unwrap();
        assert_eq!(backup_name(t), "boot-20261109T080102Z.db");
    }

    #[tokio::test]
    async fn writes_a_consistent_copy() {
        let tmp = tempfile::tempdir().unwrap();
        let (db, mut conn) = source_db(tmp.path()).await;
        let dir = tmp.path().join("backups");
        std::fs::create_dir_all(&dir).unwrap();
        let partial = dir.join("boot-20200101T000000Z.db.partial");
        File::create(&partial).unwrap();

        let outcome = run(&mut conn, &db, &dir, &BackupPolicy::default()).await;
        let BackupOutcome::Written { path } = outcome else {
            panic!("{outcome:?}")
        };
        assert!(prune_old(&dir, BackupPolicy::default().keep).is_empty());
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = |p: &Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode(&path), 0o600);
            assert_eq!(mode(&dir), 0o700);
        }
        assert!(!partial.exists(), "leftover partial was not removed");
        let mut copy = SqliteConnection::connect_with(
            &SqliteConnectOptions::new().filename(&path).read_only(true),
        )
        .await
        .unwrap();
        let value: String = sqlx::query_scalar(r#"SELECT "v" FROM "T""#)
            .fetch_one(&mut copy)
            .await
            .unwrap();
        assert_eq!(value, "backed up");
    }

    #[tokio::test]
    async fn skips_within_six_hours_of_any_backup() {
        let tmp = tempfile::tempdir().unwrap();
        let (db, mut conn) = source_db(tmp.path()).await;
        let dir = tmp.path().join("backups");
        std::fs::create_dir_all(&dir).unwrap();
        // A TS pre-migrate backup from an hour ago counts too.
        let recent = fake_backup(
            &dir,
            "pre-migrate-20261109T070000Z.db",
            Duration::from_secs(3600),
        );
        let outcome = run(&mut conn, &db, &dir, &BackupPolicy::default()).await;
        assert!(
            matches!(outcome, BackupOutcome::SkippedRecent { ref newest, .. } if *newest == recent),
            "{outcome:?}"
        );
    }

    #[tokio::test]
    async fn skips_when_free_space_is_low() {
        let tmp = tempfile::tempdir().unwrap();
        let (db, mut conn) = source_db(tmp.path()).await;
        let dir = tmp.path().join("backups");
        let size = std::fs::metadata(&db).unwrap().len();
        let policy = BackupPolicy {
            free_space_override: Some(size * 3 - 1),
            ..BackupPolicy::default()
        };
        let outcome = run(&mut conn, &db, &dir, &policy).await;
        assert_eq!(
            outcome,
            BackupOutcome::SkippedLowSpace {
                free: size * 3 - 1,
                needed: size * 3
            }
        );
        assert_eq!(list(&dir, &[BOOT_PREFIX]).len(), 0);
    }

    #[tokio::test]
    async fn keeps_the_newest_ten_boot_backups() {
        let tmp = tempfile::tempdir().unwrap();
        let (db, mut conn) = source_db(tmp.path()).await;
        let dir = tmp.path().join("backups");
        std::fs::create_dir_all(&dir).unwrap();
        let day = Duration::from_secs(86_400);
        let mut old = Vec::new();
        for index in 0..12u32 {
            old.push(fake_backup(
                &dir,
                &format!("boot-2026010{}T0000{:02}Z.db", index % 9, index),
                day * (index + 1),
            ));
        }
        let ts = fake_backup(&dir, "pre-migrate-20200101T000000Z.db", day * 400);

        let outcome = run(&mut conn, &db, &dir, &BackupPolicy::default()).await;
        let BackupOutcome::Written { path } = outcome else {
            panic!("{outcome:?}")
        };
        // Nothing is pruned until the boot has seen integrity_check pass.
        assert_eq!(list(&dir, &[BOOT_PREFIX]).len(), 13);
        let pruned = prune_old(&dir, BackupPolicy::default().keep);
        // 12 old + 1 new = 13 boot backups; the 3 oldest go.
        assert_eq!(pruned.len(), 3);
        for gone in &old[9..] {
            assert!(!gone.exists(), "{} should be pruned", gone.display());
        }
        for kept in &old[..9] {
            assert!(kept.exists());
        }
        assert!(path.exists());
        assert!(
            ts.exists(),
            "TS pre-migrate backups are pruned by backup.mjs, not by Rust"
        );
        assert_eq!(list(&dir, &[BOOT_PREFIX]).len(), 10);
    }

    #[test]
    fn measures_free_space() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(free_space(tmp.path()).unwrap() > 0);
    }
}
