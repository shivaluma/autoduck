/**
 * D6 collation oracle: generates the ICU key table for `race_core::collate_compat`
 * and the Node-signed fixtures that `crates/race-core/tests/collate.rs` checks.
 *
 *   node --import tsx scripts/oracle/collation-table.ts            # write table + fixtures
 *   node --import tsx scripts/oracle/collation-table.ts --check    # regenerate in memory, diff against disk
 *   node --import tsx scripts/oracle/collation-table.ts --pairs 1000000 --seed 0x5eedc011
 *
 * The TS engine sorts ids with `String.prototype.localeCompare` (host default locale). V8 maps ICU's
 * POSIX fallback (`LANG=C`, unset) to `en-US`, so production collates with ICU root rules. The table
 * is derived from `Intl.Collator('en')`, and every fixture sign is cross-checked against
 * `localeCompare` (default locale), `Intl.Collator()` (undefined), `Intl.Collator('en')` and
 * `Intl.Collator('vi')`. Any disagreement is recorded in `collate-meta.json` and fails the run.
 *
 * Outputs (all owned by the collate module):
 *   crates/race-core/src/collation_table.rs              primary/tertiary weights per ASCII byte
 *   crates/race-core/tests/fixtures/collate-pairs.bin    header + 2-bit packed localeCompare signs
 *   crates/race-core/tests/fixtures/collate-short.txt    every id of length <= 2, in Node sort order
 *   crates/race-core/tests/fixtures/collate-meta.json    Node/ICU versions, locale cross-check counts
 *
 * The pair stream is NOT stored: the Rust test regenerates it with the same xorshift32 generator
 * (spec "collate-gen-v1" below; keep `gen_*` in tests/collate.rs in lockstep) and proves it built the
 * same stream by matching the sha256 of `a\nb\n` over all pairs stored in the header.
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const TABLE_PATH = resolve(ROOT, 'crates/race-core/src/collation_table.rs')
const FIXTURE_DIR = resolve(ROOT, 'crates/race-core/tests/fixtures')
const PAIRS_PATH = resolve(FIXTURE_DIR, 'collate-pairs.bin')
const SHORT_PATH = resolve(FIXTURE_DIR, 'collate-short.txt')
const META_PATH = resolve(FIXTURE_DIR, 'collate-meta.json')

const GEN_VERSION = 'collate-gen-v1'
const MAGIC = 'COLLATE1'

// D6 id alphabet: ^[0-9A-Za-z_:-]{1,64}$
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_:-'
const MAX_ID_LEN = 64

// ---------------------------------------------------------------------------------------------
// CLI

const argv = process.argv.slice(2)
const flag = (name: string) => argv.includes(name)
const option = (name: string, fallback: string) => {
  const index = argv.indexOf(name)
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback
}
const CHECK = flag('--check')
const PAIR_COUNT = Number(option('--pairs', '1000000'))
const SEED = Number(option('--seed', '0x5eedc011')) >>> 0
if (!Number.isInteger(PAIR_COUNT) || PAIR_COUNT <= 0) throw new Error('--pairs must be a positive integer')
if (SEED === 0) throw new Error('--seed must be non-zero (xorshift32)')

// ---------------------------------------------------------------------------------------------
// Collators

const collators = {
  localeCompare: (a: string, b: string) => a.localeCompare(b),
  undefined: new Intl.Collator().compare,
  en: new Intl.Collator('en').compare,
  vi: new Intl.Collator('vi').compare,
} as const
type CollatorName = keyof typeof collators
const COLLATOR_NAMES = Object.keys(collators) as CollatorName[]
const oracle = collators.localeCompare
const sign = (value: number) => (value < 0 ? -1 : value > 0 ? 1 : 0)

// ---------------------------------------------------------------------------------------------
// Key table from Intl.Collator('en')

const base = new Intl.Collator('en', { sensitivity: 'base' }).compare
const accent = new Intl.Collator('en', { sensitivity: 'accent' }).compare
const order = [...ALPHABET].sort(collators.en)
const primary = new Array<number>(128).fill(0)
const tertiary = new Array<number>(128).fill(0)
{
  let rank = 0
  let within = 0
  for (let index = 0; index < order.length; index += 1) {
    const char = order[index]
    if (index === 0 || base(order[index - 1], char) !== 0) {
      rank += 1
      within = 0
    } else {
      // Same primary: the difference must be tertiary (case) only, never secondary.
      if (accent(order[index - 1], char) !== 0) throw new Error(`secondary difference between ${order[index - 1]} and ${char}`)
      if (collators.en(order[index - 1], char) >= 0) throw new Error(`no tertiary difference between ${order[index - 1]} and ${char}`)
      within += 1
    }
    primary[char.charCodeAt(0)] = rank
    tertiary[char.charCodeAt(0)] = within
  }
  for (const char of ALPHABET) {
    for (const name of COLLATOR_NAMES) {
      for (const other of ALPHABET) {
        const expected = sign(collators.en(char, other))
        if (sign(collators[name](char, other)) !== expected) throw new Error(`single-char order differs for ${name}: ${char} vs ${other}`)
      }
    }
  }
}

/** JS mirror of `collate_compat::compare`: primary pass, length, tertiary pass. */
function modelCompare(a: string, b: string): number {
  const shared = Math.min(a.length, b.length)
  for (let index = 0; index < shared; index += 1) {
    const left = primary[a.charCodeAt(index)]
    const right = primary[b.charCodeAt(index)]
    if (left !== right) return left < right ? -1 : 1
  }
  if (a.length !== b.length) return a.length < b.length ? -1 : 1
  for (let index = 0; index < shared; index += 1) {
    const left = tertiary[a.charCodeAt(index)]
    const right = tertiary[b.charCodeAt(index)]
    if (left !== right) return left < right ? -1 : 1
  }
  return 0
}

