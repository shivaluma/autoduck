import assert from 'node:assert/strict'
import test from 'node:test'
import { ITEM_BALANCE, createItemRaceState, createSimulation, evaluateSmartDesiredLateralOffset, type ItemDuckState } from '../packages/race-core/src'
import { aimedBananaLateral, defaultHornSide, hornSideTargets } from '../packages/race-core/src/items/aim'
import { newBrain } from '../packages/race-core/src/auto-use/brain'
import { evaluatePrepCandidates, planBananaAim, type EvaluationContext } from '../packages/race-core/src/auto-use/evaluate'
import { executePrepAction } from '../packages/race-core/src/auto-use/execute'
import { buildRaceObjectiveContext } from '../packages/race-core/src/auto-use/objective'
import { createRaceRng } from '../packages/race-core/src/rng'
import { raceConfigSchema, type RaceItemId } from '../packages/race-protocol/src'

function setup(loadouts: Array<[string, RaceItemId[]]>) {
  const config = raceConfigSchema.parse({
    raceId: 'aim',
    seed: '55'.repeat(32),
    players: loadouts.map(([playerId]) => ({ playerId, name: playerId })),
    loadouts: loadouts.map(([playerId, itemIds]) => ({ playerId, itemIds, source: 'PLAYER' })),
  })
  const itemState = createItemRaceState(config)
  for (const [playerId] of loadouts) itemState.brains!.set(playerId, newBrain(playerId, 'AGGRESSIVE'))
  return { config, itemState, objective: buildRaceObjectiveContext(config) }
}

function duck(playerId: string, progress: number, rank: number, lateralOffset = 0, lateralVelocity = 0): ItemDuckState {
  return { playerId, progress, currentRank: rank, lateralOffset, lateralVelocity, finished: false }
}

function context(env: ReturnType<typeof setup>, ducks: ItemDuckState[], playerId: string): EvaluationContext {
  return {
    tick: 600, tickRate: 60, objective: env.objective, itemState: env.itemState, pickupState: { hazards: [] } as never, ducks, playerId,
    secondsUntilNextPickupZone: 999, prepAutoUseEnabled: true, wildAutoUseEnabled: false, ghostPlayerIds: new Set(),
  }
}

test('banana toss is limited to the aim reach and defaults to the dropper lane', () => {
  assert.equal(aimedBananaLateral(0.1, undefined, 0.22), 0.1)
  assert.equal(aimedBananaLateral(0.1, 0.25, 0.22), 0.25)
  assert.ok(Math.abs(aimedBananaLateral(0.1, 0.9, 0.22) - 0.32) < 1e-9)
  assert.equal(aimedBananaLateral(0.9, 1.5, 0.22), 0.95)
})

test('directional horn catches one side plus a narrow centre band', () => {
  const horner = duck('h', 0.5, 2, 0)
  const ducks = [horner, duck('l', 0.5, 3, -0.3), duck('r', 0.51, 1, 0.3), duck('c', 0.49, 4, 0.05), duck('far', 0.6, 5, 0.3)]
  assert.deepEqual(hornSideTargets(horner, ducks, 1, 0.055, 0.55, 0.08).map((entry) => entry.playerId).sort(), ['c', 'r'])
  assert.deepEqual(hornSideTargets(horner, ducks, -1, 0.055, 0.55, 0.08).map((entry) => entry.playerId).sort(), ['c', 'l'])
  // Default side = more ducks; ties lean toward the middle of the river.
  assert.equal(defaultHornSide(duck('h', 0.5, 2, 0.4), ducks, 0.055, 0.55, 0.08), -1)
})

test('banana aim leads the chaser’s predicted lane', () => {
  const env = setup([['me', ['NITRO', 'BANANA']], ['chaser', ['BUBBLE_SHIELD', 'DRAFT_FIN']]])
  // The chaser is close behind and drifting right.
  const ducks = [duck('me', 0.6, 1, 0), duck('chaser', 0.585, 2, 0.05, 0.25)]
  const plan = planBananaAim(context(env, ducks, 'me'), ducks[0]!, ITEM_BALANCE.banana.aimMaxOffset, ITEM_BALANCE.banana.dropBehindProgress, ITEM_BALANCE.banana.hitLateralRadius, 0.018)
  assert.ok(plan.aimLateral > 0.05, `aim ${plan.aimLateral} should lead to the right`)
  assert.equal(plan.targetId, 'chaser')
  assert.ok(plan.intersection > 50)
})

