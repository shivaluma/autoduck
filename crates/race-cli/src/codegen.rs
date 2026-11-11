//! `race-cli codegen`: exports the race-core catalogs and the protocol version
//! constants for the browser (plan D18/D19, Phase 4).
//!
//! Writes `catalog.json` and `versions.json` into `--out` (by default
//! `src/engine/generated`). `src/engine/catalog.ts` and `src/engine/protocol.ts`
//! re-implement the browser helpers over these tables, so the Rust catalog stays
//! the single source. CI re-runs this and checks the files with
//! `git diff --exit-code`.
//!
//! The two event→item tables (`eventItemActivation`, `eventItemSuccess`) are
//! not hand-written: they are derived by probing race-core's
//! `item_activation_for_event` / `item_success_for_event` with one sample event
//! of every type (the TS-oracle `event-variants.json` fixture) under every
//! combination of source/target player, and the probe fails loudly if a rule
//! doesn't fit the table's shape.

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use anyhow::{Context, Result, anyhow, bail, ensure};
use race_core::catalog::{AUTO_LOADOUT_PRESETS, ItemClass, RACE_ITEM_CATALOG, item_class};
use race_core::items::classes::{loadout_combo_badge, loadout_combo_label};
use race_core::items::telemetry::{
    ItemEventCredit, item_activation_for_event, item_success_for_event,
};
use race_core::pickups::catalog::WILD_ITEM_CATALOG;
use race_protocol::events::{EventKind, RaceEvent};
use race_protocol::ids::RaceItemId;
use race_protocol::versions;
use serde_json::{Value, json};

/// One sample of (almost) every event type, dumped from the TS engine.
const EVENT_VARIANTS: &str =
    include_str!("../../race-protocol/tests/fixtures/ts-oracle/event-variants.json");

const SOURCE: &str = "probe-source";
const TARGET: &str = "probe-target";

pub fn run_codegen(out: &str) -> Result<()> {
    let out = Path::new(out);
    fs::create_dir_all(out).with_context(|| format!("create {}", out.display()))?;
    write_json(&out.join("catalog.json"), &catalog_json()?)?;
    write_json(&out.join("versions.json"), &versions_json())?;
    eprintln!(
        "codegen: wrote catalog.json and versions.json to {}",
        out.display()
    );
    Ok(())
}

fn write_json(path: &Path, value: &Value) -> Result<()> {
    let mut text = serde_json::to_string_pretty(value)?;
    text.push('\n');
    fs::write(path, text).with_context(|| format!("write {}", path.display()))
}

fn versions_json() -> Value {
    json!({
        "RACE_PROTOCOL_VERSION": versions::RACE_PROTOCOL_VERSION,
        "RACE_ENGINE_VERSION": versions::RACE_ENGINE_VERSION,
        "RACE_BALANCE_VERSION": versions::RACE_BALANCE_VERSION,
        "RNG_VERSION": versions::RNG_VERSION,
        "DIGEST_VERSION": versions::DIGEST_VERSION,
        "TRACK_FORMAT": versions::TRACK_FORMAT,
        "TRACK_VERSION": versions::TRACK_VERSION,
        "PICKUP_SPAWN_VERSION": versions::PICKUP_SPAWN_VERSION,
        "HAZARD_BALANCE_VERSION": versions::HAZARD_BALANCE_VERSION,
        "RACE_TICK_RATE": versions::RACE_TICK_RATE,
        "SUPPORTED_BALANCE_VERSIONS": versions::SUPPORTED_BALANCE_VERSIONS,
    })
}

fn catalog_json() -> Result<Value> {
    let items: Vec<Value> = RACE_ITEM_CATALOG
        .iter()
        .map(|item| {
            json!({
                "id": item.id.as_str(),
                "name": item.name,
                "icon": item.icon,
                "cost": item.cost,
                "category": item.category.as_str(),
                "itemClass": item.item_class.as_str(),
                "description": item.description,
            })
        })
        .collect();
    let wild_items: Vec<Value> = WILD_ITEM_CATALOG
        .iter()
        .map(|item| {
            json!({
                "id": item.id.as_str(),
                "displayName": item.display_name,
                "icon": item.icon,
                "category": item.category.as_str(),
                "behavior": item.behavior.as_str(),
                "description": item.description,
            })
        })
        .collect();
    let classes: BTreeMap<&str, &str> = RaceItemId::ALL
        .iter()
        .map(|&id| (id.as_str(), item_class(id).as_str()))
        .collect();
    let presets: Vec<Vec<&str>> = AUTO_LOADOUT_PRESETS
        .iter()
        .map(|pair| pair.iter().map(|id| id.as_str()).collect())
        .collect();

    let samples = samples_by_type()?;
    Ok(json!({
        "items": items,
        "wildItems": wild_items,
        "classes": classes,
        "comboRules": combo_rules()?,
        "autoLoadoutPresets": presets,
        "eventItemActivation": event_table(&samples, item_activation_for_event)?,
        "eventItemSuccess": event_table(&samples, item_success_for_event)?,
    }))
}

