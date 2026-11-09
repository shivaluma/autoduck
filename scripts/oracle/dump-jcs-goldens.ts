/**
 * JCS (RFC 8785) golden dump for the Rust writer in
 * `crates/race-core/src/canonical.rs` (plan D9, Phase 1).
 *
 *   node --import tsx scripts/oracle/dump-jcs-goldens.ts \
 *     [--out crates/race-core/tests/fixtures/jcs-goldens.jsonl] [--seed 8785]
 *
 * The reference is plain ECMAScript, not `lib/racing/audit.ts`
 * `canonicalize` (that one sorts keys with the default comparator on JS
 * objects and emits a literal `undefined` token, see D9):
 *   - numbers: `JSON.stringify(x)` (Number::toString; `-0` -> `0`), checked
 *     against `String(x)`; non-finite numbers are never generated;
 *   - strings: `JSON.stringify(s)` (well-formed; lone surrogates are never
 *     generated because a Rust `&str` cannot hold them);
 *   - objects: members sorted by UTF-16 code units (JS `<` on strings),
 *     `key:value` joined with `,`, no whitespace;
 *   - arrays: elements in order joined with `,`.
 *
 * Each line is one case:
 *   {"id":n,"kind":"number"|"string"|"tree","input":<node>,"jcs":"...","sha256":"..."}
 * where <node> is a typed tree so the Rust test can drive the writer without
 * `serde_json::Value`:
 *   {"t":"n","b":"<16 hex digits, f64 bits>"} | {"t":"s","v":"..."} |
 *   {"t":"b","v":true} | {"t":"z"} | {"t":"a","v":[node,...]} |
 *   {"t":"o","v":[["key",node],...]}   (object members in *unsorted* order)
 *
 * Output is deterministic for a given seed.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

type Node =
  | { t: 'n'; b: string }
  | { t: 's'; v: string }
  | { t: 'b'; v: boolean }
  | { t: 'z' }
  | { t: 'a'; v: Node[] }
  | { t: 'o'; v: [string, Node][] }

type Kind = 'number' | 'string' | 'tree'

// ---------------------------------------------------------------- arguments

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const OUT = resolve(arg('--out', 'crates/race-core/tests/fixtures/jcs-goldens.jsonl'))
const SEED = Number(arg('--seed', '8785')) >>> 0
const TOTAL = 10_000
const N_NUMBERS = 4_000
const N_STRINGS = 2_000

// --------------------------------------------------------------------- rng

let rngState = SEED || 1
function u32(): number {
  // xorshift32, deterministic and dependency-free.
  let x = rngState
  x ^= x << 13
  x >>>= 0
  x ^= x >>> 17
  x ^= x << 5
  x >>>= 0
  rngState = x
  return x
}
function below(n: number): number {
  return u32() % n
}
function chance(p: number): boolean {
  return u32() / 0x1_0000_0000 < p
}
function pick<T>(xs: readonly T[]): T {
  return xs[below(xs.length)]
}

// ------------------------------------------------------------ f64 <-> bits

const view = new DataView(new ArrayBuffer(8))
function bitsOf(x: number): string {
  view.setFloat64(0, x)
  return view.getBigUint64(0).toString(16).padStart(16, '0')
}
function fromBits(hex: string): number {
  view.setBigUint64(0, BigInt(`0x${hex}`))
  return view.getFloat64(0)
}
function nextUp(x: number, steps = 1): number {
  // Walks `steps` ulps towards +Infinity (or -Infinity for negative steps).
  view.setFloat64(0, x)
  let b = view.getBigInt64(0)
  for (let i = 0; i < Math.abs(steps); i++) {
    const up = steps > 0
    if (b === 0n || b === -0x8000000000000000n) b = up ? 1n : -0x7fffffffffffffffn
    else if ((b >= 0n) === up) b += 1n
    else b -= 1n
  }
  view.setBigInt64(0, b)
  return view.getFloat64(0)
}

// --------------------------------------------------------------- reference

function utf16Compare(a: string, b: string): number {
  // JS relational comparison on strings is by UTF-16 code units (RFC 8785 3.2.3).
  return a < b ? -1 : a > b ? 1 : 0
}

function reference(node: Node): string {
  switch (node.t) {
    case 'z':
      return 'null'
    case 'b':
      return node.v ? 'true' : 'false'
    case 'n': {
      const x = fromBits(node.b)
      if (!Number.isFinite(x)) throw new Error(`non-finite number in golden: ${node.b}`)
      const s = JSON.stringify(x)
      if (s !== String(x === 0 ? 0 : x)) throw new Error(`String/JSON.stringify disagree for ${node.b}`)
      return s
    }
    case 's':
      return JSON.stringify(node.v)
    case 'a':
      return `[${node.v.map(reference).join(',')}]`
    case 'o': {
      const members = [...node.v].sort((x, y) => utf16Compare(x[0], y[0]))
      for (let i = 1; i < members.length; i++) {
        if (members[i - 1][0] === members[i][0]) throw new Error(`duplicate key ${members[i][0]}`)
      }
      return `{${members.map(([k, v]) => `${JSON.stringify(k)}:${reference(v)}`).join(',')}}`
    }
  }
}

// ------------------------------------------------------------------ numbers

const num = (x: number): Node => ({ t: 'n', b: bitsOf(x) })
const numBits = (hex: string): Node => ({ t: 'n', b: hex })

function randomFiniteBits(): string {
  for (;;) {
    const hi = u32()
    const lo = u32()
    const hex = hi.toString(16).padStart(8, '0') + lo.toString(16).padStart(8, '0')
    if (Number.isFinite(fromBits(hex))) return hex
  }
}

function randomSubnormalBits(): string {
  const sign = chance(0.5) ? 0x80000000 : 0
  const hi = (sign | below(0x00100000)) >>> 0 // exponent 0
  const lo = u32()
  return hi.toString(16).padStart(8, '0') + lo.toString(16).padStart(8, '0')
}

function random17Digits(): number {
  let digits = String(1 + below(9))
  for (let i = 0; i < 16; i++) digits += String(below(10))
  const exp = below(61) - 30
  const x = Number(`${digits[0]}.${digits.slice(1)}e${exp}`)
  return chance(0.3) ? -x : x
}

function numberCases(): Node[] {
  const out: Node[] = []
  const fixed: number[] = [
    0, -0, 1, -1, 2, 10, 100, 0.5, 0.1, 0.2, 0.1 + 0.2, 0.3, 1 / 3, 2 / 3, Math.PI, Math.E,
    1e21, -1e21, 1e20, 1e22, 1e23, 1e-6, 1e-7, 5e-7, -5e-7, 0.000001, 0.0000001,
    123456789012345680000, 999999999999999900000, 1.5e300, 1e308, 1e-300, 1e-323,
    Number.MAX_VALUE, -Number.MAX_VALUE, Number.MIN_VALUE, -Number.MIN_VALUE,
    Number.EPSILON, 1 + Number.EPSILON, 2.2250738585072014e-308, 2.225073858507201e-308,
    2 ** 53, 2 ** 53 - 1, 2 ** 53 + 2, -(2 ** 53), -(2 ** 53 - 1), 2 ** 53 + 1 /* rounds to 2^53 */,
    Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER, 2 ** 31, 2 ** 31 - 1, -(2 ** 31), 2 ** 32, 2 ** 32 - 1,
    2 ** 63, 2 ** 64, 2 ** 70, 2 ** 1023, 2 ** -1022, 2 ** -1074,
    9007199254740993, 4.35, 0.07, 1.005, 16.67, 1000 / 60, 1 / 60, 60, 3600000,
    1.7976931348623157e308, 4.9406564584124654e-324,
  ]
  for (const x of fixed) out.push(num(x))
  // RFC 8785 Appendix B sample bit patterns.
  const rfc = [
    '0000000000000000', '8000000000000000', '0000000000000001', '8000000000000001',
    '7fefffffffffffff', 'ffefffffffffffff', '4340000000000000', 'c340000000000000',
    '4430000000000000', '44b52d02c7e14af5', '44b52d02c7e14af6', '44b52d02c7e14af7',
    '444b1ae4d6e2ef4e', '444b1ae4d6e2ef4f', '444b1ae4d6e2ef50', '3eb0c6f7a0b5ed8c',
    '3eb0c6f7a0b5ed8d', '41b3de4355555553', '41b3de4355555554', '41b3de4355555555',
    '41b3de4355555556', '41b3de4355555557', 'becbf647612f3696', '43143ff3c1cb0959',
  ]
  for (const b of rfc) out.push(numBits(b))
  // Ulp neighbours of the formatting boundaries and of every power of ten.
  const anchors = [1e21, 1e-6, 1e-7, 5e-7, 2 ** 53, 1, 0.1]
  for (let e = -12; e <= 25; e++) anchors.push(Number(`1e${e}`))
  for (const a of anchors) {
    for (const s of [-3, -2, -1, 1, 2, 3]) {
      out.push(num(nextUp(a, s)))
      out.push(num(-nextUp(a, s)))
    }
  }
  // 2^53 +/- k and big integers.
  for (let k = -8; k <= 8; k++) out.push(num(2 ** 53 + k), num(-(2 ** 53) + k))
  while (out.length < 900) {
    const mag = 2 ** (1 + below(80))
    const x = Math.floor((u32() / 0x1_0000_0000) * mag)
    out.push(num(chance(0.25) ? -x : x))
  }
  // Short decimals typical of game data (k/10^n), plus tick/ms derived values.
  while (out.length < 1300) {
    const k = below(2_000_001) - 1_000_000
    out.push(num(k / 10 ** (1 + below(6))))
  }
  while (out.length < 1450) out.push(num(below(100_000) / 60))
  // Subnormals.
  while (out.length < 1800) out.push(numBits(randomSubnormalBits()))
  // 17-significant-digit decimals.
  while (out.length < 2800) out.push(num(random17Digits()))
  // Uniform random finite bit patterns.
  while (out.length < N_NUMBERS) out.push(numBits(randomFiniteBits()))
  return out.slice(0, N_NUMBERS)
}

