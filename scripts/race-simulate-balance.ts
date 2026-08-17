import { performance } from 'node:perf_hooks'
import os from 'node:os'
import { simulateRace } from '../packages/race-core/src'
import {
  FULL_LOADOUTS,
  ITEM_CLASSES,
  allPureCrossMatchups,
  allPureClassMatchups,
  createRaceConfig,
  emptyMatchupAggregate,
  emptyRunningStats,
  loadoutArchetype,
  loadoutKey,
  mergeMatchupAggregate,
  mergeRaceInstrumentation,
  runFocusedLoadoutRace,
  runMatchupBatch,
  summarizeStats,
  upperTrianglePairs,
  type FullLoadout,
  type MatchupAggregate,
  type RaceInstrumentation,
} from './lib/balance-sim-core'
import { formatProfileReport, profilePairedSimulation } from './lib/balance-sim-profile'
import { BalanceSimWorkerPool } from './lib/balance-sim-worker-pool'
import {
  estimateLeftWinRate,
  formatRatePct,
  formatRateScreening,
  interactionLayerVerdict,
  raceLayerVerdict,
  type RateEstimate,
} from './lib/balance-sim-stats'
import type { ItemClass } from '../packages/race-core/src/items/classes'
import type { RaceItemId } from '../packages/race-protocol/src'

