//! D6 id validation and D8 config resolution.

#![allow(clippy::disallowed_types)] // serde_json::Value is fine in tests.

use race_protocol::config::{
    ChaosType, ConfigError, DEFAULT_GOLDEN_BOX_PROBABILITY, PickupConfig, RaceConfigInput,
    RaceItemTuning,
};
use race_protocol::ids::{
    ClientActionId, IdError, ItemKey, PlayerId, RaceItemId, RaceSeed, WildItemId,
};
use race_protocol::versions;
use serde_json::{Value, json};

const SEED: &str = "0123456789abcdef0123456789ABCDEF0123456789abcdef0123456789abcdef";

fn base() -> Value {
    json!({
        "raceId": "17",
        "seed": SEED,
        "players": [
            { "playerId": "1", "name": "An" },
            { "playerId": "2", "name": "Bình", "isGhost": true },
        ],
    })
}

fn resolve(value: Value) -> Result<race_protocol::config::ResolvedRaceConfig, ConfigError> {
    serde_json::from_value::<RaceConfigInput>(value)
        .unwrap()
        .resolve()
}

#[test]
fn player_ids_follow_d6() {
    for ok in ["1", "duck-12", "a:b_c-D", &"x".repeat(64)] {
        assert!(PlayerId::new(ok).is_ok(), "{ok}");
    }
    assert!(matches!(PlayerId::new(""), Err(IdError::TooShort { .. })));
    assert!(matches!(
        PlayerId::new("x".repeat(65)),
        Err(IdError::TooLong { .. })
    ));
    for bad in ["a b", "a.b", "é", "a/b", "a\u{0}"] {
        assert!(
            matches!(PlayerId::new(bad), Err(IdError::InvalidChar { .. })),
            "{bad}"
        );
    }
    assert!(serde_json::from_str::<PlayerId>("\"ok-1\"").is_ok());
    assert!(serde_json::from_str::<PlayerId>("\"not ok\"").is_err());
    assert!(serde_json::from_str::<PlayerId>("17").is_err());
}

#[test]
fn ids_order_by_bytes() {
    // ICU would put ':' and '_' before digits; Phase B uses byte order (D6).
    let mut ids: Vec<PlayerId> = ["10", "9", "_a", ":b", "A", "a"]
        .iter()
        .map(|id| PlayerId::new(*id).unwrap())
        .collect();
    ids.sort();
    let sorted: Vec<&str> = ids.iter().map(PlayerId::as_str).collect();
    assert_eq!(sorted, ["10", "9", ":b", "A", "_a", "a"]);
}

#[test]
fn client_action_ids_are_8_to_64() {
    assert!(ClientActionId::new("1234567").is_err());
    assert!(ClientActionId::new("12345678").is_ok());
    assert!(ClientActionId::new("c".repeat(64)).is_ok());
    assert!(ClientActionId::new("c".repeat(65)).is_err());
    assert!(ClientActionId::new("550e8400-e29b-41d4-a716-446655440000").is_ok());
}

#[test]
fn seeds_are_64_hex_kept_verbatim() {
    let seed = RaceSeed::new(SEED).unwrap();
    assert_eq!(seed.as_str(), SEED);
    assert!(RaceSeed::new(&SEED[1..]).is_err());
    assert!(RaceSeed::new(format!("{}g", &SEED[1..])).is_err());
}

#[test]
fn item_enums_match_ts_literals() {
    let race: Vec<&str> = RaceItemId::ALL.iter().map(|id| id.as_str()).collect();
    assert_eq!(
        race,
        [
            "NITRO",
            "DRAFT_FIN",
            "PADDLE_BURST",
            "BUBBLE_SHIELD",
            "FEATHER",
            "SHOCK_ABSORBER",
            "HOMING_ROCKET",
            "BANANA",
            "QUACK_HORN"
        ]
    );
    let wild: Vec<&str> = WildItemId::ALL.iter().map(|id| id.as_str()).collect();
    assert_eq!(
        wild,
        [
            "MINI_NITRO",
            "TAILWIND",
            "MINI_BUBBLE",
            "MINI_ROCKET",
            "BANANA",
            "QUACK_HORN",
            "FEATHER",
            "SLIPSTREAM_MAGNET"
        ]
    );
    for id in RaceItemId::ALL {
        assert_eq!(ItemKey::from(*id).as_str(), id.as_str());
    }
    for id in WildItemId::ALL {
        assert_eq!(ItemKey::from(*id).as_str(), id.as_str());
    }
    assert_eq!(
        serde_json::to_string(&RaceItemId::HomingRocket).unwrap(),
        "\"HOMING_ROCKET\""
    );
    assert_eq!(
        serde_json::from_str::<WildItemId>("\"SLIPSTREAM_MAGNET\"").unwrap(),
        WildItemId::SlipstreamMagnet
    );
}

