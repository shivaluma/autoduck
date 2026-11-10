//! The `balance` block of the admin Season 3 GET (`app/api/admin/season3/route.ts`):
//! per-item, per-loadout and per-pickup aggregates over the active season's race telemetry.
//!
//! Arithmetic is the TS expression order (`count / normalize / playerPicks`), so every double
//! is bit-identical. Groups appear in first-seen row order and are then sorted with a stable
//! sort, so the caller must pass rows in the order Prisma's `findMany` returns them.

use std::cmp::Ordering;

use serde::Serialize;

/// The `RaceItemTelemetry` columns the summary reads.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ItemTelemetryRow {
    pub item_id: String,
    pub loadout_key: String,
    pub won: bool,
    pub bottom_two: bool,
    pub final_rank: i64,
    pub rank_delta: i64,
    pub activated: bool,
    pub succeeded: bool,
}

/// The `RacePickupTelemetry` columns the summary reads.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PickupTelemetryRow {
    pub item_id: String,
    pub activated: bool,
    pub hit_count: i64,
    pub manual_used: bool,
    pub auto_used: bool,
    pub rank_delta: i64,
}

/// One `summarizeTelemetry` entry.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetrySummary {
    pub name: String,
    pub picks: f64,
    pub win_rate: f64,
    pub bottom2_rate: f64,
    pub average_finish: f64,
    pub average_rank_delta: f64,
    pub activation_rate: f64,
    pub success_rate: f64,
}

/// One pickup entry.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickupSummary {
    pub name: String,
    pub picks: f64,
    pub activation_rate: f64,
    pub hit_rate: f64,
    pub manual_rate: f64,
    pub auto_rate: f64,
    pub average_rank_delta: f64,
}

/// The whole `balance` object.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct BalanceSummary {
    pub items: Vec<TelemetrySummary>,
    pub loadouts: Vec<TelemetrySummary>,
    pub pickups: Vec<PickupSummary>,
}

/// Which `summarizeTelemetry` key.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TelemetryKey {
    /// One row per player and item.
    ItemId,
    /// Two rows (one per item) per player pick.
    LoadoutKey,
}

// Row counts are tiny (a season of races), exact as doubles.
#[allow(clippy::cast_precision_loss)]
fn count<T>(rows: &[&T], predicate: impl Fn(&T) -> bool) -> f64 {
    rows.iter().filter(|row| predicate(row)).count() as f64
}

#[allow(clippy::cast_precision_loss)]
fn sum<T>(rows: &[&T], value: impl Fn(&T) -> i64) -> f64 {
    // `rows.reduce((sum, row) => sum + row.x, 0)`, left to right in doubles.
    rows.iter()
        .fold(0.0, |total, row| total + value(row) as f64)
}

#[allow(clippy::cast_precision_loss)]
fn len_f64<T>(rows: &[T]) -> f64 {
    rows.len() as f64
}

/// `[...new Map(...)]` grouping: first-seen order.
fn group_by<T>(rows: &[T], key: impl Fn(&T) -> &str) -> Vec<(String, Vec<&T>)> {
    let mut groups: Vec<(String, Vec<&T>)> = Vec::new();
    for row in rows {
        let name = key(row);
        match groups.iter_mut().find(|(existing, _)| existing == name) {
            Some((_, members)) => members.push(row),
            None => groups.push((name.to_owned(), vec![row])),
        }
    }
    groups
}

/// `(left, right) => right.x - left.x` for finite doubles, as a stable descending sort.
fn by_descending(left: f64, right: f64) -> Ordering {
    right.partial_cmp(&left).unwrap_or(Ordering::Equal)
}

/// `summarizeTelemetry(key)`.
#[must_use]
pub fn summarize_telemetry(rows: &[ItemTelemetryRow], key: TelemetryKey) -> Vec<TelemetrySummary> {
    let groups = group_by(rows, |row| match key {
        TelemetryKey::ItemId => &row.item_id,
        TelemetryKey::LoadoutKey => &row.loadout_key,
    });
    let normalize = match key {
        TelemetryKey::ItemId => 1.0,
        TelemetryKey::LoadoutKey => 2.0,
    };
    let mut summaries: Vec<TelemetrySummary> = groups
        .into_iter()
        .map(|(name, rows)| {
            let length = len_f64(&rows);
            let player_picks = match key {
                TelemetryKey::ItemId => length,
                TelemetryKey::LoadoutKey => length / 2.0,
            };
            let activated = count(&rows, |row| row.activated);
            TelemetrySummary {
                name,
                picks: player_picks,
                win_rate: count(&rows, |row| row.won) / normalize / player_picks,
                bottom2_rate: count(&rows, |row| row.bottom_two) / normalize / player_picks,
                average_finish: sum(&rows, |row| row.final_rank) / normalize / player_picks,
                average_rank_delta: sum(&rows, |row| row.rank_delta) / normalize / player_picks,
                activation_rate: activated / length,
                success_rate: count(&rows, |row| row.succeeded)
                    / if activated > 1.0 { activated } else { 1.0 },
            }
        })
        .collect();
    summaries.sort_by(|left, right| by_descending(left.win_rate, right.win_rate));
    summaries
}

/// The pickup summary.
#[must_use]
pub fn summarize_pickups(rows: &[PickupTelemetryRow]) -> Vec<PickupSummary> {
    let mut summaries: Vec<PickupSummary> = group_by(rows, |row| &row.item_id)
        .into_iter()
        .map(|(name, rows)| {
            let picks = len_f64(&rows);
            let activations = count(&rows, |row| row.activated);
            // `Math.max(1, n)` for counts >= 0.
            let at_least_one = |value: f64| if value > 1.0 { value } else { 1.0 };
            PickupSummary {
                name,
                picks,
                activation_rate: activations / at_least_one(picks),
                hit_rate: sum(&rows, |row| row.hit_count) / at_least_one(activations),
                manual_rate: count(&rows, |row| row.manual_used) / at_least_one(activations),
                auto_rate: count(&rows, |row| row.auto_used) / at_least_one(activations),
                average_rank_delta: sum(&rows, |row| row.rank_delta) / at_least_one(picks),
            }
        })
        .collect();
    summaries.sort_by(|left, right| by_descending(left.picks, right.picks));
    summaries
}

/// The admin GET `balance` block.
#[must_use]
pub fn balance_summary(
    telemetry: &[ItemTelemetryRow],
    pickups: &[PickupTelemetryRow],
) -> BalanceSummary {
    BalanceSummary {
        items: summarize_telemetry(telemetry, TelemetryKey::ItemId),
        loadouts: summarize_telemetry(telemetry, TelemetryKey::LoadoutKey),
        pickups: summarize_pickups(pickups),
    }
}
