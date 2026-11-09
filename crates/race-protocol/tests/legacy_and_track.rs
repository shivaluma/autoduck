//! `LegacyRaceConfigV1` / `LegacyRaceEvent` leniency and the DTRK/1 container.

#![allow(clippy::disallowed_types)] // serde_json::Value is fine in tests.

use race_protocol::events::RaceEvent;
use race_protocol::ids::{PlayerId, RaceId};
use race_protocol::legacy::{LegacyJson, LegacyRaceConfigV1, LegacyRaceEvent};
use race_protocol::replay_track::{
    DTRK_PREAMBLE_LEN, DtrkEngine, DtrkHeader, DtrkPreamble, DtrkQuantisation,
    FLAG_ENTITY_PER_SAMPLE, SectionId, TrackEngineImpl, TrackFidelity, TrackFormatError,
    TrackSource, read_container, track_geometry_key, write_preamble_and_header, write_section,
};
use serde_json::{Value, json};

#[test]
fn legacy_config_survives_wrong_types_and_keeps_unknown_keys() {
    let text = json!({
        "raceId": 38,                       // number where TS wrote a string
        "seed": "ab",
        "engineVersion": "1.1.0",
        "tickRate": "sixty",                // wrong type -> None
        "players": [
            { "playerId": "1", "name": "An", "isGhost": "no", "hat": "red" },
            "not a player",                 // not an object -> dropped
            { "playerId": 2, "name": "Bình" }
        ],
        "loadouts": { "oops": true },       // not a list -> []
        "chaosConfig": { "type": "OLD_CHAOS_CARD", "targetPlayerId": null, "groups": [["1", 2]] },
        "itemTuning": { "nitroSpeedMultiplier": 1.15, "retired": 3 },
        "pickupConfig": { "regularPickupCap": 2, "disabledItems": ["MEGA_NITRO"] },
        "legacyField": [1, 2.5, null, true, { "nested": "x" }]
    })
    .to_string();
    let legacy = LegacyRaceConfigV1::parse(&text).unwrap();
    assert_eq!(legacy.race_id.as_deref(), Some("38"));
    assert_eq!(legacy.tick_rate, None);
    assert!(LegacyRaceConfigV1::is_legacy_engine_version(
        legacy.engine_version.as_deref()
    ));
    // "not a player" is a string, which the struct cannot take -> dropped.
    assert_eq!(legacy.players.len(), 2);
    assert_eq!(legacy.players[0].is_ghost, None);
    assert_eq!(
        legacy.players[0].extra.get("hat"),
        Some(&LegacyJson::String("red".into()))
    );
    assert_eq!(legacy.players[1].player_id, "2");
    assert!(legacy.loadouts.is_empty());
    let chaos = legacy.chaos_config.as_ref().unwrap();
    assert_eq!(chaos.chaos_type, "OLD_CHAOS_CARD");
    assert_eq!(chaos.target_player_id, Some(None));
    assert_eq!(
        chaos.groups,
        Some(vec![vec!["1".to_string(), "2".to_string()]])
    );
    assert_eq!(
        legacy.item_tuning.as_ref().unwrap().extra.get("retired"),
        Some(&LegacyJson::Number(3.0))
    );
    assert_eq!(
        legacy.pickup_config.as_ref().unwrap().regular_pickup_cap,
        Some(2.0)
    );
    assert_eq!(
        legacy.pickup_config.as_ref().unwrap().disabled_items,
        Some(vec!["MEGA_NITRO".to_string()])
    );

    let out = serde_json::to_value(&legacy).unwrap();
    assert_eq!(
        out["legacyField"],
        json!([1, 2.5, null, true, { "nested": "x" }])
    );
    assert_eq!(out["chaosConfig"]["targetPlayerId"], Value::Null);
}

#[test]
fn legacy_parse_fails_only_on_non_objects() {
    assert!(LegacyRaceConfigV1::parse("{}").is_ok());
    assert!(LegacyRaceConfigV1::parse("[]").is_err());
    assert!(LegacyRaceConfigV1::parse("nope").is_err());
    assert!(LegacyRaceConfigV1::is_legacy_engine_version(None));
    assert!(LegacyRaceConfigV1::is_legacy_engine_version(Some("1.2.0")));
    assert!(!LegacyRaceConfigV1::is_legacy_engine_version(Some("2.0.0")));
}

fn header() -> DtrkHeader {
    DtrkHeader {
        ducks: vec![PlayerId::new("1").unwrap(), PlayerId::new("2").unwrap()],
        effects: vec!["NITRO".into(), "SLOWED".into()],
        engine: DtrkEngine {
            balance_version: "S3.16".into(),
            build: Some("21786ec0".into()),
            commit: None,
            engine_version: "2.0.0".into(),
            engine_impl: TrackEngineImpl::Rust,
        },
        fidelity: TrackFidelity::Recorded,
        first_tick: 0,
        hazard_types: vec!["ANCHOR".into()],
        last_tick: 2400,
        pickup_types: vec!["QUACK_BOX".into(), "GOLDEN_BOX".into()],
        q: DtrkQuantisation::default(),
        race_id: RaceId::new("40").unwrap(),
        result_digest: None,
        source: TrackSource::LiveRust,
        stride: 1,
        tick_rate: 60,
        track_geometry: track_geometry_key("river-01-v2", "0123456789abcdef"),
        track_version: "river-01-v2".into(),
        wild_items: vec!["MINI_ROCKET".into()],
    }
}

