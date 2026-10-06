import assert from 'node:assert/strict'
import test from 'node:test'
import { createItemRaceState, simulateRace } from '../packages/race-core/src'
import { createDuckBrains, grudgeWeight, newBrain, noteBrainEvent, TEMPERAMENTS } from '../packages/race-core/src/auto-use/brain'
import { ChaosUtility } from '../packages/race-core/src/auto-use/chaos-utility'
import { holdCost, type EvaluationContext } from '../packages/race-core/src/auto-use/evaluate'
import { buildRaceObjectiveContext } from '../packages/race-core/src/auto-use/objective'
import { raceConfigSchema, type RaceConfig } from '../packages/race-protocol/src'

function config(chaos?: RaceConfig['chaosConfig'], players = 8, seed = '33'.repeat(32)) {
  return raceConfigSchema.parse({
    raceId: 'brain',
    seed,
    players: Array.from({ length: players }, (_, index) => ({ playerId: `d${index + 1}`, name: `Duck ${index + 1}` })),
    loadouts: [],
    chaosConfig: chaos,
  })
}

// d1 leads … d8 last, evenly spaced far apart so neighbour swaps are unlikely.
function spreadDucks(players = 8, gap = 0.1) {
  return Array.from({ length: players }, (_, index) => ({ playerId: `d${index + 1}`, progress: 0.9 - index * gap, currentRank: index + 1, finished: false, lateralOffset: 0, lateralVelocity: 0 }))
}

test('temperaments are seeded, deterministic and cover every type', () => {
  const first = createDuckBrains(config(undefined, 16))
  const second = createDuckBrains(config(undefined, 16))
  assert.deepEqual([...first].map(([id, brain]) => [id, brain.temperament]), [...second].map(([id, brain]) => [id, brain.temperament]))
  const other = createDuckBrains(config(undefined, 16, '44'.repeat(32)))
  assert.notDeepEqual([...first].map(([, brain]) => brain.temperament), [...other].map(([, brain]) => brain.temperament))
  const seen = new Set<string>()
  for (let seed = 0; seed < 20; seed++) for (const brain of createDuckBrains(config(undefined, 8, seed.toString(16).padStart(64, '0'))).values()) seen.add(brain.temperament)
  assert.deepEqual([...seen].sort(), [...TEMPERAMENTS].sort())
})

test('Chaos utility: NORMAL loss risk follows the bottom two', () => {
  const utility = new ChaosUtility(config())
  const ducks = spreadDucks()
  assert.ok(utility.lossRisk('d8', ducks) > 0.95)
  assert.ok(utility.lossRisk('d1', ducks) < 0.05)
  assert.equal(utility.isLosingNow('d7', ducks), true)
  // Climbing two places from 7th escapes the loser set.
  assert.ok(utility.actionValue('d7', ducks, 2) > 80)
})

test('Chaos utility: CUT_LINE cares about the half-way line', () => {
  const utility = new ChaosUtility(config({ type: 'CUT_LINE', targetPlayerId: null }))
  const ducks = spreadDucks()
  assert.equal(utility.isLosingNow('d5', ducks), true)
  assert.equal(utility.isLosingNow('d4', ducks), false)
  // Knocking d4 below d5 saves d5.
  assert.ok(utility.actionValue('d5', ducks, 0, 'd4', 1) > 80)
})

test('Chaos utility: BOUNTY_HUNT values hits on the Wanted duck by where it lands', () => {
  // Wanted = d4 in 4th of 8: inside the top half, so it is escaping and the bottom two lose.
  const utility = new ChaosUtility(config({ type: 'BOUNTY_HUNT', targetPlayerId: 'd4' }))
  const ducks = spreadDucks()
  assert.equal(utility.isLosingNow('d7', ducks), true)
  assert.equal(utility.isLosingNow('d6', ducks), false)
  // A small knock makes the Wanted fail while still ahead of d6: everyone behind the Wanted loses, d6 included.
  assert.ok(utility.actionValue('d6', ducks, 0, 'd4', 1) < -50)
  // A big knock that drops the Wanted behind d7 saves d7.
  assert.ok(utility.actionValue('d7', ducks, 0, 'd4', 3) > 50)
  // d2 is safe either way.
  assert.ok(Math.abs(utility.actionValue('d2', ducks, 0, 'd4', 1)) < 5)
})

