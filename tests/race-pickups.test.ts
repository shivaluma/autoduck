import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ITEM_BALANCE,
  PICKUP_BALANCE,
  POSITION_CATEGORY_WEIGHTS,
  createSimulation,
  rollWildItem,
  simulateRace,
  stepSimulation,
  tickAutoUseAI,
  tickPickupSystem,
  tickItemSystem,
  activateWildItem,
} from '../packages/race-core/src'
import { raceConfigSchema, type RaceEventType, type WildItemId } from '../packages/race-protocol/src'
import { recordedWildInputsFromEvents } from '../lib/racing/persistence'
import type { RaceSimulationState } from '../packages/race-core/src/simulation'

function tickPickupsWithAutoAI(
  state: RaceSimulationState,
  tick: number,
  emit: (type: RaceEventType, source?: string, target?: string, metadata?: Record<string, unknown>) => void,
) {
  tickPickupSystem(state.config, state.track, state.pickupState, state.itemState, state.ducks, tick, 60, emit)
  tickAutoUseAI({
    config: state.config,
    track: state.track,
    itemState: state.itemState,
    pickupState: state.pickupState,
    ducks: state.ducks,
    tick,
    tickRate: 60,
    prepAutoUseEnabled: true,
    wildAutoUseEnabled: state.pickupState.config.autoItemsEnabled,
    emitItem: emit,
    emitPickup: emit,
  })
}

function config(seed = '51'.repeat(32), overrides: Record<string, unknown> = {}) {
  return raceConfigSchema.parse({
    raceId: `pickup-${seed.slice(0, 8)}`,
    seed,
    players: Array.from({ length: 8 }, (_, index) => ({ playerId: `duck-${index + 1}`, name: `Duck ${index + 1}` })),
    pickupConfig: {
      enabled: true,
      goldenBoxEnabled: true,
      goldenBoxProbability: 0.12,
      hazardsEnabled: true,
      positionAwareLoot: true,
      spawnMultiplier: 1,
      regularPickupCap: 2,
      manualItemsEnabled: true,
      autoItemsEnabled: true,
      chaosBoxEnabled: false,
      forceGoldenBox: false,
      disabledItems: [],
      idealManualPlayerIds: [],
      ...(overrides.pickupConfig as object ?? {}),
    },
    ...overrides,
  })
}

test('pickup and hazard layout is seeded, unique, authored, and bounded', () => {
  const first = createSimulation(config())
  const second = createSimulation(config())
  assert.deepEqual(first.pickupState.pickups, second.pickupState.pickups)
  assert.equal(new Set(first.pickupState.pickups.map((pickup) => pickup.id)).size, first.pickupState.pickups.length)
  assert.ok(first.pickupState.pickups.filter((pickup) => pickup.type === 'QUACK_BOX').every((pickup) => pickup.progress >= 0.12 && pickup.progress <= 0.9 && Math.abs(pickup.lateralOffset) <= 0.8))
  assert.ok(first.pickupState.hazards.length <= 2)
  assert.ok(first.pickupState.hazards.every((hazard) => Math.abs(hazard.lateralOffset) + hazard.radius < 0.9))
})

test('Golden Quack Box is deterministic, limited to one, and ignores Wild Slot', () => {
  const state = createSimulation(config('52'.repeat(32), { pickupConfig: { forceGoldenBox: true, autoItemsEnabled: false } }))
  const gold = state.pickupState.pickups.filter((pickup) => pickup.type === 'GOLDEN_BOX')
  assert.equal(gold.length, 1)
  const duck = state.ducks[0]!
  const runtime = state.itemState.byPlayer.get(duck.playerId)!
  runtime.wildItem = { instanceId: 'occupied', itemId: 'MINI_ROCKET', acquiredAtTick: 1 }
  duck.previousProgress = gold[0]!.progress - 0.001
  duck.progress = gold[0]!.progress
  duck.lateralOffset = gold[0]!.lateralOffset
  const events: RaceEventType[] = []
  tickPickupSystem(state.config, state.track, state.pickupState, state.itemState, state.ducks, 100, 60, (type) => events.push(type))
  assert.equal(gold[0]!.collectedByPlayerId, duck.playerId)
  assert.equal(runtime.wildItem.instanceId, 'occupied')
  assert.equal(events.filter((type) => type === 'GOLDEN_BOX_COLLECTED').length, 1)
})

