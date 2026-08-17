import assert from 'node:assert/strict'
import test, { describe } from 'node:test'
import { extractCombatEncounters } from '../lib/racing/combat-encounters'
import type { RaceEvent } from '../packages/race-protocol/src'

describe('extractCombatEncounters', () => {
  const players = [
    { playerId: '1', name: 'Duck Alpha', avatarUrl: null },
    { playerId: '2', name: 'Duck Beta', avatarUrl: null },
    { playerId: '3', name: 'Duck Gamma', avatarUrl: null },
  ]

  test('correctly records rocket hits, blocks by bubble, and feather dodges', () => {
    const events: RaceEvent[] = [
      // 1. Duck 1 fires rocket and hits Duck 2
      {
        raceId: '100',
        type: 'ROCKET_HIT',
        tick: 50,
        timestampWithinRaceMs: 2500,
        sourcePlayerId: '1',
        targetPlayerId: '2',
        metadata: {},
      },
      // 2. Duck 1 fires rocket at Duck 3, but Duck 3 has Bubble Shield
      {
        raceId: '100',
        type: 'ROCKET_BLOCKED',
        tick: 80,
        timestampWithinRaceMs: 4000,
        sourcePlayerId: '1',
        targetPlayerId: '3',
        metadata: { defense: 'BUBBLE_SHIELD' },
      },
      // 3. Duck 2 drops banana, Duck 1 steps on it but dodges with Feather
      {
        raceId: '100',
        type: 'BANANA_BLOCKED',
        tick: 110,
        timestampWithinRaceMs: 5500,
        sourcePlayerId: '2',
        targetPlayerId: '1',
        metadata: { defense: 'FEATHER' },
      },
      // 4. Duck 2 drops banana, Duck 3 steps on it and gets hit
      {
        raceId: '100',
        type: 'BANANA_HIT',
        tick: 140,
        timestampWithinRaceMs: 7000,
        sourcePlayerId: '2',
        targetPlayerId: '3',
        metadata: {},
      },
    ]

    const analytics = extractCombatEncounters(events, players)

    assert.equal(analytics.totalAttacks, 4)
    assert.equal(analytics.successfulHits, 2)
    assert.equal(analytics.defendedAttacks, 2)
    assert.equal(analytics.overallHitRate, 50)

    // Encounter 1: Rocket Hit
    assert.equal(analytics.encounters[0].attackerName, 'Duck Alpha')
    assert.equal(analytics.encounters[0].targetName, 'Duck Beta')
    assert.equal(analytics.encounters[0].weapon, 'HOMING_ROCKET')
    assert.equal(analytics.encounters[0].success, true)

    // Encounter 2: Rocket Blocked by Bubble Shield
    assert.equal(analytics.encounters[1].attackerName, 'Duck Alpha')
    assert.equal(analytics.encounters[1].targetName, 'Duck Gamma')
    assert.equal(analytics.encounters[1].success, false)
    assert.equal(analytics.encounters[1].defense, 'BUBBLE_SHIELD')
    assert.match(analytics.encounters[1].resultDetail, /Khiên Bong Bóng/)

    // Encounter 3: Banana Dodged by Feather
    assert.equal(analytics.encounters[2].attackerName, 'Duck Beta')
    assert.equal(analytics.encounters[2].targetName, 'Duck Alpha')
    assert.equal(analytics.encounters[2].success, false)
    assert.equal(analytics.encounters[2].defense, 'FEATHER')
    assert.match(analytics.encounters[2].resultDetail, /Lông Vũ/)

    // Encounter 4: Banana Hit
    assert.equal(analytics.encounters[3].attackerName, 'Duck Beta')
    assert.equal(analytics.encounters[3].targetName, 'Duck Gamma')
    assert.equal(analytics.encounters[3].success, true)

    // Summary checks
    const alphaSummary = analytics.playerSummaries.find((p) => p.playerId === '1')
    assert.equal(alphaSummary?.attacksDealt, 2)
    assert.equal(alphaSummary?.attacksHit, 1)
    assert.equal(alphaSummary?.attacksDefended, 1) // dodged Duck 2's banana
  })

  test('correctly identifies shock absorber mitigation on rocket hit', () => {
    const events: RaceEvent[] = [
      {
        raceId: '100',
        type: 'SHOCK_ABSORBER_PROC',
        tick: 60,
        timestampWithinRaceMs: 3000,
        sourcePlayerId: '2',
        targetPlayerId: '1',
        metadata: { mitigated: 'ROCKET' },
      },
      {
        raceId: '100',
        type: 'ROCKET_HIT',
        tick: 60,
        timestampWithinRaceMs: 3000,
        sourcePlayerId: '1',
        targetPlayerId: '2',
        metadata: {},
      },
    ]

    const analytics = extractCombatEncounters(events, players)
    assert.equal(analytics.encounters.length, 1)
    assert.equal(analytics.encounters[0].success, true)
    assert.equal(analytics.encounters[0].mitigatedByShockAbsorber, true)
    assert.match(analytics.encounters[0].resultDetail, /Áo Chống Sốc/)
  })
})
