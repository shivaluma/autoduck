/**
 * V8 math fixtures for `race_core::{math,js_math}` (plan D3/D4(c), Phase 1).
 *
 *   node --import tsx scripts/oracle/dump-math-fixtures.ts [--out <file>] [--full-dir <dir>]
 *
 * (Node 24 can also run it directly: `node scripts/oracle/dump-math-fixtures.ts`.)
 * The default output is `crates/race-core/tests/fixtures/math-node24-<platform>-<arch>.json`.
 * V8's results are host-dependent (see below), so one fixture is kept per
 * host: darwin-arm64 (dev), linux-x64 (production image, CI) and linux-arm64,
 * the Linux ones produced with the official `node:24-bookworm-slim` image:
 *
 *   docker run --rm --platform linux/amd64 -v "$PWD:/w" -w /w node:24-bookworm-slim \
 *     node scripts/oracle/dump-math-fixtures.ts
 *
 * plus a `linux-x64-nofma` variant (glibc's portable non-FMA `pow`, what an
 * x86-64 CPU without FMA runs), produced by disabling glibc's FMA `ifunc`:
 *
 *   docker run --rm --platform linux/amd64 -e GLIBC_TUNABLES=glibc.cpu.hwcaps=-AVX2,-FMA,-AVX512F \
 *     -v "$PWD:/w" -w /w node:24-bookworm-slim node scripts/oracle/dump-math-fixtures.ts --variant nofma
 *
 * Inputs are NOT stored. They come from a small deterministic generator that
 * is mirrored bit for bit in `crates/race-core/tests/fixtures/math_gen.rs`
 * (same splitmix32-style PRNG, same segment table, only exact IEEE ops +,-,*,/
 * and bit construction, no transcendental in the generator). What is stored
 * per function:
 *   - `chunks`: sha256 (first 8 bytes, hex) of each run of 1024 outputs,
 *     encoded as little-endian u64 bits with every NaN mapped to
 *     0x7ff8000000000000 (-0 stays distinct). Equal digests prove equality.
 *   - `sha256`: digest of the whole output stream (same encoding).
 *   - `edges`: hand-picked inputs with full input/output bits.
 * With `--full-dir`, the raw output streams are also written as `<name>.bin`
 * (LE f64) so the Rust tests can report exact per-input mismatches
 * (env `RACE_MATH_FULL_DIR=<dir>`).
 *
 * Host dependence:
 *   - `Math.pow` in Node 24 (V8 13.6) defaults to `--use-std-math-pow`, i.e.
 *     the host C library's `pow`. This script therefore also runs a child
 *     process with `--no-use-std-math-pow` (V8's fdlibm-derived
 *     `base::ieee754::legacy::pow`) and stores both: `pow` (default flags) and
 *     `pow.legacy`, plus how many generated inputs differ between the two
 *     (`diffVsLegacy`: total, per segment, first samples).
 *   - V8's C++ (`exp`, legacy `pow`, glibc-derived `sin`/`cos`) is compiled
 *     with clang's default `-ffp-contract=on`, so arm64 builds fuse
 *     `a * b + c` into FMAs and x86-64 builds do not.
 *
 * Output is deterministic for a given Node build and host libm.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir, arch, platform } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const GENERATOR_VERSION = 'math-gen-v1'
const CHUNK = 1024
const CANON_NAN_HI = 0x7ff80000

// ---------------------------------------------------------------------------
// Deterministic generator (mirror: crates/race-core/tests/fixtures/math_gen.rs)
// ---------------------------------------------------------------------------

const scratch = new DataView(new ArrayBuffer(8))

function fromBits(hi: number, lo: number): number {
  scratch.setUint32(0, hi >>> 0)
  scratch.setUint32(4, lo >>> 0)
  return scratch.getFloat64(0)
}

function toBits(x: number): bigint {
  scratch.setFloat64(0, x)
  return scratch.getBigUint64(0)
}

class Gen {
  private s: number
  constructor(seed: number) {
    this.s = seed >>> 0
  }
  next(): number {
    this.s = (this.s + 0x9e3779b9) >>> 0
    let z = this.s
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b)
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35)
    return (z ^ (z >>> 16)) >>> 0
  }
  /** Uniform in [0, 1) with 53 random bits. */
  u53(): number {
    const a = this.next() >>> 5
    const b = this.next() >>> 6
    return (a * 67108864 + b) / 9007199254740992
  }
  uniform(lo: number, hi: number): number {
    return lo + this.u53() * (hi - lo)
  }
  /** Any f64 bit pattern (NaN, infinities, subnormals included). */
  bits(): number {
    const hi = this.next()
    const lo = this.next()
    return fromBits(hi, lo)
  }
  below(n: number): number {
    return this.next() % n
  }
  /** Random sign times (1 + u) * 2^e with e uniform in [minE, maxE] (normal range only). */
  logu(minE: number, maxE: number): number {
    const sbit = this.next() & 1
    const e = minE + this.below(maxE - minE + 1)
    const m = 1 + this.u53()
    const v = m * pow2(e)
    return sbit === 1 ? -v : v
  }
  pick(values: readonly number[]): number {
    return values[this.below(values.length)]!
  }
  /** `base` moved by an offset in [-64, 64] units in the last place (raw bit arithmetic). */
  ulpsAround(base: number): number {
    const offset = this.below(129) - 64
    const bits = BigInt.asUintN(64, toBits(base) + BigInt(offset))
    scratch.setBigUint64(0, bits)
    return scratch.getFloat64(0)
  }
}

