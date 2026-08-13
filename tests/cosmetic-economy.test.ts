import assert from 'node:assert/strict'
import test from 'node:test'
import { COSMETIC_CATALOG, DEFAULT_APPEARANCE, STARTER_COSMETIC_IDS } from '../lib/cosmetics/catalog'
import { applyQuackTransaction, calculateOfficialRaceQuackRewards } from '../lib/cosmetics/economy'
import { normalizeAppearance, saveAppearance } from '../lib/cosmetics/inventory'

test('official winner gets 5 QP and a correct two-loser prediction gets 2 QP', () => {
  const rewards = calculateOfficialRaceQuackRewards({
    winnerUserId: 1,
    finalLoserUserIds: [7, 8],
    predictions: [
      { predictorUserId: 1, targetUserId: 8 },
      { predictorUserId: 2, targetUserId: 4 },
      { predictorUserId: 3, targetUserId: 7 },
    ],
  })

  assert.deepEqual(rewards, [
    { playerId: 1, amount: 5, reason: 'RACE_WIN' },
    { playerId: 1, amount: 2, reason: 'PREDICTION_WIN' },
    { playerId: 1, amount: 1, reason: 'PERFECT_WEEK' },
    { playerId: 3, amount: 2, reason: 'PREDICTION_WIN' },
  ])
})

test('large Chaos losing groups reduce prediction payout to 1 QP', () => {
  const rewards = calculateOfficialRaceQuackRewards({
    winnerUserId: 1,
    finalLoserUserIds: [3, 4, 5, 6],
    predictions: [{ predictorUserId: 2, targetUserId: 5 }],
  })
  assert.equal(rewards.find((reward) => reward.reason === 'PREDICTION_WIN')?.amount, 1)
})

test('perfect week can be disabled without changing base rewards', () => {
  const rewards = calculateOfficialRaceQuackRewards({
    winnerUserId: 1,
    finalLoserUserIds: [3, 4],
    predictions: [{ predictorUserId: 1, targetUserId: 4 }],
    perfectWeekEnabled: false,
  })
  assert.equal(rewards.some((reward) => reward.reason === 'PERFECT_WEEK'), false)
  assert.equal(rewards.reduce((sum, reward) => sum + reward.amount, 0), 7)
})

test('starter catalog provides the promised distinct customization options', () => {
  const starter = COSMETIC_CATALOG.filter((item) => STARTER_COSMETIC_IDS.includes(item.id))
  const count = (slot: string) => starter.filter((item) => item.slot === slot).length
  assert.equal(count('bodyColor'), 8)
  assert.equal(count('head'), 3)
  assert.equal(count('outfit'), 3)
  assert.equal(count('face'), 2)
  assert.equal(count('trail'), 1)
})

test('appearance parser only accepts known slot keys and requires body color', () => {
  assert.deepEqual(normalizeAppearance({ ...DEFAULT_APPEARANCE, exploitId: 'legendary-free' }), DEFAULT_APPEARANCE)
  assert.throws(() => normalizeAppearance({ headId: 'head-cap-red' }), /Body Color/)
})

test('QP spend cannot make balance negative and creates no orphan ledger row', async () => {
  let balance = 2
  const ledger: unknown[] = []
  const tx = {
    currencyTransaction: { findUnique: async () => null, create: async ({ data }: { data: unknown }) => { ledger.push(data); return data } },
    seasonPlayer: { update: async ({ where, data }: { where: { quackPoints?: { gte: number } }; data: { quackPoints: { increment: number } } }) => {
      if (where.quackPoints && balance < where.quackPoints.gte) throw new Error('not found')
      balance += data.quackPoints.increment
      return { quackPoints: balance }
    } },
  }
  await assert.rejects(() => applyQuackTransaction(tx as never, { seasonPlayerId: 1, amount: -3, reason: 'GACHA_PULL', idempotencyKey: 'test' }))
  assert.equal(balance, 2)
  assert.equal(ledger.length, 0)
})

test('server rejects equipping an unowned cosmetic', async () => {
  const tx = { playerCosmetic: { findMany: async () => [] }, playerAppearance: { upsert: async () => ({}) } }
  await assert.rejects(() => saveAppearance(tx as never, 1, DEFAULT_APPEARANCE), /chưa sở hữu/)
})
