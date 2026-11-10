//! Season 3 meta layer: the ported `tests/season3.test.ts` (17 tests), plus 100% parity with the
//! TS oracle fixture `fixtures/season3-meta.json.gz` from
//! `scripts/oracle/dump-season3-meta-fixtures.ts` (`executeSeason3Race`'s meta layer run for
//! real against a recording Prisma stub, plus every pure helper).
//!
//! Regenerate the fixture with
//! `node --import tsx scripts/oracle/dump-season3-meta-fixtures.ts` (`--check` verifies it).

// Test code, not the engine: the D4(b) type bans don't apply (see src/lib.rs).
#![allow(clippy::disallowed_types)]

use std::collections::BTreeMap;
use std::io::Read;

use autoduck_server::cosmetics::js::stringify;
use autoduck_server::season3::balance::{ItemTelemetryRow, PickupTelemetryRow, balance_summary};
use autoduck_server::season3::cards::{
    CHAOS_CARDS, ChaosCard, ChaosType, Season3Player, chaos_label, prepare_chaos_card,
    select_chaos_card,
};
use autoduck_server::season3::mapping::{MappingPlayer, RawStanding, map_season3_race_ranking};
use autoduck_server::season3::news::{DuckNewsInput, generate_duck_news};
use autoduck_server::season3::payload::{
    js_string, parse_chaos_groups_lenient, parse_chaos_groups_strict, parse_skipped_player_ids,
    skipped_ids_json,
};
use autoduck_server::season3::resolution::{
    MetaEvent, MetaPlayer, ResolutionError, ResolutionInput, ResolutionPlan, WeekPrediction,
    plan_resolution, preflight_card,
};
use autoduck_server::season3::resolve::{
    ChampionCandidate, Prediction, PreviousKing, Season3RankingEntry, apply_scar_economy,
    resolve_predictions, resolve_season3_race, select_champion,
};
use autoduck_server::season3::schedule::{assert_season3_race_day, is_vietnam_monday};
use autoduck_server::season3::test_mode::{RaceMode, can_start_test_race, race_mode};
use serde::Serialize;
use serde_json::{Value, json};

// ---------------------------------------------------------------------------
// Ported tests/season3.test.ts

fn entry(user_id: i64, name: &str, rank: i64, has_shield: bool) -> Season3RankingEntry {
    Season3RankingEntry {
        user_id,
        name: name.to_owned(),
        rank,
        has_shield,
    }
}

fn ranking() -> Vec<Season3RankingEntry> {
    vec![
        entry(1, "Thanh", 1, false),
        entry(2, "Huy", 2, false),
        entry(3, "Khoa", 3, false),
        entry(4, "Long", 4, true),
        entry(5, "Nam", 5, false),
    ]
}

fn season_players(ranking: &[Season3RankingEntry]) -> Vec<MappingPlayer<'_>> {
    ranking
        .iter()
        .map(|entry| MappingPlayer {
            user_id: entry.user_id,
            name: &entry.name,
            shields: i64::from(entry.has_shield),
            shield_confirmed: entry.has_shield,
        })
        .collect()
}

fn ids(entries: &[Season3RankingEntry]) -> Vec<i64> {
    entries.iter().map(|entry| entry.user_id).collect()
}

fn card(chaos_type: ChaosType, target: Option<i64>, groups: Option<&[&[i64]]>) -> ChaosCard {
    ChaosCard {
        chaos_type,
        target_user_id: target,
        target_user_id2: None,
        groups: groups.map(|groups| {
            groups
                .iter()
                .map(|group| group.iter().map(ToString::to_string).collect())
                .collect()
        }),
    }
}

fn standing(rank: i64, user_id: i64, name: &str) -> RawStanding<'_> {
    RawStanding {
        rank,
        user_id,
        name,
    }
}

#[test]
fn bridge_maps_the_real_race_result_and_carries_shield_state() {
    let ranking = ranking();
    let players = season_players(&ranking);
    let mapped = map_season3_race_ranking(
        &[
            standing(2, 2, "Huy"),
            standing(1, 1, "Thanh"),
            standing(3, 3, "Khoa"),
            standing(5, 5, "Nam"),
            standing(4, 4, "Long"),
        ],
        &players,
    )
    .unwrap();
    assert_eq!(ids(&mapped), [2, 1, 3, 5, 4]);
    assert!(mapped.iter().find(|e| e.user_id == 4).unwrap().has_shield);
}

