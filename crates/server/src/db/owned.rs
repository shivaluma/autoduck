//! Owned schema mode (D14, plan Phase 9 steps 2–4).
//!
//! With `AUTODUCK_SCHEMA_MODE=owned` the boot runs these steps after the schema verifier and
//! the required-TS-ids check have passed. Each one is recorded in `AppMigration` with an
//! `rs-*` id and skipped once recorded, so a second boot changes nothing.
//!
//! 1. **`rs-ponr`**: the point-of-no-return marker. The first owned boot inserts it and so
//!    adopts the Prisma-made schema as-is: no table is rebuilt and no row changes. (`_sqlx_migrations`
//!    is never created.)
//! 2. **`rs-0010-drop-legacy-v2`** (D25): `VACUUM INTO <backup dir>/autoduck-legacy-archive-<UTC>.db`,
//!    then the archive is opened read-only and must pass `integrity_check` with the same row
//!    count for every legacy table. Any failure aborts the boot before anything is dropped.
//!    Then one `BEGIN IMMEDIATE` transaction re-counts the rows, drops the 11 legacy v2 tables
//!    children before parents ([`LEGACY_DROP_ORDER`]) and records the id: all or nothing.
//! 3. **`rs-0011-wal-journal`** (D15): `PRAGMA journal_mode=WAL` (persistent in the file), then
//!    the id. The caller reopens the pools so every connection sets `WAL` explicitly. Backups
//!    were already `VACUUM INTO` ([`crate::boot::backup`]), which is WAL-safe.
//!
//! Compat mode (the default outside the Docker image) never runs any of this.

use std::path::{Path, PathBuf};

use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode};
use sqlx::{AssertSqlSafe, Connection, SqliteConnection};

use super::migrations::PONR_MARKER_ID;
use super::{Db, DbTime};
use crate::boot::backup;

pub const DROP_LEGACY_ID: &str = "rs-0010-drop-legacy-v2";
pub const WAL_ID: &str = "rs-0011-wal-journal";
pub const ARCHIVE_PREFIX: &str = "autoduck-legacy-archive-";

/// The legacy v2 tables ([`super::schema::LEGACY_TABLES`]: the v2 tables no Rust statement
/// touches; `CommentaryLog` stays because race detail reads it) in drop order: every table comes
/// before the legacy tables it references (FK graph of the production schema; no live table
/// references a legacy one). `DROP TABLE` with `foreign_keys=ON` deletes the rows first, so a
/// parent dropped before its child would fail.
pub const LEGACY_DROP_ORDER: [&str; 11] = [
    "DragonItemEvent", // -> DragonItem, Race, User
    "DragonItem",      // -> DragonSummon, Race, User
    "DragonOrbEvent",  // -> DragonOrb, DragonSummon, DragonTrade, Race, User
    "DragonTrade",     // -> DragonOrb, User
    "DragonOrb",       // -> DragonWeek, Race, User
    "DragonSummon",    // -> User
    "DragonWeek",      // -> Race
    "MysteryChest",    // -> User
    "Shield",          // -> User
    "CommentaryJob",   // -> Race
    "WeeklyTick",
];

