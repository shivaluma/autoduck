//! `GET /api/admin/season3` (without `?report=ops`): the admin dashboard of the active season.
//!
//! Port of the GET handler in `app/api/admin/season3/route.ts`: the season, its players (by
//! name), every week with its readiness lists, the rewards, and the balance telemetry summary
//! over the season's races.

use std::collections::HashMap;

use serde::Serialize;
use serde_json::value::RawValue;
use sqlx::SqliteConnection;

use super::js::JsNum;
use super::rows::{
    ITEM_TELEMETRY_COLUMNS, ItemTelemetryDbRow, LOADOUT_COLUMNS, PICKUP_TELEMETRY_COLUMNS,
    PREDICTION_COLUMNS, PickupTelemetryDbRow, REWARD_COLUMNS, RaceStatusRow, SHIELD_CHOICE_COLUMNS,
    SeasonLoadoutRow, SeasonPredictionRow, SeasonRewardRow, SeasonShieldChoiceRow, SeasonWeekRow,
    UserSummaryRow, WEEK_COLUMNS, active_season_latest, fetch_in, unique_ids,
};
use crate::cosmetics::js::{encode_uri_component, stringify};
use crate::cosmetics::rows::{SEASON_PLAYER_COLUMNS, SeasonPlayerRow, USER_COLUMNS, UserRow};
use crate::season3::balance::{
    ItemTelemetryRow, PickupSummary, PickupTelemetryRow, TelemetrySummary, balance_summary,
};
use crate::season3::payload::{
    parse_chaos_groups_strict, parse_skipped_player_ids, skipped_contains,
};

#[derive(Serialize)]
#[serde(untagged)]
pub enum Dashboard {
    Empty { season: Option<()> },
    Season(Box<SeasonDashboard>),
}

#[derive(Serialize)]
pub struct SeasonDashboard {
    season: SeasonSummary,
    players: Vec<PlayerSummary>,
    weeks: Vec<WeekSummary>,
    rewards: Vec<SeasonRewardRow>,
    balance: Balance,
}