#[test]
fn race_window_only_opens_on_monday_in_vietnam_time() {
    // 2026-08-10T00:00:00.000Z and 2026-08-09T16:59:59.000Z.
    assert!(is_vietnam_monday(1_786_320_000_000));
    assert!(!is_vietnam_monday(1_786_294_799_000));
    assert!(assert_season3_race_day(1_786_320_000_000).is_ok());
    let error = assert_season3_race_day(1_786_294_799_000).unwrap_err();
    assert!(error.to_string().contains("THỨ HAI hàng tuần"));
}

#[test]
fn test_race_is_available_during_prep_without_claiming_the_week() {
    assert!(can_start_test_race("open"));
    assert!(can_start_test_race("locked"));
    assert!(!can_start_test_race("racing"));
    assert!(!can_start_test_race("resolved"));
    assert_eq!(
        race_mode(true),
        RaceMode {
            claims_official_week: false,
            mutates_season: false
        }
    );
    assert_eq!(
        race_mode(false),
        RaceMode {
            claims_official_week: true,
            mutates_season: true
        }
    );
}

#[test]
fn bridge_rejects_incomplete_or_foreign_race_results() {
    let ranking = ranking();
    let players = season_players(&ranking);
    let foreign = map_season3_race_ranking(&[standing(1, 99, "Unknown")], &players).unwrap_err();
    assert!(foreign.to_string().contains("không thuộc Season 3"));
    let duplicate = map_season3_race_ranking(
        &[
            standing(1, 1, "Thanh"),
            standing(2, 1, "Thanh"),
            standing(3, 3, "Khoa"),
            standing(4, 4, "Long"),
            standing(5, 5, "Nam"),
        ],
        &players,
    )
    .unwrap_err();
    assert!(duplicate.to_string().contains("không trả đủ ranking"));
}

#[test]
fn bridge_does_not_auto_use_an_unconfirmed_shield() {
    let ranking = ranking();
    let mut players = season_players(&ranking);
    players[3].shield_confirmed = false;
    let raw: Vec<RawStanding<'_>> = ranking
        .iter()
        .map(|e| standing(e.rank, e.user_id, &e.name))
        .collect();
    let mapped = map_season3_race_ranking(&raw, &players).unwrap();
    assert!(!mapped.iter().find(|e| e.user_id == 4).unwrap().has_shield);
}

#[test]
fn normal_keeps_vanilla_ranking_and_shield_protects_the_exact_bottom_two_duck() {
    let result =
        resolve_season3_race(&ranking(), &card(ChaosType::Normal, None, None), None).unwrap();
    assert_eq!(ids(&result.ranking), [1, 2, 3, 4, 5]);
    assert_eq!(ids(&result.bottom_two), [4, 5]);
    assert_eq!(ids(&result.scar_victims), [5]);
    assert_eq!(ids(&result.protected_players), [4]);
}

#[test]
fn two_scars_become_one_shield_and_a_shield_is_consumed_without_moving_the_penalty() {
    let economy = |a, b, c, d| {
        let result = apply_scar_economy(a, b, c, d);
        (result.scars, result.shields)
    };
    assert_eq!(economy(1, 0, 1, false), (0, 1));
    assert_eq!(economy(0, 1, 1, true), (0, 0));
    assert_eq!(economy(0, 1, 0, true), (0, 0));
}

#[test]
fn reverse_turns_raw_top_two_into_losers_without_changing_raw_ranks() {
    let result =
        resolve_season3_race(&ranking(), &card(ChaosType::Reverse, None, None), None).unwrap();
    let ranks: Vec<i64> = result.ranking.iter().map(|e| e.rank).collect();
    assert_eq!(ranks, [1, 2, 3, 4, 5]);
    assert_eq!(ids(&result.scar_victims), [1, 2]);
    assert!(result.protected_players.is_empty());
}

#[test]
fn duo_and_constructors_eliminate_the_worst_group_including_shield_protection() {
    let duo = resolve_season3_race(
        &ranking(),
        &card(ChaosType::Duo, None, Some(&[&[1, 5], &[2, 3, 4]])),
        None,
    )
    .unwrap();
    assert_eq!(ids(&duo.scar_victims), [1, 5]);
    let constructors = resolve_season3_race(
        &ranking(),
        &card(ChaosType::Constructors, None, Some(&[&[1, 2, 3], &[4, 5]])),
        None,
    )
    .unwrap();
    assert_eq!(ids(&constructors.scar_victims), [5]);
    assert_eq!(ids(&constructors.protected_players), [4]);
}