function argument(name: string, fallback: number) {
  const index = process.argv.indexOf(name)
  const value = index >= 0 ? Number(process.argv[index + 1]) : fallback
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`)
  return value
}

function bootstrapSection(name: 'matrix' | 'archetype' | 'spotlight', fallback: number) {
  const prefix = `--bootstrap-${name}`
  const inline = process.argv.find((arg) => arg.startsWith(`${prefix}=`))
  if (inline) return Number(inline.slice(prefix.length + 1))
  const index = process.argv.indexOf(prefix)
  if (index >= 0) return Number(process.argv[index + 1])
  const legacy = process.argv.indexOf('--bootstrap-iterations')
  if (legacy >= 0 && name !== 'matrix') return Number(process.argv[legacy + 1])
  return fallback
}

function flag(name: string) {
  return process.argv.includes(name)
}

function modeArg() {
  const index = process.argv.indexOf('--mode')
  const value = index >= 0 ? process.argv[index + 1] : 'screen'
  const allowed = ['baseline', 'archetype', 'matrix', 'absolute', 'screen', 'report', 'profile', 'benchmark'] as const
  if (!allowed.includes(value as typeof allowed[number])) throw new Error(`--mode must be one of ${allowed.join(' | ')}`)
  return value as typeof allowed[number]
}

const mode = modeArg()
const seeds = argument('--seeds', mode === 'matrix' ? 2_000 : 10_000)
const matrixSeeds = argument('--matrix-seeds', 2_000)
const startIndex = argument('--start', 1)
const playerCount = argument('--players', 8)
const workerCount = argument('--workers', Math.max(1, os.cpus().length - 1))
const swapSlots = !flag('--no-swap')
if (playerCount < 2 || playerCount > 16) throw new Error('--players must be between 2 and 16')

const bootstrapMatrix = bootstrapSection('matrix', mode === 'screen' || mode === 'matrix' ? 0 : 0)
const bootstrapArchetype = bootstrapSection('archetype', mode === 'screen' ? 1_000 : mode === 'benchmark' ? 0 : 2_000)
const bootstrapSpotlight = bootstrapSection('spotlight', mode === 'screen' ? 1_000 : 2_000)

const perf = {
  races: 0,
  wallMs: 0,
  simulateMs: 0,
  heapBeforeMb: 0,
  heapAfterMb: 0,
  rssAfterMb: 0,
}

let workerPool: BalanceSimWorkerPool | null = null

function getWorkerPool() {
  if (!workerPool && workerCount > 1) workerPool = new BalanceSimWorkerPool(workerCount)
  return workerPool
}

function runWorkerBatch(left: FullLoadout, right: FullLoadout, seedCount: number): Promise<MatchupAggregate> {
  const started = performance.now()
  if (workerCount <= 1 || seedCount < workerCount * 4) {
    const result = runMatchupBatch(left, right, startIndex, seedCount, playerCount, swapSlots)
    perf.races += seedCount * (swapSlots ? 2 : 1)
    perf.simulateMs += performance.now() - started
    return Promise.resolve(result)
  }

  const pool = getWorkerPool()
  if (!pool) {
    const result = runMatchupBatch(left, right, startIndex, seedCount, playerCount, swapSlots)
    perf.races += seedCount * (swapSlots ? 2 : 1)
    perf.simulateMs += performance.now() - started
    return Promise.resolve(result)
  }

  return pool.runShardedBatch(left, right, startIndex, seedCount, playerCount, swapSlots).then((result) => {
    perf.races += seedCount * (swapSlots ? 2 : 1)
    perf.simulateMs += performance.now() - started
    return result
  })
}

function printRateLine(label: string, rate: RateEstimate, verdict: string, bootstrapIterations: number) {
  console.log(`${label}: ${formatRatePct(rate, { includeBootstrap: bootstrapIterations > 0 })} · verdict ${verdict}`)
}

function printMatchupSummary(aggregate: MatchupAggregate, bootstrapIterations: number, leftClass?: ItemClass, rightClass?: ItemClass) {
  const rate = estimateLeftWinRate(aggregate.seedOutcomes, bootstrapIterations)
  const leftSummary = summarizeStats(aggregate.left, playerCount)
  const rightSummary = summarizeStats(aggregate.right, playerCount)
  const verdict = raceLayerVerdict(rate.estimate * 100)
  console.log(`\n${aggregate.key}`)
  printRateLine('  head-to-head', rate, verdict, bootstrapIterations)
  console.log(`  left  → win ${leftSummary.winPct}% top3 ${leftSummary.top3Pct}% avg ${leftSummary.avgRank} bottom2 ${leftSummary.bottom2Pct}% σ ${leftSummary.stdRank} ownerΔ ${leftSummary.ownerFinishPositionsImproved}`)
  console.log(`  right → win ${rightSummary.winPct}% top3 ${rightSummary.top3Pct}% avg ${rightSummary.avgRank} bottom2 ${rightSummary.bottom2Pct}% σ ${rightSummary.stdRank} ownerΔ ${rightSummary.ownerFinishPositionsImproved}`)
  if (rate.pairedSwapMcNemarP !== null) {
    console.log(`  effect size ${(rate.estimate * 100 - 50).toFixed(2)}pp · slot-swap McNemar p≈${rate.pairedSwapMcNemarP.toFixed(4)} (discordant=${rate.pairedSwapDiscordant})`)
  }
}

function printCounterLayer(instrumentation: RaceInstrumentation) {
  const c = instrumentation.counters
  const boostSuccessRate = c.boostBreakOpportunities ? c.boostBreakSuccess / c.boostBreakOpportunities : 0
  const meanBoostFractionDenied = c.boostBreakSuccess ? c.boostFractionDeniedSum / c.boostBreakSuccess : 0
  const meanBoostSecondsDestroyed = c.boostBreakSuccess ? c.boostSecondsDestroyedSum / c.boostBreakSuccess : 0
  const meanRocketBoostSecondsDestroyed = c.boostBreakSuccess ? c.rocketBoostSecondsDestroyedSum / c.boostBreakSuccess : 0
  const meanBananaBoostSecondsDestroyed = c.boostBreakSuccess ? c.bananaBoostSecondsDestroyedSum / c.boostBreakSuccess : 0
  const meanBoostDistanceDenied = c.boostBreakSuccess ? c.boostDistanceDeniedSum / c.boostBreakSuccess : 0
  const blockRate = c.eligibleAttacksReceived ? c.attacksFullyBlocked / c.eligibleAttacksReceived : 0
  const mitigateRate = c.eligibleAttacksReceived ? c.attacksMitigated / c.eligibleAttacksReceived : 0
  const defenseUnusedRate = c.defenseItemsEquipped ? c.defenseItemsUnused / c.defenseItemsEquipped : 0
  const attackSpeedInteraction = meanBoostFractionDenied || boostSuccessRate
  console.log('\n=== Counter mechanic layer (focus ducks only) ===')
  console.log(`ATTACK → SPEED: ops ${c.boostBreakOpportunities} · success ${c.boostBreakSuccess} · success rate ${(boostSuccessRate * 100).toFixed(1)}% · mean boost fraction denied ${(meanBoostFractionDenied * 100).toFixed(1)}% · mean seconds destroyed ${meanBoostSecondsDestroyed.toFixed(2)} (rocket ${meanRocketBoostSecondsDestroyed.toFixed(2)} · banana ${meanBananaBoostSecondsDestroyed.toFixed(2)}) · mean distance denied ${meanBoostDistanceDenied.toFixed(4)} · interaction ${interactionLayerVerdict(attackSpeedInteraction)}`)
  console.log(`DEFENSE → ATTACK: eligible attacks ${c.eligibleAttacksReceived} · blocked ${c.attacksFullyBlocked} (${(blockRate * 100).toFixed(1)}%) · mitigated ${c.attacksMitigated} (${(mitigateRate * 100).toFixed(1)}%) · ${interactionLayerVerdict(blockRate + mitigateRate * 0.5)}`)
  console.log(`SPEED → DEFENSE: speed activations ${c.speedActivations} · owner positions improved sum ${c.speedOwnerPositionsImprovedSum.toFixed(2)} · defense unused rate ${(defenseUnusedRate * 100).toFixed(1)}%`)
}

function printWastedValueLayer(instrumentation: RaceInstrumentation) {
  const { nitro, draft, rocket, banana, horn } = instrumentation.value
  console.log('\n=== Wasted value layer (focus ducks · decompose rank delta) ===')
  console.log(`Nitro: granted ${nitro.boostSecondsGranted.toFixed(2)}s · consumed ${nitro.boostSecondsConsumed.toFixed(2)}s · queued ${nitro.boostSecondsQueued.toFixed(2)}s · broken ${nitro.boostSecondsBroken.toFixed(2)}s (rocket ${nitro.boostSecondsBrokenByRocket.toFixed(2)}s · banana ${nitro.boostSecondsBrokenByBanana.toFixed(2)}s) · distance +${nitro.boostDistanceGenerated.toFixed(4)} / denied ${nitro.boostDistanceDenied.toFixed(4)}`)
  if (nitro.activationsCount > 0) {
    const total = nitro.activationsCount
    console.log(`Nitro conversion (${total} activations):`)
    console.log(`  ├─ produced 0 overtakes: ${nitro.produced0Overtakes} (${((nitro.produced0Overtakes / total) * 100).toFixed(1)}%)`)
    console.log(`  ├─ produced 1 overtake: ${nitro.produced1Overtake} (${((nitro.produced1Overtake / total) * 100).toFixed(1)}%)`)
    console.log(`  ├─ produced 2+ overtakes: ${nitro.produced2PlusOvertakes} (${((nitro.produced2PlusOvertakes / total) * 100).toFixed(1)}%)`)
    console.log(`  ├─ escaped loser zone: ${nitro.escapedLoserZone} (${((nitro.escapedLoserZone / total) * 100).toFixed(1)}%)`)
    console.log(`  ├─ converted to #1: ${nitro.convertedToWin} (${((nitro.convertedToWin / total) * 100).toFixed(1)}%)`)
    console.log(`  ├─ broken by Rocket: ${nitro.brokenByRocketCount} (${((nitro.brokenByRocketCount / total) * 100).toFixed(1)}%)`)
    console.log(`  └─ boost value wasted: ${nitro.boostValueWastedCount} (${((nitro.boostValueWastedCount / total) * 100).toFixed(1)}%)`)
  }
  console.log(`Draft: charge attempts ${draft.chargeAttempts} · procs ${draft.successfulProcs} · horn charge lost ${draft.chargeSecondsLostByHorn.toFixed(2)}s · collision charge lost ${draft.chargeSecondsLostByCollision.toFixed(2)}s · boost distance ${draft.boostDistanceGenerated.toFixed(4)}`)
  console.log(`Rocket: fired ${rocket.fired} · valid@decide ${rocket.validTargetAtDecision} · valid@execute ${rocket.validTargetAtExecution} · hit ${rocket.hit} · block ${rocket.block} · mitigate ${rocket.mitigate} · boost destroyed ${rocket.boostSecondsDestroyed.toFixed(2)}s · victim distance denied ${rocket.victimDistanceDenied.toFixed(4)}`)
  console.log(`Banana: drops ${banana.drops} · predicted intersection sum ${banana.predictedIntersectionSum.toFixed(1)} · collisions ${banana.actualCollisions} · boost breaks ${banana.boostBreaks} · distance denied ${banana.distanceDenied.toFixed(4)}`)
  console.log(`Horn: uses ${horn.uses} · ducks hit ${horn.ducksHit} · slipstream charge destroyed ${horn.slipstreamChargeDestroyedSeconds.toFixed(2)}s · teammate avoided ${horn.teammateAvoided} · hazard-assisted displacement ${horn.hazardAssistedDisplacement.toFixed(4)}`)
}

