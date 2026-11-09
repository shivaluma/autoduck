// Dumps TS-engine fixtures for the crates/race-protocol round-trip tests
// (tests/ts_oracle_roundtrip.rs). The TS engine is the oracle; this script
// only reads it.
//
// Usage (from the repo root):
//   node --import tsx crates/race-protocol/tests/fixtures/ts-oracle/dump-protocol-fixtures.mts \
//     . crates/race-protocol/tests/fixtures/ts-oracle 400
//
// Outputs: races.json (5 full races: input config, Zod-parsed config, result
// with all events, snapshots every 180 ticks), event-variants.json (one event
// per distinct (type, keys, value-shape) over <variantRaces> races),
// event-type-counts.json, event-types.json (raceEventTypeSchema options).
// With ALL_EVENTS_OUT=<path>, every variant-race event is also written there
// as NDJSON (for the ignored `all_oracle_events_round_trip` test).
import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const repo = resolve(process.argv[2] ?? '.')
const outDir = resolve(process.argv[3] ?? './fixtures')
const variantRaces = Number(process.argv[4] ?? 400)

const protocol = await import(pathToFileURL(join(repo, 'packages/race-protocol/src/index.ts')).href)
const core = await import(pathToFileURL(join(repo, 'packages/race-core/src/index.ts')).href)
const { raceConfigSchema, stateSnapshotMessageSchema, raceEventSchema, raceEventTypeSchema, RACE_PROTOCOL_VERSION } = protocol
const { createSimulation, stepSimulation, snapshotRaceWorld, resultFromSimulation, CORE_BALANCE } = core

const ITEMS = ['NITRO', 'DRAFT_FIN', 'PADDLE_BURST', 'BUBBLE_SHIELD', 'FEATHER', 'SHOCK_ABSORBER', 'HOMING_ROCKET', 'BANANA', 'QUACK_HORN']
const CHAOS = ['NORMAL', 'REVERSE', 'DUO', 'TRIPLE_ELIMINATION', 'CUT_LINE', 'CONSTRUCTORS', 'BOUNTY_HUNT']

const sha = (value: string) => createHash('sha256').update(value).digest('hex')

function pick<T>(values: readonly T[], n: number): T {
  return values[n % values.length]!
}

function buildConfig(index: number, opts: { manual?: boolean } = {}) {
  const seed = sha(`protocol-fixture:${index}`)
  const playerCount = 4 + (index % 9) // 4..12
  const players = Array.from({ length: playerCount }, (_, i) => ({
    playerId: String(i + 1 + (index % 3) * 10),
    name: `Duck ${i + 1}`,
    ...(i === 0 ? { cosmeticKey: '{"hat":"cap"}' } : {}),
    ...(index % 5 === 0 && i === playerCount - 1 ? { isGhost: true } : {}),
  }))
  const h = sha(`loadout:${index}`)
  const loadouts = players.map((player, i) => {
    const a = parseInt(h.slice(i * 2, i * 2 + 1), 16)
    const b = parseInt(h.slice(i * 2 + 1, i * 2 + 2), 16)
    const first = pick(ITEMS, a)
    let second = pick(ITEMS, b)
    if (second === first) second = pick(ITEMS, b + 1)
    return { playerId: player.playerId, itemIds: [first, second], source: i % 2 === 0 ? 'PLAYER' : 'AUTO' }
  })
  const chaosType = pick(CHAOS, index)
  const ids = players.filter((player) => !player.isGhost).map((player) => player.playerId)
  const chaosConfig: Record<string, unknown> = { type: chaosType, targetPlayerId: chaosType === 'BOUNTY_HUNT' ? ids[1] : null }
  if (chaosType === 'DUO' || chaosType === 'CONSTRUCTORS') {
    const size = chaosType === 'DUO' ? 2 : 3
    const groups: string[][] = []
    for (let i = 0; i + size <= ids.length; i += size) groups.push(ids.slice(i, i + size))
    chaosConfig.groups = groups
  }
  return {
    raceId: String(1000 + index),
    seed,
    players,
    loadouts,
    chaosConfig,
    ...(index % 7 === 3 ? { itemTuning: { nitroSpeedMultiplier: 1.2, bananaSlowMultiplier: 0.9 } } : {}),
    pickupConfig: {
      enabled: true,
      goldenBoxEnabled: true,
      goldenBoxProbability: 0.15,
      hazardsEnabled: true,
      positionAwareLoot: true,
      spawnMultiplier: index % 4 === 0 ? 2.5 : 1.25,
      regularPickupCap: 3,
      manualItemsEnabled: true,
      autoItemsEnabled: !opts.manual,
      chaosBoxEnabled: false,
      forceGoldenBox: index % 6 === 0,
      disabledItems: [],
      idealManualPlayerIds: [],
    },
  }
}

type AnyEvent = { type: string; metadata: Record<string, unknown>; [key: string]: unknown }

