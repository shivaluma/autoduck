import { harness } from './harness'

export function buildRacePickupTelemetry(raceId: number) {
  return { raceId }
}

export async function persistRacePickupTelemetry(_prisma: unknown, rows: unknown) {
  harness().record('persistRacePickupTelemetry', rows)
}