#[test]
fn triple_cut_line_and_bounty_hunt_follow_their_declared_cutoffs() {
    let resolve = |chaos: ChaosCard| resolve_season3_race(&ranking(), &chaos, None).unwrap();
    let triple = resolve(card(ChaosType::TripleElimination, None, None));
    assert_eq!(ids(&triple.scar_victims), [3, 5]);
    assert_eq!(ids(&triple.protected_players), [4]);
    let cut_line = resolve(card(ChaosType::CutLine, None, None));
    assert_eq!(ids(&cut_line.scar_victims), [5]);
    assert_eq!(ids(&cut_line.protected_players), [4]);
    for target in [3, 4, 5] {
        let bounty = resolve(card(ChaosType::BountyHunt, Some(target), None));
        assert_eq!(ids(&bounty.scar_victims), [5], "target {target}");
    }
}

#[test]
fn prediction_points_are_awarded_only_for_a_raw_bottom_two_target() {
    let ranking = ranking();
    let outcomes = resolve_predictions(
        &[
            Prediction {
                predictor_user_id: 1,
                target_user_id: 5,
            },
            Prediction {
                predictor_user_id: 2,
                target_user_id: 3,
            },
        ],
        &ranking[3..],
    );
    let points: Vec<i64> = outcomes.iter().map(|o| o.points_awarded).collect();
    assert_eq!(points, [1, 0]);
}

#[test]
fn king_crown_stays_with_a_previous_king_who_remains_top_three() {
    let result = resolve_season3_race(
        &ranking(),
        &card(ChaosType::Normal, None, None),
        Some(PreviousKing {
            user_id: 2,
            streak: 3,
        }),
    )
    .unwrap();
    assert_eq!(result.king_user_id, Some(2));
    assert_eq!(result.king_streak, 4);
    assert!(!result.king_changed);
}

fn season3_players(ranking: &[Season3RankingEntry]) -> Vec<Season3Player<'_>> {
    ranking
        .iter()
        .map(|e| Season3Player {
            user_id: e.user_id,
            name: &e.name,
        })
        .collect()
}

#[test]
fn chaos_selection_returns_exactly_one_card_and_persists_random_groups() {
    let ranking = ranking();
    let players = season3_players(&ranking[..3]);
    let card = select_chaos_card(&players, &mut || 0.3).unwrap();
    assert!(CHAOS_CARDS.contains(&card.chaos_type));
    if matches!(card.chaos_type, ChaosType::Duo | ChaosType::Constructors) {
        let grouped: usize = card.groups.unwrap().iter().map(Vec::len).sum();
        assert_eq!(grouped, 3);
    }
}

#[test]
fn re_preparing_a_persisted_chaos_card_keeps_the_seeded_stream_aligned() {
    let ranking = ranking();
    let players = season3_players(&ranking);
    let sequence = [0.34, 0.91, 0.14, 0.72, 0.31, 0.55];
    let mut selected_cursor = 0;
    let selected = select_chaos_card(&players, &mut || {
        let value = sequence[selected_cursor % sequence.len()];
        selected_cursor += 1;
        value
    })
    .unwrap();
    let mut prepared_cursor = 1;
    let prepared = prepare_chaos_card(selected.chaos_type, &players, &mut || {
        let value = sequence[prepared_cursor % sequence.len()];
        prepared_cursor += 1;
        value
    })
    .unwrap();
    assert_eq!(prepared, selected);
}

#[test]
fn championship_selection_never_uses_prediction_points() {
    let champion = select_champion(&[
        ChampionCandidate {
            user_id: 1,
            championship_points: 10,
            race_wins: 2,
        },
        ChampionCandidate {
            user_id: 2,
            championship_points: 9,
            race_wins: 9,
        },
    ]);
    assert_eq!(champion, Some(1));
}

#[test]
fn duck_news_includes_the_s3_reveal_facts() {
    let news = generate_duck_news(&DuckNewsInput {
        week_number: 6,
        scar_victims: &["Thanh", "Huy"],
        protected_players: &["Huy"],
        chaos_type: ChaosType::BountyHunt,
        chaos_target_name: Some("Thanh"),
        king_name: Some("Long"),
        prediction_winners: &["Khoa"],
    });
    assert!(news.contains("DUCK NEWS — WEEK 6"));
    assert!(news.contains("BOUNTY HUNT — Thanh"));
    assert!(news.contains("Khoa prediction chính xác"));
}

