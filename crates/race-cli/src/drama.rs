//! `race-cli balance drama`: how predictable a race is while it runs.
//!
//! The balance report (`balance run` / `mixed`) answers "is every loadout
//! fair?". This one answers "is the race worth watching to the end?": for
//! each checkpoint (the leader's progress) it measures how often the duck in
//! front at that point wins, how often the duck at the back finishes last
//! (the Chaos loser matters as much as the winner), and how well the running
//! order predicts the final order (Spearman rank correlation). It also counts
//! lead and last-place changes, late swings and photo finishes.
//!
//! Lobbies are the production shape (8 ducks, random two-item loadouts, the
//! production pickup config, every Chaos card in turn): balance case
//! `4 * index`, so the seeds are a subset of the `balance-v1` corpus.

use std::fmt::Write as _;

use anyhow::{Result, anyhow};
use race_core::sim::{SimOptions, create_simulation, result_from_simulation, step_simulation};
use race_protocol::config::RaceConfigInput;
use rayon::prelude::*;

use crate::balance::case_config;

/// Checkpoints, as the leader's progress.
const CHECKPOINTS: [f64; 5] = [0.25, 0.50, 0.75, 0.90, 0.97];
/// "Late" means after the leader passed this progress.
const LATE: f64 = 0.75;
/// A photo finish: the two ducks are closer than this at the line.
const PHOTO_MS: f64 = 150.0;

struct RaceDrama {
    /// `ranks[c][d]`: the running rank of duck `d` (final-rank order) at checkpoint `c`.
    ranks: Vec<Vec<u32>>,
    /// Rank by innate cruising speed (1 = fastest), in final-rank order.
    innate: Vec<u32>,
    lead_changes: u32,
    lead_changes_late: u32,
    last_changes: u32,
    last_changes_late: u32,
    win_gap_ms: f64,
    last_gap_ms: f64,
    spread_ms: f64,
    /// Largest number of places any duck gained or lost between the halfway point and the line.
    biggest_swing: u32,
}

fn run_case(index: u64) -> Result<RaceDrama> {
    let value = case_config(index * 4, None);
    let input: RaceConfigInput = serde_json::from_value(value)?;
    let config = input
        .resolve()
        .map_err(|error| anyhow!("case {index}: resolve: {error:?}"))?;
    let mut sim = create_simulation(
        config,
        SimOptions {
            record_events: false,
            ..SimOptions::default()
        },
        None,
    );
    let ids: Vec<String> = sim
        .ducks
        .iter()
        .map(|duck| duck.player_id.as_str().to_owned())
        .collect();
    let mut by_speed: Vec<(f64, usize)> = sim
        .ducks
        .iter()
        .enumerate()
        .map(|(slot, duck)| (duck.desired_speed, slot))
        .collect();
    by_speed.sort_by(|a, b| b.0.total_cmp(&a.0));
    let mut innate_by_slot = vec![0u32; ids.len()];
    for (rank, (_, slot)) in by_speed.iter().enumerate() {
        innate_by_slot[*slot] = rank as u32 + 1;
    }

    let max_ticks = race_core::config::maximum_ticks(sim.config.tick_rate);
    let mut snapshots: Vec<Option<Vec<u32>>> = vec![None; CHECKPOINTS.len()];
    let (mut leader, mut last): (Option<usize>, Option<usize>) = (None, None);
    let (mut lead_changes, mut lead_changes_late) = (0u32, 0u32);
    let (mut last_changes, mut last_changes_late) = (0u32, 0u32);
    while !sim.finished && sim.tick < max_ticks {
        step_simulation(&mut sim, None);
        let front = sim.ducks.iter().map(|d| d.progress).fold(0.0, f64::max);
        for (slot, checkpoint) in CHECKPOINTS.iter().enumerate() {
            if snapshots[slot].is_none() && front >= *checkpoint {
                snapshots[slot] = Some(sim.ducks.iter().map(|d| d.current_rank).collect());
            }
        }
        let count = sim.ducks.len() as u32;
        let now_leader = sim.ducks.iter().position(|d| d.current_rank == 1);
        // The fight for last only counts while the last duck is still racing.
        let now_last = sim
            .ducks
            .iter()
            .position(|d| d.current_rank == count && !d.finished);
        if leader.is_some() && now_leader != leader {
            lead_changes += 1;
            lead_changes_late += u32::from(front >= LATE);
        }
        if let (Some(before), Some(now)) = (last, now_last)
            && before != now
        {
            last_changes += 1;
            last_changes_late += u32::from(front >= LATE);
        }
        leader = now_leader;
        if now_last.is_some() {
            last = now_last;
        }
    }
    let result = result_from_simulation(&sim).map_err(|error| anyhow!("case {index}: {error}"))?;
    let order: Vec<usize> = result
        .standings
        .iter()
        .map(|entry| {
            ids.iter()
                .position(|id| id == entry.player_id.as_str())
                .expect("standing id is a duck")
        })
        .collect();
    let times: Vec<f64> = result.standings.iter().map(|e| e.finish_time_ms).collect();
    let n = times.len();
    let ranks: Vec<Vec<u32>> = snapshots
        .into_iter()
        .map(|snapshot| {
            let snapshot = snapshot.expect("the leader passed every checkpoint");
            order.iter().map(|&slot| snapshot[slot]).collect()
        })
        .collect();
    let biggest_swing = ranks[1]
        .iter()
        .enumerate()
        .map(|(final_index, &mid)| mid.abs_diff(final_index as u32 + 1))
        .max()
        .unwrap_or(0);
    Ok(RaceDrama {
        innate: order.iter().map(|&slot| innate_by_slot[slot]).collect(),
        ranks,
        lead_changes,
        lead_changes_late,
        last_changes,
        last_changes_late,
        win_gap_ms: times[1] - times[0],
        last_gap_ms: times[n - 1] - times[n - 2],
        spread_ms: times[n - 1] - times[0],
        biggest_swing,
    })
}