function printItemOpportunity(instrumentation: RaceInstrumentation) {
  console.log('\n=== Item opportunity / impact (positive ownerΔ = good for owner) ===')
  const rows = (Object.keys(instrumentation.items) as RaceItemId[]).map((itemId) => {
    const item = instrumentation.items[itemId]!
    const activations = item.organicActivations + item.fallbackActivations + item.forceBurnActivations
    const meaningfulRate = activations ? `${((item.meaningfulEffects / activations) * 100).toFixed(1)}%` : '—'
    return {
      item: itemId,
      equipped: item.equippedRaces,
      organic: item.organicActivations,
      fallback: item.fallbackActivations,
      forceBurn: item.forceBurnActivations,
      activationRate: item.equippedRaces ? `${((activations / item.equippedRaces) * 100).toFixed(1)}%` : '—',
      meaningfulRate,
      eligibleThreats: item.eligibleThreats || '—',
      collisionOps: item.actualCollisionOpportunities || '—',
      defenseAvailable: item.defenseAvailableAtExposure || '—',
      successfulProcs: item.successfulProcs || '—',
      procWhenExposed: item.eligibleThreats ? `${((item.successfulProcs / item.eligibleThreats) * 100).toFixed(1)}%` : '—',
      ownerFinishPositionsImproved: item.ownerFinishPositionsImprovedCount ? (item.ownerFinishPositionsImprovedSum / item.ownerFinishPositionsImprovedCount).toFixed(3) : '—',
      victimFinishPositionsLost: item.victimFinishPositionsLostCount ? (item.victimFinishPositionsLostSum / item.victimFinishPositionsLostCount).toFixed(3) : '—',
    }
  })
  console.table(rows)
  const feather = instrumentation.items.FEATHER!
  const exposureRate = feather.equippedRaces ? ((instrumentation.featherExposureRaces / feather.equippedRaces) * 100).toFixed(1) : '0.0'
  console.log(`Feather: equipped ${feather.equippedRaces} races · race exposure rate ${exposureRate}% · eligibleThreats ${feather.eligibleThreats} · defenseAvailable ${feather.defenseAvailableAtExposure} · successfulProcs ${feather.successfulProcs} · procWhenExposed ${feather.eligibleThreats ? ((feather.successfulProcs / feather.eligibleThreats) * 100).toFixed(1) : '0.0'}%`)
}

