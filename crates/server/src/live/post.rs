//! After T2, best effort (D23): the frozen post-race stats (`RaceReplayTrack.statsJson`) and,
//! for official races, item and pickup telemetry (`lib/racing/telemetry.ts`,
//! `lib/racing/pickup-telemetry.ts`). Both re-simulate counterfactuals, so the work runs in
//! `spawn_blocking`. Nothing here can fail a race: errors are logged by the caller.

use race_core::items::{item_activation_for_event, item_success_for_event};
use race_core::sim::{SimOptions, simulate_race};
use race_core::stats::{PostRacePlayerInput, build as build_stats};
use race_protocol::config::{PickupConfig, ResolvedRaceConfig};
use race_protocol::events::{EventKind, RaceEvent};
use race_protocol::ids::RaceId;
use race_protocol::result::RaceResult;
use serde_json::{Value, json};
use sqlx::AssertSqlSafe;

use crate::cosmetics::ids::cuid;
use crate::cosmetics::js::stringify;
use crate::db::{Db, DbTime};

/// `(type, tick, timestampWithinRaceMs, sourcePlayerId, targetPlayerId, metadataJson)`.
type EventRow = (String, i64, f64, Option<String>, Option<String>, String);

/// What the blocking half needs, read from the DB after T2.
pub(crate) struct PostInputs {
    pub race_id: i64,
    pub is_test: bool,
    pub config: ResolvedRaceConfig,
    pub result: RaceResult,
    /// Every stored event (meta included), ordered by tick then insert order.
    pub stats_events: Vec<RaceEvent>,
    pub stats_players: Vec<PostRacePlayerInput>,
}

pub(crate) struct ItemRow {
    player_id: String,
    item_id: &'static str,
    loadout_key: String,
    final_rank: u32,
    baseline_rank: u32,
    won: bool,
    top_three: bool,
    bottom_two: bool,
    activated: bool,
    succeeded: bool,
}

pub(crate) struct PickupRow {
    player_id: String,
    instance_id: String,
    item_id: String,
    collection_rank: u32,
    final_rank: u32,
    baseline_rank: u32,
    activated: bool,
    succeeded: bool,
    manual_used: bool,
    auto_used: bool,
    hit_count: u32,
}

/// What the blocking half computed.
pub(crate) struct PostRace {
    pub stats_json: Option<String>,
    pub items: Vec<ItemRow>,
    pub pickups: Vec<PickupRow>,
}

/// Reads the stats inputs (events as stored, participants with users).
pub(crate) async fn load(
    db: &Db,
    race_id: i64,
    is_test: bool,
    config: ResolvedRaceConfig,
    result: RaceResult,
) -> anyhow::Result<PostInputs> {
    let mut conn = db.reader.acquire().await?;
    let rows: Vec<EventRow> = sqlx::query_as(
        r#"SELECT "type", "tick", "timestampWithinRaceMs", "sourcePlayerId", "targetPlayerId", "metadataJson"
           FROM "RaceEngineEvent" WHERE "raceId" = ? ORDER BY "tick", "id""#,
    )
    .bind(race_id)
    .fetch_all(&mut *conn)
    .await?;
    let mut stats_events = Vec::with_capacity(rows.len());
    for (seq, (kind, tick, timestamp, source, target, metadata)) in rows.into_iter().enumerate() {
        let mut value = json!({
            "raceId": race_id.to_string(),
            "type": kind,
            "tick": tick,
            "timestampWithinRaceMs": timestamp,
            "metadata": serde_json::from_str::<Value>(&metadata)?,
            "seq": seq,
        });
        if let Some(source) = source {
            value["sourcePlayerId"] = json!(source);
        }
        if let Some(target) = target {
            value["targetPlayerId"] = json!(target);
        }
        stats_events.push(serde_json::from_value::<RaceEvent>(value)?);
    }
    let participants: Vec<(i64, Option<String>, String, Option<String>)> = sqlx::query_as(
        r#"SELECT "RaceParticipant"."userId", "RaceParticipant"."displayName", "User"."name", "User"."avatarUrl"
           FROM "RaceParticipant" JOIN "User" ON "User"."id" = "RaceParticipant"."userId"
           WHERE "RaceParticipant"."raceId" = ? AND "RaceParticipant"."isClone" = 0
           ORDER BY "RaceParticipant"."initialRank" ASC, "RaceParticipant"."id""#,
    )
    .bind(race_id)
    .fetch_all(&mut *conn)
    .await?;
    let stats_players = participants
        .into_iter()
        .map(|(user_id, display_name, user_name, avatar_url)| {
            let player_id = user_id.to_string();
            let name = config
                .players
                .iter()
                .find(|player| player.player_id.as_str() == player_id)
                .map(|player| player.name.clone())
                .or(display_name)
                .unwrap_or(user_name);
            let item_ids = config
                .loadouts
                .iter()
                .find(|loadout| loadout.player_id.as_str() == player_id)
                .map(|loadout| loadout.item_ids.clone())
                .unwrap_or_default();
            PostRacePlayerInput {
                player_id,
                name,
                avatar_url: Some(avatar_url),
                item_ids: Some(item_ids),
            }
        })
        .collect();
    Ok(PostInputs {
        race_id,
        is_test,
        config,
        result,
        stats_events,
        stats_players,
    })
}

