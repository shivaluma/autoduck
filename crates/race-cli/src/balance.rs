//! `race-cli balance`: the paired Rust-vs-Rust balance report of Phase 6
//! (`docs/balance/S3.16.md`).
//!
//! `balance run` simulates a fixed, production-shaped corpus (default 300
//! races: 8-14 numeric player ids, a two-item loadout for every duck, every
//! Chaos card in turn, the production pickup config of `lib/season3-race.ts`)
//! and writes per-race outcomes plus aggregates as JSON. `balance compare`
//! turns two such files into the markdown section appended to the balance
//! doc. Both sides use the same seeds and lobbies, so a fix's effect is the
//! difference between two runs of this command on consecutive commits.
//!
//! Races run in parallel; results are folded in case order, so the output
//! is identical for any thread count.

use std::collections::BTreeMap;
use std::fmt::Write as _;

use anyhow::{Context, Result, anyhow};
use race_core::sim::{SimOptions, create_simulation, result_from_simulation, step_simulation};
use race_protocol::config::RaceConfigInput;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::corpus::SplitMix64;

/// Root seed of the balance corpus ("BALANCE6").
pub const BALANCE_ROOT_SEED: u64 = 0x4241_4C41_4E43_4536;
/// Bump when [`case_config`] changes for a given index.
pub const BALANCE_CORPUS_VERSION: &str = "balance-v1";

const ITEMS: [&str; 9] = [
    "NITRO",
    "DRAFT_FIN",
    "PADDLE_BURST",
    "BUBBLE_SHIELD",
    "FEATHER",
    "SHOCK_ABSORBER",
    "HOMING_ROCKET",
    "BANANA",
    "QUACK_HORN",
];
const CHAOS: [&str; 8] = [
    "NORMAL",
    "REVERSE",
    "DUO",
    "TRIPLE_ELIMINATION",
    "CUT_LINE",
    "CONSTRUCTORS",
    "BOUNTY_HUNT",
    "NORMAL",
];
const LOBBIES: [u64; 4] = [8, 10, 12, 14];

/// Options of one `balance run`.
pub struct RunOptions {
    pub cases: u64,
    /// Overrides `pickupConfig.goldenBoxProbability`; `None` leaves it out so
    /// the resolver default applies.
    pub golden_box_probability: Option<f64>,
}

/// The config of balance case `index`.
pub fn case_config(index: u64, golden_box_probability: Option<f64>) -> Value {
    let mut rng = SplitMix64::new(BALANCE_ROOT_SEED ^ index.wrapping_mul(0x9E37_79B9_7F4A_7C15));
    let lobby = LOBBIES[(index % 4) as usize];
    let mut ids: Vec<String> = Vec::new();
    while (ids.len() as u64) < lobby {
        let id = (1 + rng.below(400)).to_string();
        if !ids.contains(&id) {
            ids.push(id);
        }
    }
    let seed: String = (0..4).map(|_| format!("{:016x}", rng.next_u64())).collect();
    let players: Vec<Value> = ids
        .iter()
        .enumerate()
        .map(|(slot, id)| json!({"playerId": id, "name": format!("Duck {slot}")}))
        .collect();
    let loadouts: Vec<Value> = ids
        .iter()
        .map(|id| {
            let first = rng.below(9) as usize;
            let second = (first + 1 + rng.below(8) as usize) % 9;
            json!({"playerId": id, "itemIds": [ITEMS[first], ITEMS[second]], "source": "PLAYER"})
        })
        .collect();
    let chaos_type = CHAOS[((index / 4) % 8) as usize];
    let mut members = ids.clone();
    rng.shuffle(&mut members);
    let chaos = match chaos_type {
        "DUO" => {
            let mut groups: Vec<Vec<String>> = members.chunks(2).map(<[String]>::to_vec).collect();
            if let Some(last) = groups.pop_if(|group| group.len() == 1) {
                groups
                    .last_mut()
                    .expect("lobbies have 8+ ducks")
                    .extend(last);
            }
            json!({"type": chaos_type, "targetPlayerId": null, "groups": groups})
        }
        "CONSTRUCTORS" => {
            let split = members.len() / 2;
            json!({"type": chaos_type, "targetPlayerId": null,
                   "groups": [members[..split].to_vec(), members[split..].to_vec()]})
        }
        "BOUNTY_HUNT" => json!({"type": chaos_type, "targetPlayerId": members[0]}),
        _ => json!({"type": chaos_type, "targetPlayerId": null}),
    };
    let mut pickups = json!({
        "enabled": true,
        "goldenBoxEnabled": true,
        "hazardsEnabled": true,
        "positionAwareLoot": true,
        "spawnMultiplier": 1.25,
        "regularPickupCap": 3,
        "autoItemsEnabled": true,
        "forceGoldenBox": false,
        "disabledItems": [],
    });
    if let Some(probability) = golden_box_probability {
        pickups["goldenBoxProbability"] = json!(probability);
    }
    json!({
        "raceId": format!("balance-{index:04}"),
        "seed": seed,
        "players": players,
        "loadouts": loadouts,
        "chaosConfig": chaos,
        "pickupConfig": pickups,
    })
}

