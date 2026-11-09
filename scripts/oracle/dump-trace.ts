/**
 * TS oracle trace dumper (Phase 1 tooling, gate G1 in docs/rewrite-plan.md).
 *
 * Runs the frozen TS engine (packages/race-core, never modified) on every
 * config line of a corpus produced by `race-cli corpus gen`, and writes one
 * JSON line per case with:
 *   - per-tick state hashes over the `sh1` state encoding (see README.md),
 *   - a folded state chain and a motion fold (every 60th tick + final tick),
 *   - the event-stream digest (JCS per event) and per-tick event hashes,
 *   - the standings.
 * With `--full-at <case>` it also dumps every hashed field of that case,
 * every tick, with each f64 as its raw IEEE-754 bit pattern in hex.
 *
 * The first line of every trace is a header (`"kind": "header"`) recording
 * the oracle host: platform, arch, Node/V8 versions, execArgv/NODE_OPTIONS and
 * whether V8 uses the platform `pow` (`useStdMathPow`). `Math.exp`/`Math.pow`
 * results depend on it, so `race-cli oracle diff` maps the header to a
 * `js_math::V8Target` and refuses hosts it can't model (darwin with the
 * default std pow). Shards concatenated together repeat the header; the
 * headers must agree.
 *
 * Usage:
 *   node --import tsx scripts/oracle/dump-trace.ts --corpus corpus.jsonl --out trace.jsonl
 *     [--from N] [--limit N] [--shard i/n] [--max-ticks N]
 *     [--hash-prefix-bytes 8] [--event-prefix-bytes 4]
 *     [--full-at <case> [--full-out path]] [--validate-only]
 *
 * Output ending in `.gz` is gzip-compressed. `--out -` (default) is stdout.
 */
import { createHash } from 'node:crypto'
import { createWriteStream, readFileSync, realpathSync, type WriteStream } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'
import { createGzip, type Gzip } from 'node:zlib'
import {
  CORE_BALANCE,
  createSimulation,
  resultFromSimulation,
  stepSimulation,
  type RaceSimulationState,
} from '../../packages/race-core/src'
import { raceConfigSchema, type RaceEvent } from '../../packages/race-protocol/src'

export const STATE_HASH_VERSION = 'sh1'
export const EVENT_DIGEST_VERSION = 'ev-jcs-v1'
export const TRACE_FORMAT_VERSION = 'oracle-trace-v2'

/** Server meta events; excluded from the event digest (D7). The engine never emits them. */
const META_EVENT_TYPES = new Set(['CHAOS_RESOLVED', 'QP_TRACK_REWARD_GRANTED'])
const MOTION_STRIDE = 60

// ---------------------------------------------------------------------------
// sh1 state encoding: a single traversal drives both the byte sink (hashing)
// and the full dump, so the two can never disagree.

/**
 * Field callbacks take `(scope, name)` separately so the hashing path never
 * builds field-name strings; only error messages and the full dump join them.
 */
interface StateVisitor {
  u8(scope: string, name: string, value: number): void
  u32(scope: string, name: string, value: number): void
  f64(scope: string, name: string, value: number): void
  str(scope: string, name: string, value: string): void
}

class OracleFieldError extends Error {}

function expectInt(scope: string, name: string, value: number, min: number, max: number) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new OracleFieldError(`field ${scope}${name} = ${String(value)} is not an integer in [${min}, ${max}]`)
  }
}

function rngStateOf(state: RaceSimulationState, playerId: string): number {
  const rng = state.rngByPlayer.get(playerId) as unknown as { state: number } | undefined
  if (!rng) throw new OracleFieldError(`no rng for duck ${playerId}`)
  return rng.state
}

const duckScopes: string[] = []
const duckScope = (index: number) => (duckScopes[index] ??= `ducks[${index}].`)