/// Spearman correlation of `ranks` (in final-rank order) with the final order 1..n.
fn spearman(ranks: &[u32]) -> f64 {
    let n = ranks.len() as f64;
    let d2: f64 = ranks
        .iter()
        .enumerate()
        .map(|(i, &r)| (f64::from(r) - (i as f64 + 1.0)).powi(2))
        .sum();
    1.0 - 6.0 * d2 / (n * (n * n - 1.0))
}

fn mean(values: impl Iterator<Item = f64>) -> f64 {
    let (sum, count) = values.fold((0.0, 0u32), |(s, c), v| (s + v, c + 1));
    if count == 0 {
        0.0
    } else {
        sum / f64::from(count)
    }
}

fn median(mut values: Vec<f64>) -> f64 {
    values.sort_by(f64::total_cmp);
    values[values.len() / 2]
}

/// `balance drama --races N`: the markdown report.
pub fn run(races: u64) -> Result<String> {
    let results: Vec<Result<RaceDrama>> = (0..races).into_par_iter().map(run_case).collect();
    let results = results.into_iter().collect::<Result<Vec<_>>>()?;
    let total = results.len() as f64;
    let share = |count: usize| 100.0 * count as f64 / total;
    let players = results[0].innate.len();
    let half = (players / 2) as u32;

    let mut out = String::new();
    writeln!(
        out,
        "drama {} {}: {races} races of {players} ducks (chance: win {:.1} %, last {:.1} %)\n",
        race_protocol::versions::RACE_BALANCE_VERSION,
        &race_core::ENGINE_BUILD_ID[..12],
        100.0 / players as f64,
        100.0 / players as f64,
    )?;
    writeln!(
        out,
        "| Leader at | leader wins % | last stays last % | winner was bottom half % | loser was top half % | order ρ |"
    )?;
    writeln!(out, "|---|---|---|---|---|---|")?;
    for (slot, checkpoint) in CHECKPOINTS.iter().enumerate() {
        let leader_wins = results.iter().filter(|r| r.ranks[slot][0] == 1).count();
        let last_stays = results
            .iter()
            .filter(|r| r.ranks[slot][players - 1] == players as u32)
            .count();
        let winner_back = results.iter().filter(|r| r.ranks[slot][0] > half).count();
        let loser_front = results
            .iter()
            .filter(|r| r.ranks[slot][players - 1] <= half)
            .count();
        let rho = mean(results.iter().map(|r| spearman(&r.ranks[slot])));
        writeln!(
            out,
            "| {:.0} % | {:.1} | {:.1} | {:.1} | {:.1} | {rho:.3} |",
            checkpoint * 100.0,
            share(leader_wins),
            share(last_stays),
            share(winner_back),
            share(loser_front),
        )?;
    }
    let innate_rho = mean(results.iter().map(|r| spearman(&r.innate)));
    let innate_wins = results.iter().filter(|r| r.innate[0] == 1).count();
    let innate_last = results
        .iter()
        .filter(|r| r.innate[players - 1] == players as u32)
        .count();
    writeln!(
        out,
        "\nInnate speed (decided by the seed before the start): fastest duck wins {:.1} %, slowest finishes last {:.1} %, order ρ {innate_rho:.3}.",
        share(innate_wins),
        share(innate_last),
    )?;
    writeln!(
        out,
        "Lead changes: mean {:.2} ({:.2} after {:.0} %). Last-place changes: mean {:.2} ({:.2} after {:.0} %).",
        mean(results.iter().map(|r| f64::from(r.lead_changes))),
        mean(results.iter().map(|r| f64::from(r.lead_changes_late))),
        LATE * 100.0,
        mean(results.iter().map(|r| f64::from(r.last_changes))),
        mean(results.iter().map(|r| f64::from(r.last_changes_late))),
        LATE * 100.0,
    )?;
    writeln!(
        out,
        "No late lead change: {:.1} % of races. No late last-place change: {:.1} %.",
        share(results.iter().filter(|r| r.lead_changes_late == 0).count()),
        share(results.iter().filter(|r| r.last_changes_late == 0).count()),
    )?;
    writeln!(
        out,
        "Finish gaps (median): 1st to 2nd {:.0} ms, last to second-last {:.0} ms, first to last {:.2} s. Photo finishes (< {PHOTO_MS:.0} ms): for the win {:.1} %, for last {:.1} %.",
        median(results.iter().map(|r| r.win_gap_ms).collect()),
        median(results.iter().map(|r| r.last_gap_ms).collect()),
        median(results.iter().map(|r| r.spread_ms).collect()) / 1000.0,
        share(results.iter().filter(|r| r.win_gap_ms < PHOTO_MS).count()),
        share(results.iter().filter(|r| r.last_gap_ms < PHOTO_MS).count()),
    )?;
    writeln!(
        out,
        "Biggest swing from halfway to the line: mean {:.2} places.",
        mean(results.iter().map(|r| f64::from(r.biggest_swing))),
    )?;
    Ok(out)
}
