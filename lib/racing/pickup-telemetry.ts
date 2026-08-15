import { simulateRace } from '@/packages/race-core/src'
import type { RaceConfig, RaceEvent, RaceResult, RaceFinishEntry, WildItemId } from '@/packages/race-protocol/src'

export interface RacePickupTelemetryRow {
  raceId: number
  playerId: string
  instanceId: string
  itemId: WildItemId
  collectionRank: number
  finalRank: number
  baselineRank: number
  rankDelta: number
  activated: boolean
  succeeded: boolean
  manualUsed: boolean
  autoUsed: boolean
  hitCount: number
}

function itemSuccess(itemId: WildItemId, playerId: string, events: RaceEvent[]) {
  if (itemId === 'MINI_ROCKET') return events.filter((event) => event.type === 'MINI_ROCKET_HIT' && event.sourcePlayerId === playerId).length
  if (itemId === 'BANANA') return events.filter((event) => event.type === 'WILD_BANANA_HIT' && event.sourcePlayerId === playerId).length
  if (itemId === 'MINI_BUBBLE') return events.filter((event) => event.type === 'MINI_BUBBLE_BLOCKED' && event.sourcePlayerId === playerId).length
  if (itemId === 'FEATHER') return events.filter((event) => event.type === 'WILD_FEATHER_DODGED' && event.sourcePlayerId === playerId).length
  if (itemId === 'QUACK_HORN') return events.filter((event) => event.type === 'WILD_HORN_USED' && event.sourcePlayerId === playerId).length
  return 1
}

export function buildRacePickupTelemetry(raceId: number, config: RaceConfig, officialResult: RaceResult): RacePickupTelemetryRow[] {
  const baseline = simulateRace({
    ...config,
    raceId: `${config.raceId}-pickups-off`,
    pickupConfig: {
      enabled: false,
      goldenBoxEnabled: false,
      goldenBoxProbability: config.pickupConfig?.goldenBoxProbability ?? 0.12,
      hazardsEnabled: false,
      positionAwareLoot: config.pickupConfig?.positionAwareLoot ?? true,
      spawnMultiplier: 0,
      regularPickupCap: config.pickupConfig?.regularPickupCap ?? 3,
      manualItemsEnabled: config.pickupConfig?.manualItemsEnabled ?? true,
      autoItemsEnabled: config.pickupConfig?.autoItemsEnabled ?? true,
      chaosBoxEnabled: false,
      forceGoldenBox: false,
      disabledItems: config.pickupConfig?.disabledItems ?? [],
      idealManualPlayerIds: [],
      forceItem: config.pickupConfig?.forceItem,
    },
  }, { recordEvents: false })
  const baselineRank = new Map<string, number>(baseline.standings.map((entry: RaceFinishEntry) => [entry.playerId, entry.rank]))
  const finalRank = new Map<string, number>(officialResult.standings.map((entry: RaceFinishEntry) => [entry.playerId, entry.rank]))
  const ghostPlayerIds = new Set(config.players.filter((player) => player.isGhost).map((player) => player.playerId))
  const acquisition = officialResult.events.filter((event) => event.type === 'WILD_ITEM_GRANTED' || event.type === 'INSTANT_PICKUP_TRIGGERED')
  return acquisition.flatMap((event) => {
    const playerId = event.sourcePlayerId
    if (!playerId || ghostPlayerIds.has(playerId)) return []
    const instanceId = event.metadata.instanceId
    const itemId = event.metadata.itemId as WildItemId | undefined
    if (!playerId || typeof instanceId !== 'string' || !itemId) return []
    const manualUsed = officialResult.events.some((candidate) => candidate.type === 'WILD_ITEM_USED' && candidate.sourcePlayerId === playerId && candidate.metadata.instanceId === instanceId)
    const autoUsed = officialResult.events.some((candidate) => candidate.type === 'WILD_ITEM_AUTO_USED' && candidate.sourcePlayerId === playerId && candidate.metadata.instanceId === instanceId)
    const instant = event.type === 'INSTANT_PICKUP_TRIGGERED'
    const hits = itemSuccess(itemId, playerId, officialResult.events)
    const final = finalRank.get(playerId)
    const withoutPickups = baselineRank.get(playerId)
    if (final === undefined || withoutPickups === undefined) return []
    return [{
      raceId,
      playerId,
      instanceId,
      itemId,
      collectionRank: Number(event.metadata.rank ?? 0),
      finalRank: final,
      baselineRank: withoutPickups,
      rankDelta: withoutPickups - final,
      activated: instant || manualUsed || autoUsed,
      succeeded: hits > 0,
      manualUsed,
      autoUsed,
      hitCount: hits,
    }]
  })
}

export async function persistRacePickupTelemetry(prisma: { racePickupTelemetry: { deleteMany(args: unknown): Promise<unknown>; createMany(args: unknown): Promise<unknown> } }, rows: RacePickupTelemetryRow[]) {
  if (rows.length === 0) return
  await prisma.racePickupTelemetry.deleteMany({ where: { raceId: rows[0]!.raceId } })
  await prisma.racePickupTelemetry.createMany({ data: rows })
}
