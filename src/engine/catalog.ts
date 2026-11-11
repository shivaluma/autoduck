/**
 * Browser seam for race-item and wild-item catalogs (plan D18/D19).
 *
 * The Rust `race-core` catalog is the single source: `pnpm codegen:engine` (`race-cli codegen`) exports
 * it to ./generated/catalog.json, and the helpers below are re-implemented over those tables. Browser
 * code imports catalogs from here, never from packages/race-core (CI job `client-boundary`). Nothing in
 * this module pulls in an engine, so the home and rules pages stay light.
 */
import catalog from './generated/catalog.json'
import type { RaceEvent, RaceItemId, WildItemId } from './protocol'

export type ItemClass = 'SPEED' | 'DEFENSE' | 'ATTACK'

export type LoadoutComboLabel =
  | 'SPEED COMBO'
  | 'DEFENSE COMBO'
  | 'ATTACK COMBO'
  | 'HYBRID'
  | 'SPEED DEMON'
  | 'FORTRESS'
  | 'MENACE'
  | 'MAD DUCK'

export interface RaceItemDefinition {
  id: RaceItemId
  name: string
  icon: string
  cost: 1 | 2
  category: 'major' | 'minor'
  itemClass: ItemClass
  description: string
}

export type WildItemCategory = 'ATTACK' | 'DEFENSE' | 'MOBILITY' | 'UTILITY'
export type WildItemBehavior = 'INSTANT' | 'HELD'

export interface WildItemDefinition {
  id: WildItemId
  displayName: string
  icon: string
  category: WildItemCategory
  behavior: WildItemBehavior
  description: string
}

/** One row of `eventItemActivation` / `eventItemSuccess` (see `race-cli codegen`). */
interface EventItemRule {
  itemId: RaceItemId
  /** The id that must be present (JS-truthy) for the event to credit anything. */
  requires: 'source' | 'target'
  /** Who is credited: `targetOrSource` is `target ?? source`, `sourceOrTarget` is `source ?? target`. */
  player: 'source' | 'target' | 'targetOrSource' | 'sourceOrTarget'
}

interface ComboEntry {
  label: LoadoutComboLabel
  badge: string
}

interface GeneratedCatalog {
  items: RaceItemDefinition[]
  wildItems: WildItemDefinition[]
  classes: Record<RaceItemId, ItemClass>
  comboRules: { sameClass: Record<ItemClass, ComboEntry>; mixed: ComboEntry }
  autoLoadoutPresets: RaceItemId[][]
  eventItemActivation: Partial<Record<string, EventItemRule>>
  eventItemSuccess: Partial<Record<string, EventItemRule>>
}

const generated = catalog as GeneratedCatalog

export const RACE_ITEM_CATALOG: readonly RaceItemDefinition[] = generated.items
export const AUTO_LOADOUT_PRESETS: readonly RaceItemId[][] = generated.autoLoadoutPresets
export const ITEM_CLASS_BY_ID: Readonly<Record<RaceItemId, ItemClass>> = generated.classes

const RACE_ITEM_BY_ID = new Map(RACE_ITEM_CATALOG.map((item) => [item.id, item]))

export function getRaceItem(itemId: RaceItemId): RaceItemDefinition {
  return RACE_ITEM_BY_ID.get(itemId)!
}

export const WILD_ITEM_CATALOG: readonly WildItemDefinition[] = generated.wildItems
export const WILD_ITEM_BY_ID = new Map(WILD_ITEM_CATALOG.map((item) => [item.id, item]))

export function getWildItem(itemId: WildItemId): WildItemDefinition {
  const item = WILD_ITEM_BY_ID.get(itemId)
  if (!item) throw new Error(`Unknown Wild Item: ${itemId}`)
  return item
}

function loadoutCombo(itemIds: readonly RaceItemId[]): ComboEntry | null {
  if (itemIds.length !== 2) return null
  const [first, second] = itemIds.map((id) => ITEM_CLASS_BY_ID[id])
  return first === second ? generated.comboRules.sameClass[first!] : generated.comboRules.mixed
}

export function loadoutComboLabel(itemIds: readonly RaceItemId[]): LoadoutComboLabel | null {
  return loadoutCombo(itemIds)?.label ?? null
}

export function loadoutComboBadge(itemIds: readonly RaceItemId[]): string | null {
  return loadoutCombo(itemIds)?.badge ?? null
}

type ItemCredit = { playerId: string; itemId: RaceItemId }
type CreditEvent = Pick<RaceEvent, 'type' | 'sourcePlayerId' | 'targetPlayerId'>

function creditFor(rule: EventItemRule | undefined, event: CreditEvent): ItemCredit | null {
  if (!rule) return null
  const required = rule.requires === 'source' ? event.sourcePlayerId : event.targetPlayerId
  if (!required) return null
  const playerId = rule.player === 'source' ? event.sourcePlayerId
    : rule.player === 'target' ? event.targetPlayerId
      : rule.player === 'targetOrSource' ? event.targetPlayerId ?? event.sourcePlayerId
        : event.sourcePlayerId ?? event.targetPlayerId
  return playerId == null ? null : { playerId, itemId: rule.itemId }
}

/** Which prep item an event shows being used, and by whom. */
export function itemActivationForEvent(event: CreditEvent): ItemCredit | null {
  return creditFor(generated.eventItemActivation[event.type], event)
}

/** Which prep item an event credits as a success, and to whom. */
export function itemSuccessForEvent(event: CreditEvent): ItemCredit | null {
  return creditFor(generated.eventItemSuccess[event.type], event)
}
