import { performance } from 'node:perf_hooks'
import { simulateRace, type SimulationPhaseProfile } from '../../packages/race-core/src'
import {
  createRaceConfig,
  runMatchupBatch,
  toInstrumentEvent,
  trackRaceEvent,
  createRaceEventTrackerContext,
  emptyRaceInstrumentation,
  type FullLoadout,
  type InstrumentEvent,
} from './balance-sim-core'
import { estimateLeftWinRate, seedBootstrapRate } from './balance-sim-stats'

export interface BalanceSimProfileReport {
  pairedSeeds: number
  baselineMs: number
  instrumentedMs: number
  instrumentationMs: number
  bootstrapMs: number
  aggregationMs: number
  otherMs: number
  phaseProfile: SimulationPhaseProfile
  pairedRacesPerSec: number
  heapBeforeMb: number
  heapAfterMb: number
  rssAfterMb: number
}

function emptyPhaseProfile(): SimulationPhaseProfile {
  return {
    autoUseExecuteMs: 0,
    itemSystemMs: 0,
    movementMs: 0,
    pickupMs: 0,
    autoUseDecideMs: 0,
    collisionMs: 0,
    rankingMs: 0,
    ticks: 0,
  }
}

export function profilePairedSimulation(options: {
  left: FullLoadout
  right: FullLoadout
  seedCount: number
  playerCount: number
  startIndex?: number
  bootstrapIterations?: number
}): BalanceSimProfileReport {
  const {
    left,
    right,
    seedCount,
    playerCount,
    startIndex = 1,
    bootstrapIterations = 1_000,
  } = options

  const phaseProfile = emptyPhaseProfile()
  const heapBeforeMb = process.memoryUsage().heapUsed / (1024 * 1024)
  let baselineMs = 0
  let instrumentedMs = 0
  let instrumentationMs = 0

  for (let offset = 0; offset < seedCount; offset += 1) {
    const seedIndex = startIndex + offset
    const baselineStart = performance.now()
    simulateRace(createRaceConfig(seedIndex, playerCount), { recordEvents: false })
    baselineMs += performance.now() - baselineStart

    const pendingEvents: InstrumentEvent[] = []
    const instrumentedStart = performance.now()
    simulateRace(createRaceConfig(seedIndex, playerCount), {
      recordEvents: false,
      phaseProfile,
      onEvent(event) {
        pendingEvents.push(toInstrumentEvent(event))
      },
    })
    instrumentedMs += performance.now() - instrumentedStart

    const instrumentationStart = performance.now()
    const instrumentation = emptyRaceInstrumentation()
    const baselineRank = new Map<string, number>()
    const finalRank = new Map<string, number>()
    const loadoutByPlayer = new Map<string, FullLoadout>()
    const focusPlayers = new Set<string>()
    const tracker = createRaceEventTrackerContext(loadoutByPlayer, baselineRank, finalRank, focusPlayers, instrumentation)
    for (const event of pendingEvents) trackRaceEvent(event, tracker)
    instrumentationMs += performance.now() - instrumentationStart
  }

  const bootstrapStart = performance.now()
  const aggregate = runMatchupBatch(left, right, startIndex, seedCount, playerCount, true)
  seedBootstrapRate(aggregate.seedOutcomes, bootstrapIterations)
  estimateLeftWinRate(aggregate.seedOutcomes)
  const bootstrapMs = performance.now() - bootstrapStart

  const aggregationStart = performance.now()
  runMatchupBatch(left, right, startIndex, Math.min(10, seedCount), playerCount, true)
  const aggregationMs = performance.now() - aggregationStart

  const wallMs = baselineMs + instrumentedMs + instrumentationMs + bootstrapMs + aggregationMs
  const otherMs = Math.max(0, wallMs - baselineMs - instrumentedMs - instrumentationMs - bootstrapMs - aggregationMs)
  const pairedRaces = seedCount * 2
  const mem = process.memoryUsage()

  return {
    pairedSeeds: seedCount,
    baselineMs,
    instrumentedMs,
    instrumentationMs,
    bootstrapMs,
    aggregationMs,
    otherMs,
    phaseProfile,
    pairedRacesPerSec: pairedRaces / (wallMs / 1000 || 1),
    heapBeforeMb,
    heapAfterMb: mem.heapUsed / (1024 * 1024),
    rssAfterMb: mem.rss / (1024 * 1024),
  }
}

export function formatProfileReport(report: BalanceSimProfileReport) {
  const total = report.baselineMs + report.instrumentedMs + report.instrumentationMs + report.bootstrapMs + report.aggregationMs + report.otherMs
  const pct = (value: number) => `${((value / total) * 100).toFixed(0)}%`
  const sec = (value: number) => `${(value / 1000).toFixed(1)}s`
  const phaseTotal = report.phaseProfile.autoUseExecuteMs
    + report.phaseProfile.itemSystemMs
    + report.phaseProfile.movementMs
    + report.phaseProfile.pickupMs
    + report.phaseProfile.autoUseDecideMs
    + report.phaseProfile.collisionMs
    + report.phaseProfile.rankingMs

  const phasePct = (value: number) => (phaseTotal > 0 ? `${((value / phaseTotal) * 100).toFixed(0)}%` : '0%')

  return [
    `PERF — ${report.pairedSeeds.toLocaleString()} paired seeds`,
    '',
    `baseline sim       ${pct(report.baselineMs)} (${sec(report.baselineMs)})`,
    `instrumented sim   ${pct(report.instrumentedMs)} (${sec(report.instrumentedMs)})`,
    `instrumentation    ${pct(report.instrumentationMs)} (${sec(report.instrumentationMs)})`,
    '',
    `  auto-use exec     ${phasePct(report.phaseProfile.autoUseExecuteMs)} (${sec(report.phaseProfile.autoUseExecuteMs)})`,
    `  item engine       ${phasePct(report.phaseProfile.itemSystemMs)} (${sec(report.phaseProfile.itemSystemMs)})`,
    `  movement          ${phasePct(report.phaseProfile.movementMs)} (${sec(report.phaseProfile.movementMs)})`,
    `  pickup            ${phasePct(report.phaseProfile.pickupMs)} (${sec(report.phaseProfile.pickupMs)})`,
    `  auto-use decide   ${phasePct(report.phaseProfile.autoUseDecideMs)} (${sec(report.phaseProfile.autoUseDecideMs)})`,
    `  collision         ${phasePct(report.phaseProfile.collisionMs)} (${sec(report.phaseProfile.collisionMs)})`,
    `  ranking           ${phasePct(report.phaseProfile.rankingMs)} (${sec(report.phaseProfile.rankingMs)})`,
    `  ticks/profiled    ${report.phaseProfile.ticks.toLocaleString()}`,
    '',
    `bootstrap           ${pct(report.bootstrapMs)} (${sec(report.bootstrapMs)})`,
    `aggregation         ${pct(report.aggregationMs)} (${sec(report.aggregationMs)})`,
    `other               ${pct(report.otherMs)} (${sec(report.otherMs)})`,
    '',
    `heap ${report.heapBeforeMb.toFixed(1)}→${report.heapAfterMb.toFixed(1)} MB · RSS ${report.rssAfterMb.toFixed(1)} MB`,
    `paired races/sec: ${report.pairedRacesPerSec.toFixed(1)}`,
  ].join('\n')
}