/** The `sh1` field list. Keep in sync with scripts/oracle/README.md. */
export function visitState(state: RaceSimulationState, v: StateVisitor) {
  v.u32('', 'tick', state.tick)
  v.u8('', 'finished', state.finished ? 1 : 0)
  v.u32('', 'ducks.length', state.ducks.length)
  for (let index = 0; index < state.ducks.length; index += 1) {
    const duck = state.ducks[index]!
    const p = duckScope(index)
    v.str(p, 'playerId', duck.playerId)
    v.f64(p, 'progress', duck.progress)
    v.f64(p, 'previousProgress', duck.previousProgress)
    v.f64(p, 'lateralOffset', duck.lateralOffset)
    v.f64(p, 'speed', duck.speed)
    v.f64(p, 'acceleration', duck.acceleration)
    v.f64(p, 'lateralVelocity', duck.lateralVelocity)
    v.f64(p, 'desiredSpeed', duck.desiredSpeed)
    v.f64(p, 'desiredLateralOffset', duck.desiredLateralOffset)
    v.u32(p, 'currentRank', duck.currentRank)
    v.u32(p, 'nextImpulseTick', duck.nextImpulseTick)
    v.u8(p, 'finished', duck.finished ? 1 : 0)
    if (duck.finishTimeMs === null) {
      v.u8(p, 'finishTimeMs.present', 0)
    } else {
      v.u8(p, 'finishTimeMs.present', 1)
      v.f64(p, 'finishTimeMs', duck.finishTimeMs)
    }
    v.u32(p, 'pacingSegments.length', duck.pacingSegments.length)
    for (let segment = 0; segment < duck.pacingSegments.length; segment += 1) {
      v.f64(p, 'pacingSegments[]', duck.pacingSegments[segment]!)
    }
    v.u32(p, 'rngState', rngStateOf(state, duck.playerId))
    v.u32(p, 'activeEffects.length', duck.activeEffects.length)
    for (let effect = 0; effect < duck.activeEffects.length; effect += 1) {
      v.str(p, 'activeEffects[]', duck.activeEffects[effect]!)
    }
  }
}

/** Little-endian byte sink with the D4 float canonicalisation. */
class StateBytes implements StateVisitor {
  private buffer = Buffer.alloc(4096)
  length = 0

  reset() {
    this.length = 0
  }

  bytes() {
    return this.buffer.subarray(0, this.length)
  }

  private ensure(extra: number) {
    if (this.length + extra <= this.buffer.length) return
    const next = Buffer.alloc(Math.max(this.buffer.length * 2, this.length + extra))
    this.buffer.copy(next, 0, 0, this.length)
    this.buffer = next
  }

  u8(scope: string, name: string, value: number) {
    expectInt(scope, name, value, 0, 0xff)
    this.ensure(1)
    this.buffer[this.length] = value
    this.length += 1
  }

  u32(scope: string, name: string, value: number) {
    expectInt(scope, name, value, 0, 0xffffffff)
    this.ensure(4)
    this.buffer.writeUInt32LE(value, this.length)
    this.length += 4
  }

  f64(_scope: string, _name: string, value: number) {
    this.ensure(8)
    if (Number.isNaN(value)) {
      // Canonical quiet NaN 0x7ff8000000000000, little-endian.
      this.buffer.writeUInt32LE(0, this.length)
      this.buffer.writeUInt32LE(0x7ff80000, this.length + 4)
    } else {
      // `value + 0` maps -0 to +0 and leaves every other value unchanged.
      this.buffer.writeDoubleLE(value + 0, this.length)
    }
    this.length += 8
  }

  str(scope: string, name: string, value: string) {
    const byteLength = Buffer.byteLength(value, 'utf8')
    this.u32(scope, name, byteLength)
    this.ensure(byteLength)
    this.length += this.buffer.write(value, this.length, byteLength, 'utf8')
  }
}

const f64Bits = (() => {
  const scratch = Buffer.alloc(8)
  return (value: number) => {
    scratch.writeDoubleBE(value, 0)
    return scratch.toString('hex')
  }
})()

type FullField = [name: string, type: 'u8' | 'u32' | 'f64' | 'str', value: number | string]

