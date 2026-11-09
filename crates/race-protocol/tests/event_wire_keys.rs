//! Pins the metadata key names of every event type (D7).
//!
//! Each row lists the keys that are always present (`required`; `nullable`
//! marks the ones TS writes as `null`) and the keys that are present only on
//! some emit paths (`optional`). The browser reads these keys
//! (`lib/racing/combat-encounters.ts`, `post-race-stats.ts`,
//! `pickup-telemetry.ts`, `components/racing/race-event-timeline.tsx`,
//! `phaser-race-canvas.tsx`), so changing a row is a wire-protocol change.
//! Source lines for every row are in `docs/rewrite/protocol-mapping.md`.

#![allow(clippy::disallowed_types)] // serde_json::Value is fine in tests.

use std::collections::BTreeSet;

use race_protocol::events::{EventKind, RaceEvent};
use serde_json::{Map, Value, json};

struct Row {
    ty: &'static str,
    required: &'static [&'static str],
    nullable: &'static [&'static str],
    optional: &'static [&'static str],
}

const fn row(
    ty: &'static str,
    required: &'static [&'static str],
    nullable: &'static [&'static str],
    optional: &'static [&'static str],
) -> Row {
    Row {
        ty,
        required,
        nullable,
        optional,
    }
}

const STARTED_REQ: &[&str] = &["untilTick", "durationSeconds", "multiplier"];
const STARTED_OPT: &[&str] = &[
    "queued",
    "draftTarget",
    "autoReason",
    "startRank",
    "startProgress",
    "drained",
];
const ENDED_REQ: &[&str] = &["consumedSeconds"];
const ENDED_OPT: &[&str] = &[
    "broken",
    "natural",
    "startProgress",
    "startRank",
    "autoReason",
];
const PICKUP_SPAWNED: &[&str] = &[
    "pickupId",
    "zoneId",
    "pickupType",
    "progress",
    "lateralOffset",
];
const GRANTED: &[&str] = &["pickupId", "instanceId", "itemId", "rank"];

