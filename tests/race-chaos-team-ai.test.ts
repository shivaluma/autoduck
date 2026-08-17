import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createItemRaceState,
  createPickupRaceState,
  createRiverTrack,
  stepSimulation,
  tickAutoUseAI,
  type ItemDuckState,
} from '../packages/race-core/src'
import {
  evaluatePrepCandidates,
  evaluateWildCandidates,
  resolveRocketTarget,
  decideOffensiveAutoItemAction,
} from '../packages/race-core/src/auto-use/evaluate'
import { buildRaceObjectiveContext } from '../packages/race-core/src/auto-use/objective'
import type { RaceConfig } from '../packages/race-protocol/src'

function createTeamRaceConfig(groups: string[][], overrides: Partial<RaceConfig> = {}): RaceConfig {
  const allPlayers = groups.flat().map((id, index) => ({
    playerId: id,
    name: `Player ${id}`,
  }))

  return {
    raceId: 'test-team-race',
    seed: 'cc'.repeat(32),
    protocolVersion: '1.0.0',
    engineVersion: '1.2.0',
    balanceVersion: 'S3.11',
    trackVersion: 'river-01-v2',
    tickRate: 60,
    players: allPlayers,
    loadouts: allPlayers.map((p) => ({ playerId: p.playerId, itemIds: ['HOMING_ROCKET', 'QUACK_HORN'], source: 'PLAYER' })),
    chaosConfig: {
      type: 'DUO',
      groups,
    },
    pickupConfig: {
      enabled: true,
      goldenBoxEnabled: false,
      goldenBoxProbability: 0,
      hazardsEnabled: false,
      positionAwareLoot: false,
      spawnMultiplier: 1,
      regularPickupCap: 3,
      manualItemsEnabled: false,
      autoItemsEnabled: true,
      chaosBoxEnabled: false,
      forceGoldenBox: false,
      disabledItems: [],
      idealManualPlayerIds: [],
    },
    ...overrides,
  }
}

