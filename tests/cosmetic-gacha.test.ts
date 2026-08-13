import assert from 'node:assert/strict'
import test from 'node:test'
import { COSMETIC_CATALOG } from '../lib/cosmetics/catalog'
import { GACHA_CONFIG, rollRarity, selectGachaResult } from '../lib/cosmetics/gacha'
import { generateRotationPool, getShopWeek, personalizeRotation } from '../lib/cosmetics/shop'

test('gacha base odds map every roll band exactly', () => {
  assert.equal(rollRarity({ rarePity: 0, epicPity: 0, legendaryPity: 0 }, () => 0), 'common')
  assert.equal(rollRarity({ rarePity: 0, epicPity: 0, legendaryPity: 0 }, () => 0.4), 'uncommon')
  assert.equal(rollRarity({ rarePity: 0, epicPity: 0, legendaryPity: 0 }, () => 0.7), 'rare')
  assert.equal(rollRarity({ rarePity: 0, epicPity: 0, legendaryPity: 0 }, () => 0.88), 'epic')
  assert.equal(rollRarity({ rarePity: 0, epicPity: 0, legendaryPity: 0 }, () => 0.97), 'legendary')
})

test('pity guarantees Rare+, Epic+, and Legendary at configured counters', () => {
  assert.equal(rollRarity({ rarePity: GACHA_CONFIG.pity.rare, epicPity: 0, legendaryPity: 0 }, () => 0.99), 'rare')
  assert.equal(rollRarity({ rarePity: 0, epicPity: GACHA_CONFIG.pity.epic, legendaryPity: 0 }, () => 0.99), 'epic')
  assert.equal(rollRarity({ rarePity: 0, epicPity: 0, legendaryPity: GACHA_CONFIG.pity.legendary }, () => 0), 'legendary')
})

test('duplicate protection rerolls within rarity when an unowned item exists', () => {
  const common = COSMETIC_CATALOG.filter((item) => item.rarity === 'common' && item.gachaEligible)
  const result = selectGachaResult({ ownedIds: new Set([common[0]!.id]), rarePity: 0, epicPity: 0, legendaryPity: 0 }, () => 0)
  assert.equal(result.wasDuplicate, true)
  assert.equal(result.wasRerolled, true)
  assert.notEqual(result.finalItem.id, common[0]!.id)
  assert.equal(result.refundAmount, 0)
})

test('exhausted rarity redistributes upward and never returns an owned lower-tier item', () => {
  const commonIds = COSMETIC_CATALOG.filter((item) => item.rarity === 'common').map((item) => item.id)
  const result = selectGachaResult({ ownedIds: new Set(commonIds), rarePity: 0, epicPity: 0, legendaryPity: 0 }, () => 0)
  assert.notEqual(result.rolledRarity, 'common')
  assert.equal(commonIds.includes(result.finalItem.id), false)
})

test('a fully completed catalog returns the promised duplicate refund', () => {
  const result = selectGachaResult({ ownedIds: new Set(COSMETIC_CATALOG.map((item) => item.id)), rarePity: 0, epicPity: 0, legendaryPity: 0 }, () => 0)
  assert.equal(result.refundAmount, 2)
  assert.equal(result.wasDuplicate, true)
})

test('Epic and Legendary results reset every corresponding lower pity counter', () => {
  const epic = selectGachaResult({ ownedIds: new Set(), rarePity: 4, epicPity: 12, legendaryPity: 9 }, () => 0.9)
  assert.equal(epic.rolledRarity, 'epic')
  assert.deepEqual(epic.pityAfter, { rarePity: 0, epicPity: 0, legendaryPity: 10 })
  const legendary = selectGachaResult({ ownedIds: new Set(), rarePity: 4, epicPity: 11, legendaryPity: 30 }, () => 0)
  assert.deepEqual(legendary.pityAfter, { rarePity: 0, epicPity: 0, legendaryPity: 0 })
})

test('weekly shop rotation is persisted from a deterministic pool and filters owned items', () => {
  const week = getShopWeek(new Date('2026-08-13T03:00:00Z'))
  assert.equal(week.weekKey, '2026-08-10')
  const pool = generateRotationPool('S3', week.weekKey)
  assert.equal(new Set(pool).size, pool.length)
  const first = personalizeRotation(pool, new Set(), 'S3', week.weekKey)
  const owned = new Set(first.map((item) => item.id))
  assert.equal(personalizeRotation(pool, owned, 'S3', week.weekKey).some((item) => owned.has(item.id)), false)
})