#[test]
fn minimal_config_gets_every_default() {
    let resolved = resolve(base()).unwrap();
    assert_eq!(resolved.protocol_version, versions::RACE_PROTOCOL_VERSION);
    assert_eq!(resolved.engine_version, versions::RACE_ENGINE_VERSION);
    assert_eq!(resolved.balance_version, versions::RACE_BALANCE_VERSION);
    assert_eq!(resolved.track_version, versions::TRACK_VERSION);
    assert_eq!(
        resolved.pickup_spawn_version,
        versions::PICKUP_SPAWN_VERSION
    );
    assert_eq!(
        resolved.hazard_balance_version,
        versions::HAZARD_BALANCE_VERSION
    );
    assert_eq!(resolved.wild_item_balance_version, None);
    assert_eq!(resolved.tick_rate, 60);
    assert!(resolved.loadouts.is_empty());
    assert_eq!(resolved.chaos_config.chaos_type, ChaosType::Normal);
    assert_eq!(resolved.chaos_config.target_player_id, None);
    assert!(resolved.chaos_config.groups.is_empty());
    assert_eq!(resolved.item_tuning, RaceItemTuning::default());
    // Absent pickupConfig = pickups off (pickups/engine.ts:87-104).
    assert_eq!(resolved.pickup_config, PickupConfig::disabled());
    assert!(!resolved.players[0].is_ghost);
    assert!(resolved.players[1].is_ghost);
    assert!(resolved.is_ghost(&PlayerId::new("2").unwrap()));

    // The resolved form serialises every default; only optional extras are omitted.
    let out = serde_json::to_value(&resolved).unwrap();
    assert_eq!(
        out["chaosConfig"],
        json!({ "type": "NORMAL", "targetPlayerId": null, "groups": [] })
    );
    assert!(out.get("wildItemBalanceVersion").is_none());
    assert!(out["players"][0].get("cosmeticKey").is_none());
    assert_eq!(out["players"][0]["isGhost"], json!(false));
}

#[test]
fn present_pickup_config_uses_the_single_golden_box_default() {
    let mut value = base();
    value["pickupConfig"] = json!({});
    let pickup = resolve(value).unwrap().pickup_config;
    assert_eq!(
        pickup.golden_box_probability,
        DEFAULT_GOLDEN_BOX_PROBABILITY
    );
    assert_eq!(pickup.golden_box_probability, 0.15);
    assert!(pickup.enabled && pickup.golden_box_enabled && pickup.hazards_enabled);
    assert!(pickup.auto_items_enabled && pickup.position_aware_loot);
    assert!(!pickup.force_golden_box);
    #[cfg(feature = "s3-15-config")]
    assert!(pickup.manual_items_enabled && !pickup.chaos_box_enabled);
    assert_eq!(pickup.spawn_multiplier, 1.0);
    assert_eq!(pickup.regular_pickup_cap, 3);
    assert_eq!(pickup.force_item, None);
}

#[test]
fn awkward_floats_parse_with_correct_rounding() {
    // 17 significant digits; float_roundtrip must give the nearest f64.
    let mut value = base();
    value["pickupConfig"] = serde_json::from_str(
        r#"{ "goldenBoxProbability": 0.15000000000000002, "spawnMultiplier": 1.2499999999999998 }"#,
    )
    .unwrap();
    let text = serde_json::to_string(&value).unwrap();
    let input: RaceConfigInput = serde_json::from_str(&text).unwrap();
    let pickup = input.resolve().unwrap().pickup_config;
    assert_eq!(
        pickup.golden_box_probability.to_bits(),
        0.15000000000000002f64.to_bits()
    );
    assert_eq!(
        pickup.spawn_multiplier.to_bits(),
        1.2499999999999998f64.to_bits()
    );
}