#[test]
fn manual_pick_chaos_supports_all_seven_cards_and_specific_bounty_targets() {
    let ranking = ranking();
    let players = season3_players(&ranking);
    for chaos_type in CHAOS_CARDS {
        let card = prepare_chaos_card(chaos_type, &players, &mut || 0.5).unwrap();
        assert_eq!(card.chaos_type, chaos_type);
    }
    let manual =
        resolve_season3_race(&ranking, &card(ChaosType::BountyHunt, Some(5), None), None).unwrap();
    assert_eq!(ids(&manual.scar_victims), [5]);
}

// ---------------------------------------------------------------------------
// Oracle fixture parity

fn fixture() -> Value {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/season3-meta.json.gz"
    );
    let mut json = Vec::new();
    flate2::read::GzDecoder::new(std::fs::File::open(path).unwrap())
        .read_to_end(&mut json)
        .unwrap();
    let value: Value = serde_json::from_slice(&json).unwrap();
    assert_eq!(value["format"], "season3-meta-v1");
    value
}

fn js<T: Serialize>(value: &T) -> String {
    stringify(&serde_json::to_value(value).unwrap())
}

fn error_view(message: &str, name: &str) -> String {
    stringify(&json!({ "error": message, "name": name }))
}

fn int(value: &Value) -> i64 {
    value
        .as_i64()
        .unwrap_or_else(|| panic!("not an integer: {value}"))
}

fn opt_int(value: &Value) -> Option<i64> {
    if value.is_null() {
        None
    } else {
        Some(int(value))
    }
}

fn opt_str(value: &Value) -> Option<&str> {
    value.as_str()
}

fn chaos_type(value: &Value) -> ChaosType {
    ChaosType::from_wire(value.as_str().unwrap()).unwrap()
}

/// A fixture ranking entry; a non-integer rank becomes 0, which fails `assertRanking` at the
/// same entry with the same message as TS's `Number.isInteger` check.
fn ranking_entry(value: &Value) -> Season3RankingEntry {
    let rank = value["rank"].as_i64().unwrap_or(0);
    Season3RankingEntry {
        user_id: int(&value["userId"]),
        name: value["name"].as_str().unwrap().to_owned(),
        rank,
        has_shield: value["hasShield"].as_bool().unwrap(),
    }
}

fn ranking_entries(value: &Value) -> Vec<Season3RankingEntry> {
    value
        .as_array()
        .unwrap()
        .iter()
        .map(ranking_entry)
        .collect()
}

fn fixture_card(value: &Value) -> ChaosCard {
    ChaosCard {
        chaos_type: chaos_type(&value["type"]),
        target_user_id: opt_int(&value["targetUserId"]),
        target_user_id2: opt_int(&value["targetUserId2"]),
        groups: value.get("groups").and_then(Value::as_array).map(|groups| {
            groups
                .iter()
                .map(|group| group.as_array().unwrap().iter().map(js_string).collect())
                .collect()
        }),
    }
}

fn check_resolve(case: &Value) -> String {
    let previous_king = (!case["previousKing"].is_null()).then(|| PreviousKing {
        user_id: int(&case["previousKing"]["userId"]),
        streak: int(&case["previousKing"]["streak"]),
    });
    match resolve_season3_race(
        &ranking_entries(&case["ranking"]),
        &fixture_card(&case["chaos"]),
        previous_king,
    ) {
        Ok(resolution) => js(&resolution),
        Err(error) => error_view(&error.to_string(), "Error"),
    }
}

fn check_scar_economy(case: &Value) -> String {
    let args = case["args"].as_array().unwrap();
    js(&apply_scar_economy(
        int(&args[0]),
        int(&args[1]),
        int(&args[2]),
        args[3].as_bool().unwrap(),
    ))
}

fn check_predictions(case: &Value) -> String {
    let predictions: Vec<Prediction> = case["predictions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| Prediction {
            predictor_user_id: int(&p["predictorUserId"]),
            target_user_id: int(&p["targetUserId"]),
        })
        .collect();
    js(&resolve_predictions(
        &predictions,
        &ranking_entries(&case["bottomTwo"]),
    ))
}

fn names(value: &Value) -> Vec<&str> {
    value
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| entry["name"].as_str().unwrap())
        .collect()
}