function pow2(e: number): number {
  // 2^e for e in [-1022, 1023], built from bits (no Math.pow in the generator).
  return fromBits(((e + 1023) << 20) >>> 0, 0)
}

const MIN_SUB = fromBits(0, 1)
const MIN_NORMAL = fromBits(0x00100000, 0)
const MAX = fromBits(0x7fefffff, 0xffffffff)
const ONE_PLUS = fromBits(0x3ff00000, 1)
const ONE_MINUS = fromBits(0x3fefffff, 0xffffffff)
const HALF_MINUS = fromBits(0x3fdfffff, 0xffffffff) // 0.49999999999999994

const SPECIALS: readonly number[] = [
  0, -0, 1, -1, Infinity, -Infinity, NaN, 0.5, -0.5, 2, -2, 3, -3, 1.5, -1.5,
  MIN_SUB, -MIN_SUB, MIN_NORMAL, MAX, -MAX, ONE_PLUS, ONE_MINUS, 1e-300, 1e300, HALF_MINUS,
]

const EXP_BOUNDARIES: readonly number[] = [
  0.34657359027997264, // 0.5 ln2
  1.0397207708399179, // 1.5 ln2
  0.6931471805599453, // ln2
  709.782712893384, // overflow threshold
  -745.1332191019411, // underflow threshold
  -708.3964185322641,
  -707.7032713517042, // around k = -1021
  -709.0895657128241,
  3.725290298461914e-9, // 2^-28
  1, 2, 10, 0.5,
]

type Segment<T> = { name: string; count: number; make: (g: Gen) => T }
type Args = number[]

const EXP_SEGMENTS: Segment<Args>[] = [
  { name: 'engine_gap', count: 250_000, make: (g) => {
    // chaos-utility.ts: Math.exp(-gap / SWAP_GAP_SCALE), gap = |progress delta|
    const p1 = g.u53()
    const d = g.uniform(-0.12, 0.12)
    const p2 = p1 + d
    const gap = Math.abs(p2 - p1)
    return [-gap / 0.02]
  } },
  { name: 'engine_progress', count: 50_000, make: (g) => {
    const a = g.uniform(0, 1.05)
    const b = g.uniform(0, 1.05)
    return [-Math.abs(a - b) / 0.02]
  } },
  { name: 'unit', count: 150_000, make: (g) => [g.uniform(-1, 1)] },
  { name: 'reduction', count: 150_000, make: (g) => [g.uniform(-2, 2)] },
  { name: 'full_range', count: 150_000, make: (g) => [g.uniform(-746, 710)] },
  { name: 'log_magnitude', count: 100_000, make: (g) => [g.logu(-60, 10)] },
  { name: 'boundaries', count: 50_000, make: (g) => {
    const base = g.pick(EXP_BOUNDARIES)
    const signed = (g.next() & 1) === 1 ? -base : base
    return [g.ulpsAround(signed)]
  } },
  { name: 'bits', count: 100_000, make: (g) => [g.bits()] },
]

