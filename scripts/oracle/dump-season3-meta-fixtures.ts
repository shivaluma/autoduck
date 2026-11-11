/**
 * Dumps the Season 3 meta-layer parity fixture for the Rust server (rewrite plan Phase 3 stage B:
 * "Port lib/season3.ts … 100% parity") to `crates/server/tests/fixtures/season3-meta.json.gz`.
 *
 *   node --import tsx scripts/oracle/dump-season3-meta-fixtures.ts [--count N] [--out path] [--check]
 *
 * Gzip JSON, format `season3-meta-v1`; every input comes from a seeded mulberry32, so the file is
 * reproducible byte for byte (`--check` regenerates in memory and compares). `--count` is the
 * number of end-to-end resolution cases (default 3,000; the gate needs at least 1,000); the
 * `t2x` family adds a third as many again.
 *
 * Case kinds (expected values are the exact `JSON.stringify` text of the oracle's result, or
 * `{"error": message, "name": errorClass}` when it throws):
 *
 * - `t2`: the meta half of `executeSeason3Race` (`lib/season3-race.ts`), run **for real**. The
 *   module hooks in `season3-meta/hooks.ts` replace only its I/O imports (Prisma, the engine
 *   runtime, live session, replay recorder, telemetry, the QP ledger write) with recording
 *   stubs; `mapSeason3RaceRanking`, `resolveSeason3Race`, `resolvePredictions`,
 *   `calculateOfficialRaceQuackRewards`, `generateDuckNews`, `applyScarEconomy`,
 *   `buildGoldenTrackReward` and all the glue between them are the real modules. Recorded:
 *   the persisted `CHAOS_RESOLVED` event, every call made inside the meta `$transaction` in
 *   order (with `new Date()` as `"<now>"`), the return value, and the thrown error.
 *   Inputs cover all 7 Chaos types, Season Shields (confirmed or not, with and without
 *   shields), King streaks (kept, lost, skipped King, ghost King, two Kings), predictions
 *   (skipped predictor/target, self, foreign), ghost ducks, skipped players, golden boxes,
 *   test races, malformed Chaos payloads and broken standings.
 * - `resolve`: `resolveSeason3Race(ranking, chaos, previousKing)` incl. invalid rankings.
 * - `scarEconomy`: `applyScarEconomy`.
 * - `predictions`: `resolvePredictions`.
 * - `news`: `generateDuckNews`.
 * - `champion`: `selectChampion`.
 * - `mapping`: `mapSeason3RaceRanking` (TS joins by name, Rust by userId: names are unique per
 *   case, so both joins agree; see docs/rewrite/phase3-notes.md).
 * - `schedule`: `isVietnamMonday(new Date(ms))`.
 * - `payload`: the route-inline `parseChaosGroups` (strict: every group an array), the
 *   season3-race `parseChaosGroups` (lenient) and `parseSkippedPlayerIds`, over random JSON.
 * - `balance`: the admin GET balance aggregation (`summarizeTelemetry('itemId' | 'loadoutKey')`
 *   and the pickup summary), mirrored line for line from `app/api/admin/season3/route.ts`
 *   because it is inline in the route.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync, gzipSync } from 'node:zlib'
import {
  applyScarEconomy,
  CHAOS_CARDS,
  chaosLabel,
  generateDuckNews,
  prepareChaosCard,
  resolvePredictions,
  resolveSeason3Race,
  selectChampion,
  type ChaosCard,
  type ChaosType,
  type Season3RankingEntry,
} from '../../lib/season3'
import { mapSeason3RaceRanking } from '../../lib/season3-race-mapping'
import { isVietnamMonday } from '../../lib/season3-schedule'
import { createRaceRng } from '../../packages/race-core/src/rng'
import { installSeason3MetaStubs } from './season3-meta/hooks'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
installSeason3MetaStubs(join(repoRoot, 'scripts/oracle/season3-meta/stubs'))
const FORMAT = 'season3-meta-v1'
const GENERATOR = 's3metagen-v1'
const GENERATOR_SEED = 0x5333_4d54 // "S3MT"

function parseArgs(argv: string[]) {
  let count = 3_000
  let out = join(repoRoot, 'crates/server/tests/fixtures/season3-meta.json.gz')
  let check = false
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--count') count = Number(argv[++index])
    else if (arg === '--out') out = resolve(argv[++index]!)
    else if (arg === '--check') check = true
    else {
      console.error(`unknown argument ${arg}`)
      process.exit(2)
    }
  }
  if (!Number.isInteger(count) || count < 1) {
    console.error('--count must be a positive integer')
    process.exit(2)
  }
  return { count, out, check }
}

// ---------------------------------------------------------------------------
// Input generator

class Mulberry32 {
  private state: number

  constructor(seed: number) {
    this.state = seed >>> 0
  }

  next() {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return (t ^ (t >>> 14)) >>> 0
  }

  float() {
    return this.next() / 4_294_967_296
  }

  below(n: number) {
    return this.next() % n
  }

  between(lo: number, hi: number) {
    return lo + this.below(hi - lo + 1)
  }

  chance(percent: number) {
    return this.below(100) < percent
  }

  pick<T>(items: readonly T[]): T {
    return items[this.below(items.length)]!
  }

  shuffle<T>(items: readonly T[]): T[] {
    const result = [...items]
    for (let index = result.length - 1; index > 0; index -= 1) {
      const swap = this.below(index + 1)
      ;[result[index], result[swap]] = [result[swap]!, result[index]!]
    }
    return result
  }

  subset<T>(items: readonly T[], percent: number): T[] {
    return items.filter(() => this.chance(percent))
  }
}

const gen = new Mulberry32(GENERATOR_SEED)
const GHOST = 'Thomas'
const NAME_POOL = [
  'An', 'Bình', 'Chi', 'Dũng', 'Hà', 'Khoa', 'Linh', 'Minh', 'Nam', 'Phúc', 'Quân', 'Tú', 'Vy', 'Thanh', 'Huy', 'Long',
  'thomas', 'Thomas ', 'Zịt 🦆', 'O\'Neil', 'A & B', 'Đạt "Nhanh"', 'line\nbreak', 'Ǹgọc', '',
]

function uniqueIds(count: number, lo: number, hi: number) {
  const ids = new Set<number>()
  while (ids.size < count) ids.add(gen.between(lo, hi))
  return [...ids]
}

function uniqueNames(count: number) {
  const names = new Set<string>()
  while (names.size < count) {
    const base = gen.pick(NAME_POOL)
    names.add(gen.chance(60) ? base : `${base}${gen.between(1, 99)}`)
  }
  return [...names]
}

function chaosType(): ChaosType {
  return gen.pick(CHAOS_CARDS)
}

const seasonPlayerShape = (player: SeasonPlayerInput) => ({ userId: player.userId, name: player.user.name })

type SeasonPlayerInput = {
  id: number
  userId: number
  scars: number
  shields: number
  isKing: boolean
  kingStreak: number
  user: { name: string; avatarUrl: string | null }
  appearance: null
}

// ---------------------------------------------------------------------------
// JSON helpers

function normalize(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, function replacer(this: Record<string, unknown>, key, raw) {
    return this[key] instanceof Date ? '<now>' : raw
  }) ?? 'null')
}

function view(run: () => unknown): string {
  try {
    const value = run()
    return value === undefined ? 'undefined' : JSON.stringify(normalize(value))
  } catch (error) {
    const err = error as Error
    return JSON.stringify({ error: err.message, name: err.name })
  }
}

// ---------------------------------------------------------------------------
// t2: executeSeason3Race with recording stubs

type Harness = {
  prisma: unknown
  runAuthoritativeRace: (...args: unknown[]) => Promise<unknown>
  parseRaceConfig: (json: string) => unknown
  record: (op: string, args: unknown) => unknown
}

const realSetTimeout = globalThis.setTimeout

async function runT2(input: T2Input) {
  const outer: Array<{ op: string; args: unknown }> = []
  const tx: Array<{ op: string; args: unknown }> = []
  let inTx = false
  const record = (op: string, args: unknown) => {
    ;(inTx ? tx : outer).push({ op, args: normalize(args) })
  }
  const model = (name: string, results: Record<string, (args: unknown) => unknown>) => new Proxy({}, {
    get: (_target, method: string) => async (args: unknown) => {
      record(`${name}.${method}`, args)
      const result = results[method]
      if (!result) throw new Error(`oracle stub: ${name}.${method} not modelled`)
      return result(args)
    },
  })
  const client = (): Record<string, unknown> => ({
    seasonWeek: model('seasonWeek', { findUnique: () => structuredClone(input.week), update: () => ({}) }),
    race: model('race', {
      findUnique: () => ({ id: input.raceId, isTest: input.isTest, engineConfigJson: '{}' }),
      update: () => ({}),
      updateMany: () => ({ count: 1 }),
    }),
    raceParticipant: model('raceParticipant', { updateMany: () => ({ count: 1 }) }),
    seasonPlayer: model('seasonPlayer', { updateMany: () => ({ count: 1 }), update: () => ({}) }),
    seasonPrediction: model('seasonPrediction', { update: () => ({}) }),
    raceEngineEvent: model('raceEngineEvent', { create: () => ({}) }),
    $transaction: async (fn: (client: unknown) => Promise<unknown>) => {
      inTx = true
      try {
        return await fn(client())
      } finally {
        inTx = false
      }
    },
  })
  const harness: Harness = {
    prisma: client(),
    runAuthoritativeRace: async () => structuredClone(input.result),
    parseRaceConfig: () => structuredClone(input.config),
    record,
  }
  ;(globalThis as { __S3_META__?: Harness }).__S3_META__ = harness
  // The 3 s countdown sleep resolves at once.
  globalThis.setTimeout = ((fn: () => void) => {
    fn()
    return 0
  }) as unknown as typeof setTimeout
  const { executeSeason3Race } = await import('../../lib/season3-race')
  let ret: string | null = null
  let error: string | null = null
  try {
    ret = JSON.stringify(normalize(await executeSeason3Race(input.raceId, input.week.id, { testMode: input.isTest })))
  } catch (thrown) {
    const err = thrown as Error
    error = JSON.stringify({ error: err.message, name: err.name })
  } finally {
    globalThis.setTimeout = realSetTimeout
  }
  const chaosWrite = outer.find((call) => call.op === 'persistRaceEvents' && (call.args as { events?: unknown }).events)
  return {
    chaosEvent: chaosWrite ? JSON.stringify((chaosWrite.args as { events: unknown[] }).events[0]) : null,
    tx: JSON.stringify(tx),
    ret,
    error,
  }
}

type T2Input = ReturnType<typeof genT2>

function genGroupsPayload(type: ChaosType, official: SeasonPlayerInput[], everyone: SeasonPlayerInput[]): string | null {
  const grouped = type === 'DUO' || type === 'CONSTRUCTORS'
  const roll = gen.below(100)
  if (!grouped) {
    if (roll < 90) return null
  }
  const rng = createRaceRng(`groups-${gen.next()}`, 'chaos:week:1')
  const prepareFor = (players: SeasonPlayerInput[], kind: ChaosType) => {
    if (players.length === 0) return null
    const card = prepareChaosCard(kind, players.map(seasonPlayerShape), () => rng.next())
    return card.groups ? JSON.stringify(card.groups) : null
  }
  if (!grouped) return prepareFor(official, gen.pick(['DUO', 'CONSTRUCTORS'] as const))
  if (roll < 72) return prepareFor(official, type)
  if (roll < 80) return prepareFor(everyone, type)
  if (roll < 84) return null
  if (roll < 86) return '[]'
  if (roll < 88) return prepareFor(official, type === 'DUO' ? 'CONSTRUCTORS' : 'DUO')
  return gen.pick([
    'not json',
    '{"a":1}',
    '"[[1,2]]"',
    '[1,2]',
    '[[]]',
    '[[],[]]',
    `[[${official[0]?.userId ?? 1}.0],[${official[1]?.userId ?? 2}]]`,
    `[["${official[0]?.userId ?? 1}"],["${official[1]?.userId ?? 2}"]]`,
    `[[${official.map((player) => player.userId).join(',')}],[]]`,
    `[[${official.map((player) => player.userId).join(',')}]]`,
    `[[null],[true]]`,
    `[[[${official[0]?.userId ?? 1}]],[[${official[1]?.userId ?? 2}],{}]]`,
    `[[${official.map((player) => player.userId).join(',')}],[${official[0]?.userId ?? 1}],[1e3]]`,
  ])
}

/**
 * `extended` (the `t2x` family, added after the stage-B review) widens the inputs without
 * touching the `t2` draws: lobbies up to 16, a second prediction by the same predictor in either
 * order, empty `pickupId`s, and unknown stored `chaosType`s.
 */
