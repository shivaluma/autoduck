/* eslint-disable @typescript-eslint/no-explicit-any */
import { getDragonOrbName, isDragonStar } from './naming'
import { isThomasUser, isUnlockedDragonOrb, withDragonTransaction } from './utils'

export async function createDragonTradeOffer(
  prisma: any,
  proposerId: number,
  offeredOrbId: number,
  requestedStar: number,
  counterpartyId?: number | null,
  message?: string | null
) {
  return withDragonTransaction(prisma, async (tx) => {
    if (!isDragonStar(requestedStar)) {
      return { created: false, reason: 'INVALID_STAR' }
    }

    const proposer = await tx.user.findUnique({ where: { id: proposerId } })
    if (!proposer) {
      return { created: false, reason: 'PROPOSER_NOT_FOUND' }
    }
    if (isThomasUser(proposer)) {
      return { created: false, reason: 'THOMAS_BLOCKED' }
    }

    if (typeof counterpartyId === 'number') {
      const counterparty = await tx.user.findUnique({ where: { id: counterpartyId } })
      if (!counterparty) {
        return { created: false, reason: 'COUNTERPARTY_NOT_FOUND' }
      }
      if (isThomasUser(counterparty)) {
        return { created: false, reason: 'THOMAS_BLOCKED' }
      }
    }

    const offeredOrb = await tx.dragonOrb.findFirst({ where: { id: offeredOrbId } })
    if (!offeredOrb) {
      return { created: false, reason: 'ORB_NOT_FOUND' }
    }
    if (offeredOrb.currentOwnerId !== proposerId) {
      return { created: false, reason: 'NOT_OWNER' }
    }
    if (!isUnlockedDragonOrb(offeredOrb)) {
      return { created: false, reason: 'ORB_NOT_ACTIVE_OR_LOCKED' }
    }

    const trade = await tx.dragonTrade.create({
      data: {
        proposerId,
        counterpartyId: counterpartyId ?? null,
        offeredOrbId,
        requestedStar,
        status: 'PENDING',
        message: message?.trim() || null,
      },
    })

    await tx.dragonOrb.update({
      where: { id: offeredOrbId },
      data: { lockedByTradeId: trade.id },
    })

    await tx.dragonOrbEvent.create({
      data: {
        orbId: offeredOrbId,
        userId: proposerId,
        tradeId: trade.id,
        type: 'TRADE_CREATED',
        message: `${proposer.name} treo ${getDragonOrbName(offeredOrb.star)} đổi ${getDragonOrbName(requestedStar)}.`,
      },
    })

    return {
      created: true,
      trade: {
        id: trade.id,
        offeredOrbId,
        offeredStar: offeredOrb.star,
        requestedStar,
        status: 'PENDING' as const,
      },
    }
  })
}

export async function cancelDragonTradeOffer(
  prisma: any,
  tradeId: number,
  actorUserId: number,
  options: { isAdmin?: boolean } = {}
) {
  return withDragonTransaction(prisma, async (tx) => {
    const trade = await tx.dragonTrade.findUnique({ where: { id: tradeId } })
    if (!trade) {
      return { cancelled: false, reason: 'TRADE_NOT_FOUND' }
    }
    if (trade.status !== 'PENDING') {
      return { cancelled: false, reason: 'TRADE_NOT_PENDING' }
    }
    if (!options.isAdmin && trade.proposerId !== actorUserId) {
      return { cancelled: false, reason: 'NOT_ALLOWED' }
    }

    await tx.dragonOrb.update({
      where: { id: trade.offeredOrbId },
      data: { lockedByTradeId: null },
    })
    await tx.dragonTrade.update({
      where: { id: tradeId },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    })
    await tx.dragonOrbEvent.create({
      data: {
        orbId: trade.offeredOrbId,
        userId: actorUserId,
        tradeId,
        type: 'TRADE_CANCELLED',
        message: 'Kèo Đổi Châu đã hủy.',
      },
    })

    return { cancelled: true, tradeId }
  })
}

