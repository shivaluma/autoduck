// Browser runner for the WASM perf harness (served from crates/race-wasm/).
import init, { benchStubResim, engineBuildId } from '../pkg/race_wasm.js'
import { DEFAULTS, formatSummary, jsStubResim, timeRuns } from './bench-core.mjs'

const out = document.getElementById('out')
const form = document.getElementById('form')
const params = new URLSearchParams(location.search)
for (const key of ['ducks', 'ticks', 'work', 'iterations']) form[key].value = params.get(key) ?? DEFAULTS[key]
form.r.value = params.get('r') ?? ''

function log(line) {
  out.textContent += `${line}\n`
}

async function run() {
  const opts = {
    ducks: Number(form.ducks.value),
    ticks: Number(form.ticks.value),
    work: Number(form.work.value),
    iterations: Number(form.iterations.value),
  }
  out.textContent = ''
  log(`${navigator.userAgent}`)
  log(`engineBuildId ${engineBuildId().slice(0, 12)}…, ${opts.ducks} ducks x ${opts.ticks} ticks, work ${opts.work}`)
  // Yield so the page paints before the blocking runs.
  await new Promise((resolve) => setTimeout(resolve, 50))
  const now = () => performance.now()
  const wasm = timeRuns(benchStubResim, opts, now)
  log(formatSummary('wasm stub', wasm))
  const js = timeRuns(jsStubResim, opts, now)
  log(formatSummary('js stub  ', js))
  log(`wasm/js time ratio: ${(wasm.medianMs / js.medianMs).toFixed(2)}`)
  const r = Number(form.r.value)
  const result = { userAgent: navigator.userAgent, params: opts, wasmStub: wasm, jsStub: js }
  if (r > 0) {
    result.R = r
    result.estimatedWasmEngineFullResimMs = wasm.medianMs * r
    log(`estimated ported engine, full ${opts.ticks}-tick re-sim: ${result.estimatedWasmEngineFullResimMs.toFixed(1)} ms (R = ${r})`)
  }
  window.__benchResult = result
  document.body.dataset.done = '1'
}

form.addEventListener('submit', (event) => {
  event.preventDefault()
  run().catch((error) => log(`error: ${error}`))
})

await init()
out.textContent = 'ready\n'
if (params.get('autorun') === '1') await run()
