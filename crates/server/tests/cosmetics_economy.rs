//! Quack Point economy and appearance: the ported `tests/cosmetic-economy.test.ts`, plus parity
//! with the TS oracle fixtures (`rewards`, `normalizeAppearance`).

// Server code, not the engine: the D4(b) type bans (HashMap/HashSet, serde_json::Value) do
// not apply (see src/lib.rs).
#![allow(clippy::disallowed_types)]

mod common;
mod cosmetics_fixture;

use std::collections::HashSet;

use autoduck_server::cosmetics::catalog;
use autoduck_server::cosmetics::economy::{
    Prediction, QuackError, QuackInput, QuackReason, apply_quack_transaction,
    official_race_quack_rewards,
};
use autoduck_server::cosmetics::inventory::{
    AppearanceError, SaveAppearanceError, appearance_json, grant_starter_cosmetics,
    normalize_appearance, save_appearance,
};
use autoduck_server::db::Db;
use cosmetics_fixture::cases;
use serde_json::{Map, Value, json};

fn predictions(value: &Value) -> Vec<Prediction> {
    value
        .as_array()
        .unwrap()
        .iter()
        .map(|prediction| Prediction {
            predictor_user_id: prediction["predictorUserId"].as_i64().unwrap(),
            target_user_id: prediction["targetUserId"].as_i64().unwrap(),
        })
        .collect()
}

fn default_appearance() -> Map<String, Value> {
    catalog()
        .default_appearance
        .iter()
        .map(|(key, id)| (key.clone(), Value::String(id.clone())))
        .collect()
}

async fn fixture_db() -> (tempfile::TempDir, Db) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("economy.db");
    common::populated_db(&path).await;
    let db = Db::open(&path).await.unwrap();
    (dir, db)
}