/// One duck's outcome.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuckOutcome {
    pub player_id: String,
    pub rank: u32,
    pub items: Vec<String>,
    pub temperament: String,
    pub finish_time_ms: f64,
}

/// One race's outcome.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RaceOutcome {
    pub index: u64,
    pub chaos: String,
    pub final_tick: u32,
    pub lead_changes: u32,
    /// Standings in rank order.
    pub ducks: Vec<DuckOutcome>,
}

/// The output of `balance run`.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BalanceRun {
    pub corpus: String,
    pub engine_build_id: String,
    pub ts_compat: bool,
    pub golden_box_probability: Option<f64>,
    pub races: Vec<RaceOutcome>,
}

fn run_case(index: u64, golden_box_probability: Option<f64>) -> Result<RaceOutcome> {
    let value = case_config(index, golden_box_probability);
    let input: RaceConfigInput = serde_json::from_value(value.clone())?;
    let config = input
        .resolve()
        .map_err(|error| anyhow!("case {index}: resolve: {error:?}"))?;
    let chaos = value["chaosConfig"]["type"]
        .as_str()
        .unwrap_or("NORMAL")
        .to_owned();
    let loadouts = config.loadouts.clone();
    let mut sim = create_simulation(
        config,
        SimOptions {
            record_events: false,
            ..SimOptions::default()
        },
        None,
    );
    let max_ticks = race_core::config::maximum_ticks(sim.config.tick_rate);
    let mut leader: Option<String> = None;
    let mut lead_changes = 0u32;
    while !sim.finished && sim.tick < max_ticks {
        step_simulation(&mut sim, None);
        let now = sim
            .ducks
            .iter()
            .find(|duck| duck.current_rank == 1)
            .map(|duck| duck.player_id.as_str().to_owned());
        if leader.is_some() && now != leader {
            lead_changes += 1;
        }
        leader = now;
    }
    let result = result_from_simulation(&sim).map_err(|error| anyhow!("case {index}: {error}"))?;
    let ducks = result
        .standings
        .iter()
        .map(|entry| {
            let id = entry.player_id.as_str();
            let items = loadouts
                .iter()
                .find(|loadout| loadout.player_id.as_str() == id)
                .map(|loadout| {
                    loadout
                        .item_ids
                        .iter()
                        .map(|item| serde_json::to_value(item).ok())
                        .map(|item| item.and_then(|v| v.as_str().map(str::to_owned)))
                        .map(Option::unwrap_or_default)
                        .collect()
                })
                .unwrap_or_default();
            let temperament = sim
                .brains
                .get(id)
                .and_then(|brain| serde_json::to_value(brain.temperament).ok())
                .and_then(|v| v.as_str().map(str::to_owned))
                .unwrap_or_default();
            DuckOutcome {
                player_id: id.to_owned(),
                rank: entry.rank,
                items,
                temperament,
                finish_time_ms: entry.finish_time_ms,
            }
        })
        .collect();
    Ok(RaceOutcome {
        index,
        chaos,
        final_tick: sim.tick,
        lead_changes,
        ducks,
    })
}

/// `balance run`.
pub fn run(options: &RunOptions, out: &str) -> Result<()> {
    let races: Vec<Result<RaceOutcome>> = (0..options.cases)
        .into_par_iter()
        .map(|index| run_case(index, options.golden_box_probability))
        .collect();
    let races = races.into_iter().collect::<Result<Vec<_>>>()?;
    let run = BalanceRun {
        corpus: format!("{BALANCE_CORPUS_VERSION}/{}", options.cases),
        engine_build_id: race_core::ENGINE_BUILD_ID.to_owned(),
        ts_compat: race_core::build_id::ENGINE_BUILD_TS_COMPAT,
        golden_box_probability: options.golden_box_probability,
        races,
    };
    let mut text = serde_json::to_string(&run)?;
    text.push('\n');
    std::fs::write(out, text).with_context(|| format!("write {out}"))?;
    let summary = Summary::of(&run);
    eprintln!(
        "balance run: {} races, mean lead changes {:.2}, mean duration {:.2}s -> {out}",
        run.races.len(),
        summary.lead_changes_mean,
        summary.duration_mean_s
    );
    Ok(())
}

