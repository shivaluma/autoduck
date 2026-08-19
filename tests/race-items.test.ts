import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ITEM_BALANCE,
  ITEM_INTERACTION_MATRIX,
  applyItemSlow,
  applyStagedSlow,
  createItemRaceState,
  itemActiveEffects,
  itemSpeedMultiplier,
  resolveIncomingRaceEffect,
  simulateRace,
  tickAutoUseAI,
  tickItemSystem,
  tryActivateBubbleShield,
  breakActiveSpeedBoost,
  type DuckItemRuntime,
  type ItemDuckState,
  type ItemRaceState,
} from '../packages/race-core/src'
import { raceConfigSchema, type RaceConfig, type RaceEventType, type RaceItemId } from '../packages/race-protocol/src'
import { createRiverTrack } from '../packages/race-core/src/track'
import { createPickupRaceState } from '../packages/race-core/src/pickups/engine'

function defense(items: RaceItemId[]): DuckItemRuntime {
  return {
    itemIds: items,
    loadoutCombo: null,
    usedItems: new Set(),
    bubbleAvailable: items.includes('BUBBLE_SHIELD'),
    bubbleUntilTick: items.includes('BUBBLE_SHIELD') ? 1000 : 0,
    silencedUntilTick: 0,
    featherAvailable: items.includes('FEATHER'),
    shockAbsorberAvailable: items.includes('SHOCK_ABSORBER'),
    itemImmunityUntilTick: 0,
    rocketProtectionUntilTick: 0,
    slowMultiplier: 1,
    slowUntilTick: 0,
    boostMultiplier: 1,
    boostUntilTick: 0,
    wildItem: null,
    regularPickupCount: 0,
    wildBubbleAvailable: false,
    wildBubbleUntilTick: 0,
    wildFeatherAvailable: false,
    wildFeatherUntilTick: 0,
    tailwindUntilTick: 0,
    magnetUntilTick: 0,
    lastItemUseTick: 0,
    nextAutoDecisionTick: 0,
    nextAutoActionTick: 0,
    pendingAutoAction: null,
    pendingAutoActionExecuteTick: 0,
    lastOffensiveUseTick: 0,
    draftSlipstreamTicks: 0,
    draftTargetPlayerId: null,
    activeSpeedItemId: null,
    queuedSpeedBoost: null,
    boostStartedAtTick: 0,
    reactiveRocketVisibleSinceTick: null,
    reactiveBananaVisibleSinceTick: null,
  }
}

