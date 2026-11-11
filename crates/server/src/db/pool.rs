//! Connection pools (D15).
//!
//! - **Writer:** one connection. Every write transaction starts with `BEGIN IMMEDIATE`
//!   ([`Db::begin_write`]), so a writer never upgrades a read lock and deadlocks on
//!   `SQLITE_BUSY`.
//! - **Reader:** up to 8 `read_only` connections, so an accidental write fails loudly.
//!   No reader transaction may stay open across an `.await` that waits on the network.
//! - Pragmas are explicit on every connection: `journal_mode`, `foreign_keys=ON`,
//!   `busy_timeout=5s`, `synchronous=FULL`, no `optimize_on_close`. The journal mode is the one
//!   the file already has ([`file_journal_mode`]): `DELETE` until the point of no return, `WAL`
//!   once the owned-schema migration `rs-0011-wal-journal` switched it ([`crate::db::owned`]).
//!   Opening the pools never changes the mode, so a CLI command (`backup`, `seed`) can't flip a
//!   WAL database back to `DELETE` or the reverse.
//!   The file is never created (`create_if_missing(false)`).

use std::path::{Path, PathBuf};
use std::time::Duration;

use sqlx::sqlite::{
    Sqlite, SqliteConnectOptions, SqliteJournalMode, SqlitePool, SqlitePoolOptions,
    SqliteSynchronous,
};
use sqlx::{Connection, SqliteConnection, Transaction};

pub const BUSY_TIMEOUT: Duration = Duration::from_secs(5);
pub const READER_CONNECTIONS: u32 = 8;

#[derive(Clone, Debug)]
pub struct Db {
    pub writer: SqlitePool,
    pub reader: SqlitePool,
    pub path: PathBuf,
    /// The journal mode every pooled connection sets explicitly.
    pub journal: SqliteJournalMode,
}

/// The options every connection shares. `read_only` is the only difference between pools.
pub fn connect_options(
    path: &Path,
    read_only: bool,
    journal: SqliteJournalMode,
) -> SqliteConnectOptions {
    base_options(path, read_only)
        .journal_mode(journal)
        .foreign_keys(true)
        .busy_timeout(BUSY_TIMEOUT)
        .synchronous(SqliteSynchronous::Full)
}

/// No pragmas beyond sqlx's `foreign_keys=ON`; in particular no `journal_mode`, so the file's
/// own mode is left alone.
fn base_options(path: &Path, read_only: bool) -> SqliteConnectOptions {
    SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(false)
        .read_only(read_only)
        .busy_timeout(BUSY_TIMEOUT)
}

/// The journal mode stored in the file: `Wal` for a WAL database, `Delete` otherwise (SQLite
/// persists only WAL; every other mode reads back as the connection default, `delete`). Uses a
/// read-write connection that sets no `journal_mode`, so it changes nothing (a hot rollback
/// journal is rolled back, as the writer pool would do anyway).
pub async fn file_journal_mode(path: &Path) -> Result<SqliteJournalMode, sqlx::Error> {
    let mut conn = SqliteConnection::connect_with(&base_options(path, false)).await?;
    let mode: String = sqlx::query_scalar("PRAGMA journal_mode")
        .fetch_one(&mut conn)
        .await?;
    conn.close().await?;
    Ok(if mode.eq_ignore_ascii_case("wal") {
        SqliteJournalMode::Wal
    } else {
        SqliteJournalMode::Delete
    })
}

impl Db {
    /// Opens both pools with the file's own journal mode ([`file_journal_mode`]). Fails if the
    /// file doesn't exist; the caller has already checked, this is the second guard.
    pub async fn open(path: &Path) -> Result<Self, sqlx::Error> {
        let journal = file_journal_mode(path).await?;
        Self::open_with(path, journal).await
    }

    /// Opens both pools with an explicit journal mode.
    pub async fn open_with(path: &Path, journal: SqliteJournalMode) -> Result<Self, sqlx::Error> {
        let writer = SqlitePoolOptions::new()
            .min_connections(0)
            .max_connections(1)
            .acquire_timeout(Duration::from_secs(30))
            .connect_with(connect_options(path, false, journal))
            .await?;
        let reader = SqlitePoolOptions::new()
            .min_connections(0)
            .max_connections(READER_CONNECTIONS)
            .acquire_timeout(Duration::from_secs(30))
            .connect_with(connect_options(path, true, journal))
            .await?;
        Ok(Db {
            writer,
            reader,
            path: path.to_path_buf(),
            journal,
        })
    }

    /// Starts a write transaction with `BEGIN IMMEDIATE` on the single writer connection.
    pub async fn begin_write(&self) -> Result<Transaction<'static, Sqlite>, sqlx::Error> {
        self.writer.begin_with("BEGIN IMMEDIATE").await
    }

    pub async fn close(&self) {
        self.writer.close().await;
        self.reader.close().await;
    }
}

