//! Meta-parity checker shared by `crates/race-core/tests/meta_parity.rs` and
//! `race-cli oracle meta` (included there with `#[path]`).
//!
//! The fixture (`meta-parity-v1`, from `scripts/oracle/dump-meta-fixtures.ts`)
//! stores each oracle result as its exact `JSON.stringify` text. This module
//! runs the Rust port on the same inputs and renders its result in the same
//! form (TS key order, JS property order for `reasonByPlayer`, omitted
//! `undefined` keys, non-finite numbers as `null`), so a case passes only on
//! a byte-identical string.
//!
//! Needs race-core's `ts-compat` feature for `localeCompare` tie-breaks.

#![allow(dead_code)]

use std::collections::BTreeMap;
use std::fmt::Write as _;

use race_core::canonical::{number_to_string, push_json_string};
use race_core::catalog::{AUTO_LOADOUT_PRESETS, RACE_ITEM_CATALOG};
use race_core::chaos::{
    ChaosMetadata, ChaosPreparedState, ChaosResult, ChaosType, RawChaosEntry, prepare_chaos_rule,
    resolve_chaos_rule,
};
use race_core::loadout::{select_auto_loadout, validate_loadout};
use race_core::meta::{
    CHAOS_CARDS, ChaosCard, Season3Player, manual_chaos_stream, open_week_chaos_card,
    select_chaos_card, set_chaos_card, toggle_skip_chaos_card_with_rng, weekly_chaos_stream,
};
use race_core::rng::{DeterministicRng, create_race_rng};
use race_protocol::ids::RaceItemId;
use serde::Deserialize;

pub const FORMAT: &str = "meta-parity-v1";

