//! `race-cli balance` modes (Phase 6) and gate G3.
//!
//! These replace the TS balance worker pool (`scripts/balance-*.ts`,
//! `scripts/lib/balance-sim-worker-pool.ts`) for the main modes:
//!
//! - `balance mixed`: mixed-loadout lobbies (every duck draws one of the 18
//!   Major + Minor loadouts). Reports loadout cells, temperaments (win %,
//!   Chaos loser %, mean rank), drama (lead changes, durations) and wild-item
//!   grants. `--corpus` runs the configs of a corpus file instead, and
//!   `--out` writes the per-race outcomes ([`MixedRun`]).
//! - `balance matrix`: the paired loadout matrix of `balance-matrix.ts` (one
//!   focus duck cycles through every loadout on a fixed seed and lobby).
//! - `balance wild`: the paired wild-item value audit of
//!   `balance-wild-items.ts` (the focus duck's boxes are forced to one item).
//! - `balance g3-corpus` + `compare`: gate G3. The corpus is a JSONL file of
//!   configs that both engines run (`scripts/oracle/g3-balance.ts` for TS
//!   S3.15, `balance mixed --corpus` for Rust), so seeds and lobbies are
//!   identical; `compare ts.json rs.json` checks the plan thresholds.
//!
//! Every mode runs races in parallel with rayon and folds results in seed
//! order, so its output is identical for any thread count. Seeds come from
//! splitmix64, not from the TS `seedFromIndex` helper, so the absolute
//! numbers are not comparable with old TS runs of the same `--seeds`.

use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::sync::Arc;

use anyhow::{Context, Result, anyhow, bail};
use race_core::chaos::{ChaosPreparedState, RawChaosEntry, resolve_chaos_rule};
use race_core::sim::{
    LootPick, SimOptions, WildLootOverride, create_simulation, result_from_simulation,
    step_simulation,
};
use race_protocol::config::{ChaosType, RaceConfigInput};
use race_protocol::events::{EventKind, RaceEvent};
use race_protocol::ids::{PlayerId, WildItemId};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::corpus::SplitMix64;

/// Root seed of the mixed / G3 corpus ("G3BALANC").
pub const MIXED_ROOT_SEED: u64 = 0x4733_4241_4C41_4E43;
/// Bump when [`mixed_config`] changes for a given index.
pub const G3_CORPUS_VERSION: &str = "g3-v1";

const MAJORS: [&str; 3] = ["NITRO", "BUBBLE_SHIELD", "HOMING_ROCKET"];
const MINORS: [&str; 6] = [
    "DRAFT_FIN",
    "PADDLE_BURST",
    "FEATHER",
    "SHOCK_ABSORBER",
    "BANANA",
    "QUACK_HORN",
];
const CLASSES: [&str; 3] = ["SPEED", "DEFENSE", "ATTACK"];
const LOBBIES: [&str; 4] = ["MIXED", "SPEED", "DEFENSE", "ATTACK"];

/// `FULL_LOADOUTS` (`balance-sim-core.ts:25`): every Major × Minor.
fn full_loadouts() -> Vec<[&'static str; 2]> {
    MAJORS
        .iter()
        .flat_map(|major| MINORS.iter().map(move |minor| [*major, *minor]))
        .collect()
}

/// `loadoutKey`.
fn loadout_key(items: &[impl AsRef<str>]) -> String {
    items
        .iter()
        .map(AsRef::as_ref)
        .collect::<Vec<_>>()
        .join(" + ")
}

/// The class of a loadout's Major (`loadoutArchetype`).
fn major_class(items: &[impl AsRef<str>]) -> &'static str {
    let class = |item: &str| match item {
        "NITRO" | "DRAFT_FIN" | "PADDLE_BURST" => "SPEED",
        "BUBBLE_SHIELD" | "FEATHER" | "SHOCK_ABSORBER" => "DEFENSE",
        _ => "ATTACK",
    };
    let major = items
        .iter()
        .map(AsRef::as_ref)
        .find(|item| MAJORS.contains(item));
    class(
        major
            .or_else(|| items.first().map(AsRef::as_ref))
            .unwrap_or(""),
    )
}

/// The official pickup config (`scripts/balance-matrix-config.ts`, which
/// mirrors `lib/season3-race.ts`). S3.16 ignores the dead knobs but still
/// accepts them; TS S3.15 reads them.
fn production_pickups() -> Value {
    json!({
        "enabled": true,
        "goldenBoxEnabled": true,
        "goldenBoxProbability": 0.15,
        "hazardsEnabled": true,
        "positionAwareLoot": true,
        "spawnMultiplier": 1.25,
        "regularPickupCap": 3,
        "manualItemsEnabled": true,
        "autoItemsEnabled": true,
        "chaosBoxEnabled": false,
        "forceGoldenBox": false,
        "disabledItems": [],
        "idealManualPlayerIds": [],
    })
}

fn case_rng(root: u64, index: u64) -> SplitMix64 {
    SplitMix64::new(root ^ index.wrapping_mul(0x9E37_79B9_7F4A_7C15))
}