test('Chaos utility: DUO is team-aware — knocking back your own partner hurts', () => {
  const groups = [['d1', 'd8'], ['d2', 'd7'], ['d3', 'd6'], ['d4', 'd5']]
  const utility = new ChaosUtility(config({ type: 'DUO', targetPlayerId: null, groups }))
  const ducks = spreadDucks()
  // Every pair averages 4.5 now; tie-break makes the pair with the worst member lose (d1+d8).
  assert.equal(utility.isLosingNow('d1', ducks), true)
  assert.equal(utility.isLosingNow('d8', ducks), true)
  // d1 wants d7 (from another pair) to fall behind d8, not its own partner to drop.
  assert.ok(utility.actionValue('d1', ducks, 0, 'd7', 1) > 50)
  assert.ok(utility.actionValue('d1', ducks, 0, 'd8', 0) === 0)
})

test('grudges come from hostile events and fade with a 10s half-life', () => {
  const brains = new Map([['d1', newBrain('d1', 'AGGRESSIVE')], ['d2', newBrain('d2', 'TACTICIAN')]])
  noteBrainEvent(brains, 'ROCKET_HIT', 'd2', 'd1', 600, 60)
  assert.equal(grudgeWeight(brains.get('d1'), 'd2', 600, 60), 1)
  assert.ok(Math.abs(grudgeWeight(brains.get('d1'), 'd2', 1200, 60) - 0.5) < 1e-9)
  // Silence is emitted victim → attacker.
  noteBrainEvent(brains, 'ITEM_SILENCED', 'd2', 'd1', 600, 60)
  assert.equal(grudgeWeight(brains.get('d2'), 'd1', 600, 60), 0.5)
  // Neutral events leave no grudge.
  noteBrainEvent(brains, 'DUCK_COLLISION', 'd1', 'd2', 600, 60)
  assert.equal(grudgeWeight(brains.get('d2'), 'd1', 600, 60), 0.5)
})

test('patient temperaments hold Nitro for their window; danger erases patience', () => {
  const cfg = config()
  const itemState = createItemRaceState(cfg)
  const objective = buildRaceObjectiveContext(cfg)
  const ducks = spreadDucks(8, 0.01).map((duck) => ({ ...duck, progress: duck.progress - 0.5 }))
  const ctx = (playerId: string): EvaluationContext => ({
    tick: 100, tickRate: 60, objective, itemState, pickupState: { hazards: [] } as never, ducks, playerId,
    secondsUntilNextPickupZone: 999, prepAutoUseEnabled: true, wildAutoUseEnabled: false, ghostPlayerIds: new Set(),
  })
  itemState.brains!.set('d1', newBrain('d1', 'TACTICIAN'))
  itemState.brains!.set('d2', newBrain('d2', 'AGGRESSIVE'))
  itemState.brains!.set('d8', newBrain('d8', 'TACTICIAN'))
  const nitro = { itemId: 'NITRO', source: 'PREP' } as const
  assert.ok(holdCost(ctx('d1'), nitro) > 10, 'a leading Tactician saves Nitro at 40%')
  assert.equal(holdCost(ctx('d2'), nitro), 0, 'an Aggressive duck is already in its window')
  assert.ok(holdCost(ctx('d8'), nitro) < holdCost(ctx('d1'), nitro), 'a duck in the loser set is less patient')
  assert.equal(holdCost(ctx('d1'), { itemId: 'MINI_NITRO', source: 'WILD' }), 0, 'box items are never held')
})

test('races announce temperaments and intents', () => {
  const cfg = config()
  cfg.loadouts = cfg.players.map((player, index) => ({
    playerId: player.playerId,
    itemIds: index % 3 === 0 ? ['NITRO', 'BANANA'] : index % 3 === 1 ? ['HOMING_ROCKET', 'QUACK_HORN'] : ['BUBBLE_SHIELD', 'DRAFT_FIN'],
    source: 'PLAYER' as const,
  }))
  const events = simulateRace(cfg).events
  const temperaments = events.filter((event) => event.type === 'DUCK_TEMPERAMENT')
  assert.equal(temperaments.length, cfg.players.length)
  const brains = createDuckBrains(cfg)
  for (const event of temperaments) assert.equal(event.metadata.temperament, brains.get(event.sourcePlayerId!)!.temperament)
  const intents = events.filter((event) => event.type === 'AI_INTENT')
  assert.ok(intents.length > 0)
  for (const intent of intents) assert.ok(typeof intent.metadata.intent === 'string' && typeof intent.metadata.temperament === 'string')
})