// ---------------------------------------------------------------------------------------------
// Exhaustive short-id check (model vs every collator), length <= 3

function allIds(maxLength: number): string[] {
  const out: string[] = []
  let layer = ['']
  for (let length = 1; length <= maxLength; length += 1) {
    const next: string[] = []
    for (const prefix of layer) for (const char of ALPHABET) next.push(prefix + char)
    for (const id of next) out.push(id)
    layer = next
  }
  return out
}

const exhaustive: Record<string, { ids: number; mismatches: number }> = {}
{
  const ids = allIds(3)
  const model = [...ids].sort(modelCompare)
  for (const name of COLLATOR_NAMES) {
    const sorted = [...ids].sort(collators[name])
    let mismatches = 0
    for (let index = 0; index < sorted.length; index += 1) {
      if (sorted[index] !== model[index]) mismatches += 1
      if (index > 0 && collators[name](sorted[index - 1], sorted[index]) >= 0) throw new Error(`${name}: tie or inversion at ${sorted[index - 1]} / ${sorted[index]}`)
    }
    exhaustive[name] = { ids: ids.length, mismatches }
  }
}

// ---------------------------------------------------------------------------------------------
// collate-gen-v1: deterministic pair generator. Mirror of `gen_*` in crates/race-core/tests/collate.rs.

const DIGITS = '0123456789'
const NONZERO = '123456789'
const HEX = '0123456789abcdef'
const SMALL = 'aAbB0_:-'
const PREP_ITEMS = ['NITRO', 'DRAFT_FIN', 'PADDLE_BURST', 'BUBBLE_SHIELD', 'FEATHER', 'SHOCK_ABSORBER', 'HOMING_ROCKET', 'BANANA', 'QUACK_HORN']
const WILD_ITEMS = ['MINI_NITRO', 'TAILWIND', 'MINI_BUBBLE', 'MINI_ROCKET', 'BANANA', 'QUACK_HORN', 'FEATHER', 'SLIPSTREAM_MAGNET', 'MAGNET']
const MISC = ['ghost', 'GHOST', 'Ghost', 'ghost-duck', '__ghost__', 'king', 'KING', 'race-lab-1', 'P', 'p', '_', '-', ':', '0']
const FORMAT_COUNT = 12