test('same-tick collection tie resolves by distance, sub-tick, then stable player ID', () => {
  const state = createSimulation(config('53'.repeat(32), { pickupConfig: { forceItem: 'MINI_ROCKET', autoItemsEnabled: false, hazardsEnabled: false } }))
  const box = state.pickupState.pickups.find((pickup) => pickup.type === 'QUACK_BOX')!
  for (const duck of state.ducks) {
    duck.progress = 0
    duck.previousProgress = 0
    duck.lateralOffset = 0.9
  }
  for (const duck of state.ducks.slice(0, 2)) {
    duck.previousProgress = box.progress - 0.002
    duck.progress = box.progress
    duck.lateralOffset = box.lateralOffset
  }
  tickPickupSystem(state.config, state.track, state.pickupState, state.itemState, state.ducks, 120, 60, () => undefined)
  assert.equal(box.collectedByPlayerId, ['duck-1', 'duck-2'].sort()[0])
  assert.equal(state.itemState.byPlayer.get(box.collectedByPlayerId!)!.regularPickupCount, 1)
})

test('full Wild Slot leaves a standard box active for another duck', () => {
  const state = createSimulation(config('54'.repeat(32), { pickupConfig: { forceItem: 'MINI_ROCKET', autoItemsEnabled: false, hazardsEnabled: false } }))
  const box = state.pickupState.pickups.find((pickup) => pickup.type === 'QUACK_BOX')!
  const duck = state.ducks[0]!
  state.itemState.byPlayer.get(duck.playerId)!.wildItem = { instanceId: 'full', itemId: 'BANANA', acquiredAtTick: 1 }
  duck.previousProgress = box.progress - 0.001
  duck.progress = box.progress
  duck.lateralOffset = box.lateralOffset
  const events: RaceEventType[] = []
  tickPickupSystem(state.config, state.track, state.pickupState, state.itemState, state.ducks, 100, 60, (type) => events.push(type))
  assert.equal(box.state, 'ACTIVE')
  assert.equal(events.filter((type) => type === 'PICKUP_SKIPPED_SLOT_FULL').length, 1)
})

test('loot is deterministic, respects disabled items, and category weights normalize', () => {
  const raceConfig = config('55'.repeat(32), { pickupConfig: { disabledItems: ['MINI_ROCKET', 'BANANA', 'QUACK_HORN'] } })
  const state = createSimulation(raceConfig)
  const box = state.pickupState.pickups.find((pickup) => pickup.type === 'QUACK_BOX')!
  const duck = state.ducks[4]!
  const first = rollWildItem(raceConfig, state.pickupState, box, duck, state.ducks)
  const second = rollWildItem(raceConfig, state.pickupState, box, duck, state.ducks)
  assert.equal(first, second)
  assert.ok(!['MINI_ROCKET', 'BANANA', 'QUACK_HORN'].includes(first))
  for (const weights of Object.values(POSITION_CATEGORY_WEIGHTS)) assert.equal(Object.values(weights).reduce((sum, value) => sum + value, 0), 100)
})