async function runBaselineSymmetry(seedCount: number) {
  console.log(`\n=== Baseline symmetry (${seedCount.toLocaleString()} seeds · ${playerCount} players) ===`)
  const slotStats = Array.from({ length: playerCount }, () => emptyRunningStats())
  for (let offset = 0; offset < seedCount; offset += 1) {
    const result = simulateRace(createRaceConfig(startIndex + offset, playerCount), { recordEvents: false })
    for (const entry of result.standings) {
      const slot = Number(entry.playerId.split('-')[1]) - 1
      const stats = slotStats[slot]!
      stats.samples += 1
      stats.rankSum += entry.rank
      if (entry.rank === 1) stats.wins += 1
      if (entry.rank <= 3) stats.top3 += 1
      if (entry.rank > playerCount - 2) stats.bottom2 += 1
    }
  }
  console.table(slotStats.map((stats, index) => ({
    slot: index + 1,
    winPct: `${((stats.wins / stats.samples) * 100).toFixed(2)}%`,
    avgRank: (stats.rankSum / stats.samples).toFixed(3),
    bottom2Pct: `${((stats.bottom2 / stats.samples) * 100).toFixed(2)}%`,
  })))
}

async function runPureArchetypeAggregate(seedCount: number) {
  console.log(`\n=== Pure archetype aggregate (all 2×2 pure loadouts · ${seedCount.toLocaleString()} seeds/pair · workers=${workerCount}) ===`)
  console.log('Race-layer target for intended counter: 51–53% soft edge (not 55%+)\n')
  const matrixRates: Record<string, Record<string, RateEstimate>> = {}
  const combinedInstrumentation = emptyMatchupAggregate(['NITRO', 'DRAFT_FIN'], ['NITRO', 'DRAFT_FIN']).instrumentation

  for (const rowClass of ITEM_CLASSES) {
    matrixRates[rowClass] = {}
    for (const colClass of ITEM_CLASSES) {
      const pairs = rowClass === colClass
        ? allPureClassMatchups(rowClass)
        : allPureCrossMatchups(rowClass, colClass)
      const merged = emptyMatchupAggregate(pairs[0]![0], pairs[0]![1])
      for (const [left, right] of pairs) {
        const part = await runWorkerBatch(left, right, seedCount)
        mergeMatchupAggregate(merged, part)
        mergeRaceInstrumentation(combinedInstrumentation, part.instrumentation)
      }
      matrixRates[rowClass]![colClass] = estimateLeftWinRate(merged.seedOutcomes, bootstrapArchetype)
      if (rowClass <= colClass) printMatchupSummary(merged, bootstrapArchetype, rowClass, colClass)
    }
  }

  console.log('\nAggregate matrix (row class win % vs column class · all pure 2×2 pairs pooled):')
  console.table(Object.fromEntries(ITEM_CLASSES.map((rowClass) => [
    rowClass,
    Object.fromEntries(ITEM_CLASSES.map((colClass) => {
      const rate = matrixRates[rowClass]![colClass]!
      return [colClass, `${(rate.estimate * 100).toFixed(1)}% ${raceLayerVerdict(rate.estimate * 100)}`]
    })),
  ])))

  printCounterLayer(combinedInstrumentation)
  printWastedValueLayer(combinedInstrumentation)
  printItemOpportunity(combinedInstrumentation)
}

