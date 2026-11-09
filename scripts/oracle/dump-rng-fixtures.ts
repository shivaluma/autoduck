/**
 * Dumps the RNG parity fixtures for the Rust port (`crates/race-core/src/rng.rs`,
 * plan D5) from the TS oracle `packages/race-core/src/rng.ts`.
 *
 *   node --import tsx scripts/oracle/dump-rng-fixtures.ts [outDir]
 *
 * Writes (default outDir `crates/race-core/tests/fixtures`):
 *
 * - `rng-hash.json.gz`: `hashString` over 1,000,000 strings from the
 *   deterministic generator `strgen-v1` (ported in `crates/race-core/tests/rng.rs`),
 *   checked per 1,000-string chunk by sha256 digests, plus explicit samples
 *   (first 2,000 and every 500th) and curated edge cases (empty, ASCII,
 *   Vietnamese NFC/NFD, emoji, lone surrogates). Strings are stored as UTF-16
 *   code-unit arrays because JSON cannot carry lone surrogates into Rust.
 * - `rng-streams.json.gz`: 10,000 `createRaceRng(seed, stream)` cases with the
 *   first 8 `next()` outputs as f64 bit-hex, then `range`/`integer` calls, plus
 *   a `meta` block for the season meta streams (`chaos:week:N`,
 *   `chaos:manual:N:<ms>`, `auto-loadout:<id>`).
 *
 * The oracle is never modified. `hashString` is module-private, so this script
 * loads a verbatim copy of `rng.ts` with one appended export line from a temp
 * directory, and cross-checks that copy against the real module's exports.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'
import { createRaceRng, DeterministicRng } from '../../packages/race-core/src/rng'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const oraclePath = join(repoRoot, 'packages/race-core/src/rng.ts')
const outDir = resolve(process.argv[2] ?? join(repoRoot, 'crates/race-core/tests/fixtures'))

const HASH_COUNT = 1_000_000
const CHUNK_SIZE = 1_000
const STRGEN_SEED = 0x5eed_d0c5
const STREAM_CASES = 10_000
const STREAMGEN_SEED = 0x0dd5_eed5

// ---------------------------------------------------------------------------
// Oracle access

const oracleSource = readFileSync(oraclePath, 'utf8')
const oracleSha256 = createHash('sha256').update(oracleSource).digest('hex')

async function loadOracleHashString(): Promise<(value: string) => number> {
  const dir = mkdtempSync(join(tmpdir(), 'rng-oracle-'))
  try {
    const copy = join(dir, 'rng-oracle-copy.ts')
    writeFileSync(copy, `${oracleSource}\nexport { hashString as __oracleHashString }\n`)
    const oracleCopy = (await import(pathToFileURL(copy).href)) as {
      __oracleHashString: (value: string) => number
      DeterministicRng: typeof DeterministicRng
    }
    // The copy must behave exactly like the real module.
    for (const probe of ['', 'a', 'seed:stream', 'Đua dzịt 🦆', '\ud800', 'x\udfff']) {
      const real = new DeterministicRng(probe)
      const copied = new oracleCopy.DeterministicRng(probe)
      for (let index = 0; index < 4; index += 1) {
        if (real.nextUint32() !== copied.nextUint32()) throw new Error('oracle copy diverges from rng.ts')
      }
    }
    return oracleCopy.__oracleHashString
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// strgen-v1: deterministic UTF-16 string generator. Integer-only so the Rust
// test ports it exactly. Do not change without bumping the generator name.

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

  /** Uniform-ish integer in [0, n) by modulo; n in [1, 2^32]. */
  below(n: number) {
    return this.next() % n
  }
}

type CharClass = { astral: boolean; ranges: Array<[number, number]> }

const CLASSES: CharClass[] = [
  { astral: false, ranges: [[0x20, 0x7e]] }, // 0 ASCII printable
  { astral: false, ranges: [[0x61, 0x7a], [0x30, 0x39]] }, // 1 lowercase + digits
  { astral: false, ranges: [[0x3a, 0x3a], [0x2d, 0x2d], [0x5f, 0x5f], [0x20, 0x20], [0x2f, 0x2f]] }, // 2 separators
  { astral: false, ranges: [[0xc0, 0xff]] }, // 3 Latin-1 letters
  { astral: false, ranges: [[0x1ea0, 0x1ef9]] }, // 4 Vietnamese precomposed
  { astral: false, ranges: [[0x102, 0x103], [0x110, 0x111], [0x128, 0x129], [0x168, 0x169], [0x1a0, 0x1a1], [0x1af, 0x1b0]] }, // 5 Vietnamese misc
  { astral: false, ranges: [[0x300, 0x323]] }, // 6 combining marks (NFD)
  { astral: false, ranges: [[0x4e00, 0x9fff]] }, // 7 CJK
  { astral: false, ranges: [[0xac00, 0xd7a3]] }, // 8 Hangul
  { astral: true, ranges: [[0x1f300, 0x1faff], [0x1f1e6, 0x1f1ff]] }, // 9 emoji (surrogate pairs)
  { astral: true, ranges: [[0x10000, 0x10ffff]] }, // 10 any astral
  { astral: false, ranges: [[0xd800, 0xdbff]] }, // 11 lone high surrogate
  { astral: false, ranges: [[0xdc00, 0xdfff]] }, // 12 lone low surrogate
  { astral: false, ranges: [[0x0000, 0xffff]] }, // 13 any code unit
  { astral: false, ranges: [[0x00, 0x1f], [0x7f, 0x9f]] }, // 14 control
  { astral: false, ranges: [[0xfeff, 0xfeff], [0xfffd, 0xffff], [0x200b, 0x200d]] }, // 15 BMP specials
]

