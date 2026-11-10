//! `DATABASE_URL` parsing (D13). We never hand the URL to sqlx: sqlx's own parser would accept
//! `sqlite::memory:` and `?mode=rwc`, either of which could silently create an empty database.

use std::path::{Path, PathBuf};

use crate::config::AppEnv;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum DatabaseUrlError {
    #[error("DATABASE_URL is not set (required outside AUTODUCK_ENV=dev)")]
    Missing,
    #[error("DATABASE_URL must be a sqlite file URL (file:<path> or sqlite:<path>)")]
    NotSqlite,
    #[error("DATABASE_URL has no file path")]
    Empty,
    #[error("DATABASE_URL must name a file, not an in-memory database")]
    InMemory,
    #[error("DATABASE_URL must be an absolute path in {0} (got {1:?})")]
    NotAbsolute(&'static str, String),
}

/// Strips `file:`/`sqlite:` (and an optional `//` authority marker) plus any `?query`, then
/// resolves the path. Production and staging require an absolute path; dev resolves a relative
/// path against `cwd`, like the TS app does.
pub fn parse_database_url(raw: &str, env: AppEnv, cwd: &Path) -> Result<PathBuf, DatabaseUrlError> {
    let raw = raw.trim();
    let rest = raw
        .strip_prefix("file:")
        .or_else(|| raw.strip_prefix("sqlite:"))
        .ok_or(DatabaseUrlError::NotSqlite)?;
    let rest = rest.split_once('?').map_or(rest, |(path, _query)| path);
    let rest = rest.split_once('#').map_or(rest, |(path, _fragment)| path);
    // `file:///abs/path` and `sqlite:///abs/path` → `/abs/path`; `sqlite://rel.db` → `rel.db`.
    let path = rest.strip_prefix("//").unwrap_or(rest);
    if path.is_empty() {
        return Err(DatabaseUrlError::Empty);
    }
    if path == ":memory:" || path.starts_with(":memory") {
        return Err(DatabaseUrlError::InMemory);
    }
    let path = Path::new(path);
    if path.is_absolute() {
        return Ok(path.to_path_buf());
    }
    match env {
        AppEnv::Dev => Ok(cwd.join(path)),
        other => Err(DatabaseUrlError::NotAbsolute(
            other.as_str(),
            path.display().to_string(),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(raw: &str, env: AppEnv) -> Result<PathBuf, DatabaseUrlError> {
        parse_database_url(raw, env, Path::new("/work"))
    }

    #[test]
    fn accepts_prisma_and_sqlx_forms() {
        let prod = AppEnv::Production;
        assert_eq!(
            parse("file:/app/data/autoduck.db", prod),
            Ok("/app/data/autoduck.db".into())
        );
        assert_eq!(
            parse("file:///app/data/autoduck.db", prod),
            Ok("/app/data/autoduck.db".into())
        );
        assert_eq!(
            parse("sqlite:///app/data/autoduck.db?mode=rwc", prod),
            Ok("/app/data/autoduck.db".into())
        );
        assert_eq!(
            parse(" sqlite:/app/x.db#frag ", prod),
            Ok("/app/x.db".into())
        );
    }

    #[test]
    fn relative_only_in_dev() {
        assert_eq!(
            parse("file:./prisma/dev.db", AppEnv::Dev),
            Ok("/work/./prisma/dev.db".into())
        );
        assert!(matches!(
            parse("file:./prisma/dev.db", AppEnv::Production),
            Err(DatabaseUrlError::NotAbsolute("production", _))
        ));
        assert!(matches!(
            parse("file:x.db", AppEnv::Staging),
            Err(DatabaseUrlError::NotAbsolute("staging", _))
        ));
    }

    #[test]
    fn rejects_non_files() {
        let dev = AppEnv::Dev;
        assert_eq!(
            parse("postgres://x/y", dev),
            Err(DatabaseUrlError::NotSqlite)
        );
        assert_eq!(
            parse("/abs/no/scheme.db", dev),
            Err(DatabaseUrlError::NotSqlite)
        );
        assert_eq!(parse("file:", dev), Err(DatabaseUrlError::Empty));
        assert_eq!(
            parse("sqlite::memory:", dev),
            Err(DatabaseUrlError::InMemory)
        );
        assert_eq!(
            parse("file::memory:?cache=shared", dev),
            Err(DatabaseUrlError::InMemory)
        );
    }
}