/**
 * Full dump: every field by name, f64 as raw (uncanonicalised) bits. Array
 * element names (`pacingSegments[]`, `activeEffects[]`) get their index.
 */
class FullDump implements StateVisitor {
  fields: FullField[] = []
  private counters = new Map<string, number>()
  private label(scope: string, name: string) {
    if (!name.endsWith('[]')) return `${scope}${name}`
    const key = `${scope}${name}`
    const index = this.counters.get(key) ?? 0
    this.counters.set(key, index + 1)
    return `${scope}${name.slice(0, -1)}${index}]`
  }
  u8(scope: string, name: string, value: number) { this.fields.push([this.label(scope, name), 'u8', value]) }
  u32(scope: string, name: string, value: number) { this.fields.push([this.label(scope, name), 'u32', value]) }
  f64(scope: string, name: string, value: number) { this.fields.push([this.label(scope, name), 'f64', f64Bits(value)]) }
  str(scope: string, name: string, value: string) { this.fields.push([this.label(scope, name), 'str', value]) }
}

// ---------------------------------------------------------------------------
// Event canonicalisation (RFC 8785 JCS over the TS wire shape).

interface JcsStats {
  f64: string[] | null
}

/**
 * JCS text of a plain JSON-like value. Object keys are sorted by UTF-16 code
 * units (the default `Array.prototype.sort`), `undefined` members are
 * omitted, numbers use ES Number::toString (what ryu-js emits; `-0` -> `0`).
 * NaN/Infinity throw (D7: the digest contains no odd tokens): the Rust JCS
 * writer rejects them too, so silently writing `null` here would make the
 * two sides disagree.
 */
