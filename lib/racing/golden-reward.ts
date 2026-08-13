export const GOLDEN_TRACK_QP_REWARD = 1

export function buildGoldenTrackReward(input: {
  official: boolean
  raceId: number
  pickupId: string
  seasonPlayerId: number
  weekId: number
  weekNumber: number
}) {
  if (!input.official) return null
  return {
    seasonPlayerId: input.seasonPlayerId,
    amount: GOLDEN_TRACK_QP_REWARD,
    reason: 'TRACK_GOLDEN_BOX',
    raceId: input.raceId,
    idempotencyKey: `race:${input.raceId}:golden-box:${input.pickupId}`,
    metadata: {
      weekId: input.weekId,
      weekNumber: input.weekNumber,
      pickupId: input.pickupId,
    },
  }
}