const PROFILES: number[][] = [
  [0, 1, 1, 2], // ASCII
  [0, 1, 3, 4, 4, 5, 6, 2], // Vietnamese
  [0, 1, 9, 9, 10, 4], // emoji
  [0, 11, 12, 13, 9, 10], // surrogate chaos
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], // everything
  [7, 8, 0, 2], // CJK / Hangul
  [1, 1, 1, 2], // label-like
  // 7: a single class, chosen per string
]

function pushFromClass(rng: Mulberry32, classIndex: number, units: number[]) {
  const charClass = CLASSES[classIndex]!
  const [lo, hi] = charClass.ranges[rng.below(charClass.ranges.length)]!
  const value = lo + rng.below(hi - lo + 1)
  if (charClass.astral) {
    const offset = value - 0x10000
    units.push(0xd800 + (offset >>> 10), 0xdc00 + (offset & 0x3ff))
  } else {
    units.push(value)
  }
}

function generateUnits(rng: Mulberry32): number[] {
  const lengthRoll = rng.below(100)
  let length: number
  if (lengthRoll < 1) length = 0
  else if (lengthRoll < 40) length = 1 + rng.below(8)
  else if (lengthRoll < 85) length = 1 + rng.below(40)
  else if (lengthRoll < 98) length = 1 + rng.below(200)
  else length = 1 + rng.below(2000)

  const profileIndex = rng.below(PROFILES.length + 1)
  const profile = profileIndex < PROFILES.length ? PROFILES[profileIndex]! : [rng.below(CLASSES.length)]
  const units: number[] = []
  while (units.length < length) {
    pushFromClass(rng, profile[rng.below(profile.length)]!, units)
  }
  return units
}

function unitsToString(units: number[]) {
  let value = ''
  for (let index = 0; index < units.length; index += 4096) {
    value += String.fromCharCode(...units.slice(index, index + 4096))
  }
  return value
}

// ---------------------------------------------------------------------------
// Hash fixture

function u32le(values: number[]) {
  const buffer = Buffer.alloc(values.length * 4)
  values.forEach((value, index) => buffer.writeUInt32LE(value >>> 0, index * 4))
  return buffer
}

function unitsDigestUpdate(hash: ReturnType<typeof createHash>, units: number[]) {
  const buffer = Buffer.alloc(4 + units.length * 2)
  buffer.writeUInt32LE(units.length, 0)
  units.forEach((unit, index) => buffer.writeUInt16LE(unit, 4 + index * 2))
  hash.update(buffer)
}

const EDGE_CASES: string[] = [
  '',
  'a',
  'seed',
  'seed:stream',
  ':',
  '\u0000',
  'chaos:week:1',
  'chaos:week:3',
  'auto-loadout:clx9z8y7w6v5u4t3s2r1q0p9',
  'Đua dzịt',
  'ĐUA DZỊT',
  'Nguyễn Văn Thành',
  'Nguyễn', // NFD
  'Tiếng Việt có dấu: ắằẳẵặ ấầẩẫậ ếềểễệ ốồổỗộ ớờởỡợ ứừửữự',
  '🦆',
  '🦆🦆🦆',
  '👨‍👩‍👧‍👦',
  '🇻🇳',
  '\ud83e', // lone high
  '\udd86', // lone low
  '\udd86\ud83e', // reversed pair
  'a\ud800b',
  'x\udfff',
  '\ud800\ud800',
  '\udc00\udc00',
  '￿￾﻿',
  'x'.repeat(10_000),
  '🦆'.repeat(5_000),
]

function stringToUnits(value: string) {
  const units: number[] = []
  for (let index = 0; index < value.length; index += 1) units.push(value.charCodeAt(index))
  return units
}

