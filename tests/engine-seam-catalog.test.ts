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

/**
 * S3.16 F13 (docs/balance/S3.16.md): the Rust catalog's loadout Feather copy no longer promises a hazard
 * dodge. The frozen TS engine keeps the S3.15 text, so that one description is expected to differ.
 */
const S3_16_DESCRIPTIONS: Partial<Record<string, string>> = {
  FEATHER:
    'Lông vũ hộ thân (Nội tại): nhảy né 1 lần Vỏ Chuối hoặc Còi Quack Horn (không chặn Tên Lửa hay chướng ngại vật), né xong nhận Guard Surge +15% trong 1.8s. Chưa dùng tới 88% quãng đường sẽ hóa luồng lướt +4% trong 1s.',
}
const EXPECTED_ITEMS = RACE_ITEM_CATALOG.map((item) => ({ ...item, description: S3_16_DESCRIPTIONS[item.id] ?? item.description }))

test('item and wild-item catalogs match the TS engine (plus the S3.16 copy fixes)', () => {
  assert.deepEqual(seam.RACE_ITEM_CATALOG, EXPECTED_ITEMS)
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
  for (const item of EXPECTED_ITEMS) assert.deepEqual(seam.getRaceItem(item.id), item)
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

test('the browser engine draws the current track from the geometry file HEAD exports', async () => {
  const { CURRENT_TRACK_GEOMETRY_ID } = await import('../src/engine/track-geometry')
  const { resolveHeadTrackGeometryId } = await import('../lib/racing/track-geometry')
  const protocol = await import('../packages/race-protocol/src')
  assert.equal(CURRENT_TRACK_GEOMETRY_ID, resolveHeadTrackGeometryId(protocol.DEFAULT_TRACK_VERSION))
})