// ------------------------------------------------------------------ strings

const CTRL = Array.from({ length: 0x20 }, (_, i) => String.fromCharCode(i)).concat(['\u007f'])
const SPECIAL = ['"', '\\', '/', "'", '<', '>', '&', ' ', ' ', '﻿', '\u0085', ' ']
const BMP_HIGH = ['', '', 'דּ', '�', '￿', 'Ａ', '️', '퟿']
const VIET = ['Đ', 'đ', 'ư', 'ơ', 'ă', 'â', 'ê', 'ô', 'Ạ', 'ặ', 'ữ', 'ỵ', 'Ừ', 'ĐUA DZỊT', 'vịt', 'Vịt Vàng']
const ASTRAL = ['😀', '🦆', '🏁', '𝄞', '\u{10000}', '\u{10ffff}', '\u{1f600}', '\u{20000}', '👨‍👩‍👧']
const OTHER = ['€', 'ö', 'é', 'ß', 'Ω', 'ж', '中', '日本', '한', 'ـ', 'א', '\u0080', 'ÿ', 'Ā', '߿', 'ࠀ']

function randomChar(): string {
  const r = below(100)
  if (r < 45) return String.fromCharCode(0x20 + below(0x5f))
  if (r < 58) return pick(CTRL)
  if (r < 66) return pick(SPECIAL)
  if (r < 72) return pick(BMP_HIGH)
  if (r < 80) return pick(VIET)
  if (r < 88) return pick(ASTRAL)
  if (r < 94) return pick(OTHER)
  // Any BMP scalar value (skip surrogates) or any astral one.
  if (chance(0.7)) {
    let c = below(0x10000)
    if (c >= 0xd800 && c <= 0xdfff) c -= 0x800
    return String.fromCharCode(c)
  }
  return String.fromCodePoint(0x10000 + below(0x100000))
}

