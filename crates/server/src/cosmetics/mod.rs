//! The cosmetic catalog (D19). TS `lib/cosmetics/catalog.ts` and `legacy.ts` stay the source of
//! truth; `pnpm cosmetics:export-catalog` writes `crates/server/data/cosmetic-{catalog,legacy}.json`
//! and this module embeds them with `include_str!` (CI: `git diff --exit-code`).
//!
//! Each item keeps its exported JSON verbatim ([`CosmeticItem::raw`]), so routes that return
//! catalog entries put exactly the TS objects on the wire (same key order, no `undefined` keys).
//!
//! **Unknown ids** (owned or equipped ids that aren't in the catalog) are preserved as-is: Rust
//! never drops or normalises them, it only logs them once per id ([`note_unknown`]).
//!
//! Economy logic ported from `lib/cosmetics/*` lives in the submodules: [`shop`] (rotation,
//! bit-exact), [`gacha`] (selection and pity, bit-exact), [`economy`] (Quack Point ledger),
//! [`inventory`] (appearance, starter grant, legacy planners), [`rows`] (Prisma-shaped rows and
//! queries), [`ids`] (cuid/UUID/random) and [`js`] (JavaScript semantics the routes rely on).

pub mod economy;
pub mod gacha;
pub mod ids;
pub mod inventory;
pub mod js;
pub mod rows;
pub mod shop;

use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::{Mutex, OnceLock};

use serde::Deserialize;
use serde_json::value::RawValue;

const CATALOG_JSON: &str = include_str!("../../data/cosmetic-catalog.json");
const LEGACY_JSON: &str = include_str!("../../data/cosmetic-legacy.json");

#[derive(
    Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Deserialize, serde::Serialize,
)]
#[serde(rename_all = "lowercase")]
pub enum Rarity {
    Common,
    Uncommon,
    Rare,
    Epic,
    Legendary,
}

impl Rarity {
    pub const ALL: [Rarity; 5] = [
        Rarity::Common,
        Rarity::Uncommon,
        Rarity::Rare,
        Rarity::Epic,
        Rarity::Legendary,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Rarity::Common => "common",
            Rarity::Uncommon => "uncommon",
            Rarity::Rare => "rare",
            Rarity::Epic => "epic",
            Rarity::Legendary => "legendary",
        }
    }
}

/// The typed fields routes need. Everything else stays in `raw`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ItemFields {
    id: String,
    name: String,
    slot: String,
    rarity: Rarity,
    #[serde(default)]
    collection: Option<String>,
    shop_eligible: bool,
    gacha_eligible: bool,
}

#[derive(Debug)]
pub struct CosmeticItem {
    pub id: String,
    pub name: String,
    pub slot: String,
    pub rarity: Rarity,
    pub collection: Option<String>,
    pub shop_eligible: bool,
    pub gacha_eligible: bool,
    /// The exported object as compact JSON, keys in TS order (`JSON.stringify` of the definition).
    pub raw: Box<RawValue>,
}

impl CosmeticItem {
    /// The definition as a JSON object (keys in TS order), for `{ ...item, extra }` spreads.
    pub fn to_object(&self) -> serde_json::Map<String, serde_json::Value> {
        serde_json::from_str(self.raw.get()).unwrap_or_default()
    }