async function runAbsoluteLoadouts(seedCount: number) {
  console.log(`\n=== Absolute loadout screening (${seedCount.toLocaleString()} seeds/loadout · slot 1 focus) ===`)
  const rows = []
  for (const loadout of FULL_LOADOUTS) {
    const stats = emptyRunningStats()
    for (let offset = 0; offset < seedCount; offset += 1) {
      const observation = runFocusedLoadoutRace(startIndex + offset, loadout, 1, playerCount)
      stats.samples += 1
      stats.rankSum += observation.rank
      stats.ownerFinishPositionsImprovedSum += observation.baselineRank - observation.rank
      if (observation.rank === 1) stats.wins += 1
      if (observation.rank <= 3) stats.top3 += 1
      if (observation.rank > playerCount - 2) stats.bottom2 += 1
    }
    const summary = summarizeStats(stats, playerCount)
    rows.push({ loadout: loadoutKey(loadout), archetype: loadoutArchetype(loadout), ...summary })
  }
  rows.sort((left, right) => right.winPct - left.winPct)
  console.table(rows.map((row) => ({
    loadout: row.loadout,
    archetype: row.archetype,
    winPct: `${row.winPct}%`,
    top3Pct: `${row.top3Pct}%`,
    bottom2Pct: `${row.bottom2Pct}%`,
    avgRank: row.avgRank,
    ownerFinishPositionsImproved: row.ownerFinishPositionsImproved,
    stdRank: row.stdRank,
  })))
  const best = rows[0]!
  const worst = rows[rows.length - 1]!
  console.log(`Spread: best ${best.loadout} win ${best.winPct}% bottom2 ${best.bottom2Pct}% | worst ${worst.loadout} win ${worst.winPct}% bottom2 ${worst.bottom2Pct}% | gap ${(best.winPct - worst.winPct).toFixed(2)}pp`)
}

