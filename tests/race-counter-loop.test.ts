import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ITEM_BALANCE,
  createItemRaceState,
  firePrepRocket,
  itemSpeedMultiplier,
  tickItemSystem,
  tryActivateBubbleShield,
  tryApplyPrepSpeedBoost,
  type ItemDuckState,
} from '../packages/race-core/src'
import { executePrepAction } from '../packages/race-core/src/auto-use/execute'
import { raceConfigSchema, type RaceItemId } from '../packages/race-protocol/src'

type Emitted = { type: string; source?: string; target?: string; metadata: Record<string, unknown> }

function setup(loadouts: Array<[string, RaceItemId[]]>) {
  const config = raceConfigSchema.parse({
    raceId: 'counter-loop',
    seed: '22'.repeat(32),
    players: loadouts.map(([playerId]) => ({ playerId, name: playerId })),
    loadouts: loadouts.map(([playerId, itemIds]) => ({ playerId, itemIds, source: 'PLAYER' })),
  })
  const events: Emitted[] = []
  const emit = (type: string, source?: string, target?: string, metadata: Record<string, unknown> = {}) => { events.push({ type, source, target, metadata }) }
  return { config, state: createItemRaceState(config), events, emit }
}

function duck(playerId: string, progress: number, rank: number, lateralOffset = 0): ItemDuckState {
  return { playerId, progress, currentRank: rank, lateralOffset, lateralVelocity: 0, finished: false }
}

function flyRocket(state: ReturnType<typeof setup>['state'], ducks: ItemDuckState[], emit: ReturnType<typeof setup>['emit'], events: Emitted[], fromTick: number) {
  for (let tick = fromTick; tick < fromTick + 240; tick++) {
    tickItemSystem(state, ducks, tick, 60, emit as never)
    if (events.some((event) => event.type === 'ROCKET_HIT' || event.type === 'ROCKET_BLOCKED')) return tick
  }
  throw new Error('rocket never resolved')
}

test('ATTACK > SPEED: a rocket on a Nitro holder steals momentum and drains the unspent Nitro', () => {
  const { state, events, emit } = setup([['atk', ['HOMING_ROCKET', 'FEATHER']], ['spd', ['NITRO', 'PADDLE_BURST']]])
  const ducks = [duck('atk', 0.40, 2), duck('spd', 0.44, 1)]
  assert.equal(firePrepRocket(state, ducks[0]!, 'spd', 100, 60, emit as never), true)
  const hitTick = flyRocket(state, ducks, emit, events, 101)

  const steal = events.find((event) => event.type === 'MOMENTUM_STOLEN')
  assert.ok(steal, 'attacker should steal momentum')
  assert.equal(steal.source, 'atk')
  assert.equal(steal.metadata.stolenItemId, 'NITRO')
  const attacker = state.byPlayer.get('atk')!
  assert.equal(itemSpeedMultiplier(attacker, hitTick + 1), ITEM_BALANCE.counter.momentumStealMultiplier)

  const victim = state.byPlayer.get('spd')!
  assert.equal(victim.speedDrained, true)
  tryApplyPrepSpeedBoost(victim, 'spd', 'NITRO', 1.25, ITEM_BALANCE.nitro.durationSeconds, 400, 60, emit as never)
  assert.equal(victim.boostUntilTick - 400, Math.round(ITEM_BALANCE.nitro.durationSeconds * ITEM_BALANCE.counter.speedDrainDurationRatio * 60))
})

test('ATTACK vs non-speed duck: a clean hit gives no momentum', () => {
  const { state, events, emit } = setup([['atk', ['HOMING_ROCKET', 'FEATHER']], ['def', ['BUBBLE_SHIELD', 'DRAFT_FIN']]])
  state.byPlayer.get('def')!.usedItems.add('BUBBLE_SHIELD')
  const ducks = [duck('atk', 0.40, 2), duck('def', 0.44, 1)]
  firePrepRocket(state, ducks[0]!, 'def', 100, 60, emit as never)
  flyRocket(state, ducks, emit, events, 101)
  assert.ok(events.some((event) => event.type === 'ROCKET_HIT'))
  assert.equal(events.some((event) => event.type === 'MOMENTUM_STOLEN'), false)
})

test('DEFENSE > ATTACK: a packed Bubble snaps up on the rocket and turns it into a guard surge', () => {
  const { state, events, emit } = setup([['atk', ['HOMING_ROCKET', 'BANANA']], ['def', ['BUBBLE_SHIELD', 'FEATHER']]])
  const ducks = [duck('atk', 0.40, 2), duck('def', 0.44, 1)]
  firePrepRocket(state, ducks[0]!, 'def', 100, 60, emit as never)
  const tick = flyRocket(state, ducks, emit, events, 101)
  assert.ok(events.some((event) => event.type === 'BUBBLE_SHIELD_ACTIVATED' && event.metadata.reflex === 'ROCKET'))
  assert.ok(events.some((event) => event.type === 'ROCKET_BLOCKED'))
  assert.equal(events.some((event) => event.type === 'PREDATOR_RUSH_STARTED'), false, 'blocked hits give MENACE nothing')
  const surge = events.find((event) => event.type === 'GUARD_SURGE')
  assert.equal(surge?.metadata.defenseItemId, 'BUBBLE_SHIELD')
  assert.equal(itemSpeedMultiplier(state.byPlayer.get('def')!, tick + 1), ITEM_BALANCE.counter.guardSurge.BUBBLE_SHIELD.multiplier)
})