test('Homing Rocket AI skips teammate ahead and locks onto enemy ahead', () => {
  // Duo: Team 1 is [duck-1, duck-2], Team 2 is [duck-3, duck-4]
  const config = createTeamRaceConfig([['duck-1', 'duck-2'], ['duck-3', 'duck-4']])
  const itemState = createItemRaceState(config)
  const ducks: ItemDuckState[] = [
    { playerId: 'duck-1', progress: 0.40, lateralOffset: 0, lateralVelocity: 0, currentRank: 3, finished: false },
    { playerId: 'duck-2', progress: 0.45, lateralOffset: 0, lateralVelocity: 0, currentRank: 2, finished: false }, // teammate ahead
    { playerId: 'duck-3', progress: 0.50, lateralOffset: 0, lateralVelocity: 0, currentRank: 1, finished: false }, // enemy ahead
    { playerId: 'duck-4', progress: 0.35, lateralOffset: 0, lateralVelocity: 0, currentRank: 4, finished: false },
  ]
  const objective = buildRaceObjectiveContext(config)
  const ctx = {
    tick: 500,
    tickRate: 60,
    objective,
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
  assert.equal(target, 'duck-3', 'Homing Rocket should target enemy duck-3, skipping allied duck-2')

  const candidates = evaluatePrepCandidates(ctx)
  const rocketCand = candidates.find((c) => c.itemId === 'HOMING_ROCKET')
  assert.ok(rocketCand, 'Should create rocket candidate')
  assert.equal(rocketCand.targetPlayerId, 'duck-3', 'Candidate target must be duck-3')
})

test('Homing Rocket AI does not fire if all ducks ahead are teammates', () => {
  // Constructors: Team A is [duck-1, duck-2, duck-3], Team B is [duck-4, duck-5]
  const config = createTeamRaceConfig([['duck-1', 'duck-2', 'duck-3'], ['duck-4', 'duck-5']], {
    chaosConfig: { type: 'CONSTRUCTORS', groups: [['duck-1', 'duck-2', 'duck-3'], ['duck-4', 'duck-5']] },
  })
  const itemState = createItemRaceState(config)
  const ducks: ItemDuckState[] = [
    { playerId: 'duck-1', progress: 0.40, lateralOffset: 0, lateralVelocity: 0, currentRank: 3, finished: false },
    { playerId: 'duck-2', progress: 0.50, lateralOffset: 0, lateralVelocity: 0, currentRank: 1, finished: false }, // teammate
    { playerId: 'duck-3', progress: 0.46, lateralOffset: 0, lateralVelocity: 0, currentRank: 2, finished: false }, // teammate
    { playerId: 'duck-4', progress: 0.30, lateralOffset: 0, lateralVelocity: 0, currentRank: 4, finished: false }, // enemy behind
    { playerId: 'duck-5', progress: 0.25, lateralOffset: 0, lateralVelocity: 0, currentRank: 5, finished: false }, // enemy behind
  ]
  const objective = buildRaceObjectiveContext(config)
  const ctx = {
    tick: 500,
    tickRate: 60,
    objective,
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
  assert.equal(target, null, 'No valid enemy target ahead')

  const candidates = evaluatePrepCandidates(ctx)
  const rocketCand = candidates.find((c) => c.itemId === 'HOMING_ROCKET')
  assert.equal(rocketCand, undefined, 'Must not fire rocket when only allies are ahead')
})

test('Wild Mini Rocket skips teammate and discards under pressure if only allies ahead', () => {
  const config = createTeamRaceConfig([['duck-1', 'duck-2'], ['duck-3', 'duck-4']])
  const itemState = createItemRaceState(config)
  const runtime1 = itemState.byPlayer.get('duck-1')!
  runtime1.wildItem = { instanceId: 'wild-mini-rocket-1', itemId: 'MINI_ROCKET', acquiredAtTick: 100 }

  const ducks: ItemDuckState[] = [
    { playerId: 'duck-1', progress: 0.85, lateralOffset: 0, lateralVelocity: 0, currentRank: 2, finished: false },
    { playerId: 'duck-2', progress: 0.90, lateralOffset: 0, lateralVelocity: 0, currentRank: 1, finished: false }, // teammate ahead
    { playerId: 'duck-3', progress: 0.40, lateralOffset: 0, lateralVelocity: 0, currentRank: 3, finished: false },
    { playerId: 'duck-4', progress: 0.35, lateralOffset: 0, lateralVelocity: 0, currentRank: 4, finished: false },
  ]
  const objective = buildRaceObjectiveContext(config)
  const ctx = {
    tick: 1000,
    tickRate: 60,
    objective,
    itemState,
    pickupState: { hazards: [] } as never,
    ducks,
    playerId: 'duck-1',
    secondsUntilNextPickupZone: 1.5,
    ghostPlayerIds: new Set<string>(),
    prepAutoUseEnabled: false,
    wildAutoUseEnabled: true,
  }

  const candidates = evaluateWildCandidates(ctx)
  const rocketUse = candidates.find((c) => c.itemId === 'MINI_ROCKET' && c.action === 'USE')
  assert.equal(rocketUse, undefined, 'Must not use Mini Rocket on teammate ahead')

  const rocketDiscard = candidates.find((c) => c.itemId === 'MINI_ROCKET' && c.action === 'DISCARD')
  assert.ok(rocketDiscard, 'Must discard Mini Rocket when forced to burn in endgame with no enemies ahead')
})

test('Banana AI does not drop trap when teammate is directly behind in drop zone', () => {
  const config = createTeamRaceConfig([['duck-1', 'duck-2'], ['duck-3', 'duck-4']], {
    loadouts: [
      { playerId: 'duck-1', itemIds: ['HOMING_ROCKET', 'BANANA'], source: 'PLAYER' },
      { playerId: 'duck-2', itemIds: ['NITRO', 'DRAFT_FIN'], source: 'PLAYER' },
      { playerId: 'duck-3', itemIds: ['NITRO', 'DRAFT_FIN'], source: 'PLAYER' },
      { playerId: 'duck-4', itemIds: ['NITRO', 'DRAFT_FIN'], source: 'PLAYER' },
    ],
  })
  const itemState = createItemRaceState(config)
  // duck-2 (teammate) is right behind duck-1 in lane (progress 0.48 vs 0.50, lateral 0)
  const ducks: ItemDuckState[] = [
    { playerId: 'duck-1', progress: 0.50, lateralOffset: 0.0, lateralVelocity: 0, currentRank: 1, finished: false },
    { playerId: 'duck-2', progress: 0.48, lateralOffset: 0.0, lateralVelocity: 0, currentRank: 2, finished: false }, // teammate directly behind
    { playerId: 'duck-3', progress: 0.30, lateralOffset: 0.5, lateralVelocity: 0, currentRank: 3, finished: false },
    { playerId: 'duck-4', progress: 0.25, lateralOffset: -0.5, lateralVelocity: 0, currentRank: 4, finished: false },
  ]
  const objective = buildRaceObjectiveContext(config)
  const ctx = {
    tick: 500,
    tickRate: 60,
    objective,
    itemState,
    pickupState: { hazards: [] } as never,
    ducks,
    playerId: 'duck-1',
    secondsUntilNextPickupZone: 999,
    ghostPlayerIds: new Set<string>(),
    prepAutoUseEnabled: true,
    wildAutoUseEnabled: false,
  }

  const candidates = evaluatePrepCandidates(ctx)
  const bananaCand = candidates.find((c) => c.itemId === 'BANANA')
  assert.equal(bananaCand, undefined, 'Must not drop banana when teammate is directly behind')
})

test('Banana AI drops trap when enemy is behind and teammate is in different lane or ahead', () => {
  const config = createTeamRaceConfig([['duck-1', 'duck-2'], ['duck-3', 'duck-4']], {
    loadouts: [
      { playerId: 'duck-1', itemIds: ['HOMING_ROCKET', 'BANANA'], source: 'PLAYER' },
      { playerId: 'duck-2', itemIds: ['NITRO', 'DRAFT_FIN'], source: 'PLAYER' },
      { playerId: 'duck-3', itemIds: ['NITRO', 'DRAFT_FIN'], source: 'PLAYER' },
      { playerId: 'duck-4', itemIds: ['NITRO', 'DRAFT_FIN'], source: 'PLAYER' },
    ],
  })
  const itemState = createItemRaceState(config)
  // duck-2 (teammate) is ahead (0.55), duck-3 (enemy) is behind in same lane (0.47)
  const ducks: ItemDuckState[] = [
    { playerId: 'duck-1', progress: 0.50, lateralOffset: 0.0, lateralVelocity: 0, currentRank: 2, finished: false },
    { playerId: 'duck-2', progress: 0.55, lateralOffset: 0.0, lateralVelocity: 0, currentRank: 1, finished: false }, // teammate ahead
    { playerId: 'duck-3', progress: 0.47, lateralOffset: 0.0, lateralVelocity: 0, currentRank: 3, finished: false }, // enemy behind
    { playerId: 'duck-4', progress: 0.25, lateralOffset: -0.5, lateralVelocity: 0, currentRank: 4, finished: false },
  ]
  const objective = buildRaceObjectiveContext(config)
  const ctx = {
    tick: 500,
    tickRate: 60,
    objective,
    itemState,
    pickupState: { hazards: [] } as never,
    ducks,
    playerId: 'duck-1',
    secondsUntilNextPickupZone: 999,
    ghostPlayerIds: new Set<string>(),
    prepAutoUseEnabled: true,
    wildAutoUseEnabled: false,
  }

  const candidates = evaluatePrepCandidates(ctx)
  const bananaCand = candidates.find((c) => c.itemId === 'BANANA')
  assert.ok(bananaCand, 'Should drop banana to hit chasing enemy duck-3 when teammate is safe ahead')
})

test('Quack Horn AI does not activate when teammate is in blast radius even if boosting enemy is also nearby', () => {
  const config = createTeamRaceConfig([['duck-1', 'duck-2'], ['duck-3', 'duck-4']], {
    loadouts: [
      { playerId: 'duck-1', itemIds: ['HOMING_ROCKET', 'QUACK_HORN'], source: 'PLAYER' },
      { playerId: 'duck-2', itemIds: ['NITRO', 'DRAFT_FIN'], source: 'PLAYER' },
      { playerId: 'duck-3', itemIds: ['NITRO', 'DRAFT_FIN'], source: 'PLAYER' },
      { playerId: 'duck-4', itemIds: ['NITRO', 'DRAFT_FIN'], source: 'PLAYER' },
    ],
  })
  const itemState = createItemRaceState(config)
  // duck-1 has Quack Horn. duck-2 (teammate) is right next to duck-1 (progress 0.51, lateral 0.1).
  // duck-3 (enemy) is also in blast radius with active boost.
  const runtime3 = itemState.byPlayer.get('duck-3')!
  runtime3.boostMultiplier = 1.25
  runtime3.boostUntilTick = 600

  const ducks: ItemDuckState[] = [
    { playerId: 'duck-1', progress: 0.50, lateralOffset: 0.0, lateralVelocity: 0, currentRank: 3, finished: false },
    { playerId: 'duck-2', progress: 0.51, lateralOffset: 0.1, lateralVelocity: 0, currentRank: 2, finished: false }, // teammate in blast radius!
    { playerId: 'duck-3', progress: 0.52, lateralOffset: -0.1, lateralVelocity: 0, currentRank: 1, finished: false }, // enemy in blast radius
    { playerId: 'duck-4', progress: 0.30, lateralOffset: 0.0, lateralVelocity: 0, currentRank: 4, finished: false },
  ]
  const objective = buildRaceObjectiveContext(config)
  const ctx = {
    tick: 500,
    tickRate: 60,
    objective,
    itemState,
    pickupState: { hazards: [] } as never,
    ducks,
    playerId: 'duck-1',
    secondsUntilNextPickupZone: 999,
    ghostPlayerIds: new Set<string>(),
    prepAutoUseEnabled: true,
    wildAutoUseEnabled: false,
  }

  const candidates = evaluatePrepCandidates(ctx)
  const hornCand = candidates.find((c) => c.itemId === 'QUACK_HORN')
  assert.equal(hornCand, undefined, 'Quack Horn must NOT be used when teammate is in the blast radius')
})

test('Quack Horn AI activates when only enemy is in blast radius and teammate is far away', () => {
  const config = createTeamRaceConfig([['duck-1', 'duck-2'], ['duck-3', 'duck-4']], {
    loadouts: [
      { playerId: 'duck-1', itemIds: ['HOMING_ROCKET', 'QUACK_HORN'], source: 'PLAYER' },
      { playerId: 'duck-2', itemIds: ['NITRO', 'DRAFT_FIN'], source: 'PLAYER' },
      { playerId: 'duck-3', itemIds: ['NITRO', 'DRAFT_FIN'], source: 'PLAYER' },
      { playerId: 'duck-4', itemIds: ['NITRO', 'DRAFT_FIN'], source: 'PLAYER' },
    ],
  })
  const itemState = createItemRaceState(config)
  // duck-2 (teammate) is far ahead (0.80). duck-3 (enemy) is right next to duck-1 (progress 0.52, lateral 0.1).
  const ducks: ItemDuckState[] = [
    { playerId: 'duck-1', progress: 0.50, lateralOffset: 0.0, lateralVelocity: 0, currentRank: 2, finished: false },
    { playerId: 'duck-2', progress: 0.80, lateralOffset: 0.0, lateralVelocity: 0, currentRank: 1, finished: false }, // teammate safe far ahead
    { playerId: 'duck-3', progress: 0.52, lateralOffset: 0.1, lateralVelocity: 0, currentRank: 3, finished: false }, // enemy in radius
    { playerId: 'duck-4', progress: 0.30, lateralOffset: 0.0, lateralVelocity: 0, currentRank: 4, finished: false },
  ]
  const objective = buildRaceObjectiveContext(config)
  const ctx = {
    tick: 500,
    tickRate: 60,
    objective,
    itemState,
    pickupState: { hazards: [] } as never,
    ducks,
    playerId: 'duck-1',
    secondsUntilNextPickupZone: 999,
    ghostPlayerIds: new Set<string>(),
    prepAutoUseEnabled: true,
    wildAutoUseEnabled: false,
  }

  const candidates = evaluatePrepCandidates(ctx)
  const hornCand = candidates.find((c) => c.itemId === 'QUACK_HORN')
  assert.ok(hornCand, 'Quack Horn should activate on enemy when teammate is far away')
})

test('In-flight Wild Rocket retargeting skips teammates when original target finishes or is lost', () => {
  const config = createTeamRaceConfig([['duck-1', 'duck-2'], ['duck-3', 'duck-4']])
  const itemState = createItemRaceState(config)
  // duck-1 fired a wild rocket at duck-3. duck-3 finishes.
  // duck-2 (teammate) is at 0.60, duck-4 (enemy) is at 0.70.
  // The rocket should retarget to duck-4, NOT duck-2!
  itemState.rockets.push({
    id: 1,
    sourcePlayerId: 'duck-1',
    targetPlayerId: 'duck-3',
    progress: 0.50,
    spawnedAtTick: 100,
    launchAtTick: 100,
    expiresAtTick: 500,
    kind: 'WILD',
    speedPerSecond: 0.25,
    hitRadius: 0.02,
    slowMultiplier: 0.35,
    slowDurationSeconds: 2.0,
    retargeted: false,
  })

  const ducks: ItemDuckState[] = [
    { playerId: 'duck-1', progress: 0.40, lateralOffset: 0, lateralVelocity: 0, currentRank: 4, finished: false },
    { playerId: 'duck-2', progress: 0.60, lateralOffset: 0, lateralVelocity: 0, currentRank: 2, finished: false }, // teammate ahead
    { playerId: 'duck-3', progress: 1.00, lateralOffset: 0, lateralVelocity: 0, currentRank: 1, finished: true },  // original target finished
    { playerId: 'duck-4', progress: 0.70, lateralOffset: 0, lateralVelocity: 0, currentRank: 3, finished: false }, // enemy ahead
  ]

  const emitted: Array<{ type: string; source?: string; target?: string }> = []
  // Run tickItemSystem or simulate rocket step
  // Let's import tickItemSystem
  const { tickItemSystem } = require('../packages/race-core/src/items/engine')
  tickItemSystem(itemState, ducks, 105, 60, (type: string, source?: string, target?: string) => {
    emitted.push({ type, source, target })
  })

  const rocket = itemState.rockets[0]
  assert.ok(rocket, 'Rocket should still be active')
  assert.equal(rocket.targetPlayerId, 'duck-4', 'Wild Rocket must retarget to enemy duck-4 and NOT allied duck-2')
})

test('Full simulation in Duo and Constructors has ZERO friendly fire incidents', () => {
  const duoConfig = createTeamRaceConfig([['duck-1', 'duck-2'], ['duck-3', 'duck-4'], ['duck-5', 'duck-6'], ['duck-7', 'duck-8']], {
    loadouts: Array.from({ length: 8 }, (_, i) => ({
      playerId: `duck-${i + 1}`,
      itemIds: (i % 2 === 0 ? ['HOMING_ROCKET', 'QUACK_HORN'] : ['HOMING_ROCKET', 'BANANA']) as any,
      source: 'PLAYER',
    })),
    pickupConfig: {
      enabled: true,
      goldenBoxEnabled: true,
      goldenBoxProbability: 0.2,
      hazardsEnabled: true,
      positionAwareLoot: true,
      spawnMultiplier: 1.25,
      regularPickupCap: 3,
      manualItemsEnabled: false,
      autoItemsEnabled: true,
      chaosBoxEnabled: false,
      forceGoldenBox: false,
      disabledItems: [],
      idealManualPlayerIds: [],
    },
  })

  const { simulateRace } = require('../packages/race-core/src')
  const result = simulateRace(duoConfig, { recordEvents: true })
  assert.ok(result.events.length > 0)

  const teammateMap = new Map<string, Set<string>>()
  for (const group of duoConfig.chaosConfig!.groups!) {
    for (const p of group) {
      teammateMap.set(p, new Set(group.filter((m) => m !== p)))
    }
  }

  for (const ev of result.events) {
    if (ev.type === 'ROCKET_FIRED' || ev.type === 'MINI_ROCKET_FIRED') {
      const source = ev.sourcePlayerId
      const target = ev.targetPlayerId
      if (source && target) {
        assert.equal(
          teammateMap.get(source)?.has(target),
          false,
          `Friendly fire detected! ${source} fired rocket at teammate ${target}`,
        )
      }
    }
    if (ev.type === 'HORN_USED' || ev.type === 'WILD_HORN_USED') {
      const source = ev.sourcePlayerId
      const targets = (ev.metadata?.targets as string[]) ?? []
      if (source) {
        for (const target of targets) {
          assert.equal(
            teammateMap.get(source)?.has(target),
            false,
            `Friendly horn blast! ${source} hit teammate ${target} with horn`,
          )
        }
      }
    }
  }
})