fn check_news(case: &Value) -> String {
    let args = &case["args"];
    let news = generate_duck_news(&DuckNewsInput {
        week_number: int(&args["weekNumber"]),
        scar_victims: &names(&args["scarVictims"]),
        protected_players: &names(&args["protectedPlayers"]),
        chaos_type: chaos_type(&args["chaos"]["type"]),
        chaos_target_name: args.get("chaosTargetName").and_then(opt_str),
        king_name: args.get("kingName").and_then(opt_str),
        prediction_winners: &names(&args["predictionWinners"]),
    });
    stringify(&Value::String(news))
}

fn check_champion(case: &Value) -> String {
    let players: Vec<ChampionCandidate> = case["players"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| ChampionCandidate {
            user_id: int(&p["userId"]),
            championship_points: int(&p["championshipPoints"]),
            race_wins: int(&p["raceWins"]),
        })
        .collect();
    js(&select_champion(&players))
}

fn check_mapping(case: &Value) -> String {
    let raw: Vec<RawStanding<'_>> = case["raw"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| RawStanding {
            rank: int(&r["rank"]),
            user_id: r["playerId"].as_str().unwrap().parse().unwrap(),
            name: r["name"].as_str().unwrap(),
        })
        .collect();
    let players: Vec<MappingPlayer<'_>> = case["players"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| MappingPlayer {
            user_id: int(&p["userId"]),
            name: p["user"]["name"].as_str().unwrap(),
            shields: int(&p["shields"]),
            shield_confirmed: p.get("shieldConfirmed") == Some(&Value::Bool(true)),
        })
        .collect();
    match map_season3_race_ranking(&raw, &players) {
        Ok(ranking) => js(&ranking),
        Err(error) => error_view(&error.to_string(), "Error"),
    }
}

fn check_schedule(case: &Value) -> String {
    js(&is_vietnam_monday(int(&case["ms"])))
}

fn view_option(value: Option<Value>) -> String {
    value.map_or_else(|| "undefined".to_owned(), |value| stringify(&value))
}

fn check_payload(case: &Value) -> String {
    let text = case["text"].as_str();
    stringify(&json!({
        "strict": view_option(parse_chaos_groups_strict(text)),
        "lenient": view_option(parse_chaos_groups_lenient(text)),
        "skipped": skipped_ids_json(&parse_skipped_player_ids(text)),
    }))
}

fn check_balance(case: &Value) -> String {
    let flag = |row: &Value, key: &str| row[key].as_bool().unwrap();
    let telemetry: Vec<ItemTelemetryRow> = case["telemetry"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| ItemTelemetryRow {
            item_id: row["itemId"].as_str().unwrap().to_owned(),
            loadout_key: row["loadoutKey"].as_str().unwrap().to_owned(),
            won: flag(row, "won"),
            bottom_two: flag(row, "bottomTwo"),
            final_rank: int(&row["finalRank"]),
            rank_delta: int(&row["rankDelta"]),
            activated: flag(row, "activated"),
            succeeded: flag(row, "succeeded"),
        })
        .collect();
    let pickups: Vec<PickupTelemetryRow> = case["pickups"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| PickupTelemetryRow {
            item_id: row["itemId"].as_str().unwrap().to_owned(),
            activated: flag(row, "activated"),
            hit_count: int(&row["hitCount"]),
            manual_used: flag(row, "manualUsed"),
            auto_used: flag(row, "autoUsed"),
            rank_delta: int(&row["rankDelta"]),
        })
        .collect();
    js(&balance_summary(&telemetry, &pickups))
}

