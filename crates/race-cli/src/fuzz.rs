//! `race-cli fuzz` (plan §3 Phase 6): random configs through the shipped
//! engine. Gate: 0 panics, 0 non-finishing races, 0 non-finite values.
//!
//! Configs come from the corpus generator ([`crate::corpus`]) with a fuzz
//! root seed: lobbies of 2-16 (ghosts included), every Chaos card, pickups
//! on and off, awkward 17-digit floats, and every fourth case from the
//! `items` profile (all loadout combos, forced golden boxes, manual
//! wild-item inputs). A config the resolver rejects is counted, not a
//! failure. For an accepted one, every event and a world snapshot every 60
//! ticks (plus the final one and the result) must serialise to JCS, which
//! refuses NaN and infinities.
//!
//! `--adversarial` mutates each generated config once or twice first
//! ([`mutate`]): extreme or wrong-typed numbers, dropped or emptied fields,
//! duplicate, foreign or malformed ids, empty/overlapping/foreign Chaos
//! groups, all-ghost lobbies, and manual wild-item inputs for past,
//! far-future or unknown ticks, players and items. Parsing and resolving run
//! under `catch_unwind` too, so a rejection must be an `Err`, never a panic.
//! Most mutated configs are rejected; the rest must still finish cleanly.

use std::panic::{AssertUnwindSafe, catch_unwind};

use anyhow::{Result, bail};
use race_core::serde_jcs::to_jcs_string;
use race_core::sim::{
    SimOptions, create_simulation, parse_corpus_line, result_from_simulation, snapshot_world,
    step_simulation,
};
use race_protocol::events::RaceEvent;
use rayon::prelude::*;

use serde_json::{Value, json};

use crate::corpus::{Profile, SplitMix64, generate_case_profile};

/// Default fuzz root seed ("FUZZRACE").
pub const FUZZ_ROOT_SEED: u64 = 0x4655_5A5A_5241_4345;

enum Outcome {
    Rejected,
    Finished,
    Unfinished(u32),
    NonFinite(String),
    Panic(String),
}

fn case_line(root: u64, index: u64) -> String {
    let profile = if index % 4 == 3 {
        Profile::Items
    } else {
        Profile::Full
    };
    let (json, _) = generate_case_profile(root, index, profile);
    let mut line = String::new();
    json.write(&mut line);
    line
}

/// Numbers an adversarial mutation puts in place of a number.
const EXTREME_NUMBERS: [f64; 14] = [
    0.0,
    -0.0,
    -1.0,
    1.0,
    0.5,
    1e-9,
    5e-324,
    1e308,
    -1e308,
    4_294_967_296.0,
    9_007_199_254_740_993.0,
    255.0,
    1000.0,
    16.0,
];

/// Every node path of `value` (object keys and array indices).
fn paths(value: &Value, prefix: &mut Vec<Value>, out: &mut Vec<Vec<Value>>) {
    out.push(prefix.clone());
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                prefix.push(Value::String(key.clone()));
                paths(child, prefix, out);
                prefix.pop();
            }
        }
        Value::Array(items) => {
            for (index, child) in items.iter().enumerate() {
                prefix.push(json!(index));
                paths(child, prefix, out);
                prefix.pop();
            }
        }
        _ => {}
    }
}

fn node_mut<'v>(mut value: &'v mut Value, path: &[Value]) -> &'v mut Value {
    for step in path {
        value = match step {
            Value::String(key) => &mut value[key.as_str()],
            Value::Number(index) => {
                let index = usize::try_from(index.as_u64().unwrap_or(0)).unwrap_or(0);
                &mut value[index]
            }
            _ => unreachable!(),
        };
    }
    value
}

fn pick<'a, T>(rng: &mut SplitMix64, items: &'a [T]) -> &'a T {
    &items[usize::try_from(rng.below(items.len() as u64)).unwrap_or(0)]
}

