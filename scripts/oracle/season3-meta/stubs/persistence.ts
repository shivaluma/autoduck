import { harness } from './harness'

export function parseRaceConfig(json: string) {
  return harness().parseRaceConfig(json)
}

export function serializeRaceConfig(config: unknown) {
  return JSON.stringify(config)
}

export async function persistRaceEvents(_prisma: unknown, raceId: number, events: Array<{ type: string }>) {
  harness().record('persistRaceEvents', events.length === 1 && events[0]!.type === 'CHAOS_RESOLVED' ? { raceId, events } : { raceId, count: events.length })
}

export function persistedRaceResult() {
  return { resultDigest: '<persisted>' }
}