class XorShift32 {
  private state: number
  constructor(seed: number) {
    this.state = seed >>> 0
  }
  next(): number {
    let x = this.state
    x ^= x << 13
    x >>>= 0
    x ^= x >>> 17
    x ^= x << 5
    x >>>= 0
    this.state = x
    return x
  }
  below(n: number): number {
    return this.next() % n
  }
  pick<T>(items: readonly T[] | string): T {
    return items[this.below(items.length)] as T
  }
}

function genUserId(rng: XorShift32): string {
  const length = 1 + rng.below(9)
  let out = rng.pick<string>(NONZERO)
  for (let index = 1; index < length; index += 1) out += rng.pick<string>(DIGITS)
  return out
}

function genPickupId(rng: XorShift32): string {
  const kind = rng.below(2) === 0 ? 'box' : 'gold'
  const zone = 1 + rng.below(12)
  const anchor = 1 + rng.below(5)
  return `${kind}:pickup-zone-${zone}:z${zone}-a${anchor}`
}

function genRandom(rng: XorShift32, alphabet: string, maxLength: number): string {
  const length = 1 + rng.below(maxLength)
  let out = ''
  for (let index = 0; index < length; index += 1) out += rng.pick<string>(alphabet)
  return out
}

function genFormat(rng: XorShift32, format: number): string {
  switch (format) {
    case 0:
      return genUserId(rng)
    case 1:
      return `duck-${1 + rng.below(999)}`
    case 2:
      return `${rng.below(2) === 0 ? 'p' : 'P'}${1 + rng.below(99)}`
    case 3:
      return `prep:${rng.pick<string>(PREP_ITEMS)}`
    case 4:
      return `wild:${rng.pick<string>(WILD_ITEMS)}`
    case 5: {
      const race = genUserId(rng)
      const pickup = genPickupId(rng)
      const player = genUserId(rng)
      return `wild:${race}:${pickup}:${player}`
    }
    case 6: {
      const zone = 1 + rng.below(12)
      const anchor = 1 + rng.below(5)
      return `hazard:pickup-zone-${zone}:z${zone}-a${anchor}:${1 + rng.below(3)}`
    }
    case 7: {
      let out = ''
      for (const length of [8, 4, 4, 4, 12]) {
        if (out) out += '-'
        for (let index = 0; index < length; index += 1) out += rng.pick<string>(HEX)
      }
      return out
    }
    case 8:
      return genRandom(rng, ALPHABET, MAX_ID_LEN)
    case 9:
      return genRandom(rng, SMALL, 8)
    case 10: {
      const variant = rng.below(3)
      const n = 1 + rng.below(12)
      const m = 1 + rng.below(5)
      if (variant === 0) return `z${n}-a${m}`
      if (variant === 1) return `pickup-zone-${n}`
      return `gate-${n}-lane-${m}`
    }
    default:
      return rng.pick<string>(MISC)
  }
}

const isLetter = (char: string) => /[A-Za-z]/.test(char)
const flipCase = (char: string) => (char === char.toLowerCase() ? char.toUpperCase() : char.toLowerCase())