function runRace(input: unknown, manualInputs: unknown[] = [], snapshotEvery = 0) {
  const config = raceConfigSchema.parse(input)
  const simulation = createSimulation(config, { manualInputs, recordEvents: true })
  const snapshots: unknown[] = []
  const maximumTicks = CORE_BALANCE.maximumDurationSeconds * config.tickRate
  const snap = () => {
    const message = { type: 'STATE_SNAPSHOT', protocolVersion: RACE_PROTOCOL_VERSION, raceId: config.raceId, tick: simulation.tick, ...snapshotRaceWorld(simulation) }
    stateSnapshotMessageSchema.parse(message)
    snapshots.push(JSON.parse(JSON.stringify(message)))
  }
  if (snapshotEvery > 0) snap()
  while (!simulation.finished && simulation.tick < maximumTicks) {
    stepSimulation(simulation)
    if (snapshotEvery > 0 && (simulation.tick % snapshotEvery === 0 || simulation.finished)) snap()
  }
  const result = resultFromSimulation(simulation)
  for (const event of result.events) raceEventSchema.parse(event)
  return { config, result: JSON.parse(JSON.stringify(result)) as { events: AnyEvent[]; [key: string]: unknown }, snapshots }
}

mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'event-types.json'), JSON.stringify(raceEventTypeSchema.options))

// 1) Full races (config as received, parsed config, all events, snapshots, result).
const races: unknown[] = []
for (const index of [0, 1, 2, 3]) {
  const input = buildConfig(index)
  const { config, result, snapshots } = runRace(input, [], 180)
  races.push({ input, parsedConfig: JSON.parse(JSON.stringify(config)), result, snapshots })
}

// 2) Manual-input race: grant -> manual USE (applied) + one bogus input (NO_ITEM).
{
  const input = buildConfig(5, { manual: true })
  const first = runRace(input)
  const grants = first.result.events.filter((event) => event.type === 'WILD_ITEM_GRANTED').slice(0, 6)
  const manualInputs = grants.map((grant, i) => ({
    raceId: (input as { raceId: string }).raceId,
    playerId: grant.sourcePlayerId,
    wildItemInstanceId: grant.metadata.instanceId,
    action: 'USE',
    clientActionId: `client-action-${String(i).padStart(4, '0')}`,
    authoritativeTick: (grant.tick as number) + 1,
  }))
  manualInputs.push({
    raceId: (input as { raceId: string }).raceId,
    playerId: (input as { players: Array<{ playerId: string }> }).players[0]!.playerId,
    wildItemInstanceId: 'wild:missing',
    action: 'USE',
    clientActionId: 'client-action-bogus',
    authoritativeTick: 30,
  })
  const { config, result, snapshots } = runRace(input, manualInputs, 180)
  races.push({ input, parsedConfig: JSON.parse(JSON.stringify(config)), manualInputs, result, snapshots })
}
writeFileSync(join(outDir, 'races.json'), JSON.stringify(races))

// 3) Variants: one example per (type, sorted metadata keys, has source, has target) across many races.
const variants = new Map<string, AnyEvent>()
const typeCounts = new Map<string, number>()
let totalEvents = 0
const allEventsOut = process.env.ALL_EVENTS_OUT
if (allEventsOut) writeFileSync(allEventsOut, '')
for (let index = 0; index < variantRaces; index += 1) {
  const manual = index % 10 === 9
  const input = buildConfig(index, { manual })
  let manualInputs: unknown[] = []
  if (manual) {
    const first = runRace(input)
    manualInputs = first.result.events.filter((event) => event.type === 'WILD_ITEM_GRANTED').map((grant, i) => ({
      raceId: (input as { raceId: string }).raceId,
      playerId: grant.sourcePlayerId,
      wildItemInstanceId: grant.metadata.instanceId,
      action: 'USE',
      clientActionId: `client-action-${String(i).padStart(4, '0')}`,
      authoritativeTick: (grant.tick as number) + 1 + (i % 3),
    }))
  }
  const { result } = runRace(input, manualInputs)
  if (allEventsOut) appendFileSync(allEventsOut, result.events.map((event) => JSON.stringify(event)).join('\n') + '\n')
  for (const event of result.events) {
    totalEvents += 1
    typeCounts.set(event.type, (typeCounts.get(event.type) ?? 0) + 1)
    const shape = (value: unknown): string => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
    const key = [event.type, Object.keys(event).sort().join(','), Object.entries(event.metadata).map(([k, v]) => `${k}:${shape(v)}`).sort().join(',')].join('|')
    if (!variants.has(key)) variants.set(key, event)
  }
}
writeFileSync(join(outDir, 'event-variants.json'), JSON.stringify([...variants.values()]))
writeFileSync(join(outDir, 'event-type-counts.json'), JSON.stringify({ races: variantRaces, totalEvents, counts: Object.fromEntries([...typeCounts].sort()) }, null, 2))
console.log(`races=${races.length} variants=${variants.size} types=${typeCounts.size} totalEvents=${totalEvents}`)
