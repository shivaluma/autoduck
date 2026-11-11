/**
 * The browser seam src/engine/catalog.ts (plan D19) re-implements the catalog helpers over the tables that
 * `race-cli codegen` exports from the Rust catalog. Until the TS engine is deleted, both must agree with
 * packages/race-core on every item, loadout pair and event the browser shows.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import * as seam from '../src/engine/catalog'
import { AUTO_LOADOUT_PRESETS, RACE_ITEM_CATALOG } from '../packages/race-core/src/items/catalog'
import { ITEM_CLASS_BY_ID, loadoutComboBadge, loadoutComboLabel } from '../packages/race-core/src/items/classes'
import { itemActivationForEvent, itemSuccessForEvent } from '../packages/race-core/src/items/telemetry'
import { WILD_ITEM_CATALOG } from '../packages/race-core/src/pickups/catalog'
import type { RaceEvent } from '../packages/race-protocol/src'

const variants = JSON.parse(
  readFileSync(new URL('../crates/race-protocol/tests/fixtures/ts-oracle/event-variants.json', import.meta.url), 'utf8'),
) as RaceEvent[]

test('item and wild-item catalogs match the TS engine', () => {
  assert.deepEqual(seam.RACE_ITEM_CATALOG, RACE_ITEM_CATALOG)
  assert.deepEqual(seam.WILD_ITEM_CATALOG.map((item) => ({ ...item })), WILD_ITEM_CATALOG.map((item) => ({
    id: item.id,
    displayName: item.displayName,
    icon: item.icon,
    category: item.category,
    behavior: item.behavior,
    description: item.description,
  })))
  assert.deepEqual(seam.AUTO_LOADOUT_PRESETS, AUTO_LOADOUT_PRESETS)
  assert.deepEqual(seam.ITEM_CLASS_BY_ID, ITEM_CLASS_BY_ID)
  for (const item of RACE_ITEM_CATALOG) assert.deepEqual(seam.getRaceItem(item.id), item)
  for (const item of WILD_ITEM_CATALOG) assert.equal(seam.getWildItem(item.id).id, item.id)
})

test('loadout combo label and badge match for every pair (and non-pairs)', () => {
  const ids = RACE_ITEM_CATALOG.map((item) => item.id)
  const loadouts = [[], [ids[0]!], ids.slice(0, 3), ...ids.flatMap((a) => ids.map((b) => [a, b]))]
  for (const loadout of loadouts) {
    assert.equal(seam.loadoutComboLabel(loadout), loadoutComboLabel(loadout), loadout.join('+'))
    assert.equal(seam.loadoutComboBadge(loadout), loadoutComboBadge(loadout), loadout.join('+'))
  }
})

test('event → item activation and success credits match for every event type and player combination', () => {
  assert.ok(variants.length > 50)
  const players: Array<string | undefined> = [undefined, '', 'p-source', 'p-target']
  for (const variant of variants) {
    for (const sourcePlayerId of players) {
      for (const targetPlayerId of players) {
        const event = { ...variant, sourcePlayerId, targetPlayerId } as RaceEvent
        const label = `${event.type} source=${sourcePlayerId} target=${targetPlayerId}`
        assert.deepEqual(seam.itemActivationForEvent(event), itemActivationForEvent(event), label)
        assert.deepEqual(seam.itemSuccessForEvent(event), itemSuccessForEvent(event), label)
      }
    }
  }
})

test('SIM_VERSIONS (src/engine/sim-versions.ts) matches the TS engine the browser runs', async () => {
  const { SIM_VERSIONS } = await import('../src/engine/sim-versions')
  const protocol = await import('../packages/race-protocol/src')
  assert.deepEqual(SIM_VERSIONS, {
    protocolVersion: protocol.RACE_PROTOCOL_VERSION,
    engineVersion: protocol.RACE_ENGINE_VERSION,
    balanceVersion: protocol.RACE_BALANCE_VERSION,
    trackVersion: protocol.DEFAULT_TRACK_VERSION,
    pickupSpawnVersion: protocol.PICKUP_SPAWN_VERSION,
    wildItemBalanceVersion: protocol.WILD_ITEM_BALANCE_VERSION,
    hazardBalanceVersion: protocol.HAZARD_BALANCE_VERSION,
    tickRate: protocol.RACE_TICK_RATE,
  })
})