function genPair(rng: XorShift32): [string, string] {
  const format = rng.below(FORMAT_COUNT)
  const a = genFormat(rng, format)
  const chars = [...a]
  let b: string
  switch (rng.below(9)) {
    case 0:
      b = genFormat(rng, format)
      break
    case 1:
      b = genFormat(rng, rng.below(FORMAT_COUNT))
      break
    case 2:
      chars[rng.below(chars.length)] = rng.pick<string>(ALPHABET)
      b = chars.join('')
      break
    case 3:
      for (let index = 0; index < chars.length; index += 1) {
        if (isLetter(chars[index]) && rng.below(2) === 1) chars[index] = flipCase(chars[index])
      }
      b = chars.join('')
      break
    case 4:
      b = chars.length > 1 ? a.slice(0, 1 + rng.below(chars.length - 1)) : a + rng.pick<string>(ALPHABET)
      break
    case 5:
      if (chars.length < MAX_ID_LEN) {
        const extra = 1 + rng.below(Math.min(3, MAX_ID_LEN - chars.length))
        b = a
        for (let index = 0; index < extra; index += 1) b += rng.pick<string>(ALPHABET)
      } else {
        chars[chars.length - 1] = rng.pick<string>(ALPHABET)
        b = chars.join('')
      }
      break
    case 6:
      if (chars.length < MAX_ID_LEN) {
        const at = rng.below(chars.length + 1)
        chars.splice(at, 0, rng.pick<string>(ALPHABET))
      } else {
        chars[rng.below(chars.length)] = rng.pick<string>(ALPHABET)
      }
      b = chars.join('')
      break
    case 7:
      b = a
      break
    default: {
      const flip = rng.below(chars.length)
      chars[flip] = isLetter(chars[flip]) ? flipCase(chars[flip]) : rng.pick<string>(ALPHABET)
      chars[rng.below(chars.length)] = rng.pick<string>(ALPHABET)
      b = chars.join('')
    }
  }
  return rng.below(2) === 1 ? [b, a] : [a, b]
}

// ---------------------------------------------------------------------------------------------
// Fixtures

const ID_RE = /^[0-9A-Za-z_:-]{1,64}$/
const hash = createHash('sha256')
const packed = Buffer.alloc(Math.ceil(PAIR_COUNT / 4))
const disagreements: Record<CollatorName, number> = { localeCompare: 0, undefined: 0, en: 0, vi: 0 }
const modelMismatches: string[] = []
let modelMismatchCount = 0
const signCounts = { less: 0, equal: 0, greater: 0 }
let invalidIds = 0
let byteOrderDiffers = 0
{
  const rng = new XorShift32(SEED)
  for (let index = 0; index < PAIR_COUNT; index += 1) {
    const [a, b] = genPair(rng)
    hash.update(`${a}\n${b}\n`)
    if (!ID_RE.test(a)) invalidIds += 1
    if (!ID_RE.test(b)) invalidIds += 1
    const expected = sign(oracle(a, b))
    for (const name of COLLATOR_NAMES) if (sign(collators[name](a, b)) !== expected) disagreements[name] += 1
    if (modelCompare(a, b) !== expected) {
      modelMismatchCount += 1
      if (modelMismatches.length < 20) modelMismatches.push(`${a}\t${b}\t${expected}`)
    }
    const bytes = a < b ? -1 : a > b ? 1 : 0
    if (bytes !== expected) byteOrderDiffers += 1
    const code = expected < 0 ? 1 : expected > 0 ? 2 : 0
    if (code === 1) signCounts.less += 1
    else if (code === 2) signCounts.greater += 1
    else signCounts.equal += 1
    packed[index >> 2] |= code << ((index & 3) * 2)
  }
}
const streamSha = hash.digest()

const header = Buffer.alloc(8 + 4 + 4 + 32)
header.write(MAGIC, 0, 'ascii')
header.writeUInt32LE(SEED, 8)
header.writeUInt32LE(PAIR_COUNT, 12)
streamSha.copy(header, 16)
const pairsBin = Buffer.concat([header, packed])

const shortIds = allIds(2).sort(oracle)
const shortTxt = `${shortIds.join('\n')}\n`

