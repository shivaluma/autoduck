//! Crash recovery (D22): runs once at boot, before HTTP binds.
//!
//! Only `Race` rows with `status IN ('pending','running')` **and** engine major ≥ 2 are touched,
//! selected with exactly the plan's SQL rule. TS-era rows are listed in the log and never
//! modified: `dev.db` already holds `status=failed, engineState=FINISHED` races 38–40 (TS leaves
//! `engineState` as it was), and selecting on `engineState` alone would reopen resolved weeks or
//! apply meta twice.
//!
//! - `LOCKED`/`COUNTDOWN`/`RACING`: `status='failed'`. The week goes back to `locked/raceId NULL`
//!   only if it is still `racing` on this race. Test races never touch weeks.
//! - `FINISHED` (T1 committed): T2 runs from the DB only ([`crate::live::resolve_finished_race`]),
//!   guarded by `UPDATE … SET "engineState"='RESOLVED' WHERE … AND "engineState"='FINISHED'` in
//!   the same transaction as the meta writes, so meta is never applied twice. A race the meta
//!   refuses is marked failed (its week back to `locked`), as the live path does; a DB error
//!   leaves it in `FINISHED` for the next boot.
//! - Any other state: reported, left unchanged.

use crate::db::{Db, DbTime};

#[derive(Debug, Default, PartialEq, Eq)]
pub struct RecoveryReport {
    /// Engine ≥ 2 races marked failed.
    pub failed: Vec<i64>,
    /// Weeks returned to `locked`.
    pub weeks_unlocked: Vec<i64>,
    /// Engine ≥ 2 races in FINISHED whose T2 ran now.
    pub resolved: Vec<i64>,
    /// Engine ≥ 2 races in FINISHED whose T2 failed (refused: marked failed; DB error: left
    /// unchanged for the next boot).
    pub awaiting_t2: Vec<i64>,
    /// Engine ≥ 2 races in a state recovery doesn't handle (left unchanged).
    pub unexpected: Vec<(i64, String)>,
    /// TS-era (engine < 2 or unknown) pending/running rows: logged, never modified.
    pub ts_era_stuck: Vec<i64>,
    /// Total rows changed.
    pub rows_changed: u64,
}

struct Candidate {
    id: i64,
    engine_state: String,
    is_test: bool,
}

/// Read-only preview for `autoduck verify-db`: `(engine ≥ 2 candidates with their state,
/// TS-era stuck ids)`.
pub async fn dry_run(
    conn: &mut sqlx::SqliteConnection,
) -> Result<(Vec<(i64, String)>, Vec<i64>), sqlx::Error> {
    let candidates: Vec<(i64, String)> = sqlx::query_as(
        r#"SELECT "id", "engineState" FROM "Race"
           WHERE "status" IN ('pending', 'running')
             AND CAST(substr("engineVersion", 1, instr("engineVersion", '.') - 1) AS INT) >= 2
           ORDER BY "id""#,
    )
    .fetch_all(&mut *conn)
    .await?;
    let stuck: Vec<i64> = sqlx::query_scalar(
        r#"SELECT "id" FROM "Race"
           WHERE "status" IN ('pending', 'running')
             AND NOT COALESCE(CAST(substr("engineVersion", 1, instr("engineVersion", '.') - 1) AS INT) >= 2, 0)
           ORDER BY "id""#,
    )
    .fetch_all(&mut *conn)
    .await?;
    Ok((candidates, stuck))
}

pub async fn recover(db: &Db) -> Result<RecoveryReport, sqlx::Error> {
    let mut report = RecoveryReport::default();

    let stuck = sqlx::query!(
        r#"SELECT "id" AS "id!: i64", "status" AS "status!", "engineState" AS "engineState!", "engineVersion"
           FROM "Race"
           WHERE "status" IN ('pending', 'running')
             AND NOT COALESCE(CAST(substr("engineVersion", 1, instr("engineVersion", '.') - 1) AS INT) >= 2, 0)
           ORDER BY "id""#
    )
    .fetch_all(&db.reader)
    .await?;
    for row in stuck {
        tracing::warn!(
            race = row.id,
            status = %row.status,
            engine_state = %row.engineState,
            engine_version = row.engineVersion.as_deref().unwrap_or("<null>"),
            "TS-era race is still pending/running; left unchanged (D22)"
        );
        report.ts_era_stuck.push(row.id);
    }

    let candidates: Vec<Candidate> = sqlx::query!(
        r#"SELECT "id" AS "id!: i64", "engineState" AS "engineState!", "isTest" AS "isTest!: bool"
           FROM "Race"
           WHERE "status" IN ('pending', 'running')
             AND CAST(substr("engineVersion", 1, instr("engineVersion", '.') - 1) AS INT) >= 2
           ORDER BY "id""#
    )
    .fetch_all(&db.reader)
    .await?
    .into_iter()
    .map(|row| Candidate {
        id: row.id,
        engine_state: row.engineState,
        is_test: row.isTest,
    })
    .collect();

    for race in candidates {
        match race.engine_state.as_str() {
            "LOCKED" | "COUNTDOWN" | "RACING" => {
                let now = DbTime::now();
                let mut tx = db.begin_write().await?;
                let failed = sqlx::query!(
                    r#"UPDATE "Race" SET "status" = 'failed'
                       WHERE "id" = ? AND "status" IN ('pending', 'running') AND "engineState" = ?"#,
                    race.id,
                    race.engine_state
                )
                .execute(&mut *tx)
                .await?
                .rows_affected();
                let mut unlocked = 0;
                if failed == 1 && !race.is_test {
                    unlocked = sqlx::query!(
                        r#"UPDATE "SeasonWeek" SET "status" = 'locked', "raceId" = NULL, "updatedAt" = ?
                           WHERE "status" = 'racing' AND "raceId" = ?"#,
                        now,
                        race.id
                    )
                    .execute(&mut *tx)
                    .await?
                    .rows_affected();
                }
                tx.commit().await?;
                report.rows_changed += failed + unlocked;
                if failed == 1 {
                    tracing::error!(
                        race = race.id,
                        engine_state = %race.engine_state,
                        week_unlocked = unlocked == 1,
                        "race was interrupted by a restart before T1; marked failed (D22)"
                    );
                    report.failed.push(race.id);
                    if unlocked == 1 {
                        report.weeks_unlocked.push(race.id);
                    }
                }
            }
            "FINISHED" => {
                match crate::live::race::recover_finished(db, race.id, race.is_test).await {
                    Ok(crate::live::T2Outcome::Resolved { .. }) => {
                        tracing::warn!(
                            race = race.id,
                            "race committed T1 before a restart; T2 resumed from the DB (D22)"
                        );
                        report.rows_changed += 1;
                        report.resolved.push(race.id);
                    }
                    Ok(crate::live::T2Outcome::NotFinished { engine_state }) => {
                        report.unexpected.push((race.id, engine_state));
                    }
                    Err(error) => {
                        tracing::error!(race = race.id, %error, "T2 resume failed");
                        report.awaiting_t2.push(race.id);
                    }
                }
            }
            other => {
                tracing::warn!(
                    race = race.id,
                    engine_state = other,
                    "pending/running race in an unexpected state; left unchanged"
                );
                report.unexpected.push((race.id, other.to_owned()));
            }
        }
    }

    tracing::info!(
        failed = report.failed.len(),
        resolved = report.resolved.len(),
        awaiting_t2 = report.awaiting_t2.len(),
        ts_era_stuck = report.ts_era_stuck.len(),
        rows_changed = report.rows_changed,
        "crash recovery done"
    );
    Ok(report)
}
