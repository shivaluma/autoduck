import { harness } from './harness'

export function startLiveRaceSession() {
  return {
    publishSnapshot() {},
    drainPendingWildActions: () => [],
    markQueued() {},
    resolveFromEvent() {},
    finalizeUnresolved() {},
    getAllWildActions: () => [],
  }
}

export function stopLiveRaceSession() {}

export async function persistLiveRaceWildActions(_prisma: unknown, raceId: number) {
  harness().record('persistLiveRaceWildActions', { raceId })
}
