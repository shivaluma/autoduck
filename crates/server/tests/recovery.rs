//! Crash recovery (D22): only engine ≥ 2 pending/running races are touched; TS-era rows,
//! including dev.db's `failed/FINISHED/1.2.0` races 38–40, are never modified.

mod common;

use autoduck_server::boot::recovery::{self, RecoveryReport};
use autoduck_server::db::{Db, DbTime};
use common::{create_db, mark_all_migrations};
use sqlx::Connection;

async fn insert_race(
    conn: &mut sqlx::SqliteConnection,
    id: i64,
    status: &str,
    engine_state: &str,
    engine_version: Option<&str>,
    is_test: bool,
) {
    sqlx::query(
        r#"INSERT INTO "Race" ("id", "status", "engineState", "engineVersion", "isTest", "createdAt")
           VALUES (?, ?, ?, ?, ?, ?)"#,
    )
    .bind(id)
    .bind(status)
    .bind(engine_state)
    .bind(engine_version)
    .bind(is_test)
    .bind(DbTime::parse("2026-11-09T01:00:00.000Z").unwrap())
    .execute(&mut *conn)
    .await
    .unwrap();
}

async fn insert_week(
    conn: &mut sqlx::SqliteConnection,
    id: i64,
    status: &str,
    race_id: Option<i64>,
) {
    let at = DbTime::parse("2026-11-02T01:00:00.000Z").unwrap();
    sqlx::query(
        r#"INSERT INTO "SeasonWeek" ("id", "seasonId", "weekNumber", "status", "chaosType", "raceId",
             "chaosRevealedAt", "createdAt", "updatedAt")
           VALUES (?, 1, ?, ?, 'NONE', ?, ?, ?, ?)"#,
    )
    .bind(id)
    .bind(id)
    .bind(status)
    .bind(race_id)
    .bind(at)
    .bind(at)
    .bind(at)
    .execute(&mut *conn)
    .await
    .unwrap();
}

#[tokio::test]
async fn only_engine_two_races_are_recovered() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("autoduck.db");
    let mut conn = create_db(&path).await;
    mark_all_migrations(&mut conn).await;
    sqlx::query(r#"INSERT INTO "Season" ("id", "key", "name", "year", "createdAt") VALUES (1, 's3', 'S3', 2026, '2026-08-13T00:00:00.000+00:00')"#)
        .execute(&mut conn)
        .await
        .unwrap();

    // dev.db races 38–40: TS left engineState FINISHED on failed races.
    for id in 38..=40 {
        insert_race(&mut conn, id, "failed", "FINISHED", Some("1.2.0"), true).await;
    }
    // TS-era rows stuck mid-race: logged, never modified.
    insert_race(&mut conn, 41, "running", "RACING", Some("1.2.0"), false).await;
    insert_race(&mut conn, 42, "pending", "LOCKED", None, false).await;
    insert_race(&mut conn, 43, "running", "RACING", Some("10"), false).await; // no dot: not ≥ 2 by the D22 rule
    // Engine 2 races.
    insert_race(&mut conn, 50, "running", "RACING", Some("2.0.0"), false).await; // official, week racing
    insert_race(&mut conn, 51, "pending", "COUNTDOWN", Some("2.1.3"), true).await; // test race
    insert_race(&mut conn, 52, "running", "FINISHED", Some("2.0.0"), false).await; // T1 done
    insert_race(&mut conn, 53, "finished", "RESOLVED", Some("2.0.0"), false).await; // done
    insert_race(&mut conn, 54, "pending", "LOCKED", Some("12.0.0"), false).await; // week moved on
    insert_race(&mut conn, 55, "pending", "PREPARING", Some("2.0.0"), false).await; // unexpected
    insert_week(&mut conn, 1, "racing", Some(50)).await;
    insert_week(&mut conn, 2, "racing", Some(52)).await;
    insert_week(&mut conn, 3, "racing", Some(41)).await;
    insert_week(&mut conn, 4, "open", None).await;
    conn.close().await.unwrap();

    let db = Db::open(&path).await.unwrap();
    let report = recovery::recover(&db).await.unwrap();
    assert_eq!(
        report,
        RecoveryReport {
            failed: vec![50, 51, 54],
            weeks_unlocked: vec![50],
            awaiting_t2: vec![52],
            unexpected: vec![(55, "PREPARING".to_owned())],
            ts_era_stuck: vec![41, 42, 43],
            rows_changed: 4,
        }
    );

    let races: Vec<(i64, String, String)> =
        sqlx::query_as(r#"SELECT "id", "status", "engineState" FROM "Race" ORDER BY "id""#)
            .fetch_all(&db.reader)
            .await
            .unwrap();
    let status = |id: i64| {
        races
            .iter()
            .find(|r| r.0 == id)
            .map(|r| (r.1.as_str(), r.2.as_str()))
            .unwrap()
    };
    for id in 38..=40 {
        assert_eq!(status(id), ("failed", "FINISHED"));
    }
    assert_eq!(status(41), ("running", "RACING"));
    assert_eq!(status(42), ("pending", "LOCKED"));
    assert_eq!(status(50), ("failed", "RACING"));
    assert_eq!(status(51), ("failed", "COUNTDOWN"));
    assert_eq!(status(52), ("running", "FINISHED"));
    assert_eq!(status(53), ("finished", "RESOLVED"));

    let weeks: Vec<(i64, String, Option<i64>, String)> = sqlx::query_as(
        r#"SELECT "id", "status", "raceId", "updatedAt" FROM "SeasonWeek" ORDER BY "id""#,
    )
    .fetch_all(&db.reader)
    .await
    .unwrap();
    assert_eq!((weeks[0].1.as_str(), weeks[0].2), ("locked", None));
    assert!(
        weeks[0].3.ends_with("+00:00") && weeks[0].3.contains('T'),
        "updatedAt {}",
        weeks[0].3
    );
    assert_eq!((weeks[1].1.as_str(), weeks[1].2), ("racing", Some(52)));
    assert_eq!((weeks[2].1.as_str(), weeks[2].2), ("racing", Some(41)));
    assert_eq!(weeks[1].3, "2026-11-02T01:00:00.000+00:00");

    // A second boot changes nothing.
    let again = recovery::recover(&db).await.unwrap();
    assert_eq!(again.rows_changed, 0);
    assert!(again.failed.is_empty());
    db.close().await;
}