const POW_SEGMENTS: Segment<Args>[] = [
  { name: 'engine_grudge', count: 250_000, make: (g) => {
    // brain.ts: Math.pow(0.5, (tick - grudge.tick) / (GRUDGE_HALF_LIFE_SECONDS * tickRate))
    const tick = g.below(5401)
    const grudgeTick = g.below(tick + 1)
    return [0.5, (tick - grudgeTick) / (10 * 60)]
  } },
  { name: 'engine_half', count: 150_000, make: (g) => [0.5, g.uniform(0, 60)] },
  { name: 'half_wide', count: 50_000, make: (g) => [0.5, g.uniform(-1100, 1100)] },
  { name: 'positive', count: 150_000, make: (g) => {
    const x = g.uniform(0, 10)
    const y = g.uniform(-30, 30)
    return [x, y]
  } },
  { name: 'near_one', count: 100_000, make: (g) => {
    const x = 1 + g.logu(-60, -5)
    const y = g.logu(-5, 70)
    return [x, y]
  } },
  { name: 'int_exponent', count: 100_000, make: (g) => {
    const x = g.uniform(-100, 100)
    const y = g.below(129) - 64
    return [x, y]
  } },
  { name: 'unit', count: 50_000, make: (g) => {
    const x = g.uniform(0, 2)
    const y = g.uniform(-1, 1)
    return [x, y]
  } },
  { name: 'magnitude', count: 50_000, make: (g) => {
    const x = Math.abs(g.logu(-1022, 1023))
    const y = g.uniform(-4, 4)
    return [x, y]
  } },
  { name: 'bits', count: 50_000, make: (g) => {
    const x = g.bits()
    const y = g.bits()
    return [x, y]
  } },
  { name: 'specials', count: 50_000, make: (g) => {
    const mode = g.below(3)
    if (mode === 0) {
      const x = g.pick(SPECIALS)
      const y = g.pick(SPECIALS)
      return [x, y]
    }
    if (mode === 1) {
      const x = g.pick(SPECIALS)
      const y = g.uniform(-10, 10)
      return [x, y]
    }
    const x = g.uniform(-10, 10)
    const y = g.pick(SPECIALS)
    return [x, y]
  } },
]

const HYPOT2_SEGMENTS: Segment<Args>[] = [
  { name: 'engine_pickup', count: 300_000, make: (g) => {
    // pickups/engine.ts: Math.hypot(duck.progress - pickup.progress, duck.lateralOffset - pickup.lateralOffset)
    const pickupProgress = g.u53()
    const dp = g.uniform(-0.03, 0.03)
    const duckProgress = pickupProgress + dp
    const pickupLateral = g.uniform(-1, 1)
    const dl = g.uniform(-0.35, 0.35)
    const duckLateral = pickupLateral + dl
    return [duckProgress - pickupProgress, duckLateral - pickupLateral]
  } },
  { name: 'engine_track', count: 100_000, make: (g) => [4200, g.uniform(-3950, 3950)] },
  { name: 'uniform', count: 200_000, make: (g) => {
    const a = g.uniform(-1000, 1000)
    const b = g.uniform(-1000, 1000)
    return [a, b]
  } },
  { name: 'unit', count: 100_000, make: (g) => {
    const a = g.uniform(-1, 1)
    const b = g.uniform(-1, 1)
    return [a, b]
  } },
  { name: 'magnitude', count: 150_000, make: (g) => {
    const a = g.logu(-1022, 1023)
    const b = g.logu(-1022, 1023)
    return [a, b]
  } },
  { name: 'close_magnitude', count: 50_000, make: (g) => {
    const a = g.logu(-50, 50)
    const b = a * g.uniform(0.5, 2)
    return [a, b]
  } },
  { name: 'specials', count: 50_000, make: (g) => {
    const a = g.pick(SPECIALS)
    const b = (g.next() & 1) === 1 ? g.pick(SPECIALS) : g.uniform(-10, 10)
    return (g.next() & 1) === 1 ? [a, b] : [b, a]
  } },
  { name: 'bits', count: 50_000, make: (g) => {
    const a = g.bits()
    const b = g.bits()
    return [a, b]
  } },
]

