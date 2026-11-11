/**
 * Dumps the season-meta parity fixture (plan D5, R7; Phase 2 "meta parity
 * 100%") for `race-cli oracle meta` and `crates/race-core/tests/meta_parity.rs`.
 *
 *   node --no-use-std-math-pow --import tsx scripts/oracle/dump-meta-fixtures.ts [--count N] [--out path]
 *
 * Default output: `crates/race-core/tests/fixtures/meta-parity.json.gz`
 * (gzip JSON, format `meta-parity-v1`). `--count` sets the number of generated
 * cases (default 12,000; the gate needs at least 10,000).
 *
 * Oracles (never modified):
 * - `packages/race-core/src/chaos/index.ts` (`prepareChaosRule`,
 *   `resolveChaosRule`: all 7 rules, incl. error paths and `localeCompare`
 *   tie-breaks on duplicate ranks),
 * - `lib/season3.ts` (`selectChaosCard`, `prepareChaosCard`: ghost filtering,
 *   one `random()` for the card then the shuffle on the same stream),
 * - `lib/racing/loadout.ts` (`selectAutoLoadout` on
 *   `createRaceRng(seed, 'auto-loadout:' + id)`),
 * - `packages/race-core/src/items/{catalog,loadout}.ts` (`RACE_ITEM_CATALOG`,
 *   `AUTO_LOADOUT_PRESETS`, `validateLoadout`).
 *
 * The admin route (`app/api/admin/season3/route.ts`) imports Prisma and Next,
 * so its RNG flows are mirrored here line for line instead of imported:
 * `open-week` (`chaos:week:N`, RANDOM -> selectChaosCard, explicit type ->
 * prepareChaosCard), `set-chaos` (`chaos:manual:N:<ms>`, RANDOM ->
 * selectChaosCard, BOUNTY_HUNT/DUO/CONSTRUCTORS -> prepareChaosCard, other
 * types draw nothing) and `toggle-skip` (`chaos:week:N`, one discarded
 * `rng.next()`, then prepareChaosCard for the persisted type). Manual
 * target/group overrides take no RNG and are not modelled.
 *
 * Every expected value is the exact `JSON.stringify` text of the oracle's
 * return value (or `{"error": message}` when it throws), so key order,
 * integer-like key order in `reasonByPlayer`, omitted `undefined` keys and
 * `NaN`/`Infinity` -> `null` are all part of the comparison. `after` is the
 * stream's next `nextUint32()` once the flow returns, which pins how many
 * draws the flow consumed.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import {
  AUTO_LOADOUT_PRESETS,
  CHAOS_RULE_IDS,
  prepareChaosRule,
  RACE_ITEM_CATALOG,
  resolveChaosRule,
  validateLoadout,
  type ChaosPreparedState,
  type ChaosRuleId,
  type RawChaosEntry,
} from '../../packages/race-core/src'
import { createRaceRng, type DeterministicRng } from '../../packages/race-core/src/rng'
import type { RaceItemId } from '../../packages/race-protocol/src'
import { selectAutoLoadout } from '../../lib/racing/loadout'
import {
  CHAOS_CARDS,
  prepareChaosCard,
  selectChaosCard,
  type ChaosCard,
  type ChaosType,
  type Season3Player,
} from '../../lib/season3'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

const FORMAT = 'meta-parity-v1'
const GENERATOR = 'metagen-v1'
const GENERATOR_SEED = 0x4d45_5441 // "META"

function parseArgs(argv: string[]) {
  let count = 12_000
  let out = join(repoRoot, 'crates/race-core/tests/fixtures/meta-parity.json.gz')
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--count') count = Number(argv[++index])
    else if (arg === '--out') out = resolve(argv[++index]!)
    else {
      console.error(`unknown argument ${arg}`)
      process.exit(2)
    }
  }
  if (!Number.isInteger(count) || count < 1) {
    console.error('--count must be a positive integer')
    process.exit(2)
  }
  return { count, out }
}

// ---------------------------------------------------------------------------
// Case generator (fixture inputs only; Rust reads the inputs, never regenerates)

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
}

const gen = new Mulberry32(GENERATOR_SEED)
const ID_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_:-'
const HEX = '0123456789abcdef'

function hexSeed() {
  let out = ''
  for (let index = 0; index < 64; index += 1) out += HEX[gen.below(16)]
  return out
}

function anySeed() {
  switch (gen.below(6)) {
    case 0:
      return hexSeed().toUpperCase()
    case 1:
      return `seed-${gen.next()}`
    case 2:
      return 'ab'.repeat(32)
    default:
      return hexSeed()
  }
}

function d6Id() {
  const length = gen.between(1, 12)
  let out = ''
  for (let index = 0; index < length; index += 1) out += ID_ALPHABET[gen.below(ID_ALPHABET.length)]
  return out
}

/** Player id styles: user ids, `p<N>`, random D6 ids, and case/punctuation near-twins. */
function playerIds(count: number): string[] {
  const style = gen.below(5)
  const ids = new Set<string>()
  let guard = 0
  while (ids.size < count && guard++ < 10_000) {
    switch (style) {
      case 0:
        ids.add(String(gen.between(1, 2_000_000)))
        break
      case 1:
        ids.add(`p${gen.between(0, 40)}`)
        break
      case 2: {
        const base = ['a', 'A', 'b', 'B', '_', '-', ':', '0', '1', '9', 'a_', 'a-', 'a:', 'A1', 'a1', '10', '9a', 'Z', 'z']
        ids.add(gen.chance(70) ? gen.pick(base) + (gen.chance(50) ? gen.pick(base) : '') : d6Id())
        break
      }
      default:
        ids.add(d6Id())
    }
  }
  return [...ids]
}