#[derive(Serialize)]
struct SeasonSummary {
    id: i64,
    key: String,
    name: String,
    year: i64,
    weeks: i64,
    status: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PlayerSummary {
    id: i64,
    name: String,
    avatar_url: Option<String>,
    personal_link: String,
    scars: i64,
    shields: i64,
    prediction_points: i64,
    is_king: bool,
    king_streak: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WeekSummary {
    id: i64,
    week_number: i64,
    status: String,
    chaos_type: String,
    chaos_target_user_id: Option<i64>,
    chaos_target_user_id2: Option<i64>,
    /// `undefined` (key omitted) unless the payload is an array of arrays.
    #[serde(skip_serializing_if = "Option::is_none")]
    chaos_groups: Option<Box<RawValue>>,
    skipped_player_ids: Vec<JsNum>,
    prediction_count: usize,
    loadout_ready_count: usize,
    loadout_ready_user_ids: Vec<i64>,
    prediction_user_ids: Vec<i64>,
    missing_loadout_user_ids: Vec<i64>,
    missing_prediction_user_ids: Vec<i64>,
    missing_loadout_names: Vec<String>,
    missing_prediction_names: Vec<String>,
    fully_ready_user_ids: Vec<i64>,
    shield_confirmations: Vec<String>,
    recap: Option<String>,
    race_id: Option<i64>,
    race_status: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TelemetryEntry {
    name: String,
    picks: JsNum,
    win_rate: JsNum,
    bottom2_rate: JsNum,
    average_finish: JsNum,
    average_rank_delta: JsNum,
    activation_rate: JsNum,
    success_rate: JsNum,
}

impl From<TelemetrySummary> for TelemetryEntry {
    fn from(summary: TelemetrySummary) -> Self {
        Self {
            name: summary.name,
            picks: JsNum(summary.picks),
            win_rate: JsNum(summary.win_rate),
            bottom2_rate: JsNum(summary.bottom2_rate),
            average_finish: JsNum(summary.average_finish),
            average_rank_delta: JsNum(summary.average_rank_delta),
            activation_rate: JsNum(summary.activation_rate),
            success_rate: JsNum(summary.success_rate),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PickupEntry {
    name: String,
    picks: JsNum,
    activation_rate: JsNum,
    hit_rate: JsNum,
    manual_rate: JsNum,
    auto_rate: JsNum,
    average_rank_delta: JsNum,
}

impl From<PickupSummary> for PickupEntry {
    fn from(summary: PickupSummary) -> Self {
        Self {
            name: summary.name,
            picks: JsNum(summary.picks),
            activation_rate: JsNum(summary.activation_rate),
            hit_rate: JsNum(summary.hit_rate),
            manual_rate: JsNum(summary.manual_rate),
            auto_rate: JsNum(summary.auto_rate),
            average_rank_delta: JsNum(summary.average_rank_delta),
        }
    }
}

#[derive(Serialize)]
struct Balance {
    items: Vec<TelemetryEntry>,
    loadouts: Vec<TelemetryEntry>,
    pickups: Vec<PickupEntry>,
}

/// Groups child rows by their parent key, keeping the child query's row order (as Prisma does).
fn group<T>(rows: Vec<T>, key: impl Fn(&T) -> i64) -> HashMap<i64, Vec<T>> {
    let mut map: HashMap<i64, Vec<T>> = HashMap::new();
    for row in rows {
        map.entry(key(&row)).or_default().push(row);
    }
    map
}

/// Loads and builds the dashboard.
///
/// # Errors
/// A DB error, a dangling required relation, or an undecodable stored value (Prisma throws
/// there; the TS GET has no try/catch, so it is a 500 either way).
pub async fn load(conn: &mut SqliteConnection) -> anyhow::Result<Dashboard> {
    let Some(season) = active_season_latest(conn).await? else {
        return Ok(Dashboard::Empty { season: None });
    };

    // `players: { include: { user: { select: { id, name, avatarUrl } } }, orderBy: { user: { name: 'asc' } } }`
    let players: Vec<SeasonPlayerRow> = {
        let sql = format!(
            r#"SELECT {SEASON_PLAYER_COLUMNS} FROM "SeasonPlayer" LEFT JOIN "User" AS "orderby_1" ON ("orderby_1"."id") = ("SeasonPlayer"."userId") WHERE "SeasonPlayer"."seasonId" IN (?) ORDER BY "orderby_1"."name" ASC LIMIT ? OFFSET ?"#
        );
        sqlx::query_as::<_, SeasonPlayerRow>(sqlx::AssertSqlSafe(sql))
            .bind(season.id)
            .bind(-1_i64)
            .bind(0_i64)
            .fetch_all(&mut *conn)
            .await?
    };
    let weeks: Vec<SeasonWeekRow> = fetch_in(
        conn,
        WEEK_COLUMNS,
        "SeasonWeek",
        "seasonId",
        &[season.id],
        r#" ORDER BY "SeasonWeek"."weekNumber" ASC"#,
    )
    .await?;
    let rewards: Vec<SeasonRewardRow> = fetch_in(
        conn,
        REWARD_COLUMNS,
        "SeasonReward",
        "seasonId",
        &[season.id],
        r#" ORDER BY "SeasonReward"."cost" ASC"#,
    )
    .await?;
    let user_ids = unique_ids(players.iter().map(|player| player.user_id));
    let users: Vec<UserSummaryRow> = fetch_in(
        conn,
        r#""User"."id", "User"."name", "User"."avatarUrl""#,
        "User",
        "id",
        &user_ids,
        "",
    )
    .await?;

    let week_ids: Vec<i64> = weeks.iter().map(|week| week.id).collect();
    let predictions: Vec<SeasonPredictionRow> = fetch_in(
        conn,
        PREDICTION_COLUMNS,
        "SeasonPrediction",
        "weekId",
        &week_ids,
        "",
    )
    .await?;
    let loadouts: Vec<SeasonLoadoutRow> = fetch_in(
        conn,
        LOADOUT_COLUMNS,
        "SeasonLoadout",
        "weekId",
        &week_ids,
        "",
    )
    .await?;
    let shield_choices: Vec<SeasonShieldChoiceRow> = fetch_in(
        conn,
        SHIELD_CHOICE_COLUMNS,
        "SeasonShieldChoice",
        "weekId",
        &week_ids,
        "",
    )
    .await?;
    let race_ids = unique_ids(weeks.iter().filter_map(|week| week.race_id));
    let races: Vec<RaceStatusRow> = fetch_in(
        conn,
        r#""Race"."id", "Race"."status""#,
        "Race",
        "id",
        &race_ids,
        "",
    )
    .await?;
    // `shieldChoices: { include: { seasonPlayer: { include: { user: true } } } }`.
    let choice_player_ids = unique_ids(shield_choices.iter().map(|choice| choice.season_player_id));
    let choice_players: Vec<SeasonPlayerRow> = fetch_in(
        conn,
        SEASON_PLAYER_COLUMNS,
        "SeasonPlayer",
        "id",
        &choice_player_ids,
        "",
    )
    .await?;
    let choice_user_ids = unique_ids(choice_players.iter().map(|player| player.user_id));
    let choice_users: Vec<UserRow> =
        fetch_in(conn, USER_COLUMNS, "User", "id", &choice_user_ids, "").await?;

    // The season's races, in week order (`weeksPlan.flatMap(week => week.race ? [week.race.id] : [])`).
    let season_race_ids: Vec<i64> = weeks
        .iter()
        .filter_map(|week| week.race_id)
        .filter(|id| races.iter().any(|race| race.id == *id))
        .collect();
    let telemetry: Vec<ItemTelemetryDbRow> = fetch_in(
        conn,
        ITEM_TELEMETRY_COLUMNS,
        "RaceItemTelemetry",
        "raceId",
        &season_race_ids,
        "",
    )
    .await?;
    let pickup_telemetry: Vec<PickupTelemetryDbRow> = fetch_in(
        conn,
        PICKUP_TELEMETRY_COLUMNS,
        "RacePickupTelemetry",
        "raceId",
        &season_race_ids,
        "",
    )
    .await?;

    // Joins.
    let user_by_id: HashMap<i64, &UserSummaryRow> =
        users.iter().map(|user| (user.id, user)).collect();
    let player_name = |user_id: i64| -> anyhow::Result<&str> {
        user_by_id
            .get(&user_id)
            .map(|user| user.name.as_str())
            .ok_or_else(|| anyhow::anyhow!("season player user {user_id} is missing"))
    };
    let choice_name = |season_player_id: i64| -> anyhow::Result<String> {
        let player = choice_players
            .iter()
            .find(|player| player.id == season_player_id)
            .ok_or_else(|| anyhow::anyhow!("shield choice player {season_player_id} is missing"))?;
        choice_users
            .iter()
            .find(|user| user.id == player.user_id)
            .map(|user| user.name.clone())
            .ok_or_else(|| anyhow::anyhow!("shield choice user {} is missing", player.user_id))
    };
    let mut predictions_by_week = group(predictions, |row| row.week_id);
    let mut loadouts_by_week = group(loadouts, |row| row.week_id);
    let mut choices_by_week = group(shield_choices, |row| row.week_id);

    let player_summaries = players
        .iter()
        .map(|player| {
            let user = user_by_id.get(&player.user_id).ok_or_else(|| {
                anyhow::anyhow!("season player user {} is missing", player.user_id)
            })?;
            Ok(PlayerSummary {
                id: player.user_id,
                name: user.name.clone(),
                avatar_url: user.avatar_url.clone(),
                personal_link: format!(
                    "/season-3?token={}",
                    encode_uri_component(&player.access_token)
                ),
                scars: player.scars,
                shields: player.shields,
                prediction_points: player.prediction_points,
                is_king: player.is_king,
                king_streak: player.king_streak,
            })
        })
        .collect::<anyhow::Result<Vec<_>>>()?;

    let mut week_summaries = Vec::with_capacity(weeks.len());
    for week in &weeks {
        let skipped = parse_skipped_player_ids(week.skipped_player_ids_json.as_deref());
        let active: Vec<&SeasonPlayerRow> = players
            .iter()
            .filter(|player| !skipped_contains(&skipped, player.user_id))
            .collect();
        let week_predictions = predictions_by_week.remove(&week.id).unwrap_or_default();
        let week_loadouts = loadouts_by_week.remove(&week.id).unwrap_or_default();
        let week_choices = choices_by_week.remove(&week.id).unwrap_or_default();

        let loadout_ready: Vec<i64> = week_loadouts
            .iter()
            .filter(|loadout| {
                !skipped_contains(&skipped, loadout.user_id)
                    && (loadout.status == "ready" || loadout.status == "auto")
            })
            .map(|loadout| loadout.user_id)
            .collect();
        let predicted: Vec<i64> = week_predictions
            .iter()
            .filter(|prediction| !skipped_contains(&skipped, prediction.predictor_user_id))
            .map(|prediction| prediction.predictor_user_id)
            .collect();
        let missing_loadout: Vec<i64> = active
            .iter()
            .filter(|player| !loadout_ready.contains(&player.user_id))
            .map(|player| player.user_id)
            .collect();
        let missing_prediction: Vec<i64> = active
            .iter()
            .filter(|player| !predicted.contains(&player.user_id))
            .map(|player| player.user_id)
            .collect();
        let names = |ids: &[i64]| -> anyhow::Result<Vec<String>> {
            ids.iter()
                .map(|id| player_name(*id).map(str::to_owned))
                .collect()
        };
        let fully_ready: Vec<i64> = active
            .iter()
            .filter(|player| {
                loadout_ready.contains(&player.user_id) && predicted.contains(&player.user_id)
            })
            .map(|player| player.user_id)
            .collect();
        let shield_confirmations = week_choices
            .iter()
            .filter(|choice| !skipped_contains(&skipped, choice.user_id))
            .map(|choice| choice_name(choice.season_player_id))
            .collect::<anyhow::Result<Vec<_>>>()?;
        let race = week
            .race_id
            .and_then(|id| races.iter().find(|race| race.id == id));
        let chaos_groups = parse_chaos_groups_strict(week.chaos_payload.as_deref())
            .map(|groups| RawValue::from_string(stringify(&groups)))
            .transpose()?;

        week_summaries.push(WeekSummary {
            id: week.id,
            week_number: week.week_number,
            status: week.status.clone(),
            chaos_type: week.chaos_type.clone(),
            chaos_target_user_id: week.chaos_target_user_id,
            chaos_target_user_id2: week.chaos_target_user_id2,
            chaos_groups,
            skipped_player_ids: skipped.iter().map(|&id| JsNum(id)).collect(),
            prediction_count: week_predictions.len(),
            loadout_ready_count: loadout_ready.len(),
            missing_loadout_names: names(&missing_loadout)?,
            missing_prediction_names: names(&missing_prediction)?,
            loadout_ready_user_ids: loadout_ready,
            prediction_user_ids: predicted,
            missing_loadout_user_ids: missing_loadout,
            missing_prediction_user_ids: missing_prediction,
            fully_ready_user_ids: fully_ready,
            shield_confirmations,
            recap: week.recap.clone(),
            race_id: race.map(|race| race.id),
            race_status: race.map(|race| race.status.clone()),
        });
    }

    let item_rows: Vec<ItemTelemetryRow> = telemetry
        .into_iter()
        .map(|row| ItemTelemetryRow {
            item_id: row.item_id,
            loadout_key: row.loadout_key,
            won: row.won,
            bottom_two: row.bottom_two,
            final_rank: row.final_rank,
            rank_delta: row.rank_delta,
            activated: row.activated,
            succeeded: row.succeeded,
        })
        .collect();
    let pickup_rows: Vec<PickupTelemetryRow> = pickup_telemetry
        .into_iter()
        .map(|row| PickupTelemetryRow {
            item_id: row.item_id,
            activated: row.activated,
            hit_count: row.hit_count,
            manual_used: row.manual_used,
            auto_used: row.auto_used,
            rank_delta: row.rank_delta,
        })
        .collect();
    let summary = balance_summary(&item_rows, &pickup_rows);

    Ok(Dashboard::Season(Box::new(SeasonDashboard {
        season: SeasonSummary {
            id: season.id,
            key: season.key,
            name: season.name,
            year: season.year,
            weeks: season.weeks,
            status: season.status,
        },
        players: player_summaries,
        weeks: week_summaries,
        rewards,
        balance: Balance {
            items: summary.items.into_iter().map(Into::into).collect(),
            loadouts: summary.loadouts.into_iter().map(Into::into).collect(),
            pickups: summary.pickups.into_iter().map(Into::into).collect(),
        },
    })))
}