fn chaos_json(chaos: ChaosType, members: &[String]) -> Value {
    match chaos {
        ChaosType::Duo => {
            let groups: Vec<Vec<String>> = members.chunks(2).map(<[String]>::to_vec).collect();
            json!({"type": chaos.as_str(), "targetPlayerId": null, "groups": groups})
        }
        ChaosType::Constructors => {
            let split = members.len().div_ceil(2);
            json!({"type": chaos.as_str(), "targetPlayerId": null,
                   "groups": [members[..split].to_vec(), members[split..].to_vec()]})
        }
        ChaosType::BountyHunt => json!({"type": chaos.as_str(), "targetPlayerId": members[0]}),
        _ => json!({"type": chaos.as_str(), "targetPlayerId": null}),
    }
}

/// Mixed-lobby config `index`: `players` ducks `duck-1..`, each with a
/// random full loadout, the official pickup config and `chaos` (NORMAL
/// leaves `chaosConfig` out).
pub fn mixed_config(root: u64, index: u64, players: usize, chaos: ChaosType) -> Value {
    let mut rng = case_rng(root, index);
    let seed: String = (0..4).map(|_| format!("{:016x}", rng.next_u64())).collect();
    let ids: Vec<String> = (1..=players).map(|slot| format!("duck-{slot}")).collect();
    let loadouts = full_loadouts();
    let player_values: Vec<Value> = ids
        .iter()
        .enumerate()
        .map(|(slot, id)| json!({"playerId": id, "name": format!("Duck {}", slot + 1)}))
        .collect();
    let loadout_values: Vec<Value> = ids
        .iter()
        .map(|id| {
            let pick = loadouts[rng.below(loadouts.len() as u64) as usize];
            json!({"playerId": id, "itemIds": pick, "source": "PLAYER"})
        })
        .collect();
    let mut config = json!({
        "raceId": format!("g3-{index:05}"),
        "seed": seed,
        "players": player_values,
        "loadouts": loadout_values,
        "pickupConfig": production_pickups(),
    });
    if chaos != ChaosType::Normal {
        let mut members = ids.clone();
        rng.shuffle(&mut members);
        config["chaosConfig"] = chaos_json(chaos, &members);
    }
    config
}

// ---------------------------------------------------------------------------
// One race

/// One duck's outcome (shared with `scripts/oracle/g3-balance.ts`).
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuckRow {
    pub player_id: String,
    pub rank: u32,
    pub items: Vec<String>,
    pub temperament: String,
    pub finish_time_ms: f64,
    pub wild_grants: u32,
    /// `PICKUP_COLLECTED` count (boxes opened, instant pickups included).
    #[serde(default)]
    pub pickups: u32,
    pub chaos_loser: bool,
}

/// One race's outcome (shared with `scripts/oracle/g3-balance.ts`).
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RaceRow {
    pub index: u64,
    pub chaos: String,
    pub final_tick: u32,
    pub finished: bool,
    pub lead_changes: u32,
    /// `WILD_ITEM_GRANTED` count per item id.
    pub wild_grants: BTreeMap<String, u32>,
    /// Standings in rank order.
    pub ducks: Vec<DuckRow>,
}

/// The output of `balance mixed --out` and of `g3-balance.ts`.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MixedRun {
    /// `rust` or `ts`.
    pub engine: String,
    pub engine_version: String,
    pub balance_version: String,
    pub corpus: String,
    pub races: Vec<RaceRow>,
}

/// What a race run needs besides its config.
#[derive(Default, Clone)]
struct RaceExtras {
    loot_override: Option<WildLootOverride>,
}

fn chaos_losers(value: &Value, standings: &[(String, u32)]) -> Result<Vec<String>> {
    let chaos = &value["chaosConfig"];
    let kind = chaos["type"].as_str().unwrap_or("NORMAL");
    let kind = ChaosType::from_wire(kind).ok_or_else(|| anyhow!("unknown chaos {kind}"))?;
    let raw: Vec<RawChaosEntry<'_>> = standings
        .iter()
        .map(|(player_id, rank)| RawChaosEntry {
            player_id,
            rank: *rank,
        })
        .collect();
    let prepared = ChaosPreparedState {
        target_player_id: chaos["targetPlayerId"].as_str().map(str::to_owned),
        groups: chaos["groups"].as_array().map(|groups| {
            groups
                .iter()
                .map(|group| {
                    group
                        .as_array()
                        .map(|ids| {
                            ids.iter()
                                .filter_map(|id| id.as_str().map(str::to_owned))
                                .collect()
                        })
                        .unwrap_or_default()
                })
                .collect()
        }),
    };
    resolve_chaos_rule(kind, &raw, &prepared)
        .map(|result| result.loser_player_ids)
        .map_err(|error| anyhow!("chaos: {error}"))
}