/// Keys sorted by UTF-16 code units at every level (plan 4.2: "sorted keys").
fn assert_sorted(value: &Value) {
    match value {
        Value::Object(map) => {
            let keys: Vec<Vec<u16>> = map.keys().map(|key| key.encode_utf16().collect()).collect();
            let mut sorted = keys.clone();
            sorted.sort();
            assert_eq!(keys, sorted, "{value}");
            map.values().for_each(assert_sorted);
        }
        Value::Array(values) => values.iter().for_each(assert_sorted),
        _ => {}
    }
}

#[test]
fn dtrk_header_is_written_with_sorted_keys_and_explicit_nulls() {
    let mut payload = Vec::new();
    write_preamble_and_header(&mut payload, 0, &header()).unwrap();
    let json_text = std::str::from_utf8(&payload[DTRK_PREAMBLE_LEN..]).unwrap();
    // serde_json (without preserve_order) would re-sort when parsing into a
    // Value, so check the raw key order in the text.
    let keys: Vec<&str> = json_text
        .split('"')
        .collect::<Vec<_>>()
        .windows(2)
        .filter(|pair| pair[1].starts_with(':'))
        .map(|pair| pair[0])
        .collect();
    let top: Vec<&str> = vec![
        "ducks",
        "effects",
        "engine",
        "balanceVersion",
        "build",
        "commit",
        "engineVersion",
        "impl",
        "fidelity",
        "firstTick",
        "hazardTypes",
        "lastTick",
        "pickupTypes",
        "q",
        "lateral",
        "progress",
        "speed",
        "raceId",
        "resultDigest",
        "source",
        "stride",
        "tickRate",
        "trackGeometry",
        "trackVersion",
        "wildItems",
    ];
    assert_eq!(keys, top);
    let value: Value = serde_json::from_str(json_text).unwrap();
    assert_sorted(&value);
    assert_eq!(value["resultDigest"], Value::Null);
    assert_eq!(value["engine"]["commit"], Value::Null);
    assert_eq!(value["trackGeometry"], "river-01-v2@01234567");
    assert_eq!(
        value["q"],
        json!({ "lateral": 32767, "progress": 16777216, "speed": 16777216 })
    );
}

#[test]
fn dtrk_container_round_trips() {
    let mut payload = Vec::new();
    write_preamble_and_header(&mut payload, FLAG_ENTITY_PER_SAMPLE, &header()).unwrap();
    write_section(&mut payload, SectionId::DuckColumns, &[1, 2, 3]);
    write_section(&mut payload, SectionId::Rockets, &[]);
    assert_eq!(&payload[..4], b"DTRK");
    assert_eq!(u16::from_le_bytes([payload[4], payload[5]]), 1);

    let container = read_container(&payload).unwrap();
    assert_eq!(container.preamble.flags, FLAG_ENTITY_PER_SAMPLE);
    assert_eq!(container.header, header());
    assert_eq!(
        container.sections,
        vec![(1u8, &[1u8, 2, 3][..]), (4u8, &[][..])]
    );

    assert!(matches!(
        read_container(&payload[..payload.len() - 1]),
        Err(TrackFormatError::Truncated { .. })
    ));
    let mut bad = payload.clone();
    bad[0] = b'X';
    assert_eq!(
        read_container(&bad).unwrap_err(),
        TrackFormatError::BadMagic
    );
    let mut bad = payload.clone();
    bad[4] = 2;
    assert_eq!(
        read_container(&bad).unwrap_err(),
        TrackFormatError::UnsupportedVersion { version: 2 }
    );
    assert!(DtrkPreamble::decode(&payload[..11]).is_err());
}

#[test]
fn legacy_config_duplicate_keys_keep_the_last_value_like_json_parse() {
    let legacy = LegacyRaceConfigV1::parse(
        r#"{"raceId":"1","engineVersion":"1.1.0","raceId":"2","players":[]}"#,
    )
    .unwrap();
    assert_eq!(legacy.race_id.as_deref(), Some("2"));
    assert!(LegacyRaceConfigV1::parse("[1]").is_err());
}

