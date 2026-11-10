//! Calibration on a copy of `prisma/dev.db` (plan Phase 3 gate). The copy is named by
//! `AUTODUCK_TEST_DEV_DB` (make it with `sqlite3 prisma/dev.db ".backup /tmp/…/dev-copy.db"`;
//! never point it at the original). Each test re-copies it with `VACUUM INTO` from a read-only
//! connection into a temp dir, so even the copy is never written.
//!
//! Without the env var these tests print a note and pass (CI has no dev.db).

mod common;

use autoduck_server::boot;
use autoduck_server::db::{Db, DbTime, schema};
use common::{config, dev_db_copy, sha256_file};
use sqlx::{Connection, Row};

#[tokio::test]
async fn schema_verifier_has_no_fatal_drift() {
    let dir = tempfile::tempdir().unwrap();
    let Some(db) = dev_db_copy(dir.path()).await else {
        return;
    };
    let mut conn = autoduck_server::db::pool::connect_read_only(&db)
        .await
        .unwrap();
    let report = schema::verify(&mut conn).await.unwrap();
    for drift in &report.drift {
        eprintln!("drift: {drift}");
    }
    assert!(report.fatal.is_empty(), "fatal drift: {:?}", report.fatal);
    conn.close().await.unwrap();
}

/// Recovery on its own (no schema gate), so it also runs on a raw dev.db that predates
/// `RaceReplayTrack` (step 0.4) and therefore fails the schema guard.
#[tokio::test]
async fn crash_recovery_alone_changes_zero_rows() {
    let dir = tempfile::tempdir().unwrap();
    let Some(db) = dev_db_copy(dir.path()).await else {
        return;
    };
    let before = sha256_file(&db);
    let pools = Db::open(&db).await.unwrap();
    let report = autoduck_server::boot::recovery::recover(&pools)
        .await
        .unwrap();
    pools.close().await;
    eprintln!("recovery report: {report:?}");
    assert_eq!(report.rows_changed, 0);
    assert!(
        report.failed.is_empty() && report.awaiting_t2.is_empty() && report.unexpected.is_empty()
    );
    assert_eq!(
        sha256_file(&db),
        before,
        "recovery modified the database file"
    );
}

#[tokio::test]
async fn full_boot_changes_zero_rows() {
    let dir = tempfile::tempdir().unwrap();
    let Some(db) = dev_db_copy(dir.path()).await else {
        return;
    };
    let before = sha256_file(&db);
    let race_rows_before: Vec<(i64, String, String)> = {
        let mut conn = autoduck_server::db::pool::connect_read_only(&db)
            .await
            .unwrap();
        sqlx::query_as(r#"SELECT "id", "status", "engineState" FROM "Race" ORDER BY "id""#)
            .fetch_all(&mut conn)
            .await
            .unwrap()
    };

    // AUTODUCK_ENV=dev: a raw dev.db predates the newest TS migration ids (warning only).
    let cfg = config(dir.path(), &db, &[("AUTODUCK_ENV", "dev")]);
    let booted = boot::run(&cfg).await.unwrap();
    assert_eq!(booted.recovery.rows_changed, 0);
    assert!(booted.recovery.failed.is_empty());
    assert!(booted.recovery.awaiting_t2.is_empty());
    booted.db.close().await;
    drop(booted.lock);

    // Races 38–40 (failed/FINISHED/1.2.0) are untouched, and so is every other byte.
    let failed_finished: Vec<i64> = race_rows_before
        .iter()
        .filter(|(_, status, state)| status == "failed" && state == "FINISHED")
        .map(|(id, _, _)| *id)
        .collect();
    eprintln!("failed/FINISHED races in the copy: {failed_finished:?}");
    assert_eq!(sha256_file(&db), before, "boot modified the database file");
}

#[tokio::test]
async fn every_datetime_value_decodes_and_round_trips() {
    let dir = tempfile::tempdir().unwrap();
    let Some(db) = dev_db_copy(dir.path()).await else {
        return;
    };
    let pools = Db::open(&db).await.unwrap();
    let columns: Vec<(String, String)> = sqlx::query_as(
        r#"SELECT m.name, c.name FROM sqlite_master m, pragma_table_xinfo(m.name) c
           WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%'
             AND (upper(c.type) LIKE '%DATE%' OR upper(c.type) LIKE '%TIME%')
           ORDER BY m.name, c.cid"#,
    )
    .fetch_all(&pools.reader)
    .await
    .unwrap();
    assert!(
        columns.len() >= 50,
        "found only {} DATETIME columns",
        columns.len()
    );

    let mut decoded = 0usize;
    for (table, column) in &columns {
        // Identifiers come from sqlite_master, not from input.
        let sql = format!(
            r#"SELECT "{column}", CAST("{column}" AS TEXT), typeof("{column}") FROM "{table}""#
        );
        let rows = sqlx::query(sqlx::AssertSqlSafe(sql))
            .fetch_all(&pools.reader)
            .await
            .unwrap();
        for row in rows {
            let value: Option<DbTime> = row
                .try_get(0)
                .unwrap_or_else(|error| panic!("{table}.{column}: {error}"));
            let text: Option<String> = row.get(1);
            let kind: String = row.get(2);
            let (Some(value), Some(text)) = (value, text) else {
                continue;
            };
            decoded += 1;
            if kind == "text" && text.ends_with("+00:00") && text.len() == 29 {
                // The Prisma format re-encodes byte for byte.
                assert_eq!(value.to_db_string(), text, "{table}.{column}");
            }
            assert_eq!(DbTime::parse(&value.to_db_string()), Ok(value));
        }
    }
    eprintln!(
        "decoded {decoded} DATETIME values from {} columns",
        columns.len()
    );
    assert!(decoded > 0);
    pools.close().await;
}
