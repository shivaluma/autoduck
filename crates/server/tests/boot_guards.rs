//! Boot guard behaviour: missing and empty DBs are refused, the staging sentinel is enforced
//! both ways, integrity and schema failures are fatal, and two processes contend for the lock.

mod common;

use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use autoduck_server::boot::{self, BootError, guards::GuardError};
use autoduck_server::db::Db;
use common::{config, create_db, populated_db};
use sqlx::Connection;

fn autoduck(dir: &std::path::Path, db: &std::path::Path, extra: &[(&str, &str)]) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_autoduck"));
    command
        .env_clear()
        .env("RUST_LOG", "info")
        .env("DATABASE_URL", format!("file:{}", db.display()))
        .env("AUTODUCK_LOCK_PATH", dir.join("autoduck.lock"))
        .env("AUTODUCK_BACKUP_DIR", dir.join("backups"))
        .env("AUTODUCK_DIST_DIR", dir.join("dist"))
        .env("HOST", "127.0.0.1")
        .env("PORT", "0");
    // A `test-rng` build (CI's --all-features run) only serves in dev; these guards behave the
    // same there. `test_rng_build_refuses_production` covers the refusal itself.
    if cfg!(feature = "test-rng") {
        command.env("AUTODUCK_ENV", "dev");
    }
    for (key, value) in extra {
        command.env(key, value);
    }
    command
}

/// Spawns `autoduck serve` and waits for the "listening" log line. Returns the child and a
/// receiver with the remaining stderr lines.
fn spawn_serving(command: &mut Command) -> (Child, mpsc::Receiver<String>) {
    let mut child = command
        .arg("serve")
        .stderr(Stdio::piped())
        .stdout(Stdio::null())
        .spawn()
        .unwrap();
    let stderr = child.stderr.take().unwrap();
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if tx.send(line).is_err() {
                break;
            }
        }
    });
    let deadline = Instant::now() + Duration::from_secs(30);
    let mut seen = Vec::new();
    while Instant::now() < deadline {
        match rx.recv_timeout(Duration::from_millis(200)) {
            Ok(line) if line.contains("listening") => return (child, rx),
            Ok(line) => seen.push(line),
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    let _ = child.kill();
    let _ = child.wait();
    panic!("autoduck serve did not start:\n{}", seen.join("\n"));
}

fn terminate(mut child: Child) {
    // SAFETY: plain kill(2) on a child we own.
    unsafe {
        libc::kill(i32::try_from(child.id()).unwrap(), libc::SIGTERM);
    }
    let deadline = Instant::now() + Duration::from_secs(20);
    while Instant::now() < deadline {
        if child.try_wait().unwrap().is_some() {
            return;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    let _ = child.kill();
    let _ = child.wait();
    panic!("autoduck serve ignored SIGTERM");
}

#[test]
fn missing_database_is_refused_and_never_created() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("absent.db");
    let output = autoduck(dir.path(), &db, &[])
        .arg("serve")
        .output()
        .unwrap();
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert_eq!(output.status.code(), Some(1), "{stderr}");
    assert!(stderr.contains("does not exist"), "{stderr}");
    assert!(!db.exists(), "serve created the database file");
}

#[test]
fn relative_database_url_is_refused_in_production() {
    let dir = tempfile::tempdir().unwrap();
    let output = autoduck(
        dir.path(),
        &dir.path().join("x.db"),
        &[("AUTODUCK_ENV", "production")],
    )
    .env("DATABASE_URL", "file:./prisma/dev.db")
    .arg("serve")
    .output()
    .unwrap();
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert_eq!(output.status.code(), Some(1), "{stderr}");
    assert!(stderr.contains("absolute"), "{stderr}");
}

#[tokio::test]
async fn empty_database_is_refused_unless_allowed() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("empty.db");
    let mut conn = create_db(&db).await;
    common::mark_all_migrations(&mut conn).await;
    conn.close().await.unwrap();

    // Through the binary: exit 1 with the guard's message.
    let output = autoduck(dir.path(), &db, &[])
        .arg("serve")
        .output()
        .unwrap();
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert_eq!(output.status.code(), Some(1), "{stderr}");
    assert!(stderr.contains("\"SeasonPlayer\" has no rows"), "{stderr}");

    // Through the library: refused, then allowed by the env switch.
    let refused = boot::run(&config(dir.path(), &db, &[])).await.unwrap_err();
    assert!(
        matches!(refused, BootError::Guard(GuardError::Empty)),
        "{refused}"
    );
    let allowed = boot::run(&config(
        dir.path(),
        &db,
        &[("AUTODUCK_ALLOW_EMPTY_DB", "1")],
    ))
    .await
    .unwrap();
    allowed.db.close().await;
}

#[tokio::test]
async fn non_autoduck_database_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("other.db");
    let mut conn = sqlx::SqliteConnection::connect_with(
        &sqlx::sqlite::SqliteConnectOptions::new()
            .filename(&db)
            .create_if_missing(true),
    )
    .await
    .unwrap();
    sqlx::raw_sql("CREATE TABLE t (x)")
        .execute(&mut conn)
        .await
        .unwrap();
    conn.close().await.unwrap();
    let error = boot::run(&config(dir.path(), &db, &[])).await.unwrap_err();
    assert!(
        matches!(error, BootError::Guard(GuardError::NotAutoduck(..))),
        "{error}"
    );
}