// ---------------------------------------------------------------------------
// Fixture

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Fixture {
    pub format: String,
    pub generator: String,
    pub node: String,
    pub oracle_sha256: BTreeMap<String, String>,
    pub chaos_cards: Vec<String>,
    pub catalog: Vec<CatalogRow>,
    pub auto_loadout_presets: Vec<Vec<String>>,
    pub cases: Vec<Case>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogRow {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub cost: u8,
    pub category: String,
    pub item_class: String,
    pub description: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RankEntry {
    pub player_id: String,
    pub rank: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserRank {
    pub user_id: i64,
    pub rank: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Player {
    pub user_id: i64,
    pub name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Override {
    pub target_player_id: Option<String>,
    pub groups: Option<Vec<Vec<String>>>,
}

#[derive(Deserialize)]
pub struct RuleExpected {
    pub prepared: String,
    pub after: u32,
    pub resolve: String,
}

#[derive(Deserialize)]
pub struct SelectExpected {
    pub card: String,
    pub after: u32,
    pub resolve: Option<String>,
}

#[derive(Deserialize)]
pub struct CardExpected {
    pub card: String,
    pub after: u32,
}

#[derive(Deserialize)]
pub struct AutoExpected {
    pub items: Vec<String>,
    pub validation: String,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Case {
    #[serde(rename_all = "camelCase")]
    Rule {
        #[serde(rename = "type")]
        chaos_type: String,
        seed: String,
        stream: String,
        players: Vec<String>,
        ranking: Vec<RankEntry>,
        #[serde(rename = "override")]
        override_: Option<Override>,
        expected: RuleExpected,
    },
    #[serde(rename_all = "camelCase")]
    Select {
        seed: String,
        stream: String,
        players: Vec<Player>,
        ranking: Vec<UserRank>,
        expected: SelectExpected,
    },
    #[serde(rename_all = "camelCase")]
    OpenWeek {
        seed: String,
        week_number: u32,
        requested: Option<String>,
        players: Vec<Player>,
        expected: CardExpected,
    },
    #[serde(rename_all = "camelCase")]
    SetChaos {
        seed: String,
        week_number: u32,
        ms: i64,
        requested: Option<String>,
        players: Vec<Player>,
        expected: CardExpected,
    },
    #[serde(rename_all = "camelCase")]
    ToggleSkip {
        seed: String,
        week_number: u32,
        chaos_type: String,
        players: Vec<Player>,
        expected: CardExpected,
    },
    #[serde(rename_all = "camelCase")]
    AutoLoadout {
        seed: String,
        player_id: String,
        expected: AutoExpected,
    },
    #[serde(rename_all = "camelCase")]
    Validate {
        item_ids: Vec<String>,
        expected: String,
    },
}

impl Case {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Rule { .. } => "rule",
            Self::Select { .. } => "select",
            Self::OpenWeek { .. } => "open-week",
            Self::SetChaos { .. } => "set-chaos",
            Self::ToggleSkip { .. } => "toggle-skip",
            Self::AutoLoadout { .. } => "auto-loadout",
            Self::Validate { .. } => "validate",
        }
    }
}

// ---------------------------------------------------------------------------
// JSON.stringify rendering

fn js_number(out: &mut String, x: f64) {
    match number_to_string(x) {
        Ok(text) => out.push_str(&text),
        // JSON.stringify(NaN / ±Infinity) is `null`.
        Err(_) => out.push_str("null"),
    }
}

fn js_string_array<S: AsRef<str>>(out: &mut String, items: &[S]) {
    out.push('[');
    for (index, item) in items.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        push_json_string(out, item.as_ref());
    }
    out.push(']');
}

fn js_groups<S: AsRef<str>>(out: &mut String, groups: &[Vec<S>]) {
    out.push('[');
    for (index, group) in groups.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        js_string_array(out, group);
    }
    out.push(']');
}

fn js_int_groups(out: &mut String, groups: &[Vec<i64>]) {
    out.push('[');
    for (index, group) in groups.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        out.push('[');
        for (inner, id) in group.iter().enumerate() {
            if inner > 0 {
                out.push(',');
            }
            let _ = write!(out, "{id}");
        }
        out.push(']');
    }
    out.push(']');
}

fn error_view(message: &str) -> String {
    let mut out = String::from("{\"error\":");
    push_json_string(&mut out, message);
    out.push('}');
    out
}

/// `JSON.stringify(prepared)`.
pub fn prepared_view(prepared: &ChaosPreparedState) -> String {
    let mut out = String::from("{");
    let mut first = true;
    if let Some(target) = &prepared.target_player_id {
        out.push_str("\"targetPlayerId\":");
        push_json_string(&mut out, target);
        first = false;
    }
    if let Some(groups) = &prepared.groups {
        if !first {
            out.push(',');
        }
        out.push_str("\"groups\":");
        js_groups(&mut out, groups);
    }
    out.push('}');
    out
}

/// `JSON.stringify(resolveChaosRule(...))`.
pub fn result_view(result: &ChaosResult) -> String {
    let mut out = String::from("{");
    if let Some(final_standings) = &result.final_standings {
        out.push_str("\"finalStandings\":");
        js_string_array(&mut out, final_standings);
        out.push(',');
    }
    out.push_str("\"loserPlayerIds\":");
    js_string_array(&mut out, &result.loser_player_ids);
    out.push_str(",\"metadata\":{");
    match &result.metadata {
        ChaosMetadata::Reasons { .. } => {}
        ChaosMetadata::Duo { scores, .. } => {
            out.push_str("\"scores\":[");
            for (index, score) in scores.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                out.push_str("{\"group\":");
                js_string_array(&mut out, &score.group);
                out.push_str(",\"total\":");
                js_number(&mut out, score.total);
                out.push_str(",\"average\":");
                js_number(&mut out, score.average);
                out.push_str(",\"worst\":");
                js_number(&mut out, score.worst);
                out.push_str(",\"best\":");
                js_number(&mut out, score.best);
                let _ = write!(out, ",\"tieOrder\":{}}}", score.tie_order);
            }
            out.push_str("],");
        }
        ChaosMetadata::Constructors {
            totals,
            averages,
            tie,
            scores,
            ..
        } => {
            out.push_str("\"totals\":[");
            js_number(&mut out, totals[0]);
            out.push(',');
            js_number(&mut out, totals[1]);
            out.push_str("],\"averages\":[");
            js_number(&mut out, averages[0]);
            out.push(',');
            js_number(&mut out, averages[1]);
            let _ = write!(out, "],\"tie\":{tie},\"scores\":[");
            for (index, score) in scores.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                let _ = write!(out, "{{\"index\":{},\"group\":", score.index);
                js_string_array(&mut out, &score.group);
                out.push_str(",\"total\":");
                js_number(&mut out, score.total);
                out.push_str(",\"average\":");
                js_number(&mut out, score.average);
                out.push_str(",\"worst\":");
                js_number(&mut out, score.worst);
                out.push_str(",\"best\":");
                js_number(&mut out, score.best);
                out.push('}');
            }
            out.push_str("],");
        }
        ChaosMetadata::BountyHunt {
            wanted_player_id,
            escaped,
            cutoff,
            ..
        } => {
            out.push_str("\"wantedPlayerId\":");
            push_json_string(&mut out, wanted_player_id);
            let _ = write!(out, ",\"escaped\":{escaped},\"cutoff\":{cutoff},");
        }
    }
    out.push_str("\"reasonByPlayer\":{");
    for (index, (player_id, reason)) in result
        .metadata
        .reason_by_player()
        .entries()
        .iter()
        .enumerate()
    {
        if index > 0 {
            out.push(',');
        }
        push_json_string(&mut out, player_id);
        out.push(':');
        push_json_string(&mut out, reason);
    }
    out.push_str("}}}");
    out
}