#[test]
fn ranges_follow_the_zod_schema() {
    let cases: &[(&str, Value)] = &[
        ("itemTuning", json!({ "nitroSpeedMultiplier": 1.36 })),
        ("itemTuning", json!({ "rocketSlowMultiplier": 0.09 })),
        ("itemTuning", json!({ "bananaKnockbackMultiplier": 2.01 })),
        ("itemTuning", json!({ "bananaSlowMultiplier": 0.7 })),
        ("pickupConfig", json!({ "goldenBoxProbability": 1.01 })),
        ("pickupConfig", json!({ "spawnMultiplier": -0.1 })),
        ("pickupConfig", json!({ "regularPickupCap": 0 })),
        ("pickupConfig", json!({ "regularPickupCap": 2.5 })),
        ("pickupConfig", json!({ "regularPickupCap": 4 })),
    ];
    for (key, bad) in cases {
        let mut value = base();
        value[*key] = bad.clone();
        assert!(
            matches!(resolve(value), Err(ConfigError::OutOfRange { .. })),
            "{key} {bad}"
        );
    }
    let mut value = base();
    value["itemTuning"] = json!({ "nitroSpeedMultiplier": 1.35, "rocketSlowMultiplier": 0.1 });
    value["pickupConfig"] = json!({ "regularPickupCap": 2.0, "goldenBoxProbability": 0 });
    let resolved = resolve(value).unwrap();
    assert_eq!(resolved.item_tuning.nitro_speed_multiplier, 1.35);
    assert_eq!(resolved.pickup_config.regular_pickup_cap, 2);
    assert_eq!(resolved.pickup_config.golden_box_probability, 0.0);
}

#[test]
fn structural_checks() {
    let mut value = base();
    value["players"] = json!([{ "playerId": "1", "name": "A" }]);
    assert!(matches!(
        resolve(value),
        Err(ConfigError::PlayerCount { count: 1 })
    ));

    let mut value = base();
    value["players"] = json!(
        (0..17)
            .map(|i| json!({ "playerId": i.to_string(), "name": "x" }))
            .collect::<Vec<_>>()
    );
    assert!(matches!(
        resolve(value),
        Err(ConfigError::PlayerCount { count: 17 })
    ));

    let mut value = base();
    value["players"][1]["playerId"] = json!("1");
    assert!(matches!(
        resolve(value),
        Err(ConfigError::DuplicatePlayer { .. })
    ));

    let mut value = base();
    value["players"][0]["name"] = json!("");
    assert!(matches!(
        resolve(value),
        Err(ConfigError::PlayerName { .. })
    ));

    // 80 UTF-16 code units is the limit; an astral character counts twice.
    let mut value = base();
    value["players"][0]["name"] = json!("🦆".repeat(40));
    assert!(resolve(value).is_ok());
    let mut value = base();
    value["players"][0]["name"] = json!(format!("{}a", "🦆".repeat(40)));
    assert!(matches!(
        resolve(value),
        Err(ConfigError::PlayerName { utf16_len: 81, .. })
    ));

    let mut value = base();
    value["loadouts"] =
        json!([{ "playerId": "1", "itemIds": ["NITRO", "BANANA", "FEATHER"], "source": "AUTO" }]);
    assert!(matches!(
        resolve(value),
        Err(ConfigError::LoadoutSize { count: 3, .. })
    ));

    let mut value = base();
    value["tickRate"] = json!(30);
    assert!(matches!(resolve(value), Err(ConfigError::TickRate { .. })));
    let mut value = base();
    value["tickRate"] = json!(60.0);
    assert!(resolve(value).is_ok());

    let mut value = base();
    value["engineVersion"] = json!("1.2.0");
    assert!(matches!(
        resolve(value),
        Err(ConfigError::LegacyEngineVersion { .. })
    ));
    let mut value = base();
    value["balanceVersion"] = json!("");
    assert!(matches!(
        resolve(value),
        Err(ConfigError::EmptyVersion {
            field: "balanceVersion"
        })
    ));

    // Bad ids fail at parse time.
    let mut value = base();
    value["players"][0]["playerId"] = json!("has space");
    assert!(serde_json::from_value::<RaceConfigInput>(value).is_err());
    let mut value = base();
    value["seed"] = json!("abc");
    assert!(serde_json::from_value::<RaceConfigInput>(value).is_err());
}