function randomString(maxLen: number): string {
  const n = below(maxLen + 1)
  let s = ''
  for (let i = 0; i < n; i++) s += randomChar()
  return s
}

function stringCases(): Node[] {
  const out: Node[] = []
  const fixed = [
    '', ' ', 'a', '"', '\\', '\\"', '/', '\b\f\n\r\t', '\u0000', '\u001f', '\u000b', '\u007f',
    '  ', '€$\u000f\nA\'B"\\\\"/', 'Đua Dzịt 🦆', '😀', '\u{10ffff}', '￿',
    ...CTRL, ...SPECIAL, ...BMP_HIGH, ...ASTRAL,
  ]
  for (const s of fixed) out.push({ t: 's', v: s })
  while (out.length < N_STRINGS) out.push({ t: 's', v: randomString(chance(0.1) ? 64 : 12) })
  return out.slice(0, N_STRINGS)
}

// -------------------------------------------------------------------- trees

const KEY_POOL = [
  '', 'a', 'A', 'b', 'B', 'aa', 'ab', 'aB', 'Z', '_', '$', '1', '10', '2', '-1', '0', '00',
  'id', 'playerId', 'rank', 'finishTick', 'finishTimeMs', 'seed', 'seedCommit', 'engineVersion',
  'balanceVersion', 'trackVersion', 'durationTicks', 'standings', 'eventsSha256', 'motionSha256',
  '\r', '\n', '\u0000', '\u0080', 'ö', '€', 'דּ', '😀', '', '￿',
  '\u{10000}', '\u{10ffff}', 'ö', 'o', 'oz', 'é', 'e', 'Đ', 'đ', 'z', '~', 'zz', '🦆', '🦆a', 'a🦆',
  '퟿', '｡', '\u{1d11e}', ' ', '"', '\\', 'key with space', 'KEY', 'Key',
]

