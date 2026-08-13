import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ITEM_BALANCE,
  ITEM_INTERACTION_MATRIX,
  applyItemSlow,
  createItemRaceState,
  itemActiveEffects,
  itemSpeedMultiplier,
  resolveIncomingRaceEffect,
  simulateRace,
  tickItemSystem,
  type DuckItemRuntime,
  type ItemDuckState,
} from '../packages/race-core/src'
import { raceConfigSchema, type RaceEventType, type RaceItemId } from '../packages/race-protocol/src'

function defense(items: RaceItemId[]): DuckItemRuntime {
  return {
    itemIds: items,
    usedItems: new Set(),
    bubbleAvailable: items.includes('BUBBLE_SHIELD'),
    featherAvailable: items.includes('FEATHER'),
    itemImmunityUntilTick: 0,
    rocketProtectionUntilTick: 0,
    slowMultiplier: 1,
    slowUntilTick: 0,
    boostMultiplier: 1,
    boostUntilTick: 0,
  }
}

function config(loadouts: Array<{ playerId: string; itemIds: RaceItemId[] }>) {
  const playerIds = Array.from(new Set(['1', '2', ...loadouts.map((loadout) => loadout.playerId)]))
  return raceConfigSchema.parse({
    raceId: 'items',
    seed: '11'.repeat(32),
    players: playerIds.map((playerId) => ({ playerId, name: `Duck ${playerId}` })),
    loadouts: loadouts.map((loadout) => ({ ...loadout, source: 'PLAYER' })),
  })
}

function duck(playerId: string, progress: number, rank: number, lateralOffset = 0): ItemDuckState {
  return { playerId, progress, currentRank: rank, lateralOffset, lateralVelocity: 0, finished: false }
}

test('central interaction matrix keeps race and Season shields distinct', () => {
  assert.equal(ITEM_INTERACTION_MATRIX.ROCKET.bubbleShield, 'BLOCK')
  assert.equal(ITEM_INTERACTION_MATRIX.ROCKET.feather, 'NO')
  assert.equal(ITEM_INTERACTION_MATRIX.BANANA.bubbleShield, 'BLOCK')
  assert.equal(ITEM_INTERACTION_MATRIX.BANANA.feather, 'DODGE')
  assert.equal(ITEM_INTERACTION_MATRIX.DUCK_COLLISION.bubbleShield, 'NO')
})

test('Bubble Shield blocks one Rocket, is consumed, and a later Rocket hits', () => {
  const target = defense(['BUBBLE_SHIELD'])
  assert.equal(resolveIncomingRaceEffect(target, 'ROCKET', 10, 60), 'BLOCKED_BUBBLE')
  assert.equal(target.bubbleAvailable, false)
  assert.equal(resolveIncomingRaceEffect(target, 'ROCKET', 20, 60), 'IMMUNE')
  assert.equal(resolveIncomingRaceEffect(target, 'ROCKET', 41, 60), 'HIT')
})

test('Feather dodges Banana but never blocks Rocket', () => {
  const target = defense(['FEATHER'])
  assert.equal(resolveIncomingRaceEffect(target, 'BANANA', 1, 60), 'DODGED_FEATHER')
  assert.equal(target.featherAvailable, false)
  assert.equal(resolveIncomingRaceEffect(target, 'ROCKET', 2, 60), 'HIT')
})

test('post-hit immunity prevents chain hits and Rocket target protection lasts two seconds', () => {
  const target = defense([])
  assert.equal(resolveIncomingRaceEffect(target, 'ROCKET', 10, 60), 'HIT')
  assert.equal(target.itemImmunityUntilTick, 85)
  assert.equal(target.rocketProtectionUntilTick, 130)
  assert.equal(resolveIncomingRaceEffect(target, 'BANANA', 70, 60), 'IMMUNE')
  assert.equal(resolveIncomingRaceEffect(target, 'BANANA', 86, 60), 'HIT')
})

test('slow effects use the strongest active value without weaker duration extension', () => {
  const runtime = defense([])
  applyItemSlow(runtime, 0.8, 0.85, 10, 60)
  const firstExpiry = runtime.slowUntilTick
  applyItemSlow(runtime, 0.86, 0.75, 20, 60)
  assert.equal(runtime.slowMultiplier, 0.8)
  assert.equal(runtime.slowUntilTick, firstExpiry)
  runtime.boostMultiplier = 1.5
  runtime.boostUntilTick = 100
  assert.ok(itemSpeedMultiplier(runtime, 30) >= ITEM_BALANCE.minimumSpeedMultiplier)
  assert.ok(itemSpeedMultiplier(runtime, 30) <= ITEM_BALANCE.maximumSpeedMultiplier)
})