function buildHashFixture(hashString: (value: string) => number) {
  const rng = new Mulberry32(STRGEN_SEED)
  const chunkHashDigests: string[] = []
  const chunkUnitsDigests: string[] = []
  const samples: Array<{ index: number; units: number[]; hash: number }> = []
  let chunkHashes: number[] = []
  let chunkUnits = createHash('sha256')
  const stats = { totalUnits: 0, empty: 0, loneSurrogateStrings: 0, astralStrings: 0 }

  for (let index = 0; index < HASH_COUNT; index += 1) {
    const units = generateUnits(rng)
    const value = unitsToString(units)
    const hash = hashString(value)
    chunkHashes.push(hash)
    unitsDigestUpdate(chunkUnits, units)
    stats.totalUnits += units.length
    if (units.length === 0) stats.empty += 1
    if (!value.isWellFormed()) stats.loneSurrogateStrings += 1
    else if (/[\ud800-\udbff]/.test(value)) stats.astralStrings += 1
    if (index < 2_000 || index % 500 === 499) samples.push({ index, units, hash })
    if (chunkHashes.length === CHUNK_SIZE) {
      chunkHashDigests.push(createHash('sha256').update(u32le(chunkHashes)).digest('hex'))
      chunkUnitsDigests.push(chunkUnits.digest('hex'))
      chunkHashes = []
      chunkUnits = createHash('sha256')
    }
  }
  if (chunkHashes.length > 0) throw new Error('HASH_COUNT must be a multiple of CHUNK_SIZE')

  return {
    format: 'rng-hash/1',
    oracle: 'packages/race-core/src/rng.ts',
    oracleSha256,
    generator: 'strgen-v1',
    generatorSeed: STRGEN_SEED,
    count: HASH_COUNT,
    chunkSize: CHUNK_SIZE,
    stats,
    edgeCases: EDGE_CASES.map((value) => ({ units: stringToUnits(value), hash: hashString(value) })),
    samples,
    // sha256 over each chunk's hashes as u32 LE.
    chunkHashDigests,
    // sha256 over each chunk's strings as (u32 LE length, u16 LE units...).
    chunkUnitsDigests,
  }
}

// ---------------------------------------------------------------------------
// Stream fixture

function f64Hex(value: number) {
  const view = new DataView(new ArrayBuffer(8))
  view.setFloat64(0, value)
  return view.getBigUint64(0).toString(16).padStart(16, '0')
}

const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz'

function base36(rng: Mulberry32, length: number) {
  let value = ''
  for (let index = 0; index < length; index += 1) value += BASE36[rng.below(36)]
  return value
}

function cuid(rng: Mulberry32) {
  return `c${base36(rng, 24)}`
}

function uuid(rng: Mulberry32) {
  const hex = () => rng.next().toString(16).padStart(8, '0')
  const a = hex()
  const b = hex()
  const c = hex()
  const d = hex()
  return `${a}-${b.slice(0, 4)}-4${b.slice(5, 8)}-${'89ab'[rng.below(4)]}${c.slice(1, 4)}-${c.slice(4)}${d}`
}

function wellFormedText(rng: Mulberry32) {
  for (;;) {
    const units = generateUnits(rng)
    const value = unitsToString(units)
    if (value.isWellFormed()) return value
  }
}

function makeSeed(rng: Mulberry32) {
  switch (rng.below(8)) {
    case 0:
    case 1:
    case 2:
      return cuid(rng)
    case 3:
      return uuid(rng)
    case 4:
      return `${rng.below(100_000)}`
    case 5:
      return `${rng.next()}${rng.next()}`
    case 6:
      return rng.below(20) === 0 ? '' : wellFormedText(rng)
    default:
      return `season-3:${['Đua dzịt', 'tuần', '🦆', 'race'][rng.below(4)]}:${rng.below(1000)}`
  }
}

function makeStream(rng: Mulberry32) {
  const raceId = cuid(rng)
  const playerId = cuid(rng)
  switch (rng.below(16)) {
    case 0:
      return 'track:start'
    case 1:
      return `duck:${playerId}`
    case 2:
      return `auto-use-delay:${raceId}:${playerId}:${rng.below(20_000)}`
    case 3:
      return `auto-use-cooldown:${raceId}:${playerId}:${rng.below(20_000)}`
    case 4:
      return `temperament:${raceId}:${playerId}`
    case 5:
      return `pickup-spawn:${raceId}`
    case 6:
      return `gold-box:${raceId}`
    case 7:
      return `hazards:${raceId}`
    case 8:
      return `pickup-loot:${raceId}:pickup-${rng.below(64)}:${playerId}`
    case 9:
    case 10:
      return `auto-loadout:${playerId}`
    case 11:
    case 12:
      return `chaos:week:${1 + rng.below(60)}`
    case 13:
      return `chaos:manual:${1 + rng.below(60)}:${1_700_000_000_000 + rng.below(100_000_000) * 1000 + rng.below(1000)}`
    case 14:
      return ['balance-matrix:MIXED', 'track:start', 'manual-approximation', ''][rng.below(4)]!
    default:
      return wellFormedText(rng)
  }
}