/// The CPU half (run in `spawn_blocking`).
pub(crate) fn compute(inputs: &PostInputs) -> PostRace {
    let stats = build_stats(&inputs.config, &inputs.stats_events, &inputs.stats_players);
    let stats_json = serde_json::to_value(&stats)
        .ok()
        .map(|value| stringify(&value));
    let (items, pickups) = if inputs.is_test {
        (Vec::new(), Vec::new())
    } else {
        (
            item_telemetry(&inputs.config, &inputs.result).unwrap_or_else(|error| {
                tracing::warn!(race = inputs.race_id, %error, "item telemetry skipped");
                Vec::new()
            }),
            pickup_telemetry(&inputs.config, &inputs.result).unwrap_or_else(|error| {
                tracing::warn!(race = inputs.race_id, %error, "pickup telemetry skipped");
                Vec::new()
            }),
        )
    };
    PostRace {
        stats_json,
        items,
        pickups,
    }
}

fn counterfactual_id(config: &ResolvedRaceConfig, suffix: &str) -> anyhow::Result<RaceId> {
    RaceId::new(format!("{}-{suffix}", config.race_id.as_str()))
        .map_err(|error| anyhow::anyhow!("counterfactual race id: {error:?}"))
}

fn rank_of(result: &RaceResult, player_id: &str) -> Option<u32> {
    result
        .standings
        .iter()
        .find(|entry| entry.player_id.as_str() == player_id)
        .map(|entry| entry.rank)
}