/// Shapes of the 66 dev.db `RaceEngineEvent` rows (engine 1.1.0/1.2.0) that
/// the typed `RaceEvent` refuses (review 3 M2): each lacks a metadata key the
/// current engine always writes, and none has `seq`.
const STORED_LEGACY_SHAPES: [(&str, &str); 11] = [
    ("BANANA_DROPPED", r#"{"itemId":"BANANA","progress":0.41}"#),
    ("NITRO_STARTED", r#"{"itemId":"NITRO"}"#),
    ("NITRO_ENDED", r#"{"itemId":"NITRO"}"#),
    ("ROCKET_FIRED", r#"{"itemId":"HOMING_ROCKET"}"#),
    (
        "ROCKET_HIT",
        r#"{"itemId":"HOMING_ROCKET","slowMultiplier":0.15}"#,
    ),
    ("WILD_ITEM_AUTO_USED", r#"{"wildItemId":"MINI_NITRO"}"#),
    ("HORN_USED", r#"{"itemId":"QUACK_HORN"}"#),
    ("BANANA_HIT", r#"{"itemId":"BANANA"}"#),
    ("MINI_BUBBLE_EXPIRED", r#"{}"#),
    ("WILD_BANANA_HIT", r#"{"wildItemId":"WILD_BANANA"}"#),
    ("MINI_ROCKET_HIT", r#"{"wildItemId":"MINI_ROCKET"}"#),
];

#[test]
fn stored_legacy_events_parse_without_seq_or_new_metadata() {
    for (index, (event_type, metadata)) in STORED_LEGACY_SHAPES.iter().enumerate() {
        let tick = 100 + index as u32;
        let event = LegacyRaceEvent::from_row(
            event_type,
            tick,
            f64::from(tick) * 1000.0 / 60.0,
            Some("14"),
            None,
            metadata,
        );
        assert_eq!(event.event_type, *event_type);
        assert!(matches!(event.metadata, LegacyJson::Object(_)));

        // Wire shape: no seq, absent target omitted, metadata verbatim.
        let wire = serde_json::to_value(&event).unwrap();
        assert!(wire.get("seq").is_none());
        assert!(wire.get("targetPlayerId").is_none());
        assert_eq!(
            wire["metadata"],
            serde_json::from_str::<Value>(metadata).unwrap()
        );

        // The typed (2.0) event refuses the row, which is why it must not be
        // routed through EventKind.
        let mut typed = wire.clone();
        typed["seq"] = json!(index);
        typed["raceId"] = json!("1");
        assert!(
            serde_json::from_value::<RaceEvent>(typed).is_err(),
            "{event_type} unexpectedly typed"
        );

        // Re-parse of the wire shape is lossless.
        assert_eq!(LegacyRaceEvent::parse(&wire.to_string()).unwrap(), event);
    }
    // Unparsable metadata is kept as text.
    let event = LegacyRaceEvent::from_row("RACE_STARTED", 0, 0.0, None, None, "{oops");
    assert_eq!(event.metadata, LegacyJson::String("{oops".into()));
    assert!(LegacyRaceConfigV1::is_legacy_engine_version(Some("1.2.0")));
    assert!(!LegacyRaceConfigV1::is_legacy_engine_version(Some("2.0.0")));
}

/// Every row of a real DB export (read-only), e.g. dev.db or the production
/// copy from plan step 0.6:
///
/// ```text
/// sqlite3 -readonly "file:prisma/dev.db?mode=ro" -json "SELECT e.type, e.tick,
///   e.timestampWithinRaceMs, e.sourcePlayerId, e.targetPlayerId, e.metadataJson,
///   r.engineVersion FROM RaceEngineEvent e JOIN Race r ON r.id = e.raceId" > events.json
/// RACE_PROTOCOL_LEGACY_EVENTS=events.json cargo test -p race-protocol \
///   --test legacy_and_track -- --ignored --nocapture
/// ```
#[test]
#[ignore = "needs RACE_PROTOCOL_LEGACY_EVENTS=<sqlite3 -json export>"]
fn db_export_events_all_parse_on_their_route() {
    let path =
        std::env::var("RACE_PROTOCOL_LEGACY_EVENTS").expect("set RACE_PROTOCOL_LEGACY_EVENTS");
    let rows: Vec<Value> = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let (mut legacy, mut typed_ok, mut typed_refused) = (0, 0, 0);
    for row in &rows {
        let engine = row["engineVersion"].as_str();
        assert!(
            LegacyRaceConfigV1::is_legacy_engine_version(engine),
            "2.0 rows need the typed route"
        );
        let event = LegacyRaceEvent::from_row(
            row["type"].as_str().unwrap(),
            u32::try_from(row["tick"].as_u64().unwrap()).unwrap(),
            row["timestampWithinRaceMs"].as_f64().unwrap(),
            row["sourcePlayerId"].as_str(),
            row["targetPlayerId"].as_str(),
            row["metadataJson"].as_str().unwrap(),
        );
        assert!(matches!(event.metadata, LegacyJson::Object(_)), "{row}");
        legacy += 1;
        // Only to measure the typed route: the row has no seq, and its raceId
        // is the DB foreign key, not the config raceId.
        let mut wire = serde_json::to_value(&event).unwrap();
        wire["seq"] = json!(0);
        wire["raceId"] = json!("1");
        match serde_json::from_value::<RaceEvent>(wire.clone()) {
            Ok(_) => typed_ok += 1,
            Err(error) => {
                if typed_refused < 3 {
                    println!("typed refuses {wire}: {error}");
                }
                typed_refused += 1;
            }
        }
    }
    println!(
        "{legacy} legacy rows parsed; the typed RaceEvent would accept {typed_ok} and refuse {typed_refused}"
    );
}