fn run_race(index: u64, value: &Value, extras: &RaceExtras) -> Result<RaceRow> {
    let input: RaceConfigInput = serde_json::from_value(value.clone())
        .with_context(|| format!("race {index}: parse config"))?;
    let config = input
        .resolve()
        .map_err(|error| anyhow!("race {index}: resolve: {error:?}"))?;
    let chaos = config.chaos_config.chaos_type.as_str().to_owned();
    let loadouts = config.loadouts.clone();
    let mut grants: BTreeMap<String, u32> = BTreeMap::new();
    let mut duck_grants: BTreeMap<String, u32> = BTreeMap::new();
    let mut duck_pickups: BTreeMap<String, u32> = BTreeMap::new();
    let mut sink = |event: &RaceEvent| {
        if let (EventKind::PickupCollected(_), Some(source)) =
            (&event.kind, &event.source_player_id)
        {
            *duck_pickups.entry(source.as_str().to_owned()).or_default() += 1;
        }
        if let EventKind::WildItemGranted(meta) = &event.kind {
            *grants.entry(meta.item_id.as_str().to_owned()).or_default() += 1;
            if let Some(source) = &event.source_player_id {
                *duck_grants.entry(source.as_str().to_owned()).or_default() += 1;
            }
        }
    };
    let mut sim = create_simulation(
        config,
        SimOptions {
            record_events: false,
            loot_override: extras.loot_override.clone(),
            ..SimOptions::default()
        },
        Some(&mut sink),
    );
    let max_ticks = race_core::config::maximum_ticks(sim.config.tick_rate);
    let mut leader: Option<String> = None;
    let mut lead_changes = 0u32;
    while !sim.finished && sim.tick < max_ticks {
        step_simulation(&mut sim, Some(&mut sink));
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
    let finished = sim.finished;
    let standings: Vec<(String, u32, f64)> = if finished {
        result_from_simulation(&sim)
            .map_err(|error| anyhow!("race {index}: {error}"))?
            .standings
            .iter()
            .map(|entry| {
                (
                    entry.player_id.as_str().to_owned(),
                    entry.rank,
                    entry.finish_time_ms,
                )
            })
            .collect()
    } else {
        Vec::new()
    };
    let ranks: Vec<(String, u32)> = standings
        .iter()
        .map(|(id, rank, _)| (id.clone(), *rank))
        .collect();
    let losers = if finished {
        chaos_losers(value, &ranks)?
    } else {
        Vec::new()
    };
    let ducks = standings
        .into_iter()
        .map(|(id, rank, finish_time_ms)| {
            let items = loadouts
                .iter()
                .find(|loadout| loadout.player_id.as_str() == id)
                .map(|loadout| {
                    loadout
                        .item_ids
                        .iter()
                        .map(|item| item.as_str().to_owned())
                        .collect()
                })
                .unwrap_or_default();
            let temperament = sim
                .brains
                .get(id.as_str())
                .map(|brain| brain.temperament.as_str().to_owned())
                .unwrap_or_default();
            DuckRow {
                wild_grants: duck_grants.get(&id).copied().unwrap_or(0),
                pickups: duck_pickups.get(&id).copied().unwrap_or(0),
                chaos_loser: losers.contains(&id),
                player_id: id,
                rank,
                items,
                temperament,
                finish_time_ms,
            }
        })
        .collect();
    Ok(RaceRow {
        index,
        chaos,
        final_tick: sim.tick,
        finished,
        lead_changes,
        wild_grants: grants,
        ducks,
    })
}

/// Runs `configs` in parallel; the results keep the input order.
fn run_all(configs: &[(u64, Value)], extras: &RaceExtras) -> Result<Vec<RaceRow>> {
    configs
        .par_iter()
        .map(|(index, value)| run_race(*index, value, extras))
        .collect::<Vec<_>>()
        .into_iter()
        .collect()
}

// ---------------------------------------------------------------------------
// Statistics

#[derive(Default, Clone, Copy, Debug)]
struct Rate {
    n: u64,
    hits: u64,
}

impl Rate {
    fn add(&mut self, hit: bool) {
        self.n += 1;
        self.hits += u64::from(hit);
    }

    fn p(self) -> f64 {
        if self.n == 0 {
            0.0
        } else {
            self.hits as f64 / self.n as f64
        }
    }

    fn pct(self) -> f64 {
        100.0 * self.p()
    }

    /// Standard error of the percentage.
    fn se_pct(self) -> f64 {
        if self.n == 0 {
            return 0.0;
        }
        100.0 * (self.p() * (1.0 - self.p()) / self.n as f64).sqrt()
    }
}

#[derive(Default, Clone, Copy, Debug)]
struct Mean {
    n: u64,
    sum: f64,
    sum_sq: f64,
}

impl Mean {
    fn add(&mut self, value: f64) {
        self.n += 1;
        self.sum += value;
        self.sum_sq += value * value;
    }

    fn mean(self) -> f64 {
        if self.n == 0 {
            0.0
        } else {
            self.sum / self.n as f64
        }
    }

    fn se(self) -> f64 {
        if self.n < 2 {
            return 0.0;
        }
        let n = self.n as f64;
        let variance = (self.sum_sq - self.sum * self.sum / n) / (n - 1.0);
        (variance.max(0.0) / n).sqrt()
    }
}

fn percentile(values: &mut [f64], p: f64) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    values.sort_by(f64::total_cmp);
    values[((values.len() - 1) as f64 * p).round() as usize]
}

/// Aggregates of one [`MixedRun`].
#[derive(Default)]
struct MixedSummary {
    races: u64,
    unfinished: u64,
    players: u64,
    by_loadout: BTreeMap<String, Rate>,
    by_class: BTreeMap<String, Rate>,
    by_temperament: BTreeMap<String, Rate>,
    temperament_loser: BTreeMap<String, Rate>,
    temperament_rank: BTreeMap<String, Mean>,
    lead_changes: Mean,
    lead_changes_all: Vec<f64>,
    duration_s: Mean,
    winner_s: Vec<f64>,
    spread_s: Mean,
    grants_per_race: Mean,
    grants_by_item: BTreeMap<String, u64>,
    holder_win: Rate,
    non_holder_win: Rate,
}