/// The pinned table, in `raceEventTypeSchema` order.
const WIRE_KEYS: &[Row] = &[
    row("RACE_STARTED", &["playerCount"], &[], &[]),
    row("DUCK_COLLISION", &[], &[], &[]),
    row("ITEM_ACTIVATED", &[], &[], &[]),
    row(
        "ROCKET_FIRED",
        &[
            "autoReason",
            "decisionTargetId",
            "executeTargetId",
            "retargetedAtExecute",
        ],
        &["decisionTargetId", "executeTargetId"],
        &[],
    ),
    row("ROCKET_HIT", &["shockAbsorbed"], &[], &[]),
    row("ROCKET_BLOCKED", &["defense"], &[], &["blocked"]),
    row("ROCKET_EXPIRED", &[], &[], &[]),
    row(
        "BANANA_DROPPED",
        &["progress", "lateralOffset", "aimOffset", "autoReason"],
        &[],
        &[],
    ),
    row("BANANA_HIT", &["lateralSlip", "shockAbsorbed"], &[], &[]),
    row("BANANA_BLOCKED", &["defense"], &[], &["blocked"]),
    row("BANANA_EXPIRED", &["id"], &[], &[]),
    row("NITRO_STARTED", STARTED_REQ, &[], STARTED_OPT),
    row("NITRO_ENDED", ENDED_REQ, &[], ENDED_OPT),
    row("DRAFT_FIN_STARTED", STARTED_REQ, &[], STARTED_OPT),
    row("DRAFT_FIN_ENDED", ENDED_REQ, &[], ENDED_OPT),
    row("PADDLE_BURST_STARTED", STARTED_REQ, &[], STARTED_OPT),
    row("PADDLE_BURST_ENDED", ENDED_REQ, &[], ENDED_OPT),
    row(
        "PREDATOR_RUSH_STARTED",
        &["trigger", "multiplier", "durationSeconds", "untilTick"],
        &[],
        &[],
    ),
    row("PREDATOR_RUSH_ENDED", &[], &[], &[]),
    row(
        "BOOST_BROKEN",
        &[
            "endedItem",
            "remainingBoostTicks",
            "originalBoostTicks",
            "boostMultiplier",
            "fractionDenied",
            "breakSource",
            "partial",
        ],
        &["endedItem"],
        &["autoReason"],
    ),
    row(
        "SPEED_BOOST_QUEUED",
        &[
            "itemId",
            "durationSeconds",
            "multiplier",
            "replacedPrevious",
        ],
        &[],
        &["replacedItemId"],
    ),
    row("SHOCK_ABSORBER_PROC", &["mitigated"], &[], &[]),
    row(
        "HORN_USED",
        &[
            "targets",
            "autoReason",
            "slipstreamChargeDestroyedTicks",
            "slipstreamChargeDestroyedSeconds",
            "ducksHit",
            "side",
            "silencedSeconds",
        ],
        &[],
        &[],
    ),
    row(
        "ITEM_SILENCED",
        &["durationSeconds", "untilTick", "source"],
        &[],
        &["autoReason"],
    ),
    row("FEATHER_DODGED", &[], &[], &["blocked"]),
    row(
        "BUBBLE_SHIELD_ACTIVATED",
        &["durationSeconds", "untilTick", "autoReason"],
        &[],
        &["reflex"],
    ),
    row("BUBBLE_SHIELD_EXPIRED", &[], &[], &[]),
    row("BUBBLE_POPPED", &["blocked"], &[], &["intact"]),
    row("DUCK_FINISHED", &["finishTimeMs"], &[], &[]),
    row("RACE_FINISHED", &[], &[], &[]),
    row("CHAOS_RESOLVED", &["chaosType", "loserPlayerIds"], &[], &[]),
    row("PICKUP_ZONE_ACTIVATED", &["zoneId"], &[], &[]),
    row("PICKUP_SPAWNED", PICKUP_SPAWNED, &[], &[]),
    row(
        "PICKUP_COLLECTED",
        &["pickupId", "pickupType", "progress", "lateralOffset"],
        &[],
        &[],
    ),
    row(
        "PICKUP_SKIPPED_SLOT_FULL",
        &["pickupId", "itemId"],
        &[],
        &[],
    ),
    row("WILD_ITEM_GRANTED", GRANTED, &[], &[]),
    row("WILD_ITEM_USED", &["instanceId", "itemId"], &[], &[]),
    row(
        "WILD_ITEM_AUTO_USED",
        &["instanceId", "itemId", "autoReason"],
        &[],
        &["discarded", "forfeited"],
    ),
    row(
        "WILD_ITEM_MANUAL_INPUT",
        &["instanceId", "clientActionId", "action", "applied"],
        &[],
        &["reason"],
    ),
    row("INSTANT_PICKUP_TRIGGERED", GRANTED, &[], &[]),
    row("TAILWIND_STARTED", &["untilTick"], &[], &["autoReason"]),
    row("TAILWIND_ENDED", &[], &[], &[]),
    row("MAGNET_STARTED", &["untilTick"], &[], &["autoReason"]),
    row("MAGNET_ENDED", &[], &[], &[]),
    row(
        "MINI_BUBBLE_ACTIVATED",
        &["untilTick"],
        &[],
        &["autoReason"],
    ),
    row("MINI_BUBBLE_BLOCKED", &["blocked"], &[], &[]),
    row("MINI_BUBBLE_EXPIRED", &["expiryBoost"], &[], &[]),
    row("MINI_ROCKET_FIRED", &[], &[], &["autoReason"]),
    row("MINI_ROCKET_HIT", &["shockAbsorbed"], &[], &[]),
    row("MINI_ROCKET_BLOCKED", &["defense"], &[], &["blocked"]),
    row("MINI_ROCKET_EXPIRED", &[], &[], &[]),
    row(
        "WILD_BANANA_DROPPED",
        &["id", "progress", "lateralOffset"],
        &[],
        &["autoReason"],
    ),
    row(
        "WILD_BANANA_HIT",
        &["lateralSlip", "shockAbsorbed"],
        &[],
        &[],
    ),
    row("WILD_BANANA_BLOCKED", &["defense"], &[], &["blocked"]),
    row("WILD_BANANA_EXPIRED", &["id"], &[], &[]),
    row("WILD_HORN_USED", &["targets", "side"], &[], &["autoReason"]),
    row("WILD_FEATHER_USED", &["untilTick"], &[], &["autoReason"]),
    row("WILD_FEATHER_DODGED", &[], &[], &["hazardId", "hazardType"]),
    row(
        "HAZARD_SPAWNED",
        &[
            "hazardId",
            "zoneId",
            "hazardType",
            "progress",
            "lateralOffset",
            "radius",
        ],
        &[],
        &[],
    ),
    row("HAZARD_HIT", &["hazardId", "hazardType"], &[], &[]),
    row("HAZARD_DODGED", &["hazardId", "hazardType"], &[], &[]),
    row("GOLDEN_BOX_SPAWNED", PICKUP_SPAWNED, &[], &[]),
    row("GOLDEN_BOX_COLLECTED", &["pickupId"], &[], &[]),
    row(
        "QP_TRACK_REWARD_GRANTED",
        &["pickupId", "amount", "reason"],
        &[],
        &[],
    ),
    row(
        "BOOST_GATE_PASSED",
        &[
            "gateId",
            "laneId",
            "tier",
            "multiplier",
            "durationSeconds",
            "colorHex",
            "colorName",
            "label",
        ],
        &[],
        &[],
    ),
    row(
        "MOMENTUM_STOLEN",
        &[
            "stolenItemId",
            "brokeBoost",
            "multiplier",
            "durationSeconds",
        ],
        &[],
        &["autoReason"],
    ),
    row(
        "GUARD_SURGE",
        &["defenseItemId", "multiplier", "durationSeconds"],
        &[],
        &["blocked", "glide"],
    ),
    row("DUCK_TEMPERAMENT", &["temperament"], &[], &[]),
    row("AI_INTENT", &["intent", "itemId", "temperament"], &[], &[]),
];