test('banana aim refuses a lane that would catch a teammate', () => {
  const env = setup([['me', ['NITRO', 'BANANA']], ['mate', ['NITRO', 'DRAFT_FIN']], ['rival', ['NITRO', 'DRAFT_FIN']]])
  env.config.chaosConfig = { type: 'DUO', targetPlayerId: null, groups: [['me', 'mate'], ['rival']] }
  const itemState = createItemRaceState(env.config)
  for (const id of ['me', 'mate', 'rival']) itemState.brains!.set(id, newBrain(id, 'AGGRESSIVE'))
  const local = { ...env, itemState, objective: buildRaceObjectiveContext(env.config) }
  const ducks = [duck('me', 0.6, 1, 0), duck('mate', 0.588, 2, -0.15), duck('rival', 0.586, 3, 0.15)]
  const plan = planBananaAim(context(local, ducks, 'me'), ducks[0]!, ITEM_BALANCE.banana.aimMaxOffset, ITEM_BALANCE.banana.dropBehindProgress, ITEM_BALANCE.banana.hitLateralRadius, 0.018)
  assert.ok(plan.aimLateral > 0, 'peel goes to the rival side')
  assert.equal(plan.targetId, 'rival')
})

test('the brain aims its horn to shove a duck onto a live peel, and the executed blast goes that way', () => {
  const env = setup([['horn', ['HOMING_ROCKET', 'QUACK_HORN']], ['left', ['BUBBLE_SHIELD', 'DRAFT_FIN']], ['right', ['BUBBLE_SHIELD', 'DRAFT_FIN']]])
  const ducks = [duck('horn', 0.5, 2, 0), duck('left', 0.505, 1, -0.3), duck('right', 0.505, 3, 0.3)]
  // A peel waits just ahead of `right`, further right of its lane.
  env.itemState.bananas.push({ id: 99, sourcePlayerId: 'someone', progress: 0.525, lateralOffset: 0.75, armedAtTick: 0, expiresAtTick: 10_000, kind: 'PREP', hitProgressRadius: 0.02, hitLateralRadius: 0.2, lateralSlip: 0.65 })
  const candidate = evaluatePrepCandidates(context(env, ducks, 'horn')).find((entry) => entry.itemId === 'QUACK_HORN')
  assert.ok(candidate)
  assert.equal(candidate.hornSide, 1)
  assert.equal(candidate.intent, 'SHOVE')
  const before = ducks[2]!.lateralOffset
  assert.equal(executePrepAction({ ...candidate, playerId: 'horn' }, env.itemState, ducks[0]!, ducks, 600, 60, () => undefined), true)
  assert.ok(ducks[2]!.lateralOffset > before, 'the right-hand duck is shoved further right')
  assert.equal(ducks[1]!.lateralOffset, -0.3, 'the left-hand duck is untouched')
})

test('lane tactics: a brain steers out of the line of a duck ahead that still holds a peel', () => {
  const config = raceConfigSchema.parse({
    raceId: 'lanes', seed: '66'.repeat(32),
    players: [{ playerId: 'a', name: 'a' }, { playerId: 'b', name: 'b' }],
    loadouts: [{ playerId: 'a', itemIds: ['NITRO', 'BANANA'], source: 'PLAYER' }, { playerId: 'b', itemIds: ['BUBBLE_SHIELD', 'FEATHER'], source: 'PLAYER' }],
  })
  const inPeelLine = (ablated: boolean) => {
    let total = 0
    for (let sample = 0; sample < 60; sample++) {
      const state = createSimulation(config, { recordEvents: false, aiAblationPlayerIds: ablated ? ['b'] : [] })
      const [ahead, chaser] = [state.ducks.find((entry) => entry.playerId === 'a')!, state.ducks.find((entry) => entry.playerId === 'b')!]
      ahead.progress = 0.5; ahead.lateralOffset = 0.3
      chaser.progress = 0.445; chaser.lateralOffset = 0
      const lane = evaluateSmartDesiredLateralOffset(state, chaser, createRaceRng(`${sample}`, 'lane-test'))
      if (Math.abs(lane - ahead.lateralOffset) <= ITEM_BALANCE.banana.hitLateralRadius) total++
    }
    return total
  }
  const brain = inPeelLine(false)
  const legacy = inPeelLine(true)
  assert.ok(brain < legacy, `brain ${brain} vs legacy ${legacy} of 60 samples in the peel line`)
})
