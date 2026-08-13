import { prisma } from '../lib/db'
import { replayRace } from '../lib/racing/replay'
import { parseRaceConfig, recordedWildInputsFromEvents } from '../lib/racing/persistence'

const raceId = Number(process.argv[2])
if (!Number.isInteger(raceId) || raceId < 1) {
  throw new Error('Usage: pnpm race:replay <raceId>')
}

try {
  const race = await prisma.race.findUnique({
    where: { id: raceId },
    select: {
      id: true,
      status: true,
      engineConfigJson: true,
      engineEvents: { orderBy: [{ tick: 'asc' as const }, { id: 'asc' as const }] },
      resultDigest: true,
      seedCommit: true,
      engineVersion: true,
      balanceVersion: true,
      trackVersion: true,
    },
  })
  if (!race) throw new Error(`Race #${raceId} not found`)
  if (!race.engineConfigJson) throw new Error(`Race #${raceId} has no deterministic engine config`)

  const config = parseRaceConfig(race.engineConfigJson)
  const events = race.engineEvents.map((event: { type: string; tick: number; timestampWithinRaceMs: number; sourcePlayerId: string | null; targetPlayerId: string | null; metadataJson: string }) => ({
    raceId: String(race.id), type: event.type as import('../packages/race-protocol/src').RaceEvent['type'], tick: event.tick,
    timestampWithinRaceMs: event.timestampWithinRaceMs, sourcePlayerId: event.sourcePlayerId ?? undefined,
    targetPlayerId: event.targetPlayerId ?? undefined, metadata: JSON.parse(event.metadataJson),
  }))
  const replay = replayRace(config, race.resultDigest ?? undefined, recordedWildInputsFromEvents(events))
  console.log(`Race #${race.id} replay verified`)
  console.table({
    status: race.status,
    engine: race.engineVersion,
    balance: race.balanceVersion,
    track: race.trackVersion,
    seedCommit: race.seedCommit,
    resultDigest: replay.digest,
    durationMs: replay.result.durationMs.toFixed(2),
    eventCount: replay.result.events.length,
  })
  console.table(replay.result.standings.map((entry) => ({
    rank: entry.rank,
    duck: entry.name,
    playerId: entry.playerId,
    finishMs: entry.finishTimeMs.toFixed(2),
  })))
} finally {
  await prisma.$disconnect()
}
