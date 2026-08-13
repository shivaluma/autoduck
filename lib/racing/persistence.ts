import type { RaceConfig, RaceEvent, RaceResult, RecordedWildItemInput } from '@/packages/race-protocol/src'
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

export function recordedWildInputsFromEvents(events: RaceEvent[]): RecordedWildItemInput[] {
  return events.filter((raceEvent) => raceEvent.type === 'WILD_ITEM_MANUAL_INPUT')
    .flatMap((raceEvent) => {
      const instanceId = raceEvent.metadata.instanceId
      const clientActionId = raceEvent.metadata.clientActionId
      if (!raceEvent.sourcePlayerId || typeof instanceId !== 'string' || typeof clientActionId !== 'string') return []
      return [{
        raceId: raceEvent.raceId,
        playerId: raceEvent.sourcePlayerId,
        wildItemInstanceId: instanceId,
        action: 'USE' as const,
        clientActionId,
        authoritativeTick: raceEvent.tick,
      }]
    })
    .sort((left, right) => left.authoritativeTick - right.authoritativeTick || left.clientActionId.localeCompare(right.clientActionId))
}