function randomKey(): string {
  return chance(0.7) ? pick(KEY_POOL) : randomString(6)
}

function randomLeaf(): Node {
  const r = below(10)
  if (r < 4) {
    const src = below(4)
    if (src === 0) return numBits(randomFiniteBits())
    if (src === 1) return num(random17Digits())
    if (src === 2) return num(below(2_000_001) - 1_000_000)
    return num((below(200_001) - 100_000) / 100)
  }
  if (r < 7) return { t: 's', v: randomString(10) }
  if (r < 9) return { t: 'b', v: chance(0.5) }
  return { t: 'z' }
}

function randomTree(depth: number): Node {
  if (depth <= 0 || chance(0.3)) return randomLeaf()
  if (chance(0.55)) {
    const n = below(6)
    const seen = new Set<string>()
    const members: [string, Node][] = []
    for (let i = 0; i < n; i++) {
      const k = randomKey()
      if (seen.has(k)) continue
      seen.add(k)
      members.push([k, randomTree(depth - 1)])
    }
    return { t: 'o', v: members }
  }
  const n = below(6)
  return { t: 'a', v: Array.from({ length: n }, () => randomTree(depth - 1)) }
}

function treeCases(count: number): Node[] {
  const s = (v: string): Node => ({ t: 's', v })
  const out: Node[] = [
    { t: 'o', v: [] },
    { t: 'a', v: [] },
    { t: 'a', v: [{ t: 'a', v: [] }, { t: 'o', v: [] }] },
    // RFC 8785 3.2.3 sorting example (values are the key descriptions).
    {
      t: 'o',
      v: [
        ['€', s('Euro Sign')], ['\r', s('Carriage Return')], ['דּ', s('Hebrew Letter Dalet With Dagesh')],
        ['1', s('One')], ['😀', s('Emoji: Grinning Face')], ['\u0080', s('Control')],
        ['ö', s('Latin Small Letter O With Diaeresis')],
      ],
    },
    // RFC 8785 3.2.2 example.
    {
      t: 'o',
      v: [
        ['numbers', { t: 'a', v: [num(333333333.33333329), num(1e30), num(4.5), num(2e-3), num(0.000000000000000000000000001)] }],
        ['string', s('€$\u000f\nA\'B"\\\\"/')],
        ['literals', { t: 'a', v: [{ t: 'z' }, { t: 'b', v: true }, { t: 'b', v: false }] }],
      ],
    },
    // Integer-like keys: JS objects would reorder these, the sort must not care.
    { t: 'o', v: [['10', num(1)], ['2', num(2)], ['1', num(3)], ['b', num(4)], ['a', num(5)]] },
  ]
  while (out.length < count) out.push(randomTree(1 + below(4)))
  return out.slice(0, count)
}

// --------------------------------------------------------------------- main

const cases: { kind: Kind; input: Node }[] = [
  ...numberCases().map((input) => ({ kind: 'number' as const, input })),
  ...stringCases().map((input) => ({ kind: 'string' as const, input })),
]
for (const input of treeCases(TOTAL - cases.length)) cases.push({ kind: 'tree', input })

const lines = cases.map(({ kind, input }, id) => {
  const jcs = reference(input)
  const sha256 = createHash('sha256').update(jcs, 'utf8').digest('hex')
  return JSON.stringify({ id, kind, input, jcs, sha256 })
})

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, `${lines.join('\n')}\n`)
const counts = cases.reduce<Record<string, number>>((acc, c) => ((acc[c.kind] = (acc[c.kind] ?? 0) + 1), acc), {})
console.log(`wrote ${cases.length} JCS goldens to ${OUT}`, counts)
