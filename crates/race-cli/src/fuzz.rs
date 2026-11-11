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

use std::panic::{AssertUnwindSafe, catch_unwind};

use anyhow::{Result, bail};
use race_core::serde_jcs::to_jcs_string;
use race_core::sim::{
    SimOptions, create_simulation, parse_corpus_line, result_from_simulation, snapshot_world,
    step_simulation,
};
use race_protocol::events::RaceEvent;
use rayon::prelude::*;

use crate::corpus::{Profile, generate_case_profile};

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

fn run_case(line: &str) -> Outcome {
    let Ok(case) = parse_corpus_line(line) else {
        return Outcome::Rejected;
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

/// `race-cli fuzz`: run cases `start..start+cases`; fail on any panic,
/// unfinished race or non-finite value.
pub fn run(cases: u64, start: u64, root: u64) -> Result<()> {
    let previous_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(|_| {}));
    let outcomes: Vec<(u64, Outcome)> = (start..start + cases)
        .into_par_iter()
        .map(|index| (index, run_case(&case_line(root, index))))
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
        "fuzz: {cases} configs (root seed {root:#018x}, cases {start}..{}): {finished} finished, \
         {rejected} rejected by resolve(), {} failures",
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
}