test('held Wild Items validate target, consume exactly once, and keep invalid use', () => {
  const state = createSimulation(config('56'.repeat(32), { pickupConfig: { enabled: false, hazardsEnabled: false, autoItemsEnabled: false } }))
  const source = state.ducks.find((duck) => duck.playerId === 'duck-2')!
  const target = state.ducks.find((duck) => duck.playerId === 'duck-1')!
  source.progress = 0.4
  target.progress = 0.48
  const runtime = state.itemState.byPlayer.get(source.playerId)!
  runtime.wildItem = { instanceId: 'rocket-1', itemId: 'MINI_ROCKET', acquiredAtTick: 1 }
  assert.equal(activateWildItem(state.itemState, state.ducks, { playerId: source.playerId, wildItemInstanceId: 'wrong' }, 10, 60, 'MANUAL', () => undefined).reason, 'ITEM_CHANGED')
  assert.equal(runtime.wildItem.instanceId, 'rocket-1')
  assert.equal(activateWildItem(state.itemState, state.ducks, { playerId: source.playerId, wildItemInstanceId: 'rocket-1' }, 10, 60, 'MANUAL', () => undefined).ok, true)
  assert.equal(runtime.wildItem, null)
  assert.equal(state.itemState.rockets.length, 1)
  assert.equal(activateWildItem(state.itemState, state.ducks, { playerId: source.playerId, wildItemInstanceId: 'rocket-1' }, 11, 60, 'MANUAL', () => undefined).reason, 'NO_ITEM')
})

test('Mini Rocket skips ducks with active Rocket target protection', () => {
  const state = createSimulation(config('5a'.repeat(32), { pickupConfig: { enabled: false, hazardsEnabled: false, autoItemsEnabled: false } }))
  const source = state.ducks[2]!
  const protectedDuck = state.ducks[1]!
  const eligibleDuck = state.ducks[0]!
  source.progress = 0.4
  protectedDuck.progress = 0.45
  eligibleDuck.progress = 0.5
  state.itemState.byPlayer.get(protectedDuck.playerId)!.rocketProtectionUntilTick = 120
  const runtime = state.itemState.byPlayer.get(source.playerId)!
  runtime.wildItem = { instanceId: 'protected-target', itemId: 'MINI_ROCKET', acquiredAtTick: 1 }

  const result = activateWildItem(state.itemState, state.ducks, { playerId: source.playerId, wildItemInstanceId: 'protected-target' }, 60, 60, 'MANUAL', () => undefined)

  assert.equal(result.ok, true)
  assert.equal(result.targetPlayerId, eligibleDuck.playerId)
})

test('all five held Wild Item handlers execute without hard control', () => {
  const held: WildItemId[] = ['MINI_BUBBLE', 'MINI_ROCKET', 'BANANA', 'QUACK_HORN', 'FEATHER']
  for (const itemId of held) {
    const state = createSimulation(config(`57${held.indexOf(itemId)}`.padEnd(64, '7'), { pickupConfig: { enabled: false, hazardsEnabled: false, autoItemsEnabled: false } }))
    const source = state.ducks[1]!
    const target = state.ducks[0]!
    source.progress = 0.45
    source.lateralOffset = 0
    target.progress = itemId === 'QUACK_HORN' ? 0.455 : 0.5
    target.lateralOffset = 0.05
    const runtime = state.itemState.byPlayer.get(source.playerId)!
    runtime.wildItem = { instanceId: `held-${itemId}`, itemId, acquiredAtTick: 1 }
    const result = activateWildItem(state.itemState, state.ducks, { playerId: source.playerId, wildItemInstanceId: `held-${itemId}` }, 30, 60, 'AUTO', () => undefined)
    assert.equal(result.ok, true, itemId)
    assert.equal(runtime.wildItem, null)
  }
})