async function runMatrixScreening(seedCount: number) {
  console.log(`\n=== 18×18 upper triangle screening (${seedCount.toLocaleString()} seeds/pair · ${upperTrianglePairs(FULL_LOADOUTS).length} pairs · bootstrap=${bootstrapMatrix} · workers=${workerCount}) ===`)
  const outliers: string[] = []
  const pairs = upperTrianglePairs(FULL_LOADOUTS)
  const started = performance.now()
  for (let index = 0; index < pairs.length; index += 1) {
    const [left, right] = pairs[index]!
    const aggregate = await runWorkerBatch(left, right, seedCount)
    const rate = estimateLeftWinRate(aggregate.seedOutcomes, bootstrapMatrix)
    const leftPct = rate.estimate * 100
    if (Math.abs(leftPct - 50) >= 8 || leftPct > 60 || leftPct < 40) {
      outliers.push(`${loadoutKey(left)} vs ${loadoutKey(right)}: ${leftPct.toFixed(1)}% [${formatRateScreening(rate)}]`)
    }
    if ((index + 1) % 17 === 0) console.error(`Matrix progress ${Math.round(((index + 1) / pairs.length) * 100)}%`)
  }
  perf.simulateMs += performance.now() - started
  console.log(`Outliers (${outliers.length}):`)
  outliers.slice(0, 40).forEach((line) => console.log(`- ${line}`))
  if (outliers.length > 40) console.log(`... +${outliers.length - 40} more`)
}

async function runProfile(seedCount: number) {
  console.log(`\n=== Single-worker simulator profile (${seedCount.toLocaleString()} paired seeds) ===`)
  const report = profilePairedSimulation({
    left: ['HOMING_ROCKET', 'BANANA'],
    right: ['NITRO', 'DRAFT_FIN'],
    seedCount,
    playerCount,
    startIndex,
    bootstrapIterations: bootstrapArchetype,
  })
  console.log(formatProfileReport(report))
}