#[tokio::test]
async fn staging_sentinel_is_enforced_both_ways() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("autoduck.db");
    populated_db(&db).await;

    // Staging without the sentinel: refused.
    let staging = config(
        dir.path(),
        &db,
        &[("AUTODUCK_ENV", "staging"), ("AUTODUCK_BACKUP", "0")],
    );
    let error = boot::run(&staging).await.unwrap_err();
    assert!(
        matches!(error, BootError::Guard(GuardError::StagingNotSanitized)),
        "{error}"
    );

    // Production without the sentinel: fine.
    let production = config(dir.path(), &db, &[("AUTODUCK_BACKUP", "0")]);
    boot::run(&production).await.unwrap().db.close().await;

    // Add the sentinel (as the Phase 7 sanitising SQL does).
    let mut conn = create_or_open(&db).await;
    sqlx::query(r#"INSERT INTO "AppMigration" ("id", "name", "runAt") VALUES ('staging-sanitized-20261109', 'sanitised copy', CURRENT_TIMESTAMP)"#)
        .execute(&mut conn)
        .await
        .unwrap();
    conn.close().await.unwrap();

    // Staging with it: fine. Production with it: refused.
    boot::run(&staging).await.unwrap().db.close().await;
    let error = boot::run(&production).await.unwrap_err();
    assert!(
        matches!(
            error,
            BootError::Guard(GuardError::SentinelInProduction(..))
        ),
        "{error}"
    );
}

async fn create_or_open(path: &std::path::Path) -> sqlx::SqliteConnection {
    sqlx::SqliteConnection::connect_with(&sqlx::sqlite::SqliteConnectOptions::new().filename(path))
        .await
        .unwrap()
}

#[tokio::test]
async fn missing_required_migration_is_fatal_outside_dev() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("autoduck.db");
    populated_db(&db).await;
    let mut conn = create_or_open(&db).await;
    sqlx::query(r#"DELETE FROM "AppMigration" WHERE "id" = '2026-10-05-001-cosmetics-v2-catalog'"#)
        .execute(&mut conn)
        .await
        .unwrap();
    conn.close().await.unwrap();

    let error = boot::run(&config(dir.path(), &db, &[("AUTODUCK_BACKUP", "0")]))
        .await
        .unwrap_err();
    assert!(
        matches!(error, BootError::Migrations(ref ids) if ids.contains("cosmetics-v2")),
        "{error}"
    );
    // AUTODUCK_ENV=dev only warns.
    boot::run(&config(
        dir.path(),
        &db,
        &[("AUTODUCK_ENV", "dev"), ("AUTODUCK_BACKUP", "0")],
    ))
    .await
    .unwrap()
    .db
    .close()
    .await;
}

#[tokio::test]
async fn missing_live_table_is_fatal() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("autoduck.db");
    populated_db(&db).await;
    let mut conn = create_or_open(&db).await;
    sqlx::raw_sql(r#"DROP TABLE "RaceReplayTrack""#)
        .execute(&mut conn)
        .await
        .unwrap();
    conn.close().await.unwrap();
    let error = boot::run(&config(dir.path(), &db, &[("AUTODUCK_BACKUP", "0")]))
        .await
        .unwrap_err();
    assert!(
        matches!(error, BootError::Schema { count: 1, .. }),
        "{error}"
    );
}

#[tokio::test]
async fn owned_schema_mode_needs_the_ponr_marker() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("autoduck.db");
    populated_db(&db).await;
    let error = boot::run(&config(
        dir.path(),
        &db,
        &[("AUTODUCK_SCHEMA_MODE", "owned"), ("AUTODUCK_BACKUP", "0")],
    ))
    .await
    .unwrap_err();
    assert!(
        matches!(error, BootError::SchemaMode(ref m) if m.contains("rs-ponr")),
        "{error}"
    );
}

#[tokio::test]
async fn corrupt_database_fails_integrity_check() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("autoduck.db");
    populated_db(&db).await;
    // Swap the root pages of two indexes on the same table: every query the earlier guards run
    // still works, but `PRAGMA integrity_check` reports rows missing from both indexes.
    let mut conn = create_or_open(&db).await;
    sqlx::raw_sql(
        r#"CREATE TABLE "Zz" ("a" INTEGER, "b" INTEGER);
           CREATE INDEX "Zz_a" ON "Zz" ("a");
           CREATE INDEX "Zz_b" ON "Zz" ("b");
           WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 200)
           INSERT INTO "Zz" SELECT i, 1000 - i FROM n;"#,
    )
    .execute(&mut conn)
    .await
    .unwrap();
    let a: i64 = sqlx::query_scalar("SELECT rootpage FROM sqlite_master WHERE name = 'Zz_a'")
        .fetch_one(&mut conn)
        .await
        .unwrap();
    let b: i64 = sqlx::query_scalar("SELECT rootpage FROM sqlite_master WHERE name = 'Zz_b'")
        .fetch_one(&mut conn)
        .await
        .unwrap();
    let swap = format!(
        "PRAGMA writable_schema = ON; \
         UPDATE sqlite_master SET rootpage = CASE name WHEN 'Zz_a' THEN {b} ELSE {a} END WHERE name IN ('Zz_a', 'Zz_b'); \
         PRAGMA writable_schema = OFF;"
    );
    sqlx::raw_sql(sqlx::AssertSqlSafe(swap))
        .execute(&mut conn)
        .await
        .unwrap();
    conn.close().await.unwrap();

    let error = boot::run(&config(dir.path(), &db, &[("AUTODUCK_BACKUP", "0")]))
        .await
        .unwrap_err();
    assert!(
        matches!(error, BootError::Guard(GuardError::Integrity(_))),
        "{error}"
    );
}