test('Wild Banana drops in-lane behind the holder so the chaser can hit it', () => {
  const state = createSimulation(config('57'.repeat(32), { pickupConfig: { enabled: false, hazardsEnabled: false, autoItemsEnabled: false } }))
  const source = state.ducks[0]!
  const chaser = state.ducks[1]!
  source.progress = 0.5
  source.lateralOffset = 0
  chaser.progress = 0.497
  chaser.lateralOffset = 0
  chaser.previousProgress = 0.496
  const runtime = state.itemState.byPlayer.get(source.playerId)!
  runtime.wildItem = { instanceId: 'safe-banana', itemId: 'BANANA', acquiredAtTick: 1 }
  const events: RaceEventType[] = []
  assert.equal(activateWildItem(state.itemState, state.ducks, { playerId: source.playerId, wildItemInstanceId: 'safe-banana' }, 30, 60, 'AUTO', (type) => events.push(type)).ok, true)
  const banana = state.itemState.bananas[0]!
  assert.equal(banana.lateralOffset, source.lateralOffset)
  assert.ok(source.progress - banana.progress >= 0.01)

  chaser.previousProgress = banana.progress - 0.02
  chaser.progress = banana.progress + 0.002
  chaser.lateralOffset = banana.lateralOffset
  const before = chaser.progress
  for (let tick = banana.armedAtTick; tick <= banana.armedAtTick + 2; tick += 1) {
    tickItemSystem(state.itemState, state.ducks, tick, 60, (type) => events.push(type))
  }
  assert.ok(events.includes('WILD_BANANA_HIT'))
  assert.equal(chaser.progress, before)
  assert.notEqual(chaser.lateralVelocity, 0)
  const victimRuntime = state.itemState.byPlayer.get(chaser.playerId)!
  assert.equal(victimRuntime.slowMultiplier, PICKUP_BALANCE.banana.staggerMultiplier)
})

test('manual Wild input is persisted in event stream and replay deterministic', () => {
  const raceConfig = config('58'.repeat(32), { pickupConfig: { forceItem: 'MINI_BUBBLE', autoItemsEnabled: false, hazardsEnabled: false, spawnMultiplier: 3 } })
  const baseline = simulateRace(raceConfig)
  const grant = baseline.events.find((event) => event.type === 'WILD_ITEM_GRANTED')!
  assert.ok(grant)
  const input = {
    raceId: raceConfig.raceId,
    playerId: grant.sourcePlayerId!,
    wildItemInstanceId: String(grant.metadata.instanceId),
    action: 'USE' as const,
    clientActionId: 'manual-test-action',
    authoritativeTick: grant.tick + 1,
  }
  const first = simulateRace(raceConfig, { manualInputs: [input] })
  const second = simulateRace(raceConfig, { manualInputs: [input] })
  assert.deepEqual(second, first)
  const manual = first.events.find((event) => event.type === 'WILD_ITEM_MANUAL_INPUT')
  assert.equal(manual?.metadata.applied, true)

  const staleInput = { ...input, clientActionId: 'manual-stale-action', authoritativeTick: input.authoritativeTick + 1 }
  const withRejectedInput = simulateRace(raceConfig, { manualInputs: [input, staleInput] })
  const rejected = withRejectedInput.events.find((event) => event.type === 'WILD_ITEM_MANUAL_INPUT' && event.metadata.clientActionId === staleInput.clientActionId)
  assert.equal(rejected?.metadata.applied, false)
  assert.deepEqual(recordedWildInputsFromEvents(withRejectedInput.events), [input, staleInput])
  assert.deepEqual(simulateRace(raceConfig, { manualInputs: [input, staleInput] }), withRejectedInput)
})