/// `JSON.stringify(card)` (`groups` omitted when `undefined`).
pub fn card_view(card: &ChaosCard) -> String {
    let mut out = String::from("{\"type\":");
    push_json_string(&mut out, card.chaos_type.as_str());
    out.push_str(",\"targetUserId\":");
    match card.target_user_id {
        Some(id) => {
            let _ = write!(out, "{id}");
        }
        None => out.push_str("null"),
    }
    out.push_str(",\"targetUserId2\":");
    match card.target_user_id2 {
        Some(id) => {
            let _ = write!(out, "{id}");
        }
        None => out.push_str("null"),
    }
    if let Some(groups) = &card.groups {
        out.push_str(",\"groups\":");
        js_int_groups(&mut out, groups);
    }
    out.push('}');
    out
}

fn validation_view(item_ids: &[RaceItemId]) -> String {
    match validate_loadout(item_ids) {
        Ok(result) => {
            let ids: Vec<&str> = result.items.iter().map(|item| item.id.as_str()).collect();
            let mut out = String::from("{\"items\":");
            js_string_array(&mut out, &ids);
            let _ = write!(
                out,
                ",\"spent\":{},\"ready\":{}}}",
                result.spent, result.ready
            );
            out
        }
        Err(error) => error_view(&error.to_string()),
    }
}

// ---------------------------------------------------------------------------
// Runner

#[derive(Default)]
pub struct Report {
    /// kind -> (passed, total)
    pub by_kind: BTreeMap<&'static str, (u64, u64)>,
    pub catalog_ok: bool,
    pub catalog_problems: Vec<String>,
    pub mismatches: Vec<String>,
    pub mismatch_count: u64,
}

impl Report {
    pub fn total(&self) -> (u64, u64) {
        self.by_kind
            .values()
            .fold((0, 0), |(p, t), &(cp, ct)| (p + cp, t + ct))
    }

    pub fn passed(&self) -> bool {
        let (passed, total) = self.total();
        self.catalog_ok && passed == total && total > 0
    }
}

fn chaos_type(name: &str) -> Result<ChaosType, String> {
    ChaosType::from_wire(name).ok_or_else(|| format!("unknown chaos type {name:?}"))
}

fn item_id(name: &str) -> Result<RaceItemId, String> {
    RaceItemId::from_wire(name).ok_or_else(|| format!("unknown item id {name:?}"))
}

fn players_of(players: &[Player]) -> Vec<Season3Player<'_>> {
    players
        .iter()
        .map(|player| Season3Player {
            user_id: player.user_id,
            name: &player.name,
        })
        .collect()
}

fn card_or_error(result: Result<ChaosCard, impl ToString>) -> (String, Option<ChaosCard>) {
    match result {
        Ok(card) => (card_view(&card), Some(card)),
        Err(error) => (error_view(&error.to_string()), None),
    }
}

fn compare(field: &str, expected: &str, actual: &str, problems: &mut Vec<String>) {
    if expected != actual {
        problems.push(format!("{field}: expected {expected} got {actual}"));
    }
}