test('Nitro activates deterministically and ends after exactly 1.6 seconds', () => {
  const state = createItemRaceState(config([{ playerId: '2', itemIds: ['NITRO', 'BANANA'] }]))
  const ducks = [duck('1', 0.62, 1), duck('2', 0.55, 4)]
  const events: RaceEventType[] = []
  tickItemSystem(state, ducks, 10, 60, (type) => events.push(type))
  const runtime = state.byPlayer.get('2')!
  assert.equal(runtime.boostUntilTick, 106)
  assert.equal(itemSpeedMultiplier(runtime, 105), 1.18)
  tickItemSystem(state, ducks, 106, 60, (type) => events.push(type))
  assert.equal(itemSpeedMultiplier(runtime, 106), 1)
  assert.deepEqual(events.filter((type) => type.startsWith('NITRO')), ['NITRO_STARTED', 'NITRO_ENDED'])
})

test('Rocket targets nearest eligible duck ahead and expires when it cannot hit', () => {
  const state = createItemRaceState(config([{ playerId: '2', itemIds: ['HOMING_ROCKET', 'FEATHER'] }]))
  const ducks = [duck('1', 0.44, 1), duck('2', 0.4, 2)]
  const events: Array<{ type: RaceEventType; target?: string }> = []
  tickItemSystem(state, ducks, 1, 60, (type, _source, target) => events.push({ type, target }))
  assert.deepEqual(events[0], { type: 'ROCKET_FIRED', target: '1' })
  ducks[0].finished = true
  tickItemSystem(state, ducks, 2, 60, (type, _source, target) => events.push({ type, target }))
  assert.ok(events.some((entry) => entry.type === 'ROCKET_EXPIRED'))
})

test('Banana expires, Horn pushes only laterally, and neither hard-stuns', () => {
  const state = createItemRaceState(config([
    { playerId: '1', itemIds: ['NITRO', 'BANANA'] },
    { playerId: '2', itemIds: ['BUBBLE_SHIELD', 'QUACK_HORN'] },
  ]))
  const ducks = [duck('1', 0.7, 1, 0), duck('2', 0.695, 2, 0.2)]
  const events: RaceEventType[] = []
  tickItemSystem(state, ducks, 1, 60, (type) => events.push(type))
  assert.ok(events.includes('BANANA_DROPPED'))
  assert.ok(events.includes('HORN_USED'))
  assert.notEqual(ducks[0].lateralVelocity, 0)
  const banana = state.bananas[0]
  if (banana) {
    ducks[0].progress = 0.9
    ducks[1].progress = 0.91
    tickItemSystem(state, ducks, banana.expiresAtTick, 60, (type) => events.push(type))
    assert.ok(events.includes('BANANA_EXPIRED'))
  }
  assert.equal(itemActiveEffects(state.byPlayer.get('2')!, 1).includes('BUBBLE_SHIELD'), true)
})

test('full item race finishes in target window with readable bounded event volume', () => {
  const players = Array.from({ length: 8 }, (_, index) => ({ playerId: String(index + 1), name: `Duck ${index + 1}` }))
  const presets: RaceItemId[][] = [
    ['NITRO', 'BANANA'],
    ['BUBBLE_SHIELD', 'QUACK_HORN'],
    ['HOMING_ROCKET', 'FEATHER'],
  ]
  const raceConfig = raceConfigSchema.parse({
    raceId: 'full-items',
    seed: 'ab'.repeat(32),
    players,
    loadouts: players.map((player, index) => ({ playerId: player.playerId, itemIds: presets[index % presets.length], source: 'PLAYER' })),
  })
  const result = simulateRace(raceConfig)
  const types = new Set(result.events.map((event) => event.type))
  assert.ok(result.durationMs >= 45_000 && result.durationMs <= 75_000)
  assert.ok(types.has('NITRO_STARTED'))
  assert.ok(types.has('ROCKET_FIRED'))
  assert.ok(types.has('BANANA_DROPPED'))
  assert.ok(types.has('HORN_USED'))
  assert.ok(result.events.length < 500, `event count ${result.events.length}`)
})