async fn balance(db: &Db) -> i64 {
    sqlx::query_scalar(r#"SELECT "quackPoints" FROM "SeasonPlayer" WHERE "id" = 1"#)
        .fetch_one(&db.reader)
        .await
        .unwrap()
}

async fn ledger_rows(db: &Db) -> i64 {
    sqlx::query_scalar(r#"SELECT COUNT(*) FROM "CurrencyTransaction""#)
        .fetch_one(&db.reader)
        .await
        .unwrap()
}

// ---------------------------------------------------------------------------------------------
// Oracle fixtures

#[test]
fn official_race_rewards_match_ts() {
    for case in cases("rewards") {
        let input = &case["input"];
        let losers: Vec<i64> = input["finalLoserUserIds"]
            .as_array()
            .unwrap()
            .iter()
            .map(|id| id.as_i64().unwrap())
            .collect();
        let rewards = official_race_quack_rewards(
            input["winnerUserId"].as_i64().unwrap(),
            &losers,
            &predictions(&input["predictions"]),
            input["perfectWeekEnabled"].as_bool(),
        );
        assert_eq!(
            serde_json::to_value(&rewards).unwrap(),
            case["rewards"],
            "{input}"
        );
    }
}

#[test]
fn normalize_appearance_matches_ts() {
    for case in cases("normalizeAppearance") {
        let input = case["input"].as_object().unwrap();
        match (normalize_appearance(input), case["error"].as_str()) {
            (Ok(appearance), None) => {
                // Same keys in the same order as the TS object.
                assert_eq!(
                    serde_json::to_string(&appearance_json(&appearance)).unwrap(),
                    serde_json::to_string(&case["output"]).unwrap(),
                    "{input:?}"
                );
            }
            (Err(error), Some(expected)) => assert_eq!(error.to_string(), expected),
            (result, expected) => panic!("{input:?}: Rust {result:?}, TS {expected:?}"),
        }
    }
}

// ---------------------------------------------------------------------------------------------
// tests/cosmetic-economy.test.ts

#[test]
fn official_winner_gets_5_qp_and_a_correct_two_loser_prediction_gets_2_qp() {
    let rewards = official_race_quack_rewards(
        1,
        &[7, 8],
        &[
            Prediction {
                predictor_user_id: 1,
                target_user_id: 8,
            },
            Prediction {
                predictor_user_id: 2,
                target_user_id: 4,
            },
            Prediction {
                predictor_user_id: 3,
                target_user_id: 7,
            },
        ],
        None,
    );
    assert_eq!(
        serde_json::to_value(&rewards).unwrap(),
        json!([
            { "playerId": 1, "amount": 5, "reason": "RACE_WIN" },
            { "playerId": 1, "amount": 2, "reason": "PREDICTION_WIN" },
            { "playerId": 1, "amount": 1, "reason": "PERFECT_WEEK" },
            { "playerId": 3, "amount": 2, "reason": "PREDICTION_WIN" },
        ])
    );
}

#[test]
fn large_chaos_losing_groups_reduce_prediction_payout_to_1_qp() {
    let rewards = official_race_quack_rewards(
        1,
        &[3, 4, 5, 6],
        &[Prediction {
            predictor_user_id: 2,
            target_user_id: 5,
        }],
        None,
    );
    let prediction = rewards
        .iter()
        .find(|reward| reward.reason == QuackReason::PredictionWin)
        .unwrap();
    assert_eq!(prediction.amount, 1);
}

#[test]
fn perfect_week_can_be_disabled_without_changing_base_rewards() {
    let rewards = official_race_quack_rewards(
        1,
        &[3, 4],
        &[Prediction {
            predictor_user_id: 1,
            target_user_id: 4,
        }],
        Some(false),
    );
    assert!(
        !rewards
            .iter()
            .any(|reward| reward.reason == QuackReason::PerfectWeek)
    );
    assert_eq!(rewards.iter().map(|reward| reward.amount).sum::<i64>(), 7);
}

#[test]
fn starter_catalog_provides_the_promised_distinct_customization_options() {
    let starter: HashSet<&String> = catalog().starter_ids.iter().collect();
    let count = |slot: &str| {
        catalog()
            .items
            .iter()
            .filter(|item| starter.contains(&item.id) && item.slot == slot)
            .count()
    };
    assert_eq!(count("bodyColor"), 8);
    assert_eq!(count("head"), 3);
    assert_eq!(count("outfit"), 3);
    assert_eq!(count("face"), 2);
    assert_eq!(count("trail"), 1);
}

#[test]
fn appearance_parser_only_accepts_known_slot_keys_and_requires_body_color() {
    let mut input = default_appearance();
    input.insert("exploitId".into(), json!("legendary-free"));
    assert_eq!(
        appearance_json(&normalize_appearance(&input).unwrap()),
        Value::Object(default_appearance())
    );
    let error =
        normalize_appearance(json!({"headId": "head-cap-red"}).as_object().unwrap()).unwrap_err();
    assert_eq!(error, AppearanceError::MissingBodyColor);
    assert!(error.to_string().contains("Body Color"));
}

#[tokio::test]
async fn qp_spend_cannot_make_balance_negative_and_creates_no_orphan_ledger_row() {
    let (_dir, db) = fixture_db().await;
    sqlx::query(r#"UPDATE "SeasonPlayer" SET "quackPoints" = 2 WHERE "id" = 1"#)
        .execute(&db.writer)
        .await
        .unwrap();
    let mut tx = db.begin_write().await.unwrap();
    let result = apply_quack_transaction(
        &mut tx,
        &QuackInput {
            season_player_id: 1,
            amount: -3,
            reason: "GACHA_PULL",
            idempotency_key: "test",
            ..QuackInput::default()
        },
    )
    .await;
    assert!(matches!(result, Err(QuackError::NotFound)));
    tx.rollback().await.unwrap();
    assert_eq!(balance(&db).await, 2);
    assert_eq!(ledger_rows(&db).await, 0);

    // A zero amount is refused before touching the database.
    let mut tx = db.begin_write().await.unwrap();
    let zero = QuackInput {
        season_player_id: 1,
        amount: 0,
        reason: "X",
        idempotency_key: "zero",
        ..QuackInput::default()
    };
    assert!(matches!(
        apply_quack_transaction(&mut tx, &zero).await,
        Err(QuackError::InvalidAmount)
    ));
    tx.rollback().await.unwrap();
}

#[tokio::test]
async fn golden_track_reward_is_plus_1_qp_and_idempotent() {
    // `buildGoldenTrackReward` (race side, later stage) feeds this exact input.
    let (_dir, db) = fixture_db().await;
    sqlx::query(r#"UPDATE "SeasonPlayer" SET "quackPoints" = 10 WHERE "id" = 1"#)
        .execute(&db.writer)
        .await
        .unwrap();
    let reward = QuackInput {
        season_player_id: 1,
        amount: 1,
        reason: "TRACK_GOLDEN_BOX",
        race_id: None,
        idempotency_key: "race:42:golden-box:gold:mid:a3",
        metadata_json: Some(r#"{"weekId":9,"weekNumber":4,"pickupId":"gold:mid:a3"}"#.into()),
        ..QuackInput::default()
    };
    for _ in 0..2 {
        let mut tx = db.begin_write().await.unwrap();
        let row = apply_quack_transaction(&mut tx, &reward).await.unwrap();
        tx.commit().await.unwrap();
        assert_eq!(row.idempotency_key, "race:42:golden-box:gold:mid:a3");
        assert_eq!(row.balance_after, 11);
    }
    assert_eq!(balance(&db).await, 11);
    assert_eq!(ledger_rows(&db).await, 1);
    let stored: (String, String) =
        sqlx::query_as(r#"SELECT "createdAt", "metadataJson" FROM "CurrencyTransaction" LIMIT 1"#)
            .fetch_one(&db.reader)
            .await
            .unwrap();
    assert!(stored.0.ends_with("+00:00"), "D13 timestamp: {}", stored.0);
    assert_eq!(
        stored.1,
        r#"{"weekId":9,"weekNumber":4,"pickupId":"gold:mid:a3"}"#
    );
}

#[tokio::test]
async fn server_rejects_equipping_an_unowned_cosmetic() {
    let (_dir, db) = fixture_db().await;
    let mut tx = db.begin_write().await.unwrap();
    let error = save_appearance(&mut tx, 1, &default_appearance())
        .await
        .unwrap_err();
    assert!(matches!(
        error,
        SaveAppearanceError::Invalid(AppearanceError::NotOwned(_))
    ));
    assert!(error.to_string().contains("chưa sở hữu"));

    // After the starter grant the default appearance is owned and saves.
    grant_starter_cosmetics(&mut tx, 1).await.unwrap();
    grant_starter_cosmetics(&mut tx, 1).await.unwrap();
    let mut appearance = default_appearance();
    appearance.insert("headId".into(), json!("head-tiny-crown"));
    let row = save_appearance(&mut tx, 1, &appearance).await.unwrap();
    assert_eq!(row.head_id.as_deref(), Some("head-tiny-crown"));
    assert_eq!(row.body_color_id, "body-sunshine");
    tx.commit().await.unwrap();
    let owned: i64 = sqlx::query_scalar(r#"SELECT COUNT(*) FROM "PlayerCosmetic""#)
        .fetch_one(&db.reader)
        .await
        .unwrap();
    assert_eq!(owned, catalog().starter_ids.len() as i64);
}
