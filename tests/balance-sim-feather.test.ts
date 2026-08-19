import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ITEM_BALANCE,
  createItemRaceState,
  resolveIncomingRaceEffect,
  tickItemSystem,
  type BananaRuntime,
  type ItemDuckState,
} from '../packages/race-core/src'
import { raceConfigSchema, type RaceEventType } from '../packages/race-protocol/src'
import {
  createRaceEventTrackerContext,
  emptyRaceInstrumentation,
  trackRaceEvent,
  type InstrumentEvent,
} from '../scripts/lib/balance-sim-core'

function config(loadouts: Array<{ playerId: string; itemIds: Array<'FEATHER' | 'BANANA' | 'BUBBLE_SHIELD' | 'HOMING_ROCKET'> }>) {
  return raceConfigSchema.parse({
    raceId: 'feather-fixture',
    seed: '22'.repeat(32),
    players: loadouts.map((loadout) => ({ playerId: loadout.playerId, name: loadout.playerId })),
    loadouts: loadouts.map((loadout) => ({ ...loadout, source: 'PLAYER' })),
  })
}

function duck(playerId: string, progress: number, lateralOffset = 0): ItemDuckState {
  return { playerId, progress, previousProgress: progress - 0.002, currentRank: 1, lateralOffset, lateralVelocity: 0, finished: false }
}

function trackEvents(events: InstrumentEvent[], focusPlayers: Set<string>, loadoutByPlayer: Map<string, Array<'FEATHER' | 'BANANA'>>) {
  const instrumentation = emptyRaceInstrumentation()
  const baselineRank = new Map([...focusPlayers].map((playerId) => [playerId, 2]))
  const finalRank = new Map([...focusPlayers].map((playerId) => [playerId, 1]))
  const tracker = createRaceEventTrackerContext(loadoutByPlayer, baselineRank, finalRank, focusPlayers, instrumentation)
  for (const event of events) trackRaceEvent(event, tracker)
  return instrumentation.items.FEATHER!
}

test('Feather instrumentation counts dodge exposure + proc on FEATHER_DODGED', () => {
  const feather = trackEvents([
    { type: 'FEATHER_DODGED', sourcePlayerId: 'A', targetPlayerId: 'B', metadata: {} },
  ], new Set(['A']), new Map([['A', ['FEATHER']]]))

  assert.equal(feather.eligibleThreats, 1)
  assert.equal(feather.actualCollisionOpportunities, 1)
  assert.equal(feather.defenseAvailableAtExposure, 1)
  assert.equal(feather.successfulProcs, 1)
})

test('Feather instrumentation counts consumed-feather banana hit as exposure without proc', () => {
  const feather = trackEvents([
    { type: 'BANANA_HIT', sourcePlayerId: 'B', targetPlayerId: 'A', metadata: {} },
  ], new Set(['A']), new Map([['A', ['FEATHER']]]))

  assert.equal(feather.eligibleThreats, 1)
  assert.equal(feather.defenseAvailableAtExposure, 0)
  assert.equal(feather.successfulProcs, 0)
})

test('Feather instrumentation ignores Rocket hits for feather threat metrics', () => {
  const feather = trackEvents([
    { type: 'ROCKET_HIT', sourcePlayerId: 'B', targetPlayerId: 'A', metadata: {} },
  ], new Set(['A']), new Map([['A', ['FEATHER']]]))

  assert.equal(feather.eligibleThreats, 0)
  assert.equal(feather.successfulProcs, 0)
})

test('resolveIncomingRaceEffect: Feather + Rocket does not dodge', () => {
  const runtime = {
    bubbleAvailable: false,
    featherAvailable: true,
    shockAbsorberAvailable: false,
    itemImmunityUntilTick: 0,
    rocketProtectionUntilTick: 0,
  }
  assert.equal(resolveIncomingRaceEffect(runtime, 'ROCKET', 10, 60), 'HIT')
  assert.equal(runtime.featherAvailable, true)
})