function genT2(extended = false) {
  const count = gen.between(2, extended ? 16 : 12)
  const userIds = uniqueIds(count, 1, 300)
  const seasonPlayerIds = uniqueIds(count, 1, 900)
  const names = uniqueNames(count)
  const ghostRoll = gen.below(100)
  if (ghostRoll < 25) names[gen.below(count)] = GHOST
  else if (ghostRoll < 28 && count > 2) {
    names[0] = GHOST
    names[1] = GHOST
  }
  const players: SeasonPlayerInput[] = userIds.map((userId, index) => ({
    id: seasonPlayerIds[index]!,
    userId,
    scars: gen.chance(60) ? gen.between(0, 1) : gen.between(0, 4),
    shields: gen.chance(50) ? 0 : gen.between(1, 3),
    isKing: false,
    kingStreak: 0,
    user: { name: names[index]!, avatarUrl: null },
    appearance: null,
  }))
  const kingRoll = gen.below(100)
  if (kingRoll < 75) {
    const king = gen.pick(players)
    king.isKing = true
    king.kingStreak = gen.between(1, 6)
  } else if (kingRoll < 80) {
    for (const king of gen.shuffle(players).slice(0, 2)) {
      king.isKing = true
      king.kingStreak = gen.between(0, 4)
    }
  }
  for (const player of players) if (!player.isKing && gen.chance(5)) player.kingStreak = gen.between(1, 3)

  const skipped = new Set(players.filter(() => gen.chance(15)).map((player) => player.userId))
  if (skipped.size === players.length) skipped.delete(players[0]!.userId)
  const configured = players.filter((player) => !skipped.has(player.userId))
  const official = configured.filter((player) => player.user.name !== GHOST)

  // Standings: the official configured ducks in a random finish order.
  let standings = gen.shuffle(official).map((player, index) => ({ playerId: String(player.userId), name: player.user.name, rank: index + 1, finishTimeMs: 0 }))
  const breakRoll = gen.below(100)
  if (breakRoll < 2 && standings.length > 0) standings = standings.slice(0, -1)
  else if (breakRoll < 4 && standings.length > 0) standings = [...standings, { ...standings[0]!, rank: standings.length + 1 }]
  else if (breakRoll < 6) standings = [...standings, { playerId: '999999', name: 'Người Lạ', rank: standings.length + 1, finishTimeMs: 0 }]

  const type = chaosType()
  let targetUserId: number | null = null
  if (type === 'BOUNTY_HUNT') {
    const roll = gen.below(100)
    if (roll < 80 && official.length > 0) targetUserId = gen.pick(official).userId
    else if (roll < 90) targetUserId = gen.pick(players).userId
  } else if (gen.chance(15)) {
    targetUserId = gen.pick(players).userId
  }
  const targetUserId2 = gen.chance(8) ? gen.pick(players).userId : null
  const chaosPayload = genGroupsPayload(type, official, players)

  const shieldChoices = gen.subset(players, 35).map((player) => ({ seasonPlayerId: player.id }))
  const predictionIds = uniqueIds(count, 1, 5_000)
  const predictions = players.flatMap((player, index) => {
    if (!gen.chance(70)) return []
    const roll = gen.below(100)
    const targetUserId = roll < 5 ? player.userId : roll < 9 ? gen.between(301, 400) : gen.pick(players.filter((other) => other.userId !== player.userId)).userId
    const rows = [{ id: predictionIds[index]!, predictorPlayerId: player.id, predictorUserId: player.userId, targetUserId, pointsAwarded: 0 }]
    if (!extended) return rows
    if (gen.chance(10)) rows.push({ id: 10_000 + predictionIds[index]!, predictorPlayerId: player.id, predictorUserId: player.userId, targetUserId: gen.pick(players).userId, pointsAwarded: 0 })
    return gen.chance(50) ? rows : rows.reverse()
  })

  const tickRate = gen.chance(90) ? 60 : 30
  const tickMs = 1000 / tickRate
  const events: Array<Record<string, unknown>> = []
  const finishTicks = new Map<number, number>()
  for (const player of configured) {
    const tick = finishTicks.size > 0 && gen.chance(10) ? gen.pick([...finishTicks.values()]) : gen.between(1_800, 3_600)
    finishTicks.set(player.userId, tick)
    const timestamp = tick * tickMs
    const metadata: Record<string, unknown> = { rank: 0 }
    const metaRoll = gen.below(100)
    if (metaRoll < 80) metadata.finishTimeMs = timestamp
    else if (metaRoll < 85) metadata.finishTimeMs = null
    events.push({ raceId: 'x', type: 'DUCK_FINISHED', tick, timestampWithinRaceMs: timestamp, sourcePlayerId: String(player.userId), metadata })
  }
  if (gen.chance(5) && configured.length > 0) {
    events.push({ raceId: 'x', type: 'DUCK_FINISHED', tick: 10, timestampWithinRaceMs: 10 * tickMs, metadata: { finishTimeMs: 1 } })
  }
  const goldenCount = gen.chance(40) ? (gen.chance(15) ? 2 : 1) : 0
  for (let index = 0; index < goldenCount; index += 1) {
    const tick = gen.between(60, 1_700)
    const sourceRoll = gen.below(100)
    const event: Record<string, unknown> = { raceId: 'x', type: 'GOLDEN_BOX_COLLECTED', tick, timestampWithinRaceMs: tick * tickMs, metadata: {} }
    if (sourceRoll < 82) event.sourcePlayerId = String(gen.pick(configured).userId)
    else if (sourceRoll < 88) event.sourcePlayerId = ''
    else if (sourceRoll < 94) event.sourcePlayerId = String(gen.between(500, 600))
    const pickupRoll = gen.below(100)
    if (pickupRoll < 85) (event.metadata as Record<string, unknown>).pickupId = `golden-${gen.between(0, 9)}-${tick}`
    else if (pickupRoll < (extended ? 89 : 92)) (event.metadata as Record<string, unknown>).pickupId = gen.between(1, 9)
    else if (extended && pickupRoll < 95) (event.metadata as Record<string, unknown>).pickupId = ''
    events.push(event)
  }
  for (let index = gen.between(0, 4); index > 0; index -= 1) {
    const tick = gen.between(1, 3_000)
    events.push({ raceId: 'x', type: gen.pick(['PICKUP_COLLECTED', 'ITEM_ACTIVATED', 'OVERTAKE']), tick, timestampWithinRaceMs: tick * tickMs, sourcePlayerId: String(gen.pick(players).userId), metadata: {} })
  }
  events.sort((left, right) => (left.tick as number) - (right.tick as number))
  const finishTimes = configured.map((player) => finishTicks.get(player.userId)! * tickMs)
  const durationMs = gen.chance(95) ? Math.max(0, ...finishTimes) : gen.between(1, 300_000) + gen.float()
  for (const entry of standings) entry.finishTimeMs = (finishTicks.get(Number(entry.playerId)) ?? 0) * tickMs

  const raceId = gen.between(1, 99_999)
  const weekId = gen.between(1, 999)
  const isTest = gen.chance(25)
  return {
    raceId,
    isTest,
    week: {
      id: weekId,
      seasonId: gen.between(1, 9),
      weekNumber: gen.between(1, 12),
      status: 'racing',
      raceId,
      chaosType: (extended && gen.chance(4) ? gen.pick(['RANDOM', 'normal', '', 'BOUNTY']) : type) as string,
      chaosTargetUserId: targetUserId,
      chaosTargetUserId2: targetUserId2,
      chaosPayload,
      predictions,
      shieldChoices,
      season: { players },
    },
    config: {
      tickRate,
      players: configured.map((player) => ({ playerId: String(player.userId), name: player.user.name, isGhost: player.user.name === GHOST })),
      loadouts: [],
    },
    result: { durationMs, standings, events, engineVersion: 'x', balanceVersion: 'x', trackVersion: 'x', tickRate },
  }
}