function tickItemsWithAutoAI(
  raceConfig: RaceConfig,
  itemState: ItemRaceState,
  ducks: ItemDuckState[],
  tick: number,
  tickRate: number,
  emit: (type: RaceEventType, source?: string, target?: string, metadata?: Record<string, unknown>) => void,
) {
  const track = createRiverTrack(raceConfig.trackVersion)
  const pickupState = createPickupRaceState(raceConfig, track)
  tickAutoUseAI({
    config: raceConfig,
    track,
    itemState,
    pickupState,
    ducks,
    tick,
    tickRate,
    prepAutoUseEnabled: true,
    wildAutoUseEnabled: pickupState.config.autoItemsEnabled,
    emitItem: emit,
    emitPickup: emit,
  })
  tickItemSystem(itemState, ducks, tick, tickRate, emit)
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

test('Wild Feather dodges both Banana variants and minor hazards, but not Rocket', () => {
  for (const incoming of ['BANANA', 'WILD_BANANA', 'MINOR_HAZARD'] as const) {
    const target = defense([])
    target.wildFeatherAvailable = true
    target.wildFeatherUntilTick = 300
    assert.equal(resolveIncomingRaceEffect(target, incoming, 60, 60), 'DODGED_WILD_FEATHER')
    assert.equal(target.wildFeatherAvailable, false)
  }
  const rocketTarget = defense([])
  rocketTarget.wildFeatherAvailable = true
  rocketTarget.wildFeatherUntilTick = 300
  assert.equal(resolveIncomingRaceEffect(rocketTarget, 'MINI_ROCKET', 60, 60), 'HIT')
  assert.equal(rocketTarget.wildFeatherAvailable, true)
})

test('post-hit immunity prevents chain hits and Rocket target protection lasts two seconds', () => {
  const target = defense([])
  assert.equal(resolveIncomingRaceEffect(target, 'ROCKET', 10, 60), 'HIT')
  assert.equal(target.itemImmunityUntilTick, 70)
  assert.equal(target.rocketProtectionUntilTick, 130)
  assert.equal(resolveIncomingRaceEffect(target, 'BANANA', 69, 60), 'IMMUNE')
  assert.equal(resolveIncomingRaceEffect(target, 'BANANA', 70, 60), 'HIT')
})

test('slow effects use the strongest active value without weaker duration extension', () => {
  const runtime = defense([])
  applyItemSlow(runtime, 0.6, 2, 10, 60)
  const firstExpiry = runtime.slowUntilTick
  applyItemSlow(runtime, 0.7, 1.5, 20, 60)
  assert.equal(runtime.slowMultiplier, 0.6)
  assert.equal(runtime.slowUntilTick, firstExpiry)
  runtime.boostMultiplier = 1.5
  runtime.boostUntilTick = 100
  assert.ok(itemSpeedMultiplier(runtime, 30) >= ITEM_BALANCE.minimumSpeedMultiplier)
  assert.ok(itemSpeedMultiplier(runtime, 30) <= ITEM_BALANCE.maximumSpeedMultiplier)
})

test('Nitro activates deterministically and ends after configured duration', () => {
  const raceConfig = config([{ playerId: '2', itemIds: ['NITRO', 'BANANA'] }])
  const state = createItemRaceState(raceConfig)
  const ducks = [duck('1', 0.95, 1), duck('2', 0.93, 2)]
  const events: RaceEventType[] = []
  let nitroTick = 0
  for (let tick = 1; tick <= 200 && nitroTick === 0; tick += 1) {
    tickItemsWithAutoAI(raceConfig, state, ducks, tick, 60, (type) => {
      events.push(type)
      if (type === 'NITRO_STARTED') nitroTick = tick
    })
  }
  const runtime = state.byPlayer.get('2')!
  const durationTicks = Math.round(ITEM_BALANCE.nitro.durationSeconds * 60)
  assert.ok(nitroTick > 0)
  assert.equal(runtime.boostUntilTick, nitroTick + durationTicks)
  assert.equal(runtime.boostMultiplier, ITEM_BALANCE.nitro.speedMultiplier)
  assert.equal(itemSpeedMultiplier(runtime, nitroTick), 1.0)
  assert.equal(itemSpeedMultiplier(runtime, nitroTick + 30), ITEM_BALANCE.nitro.speedMultiplier)

  tickItemsWithAutoAI(raceConfig, state, ducks, nitroTick + durationTicks, 60, (type) => events.push(type))
  assert.equal(itemSpeedMultiplier(runtime, nitroTick + durationTicks), 1)
  assert.deepEqual(events.filter((type) => type.startsWith('NITRO')), ['NITRO_STARTED', 'NITRO_ENDED'])
})

test('Rocket targets valuable eligible duck ahead and expires when it cannot hit', () => {
  const raceConfig = config([{ playerId: '2', itemIds: ['HOMING_ROCKET', 'FEATHER'] }])
  const state = createItemRaceState(raceConfig)
  const ducks = [duck('1', 0.44, 1), duck('2', 0.4, 2)]
  const events: Array<{ type: RaceEventType; target?: string }> = []
  let rocketTick = 0
  for (let tick = 1; tick <= 60; tick += 1) {
    tickItemsWithAutoAI(raceConfig, state, ducks, tick, 60, (type, _source, target) => {
      events.push({ type, target })
      if (type === 'ROCKET_FIRED' && rocketTick === 0) {
        rocketTick = tick
        ducks[0].finished = true
      }
    })
    if (rocketTick > 0) break
  }
  const fired = events.find((entry) => entry.type === 'ROCKET_FIRED')
  assert.ok(fired)
  assert.equal(fired?.target, '1')
  for (let tick = rocketTick + 1; tick <= rocketTick + 3; tick += 1) {
    tickItemsWithAutoAI(raceConfig, state, ducks, tick, 60, (type, _source, target) => events.push({ type, target }))
  }
  assert.ok(events.some((entry) => entry.type === 'ROCKET_EXPIRED'))
})

test('Banana expires, Horn pushes only laterally, and neither hard-stuns', () => {
  const raceConfig = config([
    { playerId: '1', itemIds: ['NITRO', 'BANANA'] },
    { playerId: '3', itemIds: ['NITRO', 'FEATHER'] },
  ])
  const bananaState = createItemRaceState(raceConfig)
  const bananaDucks = [duck('1', 0.78, 1, 0), duck('3', 0.76, 2, 0)]
  const bananaEvents: RaceEventType[] = []
  for (let tick = 1; tick <= 80; tick += 1) {
    tickItemsWithAutoAI(raceConfig, bananaState, bananaDucks, tick, 60, (type) => bananaEvents.push(type))
    if (bananaEvents.includes('BANANA_DROPPED')) break
  }
  assert.ok(bananaEvents.includes('BANANA_DROPPED'))
  const banana = bananaState.bananas[0]
  assert.ok(banana)
  bananaDucks[0].progress = 0.9
  bananaDucks[1].progress = 0.5
  bananaDucks[1].previousProgress = 0.5
  bananaDucks[1].lateralOffset = 0.8
  tickItemsWithAutoAI(raceConfig, bananaState, bananaDucks, banana.expiresAtTick, 60, (type) => bananaEvents.push(type))
  assert.ok(bananaEvents.includes('BANANA_EXPIRED'))

  const hornConfig = config([
    { playerId: '1', itemIds: ['NITRO', 'SHOCK_ABSORBER'] },
    { playerId: '2', itemIds: ['BUBBLE_SHIELD', 'QUACK_HORN'] },
    { playerId: '3', itemIds: ['NITRO', 'FEATHER'] },
  ])
  const hornState = createItemRaceState(hornConfig)
  const hornDucks = [duck('1', 0.7, 1, 0), duck('2', 0.695, 2, 0.3), duck('3', 0.698, 3, -0.05)]
  const hornEvents: RaceEventType[] = []
  for (let tick = 1; tick <= 80; tick += 1) {
    tickItemsWithAutoAI(hornConfig, hornState, hornDucks, tick, 60, (type) => hornEvents.push(type))
  }
  assert.ok(hornEvents.includes('HORN_USED'))
  assert.notEqual(hornDucks[0].lateralVelocity, 0)
  assert.equal(itemActiveEffects(hornState.byPlayer.get('3')!, 1).includes('FEATHER'), true)
})

test('Rocket hits the duck ahead and applies the configured slow', () => {
  const raceConfig = config([{ playerId: '2', itemIds: ['HOMING_ROCKET', 'FEATHER'] }])
  const state = createItemRaceState(raceConfig)
  const ducks = [duck('1', 0.48, 1), duck('2', 0.4, 2)]
  const events: RaceEventType[] = []
  let firedAt = 0
  for (let tick = 1; tick <= 200; tick += 1) {
    tickItemsWithAutoAI(raceConfig, state, ducks, tick, 60, (type) => {
      events.push(type)
      if (type === 'ROCKET_FIRED' && firedAt === 0) firedAt = tick
    })
    if (events.includes('ROCKET_HIT')) break
    ducks[0].progress += 0.0003
    ducks[1].progress += 0.0003
  }
  assert.ok(events.includes('ROCKET_FIRED'))
  assert.ok(events.includes('ROCKET_HIT'))
  const target = state.byPlayer.get('1')!
  assert.equal(target.slowMultiplier, ITEM_BALANCE.rocket.staggerMultiplier)
  assert.ok(target.slowUntilTick > firedAt)
  assert.equal(itemSpeedMultiplier(target, firedAt + 3), ITEM_BALANCE.rocket.staggerMultiplier)
})

test('Rocket applies two-stage stagger then recovery slow', () => {
  const runtime: DuckItemRuntime = defense(['FEATHER'])

  // Hit at tick 100 with tickRate 60
  applyStagedSlow(
    runtime,
    ITEM_BALANCE.rocket.staggerMultiplier,
    ITEM_BALANCE.rocket.staggerDurationSeconds,
    ITEM_BALANCE.rocket.recoverySlowMultiplier,
    ITEM_BALANCE.rocket.recoveryDurationSeconds,
    100,
    60,
  )

  // Stage 1: Stagger (0.85s = 51 ticks, from tick 100 to 151)
  assert.equal(runtime.slowMultiplier, ITEM_BALANCE.rocket.staggerMultiplier)
  assert.equal(runtime.slowUntilTick, 151)
  assert.equal(itemSpeedMultiplier(runtime, 110), ITEM_BALANCE.rocket.staggerMultiplier)

  // Stage 2: Recovery slow (0.75s = 45 ticks, from tick 151 to 196)
  assert.equal(itemSpeedMultiplier(runtime, 160), ITEM_BALANCE.rocket.recoverySlowMultiplier)

  // Stage 3: Fully recovered after tick 196
  assert.equal(itemSpeedMultiplier(runtime, 200), 1.0)
})

test('Rocket breaks active speed boost before applying slow', () => {
  const raceConfig = config([
    { playerId: '1', itemIds: ['NITRO', 'FEATHER'] },
    { playerId: '2', itemIds: ['HOMING_ROCKET', 'BANANA'] },
  ])
  const state = createItemRaceState(raceConfig)
  const ducks = [duck('1', 0.48, 1), duck('2', 0.4, 2)]
  const target = state.byPlayer.get('1')!
  target.boostMultiplier = ITEM_BALANCE.nitro.speedMultiplier
  target.boostUntilTick = 500
  target.activeSpeedItemId = 'NITRO'
  const events: RaceEventType[] = []
  for (let tick = 1; tick <= 260; tick += 1) {
    tickItemsWithAutoAI(raceConfig, state, ducks, tick, 60, (type) => events.push(type))
    ducks[0].progress += 0.0003
    ducks[1].progress += 0.0003
    if (events.includes('ROCKET_HIT')) break
  }
  assert.ok(events.includes('BOOST_BROKEN'))
  assert.equal(target.activeSpeedItemId, null)
  assert.equal(target.slowMultiplier, ITEM_BALANCE.rocket.staggerMultiplier)
})

test('Shock Absorber mitigates the first Rocket hit with lighter stagger and recovery', () => {
  const raceConfig = config([
    { playerId: '1', itemIds: ['SHOCK_ABSORBER', 'FEATHER'] },
    { playerId: '2', itemIds: ['HOMING_ROCKET', 'BANANA'] },
  ])
  const state = createItemRaceState(raceConfig)
  const ducks = [duck('1', 0.48, 1), duck('2', 0.4, 2)]
  const events: RaceEventType[] = []
  for (let tick = 1; tick <= 260; tick += 1) {
    tickItemsWithAutoAI(raceConfig, state, ducks, tick, 60, (type) => events.push(type))
    ducks[0].progress += 0.0003
    ducks[1].progress += 0.0003
    if (events.includes('ROCKET_HIT')) break
  }
  const target = state.byPlayer.get('1')!
  assert.ok(events.includes('SHOCK_ABSORBER_PROC'))
  assert.equal(target.shockAbsorberAvailable, false)
  assert.equal(target.slowMultiplier, ITEM_BALANCE.shockAbsorber.staggerMultiplier)
})

test('Rocket applies spinout stall and triggers MENACE predator rush', () => {
  const raceConfig = config([
    { playerId: '1', itemIds: ['FEATHER', 'DRAFT_FIN'] },
    { playerId: '2', itemIds: ['HOMING_ROCKET', 'BANANA'] }, // MENACE combo
  ])
  const state = createItemRaceState(raceConfig)
  const ducks = [duck('1', 0.48, 1), duck('2', 0.40, 2)]
  ducks[0].previousProgress = 0.48
  const initialTargetProgress = ducks[0].progress
  const events: RaceEventType[] = []
  for (let tick = 1; tick <= 260; tick += 1) {
    tickItemsWithAutoAI(raceConfig, state, ducks, tick, 60, (type) => events.push(type))
    ducks[0].progress += 0.0001
    ducks[1].progress += 0.0001
    if (events.includes('ROCKET_HIT')) break
  }
  assert.ok(events.includes('ROCKET_HIT'))
  // Target does not teleport backward, progress moves continuously
  assert.ok(ducks[0].progress >= initialTargetProgress)
  // Target speed is heavily stalled
  const targetRuntime = state.byPlayer.get('1')!
  assert.equal(targetRuntime.slowMultiplier, ITEM_BALANCE.rocket.staggerMultiplier)
  // Shooter with MENACE should trigger PREDATOR_RUSH_STARTED
  assert.ok(events.includes('PREDATOR_RUSH_STARTED'))
  const shooterRuntime = state.byPlayer.get('2')!
  assert.equal(shooterRuntime.boostMultiplier, ITEM_BALANCE.menace.predatorRushMultiplier)
})

test('Banana stays in-lane and knocks the chasing duck backward', () => {
  const raceConfig = config([{ playerId: '2', itemIds: ['NITRO', 'BANANA'] }])
  const state = createItemRaceState(raceConfig)
  const ducks = [duck('1', 0.74, 2, 0), duck('2', 0.78, 1, 0)]
  ducks[0].previousProgress = 0.74
  const events: RaceEventType[] = []
  for (let tick = 1; tick <= 80; tick += 1) {
    tickItemsWithAutoAI(raceConfig, state, ducks, tick, 60, (type) => events.push(type))
    if (events.includes('BANANA_DROPPED')) break
  }
  assert.ok(events.includes('BANANA_DROPPED'))
  const banana = state.bananas[0]!
  assert.ok(banana)
  assert.equal(banana.lateralOffset, 0)
  assert.ok(ducks[1].progress - banana.progress >= ITEM_BALANCE.banana.dropBehindProgress - 0.001)

  const before = ducks[0].progress
  ducks[0].previousProgress = banana.progress - 0.02
  ducks[0].progress = banana.progress + 0.002
  ducks[0].lateralOffset = banana.lateralOffset
  for (let tick = banana.armedAtTick; tick <= banana.armedAtTick + 2; tick += 1) {
    tickItemSystem(state, ducks, tick, 60, (type) => events.push(type))
    if (events.includes('BANANA_HIT')) break
  }
  assert.ok(events.includes('BANANA_HIT'))
  assert.ok(ducks[0].progress < before)
  assert.ok(ducks[0].progress <= banana.progress + 0.002 - ITEM_BALANCE.banana.progressKnockback + 0.0001)
  assert.notEqual(ducks[0].lateralVelocity, 0)
})

test('prep items auto-burn near the finish line instead of staying unused', () => {
  const raceConfig = config([{ playerId: '2', itemIds: ['NITRO', 'BANANA'] }])
  const state = createItemRaceState(raceConfig)
  const ducks = [duck('1', 0.95, 1), duck('2', 0.93, 2)]
  const events: RaceEventType[] = []
  for (let tick = 1; tick <= 80; tick += 1) {
    tickItemsWithAutoAI(raceConfig, state, ducks, tick, 60, (type) => events.push(type))
  }
  assert.ok(events.includes('NITRO_STARTED'))
  assert.ok(events.includes('BANANA_DROPPED'))
  assert.equal(state.byPlayer.get('2')!.usedItems.has('NITRO'), true)
  assert.equal(state.byPlayer.get('2')!.usedItems.has('BANANA'), true)
})

test('Bubble Shield activates reactively when attacked, blocks, and expires if untriggered', () => {
  const raceConfig = config([
    { playerId: '1', itemIds: ['BUBBLE_SHIELD', 'SHOCK_ABSORBER'] },
    { playerId: '2', itemIds: ['HOMING_ROCKET', 'BANANA'] },
  ])
  const state = createItemRaceState(raceConfig)
  const ducks = [duck('1', 0.45, 1), duck('2', 0.30, 2)]
  const events: RaceEventType[] = []

  // Run simulation until rocket is fired and bubble shield reactively triggers
  for (let tick = 1; tick <= 250; tick += 1) {
    tickItemsWithAutoAI(raceConfig, state, ducks, tick, 60, (type) => events.push(type))
    ducks[0].progress += 0.0002
    ducks[1].progress += 0.0002
  }

  assert.ok(events.includes('ROCKET_FIRED'))
  assert.ok(events.includes('BUBBLE_SHIELD_ACTIVATED'))
  assert.ok(events.includes('ROCKET_BLOCKED'))
  assert.ok(events.includes('BUBBLE_POPPED'))
  assert.equal(state.byPlayer.get('1')!.usedItems.has('BUBBLE_SHIELD'), true)
})

test('expired Bubble Shield does not block subsequent rockets, slow is properly applied', () => {
  const raceConfig = config([
    { playerId: '1', itemIds: ['BUBBLE_SHIELD', 'FEATHER'] },
    { playerId: '2', itemIds: ['HOMING_ROCKET', 'QUACK_HORN'] },
  ])
  const state = createItemRaceState(raceConfig)
  const runtime1 = state.byPlayer.get('1')!
  const ducks = [duck('1', 0.5, 1), duck('2', 0.45, 2)]

  // 1. Activate Bubble Shield manually at tick 100
  tryActivateBubbleShield(runtime1, '1', 100, 60, () => undefined)
  assert.equal(runtime1.bubbleAvailable, true)
  assert.equal(runtime1.bubbleUntilTick, 100 + 4.5 * 60) // 370

  // 2. Advance to tick 400 (Bubble Shield is expired in tickItemSystem)
  tickItemSystem(state, ducks, 400, 60, () => undefined)
  assert.equal(runtime1.bubbleAvailable, false)

  // 3. Rocket hits at tick 400
  const outcome1 = resolveIncomingRaceEffect(runtime1, 'ROCKET', 400, 60)
  assert.equal(outcome1, 'HIT', 'Expired bubble shield must NOT block rocket')
  breakActiveSpeedBoost(runtime1, 400, 60, () => undefined, '2', '1', 'ROCKET')
  applyItemSlow(runtime1, ITEM_BALANCE.rocket.slowMultiplier, ITEM_BALANCE.rocket.slowDurationSeconds, 400, 60)
  assert.equal(runtime1.slowMultiplier, ITEM_BALANCE.rocket.slowMultiplier)
  assert.equal(runtime1.slowUntilTick, 400 + Math.round(ITEM_BALANCE.rocket.slowDurationSeconds * 60))
  assert.equal(itemSpeedMultiplier(runtime1, 400), ITEM_BALANCE.rocket.slowMultiplier)

  // 4. Second Rocket arrives at tick 430 (during post-hit immunity)
  const outcome2 = resolveIncomingRaceEffect(runtime1, 'ROCKET', 430, 60)
  assert.equal(outcome2, 'IMMUNE', 'Second rocket during post-hit immunity returns IMMUNE')

  // 5. Third Rocket arrives at tick 550 (after slow and immunity expired)
  const outcome3 = resolveIncomingRaceEffect(runtime1, 'ROCKET', 550, 60)
  assert.equal(outcome3, 'HIT', 'Third rocket after immunity properly hits')
  applyItemSlow(runtime1, ITEM_BALANCE.rocket.slowMultiplier, ITEM_BALANCE.rocket.slowDurationSeconds, 550, 60)
  assert.equal(itemSpeedMultiplier(runtime1, 550), ITEM_BALANCE.rocket.slowMultiplier)
})

test('full item race finishes in target window with readable bounded event volume', () => {
  const players = Array.from({ length: 8 }, (_, index) => ({ playerId: String(index + 1), name: `Duck ${index + 1}` }))
  const presets: RaceItemId[][] = [
    ['NITRO', 'DRAFT_FIN'],
    ['BUBBLE_SHIELD', 'FEATHER'],
    ['HOMING_ROCKET', 'BANANA'],
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
  assert.ok(types.has('DRAFT_FIN_STARTED') || types.has('PADDLE_BURST_STARTED'))
  assert.ok(result.events.length < 1200, `event count ${result.events.length}`)
})

test('headless telemetry observes item events without retaining the official event stream', () => {
  const raceConfig = raceConfigSchema.parse({
    raceId: 'telemetry-items',
    seed: 'bc'.repeat(32),
    players: Array.from({ length: 8 }, (_, index) => ({ playerId: String(index + 1), name: `Duck ${index + 1}` })),
    loadouts: Array.from({ length: 8 }, (_, index) => ({
      playerId: String(index + 1),
      itemIds: index % 2 === 0 ? ['NITRO', 'DRAFT_FIN'] : ['HOMING_ROCKET', 'SHOCK_ABSORBER'],
      source: 'PLAYER',
    })),
    itemTuning: { nitroSpeedMultiplier: 1.1, rocketSlowMultiplier: 0.9, bananaKnockbackMultiplier: 1.1 },
  })
  const observed: RaceEventType[] = []
  const result = simulateRace(raceConfig, { recordEvents: false, onEvent: (event) => observed.push(event.type) })

  assert.deepEqual(result.events, [])
  assert.ok(observed.includes('NITRO_STARTED'))
  assert.ok(observed.includes('ROCKET_FIRED'))
  assert.ok(observed.includes('RACE_FINISHED'))
  assert.equal(createItemRaceState(raceConfig).tuning.nitroSpeedMultiplier, 1.1)
})