    /// The definition as a JSON value (`item` in a response).
    pub fn to_value(&self) -> serde_json::Value {
        serde_json::Value::Object(self.to_object())
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogFile {
    format: String,
    slots: Vec<String>,
    rarities: Vec<Rarity>,
    starter_ids: Vec<String>,
    default_appearance: serde_json::Map<String, serde_json::Value>,
    items: Vec<Box<RawValue>>,
}

#[derive(Debug)]
pub struct Catalog {
    /// `COSMETIC_SLOTS`, in order.
    pub slots: Vec<String>,
    pub rarities: Vec<Rarity>,
    /// `STARTER_COSMETIC_IDS`, in order.
    pub starter_ids: Vec<String>,
    /// `DEFAULT_APPEARANCE`, keys in TS order.
    pub default_appearance: Vec<(String, String)>,
    /// `COSMETIC_CATALOG`, in order.
    pub items: Vec<CosmeticItem>,
    by_id: HashMap<String, usize>,
}

impl Catalog {
    /// `COSMETIC_BY_ID.get(id)`.
    pub fn get(&self, id: &str) -> Option<&CosmeticItem> {
        self.by_id.get(id).map(|index| &self.items[*index])
    }

    pub fn contains(&self, id: &str) -> bool {
        self.by_id.contains_key(id)
    }
}

#[derive(Deserialize)]
struct LegacyFile {
    format: String,
    remap: BTreeMap<String, String>,
    v1: BTreeMap<String, (String, Rarity)>,
}

#[derive(Debug)]
pub struct Legacy {
    /// `LEGACY_REMAP`: retired v1 id → v2 replacement.
    pub remap: BTreeMap<String, String>,
    /// `LEGACY_V1_COSMETICS`: v1 id → (slot, rarity), for refunds.
    pub v1: BTreeMap<String, (String, Rarity)>,
}

fn parse_catalog(json: &str) -> Result<Catalog, String> {
    let file: CatalogFile = serde_json::from_str(json).map_err(|error| error.to_string())?;
    if file.format != "autoduck-cosmetic-catalog/1" {
        return Err(format!("unexpected catalog format {:?}", file.format));
    }
    let mut items = Vec::with_capacity(file.items.len());
    let mut by_id = HashMap::with_capacity(file.items.len());
    for raw in file.items {
        let fields: ItemFields =
            serde_json::from_str(raw.get()).map_err(|error| error.to_string())?;
        if by_id.insert(fields.id.clone(), items.len()).is_some() {
            return Err(format!("duplicate cosmetic id {:?}", fields.id));
        }
        if !file.slots.contains(&fields.slot) {
            return Err(format!(
                "{:?} has unknown slot {:?}",
                fields.id, fields.slot
            ));
        }
        // Compact, key order preserved (`preserve_order`): what `JSON.stringify` puts on the wire.
        let value: serde_json::Value =
            serde_json::from_str(raw.get()).map_err(|error| error.to_string())?;
        let compact = serde_json::to_string(&value).map_err(|error| error.to_string())?;
        let raw = RawValue::from_string(compact).map_err(|error| error.to_string())?;
        items.push(CosmeticItem {
            id: fields.id,
            name: fields.name,
            slot: fields.slot,
            rarity: fields.rarity,
            collection: fields.collection,
            shop_eligible: fields.shop_eligible,
            gacha_eligible: fields.gacha_eligible,
            raw,
        });
    }
    let default_appearance = file
        .default_appearance
        .into_iter()
        .map(|(key, value)| match value {
            serde_json::Value::String(id) => Ok((key, id)),
            other => Err(format!("defaultAppearance.{key} is not a string: {other}")),
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Catalog {
        slots: file.slots,
        rarities: file.rarities,
        starter_ids: file.starter_ids,
        default_appearance,
        items,
        by_id,
    })
}

/// The embedded catalog. Parsed once; a malformed export is a build defect, so it panics (the
/// unit tests parse it on every `cargo test`).
pub fn catalog() -> &'static Catalog {
    static CATALOG: OnceLock<Catalog> = OnceLock::new();
    CATALOG.get_or_init(|| {
        parse_catalog(CATALOG_JSON).expect("crates/server/data/cosmetic-catalog.json")
    })
}

pub fn legacy() -> &'static Legacy {
    static LEGACY: OnceLock<Legacy> = OnceLock::new();
    LEGACY.get_or_init(|| {
        let file: LegacyFile =
            serde_json::from_str(LEGACY_JSON).expect("crates/server/data/cosmetic-legacy.json");
        assert_eq!(file.format, "autoduck-cosmetic-legacy/1");
        Legacy {
            remap: file.remap,
            v1: file.v1,
        }
    })
}

/// Logs an id that isn't in the catalog, once per id per process. Callers keep the id as-is.
pub fn note_unknown(id: &str, context: &str) {
    static SEEN: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    let seen = SEEN.get_or_init(|| Mutex::new(HashSet::new()));
    let first = seen
        .lock()
        .map(|mut seen| seen.insert(id.to_owned()))
        .unwrap_or(false);
    if first {
        tracing::warn!(cosmetic_id = %id, context, "cosmetic id not in the catalog; preserved as-is");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_catalog_parses() {
        let catalog = catalog();
        assert!(catalog.items.len() >= 100);
        assert_eq!(catalog.slots.len(), 12);
        assert_eq!(catalog.rarities, Rarity::ALL.to_vec());
        for id in &catalog.starter_ids {
            assert!(catalog.contains(id), "starter {id} missing");
        }
        assert_eq!(
            catalog.default_appearance[0],
            ("bodyColorId".to_owned(), "body-sunshine".to_owned())
        );
        let sunshine = catalog.get("body-sunshine").unwrap();
        assert_eq!(sunshine.rarity, Rarity::Common);
        assert!(sunshine.raw.get().contains("\"color\":\"#FFD84D\""));
        assert!(catalog.get("not-a-cosmetic").is_none());
    }

    #[test]
    fn raw_items_are_byte_identical_to_json_stringify() {
        // `JSON.stringify(COSMETIC_CATALOG[i])` from lib/cosmetics/catalog.ts.
        assert_eq!(
            catalog().get("body-sunshine").unwrap().raw.get(),
            r##"{"id":"body-sunshine","name":"Sunshine","slot":"bodyColor","rarity":"common","collection":"Pond Basics","anchor":"body","asset":"/cosmetics/v2/bodyColor/body-sunshine.svg","previewAsset":"/cosmetics/v2/previews/body-sunshine.svg","shopEligible":true,"gachaEligible":true,"tags":["pond-basics","bodyColor"],"version":2,"color":"#FFD84D"}"##
        );
        assert_eq!(
            catalog().get("body-golden").unwrap().raw.get(),
            r##"{"id":"body-golden","name":"Golden Duck","slot":"bodyColor","rarity":"legendary","collection":"Pond Royalty","anchor":"body","asset":"/cosmetics/v2/bodyColor/body-golden.svg","previewAsset":"/cosmetics/v2/previews/body-golden.svg","shopEligible":true,"gachaEligible":true,"tags":["pond-royalty","bodyColor"],"version":2,"animation":"idle","color":"#F2B627"}"##
        );
    }

    #[test]
    fn legacy_tables_parse_and_point_into_the_catalog() {
        let legacy = legacy();
        assert!(!legacy.remap.is_empty());
        for target in legacy.remap.values() {
            assert!(catalog().contains(target), "remap target {target} missing");
        }
        assert_eq!(
            legacy.v1.get("body-sunshine"),
            Some(&("bodyColor".to_owned(), Rarity::Common))
        );
    }

    #[test]
    fn rejects_bad_exports() {
        assert!(parse_catalog("{}").is_err());
        let duplicate = r#"{"format":"autoduck-cosmetic-catalog/1","slots":["head"],"rarities":[],"starterIds":[],
            "defaultAppearance":{},"items":[
            {"id":"a","name":"A","slot":"head","rarity":"common","shopEligible":true,"gachaEligible":true},
            {"id":"a","name":"A","slot":"head","rarity":"common","shopEligible":true,"gachaEligible":true}]}"#;
        assert!(parse_catalog(duplicate).unwrap_err().contains("duplicate"));
    }
}