/// `loadoutComboLabel` / `loadoutComboBadge` as a table: one entry per class for
/// two items of the same class, and one for a mixed pair. Checked against every
/// ordered pair of items, so a rule change that the table can't express fails.
fn combo_rules() -> Result<Value> {
    let combo = |pair: [RaceItemId; 2]| -> Result<(&'static str, &'static str)> {
        let label =
            loadout_combo_label(&pair).ok_or_else(|| anyhow!("no combo label for {pair:?}"))?;
        let badge =
            loadout_combo_badge(&pair).ok_or_else(|| anyhow!("no combo badge for {pair:?}"))?;
        Ok((label.as_str(), badge))
    };
    let mut same_class: BTreeMap<&str, Value> = BTreeMap::new();
    let mut mixed: Option<(&str, &str)> = None;
    for &a in RaceItemId::ALL {
        for &b in RaceItemId::ALL {
            let (label, badge) = combo([a, b])?;
            let (class_a, class_b): (ItemClass, ItemClass) = (item_class(a), item_class(b));
            if class_a == class_b {
                let entry = json!({ "label": label, "badge": badge });
                if let Some(previous) = same_class.insert(class_a.as_str(), entry.clone()) {
                    ensure!(
                        previous == entry,
                        "combo for {} depends on the items, not only the class",
                        class_a.as_str()
                    );
                }
            } else {
                match mixed {
                    None => mixed = Some((label, badge)),
                    Some(previous) => ensure!(
                        previous == (label, badge),
                        "mixed combo depends on the items"
                    ),
                }
            }
        }
    }
    ensure!(
        loadout_combo_label(&[RaceItemId::Nitro]).is_none(),
        "one-item loadouts are expected to have no combo"
    );
    let (label, badge) = mixed.ok_or_else(|| anyhow!("no mixed pair"))?;
    Ok(json!({ "sameClass": same_class, "mixed": { "label": label, "badge": badge } }))
}

/// The first fixture sample of every event type.
fn samples_by_type() -> Result<BTreeMap<String, Value>> {
    let samples: Vec<Value> = serde_json::from_str(EVENT_VARIANTS)?;
    let mut by_type: BTreeMap<String, Value> = BTreeMap::new();
    for sample in &samples {
        let type_name = sample["type"]
            .as_str()
            .ok_or_else(|| anyhow!("sample without type"))?;
        if by_type.contains_key(type_name) {
            continue;
        }
        by_type.insert(type_name.to_string(), sample.clone());
    }
    for name in EventKind::TYPE_NAMES {
        if !by_type.contains_key(*name)
            && !EventKind::META_TYPE_NAMES.contains(name)
            && !EventKind::UNEMITTED_TYPE_NAMES.contains(name)
        {
            eprintln!("codegen: note: no fixture sample for {name}; assuming it credits no item");
        }
    }

    Ok(by_type)
}

/// Who a credited player is, relative to the event (`??` fallbacks).
fn player_role(credit: &ItemEventCredit) -> &'static str {
    match credit.player_id.as_str() {
        SOURCE => "source",
        TARGET => "target",
        other => panic!("probe credited an unexpected player {other}"),
    }
}

/// Derive `{eventType: {itemId, requires, player}}` from a race-core
/// event→item function.
///
/// - `requires`: the id that must be present (JS-truthy) for any credit.
/// - `player`: `source`, `target`, `targetOrSource` (`target ?? source`) or
///   `sourceOrTarget` (`source ?? target`).
fn event_table(
    by_type: &BTreeMap<String, Value>,
    credit_for: fn(&RaceEvent) -> Option<ItemEventCredit>,
) -> Result<Value> {
    let mut table: BTreeMap<String, Value> = BTreeMap::new();
    for (type_name, sample) in by_type {
        let probe = |source: bool, target: bool| -> Result<Option<(RaceItemId, &'static str)>> {
            let mut value = sample.clone();
            let object = value
                .as_object_mut()
                .ok_or_else(|| anyhow!("{type_name}: sample is not an object"))?;
            object.remove("sourcePlayerId");
            object.remove("targetPlayerId");
            if source {
                object.insert("sourcePlayerId".into(), SOURCE.into());
            }
            if target {
                object.insert("targetPlayerId".into(), TARGET.into());
            }
            object.insert("seq".into(), 0.into());
            let event: RaceEvent = serde_json::from_value(value)
                .with_context(|| format!("{type_name}: sample does not parse"))?;
            Ok(credit_for(&event).map(|credit| (credit.item_id, player_role(&credit))))
        };
        let both = probe(true, true)?;
        let only_source = probe(true, false)?;
        let only_target = probe(false, true)?;
        let neither = probe(false, false)?;
        if both.is_none() && only_source.is_none() && only_target.is_none() && neither.is_none() {
            continue;
        }
        ensure!(
            neither.is_none(),
            "{type_name}: credits an item with no player"
        );
        let both =
            both.ok_or_else(|| anyhow!("{type_name}: credits with one player but not with both"))?;
        let item = both.0;
        for (label, result) in [("source only", only_source), ("target only", only_target)] {
            if let Some((other, _)) = result {
                ensure!(
                    other == item,
                    "{type_name}: {label} credits {other} instead of {item}"
                );
            }
        }
        let (requires, player) = match (only_source, only_target) {
            (Some((_, "source")), None) => (
                "source",
                if both.1 == "target" {
                    "targetOrSource"
                } else {
                    "source"
                },
            ),
            (None, Some((_, "target"))) => (
                "target",
                if both.1 == "source" {
                    "sourceOrTarget"
                } else {
                    "target"
                },
            ),
            other => bail!("{type_name}: rule shape not expressible as a table ({other:?})"),
        };
        table.insert(
            type_name.clone(),
            json!({ "itemId": item.as_str(), "requires": requires, "player": player }),
        );
    }
    Ok(serde_json::to_value(table)?)
}