// ---------------------------------------------------------------------------
// Unit families

function genRanking(): Season3RankingEntry[] {
  const count = gen.between(gen.chance(5) ? 0 : 2, 12)
  const ids = uniqueIds(count, 1, 60)
  const names = uniqueNames(count)
  const ranks = gen.shuffle(Array.from({ length: count }, (_, index) => index + 1))
  const ranking = ids.map((userId, index) => ({ userId, name: names[index]!, rank: ranks[index]!, hasShield: gen.chance(30) }))
  const roll = gen.below(100)
  if (roll < 3 && ranking.length > 1) ranking[1]!.rank = ranking[0]!.rank
  else if (roll < 6 && ranking.length > 1) ranking[1]!.userId = ranking[0]!.userId
  else if (roll < 8 && ranking.length > 0) ranking[0]!.rank = gen.pick([0, -1, ranking.length + 1, 1.5])
  return ranking
}

function genChaosCard(ranking: Season3RankingEntry[]): ChaosCard {
  const type = chaosType()
  const ids = ranking.map((entry) => entry.userId)
  const card: ChaosCard = { type, targetUserId: null, targetUserId2: gen.chance(10) ? gen.between(1, 60) : null }
  if (type === 'BOUNTY_HUNT') card.targetUserId = gen.chance(88) && ids.length > 0 ? gen.pick(ids) : gen.chance(50) ? gen.between(61, 99) : null
  if (type === 'DUO' || type === 'CONSTRUCTORS' || gen.chance(10)) {
    const roll = gen.below(100)
    if (roll < 80 && ranking.length > 0) {
      const rng = createRaceRng(`g-${gen.next()}`, 's')
      const kind = type === 'DUO' || type === 'CONSTRUCTORS' ? type : 'DUO'
      card.groups = prepareChaosCard(kind, ranking, () => rng.next()).groups
    } else if (roll < 88) {
      card.groups = [gen.shuffle(ids).slice(0, 2), [gen.between(61, 99)]]
    } else if (roll < 94) {
      card.groups = []
    } else if (roll < 97) {
      card.groups = [[], ids]
    }
  }
  return card
}