const GHOST_NAME = 'Thomas'
const NAMES = ['An', 'Bình', 'Chi', 'Dũng', 'Thomas', 'thomas', 'Thomas ', 'Hà', 'Khoa', 'Linh', 'Minh', 'Nam', 'Phúc', 'Quân', 'Tú', 'Vy']

function seasonPlayers(count: number): Season3Player[] {
  const ids = new Set<number>()
  while (ids.size < count) ids.add(gen.chance(70) ? gen.between(1, 60) : gen.between(1, 2_147_483_647))
  return [...ids].map((userId) => ({
    userId,
    name: gen.chance(12) ? GHOST_NAME : gen.pick(NAMES),
  }))
}

/** A lobby size 2-16, weighted towards the real 4-12 range. */
function lobbySize() {
  return gen.chance(80) ? gen.between(2, 16) : gen.between(4, 12)
}

// ---------------------------------------------------------------------------
// Views: exact JSON.stringify text of each oracle result

function view(fn: () => unknown): string {
  try {
    return JSON.stringify(fn())
  } catch (error) {
    return JSON.stringify({ error: error instanceof Error ? error.message : String(error) })
  }
}

function streamRandom(rng: DeterministicRng) {
  return () => rng.next()
}

// ---------------------------------------------------------------------------
// Case kinds

type Case = Record<string, unknown> & { kind: string }