const HYPOT3_SEGMENTS: Segment<Args>[] = [
  { name: 'uniform', count: 300_000, make: (g) => {
    const a = g.uniform(-1000, 1000)
    const b = g.uniform(-1000, 1000)
    const c = g.uniform(-1000, 1000)
    return [a, b, c]
  } },
  { name: 'unit', count: 200_000, make: (g) => {
    const a = g.uniform(-1, 1)
    const b = g.uniform(-1, 1)
    const c = g.uniform(-1, 1)
    return [a, b, c]
  } },
  { name: 'small', count: 200_000, make: (g) => {
    const a = g.uniform(-0.05, 0.05)
    const b = g.uniform(-0.5, 0.5)
    const c = g.uniform(-0.05, 0.05)
    return [a, b, c]
  } },
  { name: 'magnitude', count: 150_000, make: (g) => {
    const a = g.logu(-1022, 1023)
    const b = g.logu(-1022, 1023)
    const c = g.logu(-1022, 1023)
    return [a, b, c]
  } },
  { name: 'specials', count: 100_000, make: (g) => {
    const a = g.pick(SPECIALS)
    const b = g.pick(SPECIALS)
    const c = g.uniform(-10, 10)
    const order = g.below(3)
    return order === 0 ? [a, b, c] : order === 1 ? [c, a, b] : [b, c, a]
  } },
  { name: 'bits', count: 50_000, make: (g) => {
    const a = g.bits()
    const b = g.bits()
    const c = g.bits()
    return [a, b, c]
  } },
]

const TRIG_SEGMENTS: Segment<Args>[] = [
  { name: 'engine_track', count: 500_000, make: (g) => {
    // track.ts sample(): sin/cos of p * Math.PI * k (+ phase)
    const p = g.u53()
    const form = g.below(3)
    if (form === 0) return [p * Math.PI * 2.25]
    if (form === 1) return [p * Math.PI * 5.1 + 0.7]
    return [p * Math.PI * 3.7 + 0.4]
  } },
  { name: 'uniform', count: 200_000, make: (g) => [g.uniform(-10, 10)] },
  { name: 'wide', count: 100_000, make: (g) => [g.uniform(-1e6, 1e6)] },
  { name: 'log_magnitude', count: 100_000, make: (g) => [g.logu(-30, 30)] },
  { name: 'bits', count: 100_000, make: (g) => [g.bits()] },
]

const ROUND_SEGMENTS: Segment<Args>[] = [
  { name: 'bits', count: 20_000, make: (g) => [g.bits()] },
  { name: 'uniform', count: 20_000, make: (g) => [g.uniform(-10, 10)] },
  { name: 'half_integers', count: 20_000, make: (g) => {
    const k = g.below(2001) - 1000
    return [g.ulpsAround(k + 0.5)]
  } },
  { name: 'log_magnitude', count: 20_000, make: (g) => [g.logu(-60, 60)] },
  { name: 'specials', count: 20_000, make: (g) => {
    const base = g.pick([...SPECIALS, 4503599627370496, 4503599627370497, 9007199254740991, 9007199254740992, 0.5, 2.5, -2.5])
    return [g.ulpsAround(base)]
  } },
]

const PAIR_SEGMENTS: Segment<Args>[] = [
  { name: 'uniform', count: 30_000, make: (g) => {
    const a = g.uniform(-10, 10)
    const b = g.uniform(-10, 10)
    return [a, b]
  } },
  { name: 'specials', count: 30_000, make: (g) => {
    const a = g.pick(SPECIALS)
    const b = g.pick(SPECIALS)
    return [a, b]
  } },
  { name: 'equal_or_near', count: 20_000, make: (g) => {
    const a = g.uniform(-10, 10)
    const b = g.ulpsAround(a)
    return (g.next() & 1) === 1 ? [a, b] : [a, a]
  } },
  { name: 'bits', count: 20_000, make: (g) => {
    const a = g.bits()
    const b = g.bits()
    return [a, b]
  } },
]