function hand(): Array<Record<string, unknown>> {
  // tests/season3.test.ts fixtures, so the ported unit tests and the fixture agree.
  const ranking = [
    { userId: 1, name: 'Thanh', rank: 1, hasShield: false },
    { userId: 2, name: 'Huy', rank: 2, hasShield: false },
    { userId: 3, name: 'Khoa', rank: 3, hasShield: false },
    { userId: 4, name: 'Long', rank: 4, hasShield: true },
    { userId: 5, name: 'Nam', rank: 5, hasShield: false },
  ]
  const cards: ChaosCard[] = [
    { type: 'NORMAL', targetUserId: null, targetUserId2: null },
    { type: 'REVERSE', targetUserId: null, targetUserId2: null },
    { type: 'DUO', targetUserId: null, targetUserId2: null, groups: [[1, 5], [2, 3, 4]] },
    { type: 'CONSTRUCTORS', targetUserId: null, targetUserId2: null, groups: [[1, 2, 3], [4, 5]] },
    { type: 'TRIPLE_ELIMINATION', targetUserId: null, targetUserId2: null },
    { type: 'CUT_LINE', targetUserId: null, targetUserId2: null },
    { type: 'BOUNTY_HUNT', targetUserId: 3, targetUserId2: null },
    { type: 'BOUNTY_HUNT', targetUserId: 4, targetUserId2: null },
    { type: 'BOUNTY_HUNT', targetUserId: 5, targetUserId2: null },
  ]
  return [
    ...cards.map((chaos) => ({ kind: 'resolve', ranking, chaos, previousKing: null, expected: view(() => resolveSeason3Race(ranking, chaos, null)) })),
    { kind: 'resolve', ranking, chaos: cards[0], previousKing: { userId: 2, streak: 3 }, expected: view(() => resolveSeason3Race(ranking, cards[0]!, { userId: 2, streak: 3 })) },
  ]
}

