export interface RateEstimate {
  estimate: number
  wilsonLow: number
  wilsonHigh: number
  bootstrapLow: number
  bootstrapHigh: number
  successes: number
  trials: number
  effectiveSeeds: number
  pairedSwapDiscordant: number
  pairedSwapMcNemarP: number | null
}

export interface SeedSwapOutcome {
  seedIndex: number
  leftWins: boolean[]
}

export function wilsonInterval(successes: number, trials: number, z = 1.96) {
  if (trials <= 0) return { estimate: 0.5, low: 0, high: 1 }
  const p = successes / trials
  const denom = 1 + (z * z) / trials
  const center = (p + (z * z) / (2 * trials)) / denom
  const margin = (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * trials)) / trials)) / denom
  return { estimate: p, low: Math.max(0, center - margin), high: Math.min(1, center + margin) }
}

function mcnemarP(b: number, c: number) {
  if (b + c === 0) return null
  const diff = Math.abs(b - c)
  const n = b + c
  return Math.min(1, Math.exp(-0.5 * diff * diff / n))
}

export function seedBootstrapRate(seeds: SeedSwapOutcome[], iterations = 2_000, estimate = 0.5) {
  if (iterations <= 0) return { low: estimate, high: estimate, median: estimate }
  if (seeds.length === 0) return { low: estimate, high: estimate, median: estimate }
  const rates: number[] = []
  for (let i = 0; i < iterations; i += 1) {
    let wins = 0
    let trials = 0
    for (let j = 0; j < seeds.length; j += 1) {
      const seed = seeds[Math.floor(Math.random() * seeds.length)]!
      for (const leftWon of seed.leftWins) {
        trials += 1
        if (leftWon) wins += 1
      }
    }
    rates.push(trials === 0 ? 0.5 : wins / trials)
  }
  rates.sort((left, right) => left - right)
  return {
    low: rates[Math.floor(rates.length * 0.025)] ?? 0,
    high: rates[Math.floor(rates.length * 0.975)] ?? 1,
    median: rates[Math.floor(rates.length * 0.5)] ?? 0.5,
  }
}

export function estimateLeftWinRate(seeds: SeedSwapOutcome[], bootstrapIterations = 2_000): RateEstimate {
  let successes = 0
  let trials = 0
  let swapOnlyLeft = 0
  let swapOnlyRight = 0

  for (const seed of seeds) {
    if (seed.leftWins.length === 2) {
      const first = seed.leftWins[0]!
      const second = seed.leftWins[1]!
      if (first && !second) swapOnlyLeft += 1
      if (!first && second) swapOnlyRight += 1
    }
    for (const leftWon of seed.leftWins) {
      trials += 1
      if (leftWon) successes += 1
    }
  }

  const wilson = wilsonInterval(successes, trials)
  const bootstrap = seedBootstrapRate(seeds, bootstrapIterations, wilson.estimate)
  return {
    estimate: wilson.estimate,
    wilsonLow: wilson.low,
    wilsonHigh: wilson.high,
    bootstrapLow: bootstrap.low,
    bootstrapHigh: bootstrap.high,
    successes,
    trials,
    effectiveSeeds: seeds.length,
    pairedSwapDiscordant: swapOnlyLeft + swapOnlyRight,
    pairedSwapMcNemarP: mcnemarP(swapOnlyLeft, swapOnlyRight),
  }
}

export function effectSizePp(rate: RateEstimate) {
  return (rate.estimate - 0.5) * 100
}

export function formatRatePct(rate: RateEstimate, options: { includeBootstrap?: boolean } = {}) {
  const includeBootstrap = options.includeBootstrap ?? true
  const pct = (value: number) => `${(value * 100).toFixed(2)}%`
  const effect = `${effectSizePp(rate) >= 0 ? '+' : ''}${effectSizePp(rate).toFixed(2)}pp`
  const base = `${pct(rate.estimate)} [Wilson ${pct(rate.wilsonLow)}–${pct(rate.wilsonHigh)} · effect ${effect} · seeds=${rate.effectiveSeeds} · trials=${rate.trials}]`
  if (!includeBootstrap) return base
  return `${base} · bootstrap ${pct(rate.bootstrapLow)}–${pct(rate.bootstrapHigh)}`
}

export function formatRateScreening(rate: RateEstimate) {
  const pct = (value: number) => `${(value * 100).toFixed(2)}%`
  const effect = `${effectSizePp(rate) >= 0 ? '+' : ''}${effectSizePp(rate).toFixed(2)}pp`
  const mcnemar = rate.pairedSwapMcNemarP === null ? 'McNemar n/a' : `McNemar p≈${rate.pairedSwapMcNemarP.toFixed(4)}`
  return `${pct(rate.estimate)} [Wilson ${pct(rate.wilsonLow)}–${pct(rate.wilsonHigh)} · effect ${effect} · ${mcnemar}]`
}

export function raceLayerVerdict(leftWinPct: number) {
  if (leftWinPct >= 49 && leftWinPct <= 51) return 'NEUTRAL'
  if (leftWinPct > 51 && leftWinPct <= 53) return 'SOFT_EDGE'
  if (leftWinPct > 53 && leftWinPct <= 57) return 'STRONG_EDGE'
  if (leftWinPct > 57 && leftWinPct <= 60) return 'WATCH'
  if (leftWinPct > 60 || leftWinPct < 40) return 'FAIL'
  return 'DRIFT'
}

export function combinedCounterVerdict(raceWinPct: number, interactionStrength: number) {
  const race = raceLayerVerdict(raceWinPct)
  const interaction = interactionLayerVerdict(interactionStrength)
  if (interaction === 'STRONG' || interaction === 'CLEAR') {
    if (race === 'NEUTRAL' || race === 'SOFT_EDGE') return 'MECHANIC COUNTER EXISTS · OUTCOME EDGE DILUTED BY 8-DUCK FIELD · HEALTHY'
  }
  if (race === 'FAIL' || race === 'WATCH') return `RACE ${race} · INTERACTION ${interaction}`
  return `${race} · INTERACTION ${interaction}`
}

export function interactionLayerVerdict(effectStrength: number) {
  if (effectStrength >= 0.45) return 'STRONG'
  if (effectStrength >= 0.25) return 'CLEAR'
  if (effectStrength >= 0.12) return 'SOFT'
  return 'WEAK'
}
