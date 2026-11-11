//! River events (S3.17, `sim::river`): the schedule, the order of the event
//! stream and the bounds of every effect. `ts-compat` builds have none.

#![allow(clippy::float_cmp)]

use race_core::sim::river::create_river_state;

fn seed(index: u32) -> String {
    format!("{:064x}", u64::from(index) * 0x9E37_79B9 + 17)
}

#[test]
fn ts_compat_has_no_river_events() {
    let state = create_river_state(&seed(1), 8);
    assert_eq!(state.events.is_empty(), race_core::TS_COMPAT);
}

#[cfg(not(feature = "ts-compat"))]
mod s3_17 {
    use race_core::sim::river::{RiverPhase, river_balance};
    use race_core::sim::{SimOptions, create_simulation, step_simulation};
    use race_protocol::events::{EventKind, RiverEventKind};

    use super::*;

    fn config(seed: &str, players: u32) -> race_protocol::config::ResolvedRaceConfig {
        let list: Vec<String> = (1..=players)
            .map(|index| format!(r#"{{"playerId":"{index}","name":"Duck {index}"}}"#))
            .collect();
        let json = format!(
            r#"{{"raceId":"river-test","seed":"{seed}","players":[{}]}}"#,
            list.join(",")
        );
        let input: race_protocol::config::RaceConfigInput =
            serde_json::from_str(&json).expect("config parses");
        input.resolve().expect("config resolves")
    }

    #[test]
    fn every_race_rolls_two_different_events_inside_their_windows() {
        let mut seen = std::collections::BTreeSet::new();
        for index in 0..200 {
            let state = create_river_state(&seed(index), 8);
            assert_eq!(state.events.len(), 2);
            let (mid, late) = (&state.events[0], &state.events[1]);
            assert_ne!(mid.kind, late.kind);
            assert!(
                (river_balance::MID_TRIGGER.0..river_balance::MID_TRIGGER.1)
                    .contains(&mid.trigger_progress)
            );
            assert!(
                (river_balance::LATE_TRIGGER.0..river_balance::LATE_TRIGGER.1)
                    .contains(&late.trigger_progress)
            );
            assert_eq!(mid.phase, RiverPhase::Pending);
            seen.insert(mid.kind.as_str());
            seen.insert(late.kind.as_str());
        }
        assert_eq!(seen.len(), 4, "every kind shows up: {seen:?}");
    }

    #[test]
    fn the_schedule_depends_on_the_seed_only() {
        assert_eq!(
            create_river_state(&seed(3), 8).events,
            create_river_state(&seed(3), 8).events
        );
        // The lobby size only changes the number of gust draws.
        let (small, large) = (
            create_river_state(&seed(3), 8),
            create_river_state(&seed(3), 14),
        );
        assert_eq!(small.events[0].kind, large.events[0].kind);
        assert_eq!(
            small.events[0].trigger_progress,
            large.events[0].trigger_progress
        );
    }

    #[test]
    fn a_solo_duck_gets_no_events() {
        assert!(create_river_state(&seed(1), 1).events.is_empty());
    }

    /// Runs a race; returns its river events and checks the per-tick bounds.
    fn run(index: u32) -> Vec<(u32, EventKind)> {
        let mut sim = create_simulation(
            config(&seed(index), 8),
            SimOptions {
                record_events: true,
                ..SimOptions::default()
            },
            None,
        );
        let base = race_core::config::base_speed() / f64::from(sim.config.tick_rate);
        while !sim.finished && sim.tick < 90 * 60 {
            let before: Vec<f64> = sim.ducks.iter().map(|duck| duck.progress).collect();
            step_simulation(&mut sim, None);
            for (duck, before) in sim.ducks.iter().zip(before) {
                let moved = duck.progress - before;
                assert!(moved >= 0.0, "a duck never moves backwards");
                assert!(moved < base * 2.2, "no teleport: {moved} per tick");
            }
        }
        assert!(sim.finished, "race {index} finishes");
        sim.events()
            .iter()
            .filter(|event| {
                matches!(
                    event.kind,
                    EventKind::RiverEventWarning(_)
                        | EventKind::RiverEventStarted(_)
                        | EventKind::RiverEventEnded(_)
                )
            })
            .map(|event| (event.tick, event.kind.clone()))
            .collect()
    }

    #[test]
    fn events_are_announced_then_run_one_at_a_time() {
        for index in 0..40 {
            let events = run(index);
            // Warning, start, end for the mid event, then for the late one
            // (the late event can be cut short by the finish, never skipped
            // entirely: its window opens at 84 % at the latest).
            assert!(events.len() >= 4, "race {index}: {events:?}");
            let mut previous_end = 0;
            for chunk in events.chunks(3) {
                let (warn_tick, EventKind::RiverEventWarning(warning)) = &chunk[0] else {
                    panic!("race {index}: expected a warning, got {:?}", chunk[0]);
                };
                assert!(*warn_tick >= previous_end, "events never overlap");
                assert_eq!(warning.start_tick - warn_tick, 150, "2.5 s of warning");
                let Some((start_tick, EventKind::RiverEventStarted(started))) = chunk.get(1) else {
                    continue; // The race ended during the warning.
                };
                assert_eq!(*start_tick, warning.start_tick);
                assert_eq!(started.kind, warning.kind);
                for effect in &started.effects {
                    assert!((0.7..=1.2).contains(&effect.multiplier), "{effect:?}");
                    match started.kind {
                        RiverEventKind::Whirlpool => assert!(effect.multiplier < 1.0),
                        RiverEventKind::FlashFlood | RiverEventKind::BreadRain => {
                            assert!(effect.multiplier > 1.0);
                        }
                        RiverEventKind::Gust => {}
                    }
                }
                match started.kind {
                    RiverEventKind::Whirlpool => assert!(started.effects.len() <= 3),
                    RiverEventKind::BreadRain => assert!(started.effects.len() <= 4),
                    RiverEventKind::FlashFlood => assert!(started.effects.len() <= 7),
                    RiverEventKind::Gust => {}
                }
                if let Some((end_tick, EventKind::RiverEventEnded(ended))) = chunk.get(2) {
                    assert_eq!(*end_tick, started.end_tick);
                    assert_eq!(ended.kind, started.kind);
                    previous_end = *end_tick;
                }
            }
        }
    }

    #[test]
    fn the_same_seed_replays_the_same_events() {
        assert_eq!(run(7), run(7));
    }
}