const PAYLOAD_TEXTS = [
  '', 'null', 'true', '0', '"x"', '{}', '[]', '[[]]', '[1,2,3]', '[[1,2],[3]]', '[[1.0,2.50],[3e0]]', '[[1],2]', '[1.5,2,-3,1e21,1e300,-0]',
  '[[{"b":1,"a":2,"1":3}],[null,"x"]]', '[ 3 , 1, 2 ]', '[1, "2", null, true, [4]]', 'not json', '[1,', '{"0":[1]}', '[9007199254740993]',
]

function randomJsonValue(depth: number): unknown {
  const roll = gen.below(depth > 2 ? 6 : 9)
  switch (roll) {
    case 0: return gen.between(-5, 400)
    case 1: return gen.chance(50) ? gen.between(1, 300) + 0.5 : -0
    case 2: return gen.chance(50) ? null : gen.chance(50)
    case 3: return String(gen.between(1, 300))
    case 4: return gen.pick([1e21, 2 ** 53, 1e-7, 123.456])
    case 5: return gen.between(1, 300)
    case 6: case 7: return Array.from({ length: gen.between(0, 4) }, () => randomJsonValue(depth + 1))
    default: return { [gen.pick(['a', 'b', '2', '10'])]: randomJsonValue(depth + 1), z: 1 }
  }
}