// Edge inputs stored verbatim with their outputs.
const EXP_EDGES: number[] = [
  0, -0, 1, -1, 0.5, -0.5, 2, -2, 10, -10, 100, -100, NaN, Infinity, -Infinity,
  709.782712893384, 709.7827128933841, 709.78, -745.1332191019411, -745.1332191019412, -745.13,
  -708.3964185322641, -708.4, -707.7032713517042, -720, -740, 3.725290298461914e-9, -3.725290298461914e-9,
  3.7252902984619136e-9, 1e-300, MIN_SUB, -MIN_SUB, 0.34657359027997264, 0.3465735902799727,
  1.0397207708399179, 1.039720770839918, -0.34657359027997264, -1.0397207708399179,
  MAX, -MAX, 1e-5, -1e-5, 0.6931471805599453, -0.6931471805599453, 1 / 3, -1 / 3, 5, -5, 50, -50,
]
const POW_EDGES: Args[] = []
{
  const specials = [...SPECIALS, 0.25, 10, 0.1, -0.1, 4, 1 / 3, 7]
  for (const x of specials) for (const y of specials) POW_EDGES.push([x, y])
  for (let t = 0; t <= 600; t += 37) POW_EDGES.push([0.5, t / 600])
  POW_EDGES.push([2, 1023], [2, 1024], [2, -1074], [2, -1075], [2, -1022], [2, 0.5], [-8, 1 / 3], [10, 308], [10, -323])
}
const HYPOT_EDGE_VALUES = [0, -0, 1, -1, 3, 4, 1e-300, 1e300, MAX, MIN_SUB, NaN, Infinity, -Infinity, 0.1, 0.2]
const HYPOT2_EDGES: Args[] = []
for (const a of HYPOT_EDGE_VALUES) for (const b of HYPOT_EDGE_VALUES) HYPOT2_EDGES.push([a, b])
const HYPOT3_EDGES: Args[] = []
for (const a of HYPOT_EDGE_VALUES) for (const b of HYPOT_EDGE_VALUES) for (const c of [0, 2, NaN, Infinity]) HYPOT3_EDGES.push([a, b, c])
const TRIG_EDGES: number[] = [0, -0, 1, -1, Math.PI, -Math.PI, Math.PI / 2, Math.PI / 4, 1e-300, 1e22, 1e300, MAX, NaN, Infinity, -Infinity, 2.25 * Math.PI, 0.7, 0.4]
const ROUND_EDGE_VALUES: number[] = [
  0, -0, 0.5, -0.5, HALF_MINUS, -HALF_MINUS, 1.5, -1.5, 2.5, -2.5, 0.3, -0.3, 0.7, -0.7, NaN, Infinity, -Infinity,
  4503599627370495.5, 4503599627370496, 4503599627370497, -4503599627370495.5, -4503599627370497, 9007199254740993, MAX, -MAX, MIN_SUB, -MIN_SUB,
]
const ROUND_EDGES: Args[] = ROUND_EDGE_VALUES.map((x) => [x])
const PAIR_EDGES: Args[] = []
for (const a of [0, -0, 1, -1, NaN, Infinity, -Infinity, MIN_SUB, -MIN_SUB]) for (const b of [0, -0, 1, -1, NaN, Infinity, -Infinity, MIN_SUB, -MIN_SUB]) PAIR_EDGES.push([a, b])

// ---------------------------------------------------------------------------
// Functions under test (exactly the JS the TS engine evaluates).
// ---------------------------------------------------------------------------

type Spec = { name: string; seed: number; arity: number; segments: Segment<Args>[]; edges: Args[]; fn: (a: Args) => number }

const cmpJs = (a: number, b: number) => {
  const d = a - b
  return d < 0 ? -1 : d > 0 ? 1 : 0 // Array.prototype.sort: NaN comparator result -> +0
}