#[tokio::test]
async fn garbage_pages_refuse_boot() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("autoduck.db");
    populated_db(&db).await;
    let mut bytes = std::fs::read(&db).unwrap();
    let page = 4096;
    assert!(bytes.len() > page * 6);
    for byte in &mut bytes[page * 3..page * 5] {
        *byte = 0xA5;
    }
    std::fs::write(&db, bytes).unwrap();
    // Depending on which pages were hit, an earlier guard's query or integrity_check fails;
    // either way the boot is refused.
    match boot::run(&config(dir.path(), &db, &[("AUTODUCK_BACKUP", "0")])).await {
        Err(error) => eprintln!("refused: {error}"),
        Ok(booted) => {
            booted.db.close().await;
            panic!("a corrupt database booted");
        }
    }
}

#[tokio::test]
async fn boot_writes_one_backup_then_skips_within_six_hours() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("autoduck.db");
    populated_db(&db).await;
    let cfg = config(dir.path(), &db, &[]);
    boot::run(&cfg).await.unwrap().db.close().await;
    boot::run(&cfg).await.unwrap().db.close().await;
    let backups: Vec<_> = std::fs::read_dir(dir.path().join("backups"))
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(backups.len(), 1, "{backups:?}");
    assert!(backups[0].starts_with("boot-") && backups[0].ends_with(".db"));
}

#[tokio::test]
async fn lock_contention_between_two_processes() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("autoduck.db");
    populated_db(&db).await;

    // Process A boots and holds the lock.
    let (first, _first_log) =
        spawn_serving(&mut autoduck(dir.path(), &db, &[("AUTODUCK_BACKUP", "0")]));

    // Process B gives up after its (shortened) wait and names the holder.
    let output = autoduck(
        dir.path(),
        &db,
        &[("AUTODUCK_LOCK_WAIT_SECS", "2"), ("AUTODUCK_BACKUP", "0")],
    )
    .arg("serve")
    .output()
    .unwrap();
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert_eq!(output.status.code(), Some(1), "{stderr}");
    assert!(
        stderr.contains("still held by another instance"),
        "{stderr}"
    );
    assert!(stderr.contains(&format!("pid={}", first.id())), "{stderr}");

    // Seed refuses while the server holds the lock.
    let output = autoduck(dir.path(), &db, &[]).arg("seed").output().unwrap();
    assert_eq!(output.status.code(), Some(1));

    // After A exits on SIGTERM, process C takes the lock.
    terminate(first);
    let (third, _third_log) =
        spawn_serving(&mut autoduck(dir.path(), &db, &[("AUTODUCK_BACKUP", "0")]));
    terminate(third);
}

#[tokio::test]
async fn library_guards_open_pools_once() {
    // Sanity: run_db_guards can run on already-open pools (used by tests and later by reload).
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("autoduck.db");
    populated_db(&db).await;
    let cfg = config(dir.path(), &db, &[("AUTODUCK_BACKUP", "0")]);
    let pools = Db::open(&db).await.unwrap();
    let report = boot::run_db_guards(&cfg, &pools).await.unwrap();
    assert_eq!(report.rows_changed, 0);
    pools.close().await;
}

#[test]
fn stub_subcommands_exit_2() {
    let dir = tempfile::tempdir().unwrap();
    for args in [
        &["migrate"][..],
        &["diff-since"],
        &["verify-races"],
        &["backfill-track"],
        &["backfill-stats"],
        &["sim", "gacha"],
    ] {
        let output = autoduck(dir.path(), &dir.path().join("x.db"), &[])
            .args(args)
            .output()
            .unwrap();
        assert_eq!(output.status.code(), Some(2), "{args:?}");
    }
}

/// Review 2, finding 7: a binary built with `test-rng` never serves outside dev.
#[cfg(feature = "test-rng")]
#[tokio::test]
async fn test_rng_build_refuses_production() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("autoduck.db");
    populated_db(&db).await;
    let output = autoduck(dir.path(), &db, &[("AUTODUCK_ENV", "production")])
        .arg("serve")
        .output()
        .unwrap();
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert_eq!(output.status.code(), Some(1), "{stderr}");
    assert!(stderr.contains("`test-rng` feature"), "{stderr}");
}
