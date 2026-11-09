//! Weekly shop: a port of `lib/cosmetics/shop.ts`, bit-exact (fixtures from
//! `scripts/oracle/dump-cosmetic-fixtures.ts`, tested in `tests/gacha.rs`).

use std::collections::HashSet;

use sha2::{Digest, Sha256};

use super::{CosmeticItem, Rarity, catalog};
use crate::db::DbTime;

const HOUR_MS: i64 = 60 * 60 * 1000;
const DAY_MS: i64 = 24 * HOUR_MS;

/// `SHOP_PRICES`.
pub fn shop_price(rarity: Rarity) -> i64 {
    match rarity {
        Rarity::Common => 2,
        Rarity::Uncommon => 4,
        Rarity::Rare => 7,
        Rarity::Epic => 12,
        Rarity::Legendary => 20,
    }
}

/// `SHOP_PRICES` as the routes send it.
pub fn shop_prices_json() -> serde_json::Value {
    let mut map = serde_json::Map::new();
    for rarity in Rarity::ALL {
        map.insert(rarity.as_str().to_owned(), shop_price(rarity).into());
    }
    serde_json::Value::Object(map)
}

/// `ROTATION_COUNTS`, in `Object.entries` order.
const ROTATION_COUNTS: [(Rarity, usize); 5] = [
    (Rarity::Common, 6),
    (Rarity::Uncommon, 6),
    (Rarity::Rare, 6),
    (Rarity::Epic, 3),
    (Rarity::Legendary, 2),
];

/// `personalizeRotation`'s per-rarity counts (legendary is handled separately).
const PERSONAL_COUNTS: [(Rarity, usize); 4] = [
    (Rarity::Common, 2),
    (Rarity::Uncommon, 2),
    (Rarity::Rare, 2),
    (Rarity::Epic, 1),
];

/// `seededScore(seed, id)`: the first 4 bytes of `sha256("<seed>:<id>")`, big-endian.
pub fn seeded_score(seed: &str, id: &str) -> u32 {
    let mut hasher = Sha256::new();
    hasher.update(seed.as_bytes());
    hasher.update(b":");
    hasher.update(id.as_bytes());
    let digest = hasher.finalize();
    u32::from_be_bytes([digest[0], digest[1], digest[2], digest[3]])
}

/// `getShopWeek(now)`: the Vietnam-time (UTC+7) Monday-to-Monday week containing `now`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ShopWeek {
    /// The local Monday as `YYYY-MM-DD`.
    pub week_key: String,
    pub starts_at: DbTime,
    pub ends_at: DbTime,
}

pub fn shop_week(now: DbTime) -> ShopWeek {
    let vietnam = now.unix_ms() + 7 * HOUR_MS;
    let days = vietnam.div_euclid(DAY_MS);
    // 1970-01-01 was a Thursday (getUTCDay() = 4).
    let weekday = match (days + 4).rem_euclid(7) {
        0 => 7,
        day => day,
    };
    let local_monday = (days - weekday + 1) * DAY_MS;
    let monday = local_monday - 7 * HOUR_MS;
    let ends_at = monday + 7 * DAY_MS;
    let key_time = DbTime::from_unix_ms(local_monday).unwrap_or(now);
    ShopWeek {
        week_key: key_time.to_iso_string()[..10].to_owned(),
        starts_at: DbTime::from_unix_ms(monday).unwrap_or(now),
        ends_at: DbTime::from_unix_ms(ends_at).unwrap_or(now),
    }
}

/// `generateRotationPool(seasonKey, weekKey)`: the season-wide pool stored in
/// `ShopRotation.itemsJson`. The JS sort is stable, so ties keep catalog order; so does
/// `sort_by_key`.
pub fn generate_rotation_pool(season_key: &str, week_key: &str) -> Vec<String> {
    let seed = format!("{season_key}:{week_key}");
    let mut pool = Vec::new();
    for (rarity, count) in ROTATION_COUNTS {
        let mut items: Vec<(u32, &CosmeticItem)> = catalog()
            .items
            .iter()
            .filter(|item| item.shop_eligible && item.rarity == rarity)
            .map(|item| (seeded_score(&seed, &item.id), item))
            .collect();
        items.sort_by_key(|(score, _)| *score);
        pool.extend(
            items
                .into_iter()
                .take(count)
                .map(|(_, item)| item.id.clone()),
        );
    }
    pool
}

/// `personalizeRotation(poolIds, ownedIds, seasonKey, weekKey)`: what one player is offered.
/// Pool ids that aren't in the catalog are skipped (`COSMETIC_BY_ID.get(id) ?? []`).
pub fn personalize_rotation(
    pool_ids: &[String],
    owned: &HashSet<String>,
    season_key: &str,
    week_key: &str,
) -> Vec<&'static CosmeticItem> {
    let catalog = catalog();
    let known = || pool_ids.iter().filter_map(|id| catalog.get(id));
    let mut result: Vec<&'static CosmeticItem> = Vec::new();
    for (rarity, count) in PERSONAL_COUNTS {
        result.extend(
            known()
                .filter(|item| item.rarity == rarity && !owned.contains(&item.id))
                .take(count),
        );
    }
    if legendary_enabled(season_key, week_key)
        && let Some(legendary) =
            known().find(|item| item.rarity == Rarity::Legendary && !owned.contains(&item.id))
    {
        result.push(legendary);
    }
    result
}

/// `seededScore(seasonKey, weekKey) / 0xffffffff < 0.3`.
pub fn legendary_enabled(season_key: &str, week_key: &str) -> bool {
    f64::from(seeded_score(season_key, week_key)) / f64::from(u32::MAX) < 0.3
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(iso: &str) -> DbTime {
        DbTime::parse(iso).unwrap()
    }

    #[test]
    fn seeded_score_is_sha256_prefix() {
        // sha256("S3:2026-08-10:body-sunshine")[0..4] — checked against node:crypto in the fixtures.
        let score = seeded_score("S3:2026-08-10", "body-sunshine");
        let digest = Sha256::digest(b"S3:2026-08-10:body-sunshine");
        assert_eq!(score, u32::from_be_bytes(digest[..4].try_into().unwrap()));
    }

    #[test]
    fn shop_week_boundaries() {
        let week = shop_week(at("2026-08-13T03:00:00Z"));
        assert_eq!(week.week_key, "2026-08-10");
        assert_eq!(week.starts_at.to_iso_string(), "2026-08-09T17:00:00.000Z");
        assert_eq!(week.ends_at.to_iso_string(), "2026-08-16T17:00:00.000Z");
        // Sunday 23:59 local is still the same week; Monday 00:00 local starts the next one.
        assert_eq!(
            shop_week(at("2026-08-16T16:59:59.999Z")).week_key,
            "2026-08-10"
        );
        assert_eq!(
            shop_week(at("2026-08-16T17:00:00.000Z")).week_key,
            "2026-08-17"
        );
    }

    #[test]
    fn rotation_pool_has_the_configured_counts() {
        let pool = generate_rotation_pool("S3", "2026-08-10");
        assert_eq!(pool.len(), 6 + 6 + 6 + 3 + 2);
        let unique: HashSet<&String> = pool.iter().collect();
        assert_eq!(unique.len(), pool.len());
    }
}