/// A one-off read-only connection for CLI checks (`verify-db`, `check-schema`) that must not
/// touch the file. It sets no `journal_mode` (a read-only connection can't change it), so it
/// works on `DELETE` and `WAL` files alike.
pub async fn connect_read_only(path: &Path) -> Result<SqliteConnection, sqlx::Error> {
    SqliteConnection::connect_with(&base_options(path, true).synchronous(SqliteSynchronous::Full))
        .await
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn temp_db() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.db");
        let mut conn = SqliteConnection::connect_with(
            &SqliteConnectOptions::new()
                .filename(&path)
                .create_if_missing(true),
        )
        .await
        .unwrap();
        sqlx::raw_sql(r#"CREATE TABLE "T" ("id" INTEGER PRIMARY KEY, "v" TEXT)"#)
            .execute(&mut conn)
            .await
            .unwrap();
        conn.close().await.unwrap();
        (dir, path)
    }

    #[tokio::test]
    async fn pragmas_are_explicit() {
        let (_dir, path) = temp_db().await;
        let db = Db::open(&path).await.unwrap();
        for pool in [&db.writer, &db.reader] {
            let journal: String = sqlx::query_scalar("PRAGMA journal_mode")
                .fetch_one(pool)
                .await
                .unwrap();
            let fk: i64 = sqlx::query_scalar("PRAGMA foreign_keys")
                .fetch_one(pool)
                .await
                .unwrap();
            let busy: i64 = sqlx::query_scalar("PRAGMA busy_timeout")
                .fetch_one(pool)
                .await
                .unwrap();
            let sync: i64 = sqlx::query_scalar("PRAGMA synchronous")
                .fetch_one(pool)
                .await
                .unwrap();
            assert_eq!((journal.as_str(), fk, busy, sync), ("delete", 1, 5000, 2));
        }
        assert_eq!(db.writer.options().get_max_connections(), 1);
        assert_eq!(
            db.reader.options().get_max_connections(),
            READER_CONNECTIONS
        );
        db.close().await;
    }

    #[tokio::test]
    async fn reader_refuses_writes_and_writer_begins_immediate() {
        let (_dir, path) = temp_db().await;
        let db = Db::open(&path).await.unwrap();
        let denied = sqlx::query(r#"INSERT INTO "T" ("v") VALUES ('x')"#)
            .execute(&db.reader)
            .await;
        assert!(denied.is_err(), "reader pool accepted a write");

        let mut tx = db.begin_write().await.unwrap();
        sqlx::query(r#"INSERT INTO "T" ("v") VALUES ('y')"#)
            .execute(&mut *tx)
            .await
            .unwrap();
        // BEGIN IMMEDIATE holds the RESERVED lock: a second writer can't start until commit.
        let mut other = SqliteConnection::connect_with(
            &connect_options(&path, false, SqliteJournalMode::Delete)
                .busy_timeout(Duration::from_millis(50)),
        )
        .await
        .unwrap();
        assert!(
            sqlx::query("BEGIN IMMEDIATE")
                .execute(&mut other)
                .await
                .is_err()
        );
        tx.commit().await.unwrap();
        let count: i64 = sqlx::query_scalar(r#"SELECT COUNT(*) FROM "T""#)
            .fetch_one(&db.reader)
            .await
            .unwrap();
        assert_eq!(count, 1);
        db.close().await;
    }

    #[tokio::test]
    async fn open_keeps_the_file_journal_mode() {
        let (_dir, path) = temp_db().await;
        assert_eq!(
            file_journal_mode(&path).await.unwrap(),
            SqliteJournalMode::Delete
        );
        // Switch the file to WAL with the writer while the reader pool has an idle connection
        // (the owned-schema migration does exactly this), then reopen.
        let db = Db::open(&path).await.unwrap();
        sqlx::query("SELECT 1").execute(&db.reader).await.unwrap();
        let mode: String = sqlx::query_scalar("PRAGMA journal_mode = WAL")
            .fetch_one(&db.writer)
            .await
            .unwrap();
        assert_eq!(mode, "wal");
        // The idle reader follows the file.
        let count: i64 = sqlx::query_scalar(r#"SELECT COUNT(*) FROM "T""#)
            .fetch_one(&db.reader)
            .await
            .unwrap();
        assert_eq!(count, 0);
        db.close().await;

        assert_eq!(
            file_journal_mode(&path).await.unwrap(),
            SqliteJournalMode::Wal
        );
        let db = Db::open(&path).await.unwrap();
        assert_eq!(db.journal, SqliteJournalMode::Wal);
        sqlx::query(r#"INSERT INTO "T" ("v") VALUES ('w')"#)
            .execute(&db.writer)
            .await
            .unwrap();
        for pool in [&db.writer, &db.reader] {
            let journal: String = sqlx::query_scalar("PRAGMA journal_mode")
                .fetch_one(pool)
                .await
                .unwrap();
            assert_eq!(journal, "wal");
            let count: i64 = sqlx::query_scalar(r#"SELECT COUNT(*) FROM "T""#)
                .fetch_one(pool)
                .await
                .unwrap();
            assert_eq!(count, 1);
        }
        db.close().await;
        // Read-only checks work on a WAL file too.
        let mut conn = connect_read_only(&path).await.unwrap();
        let count: i64 = sqlx::query_scalar(r#"SELECT COUNT(*) FROM "T""#)
            .fetch_one(&mut conn)
            .await
            .unwrap();
        assert_eq!(count, 1);
        conn.close().await.unwrap();
        assert_eq!(
            file_journal_mode(&path).await.unwrap(),
            SqliteJournalMode::Wal
        );
    }

    #[tokio::test]
    async fn missing_file_is_never_created() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("absent.db");
        assert!(Db::open(&path).await.is_err());
        assert!(!path.exists());
    }
}