fn compare_u32(field: &str, expected: u32, actual: u32, problems: &mut Vec<String>) {
    if expected != actual {
        problems.push(format!("{field}: expected {expected} got {actual}"));
    }
}

/// Runs one case; returns the list of differing fields (empty on a pass).
pub fn check_case(case: &Case) -> Result<Vec<String>, String> {
    let mut problems = Vec::new();
    match case {
        Case::Rule {
            chaos_type: name,
            seed,
            stream,
            players,
            ranking,
            override_,
            expected,
        } => {
            let id = chaos_type(name)?;
            let mut rng = create_race_rng(seed, stream);
            let prepared = prepare_chaos_rule(id, players, &mut || rng.next_f64());
            compare(
                "prepared",
                &expected.prepared,
                &prepared_view(&prepared),
                &mut problems,
            );
            compare_u32("after", expected.after, rng.next_u32(), &mut problems);
            let resolve_with = match override_ {
                Some(over) => ChaosPreparedState {
                    target_player_id: over.target_player_id.clone(),
                    groups: over.groups.clone(),
                },
                None => prepared,
            };
            let raw: Vec<RawChaosEntry<'_>> = ranking
                .iter()
                .map(|entry| RawChaosEntry {
                    player_id: &entry.player_id,
                    rank: entry.rank,
                })
                .collect();
            let actual = match resolve_chaos_rule(id, &raw, &resolve_with) {
                Ok(result) => result_view(&result),
                Err(error) => error_view(&error.to_string()),
            };
            compare("resolve", &expected.resolve, &actual, &mut problems);
        }
        Case::Select {
            seed,
            stream,
            players,
            ranking,
            expected,
        } => {
            let lobby = players_of(players);
            let mut rng = create_race_rng(seed, stream);
            let (view, card) = card_or_error(select_chaos_card(&lobby, &mut || rng.next_f64()));
            compare("card", &expected.card, &view, &mut problems);
            compare_u32("after", expected.after, rng.next_u32(), &mut problems);
            let actual = card.map(|card| {
                // resolveSeason3Race: ranking sorted by rank, ids as String(userId).
                let ids: Vec<(String, u32)> = ranking
                    .iter()
                    .map(|entry| (entry.user_id.to_string(), entry.rank))
                    .collect();
                let raw: Vec<RawChaosEntry<'_>> = ids
                    .iter()
                    .map(|(id, rank)| RawChaosEntry {
                        player_id: id,
                        rank: *rank,
                    })
                    .collect();
                match resolve_chaos_rule(card.chaos_type, &raw, &card.prepared_state()) {
                    Ok(result) => result_view(&result),
                    Err(error) => error_view(&error.to_string()),
                }
            });
            if expected.resolve != actual {
                problems.push(format!(
                    "resolve: expected {:?} got {actual:?}",
                    expected.resolve
                ));
            }
        }
        Case::OpenWeek {
            seed,
            week_number,
            requested,
            players,
            expected,
        } => {
            let requested = requested.as_deref().map(chaos_type).transpose()?;
            let lobby = players_of(players);
            let mut rng = create_race_rng(seed, &weekly_chaos_stream(*week_number));
            let (view, _) = card_or_error(open_week_chaos_card(requested, &lobby, &mut || {
                rng.next_f64()
            }));
            compare("card", &expected.card, &view, &mut problems);
            compare_u32("after", expected.after, rng.next_u32(), &mut problems);
        }
        Case::SetChaos {
            seed,
            week_number,
            ms,
            requested,
            players,
            expected,
        } => {
            let requested = requested.as_deref().map(chaos_type).transpose()?;
            let lobby = players_of(players);
            let mut rng = create_race_rng(seed, &manual_chaos_stream(*week_number, *ms));
            let (view, _) =
                card_or_error(set_chaos_card(requested, &lobby, &mut || rng.next_f64()));
            compare("card", &expected.card, &view, &mut problems);
            compare_u32("after", expected.after, rng.next_u32(), &mut problems);
        }
        Case::ToggleSkip {
            seed,
            week_number,
            chaos_type: name,
            players,
            expected,
        } => {
            let id = chaos_type(name)?;
            let lobby = players_of(players);
            let mut rng: DeterministicRng =
                create_race_rng(seed, &weekly_chaos_stream(*week_number));
            let (view, _) = card_or_error(toggle_skip_chaos_card_with_rng(&mut rng, id, &lobby));
            compare("card", &expected.card, &view, &mut problems);
            compare_u32("after", expected.after, rng.next_u32(), &mut problems);
        }
        Case::AutoLoadout {
            seed,
            player_id,
            expected,
        } => {
            let items = select_auto_loadout(seed, player_id);
            let names: Vec<&str> = items.iter().map(|id| id.as_str()).collect();
            if names != expected.items {
                problems.push(format!(
                    "items: expected {:?} got {names:?}",
                    expected.items
                ));
            }
            compare(
                "validation",
                &expected.validation,
                &validation_view(&items),
                &mut problems,
            );
        }
        Case::Validate { item_ids, expected } => {
            let ids = item_ids
                .iter()
                .map(|name| item_id(name))
                .collect::<Result<Vec<_>, _>>()?;
            compare(
                "validation",
                expected,
                &validation_view(&ids),
                &mut problems,
            );
        }
    }
    Ok(problems)
}