const SPECS: Spec[] = [
  { name: 'exp', seed: 1, arity: 1, segments: EXP_SEGMENTS, edges: EXP_EDGES.map((x) => [x]), fn: (a) => Math.exp(a[0]!) },
  { name: 'pow', seed: 2, arity: 2, segments: POW_SEGMENTS, edges: POW_EDGES, fn: (a) => Math.pow(a[0]!, a[1]!) },
  { name: 'hypot2', seed: 3, arity: 2, segments: HYPOT2_SEGMENTS, edges: HYPOT2_EDGES, fn: (a) => Math.hypot(a[0]!, a[1]!) },
  { name: 'hypot3', seed: 4, arity: 3, segments: HYPOT3_SEGMENTS, edges: HYPOT3_EDGES, fn: (a) => Math.hypot(a[0]!, a[1]!, a[2]!) },
  { name: 'sin', seed: 5, arity: 1, segments: TRIG_SEGMENTS, edges: TRIG_EDGES.map((x) => [x]), fn: (a) => Math.sin(a[0]!) },
  { name: 'cos', seed: 6, arity: 1, segments: TRIG_SEGMENTS, edges: TRIG_EDGES.map((x) => [x]), fn: (a) => Math.cos(a[0]!) },
  { name: 'round', seed: 7, arity: 1, segments: ROUND_SEGMENTS, edges: ROUND_EDGES, fn: (a) => Math.round(a[0]!) },
  { name: 'sign', seed: 8, arity: 1, segments: ROUND_SEGMENTS, edges: ROUND_EDGES, fn: (a) => Math.sign(a[0]!) },
  { name: 'max', seed: 9, arity: 2, segments: PAIR_SEGMENTS, edges: PAIR_EDGES, fn: (a) => Math.max(a[0]!, a[1]!) },
  { name: 'min', seed: 10, arity: 2, segments: PAIR_SEGMENTS, edges: PAIR_EDGES, fn: (a) => Math.min(a[0]!, a[1]!) },
  { name: 'cmp', seed: 11, arity: 2, segments: PAIR_SEGMENTS, edges: PAIR_EDGES, fn: (a) => cmpJs(a[0]!, a[1]!) },
]

function generate(spec: Spec): Args[] {
  const g = new Gen(spec.seed)
  const out: Args[] = []
  for (const segment of spec.segments) {
    for (let i = 0; i < segment.count; i++) {
      const args = segment.make(g)
      if (args.length !== spec.arity) throw new Error(`${spec.name}/${segment.name}: arity`)
      out.push(args)
    }
  }
  return out
}

function evaluate(spec: Spec, inputs: Args[]): Float64Array {
  const out = new Float64Array(inputs.length)
  for (let i = 0; i < inputs.length; i++) out[i] = spec.fn(inputs[i]!)
  return out
}

function canonicalBytes(values: Float64Array): Buffer {
  const buf = Buffer.alloc(values.length * 8)
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!
    if (Number.isNaN(v)) {
      buf.writeUInt32LE(0, i * 8)
      buf.writeUInt32LE(CANON_NAN_HI, i * 8 + 4)
    } else {
      buf.writeDoubleLE(v, i * 8)
    }
  }
  return buf
}

function hex(x: number): string {
  if (Number.isNaN(x)) return '7ff8000000000000'
  return toBits(x).toString(16).padStart(16, '0')
}

function digests(values: Float64Array) {
  const bytes = canonicalBytes(values)
  const chunks: string[] = []
  for (let start = 0; start < values.length; start += CHUNK) {
    const end = Math.min(values.length, start + CHUNK)
    chunks.push(createHash('sha256').update(bytes.subarray(start * 8, end * 8)).digest('hex').slice(0, 16))
  }
  return { chunks, sha256: createHash('sha256').update(bytes).digest('hex'), bytes }
}

function sameBits(a: number, b: number) {
  return hex(a) === hex(b)
}

// ---------------------------------------------------------------------------
// Child mode: legacy pow under --no-use-std-math-pow.
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2)
const argValue = (flag: string) => {
  const index = argv.indexOf(flag)
  return index >= 0 ? argv[index + 1] : undefined
}

const childOut = argValue('--child-pow')
if (childOut) {
  const spec = SPECS.find((s) => s.name === 'pow')!
  const generated = evaluate(spec, generate(spec))
  const edges = evaluate(spec, spec.edges)
  const all = new Float64Array(generated.length + edges.length)
  all.set(generated, 0)
  all.set(edges, generated.length)
  writeFileSync(childOut, Buffer.from(all.buffer))
  process.exit(0)
}

