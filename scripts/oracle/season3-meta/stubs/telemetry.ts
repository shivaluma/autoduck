import { harness } from './harness'

export function buildRaceItemTelemetry(raceId: number) {
  return { raceId }
}

export async function persistRaceItemTelemetry(_prisma: unknown, rows: unknown) {
  harness().record('persistRaceItemTelemetry', rows)
}
