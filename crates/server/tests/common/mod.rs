//! Shared helpers for the integration tests.
#![allow(dead_code)]

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use autoduck_server::Config;
use autoduck_server::db::migrations::required_ts_migrations;
use autoduck_server::db::{BASELINE_SQL, DbTime};
use sha2::{Digest, Sha256};
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{Connection, SqliteConnection};

/// Env var naming a dev.db **copy** (never the original) for the dev.db calibration tests.
/// Unset → those tests print a note and pass without checking.
pub const DEV_DB_ENV: &str = "AUTODUCK_TEST_DEV_DB";

pub async fn create_db(path: &Path) -> SqliteConnection {
    let mut conn = SqliteConnection::connect_with(
        &SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true),
    )
    .await
    .unwrap();
    sqlx::raw_sql(BASELINE_SQL)
        .execute(&mut conn)
        .await
        .unwrap();
    conn
}

/// A baseline-schema DB with every required TS migration id, one user and one season player.
pub async fn populated_db(path: &Path) {
    let mut conn = create_db(path).await;
    mark_all_migrations(&mut conn).await;
    let now = DbTime::now();
    sqlx::query(
        r#"INSERT INTO "User" ("id", "name", "createdAt", "updatedAt") VALUES (1, 'Zịt Test', ?, ?)"#,
    )
    .bind(now)
    .bind(now)
    .execute(&mut conn)
    .await
    .unwrap();
    sqlx::query(r#"INSERT INTO "Season" ("id", "key", "name", "year", "createdAt") VALUES (1, 's3', 'Season 3', 2026, ?)"#)
        .bind(now)
        .execute(&mut conn)
        .await
        .unwrap();
    sqlx::query(
        r#"INSERT INTO "SeasonPlayer" ("id", "seasonId", "userId", "accessToken", "createdAt", "updatedAt")
           VALUES (1, 1, 1, 'token-1', ?, ?)"#,
    )
    .bind(now)
    .bind(now)
    .execute(&mut conn)
    .await
    .unwrap();
    conn.close().await.unwrap();
}

pub async fn mark_all_migrations(conn: &mut SqliteConnection) {
    for id in required_ts_migrations() {
        sqlx::query(r#"INSERT INTO "AppMigration" ("id", "name", "runAt") VALUES (?, 'test', CURRENT_TIMESTAMP)"#)
            .bind(id)
            .execute(&mut *conn)
            .await
            .unwrap();
    }
}

pub fn config(dir: &Path, db: &Path, extra: &[(&str, &str)]) -> Config {
    let mut vars: BTreeMap<String, String> = BTreeMap::new();
    vars.insert("DATABASE_URL".into(), format!("file:{}", db.display()));
    vars.insert(
        "AUTODUCK_LOCK_PATH".into(),
        dir.join("autoduck.lock").display().to_string(),
    );
    vars.insert(
        "AUTODUCK_BACKUP_DIR".into(),
        dir.join("backups").display().to_string(),
    );
    vars.insert(
        "AUTODUCK_DIST_DIR".into(),
        dir.join("dist").display().to_string(),
    );
    for (key, value) in extra {
        vars.insert((*key).into(), (*value).into());
    }
    Config::from_lookup(|name| vars.get(name).cloned()).unwrap()
}

pub fn sha256_file(path: &Path) -> String {
    let bytes = std::fs::read(path).unwrap();
    Sha256::digest(&bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Copies the dev.db copy named by [`DEV_DB_ENV`] into `dir` with `VACUUM INTO` from a
/// read-only connection (the source is never written). `None` when the env var is unset.
pub async fn dev_db_copy(dir: &Path) -> Option<PathBuf> {
    let Ok(source) = std::env::var(DEV_DB_ENV) else {
        eprintln!("{DEV_DB_ENV} not set; skipping the dev.db calibration check");
        return None;
    };
    let target = dir.join("dev-copy.db");
    let mut conn = SqliteConnection::connect_with(
        &SqliteConnectOptions::new()
            .filename(&source)
            .read_only(true),
    )
    .await
    .unwrap();
    sqlx::query("VACUUM INTO ?")
        .bind(target.to_str().unwrap())
        .execute(&mut conn)
        .await
        .unwrap();
    conn.close().await.unwrap();
    Some(target)
}