/// Win counts and mean normalised finishing position for one bucket.
#[derive(Default, Clone, Copy)]
struct Bucket {
    entries: u64,
    wins: u64,
    position_sum: f64,
}

impl Bucket {
    fn add(&mut self, rank: u32, field: usize) {
        self.entries += 1;
        if rank == 1 {
            self.wins += 1;
        }
        let span = (field.max(2) - 1) as f64;
        self.position_sum += f64::from(rank - 1) / span;
    }

    fn win_pct(self) -> f64 {
        if self.entries == 0 {
            0.0
        } else {
            100.0 * self.wins as f64 / self.entries as f64
        }
    }

    fn position(self) -> f64 {
        if self.entries == 0 {
            0.0
        } else {
            self.position_sum / self.entries as f64
        }
    }
}

fn percentile(sorted: &[f64], p: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let index = ((sorted.len() - 1) as f64 * p).round() as usize;
    sorted[index]
}

struct Summary {
    by_item: BTreeMap<String, Bucket>,
    by_loadout: BTreeMap<String, Bucket>,
    by_temperament: BTreeMap<String, Bucket>,
    duration_mean_s: f64,
    winner_time_s: [f64; 3],
    spread_mean_s: f64,
    lead_changes_mean: f64,
    lead_changes_p90: f64,
}

impl Summary {
    fn of(run: &BalanceRun) -> Self {
        let mut by_item: BTreeMap<String, Bucket> = BTreeMap::new();
        let mut by_loadout: BTreeMap<String, Bucket> = BTreeMap::new();
        let mut by_temperament: BTreeMap<String, Bucket> = BTreeMap::new();
        let mut winner_times = Vec::new();
        let mut spreads = Vec::new();
        let mut leads = Vec::new();
        let mut durations = 0.0;
        for race in &run.races {
            let field = race.ducks.len();
            for duck in &race.ducks {
                for item in &duck.items {
                    by_item
                        .entry(item.clone())
                        .or_default()
                        .add(duck.rank, field);
                }
                let mut pair = duck.items.clone();
                pair.sort();
                by_loadout
                    .entry(pair.join("+"))
                    .or_default()
                    .add(duck.rank, field);
                by_temperament
                    .entry(duck.temperament.clone())
                    .or_default()
                    .add(duck.rank, field);
            }
            if let (Some(first), Some(last)) = (race.ducks.first(), race.ducks.last()) {
                winner_times.push(first.finish_time_ms / 1000.0);
                spreads.push((last.finish_time_ms - first.finish_time_ms) / 1000.0);
            }
            leads.push(f64::from(race.lead_changes));
            durations += f64::from(race.final_tick) / 60.0;
        }
        winner_times.sort_by(f64::total_cmp);
        leads.sort_by(f64::total_cmp);
        let n = run.races.len().max(1) as f64;
        Self {
            by_item,
            by_loadout,
            by_temperament,
            duration_mean_s: durations / n,
            winner_time_s: [
                percentile(&winner_times, 0.1),
                percentile(&winner_times, 0.5),
                percentile(&winner_times, 0.9),
            ],
            spread_mean_s: spreads.iter().sum::<f64>() / n,
            lead_changes_mean: leads.iter().sum::<f64>() / n,
            lead_changes_p90: percentile(&leads, 0.9),
        }
    }
}

fn read_run(path: &str) -> Result<BalanceRun> {
    let text = std::fs::read_to_string(path).with_context(|| format!("read {path}"))?;
    serde_json::from_str(&text).with_context(|| format!("parse {path}"))
}

fn bucket_table(
    out: &mut String,
    title: &str,
    before: &BTreeMap<String, Bucket>,
    after: &BTreeMap<String, Bucket>,
) {
    let _ = writeln!(
        out,
        "\n| {title} | n (before/after) | win % before | win % after | Δ pp | mean pos. Δ |"
    );
    let _ = writeln!(out, "|---|---|---|---|---|---|");
    let mut keys: Vec<&String> = before.keys().chain(after.keys()).collect();
    keys.sort();
    keys.dedup();
    for key in keys {
        let b = before.get(key).copied().unwrap_or_default();
        let a = after.get(key).copied().unwrap_or_default();
        let _ = writeln!(
            out,
            "| {key} | {}/{} | {:.1} | {:.1} | {:+.1} | {:+.3} |",
            b.entries,
            a.entries,
            b.win_pct(),
            a.win_pct(),
            a.win_pct() - b.win_pct(),
            a.position() - b.position()
        );
    }
}