#[test]
fn chaos_target_absent_or_null_resolve_to_none() {
    for chaos in [
        json!({ "type": "BOUNTY_HUNT" }),
        json!({ "type": "BOUNTY_HUNT", "targetPlayerId": null }),
    ] {
        let mut value = base();
        value["chaosConfig"] = chaos;
        let resolved = resolve(value).unwrap();
        assert_eq!(resolved.chaos_config.chaos_type, ChaosType::BountyHunt);
        assert_eq!(resolved.chaos_config.target_player_id, None);
    }
    let mut value = base();
    value["chaosConfig"] = json!({ "type": "DUO", "targetPlayerId": "2", "groups": [["1", "2"]] });
    let resolved = resolve(value).unwrap();
    assert_eq!(
        resolved.chaos_config.target_player_id.unwrap().as_str(),
        "2"
    );
    assert_eq!(resolved.chaos_config.groups.len(), 1);
}

#[test]
fn unknown_config_keys_are_ignored_like_zod() {
    let mut value = base();
    value["somethingNew"] = json!({ "x": 1 });
    assert!(resolve(value).is_ok());
}

/// Review 3 M3: a 2.0 engine refuses labels that don't describe its code.
#[test]
fn resolve_refuses_foreign_version_labels() {
    let cases = [
        ("engineVersion", "9.9.9"),
        ("engineVersion", "2.0.0-rc.1+anything"),
        ("engineVersion", "2.0.1"),
        ("protocolVersion", "1.0.0"),
        ("balanceVersion", "S3.15"),
        ("trackVersion", "river-01-v1"),
        ("pickupSpawnVersion", "pickups-v1"),
        ("hazardBalanceVersion", "bogus"),
    ];
    for (field, label) in cases {
        let mut value = base();
        value[field] = json!(label);
        match resolve(value) {
            Err(ConfigError::UnsupportedVersion { field: got, value }) => {
                assert_eq!((got, value.as_str()), (field, label));
            }
            other => panic!("{field}={label}: expected UnsupportedVersion, got {other:?}"),
        }
    }
    // The D2 labels spelled out are accepted.
    let mut value = base();
    value["engineVersion"] = json!(versions::RACE_ENGINE_VERSION);
    value["protocolVersion"] = json!(versions::RACE_PROTOCOL_VERSION);
    value["balanceVersion"] = json!(versions::RACE_BALANCE_VERSION);
    value["trackVersion"] = json!(versions::TRACK_VERSION);
    value["pickupSpawnVersion"] = json!(versions::PICKUP_SPAWN_VERSION);
    value["hazardBalanceVersion"] = json!(versions::HAZARD_BALANCE_VERSION);
    value["wildItemBalanceVersion"] = json!("wild-items-v6");
    assert!(resolve(value).is_ok());
}

/// Review 3 M1: the oracle resolver reproduces Zod's S3.15 defaults.
#[cfg(feature = "ts-compat")]
#[test]
fn ts_compat_resolver_uses_zod_defaults() {
    let mut value = base();
    value["pickupConfig"] = json!({ "enabled": false });
    value["engineVersion"] = json!("1.2.0");
    value["hazardBalanceVersion"] = json!("bogus");
    let input: RaceConfigInput = serde_json::from_value(value).unwrap();
    let resolved = input.resolve_ts_compat().unwrap();
    assert_eq!(
        resolved.pickup_config.golden_box_probability.to_bits(),
        0.12f64.to_bits()
    );
    assert_eq!(resolved.engine_version, "1.2.0");
    assert_eq!(resolved.hazard_balance_version, "bogus");
    assert_eq!(resolved.balance_version, "S3.15");
    assert_eq!(resolved.protocol_version, "1.0.0");
    assert_eq!(resolved.pickup_spawn_version, "pickups-v1");
    // The engine resolver still refuses the legacy config.
    assert!(matches!(
        input.resolve(),
        Err(ConfigError::LegacyEngineVersion { .. })
    ));
}