/// Renders a plan as the calls TS makes inside the resolve `$transaction`, in order.
fn render_tx(input: &ResolutionInput<'_>, plan: &ResolutionPlan) -> String {
    let mut calls: Vec<Value> = Vec::new();
    let mut call = |op: &str, args: Value| calls.push(json!({ "op": op, "args": args }));
    for update in &plan.participant_updates {
        call(
            "raceParticipant.updateMany",
            json!({
                "where": { "raceId": input.race_id, "userId": update.user_id, "cloneIndex": null },
                "data": { "initialRank": update.initial_rank, "gotScar": update.got_scar, "usedShield": update.used_shield },
            }),
        );
    }
    if let Some(season) = &plan.season {
        call(
            "seasonPlayer.updateMany",
            json!({
                "where": { "seasonId": season.clear_kings_season_id, "isKing": true },
                "data": { "isKing": false, "kingStreak": 0 },
            }),
        );
        for update in &season.player_updates {
            let mut data = serde_json::Map::new();
            data.insert("scars".into(), json!(update.scars));
            data.insert("shields".into(), json!(update.shields));
            let mut increment = |key: &str, amount: i64, always: bool| {
                if always || amount != 0 {
                    data.insert(key.into(), json!({ "increment": amount }));
                }
            };
            increment("shieldsUsed", update.shields_used_increment, false);
            increment(
                "predictionPoints",
                update.prediction_points_increment,
                false,
            );
            increment("raceCount", update.race_count_increment, true);
            increment("raceWins", update.race_wins_increment, false);
            increment(
                "championshipPoints",
                update.championship_points_increment,
                true,
            );
            data.insert("isKing".into(), json!(update.is_king));
            data.insert("kingStreak".into(), json!(update.king_streak));
            call(
                "seasonPlayer.update",
                json!({ "where": { "id": update.season_player_id }, "data": data }),
            );
        }
        for update in &season.prediction_updates {
            call(
                "seasonPrediction.update",
                json!({ "where": { "id": update.prediction_id }, "data": { "pointsAwarded": update.points_awarded } }),
            );
        }
        let grant_args = |grant: &autoduck_server::season3::resolution::QuackGrant| {
            json!({
                "seasonPlayerId": grant.season_player_id,
                "amount": grant.amount,
                "reason": grant.reason,
                "raceId": grant.race_id,
                "idempotencyKey": grant.idempotency_key,
                "metadata": serde_json::from_str::<Value>(&grant.metadata_json).unwrap(),
            })
        };
        for grant in &season.quack_grants {
            call("applyQuackTransaction", grant_args(grant));
        }
        if let Some(golden) = &season.golden {
            call("applyQuackTransaction", grant_args(&golden.grant));
            call(
                "raceEngineEvent.create",
                json!({ "data": {
                    "raceId": input.race_id,
                    "type": "QP_TRACK_REWARD_GRANTED",
                    "tick": golden.tick,
                    "timestampWithinRaceMs": golden.timestamp_within_race_ms,
                    "sourcePlayerId": golden.source_player_id,
                    "targetPlayerId": null,
                    "metadataJson": golden.event_metadata_json(),
                } }),
            );
        }
    }
    call(
        "race.updateMany",
        json!({
            "where": { "id": input.race_id, "engineState": "FINISHED" },
            "data": {
                "status": "finished",
                "engineState": "RESOLVED",
                "videoUrl": null,
                "liveSnapshotJson": null,
                "resultDigest": "<persisted>",
                "finalVerdict": plan.final_verdict,
                "finishedAt": "<now>",
            },
        }),
    );
    if plan.season.is_some() {
        call(
            "seasonWeek.update",
            json!({ "where": { "id": input.week_id }, "data": { "status": "resolved", "recap": plan.recap, "resolvedAt": "<now>" } }),
        );
    }
    stringify(&Value::Array(calls))
}