impl MixedSummary {
    fn of(run: &MixedRun) -> Self {
        let mut s = Self::default();
        for race in &run.races {
            s.races += 1;
            if !race.finished {
                s.unfinished += 1;
                continue;
            }
            s.players = s.players.max(race.ducks.len() as u64);
            for duck in &race.ducks {
                let win = duck.rank == 1;
                s.by_loadout
                    .entry(loadout_key(&duck.items))
                    .or_default()
                    .add(win);
                s.by_class
                    .entry(major_class(&duck.items).to_owned())
                    .or_default()
                    .add(win);
                s.by_temperament
                    .entry(duck.temperament.clone())
                    .or_default()
                    .add(win);
                s.temperament_loser
                    .entry(duck.temperament.clone())
                    .or_default()
                    .add(duck.chaos_loser);
                s.temperament_rank
                    .entry(duck.temperament.clone())
                    .or_default()
                    .add(f64::from(duck.rank));
                if duck.wild_grants > 0 {
                    s.holder_win.add(win);
                } else {
                    s.non_holder_win.add(win);
                }
            }
            s.lead_changes.add(f64::from(race.lead_changes));
            s.lead_changes_all.push(f64::from(race.lead_changes));
            s.duration_s.add(f64::from(race.final_tick) / 60.0);
            if let (Some(first), Some(last)) = (race.ducks.first(), race.ducks.last()) {
                s.winner_s.push(first.finish_time_ms / 1000.0);
                s.spread_s
                    .add((last.finish_time_ms - first.finish_time_ms) / 1000.0);
            }
            s.grants_per_race
                .add(f64::from(race.wild_grants.values().sum::<u32>()));
            for (item, count) in &race.wild_grants {
                *s.grants_by_item.entry(item.clone()).or_default() += u64::from(*count);
            }
        }
        s
    }
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &str) -> Result<T> {
    let bytes = std::fs::read(path).with_context(|| format!("read {path}"))?;
    let text = if path.ends_with(".gz") {
        let mut text = String::new();
        std::io::Read::read_to_string(&mut flate2::read::GzDecoder::new(&bytes[..]), &mut text)
            .with_context(|| format!("gunzip {path}"))?;
        text
    } else {
        String::from_utf8(bytes).with_context(|| format!("{path} is not UTF-8"))?
    };
    serde_json::from_str(&text).with_context(|| format!("parse {path}"))
}

// ---------------------------------------------------------------------------
// balance mixed / g3-corpus

/// Options of `balance mixed`.
pub struct MixedOptions {
    pub races: u64,
    pub players: usize,
    pub chaos: String,
    pub corpus: Option<String>,
    pub out: Option<String>,
}

fn parse_chaos(text: &str) -> Result<ChaosType> {
    ChaosType::from_wire(text).ok_or_else(|| anyhow!("unknown chaos type {text}"))
}

/// `balance g3-corpus`: write `races` mixed configs (8 ducks, NORMAL) as JSONL.
pub fn run_g3_corpus(races: u64, players: usize, chaos: &str, out: &str) -> Result<()> {
    let chaos = parse_chaos(chaos)?;
    let mut text = String::new();
    for index in 0..races {
        text.push_str(&serde_json::to_string(&mixed_config(
            MIXED_ROOT_SEED,
            index,
            players,
            chaos,
        ))?);
        text.push('\n');
    }
    std::fs::write(out, text).with_context(|| format!("write {out}"))?;
    eprintln!(
        "balance g3-corpus: {races} configs ({G3_CORPUS_VERSION}, {players} ducks, {}) -> {out}",
        chaos.as_str()
    );
    Ok(())
}

fn corpus_name(races: usize) -> String {
    format!("{G3_CORPUS_VERSION}/{races}")
}

/// `balance mixed`.
pub fn run_mixed(options: &MixedOptions) -> Result<String> {
    let configs: Vec<(u64, Value)> = if let Some(path) = &options.corpus {
        let text = std::fs::read_to_string(path).with_context(|| format!("read {path}"))?;
        text.lines()
            .filter(|line| !line.trim().is_empty())
            .enumerate()
            .map(|(index, line)| Ok((index as u64, serde_json::from_str(line)?)))
            .collect::<Result<_>>()?
    } else {
        let chaos = parse_chaos(&options.chaos)?;
        (0..options.races)
            .map(|index| {
                (
                    index,
                    mixed_config(MIXED_ROOT_SEED, index, options.players, chaos),
                )
            })
            .collect()
    };
    let races = run_all(&configs, &RaceExtras::default())?;
    let run = MixedRun {
        engine: "rust".to_owned(),
        engine_version: race_protocol::versions::RACE_ENGINE_VERSION.to_owned(),
        balance_version: race_protocol::versions::RACE_BALANCE_VERSION.to_owned(),
        corpus: corpus_name(races.len()),
        races,
    };
    if let Some(out) = &options.out {
        let mut text = serde_json::to_string(&run)?;
        text.push('\n');
        std::fs::write(out, text).with_context(|| format!("write {out}"))?;
    }
    Ok(mixed_report(&run))
}