export function jcs(value: unknown, stats: JcsStats, path = '$'): string {
  if (value === null) return 'null'
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false'
    case 'number':
      stats.f64?.push(f64Bits(value))
      if (!Number.isFinite(value)) {
        throw new Error(`non-finite number ${String(value)} at ${path}`)
      }
      return JSON.stringify(value)
    case 'string':
      return JSON.stringify(value)
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value.map((item, index) => (item === undefined ? 'null' : jcs(item, stats, `${path}[${index}]`))).join(',')}]`
      }
      const proto = Object.getPrototypeOf(value)
      if (proto !== Object.prototype && proto !== null) {
        throw new Error(`non-plain object (${(value as object).constructor?.name}) at ${path}`)
      }
      const record = value as Record<string, unknown>
      const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort()
      return `{${keys.map((key) => `${JSON.stringify(key)}:${jcs(record[key], stats, `${path}.${key}`)}`).join(',')}}`
    }
    default:
      throw new Error(`unsupported ${typeof value} at ${path}`)
  }
}

// ---------------------------------------------------------------------------
// Per-case run

const sha256 = (...parts: Uint8Array[]) => {
  const hash = createHash('sha256')
  for (const part of parts) hash.update(part)
  return hash.digest()
}

const u32le = (value: number) => {
  const out = Buffer.alloc(4)
  out.writeUInt32LE(value, 0)
  return out
}

interface CaseOptions {
  maxTicks: number | null
  /** `--ai-ablation all`: every duck plays with the ablated brain (`aiAblationPlayerIds`). */
  aiAblation: AiAblation
  hashPrefixBytes: number
  eventPrefixBytes: number
  full: ((line: string) => void) | null
}

interface CaseRecord {
  [key: string]: unknown
}

function runCase(caseIndex: number, line: string, options: CaseOptions): CaseRecord {
  let stage = 'parse'
  let tick = 0
  try {
    const config = raceConfigSchema.parse(JSON.parse(line))
    stage = 'create'
    const state = createSimulation(config, {
      recordEvents: true,
      ...(options.aiAblation === 'all' ? { aiAblationPlayerIds: config.players.map((player) => player.playerId) } : {}),
    })
    const maxTicks = options.maxTicks ?? CORE_BALANCE.maximumDurationSeconds * config.tickRate

    const sink = new StateBytes()
    const tickHashes: string[] = []
    const tickEventHashes: string[] = []
    let chain: Buffer = Buffer.alloc(32)
    let motion: Buffer = Buffer.alloc(32)
    let lastMotionTick = -1
    const eventsHash = createHash('sha256')
    const stats: JcsStats = { f64: null }
    let eventCount = 0
    let eventCursor = 0

    const observe = () => {
      stage = 'hash'
      sink.reset()
      visitState(state, sink)
      const stateHash = sha256(sink.bytes())
      tickHashes.push(stateHash.subarray(0, options.hashPrefixBytes).toString('hex'))
      chain = sha256(chain, u32le(state.tick), stateHash)
      if (state.tick > 0 && state.tick % MOTION_STRIDE === 0) {
        motion = sha256(motion, u32le(state.tick), stateHash)
        lastMotionTick = state.tick
      }

      stage = 'events'
      const tickEvents = createHash('sha256')
      const fullEvents: Array<{ jcs: string; f64: string[] }> = []
      for (; eventCursor < state.events.length; eventCursor += 1) {
        const raceEvent: RaceEvent = state.events[eventCursor]!
        if (META_EVENT_TYPES.has(raceEvent.type)) continue
        const eventStats: JcsStats = options.full ? { f64: [] } : stats
        const text = jcs(raceEvent, eventStats, `$.events[${eventCursor}]`)
        eventsHash.update(text, 'utf8')
        eventsHash.update('\n', 'utf8')
        tickEvents.update(text, 'utf8')
        tickEvents.update('\n', 'utf8')
        eventCount += 1
        if (options.full) fullEvents.push({ jcs: text, f64: eventStats.f64 ?? [] })
      }
      tickEventHashes.push(tickEvents.digest().subarray(0, options.eventPrefixBytes).toString('hex'))

      if (options.full) {
        const dump = new FullDump()
        visitState(state, dump)
        options.full(JSON.stringify({
          case: caseIndex,
          tick: state.tick,
          stateSha256: stateHash.toString('hex'),
          fields: dump.fields,
          events: fullEvents,
        }))
      }
    }

    observe()
    while (!state.finished && state.tick < maxTicks) {
      stage = 'step'
      stepSimulation(state)
      tick = state.tick
      observe()
    }
    if (lastMotionTick !== state.tick) {
      // Final tick (unless it already landed on the stride).
      sink.reset()
      visitState(state, sink)
      motion = sha256(motion, u32le(state.tick), sha256(sink.bytes()))
    }

    const standings = state.finished
      ? resultFromSimulation(state).standings.map((entry) => ({
        playerId: entry.playerId,
        rank: entry.rank,
        finishTimeMs: entry.finishTimeMs,
        finishTimeBits: f64Bits(entry.finishTimeMs),
      }))
      : null

    return {
      case: caseIndex,
      ok: true,
      raceId: config.raceId,
      players: config.players.length,
      engineVersion: config.engineVersion,
      balanceVersion: config.balanceVersion,
      finished: state.finished,
      finalTick: state.tick,
      maxTicks,
      stateHashVersion: STATE_HASH_VERSION,
      eventDigestVersion: EVENT_DIGEST_VERSION,
      hashPrefixBytes: options.hashPrefixBytes,
      eventPrefixBytes: options.eventPrefixBytes,
      stateChainSha256: chain.toString('hex'),
      motionSha256: motion.toString('hex'),
      eventCount,
      eventsSha256: eventsHash.digest('hex'),
      standings,
      tickHashes: tickHashes.join(''),
      tickEventHashes: tickEventHashes.join(''),
    }
  } catch (error) {
    return {
      case: caseIndex,
      ok: false,
      stage,
      tick,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

// ---------------------------------------------------------------------------
// CLI

type AiAblation = 'none' | 'all'

interface Args {
  aiAblation: AiAblation
  corpus: string
  out: string
  from: number
  limit: number | null
  shard: [number, number] | null
  maxTicks: number | null
  hashPrefixBytes: number
  eventPrefixBytes: number
  fullAt: number | null
  fullOut: string | null
  validateOnly: boolean
}

function usage(message?: string): never {
  if (message) console.error(`dump-trace: ${message}`)
  console.error('usage: dump-trace.ts --corpus corpus.jsonl [--out trace.jsonl|-] [--from N] [--limit N] [--shard i/n]')
  console.error('         [--max-ticks N] [--hash-prefix-bytes 1..32] [--event-prefix-bytes 1..32]')
  console.error('         [--full-at <case> [--full-out path]] [--validate-only] [--ai-ablation none|all]')
  process.exit(2)
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    aiAblation: 'none',
    corpus: '',
    out: '-',
    from: 0,
    limit: null,
    shard: null,
    maxTicks: null,
    hashPrefixBytes: 8,
    eventPrefixBytes: 4,
    fullAt: null,
    fullOut: null,
    validateOnly: false,
  }
  const int = (name: string, text: string | undefined, min = 0) => {
    const value = Number(text)
    if (!Number.isInteger(value) || value < min) usage(`${name} needs an integer >= ${min}`)
    return value
  }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]!
    const next = () => argv[++index]
    switch (flag) {
      case '--corpus': args.corpus = next() ?? usage('--corpus needs a path'); break
      case '--out': args.out = next() ?? usage('--out needs a path'); break
      case '--from': args.from = int('--from', next()); break
      case '--limit': args.limit = int('--limit', next()); break
      case '--max-ticks': args.maxTicks = int('--max-ticks', next(), 1); break
      case '--hash-prefix-bytes': args.hashPrefixBytes = int('--hash-prefix-bytes', next(), 1); break
      case '--event-prefix-bytes': args.eventPrefixBytes = int('--event-prefix-bytes', next(), 1); break
      case '--full-at': args.fullAt = int('--full-at', next()); break
      case '--full-out': args.fullOut = next() ?? usage('--full-out needs a path'); break
      case '--validate-only': args.validateOnly = true; break
      case '--ai-ablation': {
        const value = next()
        if (value !== 'none' && value !== 'all') usage('--ai-ablation needs none or all')
        args.aiAblation = value
        break
      }
      case '--shard': {
        const match = /^(\d+)\/(\d+)$/.exec(next() ?? '')
        if (!match || Number(match[2]) < 1 || Number(match[1]) >= Number(match[2])) usage('--shard needs i/n with 0 <= i < n')
        args.shard = [Number(match[1]), Number(match[2])]
        break
      }
      case '-h':
      case '--help':
        usage()
      default:
        if (!flag.startsWith('--') && !args.corpus) args.corpus = flag
        else usage(`unknown argument ${flag}`)
    }
  }
  if (!args.corpus) usage('--corpus is required')
  if (args.hashPrefixBytes > 32 || args.eventPrefixBytes > 32) usage('prefix bytes must be <= 32')
  return args
}

interface LineSink {
  write(line: string): Promise<void>
  close(): Promise<void>
}

function openSink(path: string): LineSink {
  const target: WriteStream | NodeJS.WriteStream = path === '-' ? process.stdout : createWriteStream(path)
  let stream: Gzip | WriteStream | NodeJS.WriteStream = target
  if (path !== '-' && path.endsWith('.gz')) {
    const gzip = createGzip()
    gzip.pipe(target as WriteStream)
    stream = gzip
  }
  return {
    write(line) {
      return stream.write(`${line}\n`) ? Promise.resolve() : new Promise((resolve) => stream.once('drain', () => resolve()))
    },
    close() {
      if (stream === process.stdout) return Promise.resolve()
      return new Promise((resolve, reject) => {
        target.once('error', reject)
        target.once('finish', () => resolve())
        stream.end()
      })
    },
  }
}

/**
 * The oracle host, written as the first trace line. `useStdMathPow` is V8's
 * `--use-std-math-pow` flag (default on): with it, `Math.pow` calls the
 * platform libm, which on darwin is not V8's fdlibm port.
 */
export function oracleHost(aiAblation: AiAblation = 'none') {
  const nodeOptions = process.env.NODE_OPTIONS ?? ''
  const flags = [...process.execArgv, ...nodeOptions.split(/\s+/).filter(Boolean)]
  const lastPowFlag = flags.filter((flag) => /^--(no-)?use[-_]std[-_]math[-_]pow$/.test(flag)).at(-1)
  return {
    kind: 'header',
    traceFormat: TRACE_FORMAT_VERSION,
    stateHashVersion: STATE_HASH_VERSION,
    eventDigestVersion: EVENT_DIGEST_VERSION,
    platform: process.platform,
    arch: process.arch,
    node: process.versions.node,
    v8: process.versions.v8,
    execArgv: process.execArgv,
    nodeOptions,
    useStdMathPow: lastPowFlag === undefined ? true : !lastPowFlag.startsWith('--no-'),
    // Simulation options (absent = the default engine options).
    ...(aiAblation === 'none' ? {} : { aiAblation }),
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const lines = readFileSync(args.corpus, 'utf8').split('\n')
  if (lines.at(-1) === '') lines.pop()
  const end = args.limit === null ? lines.length : Math.min(lines.length, args.from + args.limit)
  const indexes: number[] = []
  for (let index = args.from; index < end; index += 1) {
    if (args.shard && index % args.shard[1] !== args.shard[0]) continue
    indexes.push(index)
  }

  if (args.validateOnly) {
    let failures = 0
    for (const index of indexes) {
      const parsed = raceConfigSchema.safeParse(JSON.parse(lines[index]!))
      if (!parsed.success) {
        failures += 1
        console.error(`case ${index}: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`)
      }
    }
    console.error(`validate: ${indexes.length - failures}/${indexes.length} configs accepted by raceConfigSchema`)
    process.exit(failures === 0 ? 0 : 1)
  }

  const out = openSink(args.out)
  await out.write(JSON.stringify(oracleHost(args.aiAblation)))
  const fullPath = args.fullAt === null
    ? null
    : args.fullOut ?? (args.out === '-' ? `full-${args.fullAt}.jsonl` : `${args.out.replace(/\.jsonl(\.gz)?$/, '')}.full-${args.fullAt}.jsonl`)
  const fullSink = fullPath ? openSink(fullPath) : null
  const fullLines: string[] = []

  const started = performance.now()
  let ok = 0
  let failed = 0
  let unfinished = 0
  for (const index of indexes) {
    const isFull = args.fullAt === index
    const record = runCase(index, lines[index]!, {
      maxTicks: args.maxTicks,
      aiAblation: args.aiAblation,
      hashPrefixBytes: args.hashPrefixBytes,
      eventPrefixBytes: args.eventPrefixBytes,
      full: isFull ? (line) => { fullLines.push(line) } : null,
    })
    if (isFull && fullSink) {
      for (const line of fullLines) await fullSink.write(line)
      fullLines.length = 0
    }
    if (record.ok) {
      ok += 1
      if (!record.finished) unfinished += 1
    } else {
      failed += 1
      console.error(`case ${index}: ${String(record.stage)} failed at tick ${String(record.tick)}: ${String(record.error)}`)
    }
    await out.write(JSON.stringify(record))
  }
  await out.close()
  if (fullSink) await fullSink.close()
  const seconds = (performance.now() - started) / 1000
  console.error(
    `dump-trace: ${indexes.length} cases (${ok} ok, ${failed} failed, ${unfinished} unfinished) in ${seconds.toFixed(1)}s`
    + (fullPath && args.fullAt !== null && indexes.includes(args.fullAt) ? `; full dump of case ${args.fullAt} -> ${fullPath}` : ''),
  )
  if (failed > 0) process.exitCode = 1
}

// Run only as a script, so tests and tools can import `visitState`/`jcs`.
const invokedPath = process.argv[1]
if (invokedPath && import.meta.url === pathToFileURL(realpathSync(invokedPath)).href) {
  main().catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
}