export async function acceptDragonTradeOffer(
  prisma: any,
  tradeId: number,
  accepterId: number,
  acceptedOrbId: number
) {
  return withDragonTransaction(prisma, async (tx) => {
    const trade = await tx.dragonTrade.findUnique({ where: { id: tradeId } })
    if (!trade) {
      return { accepted: false, reason: 'TRADE_NOT_FOUND' }
    }
    if (trade.status !== 'PENDING') {
      return { accepted: false, reason: 'TRADE_NOT_PENDING' }
    }
    if (trade.expiresAt && trade.expiresAt.getTime() < Date.now()) {
      await tx.dragonOrb.update({ where: { id: trade.offeredOrbId }, data: { lockedByTradeId: null } })
      await tx.dragonTrade.update({ where: { id: tradeId }, data: { status: 'EXPIRED' } })
      return { accepted: false, reason: 'TRADE_EXPIRED' }
    }
    if (typeof trade.counterpartyId === 'number' && trade.counterpartyId !== accepterId) {
      return { accepted: false, reason: 'WRONG_COUNTERPARTY' }
    }

    const [proposer, accepter, offeredOrb, acceptedOrb] = await Promise.all([
      tx.user.findUnique({ where: { id: trade.proposerId } }),
      tx.user.findUnique({ where: { id: accepterId } }),
      tx.dragonOrb.findFirst({ where: { id: trade.offeredOrbId } }),
      tx.dragonOrb.findFirst({ where: { id: acceptedOrbId } }),
    ])

    if (!proposer || !accepter) {
      return { accepted: false, reason: 'USER_NOT_FOUND' }
    }
    if (isThomasUser(proposer) || isThomasUser(accepter)) {
      return { accepted: false, reason: 'THOMAS_BLOCKED' }
    }
    if (!offeredOrb || !acceptedOrb) {
      return { accepted: false, reason: 'ORB_NOT_FOUND' }
    }
    if (offeredOrb.currentOwnerId !== trade.proposerId || offeredOrb.lockedByTradeId !== trade.id || offeredOrb.status !== 'ACTIVE') {
      return { accepted: false, reason: 'OFFERED_ORB_CHANGED' }
    }
    if (acceptedOrb.currentOwnerId !== accepterId || !isUnlockedDragonOrb(acceptedOrb)) {
      return { accepted: false, reason: 'ACCEPTED_ORB_NOT_AVAILABLE' }
    }
    if (acceptedOrb.star !== trade.requestedStar) {
      return { accepted: false, reason: 'WRONG_STAR' }
    }

    await tx.dragonOrb.update({
      where: { id: offeredOrb.id },
      data: {
        currentOwnerId: accepterId,
        lockedByTradeId: null,
      },
    })
    await tx.dragonOrb.update({
      where: { id: acceptedOrb.id },
      data: {
        currentOwnerId: trade.proposerId,
        lockedByTradeId: null,
      },
    })
    await tx.dragonTrade.update({
      where: { id: tradeId },
      data: {
        status: 'ACCEPTED',
        acceptedById: accepterId,
        acceptedOrbId,
        acceptedAt: new Date(),
      },
    })

    await tx.dragonOrbEvent.create({
      data: {
        orbId: offeredOrb.id,
        userId: accepterId,
        tradeId,
        type: 'TRADE_ACCEPTED',
        message: `${accepter.name} nhận ${getDragonOrbName(offeredOrb.star)}.`,
      },
    })
    await tx.dragonOrbEvent.create({
      data: {
        orbId: acceptedOrb.id,
        userId: trade.proposerId,
        tradeId,
        type: 'TRADE_ACCEPTED',
        message: `${proposer.name} nhận ${getDragonOrbName(acceptedOrb.star)}.`,
      },
    })

    return {
      accepted: true,
      tradeId,
      proposerId: trade.proposerId,
      accepterId,
      proposerReceivedOrbId: acceptedOrb.id,
      accepterReceivedOrbId: offeredOrb.id,
    }
  })
}

export async function expireDragonTradeOffers(prisma: any, now = new Date()) {
  const pendingTrades = await prisma.dragonTrade.findMany?.({
    where: {
      status: 'PENDING',
      expiresAt: { lt: now },
    },
  }) ?? []

  const expired = []
  for (const trade of pendingTrades) {
    const result = await withDragonTransaction(prisma, async (tx) => {
      const current = await tx.dragonTrade.findUnique({ where: { id: trade.id } })
      if (!current || current.status !== 'PENDING') {
        return null
      }
      await tx.dragonOrb.update({
        where: { id: current.offeredOrbId },
        data: { lockedByTradeId: null },
      })
      await tx.dragonTrade.update({
        where: { id: current.id },
        data: { status: 'EXPIRED' },
      })
      await tx.dragonOrbEvent.create({
        data: {
          orbId: current.offeredOrbId,
          userId: current.proposerId,
          tradeId: current.id,
          type: 'TRADE_EXPIRED',
          message: 'Kèo Đổi Châu đã hết hạn.',
        },
      })
      return current.id
    })
    if (result) expired.push(result)
  }

  return { expiredTradeIds: expired }
}