fn mixed_report(run: &MixedRun) -> String {
    let s = MixedSummary::of(run);
    let fair = if s.players == 0 {
        0.0
    } else {
        100.0 / s.players as f64
    };
    let mut out = String::new();
    let _ = writeln!(
        out,
        "{} {} {}: {} races ({} unfinished), fair win % {fair:.2}\n",
        run.engine, run.balance_version, run.corpus, s.races, s.unfinished
    );
    let _ = writeln!(
        out,
        "| Temperament | ducks | win % | ±SE | Chaos loser % | mean rank |"
    );
    let _ = writeln!(out, "|---|---|---|---|---|---|");
    for (key, rate) in &s.by_temperament {
        let loser = s.temperament_loser.get(key).copied().unwrap_or_default();
        let rank = s.temperament_rank.get(key).copied().unwrap_or_default();
        let _ = writeln!(
            out,
            "| {key} | {} | {:.2} | {:.2} | {:.2} | {:.3} |",
            rate.n,
            rate.pct(),
            rate.se_pct(),
            loser.pct(),
            rank.mean()
        );
    }
    let _ = writeln!(out, "\n| Loadout | ducks | win % | ±SE |");
    let _ = writeln!(out, "|---|---|---|---|");
    for (key, rate) in s.by_loadout.iter().chain(&s.by_class) {
        let _ = writeln!(
            out,
            "| {key} | {} | {:.2} | {:.2} |",
            rate.n,
            rate.pct(),
            rate.se_pct()
        );
    }
    let mut leads = s.lead_changes_all.clone();
    let mut winners = s.winner_s.clone();
    let _ = writeln!(
        out,
        "\nDrama: lead changes mean {:.3} (±{:.3}), p50 {:.0}, p90 {:.0}; duration mean {:.2} s; \
         winner p50 {:.2} s; first-to-last spread {:.2} s.",
        s.lead_changes.mean(),
        s.lead_changes.se(),
        percentile(&mut leads, 0.5),
        percentile(&mut leads.clone(), 0.9),
        s.duration_s.mean(),
        percentile(&mut winners, 0.5),
        s.spread_s.mean()
    );
    let total: u64 = s.grants_by_item.values().sum();
    let _ = writeln!(
        out,
        "Wild items: {:.2} grants per race; holders win {:.2} %, non-holders {:.2} %; share: {}.",
        s.grants_per_race.mean(),
        s.holder_win.pct(),
        s.non_holder_win.pct(),
        s.grants_by_item
            .iter()
            .map(|(item, count)| format!(
                "{item} {:.1}%",
                100.0 * *count as f64 / total.max(1) as f64
            ))
            .collect::<Vec<_>>()
            .join(", ")
    );
    out
}

// ---------------------------------------------------------------------------
// balance matrix (paired)

