// Shared WASM perf-harness logic (Node runner and browser page).
//
// `jsStubResim` is a line-for-line JS port of `race_wasm::stub::resim` so the
// same workload can be timed in V8 JIT and in wasm. Its checksum differs
// slightly from the wasm one (V8 and Rust std use different exp/pow), which
// is expected: the stub is a load generator, not a determinism fixture.

export const DEFAULTS = Object.freeze({ ducks: 8, ticks: 5400, work: 1, seed: 1, warmup: 3, iterations: 15 })
export const FRAME_MS = 1000 / 60
export const CHUNK_TICKS = 500 // C9: catch-up runs in 500-tick chunks in a Web Worker

const BASE_SPEED = 1 / 100
const DT = 1 / 60

function clampJs(v, lo, hi) {
  const low = v < lo ? lo : v
  return low > hi ? hi : low
}

function pacing(segments, progress) {
  const p = clampJs(progress, 0, 1)
  const width = 0.25
  const first = width * 0.5
  const last = 1 - width * 0.5
  if (p <= first) return segments[0]
  if (p >= last) return segments[3]
  const n = (p - first) / width
  const index = Math.min(2, Math.trunc(n))
  const t = n - index
  const smooth = t * t * (3 - 2 * t)
  return segments[index] + (segments[index + 1] - segments[index]) * smooth
}

function current(progress) {
  if (progress >= 0.14 && progress < 0.24) return [1.035, 0.05]
  if (progress >= 0.42 && progress < 0.52) return [0.97, -0.06]
  if (progress >= 0.7 && progress < 0.82) return [1.045, 0.04]
  return [1, 0]
}

export function jsStubResim(count, ticks, work, seed) {
  count = Math.max(1, Math.min(64, count))
  const ducks = []
  for (let i = 0; i < count; i += 1) {
    const rng = { s: ((seed ^ Math.imul(i, 0x9e3779b9)) | 1) >>> 0 }
    const segs = [0, 0, 0, 0]
    let sum = 0
    for (let k = 0; k < 4; k += 1) { segs[k] = range(rng, -0.18, 0.18); sum += segs[k] }
    const mean = sum / 4
    for (let k = 0; k < 4; k += 1) segs[k] = 1 + (segs[k] - mean)
    const lateral = -0.75 + (1.5 * i) / (Math.max(2, count) - 1)
    ducks.push({
      progress: 0, lateral, speed: BASE_SPEED * segs[0], acceleration: 0, lateralVelocity: 0,
      desiredSpeed: BASE_SPEED * range(rng, 0.97, 1.03), desiredLateral: lateral, pacing: segs,
      nextImpulse: 30 + (nextU32(rng) % 36), rng, rank: i + 1, finished: false,
    })
  }
  const order = ducks.map((_, i) => i)
  let fold = 0
  for (let tick = 1; tick <= ticks; tick += 1) {
    for (let i = 0; i < count; i += 1) {
      if (ducks[i].finished) continue
      let utility = 0
      for (let w = 0; w < Math.max(1, work); w += 1) {
        for (let j = 0; j < count; j += 1) {
          if (i === j) continue
          const dp = (ducks[j].progress - ducks[i].progress) * 42
          const dl = ducks[j].lateral - ducks[i].lateral
          const distance = Math.hypot(dp, dl)
          utility += Math.exp(-distance * 1.7) * Math.pow(1 + distance, 0.65)
        }
      }
      const d = ducks[i]
      if (tick >= d.nextImpulse) {
        d.desiredSpeed = BASE_SPEED * range(d.rng, 0.97, 1.03)
        d.acceleration = range(d.rng, -0.03, 0.03) * BASE_SPEED
        d.desiredLateral = clampJs(range(d.rng, -0.8, 0.8) + utility * 1e-3, -0.9, 0.9)
        d.nextImpulse = tick + 30 + (nextU32(d.rng) % 36)
      }
      const [speedMul, lateralForce] = current(d.progress)
      const target = d.desiredSpeed * pacing(d.pacing, d.progress) + d.acceleration
      d.speed += (target - d.speed) * 1.65 * DT
      const desiredLv = (d.desiredLateral - d.lateral) * 2.5 + lateralForce
      d.lateralVelocity += (desiredLv - d.lateralVelocity) * 2.8 * DT
      d.lateralVelocity = clampJs(d.lateralVelocity, -0.85, 0.85)
      d.lateral = clampJs(d.lateral + d.lateralVelocity * DT, -0.95, 0.95)
      const step = d.speed * speedMul * DT
      d.progress += step > 0 ? step : 0
      if (d.progress >= 1) { d.progress = 1; d.finished = true }
    }
    for (let i = 0; i < count; i += 1) {
      for (let j = i + 1; j < count; j += 1) {
        const dp = ducks[j].progress - ducks[i].progress
        const dl = ducks[j].lateral - ducks[i].lateral
        if (Math.abs(dp) < 0.009 && Math.abs(dl) < 0.18) {
          const push = dl >= 0 ? 0.02 : -0.02
          ducks[i].lateral = clampJs(ducks[i].lateral - push, -0.95, 0.95)
          ducks[j].lateral = clampJs(ducks[j].lateral + push, -0.95, 0.95)
          ducks[i].speed *= 0.992
          ducks[j].speed *= 0.992
        }
      }
    }
    order.sort((a, b) => ducks[b].progress - ducks[a].progress || a - b)
    for (let r = 0; r < order.length; r += 1) ducks[order[r]].rank = r + 1
    if (tick % 60 === 0) {
      for (const d of ducks) fold = (fold * 31 + d.progress + d.lateral + d.speed + d.rank) % 1e9
    }
    if (ducks.every((d) => d.finished)) break
  }
  let checksum = fold
  for (const d of ducks) checksum += d.progress + d.lateral
  return checksum
}

function nextU32(rng) {
  let v = rng.s
  v ^= v << 13
  v ^= v >>> 17
  v ^= v << 5
  rng.s = v >>> 0
  return rng.s
}

function range(rng, lo, hi) {
  return lo + (hi - lo) * (nextU32(rng) / 4294967296)
}

/** Time `fn(ducks, ticks, work, seed)`; returns summary statistics in ms. */
export function timeRuns(fn, opts, now) {
  const { ducks, ticks, work, seed, warmup, iterations } = { ...DEFAULTS, ...opts }
  let checksum = 0
  for (let i = 0; i < warmup; i += 1) checksum = fn(ducks, ticks, work, seed + i)
  const times = []
  for (let i = 0; i < iterations; i += 1) {
    const started = now()
    checksum = fn(ducks, ticks, work, seed)
    times.push(now() - started)
  }
  return summarize(times, ticks, checksum)
}

export function summarize(times, ticks, checksum) {
  const sorted = [...times].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  const perTickMs = median / ticks
  return {
    iterations: times.length,
    minMs: sorted[0],
    medianMs: median,
    p90Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))],
    perTickUs: perTickMs * 1000,
    chunkMs: perTickMs * CHUNK_TICKS,
    ticksPerFrame: FRAME_MS / perTickMs,
    checksum,
  }
}

export function formatSummary(label, s) {
  return `${label}: median ${s.medianMs.toFixed(2)} ms (min ${s.minMs.toFixed(2)}, p90 ${s.p90Ms.toFixed(2)}), `
    + `${s.perTickUs.toFixed(2)} us/tick, ${s.chunkMs.toFixed(2)} ms per ${CHUNK_TICKS}-tick chunk, `
    + `${s.ticksPerFrame.toFixed(0)} ticks per 16.7 ms frame [checksum ${s.checksum}]`
}
