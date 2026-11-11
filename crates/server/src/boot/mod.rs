//! Boot sequence (plan Phase 3, "DB guards at boot, in order"):
//!
//! 1. Lock (D21) — [`lock`].
//! 2. Parse `DATABASE_URL` — done by [`crate::config`] (pure; logged here).
//! 3. Refuse a missing file — [`guards::check_exists`].
//! 4. Refuse an empty `SeasonPlayer` unless `AUTODUCK_ALLOW_EMPTY_DB=1` — [`guards::check_not_empty`].
//! 5. Staging sentinel, both ways — [`guards::check_sentinel`].
//! 6. Backup (D29) — [`backup`].
//! 7. `integrity_check`, fatal — [`guards::check_integrity`]; then prune old backups.
//! 8. Schema verifier (D14) — [`crate::db::schema`].
//! 9. Required TS migration ids — [`crate::db::migrations`].
//! 10. `ensure_imported` — [`replay_import`]: read-only check of the replay-track manifest.
//! 11. Crash recovery (D22) — [`recovery`].
//! 12. Bind HTTP — the caller ([`crate::cli`]).

pub mod backup;
pub mod guards;
pub mod lock;
pub mod recovery;
pub mod replay_import;

use crate::config::{AppEnv, Config, SchemaMode};
use crate::db::migrations::{self, PONR_MARKER_ID};
use crate::db::{Db, schema};

pub use lock::InstanceLock;

#[derive(Debug, thiserror::Error)]
pub enum BootError {
    #[error(transparent)]
    Lock(#[from] lock::LockError),
    #[error(transparent)]
    Guard(#[from] guards::GuardError),
    #[error("schema verification failed ({count} fatal): {details}")]
    Schema { count: usize, details: String },
    #[error("required TS migrations are missing: {0}")]
    Migrations(String),
    #[error("{0}")]
    SchemaMode(String),
    #[error("database error during boot: {0}")]
    Sql(#[from] sqlx::Error),
}

/// What a successful boot hands to the server.
#[derive(Debug)]
pub struct Booted {
    pub db: Db,
    pub lock: InstanceLock,
    pub recovery: recovery::RecoveryReport,
}

/// Steps 1–11. On success the lock is held and the pools are open.
pub async fn run(config: &Config) -> Result<Booted, BootError> {
    tracing::info!(
        env = config.env.as_str(),
        engine = race_protocol::versions::RACE_ENGINE_VERSION,
        balance = race_protocol::versions::RACE_BALANCE_VERSION,
        "autoduck booting"
    );

    // 1. Lock, before touching the database.
    let lock = lock::acquire(&config.lock_path, config.lock_wait).await?;

    // 2. DATABASE_URL was parsed by our own code (config); never by sqlx.
    tracing::info!(path = %config.db_path.display(), "database");

    // 3. Missing file.
    guards::check_exists(&config.db_path)?;

    let db = Db::open(&config.db_path).await?;
    let result = run_db_guards(config, &db).await;
    match result {
        Ok(recovery) => Ok(Booted { db, lock, recovery }),
        Err(error) => {
            db.close().await;
            Err(error)
        }
    }
}

/// Steps 4–11 on open pools (separate so tests can run them without the lock).
pub async fn run_db_guards(
    config: &Config,
    db: &Db,
) -> Result<recovery::RecoveryReport, BootError> {
    let mut reader = db.reader.acquire().await?;

    // 4. Empty database.
    let players =
        guards::check_not_empty(&mut reader, &config.db_path, config.allow_empty_db).await?;
    tracing::info!(players, "SeasonPlayer rows");

    // 5. Staging sentinel.
    guards::check_sentinel(&mut reader, config.env).await?;

    // 6. Backup (best effort, on the idle writer connection).
    if config.backup_enabled {
        let mut writer = db.writer.acquire().await?;
        backup::run(
            &mut writer,
            &config.db_path,
            &config.backup_dir,
            &backup::BackupPolicy::default(),
        )
        .await;
    } else {
        tracing::warn!("boot backup disabled (AUTODUCK_BACKUP=0)");
    }

    // 7. Integrity (fatal). Old backups are pruned only after it passes, so a crash loop on a
    // corrupt file keeps the good ones.
    guards::check_integrity(&mut reader).await?;
    tracing::info!("integrity_check ok");
    if config.backup_enabled {
        backup::prune_old(&config.backup_dir, backup::BackupPolicy::default().keep);
    }

    // 8. Schema verifier, compat mode: no DDL ever.
    check_schema_mode(config, &mut reader).await?;
    let report = schema::verify(&mut reader).await?;
    for drift in &report.drift {
        tracing::info!(%drift, "schema drift (non-fatal)");
    }
    if !report.is_ok() {
        for fatal in &report.fatal {
            tracing::error!(%fatal, "schema drift (fatal)");
        }
        return Err(BootError::Schema {
            count: report.fatal.len(),
            details: report.fatal.join("; "),
        });
    }
    tracing::info!(drift = report.drift.len(), "schema verified: 0 fatal");

    // 9. Required TS migration ids.
    let applied = migrations::applied_ids(&mut reader).await?;
    let missing = migrations::missing_required(&applied);
    if !missing.is_empty() {
        if config.env == AppEnv::Dev {
            tracing::warn!(missing = %missing.join(", "), "required TS migrations missing (AUTODUCK_ENV=dev: warning only)");
        } else {
            return Err(BootError::Migrations(missing.join(", ")));
        }
    } else {
        tracing::info!(count = applied.len(), "required TS migrations present");
    }

    // 10. ensure_imported: read-only, never fatal (the TS image imported every manifest race
    // before the cutover).
    replay_import::run(&mut reader, &config.replay_manifest).await;
    drop(reader);

    // 11. Crash recovery.
    let recovery = recovery::recover(db).await?;
    Ok(recovery)
}

async fn check_schema_mode(
    config: &Config,
    conn: &mut sqlx::SqliteConnection,
) -> Result<(), BootError> {
    if config.schema_mode == SchemaMode::Compat {
        return Ok(());
    }
    let marker = sqlx::query_scalar!(
        r#"SELECT "id" AS "id!" FROM "AppMigration" WHERE "id" = ?"#,
        PONR_MARKER_ID
    )
    .fetch_optional(conn)
    .await?;
    Err(BootError::SchemaMode(match marker {
        None => format!(
            "AUTODUCK_SCHEMA_MODE=owned needs the \"AppMigration\" marker row {PONR_MARKER_ID:?} (point of no return); refusing to start"
        ),
        Some(_) => {
            "AUTODUCK_SCHEMA_MODE=owned is not implemented in this build (Phase 9); use compat"
                .to_owned()
        }
    }))
}
