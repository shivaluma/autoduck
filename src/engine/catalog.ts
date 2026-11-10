/**
 * Browser seam for race-item and wild-item catalogs (plan D18/D19).
 *
 * On main this re-exports the TS engine's tables and helpers. On the `rewrite` branch it is re-implemented
 * over the catalog JSON exported from Rust, so browser code must import catalogs from here, never from
 * packages/race-core directly (CI job `client-boundary`).
 */
export {
  AUTO_LOADOUT_PRESETS,
  RACE_ITEM_CATALOG,
  getRaceItem,
  type RaceItemDefinition,
} from '@/packages/race-core/src/items/catalog'
export {
  ITEM_CLASS_BY_ID,
  loadoutComboBadge,
  loadoutComboLabel,
  type ItemClass,
  type LoadoutComboLabel,
} from '@/packages/race-core/src/items/classes'
export {
  WILD_ITEM_BY_ID,
  WILD_ITEM_CATALOG,
  getWildItem,
  type WildItemBehavior,
  type WildItemCategory,
  type WildItemDefinition,
} from '@/packages/race-core/src/pickups/catalog'
export { itemActivationForEvent, itemSuccessForEvent } from '@/packages/race-core/src/items/telemetry'