/// `balance compare`: the markdown report of `before` → `after`.
pub fn compare(before_path: &str, after_path: &str, title: &str) -> Result<String> {
    let before = read_run(before_path)?;
    let after = read_run(after_path)?;
    if before.corpus != after.corpus {
        return Err(anyhow!(
            "corpora differ: {} vs {}",
            before.corpus,
            after.corpus
        ));
    }
    let (b, a) = (Summary::of(&before), Summary::of(&after));
    let mut winner_changed = 0;
    let mut order_changed = 0;
    let mut identical = 0;
    for (left, right) in before.races.iter().zip(&after.races) {
        let order = |race: &RaceOutcome| -> Vec<String> {
            race.ducks
                .iter()
                .map(|duck| duck.player_id.clone())
                .collect()
        };
        if left.ducks.first().map(|d| &d.player_id) != right.ducks.first().map(|d| &d.player_id) {
            winner_changed += 1;
        }
        if order(left) != order(right) {
            order_changed += 1;
        }
        let times = |race: &RaceOutcome| -> Vec<u64> {
            race.ducks
                .iter()
                .map(|duck| duck.finish_time_ms.to_bits())
                .collect()
        };
        if order(left) == order(right)
            && times(left) == times(right)
            && left.final_tick == right.final_tick
            && left.lead_changes == right.lead_changes
        {
            identical += 1;
        }
    }
    let n = before.races.len();
    let mut out = String::new();
    let _ = writeln!(out, "### {title}\n");
    let _ = writeln!(
        out,
        "Corpus `{}` (`race-cli balance run`), paired on identical seeds and lobbies. \
         Races with bit-identical outcomes: {identical}/{n}; different winner: \
         {winner_changed}/{n}; different finishing order: {order_changed}/{n}.\n",
        before.corpus
    );
    let _ = writeln!(out, "| Metric | before | after | Δ |");
    let _ = writeln!(out, "|---|---|---|---|");
    let rows = [
        (
            "mean race duration (s)",
            b.duration_mean_s,
            a.duration_mean_s,
        ),
        (
            "winner finish time p10 (s)",
            b.winner_time_s[0],
            a.winner_time_s[0],
        ),
        (
            "winner finish time p50 (s)",
            b.winner_time_s[1],
            a.winner_time_s[1],
        ),
        (
            "winner finish time p90 (s)",
            b.winner_time_s[2],
            a.winner_time_s[2],
        ),
        ("first-to-last spread (s)", b.spread_mean_s, a.spread_mean_s),
        (
            "lead changes, mean",
            b.lead_changes_mean,
            a.lead_changes_mean,
        ),
        ("lead changes, p90", b.lead_changes_p90, a.lead_changes_p90),
    ];
    for (name, before, after) in rows {
        let _ = writeln!(
            out,
            "| {name} | {before:.3} | {after:.3} | {:+.3} |",
            after - before
        );
    }
    bucket_table(
        &mut out,
        "Temperament",
        &b.by_temperament,
        &a.by_temperament,
    );
    bucket_table(&mut out, "Item held", &b.by_item, &a.by_item);
    // Loadout pairs: only the five largest |Δ win %| (36 cells of ~70 ducks
    // each are noisy; the full table is in the JSON artifacts).
    let mut deltas: Vec<(f64, &String)> = b
        .by_loadout
        .keys()
        .chain(a.by_loadout.keys())
        .map(|key| {
            let before = b.by_loadout.get(key).copied().unwrap_or_default();
            let after = a.by_loadout.get(key).copied().unwrap_or_default();
            (after.win_pct() - before.win_pct(), key)
        })
        .collect();
    deltas.sort_by(|x, y| y.0.abs().total_cmp(&x.0.abs()).then_with(|| x.1.cmp(y.1)));
    deltas.dedup_by(|x, y| x.1 == y.1);
    let max_abs = deltas.first().map_or(0.0, |d| d.0.abs());
    let _ = writeln!(
        out,
        "\nLoadout pairs (36 cells): largest |Δ win %| {max_abs:.1} pp; top five: {}.",
        deltas
            .iter()
            .take(5)
            .map(|(delta, key)| format!("{key} {delta:+.1}"))
            .collect::<Vec<_>>()
            .join(", ")
    );
    Ok(out)
}