#[derive(Debug, thiserror::Error)]
pub enum OwnedError {
    #[error("owned-schema migration failed: {0}")]
    Sql(#[from] sqlx::Error),
    #[error("{DROP_LEGACY_ID}: legacy archive failed, nothing was dropped: {0}")]
    Archive(String),
    #[error("{WAL_ID}: {0}")]
    Journal(String),
}

#[derive(Debug, Default)]
pub struct OwnedReport {
    /// This boot inserted `rs-ponr`.
    pub adopted: bool,
    /// The archive this boot wrote before dropping.
    pub archive: Option<PathBuf>,
    /// `(table, rows)` this boot dropped, in drop order.
    pub dropped: Vec<(String, i64)>,
    /// This boot switched the file to WAL.
    pub wal_enabled: bool,
}

impl OwnedReport {
    pub fn changed_anything(&self) -> bool {
        self.adopted || self.archive.is_some() || !self.dropped.is_empty() || self.wal_enabled
    }
}

async fn applied(conn: &mut SqliteConnection, id: &str) -> Result<bool, sqlx::Error> {
    let row: Option<i64> = sqlx::query_scalar(r#"SELECT 1 FROM "AppMigration" WHERE "id" = ?"#)
        .bind(id)
        .fetch_optional(&mut *conn)
        .await?;
    Ok(row.is_some())
}

async fn record(conn: &mut SqliteConnection, id: &str, name: &str) -> Result<(), sqlx::Error> {
    sqlx::query(r#"INSERT INTO "AppMigration" ("id", "name", "runAt") VALUES (?, ?, ?)"#)
        .bind(id)
        .bind(name)
        .bind(DbTime::now())
        .execute(&mut *conn)
        .await?;
    Ok(())
}

/// Legacy tables present in the file, with their row counts, in drop order.
async fn legacy_counts(conn: &mut SqliteConnection) -> Result<Vec<(String, i64)>, sqlx::Error> {
    let mut counts = Vec::new();
    for table in LEGACY_DROP_ORDER {
        let exists: Option<i64> =
            sqlx::query_scalar("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
                .bind(table)
                .fetch_optional(&mut *conn)
                .await?;
        if exists.is_none() {
            continue;
        }
        // The name comes from the constant list above, never from input.
        let rows: i64 =
            sqlx::query_scalar(AssertSqlSafe(format!(r#"SELECT COUNT(*) FROM "{table}""#)))
                .fetch_one(&mut *conn)
                .await?;
        counts.push((table.to_owned(), rows));
    }
    Ok(counts)
}

/// `autoduck-legacy-archive-20261111T033343Z.db`
pub fn archive_name(now: DbTime) -> String {
    let boot = backup::backup_name(now);
    format!("{ARCHIVE_PREFIX}{}", &boot[backup::BOOT_PREFIX.len()..])
}

/// Runs every pending owned-schema step on `db`'s writer. On success the file may have switched
/// to WAL; the caller reopens the pools when `db.journal` no longer matches the file.
pub async fn migrate(db: &Db, archive_dir: &Path) -> Result<OwnedReport, OwnedError> {
    let mut report = OwnedReport::default();

    // 1. Point of no return: adopt the existing schema.
    {
        let mut tx = db.begin_write().await?;
        if !applied(&mut tx, PONR_MARKER_ID).await? {
            record(
                &mut tx,
                PONR_MARKER_ID,
                "point of no return: the Rust server owns the schema (Prisma schema adopted as-is)",
            )
            .await?;
            report.adopted = true;
        }
        tx.commit().await?;
    }
    if report.adopted {
        tracing::warn!(
            marker = PONR_MARKER_ID,
            "POINT OF NO RETURN: the Rust server now owns the schema (existing tables adopted unchanged)"
        );
    }

    // 2. Archive, then drop the legacy v2 tables.
    let mut writer = db.writer.acquire().await?;
    if !applied(&mut writer, DROP_LEGACY_ID).await? {
        let before = legacy_counts(&mut writer).await?;
        if before.is_empty() {
            tracing::info!("{DROP_LEGACY_ID}: no legacy table present; nothing to archive");
        } else {
            let archive = write_archive(&mut writer, archive_dir, &before).await?;
            tracing::info!(file = %archive.display(), tables = before.len(), "legacy archive written and verified");
            report.archive = Some(archive);
        }
        drop(writer);

        let mut tx = db.begin_write().await?;
        let now = legacy_counts(&mut tx).await?;
        if now != before {
            return Err(OwnedError::Archive(format!(
                "legacy row counts changed after the archive was written ({before:?} -> {now:?})"
            )));
        }
        for (table, _) in &now {
            // `table` is one of LEGACY_DROP_ORDER (legacy_counts only returns those).
            sqlx::query(AssertSqlSafe(format!(r#"DROP TABLE "{table}""#)))
                .execute(&mut *tx)
                .await?;
        }
        record(
            &mut tx,
            DROP_LEGACY_ID,
            "archive (VACUUM INTO autoduck-legacy-archive-*) and drop the legacy v2 tables",
        )
        .await?;
        tx.commit().await?;
        for (table, rows) in &now {
            tracing::info!(table = %table, rows, "dropped legacy table");
        }
        report.dropped = now;
        writer = db.writer.acquire().await?;
    }

    // 3. WAL. A file property, so it is (re)applied whenever the file isn't WAL: an older
    // image or a manual sqlite3 session may have switched it back to DELETE.
    let recorded = applied(&mut writer, WAL_ID).await?;
    if !recorded || db.journal != SqliteJournalMode::Wal {
        let mode: String = sqlx::query_scalar("PRAGMA journal_mode = WAL")
            .fetch_one(&mut *writer)
            .await?;
        if !mode.eq_ignore_ascii_case("wal") {
            return Err(OwnedError::Journal(format!(
                "PRAGMA journal_mode = WAL returned {mode:?}"
            )));
        }
        report.wal_enabled = db.journal != SqliteJournalMode::Wal;
        if report.wal_enabled {
            tracing::info!("journal_mode switched to WAL");
        }
    }
    drop(writer);
    if !recorded {
        let mut tx = db.begin_write().await?;
        record(&mut tx, WAL_ID, "journal_mode=WAL").await?;
        tx.commit().await?;
    }
    Ok(report)
}

/// Writes the archive and verifies it; any failure removes it and is an [`OwnedError::Archive`].
async fn write_archive(
    writer: &mut SqliteConnection,
    dir: &Path,
    expected: &[(String, i64)],
) -> Result<PathBuf, OwnedError> {
    std::fs::create_dir_all(dir).map_err(|error| {
        OwnedError::Archive(format!("cannot create {}: {error}", dir.display()))
    })?;
    backup::restrict(dir, 0o700);
    let target = dir.join(archive_name(DbTime::now()));
    backup::vacuum_into_durable(writer, &target)
        .await
        .map_err(OwnedError::Archive)?;
    match verify_archive(&target, expected).await {
        Ok(()) => Ok(target),
        Err(error) => {
            let _ = std::fs::remove_file(&target);
            Err(OwnedError::Archive(format!(
                "{} failed verification: {error}",
                target.display()
            )))
        }
    }
}

async fn verify_archive(path: &Path, expected: &[(String, i64)]) -> Result<(), String> {
    let mut conn = SqliteConnection::connect_with(
        &SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(false)
            .read_only(true),
    )
    .await
    .map_err(|error| format!("cannot open: {error}"))?;
    let result = async {
        let rows: Vec<String> = sqlx::query_scalar("PRAGMA integrity_check")
            .fetch_all(&mut conn)
            .await
            .map_err(|error| error.to_string())?;
        if rows != ["ok"] {
            return Err(format!("integrity_check: {}", rows.join("; ")));
        }
        let have = legacy_counts(&mut conn)
            .await
            .map_err(|error| error.to_string())?;
        if have != expected {
            return Err(format!(
                "legacy row counts differ: archive {have:?}, database {expected:?}"
            ));
        }
        Ok(())
    }
    .await;
    let _ = conn.close().await;
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::LEGACY_TABLES;

    #[test]
    fn drop_order_covers_the_legacy_tables() {
        let mut order = LEGACY_DROP_ORDER.to_vec();
        order.sort();
        let mut legacy = LEGACY_TABLES.to_vec();
        legacy.sort();
        assert_eq!(order, legacy);
    }

    #[tokio::test]
    async fn drop_order_is_children_first_in_the_baseline() {
        let mut conn = SqliteConnection::connect("sqlite::memory:").await.unwrap();
        sqlx::raw_sql(crate::db::BASELINE_SQL)
            .execute(&mut conn)
            .await
            .unwrap();
        let live = crate::db::schema::LIVE_TABLES;
        let tables: Vec<String> = sqlx::query_scalar(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
        )
        .fetch_all(&mut conn)
        .await
        .unwrap();
        for table in &tables {
            let parents: Vec<String> =
                sqlx::query_scalar(r#"SELECT "table" FROM pragma_foreign_key_list(?)"#)
                    .bind(table)
                    .fetch_all(&mut conn)
                    .await
                    .unwrap();
            for parent in parents {
                let child_legacy = LEGACY_DROP_ORDER.iter().position(|t| t == table);
                let parent_legacy = LEGACY_DROP_ORDER.iter().position(|t| *t == parent);
                match (child_legacy, parent_legacy) {
                    (Some(child), Some(parent_at)) => assert!(
                        child < parent_at,
                        "{table} must be dropped before its parent {parent}"
                    ),
                    (None, Some(_)) => {
                        panic!("live table {table} references legacy table {parent}")
                    }
                    _ => {}
                }
                if child_legacy.is_none() {
                    assert!(live.contains(&table.as_str()), "unknown table {table}");
                }
            }
        }
    }

    /// No compile-checked query (`.sqlx/`) may touch a dropped table. The one exception is the
    /// dev seed's `Shield` insert, which runs only while that table exists.
    #[test]
    fn no_checked_query_reads_a_dropped_table() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.sqlx");
        let mut checked = 0;
        for entry in std::fs::read_dir(&dir).unwrap() {
            let text = std::fs::read_to_string(entry.unwrap().path()).unwrap();
            let query: serde_json::Value = serde_json::from_str(&text).unwrap();
            let sql = query["query"].as_str().unwrap();
            checked += 1;
            for table in LEGACY_DROP_ORDER {
                if sql.contains(&format!("\"{table}\"")) {
                    assert!(
                        table == "Shield"
                            && sql.trim_start().starts_with(r#"INSERT INTO "Shield""#),
                        "a checked query uses the dropped table {table}: {sql}"
                    );
                }
            }
        }
        assert!(checked > 0);
    }

    #[test]
    fn archive_name_format() {
        let t = DbTime::parse("2026-11-11T03:33:43.123Z").unwrap();
        assert_eq!(
            archive_name(t),
            "autoduck-legacy-archive-20261111T033343Z.db"
        );
    }
}
