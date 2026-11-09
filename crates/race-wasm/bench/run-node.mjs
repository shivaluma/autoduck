// Node runner for the WASM perf harness. See README.md in this directory.
//
//   scripts/build-wasm.sh
//   node crates/race-wasm/bench/run-node.mjs [--ducks 8] [--ticks 5400] [--work 1]
//        [--iterations 15] [--warmup 3] [--pkg crates/race-wasm/pkg] [--json]
//   node --import tsx crates/race-wasm/bench/run-node.mjs --ts-reference
//
// `--ts-reference` also times the real TS engine on an 8-duck production-like
// race and prints R = (TS engine us/tick) / (JS stub us/tick), the factor used
// to extrapolate the stub's wasm time to the ported engine.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DEFAULTS, formatSummary, jsStubResim, summarize, timeRuns } from './bench-core.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../../..')

function parseArgs(argv) {
  const opts = { ...DEFAULTS, pkg: resolve(here, '../pkg'), tsReference: false, json: false }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    const value = () => {
      const v = argv[++i]
      if (v === undefined) throw new Error(`${flag} needs a value`)
      return v
    }
    switch (flag) {
      case '--ducks': opts.ducks = Number(value()); break
      case '--ticks': opts.ticks = Number(value()); break
      case '--work': opts.work = Number(value()); break
      case '--iterations': opts.iterations = Number(value()); break
      case '--warmup': opts.warmup = Number(value()); break
      case '--seed': opts.seed = Number(value()); break
      case '--pkg': opts.pkg = resolve(value()); break
      case '--ts-reference': opts.tsReference = true; break
      case '--json': opts.json = true; break
      default: throw new Error(`unknown argument ${flag}`)
    }
  }
  return opts
}

async function loadWasm(pkgDir) {
  const js = resolve(pkgDir, 'race_wasm.js')
  const wasm = resolve(pkgDir, 'race_wasm_bg.wasm')
  const mod = await import(pathToFileURL(js).href)
  if (typeof mod.initSync !== 'function') {
    throw new Error(`${js} has no initSync: build with scripts/build-wasm.sh (--bindgen-target web)`)
  }
  mod.initSync({ module: readFileSync(wasm) })
  return mod
}

function productionConfig(players) {
  // Same shape as lib/season3-race.ts writes for an official race.
  return {
    raceId: 'bench-1',
    seed: '5eed'.repeat(16),
    players: Array.from({ length: players }, (_, i) => ({ playerId: String(101 + i), name: `Duck ${i}` })),
    loadouts: Array.from({ length: players }, (_, i) => ({
      playerId: String(101 + i),
      itemIds: [['NITRO', 'BANANA'], ['HOMING_ROCKET', 'FEATHER'], ['BUBBLE_SHIELD', 'QUACK_HORN']][i % 3],
      source: 'AUTO',
    })),
    chaosConfig: { type: 'NORMAL' },
    pickupConfig: {
      enabled: true, goldenBoxEnabled: true, goldenBoxProbability: 0.15, hazardsEnabled: true,
      positionAwareLoot: true, spawnMultiplier: 1.25, regularPickupCap: 3, manualItemsEnabled: true,
      autoItemsEnabled: true, chaosBoxEnabled: false, forceGoldenBox: false, disabledItems: [], idealManualPlayerIds: [],
    },
  }
}

async function tsReference(opts) {
  const core = await import(pathToFileURL(resolve(repo, 'packages/race-core/src/index.ts')).href)
  const protocol = await import(pathToFileURL(resolve(repo, 'packages/race-protocol/src/index.ts')).href)
  const config = protocol.raceConfigSchema.parse(productionConfig(opts.ducks))
  const times = []
  let ticks = 0
  for (let i = 0; i < 1 + Math.max(2, Math.floor(opts.iterations / 5)); i += 1) {
    const started = performance.now()
    const state = core.createSimulation(config, { recordEvents: true })
    while (!state.finished && state.tick < opts.ticks) core.stepSimulation(state)
    const elapsed = performance.now() - started
    ticks = state.tick
    if (i > 0) times.push(elapsed) // first run is warm-up
  }
  return { ticks, summary: summarize(times, ticks, 0) }
}

const opts = parseArgs(process.argv.slice(2))
const wasm = await loadWasm(opts.pkg)
const now = () => performance.now()
const wasmStub = timeRuns(wasm.benchStubResim, opts, now)
const jsStub = timeRuns(jsStubResim, opts, now)
const result = {
  runtime: `node ${process.version}`,
  engineBuildId: wasm.engineBuildId(),
  params: { ducks: opts.ducks, ticks: opts.ticks, work: opts.work, iterations: opts.iterations },
  wasmStub,
  jsStub,
  wasmOverJs: wasmStub.medianMs / jsStub.medianMs,
}
if (opts.tsReference) {
  const ts = await tsReference(opts)
  const r = ts.summary.perTickUs / jsStub.perTickUs
  result.tsEngine = { finishedAtTick: ts.ticks, ...ts.summary }
  result.R = r
  result.estimatedWasmEngineFullResimMs = wasmStub.medianMs * r
}

if (opts.json) {
  console.log(JSON.stringify(result, null, 2))
} else {
  console.log(`runtime ${result.runtime}, engineBuildId ${result.engineBuildId.slice(0, 12)}…`)
  console.log(`params: ${opts.ducks} ducks x ${opts.ticks} ticks, work ${opts.work}, ${opts.iterations} iterations`)
  console.log(formatSummary('wasm stub', wasmStub))
  console.log(formatSummary('js stub  ', jsStub))
  console.log(`wasm/js time ratio: ${result.wasmOverJs.toFixed(2)}`)
  if (result.tsEngine) {
    console.log(`ts engine: ${result.tsEngine.perTickUs.toFixed(2)} us/tick (finished at tick ${result.tsEngine.finishedAtTick}), median ${result.tsEngine.medianMs.toFixed(1)} ms`)
    console.log(`R = ts engine / js stub per tick = ${result.R.toFixed(2)}`)
    console.log(`estimated ported engine, full ${opts.ticks}-tick re-sim in wasm (this machine, no throttle): ${result.estimatedWasmEngineFullResimMs.toFixed(1)} ms`)
  }
}