async function runWorkerBenchmark(seedCount: number) {
  perf.heapBeforeMb = process.memoryUsage().heapUsed / (1024 * 1024)
  console.log(`\n=== Worker benchmark (archetype · ${seedCount.toLocaleString()} seeds/pair · workers=${workerCount} · bootstrap=${bootstrapArchetype}) ===`)
  await runPureArchetypeAggregate(seedCount)
  const mem = process.memoryUsage()
  perf.heapAfterMb = mem.heapUsed / (1024 * 1024)
  perf.rssAfterMb = mem.rss / (1024 * 1024)
  printPerf()
  console.log(`\nBENCHMARK_JSON ${JSON.stringify({
    workers: workerCount,
    seedsPerPair: seedCount,
    pairedRaces: perf.races,
    wallSec: Number((perf.wallMs / 1000).toFixed(2)),
    simulateSec: Number((perf.simulateMs / 1000).toFixed(2)),
    pairedRacesPerSec: Number((perf.races / (perf.simulateMs / 1000 || 1)).toFixed(2)),
    heapBeforeMb: Number(perf.heapBeforeMb.toFixed(1)),
    heapAfterMb: Number(perf.heapAfterMb.toFixed(1)),
    rssAfterMb: Number(perf.rssAfterMb.toFixed(1)),
  })}`)
}

async function runSpotlights(seedCount: number) {
  const spotlights: Array<[FullLoadout, FullLoadout, string]> = [
    [['HOMING_ROCKET', 'QUACK_HORN'], ['NITRO', 'DRAFT_FIN'], 'Attack pure vs Speed pure'],
    [['HOMING_ROCKET', 'QUACK_HORN'], ['NITRO', 'FEATHER'], 'Attack pure vs Speed/Defense hybrid'],
    [['NITRO', 'FEATHER'], ['BUBBLE_SHIELD', 'FEATHER'], 'Speed hybrid vs Defense pure'],
  ]
  console.log(`\n=== Spotlight matchups (${seedCount.toLocaleString()} seeds) ===`)
  for (const [left, right, label] of spotlights) {
    console.log(`\n${label}`)
    printMatchupSummary(await runWorkerBatch(left, right, seedCount), bootstrapSpotlight, loadoutArchetype(left), loadoutArchetype(right))
  }
}

function printPerf() {
  perf.wallMs = performance.now() - perfStart
  const racesPerSec = perf.races / (perf.simulateMs / 1000 || 1)
  console.log(`\n=== Simulator performance ===`)
  console.log(`workers: ${workerCount} · paired races: ${perf.races.toLocaleString()} · wall ${(perf.wallMs / 1000).toFixed(1)}s · simulate ${(perf.simulateMs / 1000).toFixed(1)}s · ${racesPerSec.toFixed(1)} paired-races/s`)
  if (perf.heapAfterMb > 0) {
    console.log(`heap ${perf.heapBeforeMb.toFixed(1)}→${perf.heapAfterMb.toFixed(1)} MB · RSS ${perf.rssAfterMb.toFixed(1)} MB`)
  }
}

const perfStart = performance.now()

async function main() {
  perf.heapBeforeMb = process.memoryUsage().heapUsed / (1024 * 1024)
  if (mode === 'baseline') await runBaselineSymmetry(seeds)
  else if (mode === 'profile') await runProfile(Math.min(seeds, 100))
  else if (mode === 'benchmark') await runWorkerBenchmark(seeds)
  else if (mode === 'archetype') await runPureArchetypeAggregate(seeds)
  else if (mode === 'matrix') await runMatrixScreening(matrixSeeds)
  else if (mode === 'absolute') await runAbsoluteLoadouts(seeds)
  else if (mode === 'screen') {
    await runPureArchetypeAggregate(Math.min(seeds, 10_000))
    await runMatrixScreening(matrixSeeds)
    await runSpotlights(Math.min(seeds, 5_000))
  } else {
    await runBaselineSymmetry(Math.min(seeds, 5_000))
    await runAbsoluteLoadouts(Math.min(seeds, 2_000))
    await runPureArchetypeAggregate(seeds)
    await runSpotlights(Math.min(seeds, 5_000))
  }
  if (workerPool) await workerPool.close()
  const mem = process.memoryUsage()
  perf.heapAfterMb = mem.heapUsed / (1024 * 1024)
  perf.rssAfterMb = mem.rss / (1024 * 1024)
  if (mode !== 'profile' && mode !== 'benchmark') printPerf()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
