import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AUTO_USE_CONFIG,
  breakActiveSpeedBoost,
  createItemRaceState,
  tryApplyPrepSpeedBoost,
  type DuckItemRuntime,
  type ItemDuckState,
} from '../packages/race-core/src'
import {
  isOffensiveAutoItem,
  offensiveCooldownBlocks,
  resolveRocketTarget,
} from '../packages/race-core/src/auto-use/evaluate'
import { buildRaceObjectiveContext } from '../packages/race-core/src/auto-use/objective'
import type { RaceConfig } from '../packages/race-protocol/src'

function runtime(items: Array<'NITRO' | 'DRAFT_FIN' | 'PADDLE_BURST'> = ['NITRO', 'DRAFT_FIN']): DuckItemRuntime {
  return {
    itemIds: items,
    usedItems: new Set(),
    loadoutCombo: null,
    bubbleAvailable: false,
    bubbleUntilTick: 0,
    silencedUntilTick: 0,
    featherAvailable: false,
    shockAbsorberAvailable: false,
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

test('speed boost queue keeps at most one entry and replaces by priority', () => {
  const emitted: Array<{ type: string; metadata: Record<string, unknown> }> = []
  const emit = (type: string, _source?: string, _target?: string, metadata: Record<string, unknown> = {}) => {
    emitted.push({ type, metadata })
  }
  const state = runtime(['NITRO', 'DRAFT_FIN', 'PADDLE_BURST'])

  tryApplyPrepSpeedBoost(state, 'duck-1', 'NITRO', 1.18, 1.5, 10, 60, emit as never)
  assert.equal(state.activeSpeedItemId, 'NITRO')

  const draftQueued = tryApplyPrepSpeedBoost(state, 'duck-1', 'DRAFT_FIN', 1.09, 1.1, 11, 60, emit as never)
  assert.equal(draftQueued, 'queued')
  assert.equal(state.queuedSpeedBoost?.itemId, 'DRAFT_FIN')

  const paddleIgnored = tryApplyPrepSpeedBoost(state, 'duck-1', 'PADDLE_BURST', 1.08, 1.3, 12, 60, emit as never)
  assert.equal(paddleIgnored, 'ignored')
  assert.equal(state.queuedSpeedBoost?.itemId, 'DRAFT_FIN')

  const nitroReplace = tryApplyPrepSpeedBoost(state, 'duck-1', 'NITRO', 1.18, 1.5, 13, 60, emit as never)
  assert.equal(nitroReplace, 'queued')
  assert.equal(state.queuedSpeedBoost?.itemId, 'NITRO')
  assert.equal(emitted.filter((event) => event.type === 'SPEED_BOOST_QUEUED').length, 2)
})

test('BOOST_BROKEN metadata distinguishes rocket and banana sources', () => {
  const emitted: Array<{ type: string; metadata: Record<string, unknown> }> = []
  const emit = (type: string, _source?: string, _target?: string, metadata: Record<string, unknown> = {}) => {
    emitted.push({ type, metadata })
  }
  const state = runtime()
  state.boostMultiplier = 1.18
  state.boostUntilTick = 100
  state.boostStartedAtTick = 40
  state.activeSpeedItemId = 'NITRO'

  breakActiveSpeedBoost(state, 70, 60, emit as never, 'attacker', 'victim', 'ROCKET')

  const bananaState = runtime()
  bananaState.boostMultiplier = 1.18
  bananaState.boostUntilTick = 100
  bananaState.boostStartedAtTick = 40
  bananaState.activeSpeedItemId = 'NITRO'
  breakActiveSpeedBoost(bananaState, 80, 60, emit as never, 'attacker-2', 'victim-2', 'BANANA')

  const breaks = emitted.filter((event) => event.type === 'BOOST_BROKEN')
  assert.equal(breaks[0]?.metadata.breakSource, 'ROCKET')
  assert.equal(breaks[1]?.metadata.breakSource, 'BANANA')
})

test('offensive cooldown blocks chained pending offensive actions', () => {
  const config: RaceConfig = {
    raceId: 'cooldown-test',
    seed: 'aa'.repeat(32),
    protocolVersion: '1.0.0',
    engineVersion: '1.2.0',
    balanceVersion: 'S3.11',
    trackVersion: 'river-01-v2',
    tickRate: 60,
    players: [{ playerId: 'duck-1', name: 'Duck 1' }, { playerId: 'duck-2', name: 'Duck 2' }],
    loadouts: [],
  }
  const itemState = createItemRaceState(config)
  const runtime = itemState.byPlayer.get('duck-1')!
  runtime.lastOffensiveUseTick = 100
  const ctx = {
    tick: 110,
    tickRate: 60,
    objective: buildRaceObjectiveContext(config),
    itemState,
    pickupState: { hazards: [] } as never,
    ducks: [] as ItemDuckState[],
    playerId: 'duck-1',
    secondsUntilNextPickupZone: 999,
    ghostPlayerIds: new Set<string>(),
    prepAutoUseEnabled: true,
    wildAutoUseEnabled: true,
  }
  assert.equal(isOffensiveAutoItem('BANANA'), true)
  assert.equal(offensiveCooldownBlocks(ctx, 'duck-1'), true)
  assert.equal(offensiveCooldownBlocks({ ...ctx, tick: 122 }, 'duck-1'), false)
})

test('rocket target revalidation prefers still-valid target at execute time', () => {
  const config: RaceConfig = {
    raceId: 'rocket-target',
    seed: 'bb'.repeat(32),
    protocolVersion: '1.0.0',
    engineVersion: '1.2.0',
    balanceVersion: 'S3.11',
    trackVersion: 'river-01-v2',
    tickRate: 60,
    players: [{ playerId: 'duck-1', name: 'A' }, { playerId: 'duck-2', name: 'B' }, { playerId: 'duck-3', name: 'C' }],
    loadouts: [],
  }
  const itemState = createItemRaceState(config)
  const ducks: ItemDuckState[] = [
    { playerId: 'duck-1', progress: 0.5, lateralOffset: 0, lateralVelocity: 0, currentRank: 2, finished: false },
    { playerId: 'duck-2', progress: 0.48, lateralOffset: 0, lateralVelocity: 0, currentRank: 3, finished: false },
    { playerId: 'duck-3', progress: 0.55, lateralOffset: 0, lateralVelocity: 0, currentRank: 1, finished: false },
  ]
  const ctx = {
    tick: 1000,
    tickRate: 60,
    objective: buildRaceObjectiveContext(config),
    itemState,
    pickupState: { hazards: [] } as never,
    ducks,
    playerId: 'duck-1',
    secondsUntilNextPickupZone: 999,
    ghostPlayerIds: new Set<string>(),
    prepAutoUseEnabled: true,
    wildAutoUseEnabled: false,
  }
  assert.equal(resolveRocketTarget(ctx, 'PREP', 'duck-3'), 'duck-3')
  ducks[2]!.finished = true
  assert.equal(resolveRocketTarget(ctx, 'PREP', 'duck-3'), null)
})

test('reactive defense requires minimum visibility window', () => {
  assert.equal(Math.round(AUTO_USE_CONFIG.reactiveThreatMinVisibleSeconds * 60), 9)
})

test('Feather carries zero penalty for Rocket AI targeting', () => {
  const config: RaceConfig = {
    raceId: 'feather-rocket-test',
    seed: 'cc'.repeat(32),
    protocolVersion: '1.0.0',
    engineVersion: '1.2.0',
    balanceVersion: 'S3.11',
    trackVersion: 'river-01-v2',
    tickRate: 60,
    players: [{ playerId: 'duck-1', name: 'A' }, { playerId: 'duck-2', name: 'B' }],
    loadouts: [],
  }
  const itemState = createItemRaceState(config)
  const ducks: ItemDuckState[] = [
    { playerId: 'duck-1', progress: 0.5, lateralOffset: 0, lateralVelocity: 0, currentRank: 2, finished: false },
    { playerId: 'duck-2', progress: 0.55, lateralOffset: 0, lateralVelocity: 0, currentRank: 1, finished: false },
  ]
  const ctx = {
    tick: 1000,
    tickRate: 60,
    objective: buildRaceObjectiveContext(config),
    itemState,
    pickupState: { hazards: [] } as never,
    ducks,
    playerId: 'duck-1',
    secondsUntilNextPickupZone: 999,
    ghostPlayerIds: new Set<string>(),
    prepAutoUseEnabled: true,
    wildAutoUseEnabled: false,
  }

  const targetWithoutFeather = resolveRocketTarget(ctx, 'PREP')
  assert.equal(targetWithoutFeather, 'duck-2')

  // Give duck-2 a feather
  itemState.byPlayer.get('duck-2')!.featherAvailable = true
  const targetWithFeather = resolveRocketTarget(ctx, 'PREP')
  assert.equal(targetWithFeather, 'duck-2')
})

test('Mini Rocket applies 50% partial boost duration break', () => {
  const state: DuckItemRuntime = {
    ...runtime(['NITRO']),
    boostMultiplier: 1.25,
    boostUntilTick: 160,
    boostStartedAtTick: 60,
    activeSpeedItemId: 'NITRO',
  }
  const emitted: Array<{ type: string; metadata: Record<string, unknown> }> = []
  const emit = (type: string, _source?: string, _target?: string, metadata: Record<string, unknown> = {}) => {
    emitted.push({ type, metadata })
  }

  // At tick 100, remaining boost ticks = 160 - 100 = 60 ticks (1.0 second)
  breakActiveSpeedBoost(state, 100, 60, emit as never, 'attacker', 'victim', 'MINI_ROCKET')

  // Should have lost 50% = 30 ticks -> new boostUntilTick = 160 - 30 = 130
  assert.equal(state.boostUntilTick, 130)
  assert.equal(state.boostMultiplier, 1.25, 'Boost multiplier remains active after partial interrupt')
  const brokenEvent = emitted.find((e) => e.type === 'BOOST_BROKEN')
  assert.ok(brokenEvent)
  assert.equal(brokenEvent.metadata.breakSource, 'MINI_ROCKET')
  assert.equal(brokenEvent.metadata.partial, true)
})

test('Reverse mode applies negative utility to Top 2 targets for Rocket', () => {
  const normalConfig: RaceConfig = {
    raceId: 'normal-rocket',
    seed: 'dd'.repeat(32),
    protocolVersion: '1.0.0',
    engineVersion: '1.2.0',
    balanceVersion: 'S3.11',
    trackVersion: 'river-01-v2',
    tickRate: 60,
    players: [{ playerId: 'duck-1', name: 'A' }, { playerId: 'duck-2', name: 'B' }],
    loadouts: [],
    chaosConfig: { type: 'NORMAL', groups: [] },
  }
  const reverseConfig: RaceConfig = {
    ...normalConfig,
    raceId: 'reverse-rocket',
    chaosConfig: { type: 'REVERSE', groups: [] },
  }

  const normalObj = buildRaceObjectiveContext(normalConfig)
  const reverseObj = buildRaceObjectiveContext(reverseConfig)

  // Target rank 1
  assert.ok(normalObj.offensiveTargetRankBonus('duck-1', 1) > 0)
  assert.ok(reverseObj.offensiveTargetRankBonus('duck-1', 1) < 0)
})

test('Rocket AI rejects targets projected to cross finish line before impact', () => {
  const config: RaceConfig = {
    raceId: 'finish-line-test',
    seed: 'ee'.repeat(32),
    protocolVersion: '1.0.0',
    engineVersion: '1.2.0',
    balanceVersion: 'S3.11',
    trackVersion: 'river-01-v2',
    tickRate: 60,
    players: [{ playerId: 'duck-1', name: 'A' }, { playerId: 'duck-2', name: 'B' }],
    loadouts: [],
  }
  const itemState = createItemRaceState(config)
  // Target is at progress 0.99 with boost (will cross finish line in 0.1s while rocket takes 0.5s)
  const ducks: ItemDuckState[] = [
    { playerId: 'duck-1', progress: 0.88, lateralOffset: 0, lateralVelocity: 0, currentRank: 2, finished: false },
    { playerId: 'duck-2', progress: 0.99, lateralOffset: 0, lateralVelocity: 0, currentRank: 1, finished: false },
  ]
  const targetRuntime = itemState.byPlayer.get('duck-2')!
  targetRuntime.boostMultiplier = 1.3
  targetRuntime.boostUntilTick = 2000

  const ctx = {
    tick: 1000,
    tickRate: 60,
    objective: buildRaceObjectiveContext(config),
    itemState,
    pickupState: { hazards: [] } as never,
    ducks,
    playerId: 'duck-1',
    secondsUntilNextPickupZone: 999,
    ghostPlayerIds: new Set<string>(),
    prepAutoUseEnabled: true,
    wildAutoUseEnabled: false,
  }

  const target = resolveRocketTarget(ctx, 'PREP')
  assert.equal(target, null, 'Should reject target that will finish before impact')
})

