//! Mystery Egg: a port of `lib/cosmetics/gacha.ts`, bit-exact for the same `rng()` sequence
//! (fixtures from `scripts/oracle/dump-cosmetic-fixtures.ts`, tested in `tests/gacha.rs`).
//!
//! `rng` is any `FnMut() -> f64` returning values in `[0, 1)`; the route passes
//! [`super::ids::random_unit`] (`randomInt(1_000_000) / 1_000_000`, as TS does).

use std::collections::HashSet;

use super::{CosmeticItem, Rarity};

/// `GACHA_CONFIG.cost`.
pub const COST: i64 = 3;
/// `GACHA_CONFIG.duplicateRefund`.
pub const DUPLICATE_REFUND: i64 = 2;
/// `GACHA_CONFIG.pity`.
pub const PITY_RARE: i64 = 5;
pub const PITY_EPIC: i64 = 12;
pub const PITY_LEGENDARY: i64 = 30;

/// `JSON.stringify(GACHA_CONFIG)`.
pub const CONFIG_JSON: &str = r#"{"cost":3,"duplicateRefund":2,"odds":{"common":40,"uncommon":30,"rare":18,"epic":9,"legendary":3},"pity":{"rare":5,"epic":12,"legendary":30}}"#;

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pity {
    pub rare_pity: i64,
    pub epic_pity: i64,
    pub legendary_pity: i64,
}

/// `rollRarity(input, rng)`.
pub fn roll_rarity(pity: Pity, rng: &mut impl FnMut() -> f64) -> Rarity {
    if pity.legendary_pity >= PITY_LEGENDARY {
        return Rarity::Legendary;
    }
    if pity.epic_pity >= PITY_EPIC {
        return if rng() < 0.25 {
            Rarity::Legendary
        } else {
            Rarity::Epic
        };
    }
    if pity.rare_pity >= PITY_RARE {
        let roll = rng() * 30.0;
        return if roll < 3.0 {
            Rarity::Legendary
        } else if roll < 12.0 {
            Rarity::Epic
        } else {
            Rarity::Rare
        };
    }
    let roll = rng() * 100.0;
    if roll < 40.0 {
        Rarity::Common
    } else if roll < 70.0 {
        Rarity::Uncommon
    } else if roll < 88.0 {
        Rarity::Rare
    } else if roll < 97.0 {
        Rarity::Epic
    } else {
        Rarity::Legendary
    }
}

#[derive(Clone, Debug)]
pub struct GachaResult<'a> {
    pub rolled_rarity: Rarity,
    pub final_item: &'a CosmeticItem,
    pub was_duplicate: bool,
    pub was_rerolled: bool,
    pub refund_amount: i64,
    pub pity_after: Pity,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum GachaError {
    /// `throw new Error(\`Gacha pool ${rolledRarity} trống\`)`.
    #[error("Gacha pool {} trống", .0.as_str())]
    EmptyPool(Rarity),
    /// `unowned[Math.floor(rng() * unowned.length)]` out of range (`rng()` returned ≥ 1).
    #[error("reroll index out of range")]
    RerollOutOfRange,
}

/// `Math.floor(rng() * len)` as an index, `None` when it isn't a valid one (`pool[i]` is
/// `undefined`).
fn pick(rng: &mut impl FnMut() -> f64, len: usize) -> Option<usize> {
    let scaled = rng() * len as f64;
    // `Math.floor` is exact; for 0 <= x < len it is the truncating cast.
    (scaled >= 0.0 && scaled < len as f64).then_some(scaled as usize)
}

/// `selectGachaResult({ ownedIds, ...pity, catalog }, rng)`. `catalog` is the route's
/// override-filtered list in catalog order; like TS, this still requires each item's own
/// `gachaEligible` flag.
pub fn select_gacha_result<'a>(
    owned: &HashSet<String>,
    pity: Pity,
    catalog: &[&'a CosmeticItem],
    rng: &mut impl FnMut() -> f64,
) -> Result<GachaResult<'a>, GachaError> {
    let mut rolled = roll_rarity(pity, rng);
    let eligible: Vec<Rarity> = Rarity::ALL
        .into_iter()
        .filter(|rarity| {
            catalog.iter().any(|item| {
                item.gacha_eligible && item.rarity == *rarity && !owned.contains(&item.id)
            })
        })
        .collect();
    if !eligible.contains(&rolled) {
        rolled = eligible
            .iter()
            .copied()
            .find(|rarity| *rarity > rolled)
            .or_else(|| eligible.last().copied())
            .unwrap_or(rolled);
    }
    let pool: Vec<&'a CosmeticItem> = catalog
        .iter()
        .copied()
        .filter(|item| item.gacha_eligible && item.rarity == rolled)
        .collect();
    let first = pick(rng, pool.len())
        .map(|index| pool[index])
        .ok_or(GachaError::EmptyPool(rolled))?;
    let was_duplicate = owned.contains(&first.id);
    let unowned: Vec<&'a CosmeticItem> = pool
        .iter()
        .copied()
        .filter(|item| !owned.contains(&item.id))
        .collect();
    let final_item = if was_duplicate && !unowned.is_empty() {
        pick(rng, unowned.len())
            .map(|index| unowned[index])
            .ok_or(GachaError::RerollOutOfRange)?
    } else {
        first
    };
    let duplicate_remains = owned.contains(&final_item.id);
    Ok(GachaResult {
        rolled_rarity: rolled,
        final_item,
        was_duplicate,
        was_rerolled: was_duplicate && !unowned.is_empty(),
        refund_amount: if duplicate_remains {
            DUPLICATE_REFUND
        } else {
            0
        },
        pity_after: Pity {
            rare_pity: if rolled >= Rarity::Rare {
                0
            } else {
                pity.rare_pity + 1
            },
            epic_pity: if rolled >= Rarity::Epic {
                0
            } else {
                pity.epic_pity + 1
            },
            legendary_pity: if rolled == Rarity::Legendary {
                0
            } else {
                pity.legendary_pity + 1
            },
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cosmetics::catalog;

    const ZERO: Pity = Pity {
        rare_pity: 0,
        epic_pity: 0,
        legendary_pity: 0,
    };

    fn constant(value: f64) -> impl FnMut() -> f64 {
        move || value
    }

    #[test]
    fn config_json_matches_the_constants() {
        let config: serde_json::Value = serde_json::from_str(CONFIG_JSON).unwrap();
        assert_eq!(config["cost"], COST);
        assert_eq!(config["duplicateRefund"], DUPLICATE_REFUND);
        assert_eq!(config["pity"]["rare"], PITY_RARE);
        assert_eq!(config["pity"]["epic"], PITY_EPIC);
        assert_eq!(config["pity"]["legendary"], PITY_LEGENDARY);
    }

    #[test]
    fn base_odds_bands() {
        for (value, rarity) in [
            (0.0, Rarity::Common),
            (0.4, Rarity::Uncommon),
            (0.7, Rarity::Rare),
            (0.88, Rarity::Epic),
            (0.97, Rarity::Legendary),
        ] {
            assert_eq!(roll_rarity(ZERO, &mut constant(value)), rarity, "{value}");
        }
    }

    #[test]
    fn empty_catalog_errors() {
        let error = select_gacha_result(&HashSet::new(), ZERO, &[], &mut constant(0.0));
        assert_eq!(error.unwrap_err().to_string(), "Gacha pool common trống");
        let all: Vec<&CosmeticItem> = catalog().items.iter().collect();
        assert!(select_gacha_result(&HashSet::new(), ZERO, &all, &mut constant(0.0)).is_ok());
    }
}