/// One adversarial mutation of a corpus config.
fn mutate_once(config: &mut Value, rng: &mut SplitMix64) {
    let player_ids: Vec<Value> = config["players"]
        .as_array()
        .map(|players| players.iter().map(|p| p["playerId"].clone()).collect())
        .unwrap_or_default();
    let any_id = |rng: &mut SplitMix64| -> Value {
        if player_ids.is_empty() || rng.percent(10) {
            pick(
                rng,
                &[
                    json!("nobody"),
                    json!(""),
                    json!("a|b"),
                    json!("x".repeat(65)),
                ],
            )
            .clone()
        } else {
            pick(rng, &player_ids).clone()
        }
    };
    match rng.below(12) {
        // Chaos groups: empty, overlapping, foreign, duplicated.
        0 => {
            let kind = pick(
                rng,
                &["DUO", "TRIPLE_ELIMINATION", "CONSTRUCTORS", "BOUNTY_HUNT"],
            );
            let mut groups = Vec::new();
            for _ in 0..rng.range_inclusive(0, 4) {
                let group: Vec<Value> = (0..rng.range_inclusive(0, 3))
                    .map(|_| any_id(rng))
                    .collect();
                groups.push(Value::Array(group));
            }
            config["chaosConfig"] =
                json!({ "type": kind, "groups": groups, "targetPlayerId": any_id(rng) });
        }
        // Every duck a ghost, or a duplicated / single / emptied lobby.
        1 => {
            if let Some(players) = config["players"].as_array_mut() {
                match rng.below(4) {
                    0 => players
                        .iter_mut()
                        .filter_map(Value::as_object_mut)
                        .for_each(|p| {
                            p.insert("isGhost".to_owned(), json!(true));
                        }),
                    1 => {
                        if let Some(first) = players.first().cloned() {
                            players.push(first);
                        }
                    }
                    2 => players.truncate(1),
                    _ => players.clear(),
                }
            }
        }
        // Manual wild-item inputs at past, far-future or nonsense ticks.
        2 => {
            let inputs: Vec<Value> = (0..rng.range_inclusive(1, 4))
                .map(|i| {
                    json!({
                        "raceId": config["raceId"].clone(),
                        "playerId": any_id(rng),
                        "wildItemInstanceId": pick(rng, &["wild:x:y:z", "", "nope", "wild:1:p0:a"]),
                        "action": if rng.percent(90) { "USE" } else { "FIRE" },
                        "clientActionId": format!("client-action-{i}"),
                        "authoritativeTick": *pick(rng, &[0_u64, 1, 2, 60, 3599, 100_000, u64::from(u32::MAX)]),
                    })
                })
                .collect();
            config["oracleManualInputs"] = Value::Array(inputs);
        }
        // Loadouts for unknown players, unknown or repeated items.
        3 => {
            config["loadouts"] = json!([{
                "playerId": any_id(rng),
                "itemIds": pick(rng, &[json!([]), json!(["NITRO", "NITRO"]), json!(["BANANA", "BANANA"]),
                    json!(["NITRO", "FEATHER", "QUACK_HORN"]), json!(["HOMING_ROCKET", "BUBBLE_SHIELD"])]),
                "source": pick(rng, &["AUTO", "PLAYER", "AUTO", "PLAYER", "??"]),
            }]);
        }
        // Any node: an extreme number, a wrong type, null, removal, empty.
        _ => {
            let mut all = Vec::new();
            paths(config, &mut Vec::new(), &mut all);
            // Mostly numeric leaves: those are the values a resolver lets
            // through to the engine.
            let numeric: Vec<Vec<Value>> = all
                .iter()
                .filter(|path| node_mut(config, path).is_number())
                .cloned()
                .collect();
            if !numeric.is_empty() && rng.percent(70) {
                let path = pick(rng, &numeric).clone();
                *node_mut(config, &path) = json!(*pick(rng, &EXTREME_NUMBERS));
                return;
            }
            let path = pick(rng, &all[1..]).clone();
            let node = node_mut(config, &path);
            *node = match rng.below(6) {
                0 | 1 => json!(*pick(rng, &EXTREME_NUMBERS)),
                2 => Value::Null,
                3 => json!(""),
                4 => match node {
                    Value::Array(_) => json!([]),
                    Value::Object(_) => json!({}),
                    Value::Bool(b) => json!(!*b),
                    _ => json!(true),
                },
                _ => {
                    // Remove the key (or the array element) entirely.
                    if let Some((last, parent)) = path.split_last() {
                        let parent = node_mut(config, parent);
                        match (parent, last) {
                            (Value::Object(map), Value::String(key)) => {
                                map.remove(key);
                            }
                            (Value::Array(items), Value::Number(index)) => {
                                let index =
                                    usize::try_from(index.as_u64().unwrap_or(0)).unwrap_or(0);
                                if index < items.len() {
                                    items.remove(index);
                                }
                            }
                            _ => {}
                        }
                    }
                    return;
                }
            };
        }
    }
}

/// [`mutate_once`] once or twice, seeded by `(root, index)`.
fn mutate(line: &str, root: u64, index: u64) -> String {
    let Ok(mut config) = serde_json::from_str::<Value>(line) else {
        return line.to_owned();
    };
    let mut rng = SplitMix64::new(root ^ index.wrapping_mul(0x9E37_79B9_7F4A_7C15) ^ 0xAD5E);
    for _ in 0..rng.range_inclusive(1, 2) {
        mutate_once(&mut config, &mut rng);
    }
    config.to_string()
}

