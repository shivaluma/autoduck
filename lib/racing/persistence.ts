import type { RaceConfig, RaceEvent, RaceResult } from '@/packages/race-protocol/src'
import { raceConfigSchema, raceEventSchema } from '@/packages/race-protocol/src'
import { createResultDigest } from './audit'

export function serializeRaceConfig(config: RaceConfig) {
  return JSON.stringify(config)
}

export function parseRaceConfig(value: string) {
  return raceConfigSchema.parse(JSON.parse(value))
}

export async function persistRaceEvents(
  prisma: { raceEngineEvent: { createMany(args: unknown): Promise<unknown> } },
  raceId: number,
  events: RaceEvent[],
) {
  if (events.length === 0) return
  const validatedEvents = raceEventSchema.array().parse(events)
  await prisma.raceEngineEvent.createMany({
    data: validatedEvents.map((raceEvent) => ({
      raceId,
      type: raceEvent.type,
      tick: raceEvent.tick,
      timestampWithinRaceMs: raceEvent.timestampWithinRaceMs,
      sourcePlayerId: raceEvent.sourcePlayerId ?? null,
      targetPlayerId: raceEvent.targetPlayerId ?? null,
      metadataJson: JSON.stringify(raceEvent.metadata),
    })),
  })
}

export function persistedRaceResult(result: RaceResult) {
  return {
    resultDigest: createResultDigest(result),
    engineVersion: result.engineVersion,
    balanceVersion: result.balanceVersion,
    trackVersion: result.trackVersion,
  }
}