test('auto-use burns held Wild Items before the finish instead of carrying them unused', () => {
  const state = createSimulation(config('59'.repeat(32), { pickupConfig: { enabled: false, hazardsEnabled: false } }))
  const leader = state.ducks[0]!
  leader.progress = 0.93
  leader.currentRank = 1
  for (const duck of state.ducks.slice(1)) {
    duck.progress = 0.82
    duck.currentRank = Number(duck.playerId.split('-')[1])
  }
  const backmarker = state.ducks[7]!
  backmarker.progress = 0.79
  backmarker.currentRank = 8

  state.itemState.byPlayer.get(leader.playerId)!.wildItem = { instanceId: 'leader-rocket', itemId: 'MINI_ROCKET', acquiredAtTick: 1 }
  state.itemState.byPlayer.get(backmarker.playerId)!.wildItem = { instanceId: 'back-banana', itemId: 'BANANA', acquiredAtTick: 1 }

  const events: RaceEventType[] = []
  let forfeitedLeader = false
  for (let tick = 200; tick <= 260; tick += 1) {
    tickPickupsWithAutoAI(state, tick, (type, source, _target, metadata) => {
      events.push(type)
      if (type === 'WILD_ITEM_AUTO_USED' && source === leader.playerId && metadata?.forfeited === true) {
        forfeitedLeader = true
      }
    })
  }

  assert.equal(forfeitedLeader, true)

  assert.equal(state.itemState.byPlayer.get(leader.playerId)!.wildItem, null)
  assert.equal(state.itemState.byPlayer.get(backmarker.playerId)!.wildItem, null)
  assert.ok(events.includes('WILD_BANANA_DROPPED'))
})

test('newly collected held Wild Items auto-use on the same tick', () => {
  const state = createSimulation(config('5b'.repeat(32), { pickupConfig: { forceItem: 'FEATHER', autoItemsEnabled: true, hazardsEnabled: false, spawnMultiplier: 2 } }))
  const duck = state.ducks[3]!
  duck.currentRank = 7
  const box = state.pickupState.pickups.find((pickup) => pickup.type === 'QUACK_BOX' && pickup.progress > 0.75)!
  duck.previousProgress = box.progress - 0.002
  duck.progress = box.progress
  duck.lateralOffset = box.lateralOffset

  const events: RaceEventType[] = []
  tickPickupsWithAutoAI(state, 150, (type) => events.push(type))
  for (let tick = 151; tick <= 220; tick += 1) {
    tickAutoUseAI({
      config: state.config,
      track: state.track,
      itemState: state.itemState,
      pickupState: state.pickupState,
      ducks: state.ducks,
      tick,
      tickRate: 60,
      prepAutoUseEnabled: true,
      wildAutoUseEnabled: state.pickupState.config.autoItemsEnabled,
      emitItem: (type) => events.push(type),
      emitPickup: (type) => events.push(type),
    })
  }

  assert.equal(state.itemState.byPlayer.get(duck.playerId)!.wildItem, null)
  assert.ok(events.includes('WILD_ITEM_GRANTED'))
  assert.ok(events.includes('WILD_ITEM_AUTO_USED'))
  assert.ok(events.includes('WILD_FEATHER_USED'))
})

test('player array order cannot change pickup race outcomes', () => {
  const ordered = config('59'.repeat(32))
  const reversed = raceConfigSchema.parse({ ...ordered, players: [...ordered.players].reverse() })
  assert.deepEqual(simulateRace(reversed), simulateRace(ordered))
})

test('fuzzed pickup races finish with finite state, no duplicate collection, and bounded speed effects', { timeout: 120_000 }, () => {
  for (let raceIndex = 1; raceIndex <= 100; raceIndex += 1) {
    const state = createSimulation(config(raceIndex.toString(16).padStart(64, '0')))
    while (!state.finished) {
      stepSimulation(state)
      for (const duck of state.ducks) {
        assert.ok(Number.isFinite(duck.progress) && Number.isFinite(duck.speed) && Number.isFinite(duck.lateralOffset))
        const runtime = state.itemState.byPlayer.get(duck.playerId)!
        assert.ok(runtime.regularPickupCount <= 3)
        assert.ok(runtime.boostMultiplier <= ITEM_BALANCE.maximumSpeedMultiplier && runtime.slowMultiplier >= ITEM_BALANCE.minimumSpeedMultiplier)
      }
    }
    const collected = state.pickupState.pickups.filter((pickup) => pickup.state === 'COLLECTED')
    assert.equal(new Set(collected.map((pickup) => pickup.id)).size, collected.length)
    assert.ok(collected.filter((pickup) => pickup.type === 'GOLDEN_BOX').length <= 1)
  }
})