function strictChaosGroups(payload: string | null | undefined) {
  if (!payload) return undefined
  try {
    const parsed = JSON.parse(payload)
    return Array.isArray(parsed) && parsed.every((group) => Array.isArray(group)) ? parsed as number[][] : undefined
  } catch {
    return undefined
  }
}

function lenientChaosGroups(payload: string | null | undefined) {
  if (!payload) return undefined
  try {
    const parsed = JSON.parse(payload)
    return Array.isArray(parsed) ? parsed as number[][] : undefined
  } catch {
    return undefined
  }
}

function parseSkippedPlayerIds(payload: string | null | undefined) {
  if (!payload) return []
  try {
    const parsed = JSON.parse(payload)
    return Array.isArray(parsed) ? parsed.filter((value): value is number => Number.isInteger(value)) : []
  } catch {
    return []
  }
}

type TelemetryRow = { itemId: string; loadoutKey: string; won: boolean; bottomTwo: boolean; finalRank: number; rankDelta: number; activated: boolean; succeeded: boolean }
type PickupRow = { itemId: string; activated: boolean; hitCount: number; manualUsed: boolean; autoUsed: boolean; rankDelta: number }

/** Mirrors `summarizeTelemetry` and the pickup summary in `app/api/admin/season3/route.ts` GET. */
function balanceSummary(telemetry: TelemetryRow[], pickupTelemetry: PickupRow[]) {
  const summarizeTelemetry = (key: 'itemId' | 'loadoutKey') => {
    const groups = new Map<string, typeof telemetry>()
    for (const row of telemetry) groups.set(row[key], [...(groups.get(row[key]) ?? []), row])
    return [...groups].map(([name, rows]) => {
      const playerPicks = key === 'itemId' ? rows.length : rows.length / 2
      const normalize = key === 'itemId' ? 1 : 2
      return {
        name,
        picks: playerPicks,
        winRate: rows.filter((row: { won: boolean }) => row.won).length / normalize / playerPicks,
        bottom2Rate: rows.filter((row: { bottomTwo: boolean }) => row.bottomTwo).length / normalize / playerPicks,
        averageFinish: rows.reduce((sum: number, row: { finalRank: number }) => sum + row.finalRank, 0) / normalize / playerPicks,
        averageRankDelta: rows.reduce((sum: number, row: { rankDelta: number }) => sum + row.rankDelta, 0) / normalize / playerPicks,
        activationRate: rows.filter((row: { activated: boolean }) => row.activated).length / rows.length,
        successRate: rows.filter((row: { succeeded: boolean }) => row.succeeded).length / Math.max(1, rows.filter((row: { activated: boolean }) => row.activated).length),
      }
    }).sort((left, right) => right.winRate - left.winRate)
  }
  return {
    items: summarizeTelemetry('itemId'),
    loadouts: summarizeTelemetry('loadoutKey'),
    pickups: [...new Set(pickupTelemetry.map((row: { itemId: string }) => row.itemId))].map((itemId) => {
      const rows = pickupTelemetry.filter((row: { itemId: string }) => row.itemId === itemId)
      const activations = rows.filter((row: { activated: boolean }) => row.activated).length
      return {
        name: itemId,
        picks: rows.length,
        activationRate: activations / Math.max(1, rows.length),
        hitRate: rows.reduce((sum: number, row: { hitCount: number }) => sum + row.hitCount, 0) / Math.max(1, activations),
        manualRate: rows.filter((row: { manualUsed: boolean }) => row.manualUsed).length / Math.max(1, activations),
        autoRate: rows.filter((row: { autoUsed: boolean }) => row.autoUsed).length / Math.max(1, activations),
        averageRankDelta: rows.reduce((sum: number, row: { rankDelta: number }) => sum + row.rankDelta, 0) / Math.max(1, rows.length),
      }
    }).sort((left, right) => right.picks - left.picks),
  }
}