/** Raw chaos rule: prepare on a stream, then resolve a (possibly odd) ranking. */
function ruleCase(): Case {
  const type = gen.pick(CHAOS_RULE_IDS) as ChaosRuleId
  const size = gen.chance(90) ? lobbySize() : gen.between(0, 18)
  const players = playerIds(size)
  const seed = anySeed()
  const stream = gen.pick([`chaos:week:${gen.between(1, 52)}`, `chaos:manual:${gen.between(1, 52)}:${1_700_000_000_000 + gen.below(400_000_000) * 1000}`, `rule:${gen.next()}`])
  const rng = createRaceRng(seed, stream)
  const prepared = prepareChaosRule(type, players.map((playerId) => ({ playerId })), streamRandom(rng))
  const after = rng.nextUint32()

  // Ranking: the prepared lobby, with optional extras (ghosts), drops,
  // duplicate ranks and duplicate players.
  let rankingIds = gen.shuffle(players)
  if (gen.chance(15)) rankingIds.push(...playerIds(gen.between(1, 3)).filter((id) => !rankingIds.includes(id)))
  if (gen.chance(8) && rankingIds.length > 0) rankingIds = rankingIds.slice(0, gen.below(rankingIds.length))
  if (gen.chance(4) && rankingIds.length > 0) rankingIds.push(gen.pick(rankingIds))
  const rankMode = gen.below(10)
  const ranking: RawChaosEntry[] = rankingIds.map((playerId, index) => ({
    playerId,
    rank: rankMode < 6 ? index + 1 : rankMode < 9 ? gen.between(1, Math.max(1, Math.ceil(rankingIds.length / 2))) : gen.between(1, 40),
  }))
  const shuffledRanking = gen.shuffle(ranking)

  let override: { targetPlayerId: string | null; groups: string[][] | null } | null = null
  if (gen.chance(12)) {
    const pool = rankingIds.length > 0 ? rankingIds : ['x']
    const groupCount = gen.pick([0, 1, 2, 2, 3, 4])
    override = {
      targetPlayerId: gen.chance(30) ? null : gen.chance(70) ? gen.pick(pool) : d6Id(),
      groups: gen.chance(20)
        ? null
        : Array.from({ length: groupCount }, () => Array.from({ length: gen.between(0, 3) }, () => (gen.chance(90) ? gen.pick(pool) : d6Id()))),
    }
  }
  const resolveWith: ChaosPreparedState = override
    ? { targetPlayerId: override.targetPlayerId, groups: override.groups ?? undefined }
    : prepared

  return {
    kind: 'rule',
    type,
    seed,
    stream,
    players,
    ranking: shuffledRanking,
    override,
    expected: {
      prepared: JSON.stringify(prepared),
      after,
      resolve: view(() => resolveChaosRule(type, shuffledRanking, resolveWith)),
    },
  }
}

/** season3 resolve call shape: ranking by rank, ids as strings (resolveSeason3Race). */
function seasonResolve(card: ChaosCard, players: Season3Player[]) {
  const ranks = gen.shuffle(players.map((_, index) => index + 1))
  const ranking = players.map((player, index) => ({ userId: player.userId, rank: ranks[index]! }))
  ranking.sort((left, right) => left.rank - right.rank)
  const resolveText = view(() =>
    resolveChaosRule(
      card.type as ChaosRuleId,
      ranking.map((entry) => ({ playerId: String(entry.userId), rank: entry.rank })),
      {
        targetPlayerId: card.targetUserId === null ? null : String(card.targetUserId),
        groups: card.groups?.map((group) => group.map(String)),
      },
    ),
  )
  return { ranking, resolveText }
}

/** selectChaosCard on a weekly or manual stream (create-season / open-week RANDOM / set-chaos RANDOM). */
function selectCase(): Case {
  const players = seasonPlayers(gen.chance(2) ? 0 : lobbySize())
  const seed = anySeed()
  const weekNumber = gen.between(1, 52)
  const stream = gen.chance(70) ? `chaos:week:${weekNumber}` : `chaos:manual:${weekNumber}:${1_700_000_000_000 + gen.below(400_000_000) * 1000 + gen.below(1000)}`
  const rng = createRaceRng(seed, stream)
  let card: ChaosCard | null = null
  const cardText = view(() => (card = selectChaosCard(players, streamRandom(rng))))
  const after = rng.nextUint32()
  const resolved = card ? seasonResolve(card, players) : { ranking: [], resolveText: null }
  return { kind: 'select', seed, stream, players, ranking: resolved.ranking, expected: { card: cardText, after, resolve: resolved.resolveText } }
}

function requestedType(): ChaosType | null {
  return gen.chance(25) ? null : gen.pick(CHAOS_CARDS)
}

/** Admin `open-week` (route.ts:261-305) without manual overrides. */
function openWeekCase(): Case {
  const players = seasonPlayers(lobbySize())
  const seed = anySeed()
  const weekNumber = gen.between(1, 52)
  const requested = requestedType()
  const rng = createRaceRng(seed, `chaos:week:${weekNumber}`)
  const cardText = view(() =>
    requested === null ? selectChaosCard(players, streamRandom(rng)) : prepareChaosCard(requested, players, streamRandom(rng)),
  )
  return { kind: 'open-week', seed, weekNumber, requested, players, expected: { card: cardText, after: rng.nextUint32() } }
}