test('A silenced duck cannot reflex its Bubble', () => {
  const { state, events, emit } = setup([['atk', ['HOMING_ROCKET', 'BANANA']], ['def', ['BUBBLE_SHIELD', 'FEATHER']]])
  state.byPlayer.get('def')!.silencedUntilTick = 10_000
  const ducks = [duck('atk', 0.40, 2), duck('def', 0.44, 1)]
  firePrepRocket(state, ducks[0]!, 'def', 100, 60, emit as never)
  flyRocket(state, ducks, emit, events, 101)
  assert.ok(events.some((event) => event.type === 'ROCKET_HIT'))
})

test('DEFENSE > ATTACK: raised Bubble ignores the horn, Feather hops it, and both surge', () => {
  const { state, events, emit } = setup([['horn', ['NITRO', 'QUACK_HORN']], ['bub', ['BUBBLE_SHIELD', 'DRAFT_FIN']], ['fea', ['HOMING_ROCKET', 'FEATHER']]])
  tryActivateBubbleShield(state.byPlayer.get('bub')!, 'bub', 90, 60, emit as never)
  // Both defenders on the same side: the horn blasts one side only.
  const ducks = [duck('horn', 0.5, 1, 0), duck('bub', 0.5, 2, 0.2), duck('fea', 0.5, 3, 0.4)]
  const used = executePrepAction({ playerId: 'horn', itemKey: 'prep:QUACK_HORN', itemId: 'QUACK_HORN', source: 'PREP', action: 'USE', score: 100, reason: 'OPPORTUNITY' }, state, ducks[0]!, ducks, 100, 60, emit as never)
  assert.equal(used, true)
  assert.equal(ducks[1]!.lateralVelocity, 0)
  assert.equal(ducks[2]!.lateralVelocity, 0)
  assert.equal(events.some((event) => event.type === 'ITEM_SILENCED'), false)
  assert.equal(state.byPlayer.get('bub')!.bubbleAvailable, true, 'the horn does not pop the bubble')
  assert.equal(state.byPlayer.get('fea')!.featherAvailable, false)
  assert.deepEqual(events.filter((event) => event.type === 'GUARD_SURGE').map((event) => event.source).sort(), ['bub', 'fea'])
})

test('ATTACK > SPEED: the prep horn breaks Nitro and steals once per blast', () => {
  const { state, events, emit } = setup([['horn', ['HOMING_ROCKET', 'QUACK_HORN']], ['s1', ['NITRO', 'DRAFT_FIN']], ['s2', ['NITRO', 'PADDLE_BURST']]])
  tryApplyPrepSpeedBoost(state.byPlayer.get('s1')!, 's1', 'NITRO', 1.25, 1.7, 95, 60, emit as never)
  const ducks = [duck('horn', 0.5, 3, 0), duck('s1', 0.51, 1, 0.2), duck('s2', 0.505, 2, -0.2)]
  executePrepAction({ playerId: 'horn', itemKey: 'prep:QUACK_HORN', itemId: 'QUACK_HORN', source: 'PREP', action: 'USE', score: 100, reason: 'OPPORTUNITY' }, state, ducks[0]!, ducks, 100, 60, emit as never)
  assert.equal(state.byPlayer.get('s1')!.activeSpeedItemId, null)
  const steals = events.filter((event) => event.type === 'MOMENTUM_STOLEN')
  assert.equal(steals.length, 1)
  assert.equal(steals[0]!.metadata.durationSeconds, ITEM_BALANCE.counter.hornMomentumStealSeconds)
})

test('Shock Absorber softens a rocket but a packed Nitro is still stolen', () => {
  const { state, events, emit } = setup([['atk', ['HOMING_ROCKET', 'BANANA']], ['spd', ['NITRO', 'SHOCK_ABSORBER']]])
  const ducks = [duck('atk', 0.40, 2), duck('spd', 0.44, 1)]
  firePrepRocket(state, ducks[0]!, 'spd', 100, 60, emit as never)
  const tick = flyRocket(state, ducks, emit, events, 101)
  assert.ok(events.some((event) => event.type === 'SHOCK_ABSORBER_PROC'))
  assert.ok(events.some((event) => event.type === 'MOMENTUM_STOLEN'))
  assert.equal(events.some((event) => event.type === 'PREDATOR_RUSH_STARTED'), false)
  assert.equal(state.byPlayer.get('spd')!.slowMultiplier, ITEM_BALANCE.shockAbsorber.staggerMultiplier)
  // The guard surge waits until the absorbed stagger has played out.
  const victim = state.byPlayer.get('spd')!
  const surgeTick = victim.queuedGuardSurgeTick!
  assert.equal(surgeTick, victim.recoverySlowUntilTick)
  for (let t = tick + 1; t <= surgeTick; t++) tickItemSystem(state, ducks, t, 60, emit as never)
  assert.ok(events.some((event) => event.type === 'GUARD_SURGE' && event.metadata.defenseItemId === 'SHOCK_ABSORBER'))
})