/// A valid sample value for `key` in an event of type `ty`.
fn sample(ty: &str, key: &str) -> Value {
    match (ty, key) {
        ("BUBBLE_POPPED" | "FEATHER_DODGED" | "MINI_BUBBLE_BLOCKED" | "GUARD_SURGE", "blocked") => {
            json!("QUACK_HORN")
        }
        (_, "blocked") => json!(true),
        ("SPEED_BOOST_QUEUED" | "BOOST_BROKEN", "itemId" | "replacedItemId" | "endedItem") => {
            json!("NITRO")
        }
        ("AI_INTENT", "itemId") => json!("MINI_ROCKET"),
        (_, "itemId") => json!("MINI_BUBBLE"),
        ("QP_TRACK_REWARD_GRANTED", "reason") => json!("TRACK_GOLDEN_BOX"),
        (_, "reason") => json!("NO_ITEM"),
        (_, "source") => json!("WILD_HORN"),
        (_, "defense") => json!("IMMUNITY"),
        (_, "defenseItemId") => json!("SHOCK_ABSORBER"),
        (_, "trigger") => json!("BANANA"),
        (_, "reflex") => json!("ROCKET"),
        (_, "mitigated") => json!("MINI_ROCKET"),
        (_, "breakSource") => json!("WILD_BANANA"),
        (_, "stolenItemId") => json!("NITRO"),
        (_, "tier") => json!("HYPER"),
        (_, "temperament") => json!("TACTICIAN"),
        (_, "intent") => json!("TRAP_SET"),
        (_, "autoReason") => json!("END_GAME_BURN"),
        (_, "chaosType") => json!("DUO"),
        (_, "action") => json!("USE"),
        (_, "hazardType") => json!("ICE_PATCH"),
        (_, "pickupType") => json!("GOLDEN_BOX"),
        (_, "side") => json!(-1),
        (_, "targets" | "loserPlayerIds") => json!(["2", "duck-3"]),
        (_, "draftTarget" | "decisionTargetId" | "executeTargetId") => json!("5"),
        (_, "clientActionId") => json!("client-action-0001"),
        (
            _,
            "playerCount"
            | "untilTick"
            | "id"
            | "rank"
            | "startRank"
            | "remainingBoostTicks"
            | "originalBoostTicks"
            | "slipstreamChargeDestroyedTicks"
            | "ducksHit"
            | "amount",
        ) => json!(7),
        (_, "colorHex") => json!(0xffb703),
        (
            _,
            "queued"
            | "drained"
            | "broken"
            | "natural"
            | "partial"
            | "shockAbsorbed"
            | "retargetedAtExecute"
            | "intact"
            | "expiryBoost"
            | "discarded"
            | "forfeited"
            | "applied"
            | "replacedPrevious"
            | "brokeBoost"
            | "glide",
        ) => json!(true),
        (
            _,
            "durationSeconds"
            | "multiplier"
            | "consumedSeconds"
            | "startProgress"
            | "boostMultiplier"
            | "fractionDenied"
            | "progress"
            | "lateralOffset"
            | "aimOffset"
            | "lateralSlip"
            | "slipstreamChargeDestroyedSeconds"
            | "silencedSeconds"
            | "radius"
            | "finishTimeMs",
        ) => json!(0.1 + 0.2),
        (
            _,
            "gateId" | "laneId" | "colorName" | "label" | "pickupId" | "zoneId" | "hazardId"
            | "instanceId",
        ) => {
            json!("some-id:1")
        }
        _ => panic!("no sample for {ty}.{key}"),
    }
}

fn event(ty: &str, metadata: Map<String, Value>) -> Value {
    json!({
        "raceId": "42",
        "tick": 12,
        "timestampWithinRaceMs": 200,
        "type": ty,
        "sourcePlayerId": "1",
        "targetPlayerId": "2",
        "metadata": Value::Object(metadata),
        "seq": 3,
    })
}