/** Admin `set-chaos` (route.ts:319-381) without manual overrides. */
function setChaosCase(): Case {
  const players = seasonPlayers(lobbySize())
  const seed = anySeed()
  const weekNumber = gen.between(1, 52)
  const ms = 1_700_000_000_000 + gen.below(400_000_000) * 1000 + gen.below(1000)
  const requested = requestedType()
  const rng = createRaceRng(seed, `chaos:manual:${weekNumber}:${ms}`)
  const cardText = view(() => {
    if (requested === null) return selectChaosCard(players, streamRandom(rng))
    let targetUserId: number | null = null
    let groups: number[][] | undefined = undefined
    if (requested === 'BOUNTY_HUNT') {
      targetUserId = prepareChaosCard('BOUNTY_HUNT', players, streamRandom(rng)).targetUserId
    } else if (requested === 'DUO' || requested === 'CONSTRUCTORS') {
      groups = prepareChaosCard(requested, players, streamRandom(rng)).groups
    }
    return { type: requested, targetUserId, targetUserId2: null, groups }
  })
  return { kind: 'set-chaos', seed, weekNumber, ms, requested, players, expected: { card: cardText, after: rng.nextUint32() } }
}

/** Admin `toggle-skip` (route.ts:384-405): discard one draw, re-prepare the persisted card. */
function toggleSkipCase(): Case {
  const players = seasonPlayers(lobbySize())
  const seed = anySeed()
  const weekNumber = gen.between(1, 52)
  const chaosType = gen.pick(CHAOS_CARDS)
  const rng = createRaceRng(seed, `chaos:week:${weekNumber}`)
  rng.next() // Keep the preparation stream aligned after the persisted card draw.
  const cardText = view(() => prepareChaosCard(chaosType, players, streamRandom(rng)))
  return { kind: 'toggle-skip', seed, weekNumber, chaosType, players, expected: { card: cardText, after: rng.nextUint32() } }
}

function autoLoadoutCase(): Case {
  const seed = anySeed()
  const playerId = gen.chance(70) ? String(gen.between(1, 2_000_000)) : d6Id()
  const items = selectAutoLoadout(seed, playerId)
  return { kind: 'auto-loadout', seed, playerId, expected: { items, validation: view(() => validateLoadoutView(items)) } }
}

function validateLoadoutView(itemIds: RaceItemId[]) {
  const result = validateLoadout(itemIds)
  return { items: result.items.map((item) => item.id), spent: result.spent, ready: result.ready }
}

function validateCase(): Case {
  const ids = RACE_ITEM_CATALOG.map((item) => item.id)
  const itemIds = Array.from({ length: gen.pick([0, 1, 2, 2, 2, 2, 3, 4]) }, () => gen.pick(ids))
  return { kind: 'validate', itemIds, expected: view(() => validateLoadoutView(itemIds)) }
}

// Mix per 100 cases.
const KINDS: Array<[number, () => Case]> = [
  [34, ruleCase],
  [18, selectCase],
  [10, openWeekCase],
  [10, setChaosCase],
  [10, toggleSkipCase],
  [10, autoLoadoutCase],
  [8, validateCase],
]