/// `{ expected field: actual }` pairs for one t2 case.
fn check_t2(case: &Value) -> Vec<(&'static str, String, String)> {
    let source = &case["input"];
    let week = &source["week"];
    let predictions: Vec<WeekPrediction> = week["predictions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| WeekPrediction {
            id: int(&p["id"]),
            predictor_user_id: int(&p["predictorUserId"]),
            target_user_id: int(&p["targetUserId"]),
        })
        .collect();
    let season_players: Vec<MetaPlayer<'_>> = week["season"]["players"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| MetaPlayer {
            season_player_id: int(&p["id"]),
            user_id: int(&p["userId"]),
            name: p["user"]["name"].as_str().unwrap(),
            scars: int(&p["scars"]),
            shields: int(&p["shields"]),
            is_king: p["isKing"].as_bool().unwrap(),
            king_streak: int(&p["kingStreak"]),
        })
        .collect();
    let shield_choices: Vec<i64> = week["shieldChoices"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| int(&c["seasonPlayerId"]))
        .collect();
    let configured: Vec<i64> = source["config"]["players"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["playerId"].as_str().unwrap().parse().unwrap())
        .collect();
    let result = &source["result"];
    let standings: Vec<RawStanding<'_>> = result["standings"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| RawStanding {
            rank: int(&s["rank"]),
            user_id: s["playerId"].as_str().unwrap().parse().unwrap(),
            name: s["name"].as_str().unwrap(),
        })
        .collect();
    let events: Vec<MetaEvent<'_>> = result["events"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| MetaEvent {
            kind: e["type"].as_str().unwrap(),
            tick: int(&e["tick"]),
            timestamp_within_race_ms: e["timestampWithinRaceMs"].as_f64().unwrap(),
            source_player_id: e.get("sourcePlayerId").and_then(Value::as_str),
            finish_time_ms: e["metadata"].get("finishTimeMs").and_then(Value::as_f64),
            pickup_id: e["metadata"].get("pickupId").and_then(Value::as_str),
        })
        .collect();
    let input = ResolutionInput {
        race_id: int(&source["raceId"]),
        is_test: source["isTest"].as_bool().unwrap(),
        season_id: int(&week["seasonId"]),
        week_id: int(&week["id"]),
        week_number: int(&week["weekNumber"]),
        chaos_type: week["chaosType"].as_str().unwrap(),
        chaos_target_user_id: opt_int(&week["chaosTargetUserId"]),
        chaos_target_user_id2: opt_int(&week["chaosTargetUserId2"]),
        chaos_payload: week["chaosPayload"].as_str(),
        predictions: &predictions,
        season_players: &season_players,
        shield_choice_player_ids: &shield_choices,
        configured_user_ids: &configured,
        standings: &standings,
        events: &events,
        duration_ms: result["durationMs"].as_f64().unwrap(),
        tick_rate: source["config"]["tickRate"].as_f64().unwrap(),
    };
    let expected = &case["expected"];
    let text = |value: &Value| {
        value
            .as_str()
            .map_or_else(|| "null".to_owned(), str::to_owned)
    };
    match plan_resolution(&input) {
        Err(error) => {
            let name = match error {
                ResolutionError::Groups(_) | ResolutionError::UnknownChaosType(_) => "TypeError",
                _ => "Error",
            };
            vec![
                (
                    "error",
                    text(&expected["error"]),
                    error_view(&error.to_string(), name),
                ),
                (
                    "chaosEvent",
                    text(&expected["chaosEvent"]),
                    "null".to_owned(),
                ),
                ("tx", text(&expected["tx"]), "[]".to_owned()),
            ]
        }
        Ok(plan) => {
            let chaos_event = stringify(&json!({
                "raceId": input.race_id.to_string(),
                "type": "CHAOS_RESOLVED",
                "tick": plan.chaos_resolved.tick,
                "timestampWithinRaceMs": plan.chaos_resolved.timestamp_within_race_ms,
                "metadata": serde_json::from_str::<Value>(&plan.chaos_resolved.metadata_json()).unwrap(),
            }));
            let ret = stringify(&json!({
                "raceId": input.race_id,
                "recap": plan.recap,
                "resolution": serde_json::to_value(&plan.resolution).unwrap(),
                "predictions": serde_json::to_value(&plan.prediction_outcomes).unwrap(),
                "quackRewards": serde_json::to_value(plan.reported_quack_rewards()).unwrap(),
            }));
            vec![
                ("error", text(&expected["error"]), "null".to_owned()),
                ("chaosEvent", text(&expected["chaosEvent"]), chaos_event),
                ("tx", text(&expected["tx"]), render_tx(&input, &plan)),
                ("ret", text(&expected["ret"]), ret),
            ]
        }
    }
}

#[test]
fn chaos_labels_match_the_oracle() {
    let fixture = fixture();
    for chaos_type in CHAOS_CARDS {
        assert_eq!(
            fixture["chaosLabels"][chaos_type.as_str()],
            chaos_label(chaos_type),
            "{chaos_type:?}"
        );
    }
}

#[test]
fn season3_meta_parity_with_the_ts_oracle() {
    let fixture = fixture();
    let cases = fixture["cases"].as_array().unwrap();
    let mut tally: BTreeMap<String, (usize, usize)> = BTreeMap::new();
    let mut mismatches: Vec<String> = Vec::new();
    for (index, case) in cases.iter().enumerate() {
        let kind = case["kind"].as_str().unwrap();
        let comparisons: Vec<(&str, String, String)> = match kind {
            "t2" | "t2x" => check_t2(case),
            other => {
                let actual = match other {
                    "resolve" => check_resolve(case),
                    "scarEconomy" => check_scar_economy(case),
                    "predictions" => check_predictions(case),
                    "news" => check_news(case),
                    "champion" => check_champion(case),
                    "mapping" => check_mapping(case),
                    "schedule" => check_schedule(case),
                    "payload" => check_payload(case),
                    "balance" => check_balance(case),
                    unknown => panic!("unknown case kind {unknown}"),
                };
                vec![(
                    "expected",
                    case["expected"].as_str().unwrap().to_owned(),
                    actual,
                )]
            }
        };
        let passed = comparisons
            .iter()
            .all(|(_, expected, actual)| expected == actual);
        let counts = tally.entry(kind.to_owned()).or_default();
        counts.1 += 1;
        if passed {
            counts.0 += 1;
        } else if mismatches.len() < 8 {
            for (field, expected, actual) in &comparisons {
                if expected != actual {
                    mismatches.push(format!(
                        "case {index} ({kind}) {field}:\n  ts:   {expected}\n  rust: {actual}"
                    ));
                }
            }
        }
    }
    let (passed, total) = tally
        .values()
        .fold((0, 0), |(p, t), (cp, ct)| (p + cp, t + ct));
    for (kind, (kind_passed, kind_total)) in &tally {
        println!("{kind:>12}: {kind_passed}/{kind_total}");
    }
    println!("{:>12}: {passed}/{total}", "total");
    assert!(
        tally.get("t2").is_some_and(|(_, n)| *n >= 1_000),
        "the gate needs at least 1,000 resolution cases"
    );
    assert!(
        mismatches.is_empty(),
        "{} of {total} cases differ:\n{}",
        total - passed,
        mismatches.join("\n")
    );
}