test('resolveIncomingRaceEffect: Feather + Banana + immunity counts as immunity not feather proc', () => {
  const runtime = {
    bubbleAvailable: false,
    featherAvailable: true,
    shockAbsorberAvailable: false,
    itemImmunityUntilTick: 100,
    rocketProtectionUntilTick: 0,
  }
  assert.equal(resolveIncomingRaceEffect(runtime, 'BANANA', 10, 60), 'IMMUNE')
  assert.equal(runtime.featherAvailable, true)
})

test('deterministic banana collision dodges Feather end-to-end', () => {
  const raceConfig = config([
    { playerId: 'A', itemIds: ['FEATHER'] },
    { playerId: 'B', itemIds: ['BANANA'] },
  ])
  const state = createItemRaceState(raceConfig)
  const ducks = [duck('A', 0.5, 0), duck('B', 0.45, 0)]
  const banana: BananaRuntime = {
    id: 1,
    sourcePlayerId: 'B',
    progress: 0.5,
    lateralOffset: 0,
    armedAtTick: 1,
    expiresAtTick: 600,
    kind: 'PREP',
    hitProgressRadius: ITEM_BALANCE.banana.hitProgressRadius,
    hitLateralRadius: ITEM_BALANCE.banana.hitLateralRadius,
    lateralSlip: ITEM_BALANCE.banana.lateralSlip,
  }
  state.bananas.push(banana)

  const emitted: InstrumentEvent[] = []
  tickItemSystem(state, ducks, 60, 60, (type, sourcePlayerId, targetPlayerId, metadata = {}) => {
    emitted.push({ type, sourcePlayerId, targetPlayerId, metadata })
  })

  const types = emitted.map((event) => event.type)
  assert.ok(types.includes('FEATHER_DODGED'))
  assert.ok(!types.includes('BANANA_HIT'))
  assert.equal(state.byPlayer.get('A')!.featherAvailable, false)

  const feather = trackEvents(emitted, new Set(['A', 'B']), new Map([
    ['A', ['FEATHER']],
    ['B', ['BANANA']],
  ]))
  assert.equal(feather.eligibleThreats, 1)
  assert.equal(feather.successfulProcs, 1)
  assert.equal(feather.defenseAvailableAtExposure, 1)
})

test('consumed Feather + second Banana records exposure without proc', () => {
  const raceConfig = config([
    { playerId: 'A', itemIds: ['FEATHER'] },
    { playerId: 'B', itemIds: ['BANANA'] },
  ])
  const state = createItemRaceState(raceConfig)
  state.byPlayer.get('A')!.featherAvailable = false
  const ducks = [duck('A', 0.5, 0), duck('B', 0.45, 0)]
  state.bananas.push({
    id: 1,
    sourcePlayerId: 'B',
    progress: 0.5,
    lateralOffset: 0,
    armedAtTick: 1,
    expiresAtTick: 600,
    kind: 'PREP',
    hitProgressRadius: ITEM_BALANCE.banana.hitProgressRadius,
    hitLateralRadius: ITEM_BALANCE.banana.hitLateralRadius,
    lateralSlip: ITEM_BALANCE.banana.lateralSlip,
  })

  const emitted: InstrumentEvent[] = []
  tickItemSystem(state, ducks, 60, 60, (type, sourcePlayerId, targetPlayerId, metadata = {}) => {
    emitted.push({ type, sourcePlayerId, targetPlayerId, metadata })
  })

  assert.ok(emitted.some((event) => event.type === 'BANANA_HIT'))
  assert.ok(!emitted.some((event) => event.type === 'FEATHER_DODGED'))

  const feather = trackEvents(emitted, new Set(['A']), new Map([['A', ['FEATHER']]]))
  assert.equal(feather.eligibleThreats, 1)
  assert.equal(feather.successfulProcs, 0)
  assert.equal(feather.defenseAvailableAtExposure, 0)
})