fn metadata(row: &Row, include_optional: bool) -> Map<String, Value> {
    let mut map = Map::new();
    for key in row.required {
        map.insert((*key).into(), sample(row.ty, key));
    }
    if include_optional {
        for key in row.optional {
            map.insert((*key).into(), sample(row.ty, key));
        }
    }
    map
}

fn round_trip_keys(value: &Value) -> BTreeSet<String> {
    let typed: RaceEvent =
        serde_json::from_value(value.clone()).unwrap_or_else(|error| panic!("{error}: {value}"));
    let out = serde_json::to_value(&typed).unwrap();
    let top: BTreeSet<_> = out.as_object().unwrap().keys().cloned().collect();
    assert_eq!(
        top,
        [
            "raceId",
            "tick",
            "timestampWithinRaceMs",
            "type",
            "sourcePlayerId",
            "targetPlayerId",
            "metadata",
            "seq"
        ]
        .into_iter()
        .map(String::from)
        .collect()
    );
    out["metadata"]
        .as_object()
        .unwrap()
        .keys()
        .cloned()
        .collect()
}

#[test]
fn table_covers_every_event_type_in_order() {
    let table: Vec<_> = WIRE_KEYS.iter().map(|row| row.ty).collect();
    assert_eq!(table, EventKind::TYPE_NAMES);
}

#[test]
fn max_and_min_metadata_round_trip_to_pinned_keys() {
    for row in WIRE_KEYS {
        let all: BTreeSet<String> = row
            .required
            .iter()
            .chain(row.optional)
            .map(|key| key.to_string())
            .collect();
        assert_eq!(
            round_trip_keys(&event(row.ty, metadata(row, true))),
            all,
            "{} (max)",
            row.ty
        );
        let required: BTreeSet<String> = row.required.iter().map(|key| key.to_string()).collect();
        assert_eq!(
            round_trip_keys(&event(row.ty, metadata(row, false))),
            required,
            "{} (min)",
            row.ty
        );
    }
}

#[test]
fn nullable_keys_accept_null_and_keep_the_key() {
    for row in WIRE_KEYS {
        for key in row.nullable {
            let mut map = metadata(row, false);
            map.insert((*key).into(), Value::Null);
            let typed: RaceEvent = serde_json::from_value(event(row.ty, map)).unwrap();
            let out = serde_json::to_value(&typed).unwrap();
            assert_eq!(out["metadata"][*key], Value::Null, "{}.{key}", row.ty);
        }
    }
    // draftTarget: absent, null and a value are all distinct on the wire.
    let row = WIRE_KEYS
        .iter()
        .find(|row| row.ty == "DRAFT_FIN_STARTED")
        .unwrap();
    let mut map = metadata(row, false);
    map.insert("draftTarget".into(), Value::Null);
    let out =
        serde_json::to_value(serde_json::from_value::<RaceEvent>(event(row.ty, map)).unwrap())
            .unwrap();
    assert_eq!(out["metadata"].get("draftTarget"), Some(&Value::Null));
}

#[test]
fn missing_required_keys_are_rejected() {
    for row in WIRE_KEYS {
        for key in row
            .required
            .iter()
            .filter(|key| !row.nullable.contains(key))
        {
            let mut map = metadata(row, true);
            map.remove(*key);
            assert!(
                serde_json::from_value::<RaceEvent>(event(row.ty, map)).is_err(),
                "{} accepted metadata without {key}",
                row.ty
            );
        }
    }
}

#[test]
fn unknown_metadata_keys_are_rejected() {
    for row in WIRE_KEYS {
        let mut map = metadata(row, true);
        map.insert("notAKey".into(), json!(1));
        assert!(
            serde_json::from_value::<RaceEvent>(event(row.ty, map)).is_err(),
            "{} accepted an unknown metadata key",
            row.ty
        );
    }
}

#[test]
fn source_and_target_are_omitted_when_absent() {
    let value = json!({
        "raceId": "42", "tick": 0, "timestampWithinRaceMs": 0, "type": "RACE_FINISHED", "metadata": {}, "seq": 0,
    });
    let typed: RaceEvent = serde_json::from_value(value).unwrap();
    let out = serde_json::to_value(&typed).unwrap();
    assert!(out.get("sourcePlayerId").is_none());
    assert!(out.get("targetPlayerId").is_none());
    assert_eq!(out["metadata"], json!({}));
}

#[test]
fn seq_is_required() {
    let value = json!({
        "raceId": "42", "tick": 0, "timestampWithinRaceMs": 0, "type": "RACE_FINISHED", "metadata": {},
    });
    assert!(serde_json::from_value::<RaceEvent>(value).is_err());
}