/// `balance matrix`: for each seed, a fixed lobby of opponents drawn from
/// the lobby's pool and a focus slot that plays every one of the 18
/// loadouts (`balance-matrix.ts`).
pub fn run_matrix(seeds: u64, players: usize, lobbies: &[String]) -> Result<String> {
    let loadouts = full_loadouts();
    for lobby in lobbies {
        if !LOBBIES.contains(&lobby.as_str()) {
            bail!("unknown lobby {lobby} ({})", LOBBIES.join(", "));
        }
    }
    let mut configs: Vec<(u64, Value)> = Vec::new();
    let mut meta: Vec<(usize, usize, String)> = Vec::new(); // (lobby, loadout, focus id)
    for (lobby_index, lobby) in lobbies.iter().enumerate() {
        let pool: Vec<[&str; 2]> = loadouts
            .iter()
            .filter(|loadout| lobby == "MIXED" || major_class(&loadout[..]) == lobby)
            .copied()
            .collect();
        for seed in 0..seeds {
            let mut base = mixed_config(
                MIXED_ROOT_SEED ^ 0x4D41_5452,
                seed,
                players,
                ChaosType::Normal,
            );
            let mut rng = case_rng(MIXED_ROOT_SEED ^ (lobby_index as u64 + 1), seed);
            let focus = (seed as usize) % players;
            let focus_id = format!("duck-{}", focus + 1);
            for (slot, entry) in base["loadouts"]
                .as_array_mut()
                .expect("mixed_config has loadouts")
                .iter_mut()
                .enumerate()
            {
                if slot != focus {
                    entry["itemIds"] = json!(pool[rng.below(pool.len() as u64) as usize]);
                }
            }
            for (loadout_index, loadout) in loadouts.iter().enumerate() {
                let mut value = base.clone();
                value["loadouts"][focus]["itemIds"] = json!(loadout);
                configs.push((seed, value));
                meta.push((lobby_index, loadout_index, focus_id.clone()));
            }
        }
    }
    let races = run_all(&configs, &RaceExtras::default())?;
    let mut cells = vec![vec![(Rate::default(), Mean::default()); loadouts.len()]; lobbies.len()];
    for (race, (lobby, loadout, focus)) in races.iter().zip(&meta) {
        let rank = race
            .ducks
            .iter()
            .find(|duck| &duck.player_id == focus)
            .map_or(players as u32, |duck| duck.rank);
        cells[*lobby][*loadout].0.add(rank == 1);
        cells[*lobby][*loadout].1.add(f64::from(rank));
    }
    let mut out = String::new();
    let _ = writeln!(
        out,
        "balance matrix: {seeds} seeds × {} lobbies × 18 loadouts = {} races, {players} ducks; fair win % {:.1}\n",
        lobbies.len(),
        races.len(),
        100.0 / players as f64
    );
    let _ = writeln!(
        out,
        "| Loadout | {} | MIXED mean rank |",
        lobbies.join(" | ")
    );
    let _ = writeln!(out, "|---|{}---|", "---|".repeat(lobbies.len()));
    let mixed = lobbies.iter().position(|lobby| lobby == "MIXED");
    for (index, loadout) in loadouts.iter().enumerate() {
        let wins: Vec<String> = cells
            .iter()
            .map(|row| format!("{:.1}", row[index].0.pct()))
            .collect();
        let rank = mixed.map_or(String::from("-"), |m| {
            format!("{:.2}", cells[m][index].1.mean())
        });
        let _ = writeln!(
            out,
            "| {} | {} | {rank} |",
            loadout_key(&loadout[..]),
            wins.join(" | ")
        );
    }
    let _ = writeln!(out, "\n| Focus class | {} |", lobbies.join(" | "));
    let _ = writeln!(out, "|---|{}", "---|".repeat(lobbies.len()));
    for class in CLASSES {
        let row: Vec<String> = cells
            .iter()
            .map(|lobby| {
                let mut rate = Rate::default();
                for (index, loadout) in loadouts.iter().enumerate() {
                    if major_class(&loadout[..]) == class {
                        rate.n += lobby[index].0.n;
                        rate.hits += lobby[index].0.hits;
                    }
                }
                format!("{:.1}", rate.pct())
            })
            .collect();
        let _ = writeln!(out, "| {class} | {} |", row.join(" | "));
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// balance wild (paired)

/// `balance wild`: per seed, the focus duck's regular boxes are forced to
/// each wild item in turn, or to nothing (control); everyone else rolls
/// normally (`balance-wild-items.ts`). Value = control rank − rank.
pub fn run_wild(seeds: u64, players: usize) -> Result<String> {
    let mut treatments: Vec<Option<WildItemId>> = vec![None];
    treatments.extend(WildItemId::ALL.iter().copied().map(Some));
    let mut jobs: Vec<(u64, Value, RaceExtras, usize, String)> = Vec::new();
    for seed in 0..seeds {
        let value = mixed_config(
            MIXED_ROOT_SEED ^ 0x5749_4C44,
            seed,
            players,
            ChaosType::Normal,
        );
        let focus_id = format!("duck-{}", (seed as usize) % players + 1);
        for (treatment_index, treatment) in treatments.iter().enumerate() {
            let focus = focus_id.clone();
            let pick = treatment.map_or(LootPick::Empty, LootPick::Item);
            let extras = RaceExtras {
                loot_override: Some(WildLootOverride(Arc::new(move |player: &PlayerId| {
                    (player.as_str() == focus).then_some(pick)
                }))),
            };
            jobs.push((
                seed,
                value.clone(),
                extras,
                treatment_index,
                focus_id.clone(),
            ));
        }
    }
    let races: Vec<RaceRow> = jobs
        .par_iter()
        .map(|(seed, value, extras, _, _)| run_race(*seed, value, extras))
        .collect::<Vec<_>>()
        .into_iter()
        .collect::<Result<_>>()?;
    let mut win = vec![Rate::default(); treatments.len()];
    let mut rank = vec![Mean::default(); treatments.len()];
    let mut gain = vec![Mean::default(); treatments.len()];
    let mut grants = vec![Mean::default(); treatments.len()];
    let mut control = 0.0;
    for (race, (_, _, _, treatment, focus)) in races.iter().zip(&jobs) {
        let duck = race
            .ducks
            .iter()
            .find(|duck| &duck.player_id == focus)
            .ok_or_else(|| anyhow!("race {}: focus duck missing", race.index))?;
        let r = f64::from(duck.rank);
        if *treatment == 0 {
            control = r;
        }
        win[*treatment].add(duck.rank == 1);
        rank[*treatment].add(r);
        gain[*treatment].add(control - r);
        grants[*treatment].add(f64::from(duck.pickups));
    }
    let mut out = String::new();
    let _ = writeln!(
        out,
        "balance wild: {seeds} seeds × {} treatments = {} races, {players} ducks\n",
        treatments.len(),
        races.len()
    );
    let _ = writeln!(
        out,
        "| Item | win % | mean rank | rank gain | ±95% | focus pickups/race |"
    );
    let _ = writeln!(out, "|---|---|---|---|---|---|");
    for (index, treatment) in treatments.iter().enumerate() {
        let _ = writeln!(
            out,
            "| {} | {:.2} | {:.3} | {:+.3} | {:.3} | {:.2} |",
            treatment.map_or("NONE", WildItemId::as_str),
            win[index].pct(),
            rank[index].mean(),
            gain[index].mean(),
            1.96 * gain[index].se(),
            grants[index].mean()
        );
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// compare (gate G3)

/// G3 thresholds (plan §3 Phase 6).
const CELL_MAX_DELTA_PP: f64 = 2.0;
const TEMPERAMENT_RANGE: (f64, f64) = (11.0, 13.8);
const DRAMA_MAX_DELTA: f64 = 0.4;
/// z for the noise allowance (two-sided 95 %).
const Z: f64 = 1.96;

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
enum Verdict {
    Pass,
    /// Outside the threshold by less than the sampling noise of this run.
    Noise,
    Fail,
}

impl Verdict {
    const fn label(self) -> &'static str {
        match self {
            Self::Pass => "pass",
            Self::Noise => "within noise",
            Self::Fail => "**FAIL**",
        }
    }

    fn of(excess: f64, se: f64) -> Self {
        if excess <= 0.0 {
            Self::Pass
        } else if excess <= Z * se {
            Self::Noise
        } else {
            Self::Fail
        }
    }
}

/// `compare ts.json rs.json`: the G3 report. Returns the markdown and
/// whether no metric failed (noise-limited deviations don't fail).
pub fn compare(ts_path: &str, rs_path: &str) -> Result<(String, bool)> {
    let ts: MixedRun = read_json(ts_path)?;
    let rs: MixedRun = read_json(rs_path)?;
    if ts.corpus != rs.corpus || ts.races.len() != rs.races.len() {
        bail!("corpora differ: {} vs {}", ts.corpus, rs.corpus);
    }
    for (left, right) in ts.races.iter().zip(&rs.races) {
        let lobby = |race: &RaceRow| {
            let mut ducks: Vec<(String, Vec<String>)> = race
                .ducks
                .iter()
                .map(|duck| (duck.player_id.clone(), duck.items.clone()))
                .collect();
            ducks.sort();
            ducks
        };
        if left.finished && right.finished && lobby(left) != lobby(right) {
            bail!("race {}: lobbies differ between the two runs", left.index);
        }
    }
    let (t, r) = (MixedSummary::of(&ts), MixedSummary::of(&rs));
    if t.players != 8 || r.players != 8 {
        bail!("the G3 thresholds are for 8-duck lobbies (fair win rate 12.5 %)");
    }
    let mut worst = Verdict::Pass;
    let mut out = String::new();
    let _ = writeln!(
        out,
        "Corpus `{}`: {} {} ({}) vs {} {} ({}), identical configs (seeds, lobbies, loadouts).\n",
        rs.corpus,
        ts.engine,
        ts.balance_version,
        ts.engine_version,
        rs.engine,
        rs.balance_version,
        rs.engine_version
    );
    let unfinished = Verdict::of((t.unfinished + r.unfinished) as f64, 0.0);
    worst = worst.max(unfinished);
    let _ = writeln!(
        out,
        "Unfinished races: {} {}, {} {} ({}).\n",
        ts.engine,
        t.unfinished,
        rs.engine,
        r.unfinished,
        unfinished.label()
    );

    let _ = writeln!(
        out,
        "| Loadout cell | n | TS win % | Rust win % | Δ pp | ±SE | verdict (Δ within ±{CELL_MAX_DELTA_PP} pp) |"
    );
    let _ = writeln!(out, "|---|---|---|---|---|---|---|");
    let mut cell_keys: Vec<&String> = t.by_loadout.keys().chain(r.by_loadout.keys()).collect();
    cell_keys.sort();
    cell_keys.dedup();
    let mut cell_verdicts = [0u32; 3];
    let classes: Vec<(&String, Rate, Rate)> = CLASSES
        .iter()
        .filter_map(|class| {
            let key = t.by_class.keys().find(|key| key.as_str() == *class)?;
            Some((
                key,
                t.by_class[key],
                r.by_class.get(key).copied().unwrap_or_default(),
            ))
        })
        .collect();
    let rows = cell_keys
        .iter()
        .map(|key| {
            (
                *key,
                t.by_loadout.get(*key).copied().unwrap_or_default(),
                r.by_loadout.get(*key).copied().unwrap_or_default(),
            )
        })
        .chain(classes);
    for (key, a, b) in rows {
        let delta = b.pct() - a.pct();
        let se = a.se_pct().hypot(b.se_pct());
        let verdict = Verdict::of(delta.abs() - CELL_MAX_DELTA_PP, se);
        cell_verdicts[verdict as usize] += 1;
        worst = worst.max(verdict);
        let _ = writeln!(
            out,
            "| {key} | {}/{} | {:.2} | {:.2} | {delta:+.2} | {se:.2} | {} |",
            a.n,
            b.n,
            a.pct(),
            b.pct(),
            verdict.label()
        );
    }

    let _ = writeln!(
        out,
        "\n| Temperament | n | TS win % | Rust win % | Rust ±SE | verdict (Rust in [{:.1}, {:.1}] %) | TS / Rust Chaos loser % |",
        TEMPERAMENT_RANGE.0, TEMPERAMENT_RANGE.1
    );
    let _ = writeln!(out, "|---|---|---|---|---|---|---|");
    for (key, b) in &r.by_temperament {
        let a = t.by_temperament.get(key).copied().unwrap_or_default();
        let excess = (TEMPERAMENT_RANGE.0 - b.pct()).max(b.pct() - TEMPERAMENT_RANGE.1);
        let verdict = Verdict::of(excess, b.se_pct());
        worst = worst.max(verdict);
        let _ = writeln!(
            out,
            "| {key} | {}/{} | {:.2} | {:.2} | {:.2} | {} | {:.2} / {:.2} |",
            a.n,
            b.n,
            a.pct(),
            b.pct(),
            b.se_pct(),
            verdict.label(),
            t.temperament_loser
                .get(key)
                .copied()
                .unwrap_or_default()
                .pct(),
            r.temperament_loser
                .get(key)
                .copied()
                .unwrap_or_default()
                .pct()
        );
    }

    let delta = r.lead_changes.mean() - t.lead_changes.mean();
    let se = t.lead_changes.se().hypot(r.lead_changes.se());
    let drama = Verdict::of(delta.abs() - DRAMA_MAX_DELTA, se);
    worst = worst.max(drama);
    let (mut tw, mut rw) = (t.winner_s.clone(), r.winner_s.clone());
    let _ = writeln!(
        out,
        "\n| Drama and pacing | TS | Rust | Δ | ±SE | verdict |"
    );
    let _ = writeln!(out, "|---|---|---|---|---|---|");
    let _ = writeln!(
        out,
        "| lead changes per race | {:.3} | {:.3} | {delta:+.3} | {se:.3} | {} (Δ within ±{DRAMA_MAX_DELTA}) |",
        t.lead_changes.mean(),
        r.lead_changes.mean(),
        drama.label()
    );
    for (name, a, b) in [
        ("race duration (s)", t.duration_s, r.duration_s),
        ("first-to-last spread (s)", t.spread_s, r.spread_s),
        (
            "wild-item grants per race",
            t.grants_per_race,
            r.grants_per_race,
        ),
    ] {
        let _ = writeln!(
            out,
            "| {name} | {:.3} | {:.3} | {:+.3} | {:.3} | info |",
            a.mean(),
            b.mean(),
            b.mean() - a.mean(),
            a.se().hypot(b.se())
        );
    }
    let _ = writeln!(
        out,
        "| winner finish p50 (s) | {:.3} | {:.3} | {:+.3} | - | info |",
        percentile(&mut tw, 0.5),
        percentile(&mut rw, 0.5),
        percentile(&mut rw.clone(), 0.5) - percentile(&mut tw.clone(), 0.5)
    );
    let _ = writeln!(
        out,
        "| wild-item holder win % | {:.2} | {:.2} | {:+.2} | {:.2} | info |",
        t.holder_win.pct(),
        r.holder_win.pct(),
        r.holder_win.pct() - t.holder_win.pct(),
        t.holder_win.se_pct().hypot(r.holder_win.se_pct())
    );
    let total_t: u64 = t.grants_by_item.values().sum();
    let total_r: u64 = r.grants_by_item.values().sum();
    let mut items: Vec<&String> = t
        .grants_by_item
        .keys()
        .chain(r.grants_by_item.keys())
        .collect();
    items.sort();
    items.dedup();
    let _ = writeln!(
        out,
        "\nWild-item grant share (TS → Rust): {}.",
        items
            .iter()
            .map(|item| format!(
                "{item} {:.1}→{:.1}%",
                100.0 * t.grants_by_item.get(*item).copied().unwrap_or(0) as f64
                    / total_t.max(1) as f64,
                100.0 * r.grants_by_item.get(*item).copied().unwrap_or(0) as f64
                    / total_r.max(1) as f64
            ))
            .collect::<Vec<_>>()
            .join(", ")
    );
    let _ = writeln!(
        out,
        "\nLoadout cells: {} pass, {} within noise, {} fail. Verdict: **{}** (\"within noise\" = outside \
         the threshold by less than {Z}·SE of this run).",
        cell_verdicts[0],
        cell_verdicts[1],
        cell_verdicts[2],
        match worst {
            Verdict::Pass => "G3 pass",
            Verdict::Noise => "G3 pass (noise-limited)",
            Verdict::Fail => "G3 FAIL",
        }
    );
    Ok((out, worst != Verdict::Fail))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mixed_config_is_fixed_and_resolves() {
        let a = mixed_config(MIXED_ROOT_SEED, 3, 8, ChaosType::Normal);
        assert_eq!(a, mixed_config(MIXED_ROOT_SEED, 3, 8, ChaosType::Normal));
        assert!(a.get("chaosConfig").is_none());
        for chaos in [
            ChaosType::Duo,
            ChaosType::Constructors,
            ChaosType::BountyHunt,
        ] {
            let value = mixed_config(MIXED_ROOT_SEED, 3, 8, chaos);
            let input: RaceConfigInput = serde_json::from_value(value).unwrap();
            input.resolve().unwrap();
        }
    }

    #[test]
    fn run_compared_with_itself_has_no_delta() {
        let configs: Vec<(u64, Value)> = (0..2)
            .map(|index| {
                (
                    index,
                    mixed_config(MIXED_ROOT_SEED, index, 8, ChaosType::Normal),
                )
            })
            .collect();
        let races = run_all(&configs, &RaceExtras::default()).unwrap();
        assert!(
            races
                .iter()
                .all(|race| race.finished && race.ducks.len() == 8)
        );
        let run = MixedRun {
            engine: "rust".to_owned(),
            engine_version: String::new(),
            balance_version: String::new(),
            corpus: corpus_name(races.len()),
            races,
        };
        let dir = std::env::temp_dir().join(format!("race-cli-g3-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("run.json");
        std::fs::write(&path, serde_json::to_string(&run).unwrap()).unwrap();
        let path = path.to_str().unwrap();
        let (text, ok) = compare(path, path).unwrap();
        std::fs::remove_dir_all(&dir).unwrap();
        // Two races are too few for the absolute temperament range, so
        // `ok` is not asserted; identical runs have only zero deltas.
        let _ = ok;
        assert!(text.contains(" pass, 0 within noise, 0 fail."), "{text}");
        assert!(text.contains("| lead changes per race |") && text.contains("| +0.000 |"));
        assert!(text.contains("| lead changes per race |"));
    }
}