/// Review M1: cards the admin route stores unchecked (as TS) that fail every resolution. The
/// first is week 1 of main's `prisma/dev.db` (CONSTRUCTORS with the ghost, user 14, in a team).
#[test]
fn preflight_rejects_cards_that_cannot_resolve() {
    let roster = [
        (1, "Zịt Lợi"),
        (2, "Zịt Minh"),
        (3, "Zịt Tâm"),
        (4, "Zịt Tân"),
        (5, "Zịt Thanh"),
        (6, "Zịt Tuấn"),
        (7, "Zịt Dũng"),
        (14, "Thomas"),
    ];
    let players: Vec<MetaPlayer<'_>> = roster
        .iter()
        .map(|&(user_id, name)| MetaPlayer {
            season_player_id: user_id * 10,
            user_id,
            name,
            scars: 0,
            shields: 0,
            is_king: user_id == 2,
            king_streak: 2,
        })
        .collect();
    let configured: Vec<i64> = roster.iter().map(|&(id, _)| id).collect();
    let input = |chaos_type, target: Option<i64>, payload: Option<&'static str>| ResolutionInput {
        race_id: 1,
        is_test: false,
        season_id: 1,
        week_id: 1,
        week_number: 1,
        chaos_type,
        chaos_target_user_id: target,
        chaos_target_user_id2: None,
        chaos_payload: payload,
        predictions: &[],
        season_players: &players,
        shield_choice_player_ids: &[],
        configured_user_ids: &configured,
        standings: &[],
        events: &[],
        duration_ms: 60_000.0,
        tick_rate: 60.0,
    };
    for (chaos_type, target, payload) in [
        ("CONSTRUCTORS", None, Some("[[2,5,4,7],[3,6,1,14]]")),
        ("DUO", None, Some("[[2,14],[5,4],[7,3],[6,1]]")),
        ("DUO", None, Some("[[2,999],[5,4],[7,3],[6,1]]")),
        ("BOUNTY_HUNT", Some(14), None),
        ("BOUNTY_HUNT", None, None),
        ("RANDOM", None, None),
    ] {
        let card = input(chaos_type, target, payload);
        let error = preflight_card(&card).expect_err(chaos_type);
        // The same error the real resolution raises for any finish order.
        let standings: Vec<RawStanding<'_>> = [5, 3, 1, 2, 7, 6, 4]
            .iter()
            .zip(1..)
            .map(|(&user_id, rank)| RawStanding {
                rank,
                user_id,
                name: "",
            })
            .collect();
        let real = plan_resolution(&ResolutionInput {
            standings: &standings,
            ..card
        });
        assert_eq!(real.err(), Some(error.clone()), "{chaos_type}");
        if chaos_type == "RANDOM" {
            assert_eq!(
                error.to_string(),
                "Cannot read properties of undefined (reading 'resolve')"
            );
        }
    }
    for (chaos_type, target, payload) in [
        ("CONSTRUCTORS", None, Some("[[2,5,4,7],[3,6,1]]")),
        ("DUO", None, Some("[[2,3],[5,4],[7,6],[1]]")),
        ("BOUNTY_HUNT", Some(3), None),
        ("NORMAL", None, None),
        ("REVERSE", Some(14), None),
    ] {
        preflight_card(&input(chaos_type, target, payload)).expect(chaos_type);
    }
}
