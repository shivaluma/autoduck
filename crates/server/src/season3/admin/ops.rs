//! `GET /api/admin/season3?report=ops`: the read-only ops report (ids, states and versions; no
//! names or tokens), including the replay-track gate of plan step 0.4 / §4.5
//! (`docs/replay-tracks.md`): finished engine races without a `RaceReplayTrack` row. The gate
//! must be empty before cutover, before deleting the TS engine and before every engine or
//! balance bump.

use serde::Serialize;
use sqlx::{FromRow, SqliteConnection};

use crate::db::DbTime;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpsReport {
    report: &'static str,
    generated_at: String,
    in_flight_races: Vec<InFlightRace>,
    race_counts: Vec<RaceCount>,
    replay_track_gate: ReplayTrackGate,
    replay_track_fidelity: Vec<FidelityCount>,
}

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
#[sqlx(rename_all = "camelCase")]
struct InFlightRace {
    id: i64,
    status: String,
    engine_state: String,
    engine_version: Option<String>,
    balance_version: Option<String>,
    created_at: DbTime,
}

#[derive(FromRow)]
#[sqlx(rename_all = "camelCase")]
struct RaceCountRow {
    count: i64,
    is_test: bool,
    status: String,
    engine_version: Option<String>,
    balance_version: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RaceCount {
    is_test: bool,
    status: String,
    engine_version: Option<String>,
    balance_version: Option<String>,
    count: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReplayTrackGate {
    missing_count: usize,
    missing: Vec<MissingTrack>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MissingTrack {
    race_id: i64,
    balance_version: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FidelityCount {
    fidelity: String,
    balance_version: Option<String>,
    is_test: bool,
    count: i64,
}

/// `OPS_IN_FLIGHT_STATUSES`.
const IN_FLIGHT_STATUSES: [&str; 3] = ["pending", "running", "failed"];

/// Builds the report with the same queries as TS (Prisma's `findMany`/`groupBy` SQL and the two
/// raw gate queries verbatim).
///
/// # Errors
/// A DB error (for example a DB without `RaceReplayTrack`, which the boot verifier refuses).
pub async fn load(conn: &mut SqliteConnection) -> Result<OpsReport, sqlx::Error> {
    let in_flight_races: Vec<InFlightRace> = sqlx::query_as(
        r#"SELECT "Race"."id", "Race"."status", "Race"."engineState", "Race"."engineVersion", "Race"."balanceVersion", "Race"."createdAt" FROM "Race" WHERE "Race"."status" IN (?,?,?) ORDER BY "Race"."id" ASC LIMIT ? OFFSET ?"#,
    )
    .bind(IN_FLIGHT_STATUSES[0])
    .bind(IN_FLIGHT_STATUSES[1])
    .bind(IN_FLIGHT_STATUSES[2])
    .bind(-1_i64)
    .bind(0_i64)
    .fetch_all(&mut *conn)
    .await?;

    let groups: Vec<RaceCountRow> = sqlx::query_as(
        r#"SELECT COUNT(*) AS "count", "Race"."isTest", "Race"."status", "Race"."engineVersion", "Race"."balanceVersion" FROM "Race" WHERE 1=1 GROUP BY "Race"."isTest", "Race"."status", "Race"."engineVersion", "Race"."balanceVersion" ORDER BY "Race"."isTest" ASC, "Race"."status" ASC, "Race"."engineVersion" ASC, "Race"."balanceVersion" ASC LIMIT ? OFFSET ?"#,
    )
    .bind(-1_i64)
    .bind(0_i64)
    .fetch_all(&mut *conn)
    .await?;

    let missing: Vec<(i64, Option<String>)> = sqlx::query_as(
        r#"SELECT r.id AS id, r."balanceVersion" AS balanceVersion FROM "Race" r LEFT JOIN "RaceReplayTrack" t ON t."raceId" = r.id
      WHERE r."engineConfigJson" IS NOT NULL AND r.status = 'finished' AND t."raceId" IS NULL ORDER BY r.id"#,
    )
    .fetch_all(&mut *conn)
    .await?;

    let fidelity: Vec<(String, Option<String>, i64, i64)> = sqlx::query_as(
        r#"SELECT t.fidelity AS fidelity, r."balanceVersion" AS balanceVersion, r."isTest" AS isTest, COUNT(*) AS n FROM "RaceReplayTrack" t
      JOIN "Race" r ON r.id = t."raceId" GROUP BY 1, 2, 3 ORDER BY 1, 2, 3"#,
    )
    .fetch_all(&mut *conn)
    .await?;

    Ok(OpsReport {
        report: "ops",
        generated_at: DbTime::now().to_iso_string(),
        in_flight_races,
        race_counts: groups
            .into_iter()
            .map(|group| RaceCount {
                is_test: group.is_test,
                status: group.status,
                engine_version: group.engine_version,
                balance_version: group.balance_version,
                count: group.count,
            })
            .collect(),
        replay_track_gate: ReplayTrackGate {
            missing_count: missing.len(),
            missing: missing
                .into_iter()
                .map(|(race_id, balance_version)| MissingTrack {
                    race_id,
                    balance_version,
                })
                .collect(),
        },
        replay_track_fidelity: fidelity
            .into_iter()
            .map(
                |(fidelity, balance_version, is_test, count)| FidelityCount {
                    fidelity,
                    balance_version,
                    // `Boolean(Number(row.isTest))`.
                    is_test: is_test != 0,
                    count,
                },
            )
            .collect(),
    })
}
