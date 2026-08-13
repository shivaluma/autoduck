import type { Prisma } from '../../prisma/generated/prisma/client'

export const QUACK_ECONOMY = {
  raceWin: 5,
  predictionTwoLosers: 2,
  predictionManyLosers: 1,
  perfectWeek: 1,
  perfectWeekEnabled: true,
} as const

export type QuackReward = {
  playerId: number
  amount: number
  reason: 'RACE_WIN' | 'PREDICTION_WIN' | 'PERFECT_WEEK'
}

export function calculateOfficialRaceQuackRewards(input: {
  winnerUserId: number
  finalLoserUserIds: number[]
  predictions: Array<{ predictorUserId: number; targetUserId: number }>
  perfectWeekEnabled?: boolean
}): QuackReward[] {
  const loserIds = new Set(input.finalLoserUserIds)
  const predictionAmount = loserIds.size === 2
    ? QUACK_ECONOMY.predictionTwoLosers
    : QUACK_ECONOMY.predictionManyLosers
  const rewards: QuackReward[] = [{ playerId: input.winnerUserId, amount: QUACK_ECONOMY.raceWin, reason: 'RACE_WIN' }]

  for (const prediction of input.predictions) {
    if (!loserIds.has(prediction.targetUserId)) continue
    rewards.push({ playerId: prediction.predictorUserId, amount: predictionAmount, reason: 'PREDICTION_WIN' })
    if (prediction.predictorUserId === input.winnerUserId && (input.perfectWeekEnabled ?? QUACK_ECONOMY.perfectWeekEnabled)) {
      rewards.push({ playerId: prediction.predictorUserId, amount: QUACK_ECONOMY.perfectWeek, reason: 'PERFECT_WEEK' })
    }
  }

  return rewards
}

export async function applyQuackTransaction(tx: Prisma.TransactionClient, input: {
  seasonPlayerId: number
  amount: number
  reason: string
  idempotencyKey: string
  raceId?: number
  cosmeticId?: string
  gachaPullId?: string
  metadata?: Record<string, unknown>
}) {
  if (!Number.isInteger(input.amount) || input.amount === 0) throw new Error('QP amount must be a non-zero integer')
  const existing = await tx.currencyTransaction.findUnique({ where: { idempotencyKey: input.idempotencyKey } })
  if (existing) return existing

  const player = input.amount > 0
    ? await tx.seasonPlayer.update({ where: { id: input.seasonPlayerId }, data: { quackPoints: { increment: input.amount } }, select: { quackPoints: true } })
    : await tx.seasonPlayer.update({ where: { id: input.seasonPlayerId, quackPoints: { gte: -input.amount } }, data: { quackPoints: { increment: input.amount } }, select: { quackPoints: true } })

  return tx.currencyTransaction.create({
    data: {
      seasonPlayerId: input.seasonPlayerId,
      amount: input.amount,
      reason: input.reason,
      raceId: input.raceId,
      cosmeticId: input.cosmeticId,
      gachaPullId: input.gachaPullId,
      idempotencyKey: input.idempotencyKey,
      balanceAfter: player.quackPoints,
      metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
    },
  })
}