function hand(): Case[] {
  // Hand-written edges ahead of the generated cases.
  const cases: Case[] = []
  const raw8 = Array.from({ length: 8 }, (_, index) => ({ playerId: `p${index + 1}`, rank: index + 1 }))
  const fixed: Array<[ChaosRuleId, RawChaosEntry[], ChaosPreparedState]> = [
    ['DUO', raw8, { groups: [['p1', 'p8'], ['p3', 'p6'], ['p2', 'p4'], ['p5', 'p7']] }],
    ['DUO', raw8.slice(0, 4), { groups: [['p1', 'p4'], ['p2', 'p3']] }],
    ['DUO', raw8.slice(0, 5), { groups: [['p1', 'p2', 'p5'], ['p3', 'p4']] }],
    ['DUO', raw8, { groups: [[], ['p1'], ['p2', 'p3'], []] }],
    ['DUO', raw8, { groups: [] }],
    ['CONSTRUCTORS', raw8.slice(0, 4), { groups: [['p1', 'p4'], ['p2', 'p3']] }],
    ['CONSTRUCTORS', raw8.slice(0, 7), { groups: [['p1', 'p2', 'p7', 'p4'], ['p3', 'p5', 'p6']] }],
    ['CONSTRUCTORS', raw8, { groups: [['p1'], []] }],
    ['CONSTRUCTORS', raw8, { groups: [[], []] }],
    ['CONSTRUCTORS', raw8, { groups: [['p1']] }],
    ['BOUNTY_HUNT', raw8, { targetPlayerId: 'p4' }],
    ['BOUNTY_HUNT', raw8, { targetPlayerId: 'p5' }],
    ['BOUNTY_HUNT', raw8, { targetPlayerId: null }],
    ['NORMAL', raw8.slice(0, 1), {}],
    ['REVERSE', [{ playerId: 'a', rank: 1 }, { playerId: 'a', rank: 2 }], {}],
    ['CUT_LINE', [{ playerId: '10', rank: 4 }, { playerId: '4294967294', rank: 3 }, { playerId: '4294967295', rank: 2 }, { playerId: 'x', rank: 1 }, { playerId: '007', rank: 5 }, { playerId: '0', rank: 6 }, { playerId: '2', rank: 7 }], {}],
    ['TRIPLE_ELIMINATION', [{ playerId: 'b', rank: 1 }, { playerId: 'B', rank: 1 }, { playerId: '_', rank: 1 }, { playerId: 'a:', rank: 1 }, { playerId: 'a-', rank: 1 }], {}],
  ]
  for (const [type, ranking, prepared] of fixed) {
    const rng = createRaceRng('hand', 'hand')
    const preparedEmpty = prepareChaosRule(type, [], streamRandom(rng))
    cases.push({
      kind: 'rule',
      type,
      seed: 'hand',
      stream: 'hand',
      players: [],
      ranking,
      override: { targetPlayerId: prepared.targetPlayerId ?? null, groups: prepared.groups ?? null },
      expected: { prepared: JSON.stringify(preparedEmpty), after: rng.nextUint32(), resolve: view(() => resolveChaosRule(type, ranking, prepared)) },
    })
  }
  return cases
}

function main() {
  const { count, out } = parseArgs(process.argv.slice(2))
  const total = KINDS.reduce((sum, [weight]) => sum + weight, 0)
  const cases: Case[] = hand()
  for (let index = 0; index < count; index += 1) {
    let roll = gen.below(total)
    for (const [weight, make] of KINDS) {
      if (roll < weight) {
        cases.push(make())
        break
      }
      roll -= weight
    }
  }
  const oracleFiles = [
    'packages/race-core/src/chaos/index.ts',
    'packages/race-core/src/rng.ts',
    'packages/race-core/src/items/catalog.ts',
    'packages/race-core/src/items/loadout.ts',
    'lib/season3.ts',
    'lib/ghost-duck.ts',
    'lib/racing/loadout.ts',
  ]
  const fixture = {
    format: FORMAT,
    generator: GENERATOR,
    generatorSeed: GENERATOR_SEED,
    node: process.version,
    oracleSha256: Object.fromEntries(oracleFiles.map((file) => [file, createHash('sha256').update(readFileSync(join(repoRoot, file))).digest('hex')])),
    chaosCards: CHAOS_CARDS,
    catalog: RACE_ITEM_CATALOG,
    autoLoadoutPresets: AUTO_LOADOUT_PRESETS,
    cases,
  }
  const counts: Record<string, number> = {}
  for (const entry of cases) counts[entry.kind] = (counts[entry.kind] ?? 0) + 1
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, gzipSync(JSON.stringify(fixture), { level: 9 }))
  console.error(`wrote ${out}: ${cases.length} cases ${JSON.stringify(counts)}`)
}

main()
