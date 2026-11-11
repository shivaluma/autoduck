//! F9 (`docs/balance/S3.16.md`): every engine knob left in the resolved
//! config changes a race.
//!
//! S3.15 carried six knobs that never changed a race
//! (`itemTuning.rocketSlowMultiplier`, `itemTuning.banana*`,
//! `pickupConfig.manualItemsEnabled`, `chaosBoxEnabled`,
//! `idealManualPlayerIds`); S3.16 drops them from the resolved config. This
//! test perturbs each remaining knob of `itemTuning` and `pickupConfig` and
//! requires a different race on at least one of a few seeds, and it lists
//! the knobs from the serialized config, so a new knob without a case here
//! fails.

#![cfg(not(feature = "ts-compat"))]

use race_protocol::config::{RaceConfigInput, ResolvedRaceConfig};
use race_protocol::ids::WildItemId;

fn config(seed: u32) -> ResolvedRaceConfig {
    let items = [
        ["NITRO", "BANANA"],
        ["HOMING_ROCKET", "FEATHER"],
        ["DRAFT_FIN", "QUACK_HORN"],
        ["BUBBLE_SHIELD", "PADDLE_BURST"],
        ["SHOCK_ABSORBER", "NITRO"],
        ["BANANA", "HOMING_ROCKET"],
        ["FEATHER", "QUACK_HORN"],
        ["PADDLE_BURST", "DRAFT_FIN"],
    ];
    let players: Vec<String> = (1..=8)
        .map(|n| format!(r#"{{"playerId":"{n}","name":"Duck {n}"}}"#))
        .collect();
    let loadouts: Vec<String> = items
        .iter()
        .enumerate()
        .map(|(slot, [a, b])| {
            format!(
                r#"{{"playerId":"{}","itemIds":["{a}","{b}"],"source":"PLAYER"}}"#,
                slot + 1
            )
        })
        .collect();
    let json = format!(
        r#"{{"raceId":"knob","seed":"{seed:064x}","players":[{players}],"loadouts":[{loadouts}],
"pickupConfig":{{"enabled":true,"goldenBoxEnabled":true,"hazardsEnabled":true,
"positionAwareLoot":true,"spawnMultiplier":1.25,"regularPickupCap":3,
"autoItemsEnabled":true,"forceGoldenBox":false,"disabledItems":[]}}}}"#,
        players = players.join(","),
        loadouts = loadouts.join(","),
    );
    let input: RaceConfigInput = serde_json::from_str(&json).expect("config parses");
    input.resolve().expect("config resolves")
}

fn outcome(config: ResolvedRaceConfig) -> (String, String) {
    let digest = race_core::sim::digest_case(config, race_core::sim::SimOptions::default())
        .expect("race digests");
    (digest.state_chain_sha256, digest.events_sha256)
}

type Knob = (&'static str, fn(&mut ResolvedRaceConfig));

const KNOBS: [Knob; 12] = [
    ("itemTuning.nitroSpeedMultiplier", |c| {
        c.item_tuning.nitro_speed_multiplier = 1.35;
    }),
    ("pickupConfig.enabled", |c| c.pickup_config.enabled = false),
    ("pickupConfig.goldenBoxEnabled", |c| {
        // Force a box so that switching boxes off has something to remove.
        c.pickup_config.force_golden_box = true;
        c.pickup_config.golden_box_enabled = false;
    }),
    ("pickupConfig.goldenBoxProbability", |c| {
        c.pickup_config.golden_box_probability = 1.0;
    }),
    ("pickupConfig.hazardsEnabled", |c| {
        c.pickup_config.hazards_enabled = false;
    }),
    ("pickupConfig.positionAwareLoot", |c| {
        c.pickup_config.position_aware_loot = false;
    }),
    ("pickupConfig.spawnMultiplier", |c| {
        c.pickup_config.spawn_multiplier = 3.0;
    }),
    ("pickupConfig.regularPickupCap", |c| {
        c.pickup_config.regular_pickup_cap = 1;
    }),
    ("pickupConfig.autoItemsEnabled", |c| {
        c.pickup_config.auto_items_enabled = false;
    }),
    ("pickupConfig.forceItem", |c| {
        c.pickup_config.force_item = Some(WildItemId::Tailwind);
    }),
    ("pickupConfig.disabledItems", |c| {
        c.pickup_config.disabled_items = vec![
            WildItemId::MiniNitro,
            WildItemId::Tailwind,
            WildItemId::MiniBubble,
            WildItemId::MiniRocket,
        ];
    }),
    ("pickupConfig.forceGoldenBox", |c| {
        c.pickup_config.force_golden_box = true;
    }),
];

#[test]
fn every_remaining_knob_changes_a_race() {
    let seeds = [1_u32, 2, 3];
    let baselines: Vec<_> = seeds.iter().map(|&seed| outcome(config(seed))).collect();
    for (name, perturb) in KNOBS {
        let live = seeds.iter().zip(&baselines).any(|(&seed, baseline)| {
            let mut changed = config(seed);
            if name == "pickupConfig.goldenBoxEnabled" {
                // Compare against a forced box that stays enabled.
                let mut forced = config(seed);
                forced.pickup_config.force_golden_box = true;
                perturb(&mut changed);
                return outcome(changed) != outcome(forced);
            }
            perturb(&mut changed);
            outcome(changed) != *baseline
        });
        assert!(live, "{name} is a dead knob: no seed changes the race");
    }
}

#[test]
fn every_knob_has_a_case() {
    let config = config(1);
    let mut listed: Vec<String> = Vec::new();
    for (prefix, value) in [
        (
            "itemTuning",
            serde_json::to_value(&config.item_tuning).unwrap(),
        ),
        (
            "pickupConfig",
            serde_json::to_value(&config.pickup_config).unwrap(),
        ),
    ] {
        for key in value.as_object().expect("object").keys() {
            listed.push(format!("{prefix}.{key}"));
        }
    }
    // `forceItem` is skipped when absent; it has a case above.
    listed.push("pickupConfig.forceItem".into());
    listed.sort();
    listed.dedup();
    let mut cased: Vec<String> = KNOBS.iter().map(|(name, _)| (*name).to_owned()).collect();
    cased.sort();
    assert_eq!(listed, cased);
}
