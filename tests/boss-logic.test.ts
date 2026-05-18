import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BOSS_MAX_EXTRA_ENTRIES,
  BOSS_STREAK_THRESHOLD,
  expandBossParticipants,
  getBossExtraEntries,
  getBossTotalEntries,
} from '../lib/boss-logic'

test('boss mode caps at three total entries', () => {
  assert.equal(BOSS_MAX_EXTRA_ENTRIES, 2)
  assert.equal(getBossExtraEntries(BOSS_STREAK_THRESHOLD - 1), 0)
  assert.equal(getBossExtraEntries(BOSS_STREAK_THRESHOLD), 2)
  assert.equal(getBossExtraEntries(12), 2)
  assert.equal(getBossTotalEntries(12), 3)
})

test('expandBossParticipants creates at most two boss clones', () => {
  const participants = [{
    userId: 1,
    useShield: true,
    name: 'Zịt Boss',
  }]
  const users = [{
    id: 1,
    name: 'Zịt Boss',
    shields: 0,
    isBoss: true,
    cleanStreak: 12,
  }]

  const expanded = expandBossParticipants(participants, users)
  const clones = expanded.filter((participant) => participant.isClone)

  assert.equal(expanded.length, 3)
  assert.equal(clones.length, 2)
  assert.deepEqual(clones.map((clone) => clone.cloneIndex), [1, 2])
  assert.ok(clones.every((clone) => clone.useShield === false))
})