type Op =
  | { op: 'range'; a: string; b: string; out: string }
  | { op: 'integer'; a: number; b: number; out: number }

const SPECIAL_RANGES: Array<[number, number]> = [
  [0, 1],
  [-0, 0],
  [5, 5],
  [1, 0],
  [0, 1e-300],
  [-1e308, 1e308],
  [1e308, -1e308],
  [0.1, 0.7],
  [-Math.PI, Math.E],
]

const SPECIAL_INTEGERS: Array<[number, number]> = [
  [0, 0],
  [0, 1],
  [3, 3],
  [-50, 50],
  [0, 2 ** 31],
  [-(2 ** 40), 2 ** 40],
  [5, 2],
]

function makeOps(rng: Mulberry32, sim: DeterministicRng): Op[] {
  const ops: Op[] = []
  for (let index = 0; index < 3; index += 1) {
    let a: number
    let b: number
    if (rng.below(4) === 0) {
      ;[a, b] = SPECIAL_RANGES[rng.below(SPECIAL_RANGES.length)]!
    } else {
      a = (rng.next() / 0x100000000) * 2000 - 1000
      b = a + (rng.next() / 0x100000000) * 500
    }
    ops.push({ op: 'range', a: f64Hex(a), b: f64Hex(b), out: f64Hex(sim.range(a, b)) })
  }
  for (let index = 0; index < 3; index += 1) {
    let a: number
    let b: number
    if (rng.below(4) === 0) {
      ;[a, b] = SPECIAL_INTEGERS[rng.below(SPECIAL_INTEGERS.length)]!
    } else {
      a = rng.below(3) === 0 ? -rng.below(1000) || 0 : 0
      b = a + rng.below(100)
    }
    ops.push({ op: 'integer', a, b, out: sim.integer(a, b) })
  }
  return ops
}

function runCase(seed: string, stream: string, opsRng: Mulberry32) {
  const sim = createRaceRng(seed, stream)
  const next: string[] = []
  for (let index = 0; index < 8; index += 1) next.push(f64Hex(sim.next()))
  const ops = makeOps(opsRng, sim)
  return { seed, stream, next, ops }
}

const META_SEEDS = ['', '42', 'season-3', 'clx0s3chaosseed000000000', 'cm3k9x2b40000qz8w1v7d5e6f']
const META_STREAMS = [
  'chaos:week:1',
  'chaos:week:2',
  'chaos:week:3',
  'chaos:week:12',
  'chaos:week:52',
  'chaos:manual:3:1731234567890',
  'chaos:manual:12:1762646400000',
  'auto-loadout:cm3k9x2b40001qz8wabcdefgh',
  'auto-loadout:',
]

function buildStreamFixture() {
  const rng = new Mulberry32(STREAMGEN_SEED)
  const cases = []
  for (let index = 0; index < STREAM_CASES; index += 1) {
    const seed = makeSeed(rng)
    const stream = makeStream(rng)
    cases.push(runCase(seed, stream, rng))
  }
  const metaRng = new Mulberry32(STREAMGEN_SEED ^ 0xffff_ffff)
  const meta = []
  for (const seed of META_SEEDS) {
    for (const stream of META_STREAMS) meta.push(runCase(seed, stream, metaRng))
  }
  return {
    format: 'rng-streams/1',
    oracle: 'packages/race-core/src/rng.ts',
    oracleSha256,
    count: cases.length,
    cases,
    meta,
  }
}

// ---------------------------------------------------------------------------

async function main() {
  const hashString = await loadOracleHashString()

  mkdirSync(outDir, { recursive: true })

  const started = Date.now()
  const hashFixture = buildHashFixture(hashString)
  const hashPath = join(outDir, 'rng-hash.json.gz')
  writeFileSync(hashPath, gzipSync(JSON.stringify(hashFixture), { level: 9 }))

  const streamFixture = buildStreamFixture()
  const streamPath = join(outDir, 'rng-streams.json.gz')
  writeFileSync(streamPath, gzipSync(JSON.stringify(streamFixture), { level: 9 }))

  console.log(
    JSON.stringify(
      {
        oracleSha256,
        hash: { path: hashPath, count: hashFixture.count, stats: hashFixture.stats, samples: hashFixture.samples.length },
        streams: { path: streamPath, cases: streamFixture.cases.length, meta: streamFixture.meta.length },
        ms: Date.now() - started,
      },
      null,
      2,
    ),
  )
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
