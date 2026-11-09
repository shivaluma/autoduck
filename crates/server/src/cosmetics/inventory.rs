//! Inventory and appearance: a port of `lib/cosmetics/inventory.ts` and of the pure planners in
//! `lib/cosmetics/legacy.ts` (`planLegacyInventory`, `remapAppearance`).
//!
//! An appearance is a list of `(<slot>Id, cosmeticId)` pairs in `COSMETIC_SLOTS` order, which
//! is the key order TS objects built by these functions have.

use std::collections::HashSet;

use serde_json::{Map, Value};
use sqlx::AssertSqlSafe;
use sqlx::SqliteConnection;

use super::ids::cuid;
use super::rows::{APPEARANCE_COLUMNS, PlayerAppearanceRow, placeholders};
use super::shop::shop_price;
use super::{catalog, legacy};
use crate::db::DbTime;

pub type Appearance = Vec<(String, String)>;

/// `Object.fromEntries(appearance)` as JSON (for tests and API echoes).
pub fn appearance_json(appearance: &Appearance) -> Value {
    Value::Object(
        appearance
            .iter()
            .map(|(key, id)| (key.clone(), Value::String(id.clone())))
            .collect::<Map<_, _>>(),
    )
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum AppearanceError {
    #[error("Duck cần một Body Color")]
    MissingBodyColor,
    #[error("Cosmetic không tồn tại: {0}")]
    UnknownCosmetic(String),
    #[error("{name} không thuộc slot {key}")]
    WrongSlot { name: String, key: String },
    #[error("Bạn chưa sở hữu cosmetic: {0}")]
    NotOwned(String),
}

#[derive(Debug, thiserror::Error)]
pub enum SaveAppearanceError {
    #[error(transparent)]
    Invalid(#[from] AppearanceError),
    #[error(transparent)]
    Db(#[from] sqlx::Error),
}

/// `normalizeAppearance(input)`: keeps non-empty string values of known `<slot>Id` keys.
pub fn normalize_appearance(input: &Map<String, Value>) -> Result<Appearance, AppearanceError> {
    let mut result = Appearance::new();
    for slot in &catalog().slots {
        let key = format!("{slot}Id");
        if let Some(Value::String(value)) = input.get(&key)
            && !value.is_empty()
        {
            result.push((key, value.clone()));
        }
    }
    if !result.iter().any(|(key, _)| key == "bodyColorId") {
        return Err(AppearanceError::MissingBodyColor);
    }
    Ok(result)
}

/// The catalog checks of `saveAppearance` (before the ownership query).
pub fn validate_appearance(appearance: &Appearance) -> Result<(), AppearanceError> {
    for (key, cosmetic_id) in appearance {
        let item = catalog()
            .get(cosmetic_id)
            .ok_or_else(|| AppearanceError::UnknownCosmetic(cosmetic_id.clone()))?;
        if format!("{}Id", item.slot) != *key {
            return Err(AppearanceError::WrongSlot {
                name: item.name.clone(),
                key: key.clone(),
            });
        }
    }
    Ok(())
}

/// `saveAppearance(tx, seasonPlayerId, rawAppearance)` on the caller's write transaction.
pub async fn save_appearance(
    conn: &mut SqliteConnection,
    season_player_id: i64,
    raw: &Map<String, Value>,
) -> Result<PlayerAppearanceRow, SaveAppearanceError> {
    let appearance = normalize_appearance(raw)?;
    validate_appearance(&appearance)?;
    let ids: Vec<&String> = appearance.iter().map(|(_, id)| id).collect();
    let sql = format!(
        r#"SELECT "cosmeticId" FROM "PlayerCosmetic" WHERE "seasonPlayerId" = ? AND "cosmeticId" IN ({})"#,
        placeholders(ids.len())
    );
    let mut query = sqlx::query_scalar::<_, String>(AssertSqlSafe(sql)).bind(season_player_id);
    for id in &ids {
        query = query.bind(*id);
    }
    let owned: HashSet<String> = query.fetch_all(&mut *conn).await?.into_iter().collect();
    if let Some(missing) = ids.iter().find(|id| !owned.contains(**id)) {
        return Err(AppearanceError::NotOwned((*missing).clone()).into());
    }

    let value = |slot: &str| -> Option<String> {
        let key = format!("{slot}Id");
        appearance
            .iter()
            .find(|(k, _)| *k == key)
            .map(|(_, id)| id.clone())
    };
    let now = DbTime::now();
    let row = sqlx::query_as::<_, PlayerAppearanceRow>(AssertSqlSafe(format!(
        r#"INSERT INTO "PlayerAppearance" ("id", "seasonPlayerId", "bodyColorId", "bodySkinId", "faceId",
               "headId", "neckId", "outfitId", "backId", "petId", "auraId", "trailId", "finishId",
               "nameplateId", "updatedAt")
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT ("seasonPlayerId") DO UPDATE SET
               "bodyColorId" = excluded."bodyColorId", "bodySkinId" = excluded."bodySkinId",
               "faceId" = excluded."faceId", "headId" = excluded."headId", "neckId" = excluded."neckId",
               "outfitId" = excluded."outfitId", "backId" = excluded."backId", "petId" = excluded."petId",
               "auraId" = excluded."auraId", "trailId" = excluded."trailId",
               "finishId" = excluded."finishId", "nameplateId" = excluded."nameplateId",
               "updatedAt" = excluded."updatedAt"
           RETURNING {APPEARANCE_COLUMNS}"#
    )))
    .bind(cuid())
    .bind(season_player_id)
    .bind(value("bodyColor"))
    .bind(value("bodySkin"))
    .bind(value("face"))
    .bind(value("head"))
    .bind(value("neck"))
    .bind(value("outfit"))
    .bind(value("back"))
    .bind(value("pet"))
    .bind(value("aura"))
    .bind(value("trail"))
    .bind(value("finish"))
    .bind(value("nameplate"))
    .bind(now)
    .fetch_one(&mut *conn)
    .await?;
    Ok(row)
}

/// `grantStarterCosmetics(tx, seasonPlayerId)`: idempotent.
pub async fn grant_starter_cosmetics(
    conn: &mut SqliteConnection,
    season_player_id: i64,
) -> Result<(), sqlx::Error> {
    for cosmetic_id in &catalog().starter_ids {
        sqlx::query(
            r#"INSERT INTO "PlayerCosmetic" ("id", "seasonPlayerId", "cosmeticId", "source", "isNew", "obtainedAt")
               VALUES (?, ?, ?, 'DEFAULT', 0, ?) ON CONFLICT ("seasonPlayerId", "cosmeticId") DO NOTHING"#,
        )
        .bind(cuid())
        .bind(season_player_id)
        .bind(cosmetic_id)
        .bind(DbTime::now())
        .execute(&mut *conn)
        .await?;
    }
    let default = |key: &str| -> Option<&str> {
        catalog()
            .default_appearance
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, id)| id.as_str())
    };
    sqlx::query(
        r#"INSERT INTO "PlayerAppearance" ("id", "seasonPlayerId", "bodyColorId", "faceId", "headId",
               "outfitId", "trailId", "updatedAt")
           VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT ("seasonPlayerId") DO NOTHING"#,
    )
    .bind(cuid())
    .bind(season_player_id)
    .bind(default("bodyColorId"))
    .bind(default("faceId"))
    .bind(default("headId"))
    .bind(default("outfitId"))
    .bind(default("trailId"))
    .bind(DbTime::now())
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// `LegacyInventoryPlan`.
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct LegacyInventoryPlan {
    pub remove: Vec<String>,
    pub grant: Vec<LegacyGrant>,
    pub refund: Vec<LegacyRefund>,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyGrant {
    pub cosmetic_id: String,
    pub replaces: String,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyRefund {
    pub cosmetic_id: String,
    pub amount: i64,
}

/// `planLegacyInventory(ownedIds)`.
pub fn plan_legacy_inventory(owned_ids: &[String]) -> LegacyInventoryPlan {
    let catalog = catalog();
    let legacy = legacy();
    let owned: HashSet<&String> = owned_ids.iter().collect();
    let mut granted: HashSet<&String> = HashSet::new();
    let mut plan = LegacyInventoryPlan::default();
    for id in owned_ids {
        if catalog.contains(id) {
            continue;
        }
        plan.remove.push(id.clone());
        if let Some(replacement) = legacy.remap.get(id)
            && catalog.contains(replacement)
            && !owned.contains(replacement)
            && !granted.contains(replacement)
        {
            plan.grant.push(LegacyGrant {
                cosmetic_id: replacement.clone(),
                replaces: id.clone(),
            });
            granted.insert(replacement);
            continue;
        }
        if let Some((_, rarity)) = legacy.v1.get(id) {
            plan.refund.push(LegacyRefund {
                cosmetic_id: id.clone(),
                amount: shop_price(*rarity),
            });
        }
    }
    plan
}

/// `remapAppearance(appearance, ownedAfter)`.
pub fn remap_appearance(
    appearance: &Map<String, Value>,
    owned_after: &HashSet<String>,
) -> Appearance {
    let catalog = catalog();
    let legacy = legacy();
    let mut next = Appearance::new();
    for slot in &catalog.slots {
        let key = format!("{slot}Id");
        let Some(Value::String(value)) = appearance.get(&key) else {
            continue;
        };
        if value.is_empty() {
            continue;
        }
        let id = if catalog.contains(value) {
            Some(value)
        } else {
            legacy.remap.get(value)
        };
        if let Some(item) = id.and_then(|id| catalog.get(id))
            && item.slot == *slot
            && owned_after.contains(&item.id)
        {
            next.push((key, item.id.clone()));
        }
    }
    if !next.iter().any(|(key, _)| key == "bodyColorId") {
        // `next.bodyColorId = 'body-sunshine'` appends the key last.
        next.push(("bodyColorId".to_owned(), "body-sunshine".to_owned()));
    }
    next
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn map(value: Value) -> Map<String, Value> {
        value.as_object().unwrap().clone()
    }

    #[test]
    fn normalize_keeps_known_slots_and_requires_body_color() {
        let input = map(json!({
            "trailId": "trail-ripples", "bodyColorId": "body-sunshine", "exploitId": "x", "headId": "",
            "faceId": 5
        }));
        assert_eq!(
            normalize_appearance(&input).unwrap(),
            vec![
                ("bodyColorId".to_owned(), "body-sunshine".to_owned()),
                ("trailId".to_owned(), "trail-ripples".to_owned()),
            ]
        );
        assert_eq!(
            normalize_appearance(&map(json!({"headId": "head-cap-red"}))).unwrap_err(),
            AppearanceError::MissingBodyColor
        );
    }

    #[test]
    fn validate_rejects_unknown_and_wrong_slot() {
        let unknown = vec![("bodyColorId".to_owned(), "nope".to_owned())];
        assert_eq!(
            validate_appearance(&unknown).unwrap_err().to_string(),
            "Cosmetic không tồn tại: nope"
        );
        let wrong = vec![("headId".to_owned(), "body-sunshine".to_owned())];
        assert_eq!(
            validate_appearance(&wrong).unwrap_err().to_string(),
            "Sunshine không thuộc slot headId"
        );
    }
}