if (process.execArgv.some((a) => a.includes('use-std-math-pow'))) {
  throw new Error('run the parent without --(no-)use-std-math-pow; it spawns the legacy child itself')
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const variant = argValue('--variant')
const host = `${platform()}-${arch()}${variant ? `-${variant}` : ''}`
const outPath = resolve(argValue('--out') ?? join(repoRoot, `crates/race-core/tests/fixtures/math-node24-${host}.json`))
const fullDir = argValue('--full-dir')
if (fullDir) mkdirSync(fullDir, { recursive: true })

const tmp = join(tmpdir(), `math-fixtures-legacy-pow-${process.pid}.bin`)
const child = spawnSync(process.execPath, [...process.execArgv, '--no-use-std-math-pow', fileURLToPath(import.meta.url), '--child-pow', tmp], { stdio: 'inherit' })
if (child.status !== 0) throw new Error(`legacy pow child failed: ${child.status}`)
const legacyAll = new Float64Array(new Uint8Array(readFileSync(tmp)).buffer)
rmSync(tmp)

type FnOut = {
  arity: number
  seed: number
  count: number
  segments: { name: string; count: number }[]
  chunks: string[]
  sha256: string
  edges: { in: string[]; out: string }[]
  legacy?: { chunks: string[]; sha256: string; edges: string[] }
  diffVsLegacy?: { total: number; bySegment: Record<string, number>; samples: [number, string, string][] }
}

const functions: Record<string, FnOut> = {}
for (const spec of SPECS) {
  const inputs = generate(spec)
  const outputs = evaluate(spec, inputs)
  const d = digests(outputs)
  const edgeOutputs = evaluate(spec, spec.edges)
  const entry: FnOut = {
    arity: spec.arity,
    seed: spec.seed,
    count: inputs.length,
    segments: spec.segments.map((s) => ({ name: s.name, count: s.count })),
    chunks: d.chunks,
    sha256: d.sha256,
    edges: spec.edges.map((args, i) => ({ in: args.map(hex), out: hex(edgeOutputs[i]!) })),
  }
  if (fullDir) writeFileSync(join(fullDir, `${spec.name}.bin`), d.bytes)
  if (spec.name === 'pow') {
    const legacy = legacyAll.subarray(0, inputs.length)
    const legacyEdges = legacyAll.subarray(inputs.length)
    const ld = digests(legacy)
    entry.legacy = { chunks: ld.chunks, sha256: ld.sha256, edges: Array.from(legacyEdges, hex) }
    const diff = { total: 0, bySegment: {} as Record<string, number>, samples: [] as [number, string, string][] }
    let index = 0
    for (const segment of spec.segments) {
      diff.bySegment[segment.name] = 0
      for (let n = 0; n < segment.count; n++, index++) {
        if (sameBits(outputs[index]!, legacy[index]!)) continue
        diff.total++
        diff.bySegment[segment.name]!++
        if (diff.samples.length < 64) diff.samples.push([index, hex(outputs[index]!), hex(legacy[index]!)])
      }
    }
    entry.diffVsLegacy = diff
    if (fullDir) writeFileSync(join(fullDir, 'pow_legacy.bin'), ld.bytes)
    console.error(`pow: ${diff.total} / ${inputs.length} generated inputs differ between std pow and legacy (fdlibm) pow`)
  }
  functions[spec.name] = entry
  console.error(`${spec.name}: ${inputs.length} generated + ${spec.edges.length} edges, sha256 ${d.sha256.slice(0, 16)}`)
}

const fixture = {
  version: 1,
  generator: GENERATOR_VERSION,
  chunkSize: CHUNK,
  nanCanonical: '7ff8000000000000',
  node: process.version,
  v8: process.versions.v8,
  platform: `${platform()}-${arch()}`,
  variant: variant ?? null,
  glibcTunables: process.env.GLIBC_TUNABLES ?? null,
  note: 'pow = default Node flags (host std::pow); pow.legacy = --no-use-std-math-pow (V8 fdlibm)',
  functions,
}
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(fixture) + '\n')
console.error(`wrote ${outPath}`)