/// Compares the TS catalog block with `race_core::catalog`.
pub fn check_catalog(fixture: &Fixture) -> Vec<String> {
    let mut problems = Vec::new();
    let cards: Vec<&str> = CHAOS_CARDS.iter().map(|card| card.as_str()).collect();
    if fixture.chaos_cards != cards {
        problems.push(format!(
            "CHAOS_CARDS: TS {:?} Rust {cards:?}",
            fixture.chaos_cards
        ));
    }
    if fixture.catalog.len() != RACE_ITEM_CATALOG.len() {
        problems.push(format!(
            "RACE_ITEM_CATALOG length: TS {} Rust {}",
            fixture.catalog.len(),
            RACE_ITEM_CATALOG.len()
        ));
    }
    for (ts, rust) in fixture.catalog.iter().zip(&RACE_ITEM_CATALOG) {
        let same = ts.id == rust.id.as_str()
            && ts.name == rust.name
            && ts.icon == rust.icon
            && ts.cost == rust.cost
            && ts.category == rust.category.as_str()
            && ts.item_class == rust.item_class.as_str()
            && ts.description == rust.description;
        if !same {
            problems.push(format!("RACE_ITEM_CATALOG row {} differs", ts.id));
        }
    }
    let presets: Vec<Vec<&str>> = AUTO_LOADOUT_PRESETS
        .iter()
        .map(|preset| preset.iter().map(|id| id.as_str()).collect())
        .collect();
    if fixture.auto_loadout_presets != presets {
        problems.push(format!(
            "AUTO_LOADOUT_PRESETS: TS {:?} Rust {presets:?}",
            fixture.auto_loadout_presets
        ));
    }
    problems
}

/// Parses a decompressed fixture and checks every case. Keeps the first
/// `keep_mismatches` mismatch descriptions.
pub fn run(json: &[u8], keep_mismatches: usize) -> Result<(Fixture, Report), String> {
    let fixture: Fixture =
        serde_json::from_slice(json).map_err(|error| format!("parse fixture: {error}"))?;
    if fixture.format != FORMAT {
        return Err(format!(
            "fixture format {:?}, expected {FORMAT:?}",
            fixture.format
        ));
    }
    let mut report = Report::default();
    report.catalog_problems = check_catalog(&fixture);
    report.catalog_ok = report.catalog_problems.is_empty();
    for (index, case) in fixture.cases.iter().enumerate() {
        let problems = check_case(case).map_err(|error| format!("case {index}: {error}"))?;
        let entry = report.by_kind.entry(case.kind()).or_insert((0, 0));
        entry.1 += 1;
        if problems.is_empty() {
            entry.0 += 1;
        } else {
            report.mismatch_count += 1;
            if report.mismatches.len() < keep_mismatches {
                report.mismatches.push(format!(
                    "case {index} ({}): {}",
                    case.kind(),
                    problems.join("; ")
                ));
            }
        }
    }
    Ok((fixture, report))
}