/// `buildRaceItemTelemetry`: the no-loadout counterfactual.
fn item_telemetry(
    config: &ResolvedRaceConfig,
    official: &RaceResult,
) -> anyhow::Result<Vec<ItemRow>> {
    let mut baseline_config = config.clone();
    baseline_config.race_id = counterfactual_id(config, "counterfactual")?;
    baseline_config.loadouts = Vec::new();
    let options = SimOptions {
        record_events: false,
        ..SimOptions::default()
    };
    let baseline = simulate_race(baseline_config, options, None)
        .map_err(|error| anyhow::anyhow!("baseline: {error}"))?;
    let mut activated: Vec<(String, &'static str)> = Vec::new();
    let mut succeeded: Vec<(String, &'static str)> = Vec::new();
    for event in &official.events {
        if let Some(credit) = item_activation_for_event(event) {
            activated.push((
                credit.player_id.as_str().to_owned(),
                credit.item_id.as_str(),
            ));
        }
        if let Some(credit) = item_success_for_event(event) {
            succeeded.push((
                credit.player_id.as_str().to_owned(),
                credit.item_id.as_str(),
            ));
        }
    }
    let has = |set: &[(String, &'static str)], player: &str, item: &str| {
        set.iter().any(|(p, i)| p == player && *i == item)
    };
    let count = official.standings.len();
    let mut rows = Vec::new();
    for loadout in &config.loadouts {
        if config.is_ghost(&loadout.player_id) {
            continue;
        }
        let player = loadout.player_id.as_str();
        let (Some(final_rank), Some(baseline_rank)) =
            (rank_of(official, player), rank_of(&baseline, player))
        else {
            anyhow::bail!("Missing telemetry rank for {player}");
        };
        let loadout_key = loadout
            .item_ids
            .iter()
            .map(|item| item.as_str())
            .collect::<Vec<_>>()
            .join(" + ");
        for item in &loadout.item_ids {
            let item_id = item.as_str();
            rows.push(ItemRow {
                player_id: player.to_owned(),
                item_id,
                loadout_key: loadout_key.clone(),
                final_rank,
                baseline_rank,
                won: final_rank == 1,
                top_three: final_rank <= 3,
                bottom_two: i64::from(final_rank) > i64::try_from(count).unwrap_or(i64::MAX) - 2,
                activated: has(&activated, player, item_id),
                succeeded: has(&succeeded, player, item_id),
            });
        }
    }
    Ok(rows)
}

/// `buildRacePickupTelemetry`: the pickups-off counterfactual.
fn pickup_telemetry(
    config: &ResolvedRaceConfig,
    official: &RaceResult,
) -> anyhow::Result<Vec<PickupRow>> {
    let mut baseline_config = config.clone();
    baseline_config.race_id = counterfactual_id(config, "pickups-off")?;
    let current = &config.pickup_config;
    baseline_config.pickup_config = PickupConfig {
        enabled: false,
        golden_box_enabled: false,
        hazards_enabled: false,
        spawn_multiplier: 0.0,
        force_golden_box: false,
        ..current.clone()
    };
    let options = SimOptions {
        record_events: false,
        ..SimOptions::default()
    };
    let baseline = simulate_race(baseline_config, options, None)
        .map_err(|error| anyhow::anyhow!("baseline: {error}"))?;
    let events = &official.events;
    let used = |kind: &str, player: &str, instance: &str| {
        events.iter().any(|event| {
            event.type_name() == kind
                && event
                    .source_player_id
                    .as_ref()
                    .is_some_and(|id| id.as_str() == player)
                && match &event.kind {
                    EventKind::WildItemUsed(meta) => meta.instance_id == instance,
                    EventKind::WildItemAutoUsed(meta) => meta.instance_id == instance,
                    _ => false,
                }
        })
    };
    let hits = |item: &str, player: &str| -> u32 {
        let kind = match item {
            "MINI_ROCKET" => "MINI_ROCKET_HIT",
            "BANANA" => "WILD_BANANA_HIT",
            "MINI_BUBBLE" => "MINI_BUBBLE_BLOCKED",
            "FEATHER" => "WILD_FEATHER_DODGED",
            "QUACK_HORN" => "WILD_HORN_USED",
            _ => return 1,
        };
        let count = events
            .iter()
            .filter(|event| {
                event.type_name() == kind
                    && event
                        .source_player_id
                        .as_ref()
                        .is_some_and(|id| id.as_str() == player)
            })
            .count();
        u32::try_from(count).unwrap_or(u32::MAX)
    };
    let mut rows = Vec::new();
    for event in events {
        let (meta, instant) = match &event.kind {
            EventKind::WildItemGranted(meta) => (meta, false),
            EventKind::InstantPickupTriggered(meta) => (meta, true),
            _ => continue,
        };
        let Some(player) = event.source_player_id.as_ref() else {
            continue;
        };
        if config.is_ghost(player) {
            continue;
        }
        let player = player.as_str();
        let (Some(final_rank), Some(baseline_rank)) =
            (rank_of(official, player), rank_of(&baseline, player))
        else {
            continue;
        };
        let item_id = meta.item_id.as_str();
        let manual_used = used("WILD_ITEM_USED", player, &meta.instance_id);
        let auto_used = used("WILD_ITEM_AUTO_USED", player, &meta.instance_id);
        let hit_count = hits(item_id, player);
        rows.push(PickupRow {
            player_id: player.to_owned(),
            instance_id: meta.instance_id.clone(),
            item_id: item_id.to_owned(),
            collection_rank: meta.rank,
            final_rank,
            baseline_rank,
            activated: instant || manual_used || auto_used,
            succeeded: hit_count > 0,
            manual_used,
            auto_used,
            hit_count,
        });
    }
    Ok(rows)
}

/// Writes what [`compute`] produced, in one transaction.
pub(crate) async fn store(db: &Db, race_id: i64, post: &PostRace) -> anyhow::Result<()> {
    let now = DbTime::now();
    let mut tx = db.begin_write().await?;
    if let Some(stats_json) = &post.stats_json {
        sqlx::query(
            r#"UPDATE "RaceReplayTrack" SET "statsJson" = ? WHERE "raceId" = ? AND "statsJson" IS NULL"#,
        )
        .bind(stats_json)
        .bind(race_id)
        .execute(&mut *tx)
        .await?;
    }
    if !post.items.is_empty() {
        sqlx::query(r#"DELETE FROM "RaceItemTelemetry" WHERE "raceId" = ?"#)
            .bind(race_id)
            .execute(&mut *tx)
            .await?;
        for row in &post.items {
            sqlx::query(
                r#"INSERT INTO "RaceItemTelemetry" ("raceId", "playerId", "itemId", "loadoutKey",
                     "finalRank", "baselineRank", "rankDelta", "won", "topThree", "bottomTwo",
                     "activated", "succeeded", "createdAt")
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
            )
            .bind(race_id)
            .bind(&row.player_id)
            .bind(row.item_id)
            .bind(&row.loadout_key)
            .bind(i64::from(row.final_rank))
            .bind(i64::from(row.baseline_rank))
            .bind(i64::from(row.baseline_rank) - i64::from(row.final_rank))
            .bind(row.won)
            .bind(row.top_three)
            .bind(row.bottom_two)
            .bind(row.activated)
            .bind(row.succeeded)
            .bind(now)
            .execute(&mut *tx)
            .await?;
        }
    }
    if !post.pickups.is_empty() {
        sqlx::query(r#"DELETE FROM "RacePickupTelemetry" WHERE "raceId" = ?"#)
            .bind(race_id)
            .execute(&mut *tx)
            .await?;
        for row in &post.pickups {
            sqlx::query(AssertSqlSafe(
                r#"INSERT INTO "RacePickupTelemetry" ("id", "raceId", "playerId", "instanceId",
                     "itemId", "collectionRank", "finalRank", "baselineRank", "rankDelta",
                     "activated", "succeeded", "manualUsed", "autoUsed", "hitCount")
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"#
                    .to_owned(),
            ))
            .bind(cuid())
            .bind(race_id)
            .bind(&row.player_id)
            .bind(&row.instance_id)
            .bind(&row.item_id)
            .bind(i64::from(row.collection_rank))
            .bind(i64::from(row.final_rank))
            .bind(i64::from(row.baseline_rank))
            .bind(i64::from(row.baseline_rank) - i64::from(row.final_rank))
            .bind(row.activated)
            .bind(row.succeeded)
            .bind(row.manual_used)
            .bind(row.auto_used)
            .bind(i64::from(row.hit_count))
            .execute(&mut *tx)
            .await?;
        }
    }
    tx.commit().await?;
    Ok(())
}
