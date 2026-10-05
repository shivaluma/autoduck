import assert from 'node:assert/strict'
import test from 'node:test'
import { COSMETIC_BY_ID, COSMETIC_CATALOG } from '../lib/cosmetics/catalog'
import { LEGACY_REMAP, planLegacyInventory, remapAppearance } from '../lib/cosmetics/legacy'
import { LEGACY_V1_COSMETICS } from '../lib/cosmetics/legacy-v1'
import { SHOP_PRICES } from '../lib/cosmetics/shop'
import { COSMETIC_RARITIES } from '../lib/cosmetics/types'

const CLOSET_SLOTS = ['bodyColor', 'bodySkin', 'face', 'head', 'outfit', 'pet', 'aura', 'trail'] as const

test('v2 catalog covers every rarity in every closet tab and nothing outside the closet', () => {
  for (const slot of CLOSET_SLOTS) {
    for (const rarity of COSMETIC_RARITIES) {
      assert.ok(COSMETIC_CATALOG.some((item) => item.slot === slot && item.rarity === rarity), `${slot} needs a ${rarity} item`)
    }
  }
  assert.ok(COSMETIC_CATALOG.every((item) => (CLOSET_SLOTS as readonly string[]).includes(item.slot)))
})

test('every legacy remap goes from a retired v1 id to a v2 item in the same slot', () => {
  for (const [from, to] of Object.entries(LEGACY_REMAP)) {
    assert.ok(LEGACY_V1_COSMETICS[from], `${from} must be a v1 id`)
    assert.ok(!COSMETIC_BY_ID.has(from), `${from} is still in v2, so it should not be remapped`)
    const target = COSMETIC_BY_ID.get(to)
    assert.ok(target, `${to} must exist in v2`)
    const fromSlot = LEGACY_V1_COSMETICS[from]![0]
    assert.equal(target.slot, fromSlot === 'bodySkin' || from.startsWith('skin-') ? 'bodySkin' : fromSlot)
  }
})

test('legacy inventory plan keeps v2 items, swaps equivalents, and refunds the rest at v1 price', () => {
  const plan = planLegacyInventory(['body-sunshine', 'body-snoo-cosmic-abyss', 'head-pirate-hat', 'neck-red-scarf', 'pet-corgi-pup', 'pet-shiba-inu'])
  assert.deepEqual(plan.remove.sort(), ['body-snoo-cosmic-abyss', 'head-pirate-hat', 'neck-red-scarf', 'pet-corgi-pup'].sort())
  assert.deepEqual(plan.grant, [{ cosmeticId: 'body-ink', replaces: 'body-snoo-cosmic-abyss' }])
  // Corgi maps to Shiba, which is already owned → refunded instead of a silent loss.
  assert.deepEqual(plan.refund.map((entry) => entry.cosmeticId).sort(), ['head-pirate-hat', 'neck-red-scarf', 'pet-corgi-pup'].sort())
  for (const refund of plan.refund) assert.equal(refund.amount, SHOP_PRICES[LEGACY_V1_COSMETICS[refund.cosmeticId]![1]])
})

test('remapped appearance only equips owned v2 items and always keeps a body color', () => {
  const owned = new Set(['body-ink', 'outfit-boss-blazer'])
  const next = remapAppearance({ bodyColorId: 'body-snoo-cosmic-abyss', headId: 'head-pirate-hat', outfitId: 'outfit-golden-tux', neckId: 'neck-red-scarf' }, owned)
  assert.deepEqual(next, { bodyColorId: 'body-ink', outfitId: 'outfit-boss-blazer' })
  assert.deepEqual(remapAppearance({ headId: 'head-cap-red' }, new Set()), { bodyColorId: 'body-sunshine' })
})
