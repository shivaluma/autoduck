import { itemActivationForEvent, itemSuccessForEvent, simulateRace } from '@/packages/race-core/src'
import type { RaceConfig, RaceFinishEntry, RaceItemId, RaceResult } from '@/packages/race-protocol/src'

export interface RaceItemTelemetryRow {
  raceId: number
  playerId: string
  itemId: RaceItemId
  loadoutKey: string
  finalRank: number
  baselineRank: number
  rankDelta: number
  won: boolean
  topThree: boolean
  bottomTwo: boolean
  activated: boolean
  succeeded: boolean
}

export function buildRaceItemTelemetry(raceId: number, config: RaceConfig, officialResult: RaceResult): RaceItemTelemetryRow[] {
  const ghostPlayerIds = new Set(config.players.filter((player) => player.isGhost).map((player) => player.playerId))
  const baseline = simulateRace({ ...config, raceId: `${config.raceId}-counterfactual`, loadouts: [] }, { recordEvents: false })
  const baselineRank = new Map<string, number>(baseline.standings.map((entry: RaceFinishEntry) => [entry.playerId, entry.rank]))
  const officialRank = new Map<string, number>(officialResult.standings.map((entry: RaceFinishEntry) => [entry.playerId, entry.rank]))
  const activated = new Set<string>()
  const succeeded = new Set<string>()
  for (const event of officialResult.events) {
    const activation = itemActivationForEvent(event)
    if (activation) activated.add(`${activation.playerId}:${activation.itemId}`)
    const success = itemSuccessForEvent(event)
    if (success) succeeded.add(`${success.playerId}:${success.itemId}`)
  }

  return config.loadouts.flatMap((loadout) => {
    if (ghostPlayerIds.has(loadout.playerId)) return []
    const finalRank = officialRank.get(loadout.playerId)
    const withoutItemsRank = baselineRank.get(loadout.playerId)
    if (typeof finalRank !== 'number' || typeof withoutItemsRank !== 'number') throw new Error(`Missing telemetry rank for ${loadout.playerId}`)
    const loadoutKey = loadout.itemIds.join(' + ')
    return loadout.itemIds.map((itemId) => ({
      raceId,
      playerId: loadout.playerId,
      itemId,
      loadoutKey,
      finalRank,
      baselineRank: withoutItemsRank,
      rankDelta: withoutItemsRank - finalRank,
      won: finalRank === 1,
      topThree: finalRank <= 3,
      bottomTwo: finalRank > officialResult.standings.length - 2,
      activated: activated.has(`${loadout.playerId}:${itemId}`),
      succeeded: succeeded.has(`${loadout.playerId}:${itemId}`),
    }))
  })
}

export async function persistRaceItemTelemetry(
  prisma: {
    raceItemTelemetry: {
      deleteMany(args: unknown): Promise<unknown>
      createMany(args: unknown): Promise<unknown>
    }
  },
  rows: RaceItemTelemetryRow[],
) {
  if (rows.length === 0) return
  await prisma.raceItemTelemetry.deleteMany({ where: { raceId: rows[0].raceId } })
  await prisma.raceItemTelemetry.createMany({ data: rows })
}