fn run_case(line: &str) -> Outcome {
    let parsed = catch_unwind(AssertUnwindSafe(|| parse_corpus_line(line)));
    let case = match parsed {
        Ok(Ok(case)) => case,
        Ok(Err(_)) => return Outcome::Rejected,
        Err(_) => return Outcome::Panic("parse/resolve panicked".to_owned()),
    };
    let result = catch_unwind(AssertUnwindSafe(|| {
        let mut bad: Option<String> = None;
        let mut sink = |event: &RaceEvent| {
            if bad.is_none()
                && let Err(error) = to_jcs_string(event)
            {
                bad = Some(format!(
                    "event {} tick {}: {error}",
                    event.type_name(),
                    event.tick
                ));
            }
        };
        let mut sim = create_simulation(
            case.config,
            SimOptions {
                record_events: false,
                manual_inputs: case.manual_inputs,
                ..SimOptions::default()
            },
            Some(&mut sink),
        );
        let max_ticks = race_core::config::maximum_ticks(sim.config.tick_rate);
        let mut world_error: Option<String> = None;
        while !sim.finished && sim.tick < max_ticks {
            step_simulation(&mut sim, Some(&mut sink));
            if (sim.tick.is_multiple_of(60) || sim.finished)
                && world_error.is_none()
                && let Err(error) = to_jcs_string(&snapshot_world(&sim))
            {
                world_error = Some(format!("world tick {}: {error}", sim.tick));
            }
        }
        if let Some(error) = bad.or(world_error) {
            return Outcome::NonFinite(error);
        }
        if !sim.finished {
            return Outcome::Unfinished(sim.tick);
        }
        match result_from_simulation(&sim) {
            Ok(result) => match to_jcs_string(&result.standings) {
                Ok(_) => Outcome::Finished,
                Err(error) => Outcome::NonFinite(format!("standings: {error}")),
            },
            Err(error) => Outcome::NonFinite(format!("result: {error}")),
        }
    }));
    result.unwrap_or_else(|payload| {
        let message = payload
            .downcast_ref::<&str>()
            .map(|s| (*s).to_owned())
            .or_else(|| payload.downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "non-string panic".to_owned());
        Outcome::Panic(message)
    })
}

/// `race-cli fuzz`: run cases `start..start+cases` (mutated first with
/// `adversarial`); fail on any panic, unfinished race or non-finite value.
pub fn run(cases: u64, start: u64, root: u64, adversarial: bool) -> Result<()> {
    let previous_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(|_| {}));
    let outcomes: Vec<(u64, Outcome)> = (start..start + cases)
        .into_par_iter()
        .map(|index| {
            let line = case_line(root, index);
            let line = if adversarial {
                mutate(&line, root, index)
            } else {
                line
            };
            (index, run_case(&line))
        })
        .collect();
    std::panic::set_hook(previous_hook);
    let (mut rejected, mut finished) = (0u64, 0u64);
    let mut failures: Vec<String> = Vec::new();
    for (index, outcome) in outcomes {
        match outcome {
            Outcome::Rejected => rejected += 1,
            Outcome::Finished => finished += 1,
            Outcome::Unfinished(tick) => {
                failures.push(format!("case {index}: unfinished at tick {tick}"));
            }
            Outcome::NonFinite(message) => {
                failures.push(format!("case {index}: non-finite: {message}"));
            }
            Outcome::Panic(message) => failures.push(format!("case {index}: panic: {message}")),
        }
    }
    println!(
        "fuzz{}: {cases} configs (root seed {root:#018x}, cases {start}..{}): {finished} finished, \
         {rejected} rejected by resolve(), {} failures",
        if adversarial { " --adversarial" } else { "" },
        start + cases,
        failures.len()
    );
    for failure in failures.iter().take(20) {
        println!("  {failure}");
    }
    if !failures.is_empty() {
        bail!("{} of {cases} configs failed", failures.len());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_few_fuzz_cases_finish() {
        // Case 3 is an `items` case; the rest are `full`.
        for index in 0..4 {
            match run_case(&case_line(FUZZ_ROOT_SEED, index)) {
                Outcome::Finished | Outcome::Rejected => {}
                Outcome::Unfinished(tick) => panic!("case {index}: unfinished at {tick}"),
                Outcome::NonFinite(message) | Outcome::Panic(message) => {
                    panic!("case {index}: {message}")
                }
            }
        }
    }

    /// The shipped engine only: S3.15 (`ts-compat`) accepts the empty Chaos
    /// groups F11 rejects, and those average to NaN.
    #[cfg(not(feature = "ts-compat"))]
    #[test]
    fn adversarial_cases_never_panic() {
        for index in 0..24 {
            let line = mutate(&case_line(FUZZ_ROOT_SEED, index), FUZZ_ROOT_SEED, index);
            match run_case(&line) {
                Outcome::Finished | Outcome::Rejected => {}
                Outcome::Unfinished(tick) => panic!("case {index}: unfinished at {tick}"),
                Outcome::NonFinite(message) | Outcome::Panic(message) => {
                    panic!("case {index}: {message}\n{line}")
                }
            }
        }
    }
}