const ITEMS = ['NITRO', 'BUBBLE_SHIELD', 'HOMING_ROCKET', 'BANANA', 'DRAFT_FIN', 'FEATHER', 'PADDLE_BURST', 'QUACK_HORN', 'SHOCK_ABSORBER']
const PICKUPS = ['MUD_BOMB', 'SPEED_PAD', 'MAGNET', 'GOLDEN_QUACK', 'TURBO']

function genBalance() {
  const races = gen.between(0, 6)
  const telemetry: TelemetryRow[] = []
  const pickups: PickupRow[] = []
  for (let race = 0; race < races; race += 1) {
    const players = gen.between(2, 10)
    for (let player = 0; player < players; player += 1) {
      const loadout = gen.shuffle(ITEMS).slice(0, 2)
      const finalRank = gen.between(1, players)
      const loadoutKey = gen.chance(10) ? loadout.join('+') : [...loadout].sort().join('+')
      for (const itemId of loadout) {
        const activated = gen.chance(70)
        telemetry.push({
          itemId,
          loadoutKey,
          won: finalRank === 1,
          bottomTwo: finalRank >= players - 1,
          finalRank,
          rankDelta: gen.between(-4, 4),
          activated,
          succeeded: activated && gen.chance(60),
        })
      }
      if (gen.chance(20)) telemetry.push({ itemId: gen.pick(ITEMS), loadoutKey: 'ODD', won: gen.chance(30), bottomTwo: gen.chance(30), finalRank: gen.between(1, players), rankDelta: gen.between(-3, 3), activated: false, succeeded: false })
      for (let pick = gen.between(0, 3); pick > 0; pick -= 1) {
        const activated = gen.chance(60)
        pickups.push({ itemId: gen.pick(PICKUPS), activated, hitCount: activated ? gen.between(0, 3) : 0, manualUsed: activated && gen.chance(20), autoUsed: activated && gen.chance(80), rankDelta: gen.between(-5, 5) })
      }
    }
  }
  return { telemetry, pickups, expected: JSON.stringify(balanceSummary(telemetry, pickups)) }
}