const hex = (values: number[]) => {
  const rows: string[] = []
  for (let index = 0; index < values.length; index += 16) {
    rows.push(`    ${values.slice(index, index + 16).map((value) => `${value},`).join(' ')}`)
  }
  return rows.join('\n')
}
const tableRs = `// @generated by scripts/oracle/collation-table.ts. Do not edit.
// Node ${process.version}, ICU ${process.versions.icu}, Unicode ${process.versions.unicode}, CLDR ${process.versions.cldr}.
// Source collator: Intl.Collator('en') (ICU root rules for ASCII), checked against
// localeCompare, Intl.Collator(undefined) and Intl.Collator('vi').

/// Id alphabet in ICU collation order (case pairs adjacent, lowercase first).
pub(super) const ORDER: &str = ${JSON.stringify(order.join(''))};

/// Primary weight per ASCII byte (1-based rank of the primary class). 0 = not in the id alphabet.
#[rustfmt::skip]
pub(super) const PRIMARY: [u8; 128] = [
${hex(primary)}
];

/// Tertiary weight per ASCII byte within its primary class: 0 = lowercase or uncased, 1 = uppercase.
#[rustfmt::skip]
pub(super) const TERTIARY: [u8; 128] = [
${hex(tertiary)}
];
`

const meta = {
  generator: GEN_VERSION,
  node: process.version,
  icu: process.versions.icu,
  unicode: process.versions.unicode,
  cldr: process.versions.cldr,
  defaultLocale: new Intl.Collator().resolvedOptions().locale,
  sourceCollator: 'en',
  seed: `0x${SEED.toString(16)}`,
  pairs: PAIR_COUNT,
  streamSha256: streamSha.toString('hex'),
  signs: signCounts,
  invalidIds,
  byteOrderDiffersFromLocaleCompare: byteOrderDiffers,
  collatorDisagreementsWithLocaleCompare: disagreements,
  jsModelMismatches: modelMismatchCount,
  exhaustiveUpToLength3: exhaustive,
  order: order.join(''),
}
const metaJson = `${JSON.stringify(meta, null, 2)}\n`

// The default locale (LANG) is not part of the committed metadata diff: --check ignores it.
const comparableMeta = (text: string) => {
  const parsed = JSON.parse(text) as Record<string, unknown>
  delete parsed.defaultLocale
  return JSON.stringify(parsed)
}

const failures: string[] = []
for (const name of COLLATOR_NAMES) if (disagreements[name] > 0) failures.push(`${name} disagrees with localeCompare on ${disagreements[name]} pairs`)
for (const name of COLLATOR_NAMES) if (exhaustive[name].mismatches > 0) failures.push(`model differs from ${name} on ${exhaustive[name].mismatches} short ids`)
if (modelMismatchCount > 0) failures.push(`JS model mismatches on ${modelMismatchCount} pairs:\n${modelMismatches.join('\n')}`)

if (CHECK) {
  const read = (path: string) => {
    try {
      return readFileSync(path)
    } catch {
      return Buffer.alloc(0)
    }
  }
  if (!read(TABLE_PATH).equals(Buffer.from(tableRs))) failures.push(`${TABLE_PATH} is stale`)
  if (!read(PAIRS_PATH).equals(pairsBin)) failures.push(`${PAIRS_PATH} is stale`)
  if (!read(SHORT_PATH).equals(Buffer.from(shortTxt))) failures.push(`${SHORT_PATH} is stale`)
  const onDisk = read(META_PATH).toString()
  if (!onDisk || comparableMeta(onDisk) !== comparableMeta(metaJson)) failures.push(`${META_PATH} is stale`)
} else {
  mkdirSync(FIXTURE_DIR, { recursive: true })
  writeFileSync(TABLE_PATH, tableRs)
  writeFileSync(PAIRS_PATH, pairsBin)
  writeFileSync(SHORT_PATH, shortTxt)
  writeFileSync(META_PATH, metaJson)
}

console.log(JSON.stringify({ ...meta, mode: CHECK ? 'check' : 'write' }, null, 2))
if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}
