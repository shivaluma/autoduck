//! DB guards 3–5 and 7 (plan Phase 3): the file must exist, must hold players, must match the
//! staging sentinel rule, and must pass `PRAGMA integrity_check`.

use std::path::Path;

use sqlx::SqliteConnection;

use crate::config::AppEnv;
use crate::db::migrations::STAGING_SENTINEL_PREFIX;

#[derive(Debug, thiserror::Error)]
pub enum GuardError {
    #[error(
        "database file {0} does not exist; refusing to start (an empty database would be created)"
    )]
    Missing(String),
    #[error("{0} is not a regular file")]
    NotAFile(String),
    #[error(
        "\"SeasonPlayer\" has no rows: this looks like an empty or wrong database. \
         Refusing to start; set AUTODUCK_ALLOW_EMPTY_DB=1 if that is intended"
    )]
    Empty,
    #[error("{0} does not look like an AutoDuck database: {1}")]
    NotAutoduck(String, sqlx::Error),
    #[error(
        "AUTODUCK_ENV=staging requires an \"AppMigration\" row with id staging-sanitized-*; this database was not sanitised"
    )]
    StagingNotSanitized,
    #[error(
        "this database carries the staging sentinel {0:?} but AUTODUCK_ENV={1}; refusing to serve a sanitised copy"
    )]
    SentinelInProduction(String, &'static str),
    #[error("PRAGMA integrity_check failed: {0}")]
    Integrity(String),
    #[error(transparent)]
    Sql(#[from] sqlx::Error),
}

/// Guard 3: refuse to start if the file is missing (or isn't a file).
pub fn check_exists(path: &Path) -> Result<(), GuardError> {
    match std::fs::metadata(path) {
        Ok(meta) if meta.is_file() => Ok(()),
        Ok(_) => Err(GuardError::NotAFile(path.display().to_string())),
        Err(_) => Err(GuardError::Missing(path.display().to_string())),
    }
}

/// Guard 4: refuse to start when `SeasonPlayer` is empty unless explicitly allowed. Returns the
/// player count.
pub async fn check_not_empty(
    conn: &mut SqliteConnection,
    path: &Path,
    allow_empty: bool,
) -> Result<i64, GuardError> {
    let count = sqlx::query_scalar!(r#"SELECT COUNT(*) AS "count!: i64" FROM "SeasonPlayer""#)
        .fetch_one(conn)
        .await
        .map_err(|error| GuardError::NotAutoduck(path.display().to_string(), error))?;
    if count == 0 {
        if allow_empty {
            tracing::warn!(
                "\"SeasonPlayer\" is empty; continuing because AUTODUCK_ALLOW_EMPTY_DB=1"
            );
        } else {
            return Err(GuardError::Empty);
        }
    }
    Ok(count)
}

/// Guard 5: staging requires the sentinel row, production refuses it. Dev logs it either way.
pub async fn check_sentinel(
    conn: &mut SqliteConnection,
    env: AppEnv,
) -> Result<Option<String>, GuardError> {
    let pattern = format!("{STAGING_SENTINEL_PREFIX}*");
    let sentinel = sqlx::query_scalar!(
        r#"SELECT "id" AS "id!" FROM "AppMigration" WHERE "id" GLOB ? ORDER BY "id" LIMIT 1"#,
        pattern
    )
    .fetch_optional(conn)
    .await?;
    match (env, &sentinel) {
        (AppEnv::Staging, None) => Err(GuardError::StagingNotSanitized),
        (AppEnv::Production, Some(id)) => {
            Err(GuardError::SentinelInProduction(id.clone(), env.as_str()))
        }
        (AppEnv::Dev, Some(id)) => {
            tracing::info!(sentinel = %id, "database is a sanitised staging copy");
            Ok(sentinel)
        }
        _ => Ok(sentinel),
    }
}

/// Guard 7: `PRAGMA integrity_check` must return exactly `ok`. Fatal otherwise (D29).
pub async fn check_integrity(conn: &mut SqliteConnection) -> Result<(), GuardError> {
    let rows: Vec<String> = sqlx::query_scalar("PRAGMA integrity_check")
        .fetch_all(conn)
        .await?;
    if rows.len() == 1 && rows[0] == "ok" {
        Ok(())
    } else {
        let mut summary = rows.into_iter().take(20).collect::<Vec<_>>().join("; ");
        if summary.is_empty() {
            summary = "no result".to_owned();
        }
        Err(GuardError::Integrity(summary))
    }
}