function genUnit(kind: string): Record<string, unknown> {
  switch (kind) {
    case 'resolve': {
      const ranking = genRanking()
      const chaos = genChaosCard(ranking)
      const kingRoll = gen.below(100)
      const previousKing = kingRoll < 30 ? null : { userId: kingRoll < 85 && ranking.length > 0 ? gen.pick(ranking).userId : gen.between(61, 99), streak: gen.between(0, 7) }
      return { kind, ranking, chaos, previousKing, expected: view(() => resolveSeason3Race(ranking, chaos, previousKing)) }
    }
    case 'scarEconomy': {
      const args = [gen.between(0, 7), gen.between(0, 5), gen.pick([0, 0, 1, 1, 2, 3, 5]), gen.chance(40)] as const
      return { kind, args, expected: view(() => applyScarEconomy(...args)) }
    }
    case 'predictions': {
      const ranking = genRanking().filter((entry) => Number.isInteger(entry.rank))
      const bottomTwo = [...ranking].sort((left, right) => left.rank - right.rank).slice(-gen.between(0, 3))
      const ids = ranking.map((entry) => entry.userId)
      const predictions = Array.from({ length: gen.between(0, 8) }, () => ({
        predictorUserId: gen.chance(85) && ids.length > 0 ? gen.pick(ids) : gen.between(61, 99),
        targetUserId: gen.chance(85) && ids.length > 0 ? gen.pick(ids) : gen.between(61, 99),
      }))
      return { kind, predictions, bottomTwo, expected: view(() => resolvePredictions(predictions, bottomTwo)) }
    }
    case 'news': {
      const names = () => uniqueNames(gen.between(0, 3)).map((name) => ({ name }))
      const chaos: ChaosCard = { type: chaosType(), targetUserId: null, targetUserId2: null }
      const optional = () => {
        const roll = gen.below(100)
        return roll < 20 ? undefined : roll < 40 ? null : roll < 45 ? '' : gen.pick(NAME_POOL)
      }
      const args = {
        weekNumber: gen.between(1, 52),
        scarVictims: names(),
        protectedPlayers: names(),
        chaos,
        chaosTargetName: optional(),
        kingName: optional(),
        predictionWinners: names(),
      }
      return { kind, args, expected: view(() => generateDuckNews(args)) }
    }
    case 'champion': {
      const count = gen.between(0, 8)
      const players = uniqueIds(count, 1, 60).map((userId) => ({ userId, championshipPoints: gen.between(0, 6), raceWins: gen.between(0, 3) }))
      return { kind, players, expected: view(() => selectChampion(players)) }
    }
    case 'mapping': {
      const count = gen.between(1, 10)
      const ids = uniqueIds(count, 1, 60)
      const names = uniqueNames(count)
      const players = ids.map((userId, index) => ({
        userId,
        shields: gen.between(0, 2),
        shieldConfirmed: gen.pick([true, false, undefined]),
        user: { name: names[index]! },
      }))
      let raw = gen.shuffle(players).map((player, index) => ({ rank: index + 1, playerId: String(player.userId), name: player.user.name }))
      const roll = gen.below(100)
      if (roll < 8) raw = raw.slice(0, -1)
      else if (roll < 14 && raw.length > 0) raw = [...raw, { ...raw[0]!, rank: raw.length + 1 }]
      else if (roll < 20) raw = [...raw, { rank: raw.length + 1, playerId: '777', name: 'Ngoại Lai' }]
      else if (roll < 24 && raw.length > 1) raw[1] = { ...raw[1]!, rank: raw[0]!.rank }
      return { kind, raw, players, expected: view(() => mapSeason3RaceRanking(raw.map(({ rank, name }) => ({ rank, name })), players)) }
    }
    case 'schedule': {
      const base = Date.UTC(2026, 0, 1) + gen.between(0, 3_000) * 86_400_000
      const roll = gen.below(100)
      const ms = roll < 30 ? base - 7 * 3_600_000 + gen.pick([-1, 0, 1, 86_399_999, 86_400_000]) : roll < 35 ? gen.pick([0, -1, -86_400_000 * 3, 8.64e15, -8.64e15]) : base + gen.between(0, 86_399_999)
      return { kind, ms, expected: view(() => isVietnamMonday(new Date(ms))) }
    }
    case 'payload': {
      const text = gen.chance(40) ? gen.pick(PAYLOAD_TEXTS) : gen.chance(10) ? null : JSON.stringify(randomJsonValue(0))
      return {
        kind,
        text,
        expected: JSON.stringify({
          strict: view(() => strictChaosGroups(text)),
          lenient: view(() => lenientChaosGroups(text)),
          skipped: view(() => parseSkippedPlayerIds(text)),
        }),
      }
    }
    case 'balance':
      return { kind, ...genBalance() }
    default:
      throw new Error(kind)
  }
}

const UNIT_KINDS: Array<[number, string]> = [
  [1_500, 'resolve'],
  [200, 'scarEconomy'],
  [300, 'predictions'],
  [300, 'news'],
  [200, 'champion'],
  [400, 'mapping'],
  [300, 'schedule'],
  [600, 'payload'],
  [150, 'balance'],
]

async function build(count: number) {
  const cases: Array<Record<string, unknown>> = hand()
  for (const [n, kind] of UNIT_KINDS) for (let index = 0; index < n; index += 1) cases.push(genUnit(kind))
  for (let index = 0; index < count; index += 1) {
    const input = genT2()
    cases.push({ kind: 't2', input, expected: await runT2(input) })
  }
  for (let index = 0; index < Math.ceil(count / 3); index += 1) {
    const input = genT2(true)
    cases.push({ kind: 't2x', input, expected: await runT2(input) })
  }
  const oracleFiles = [
    'lib/season3.ts',
    'lib/season3-race.ts',
    'lib/season3-race-mapping.ts',
    'lib/season3-schedule.ts',
    'lib/ghost-duck.ts',
    'lib/cosmetics/economy.ts',
    'lib/racing/golden-reward.ts',
    'packages/race-core/src/chaos/index.ts',
  ]
  return {
    format: FORMAT,
    generator: GENERATOR,
    generatorSeed: GENERATOR_SEED,
    chaosLabels: Object.fromEntries(CHAOS_CARDS.map((type) => [type, chaosLabel(type)])),
    oracleSha256: Object.fromEntries(oracleFiles.map((file) => [file, createHash('sha256').update(readFileSync(join(repoRoot, file))).digest('hex')])),
    cases,
  }
}

async function main() {
  const { count, out, check } = parseArgs(process.argv.slice(2))
  const fixture = await build(count)
  const json = JSON.stringify(fixture)
  const counts: Record<string, number> = {}
  for (const entry of fixture.cases) counts[entry.kind as string] = (counts[entry.kind as string] ?? 0) + 1
  if (check) {
    if (!existsSync(out) || gunzipSync(readFileSync(out)).toString('utf8') !== json) {
      console.error(`${out} is stale: rerun scripts/oracle/dump-season3-meta-fixtures.ts`)
      process.exit(1)
    }
    console.error(`${out} is up to date (${fixture.cases.length} cases)`)
    return
  }
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, gzipSync(json, { level: 9 }))
  console.error(`wrote ${out}: ${fixture.cases.length} cases ${JSON.stringify(counts)}`)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
