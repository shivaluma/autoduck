/* eslint-disable @typescript-eslint/no-explicit-any */
import { isImmortalDuck } from './immortal-duck'
import { DRAGON_STARS, getDragonOrbName } from './dragon/naming'
import { getDragonState } from './dragon/getDragonState'

function percent(part: number, total: number) {
  if (total <= 0) return 0
  return Math.round((part / total) * 1000) / 10
}

function ownerIdForParticipant(participant: { userId: number; cloneOfUserId?: number | null }) {
  return participant.cloneOfUserId ?? participant.userId
}

type MemberAccumulator = {
  user: any
  racesEntered: number
  wins: number
  dzitCount: number
  bestFinishSum: number
  bestFinishCount: number
}

function buildSuggestion(args: {
  missingStars: number[]
  duplicateCount: number
  progress: number
  summonReady: boolean
  claimBlocked: boolean
  activeScale: boolean
  winRate: number
  dzitRate: number
  currentWeekOrbName?: string
}) {
  if (args.summonReady && args.claimBlocked) {
    return 'Thất Tinh đã đủ. Long Lân cũ còn hộ mệnh, cứ giữ bộ châu trong các.'
  }

  if (args.summonReady) {
    return 'Cổng rồng đã mở. Khai Môn Triệu Long được rồi.'
  }

  if (args.duplicateCount > 0 && args.missingStars.length > 0) {
    return `Có châu dư để treo kèo. Ưu tiên gọi ${args.missingStars.slice(0, 2).map(getDragonOrbName).join(', ')}.`
  }

  if (args.progress === 0) {
    return args.currentWeekOrbName
      ? `Bắt đầu từ thiên tượng tuần này: săn ${args.currentWeekOrbName}.`
      : 'Chưa có châu. Cứ thắng một trận rồi tính chuyện gọi rồng.'
  }

  if (args.missingStars.length <= 2) {
    return `Gần đủ bộ. Còn săn ${args.missingStars.map(getDragonOrbName).join(', ')}.`
  }

  if (args.activeScale) {
    return 'Long Lân đang trong tay. Đường đua bớt lạnh gáy một chút.'
  }

  if (args.dzitRate >= 45) {
    return 'Duyên làm dzịt hơi đậm. Nên để mắt tới khiên và Long Lân.'
  }

  if (args.winRate >= 30) {
    return 'Phong độ ổn. Tập trung săn đúng viên còn thiếu.'
  }

  return 'Săn đều, đổi khéo. La Bàn rồi sẽ thương.'
}

export async function getMemberStats(prisma: any) {
  const [users, officialRaces, dragon] = await Promise.all([
    prisma.user.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        avatarUrl: true,
        shields: true,
        scars: true,
        totalKhaos: true,
        cleanStreak: true,
      },
    }),
    prisma.race.findMany({
      where: {
        status: 'finished',
        isTest: false,
      },
      orderBy: [{ finishedAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        participants: {
          select: {
            userId: true,
            initialRank: true,
            gotScar: true,
            cloneOfUserId: true,
          },
        },
      },
    }),
    getDragonState(prisma),
  ])

  const realUsers = users.filter((user: { name: string; shields: number }) => !isImmortalDuck(user))
  const statsByUserId = new Map<number, MemberAccumulator>(
    realUsers.map((user: any) => [
      user.id,
      {
        user,
        racesEntered: 0,
        wins: 0,
        dzitCount: 0,
        bestFinishSum: 0,
        bestFinishCount: 0,
      },
    ])
  )

  for (const race of officialRaces) {
    const raceOwners = new Map<number, { gotScar: boolean; bestRank: number | null }>()

    for (const participant of race.participants) {
      const ownerId = ownerIdForParticipant(participant)
      if (!statsByUserId.has(ownerId)) continue
      const current = raceOwners.get(ownerId) ?? { gotScar: false, bestRank: null }
      const rank = typeof participant.initialRank === 'number' ? participant.initialRank : null
      raceOwners.set(ownerId, {
        gotScar: current.gotScar || participant.gotScar,
        bestRank: rank === null ? current.bestRank : current.bestRank === null ? rank : Math.min(current.bestRank, rank),
      })
    }

    for (const [ownerId, ownerRace] of raceOwners) {
      const stat = statsByUserId.get(ownerId)
      if (!stat) continue
      stat.racesEntered += 1
      if (ownerRace.gotScar) stat.dzitCount += 1
      if (typeof ownerRace.bestRank === 'number') {
        stat.bestFinishSum += ownerRace.bestRank
        stat.bestFinishCount += 1
      }
    }

    const visualWinner = [...race.participants]
      .filter((participant) => typeof participant.initialRank === 'number')
      .sort((left, right) => (left.initialRank ?? 9999) - (right.initialRank ?? 9999))
      .find((participant) => statsByUserId.has(ownerIdForParticipant(participant)))

    if (visualWinner) {
      const stat = statsByUserId.get(ownerIdForParticipant(visualWinner))
      if (stat) stat.wins += 1
    }
  }

  const dragonByUserId = new Map((dragon.users ?? []).map((user: any) => [user.id, user]))
  const members = [...statsByUserId.values()].map((stat) => {
    const dragonUser = dragonByUserId.get(stat.user.id)
    const inventory = dragonUser?.inventory ?? null
    const starCounts = Object.fromEntries(DRAGON_STARS.map((star) => [
      star,
      inventory?.stars?.[String(star)]?.count ?? 0,
    ]))
    const orbTotal = Object.values(starCounts).reduce((sum: number, count) => sum + Number(count), 0)
    const duplicateCount = Object.values(starCounts).reduce((sum: number, count) => sum + Math.max(0, Number(count) - 1), 0)
    const missingStars = inventory?.missingStars ?? [...DRAGON_STARS]
    const progress = inventory?.progress ?? 0
    const winRate = percent(stat.wins, stat.racesEntered)
    const dzitRate = percent(stat.dzitCount, stat.racesEntered)
    const activeScale = Boolean(inventory?.activeScaleItem || inventory?.equippedScaleItem)

    return {
      id: stat.user.id,
      name: stat.user.name,
      avatarUrl: stat.user.avatarUrl,
      racesEntered: stat.racesEntered,
      wins: stat.wins,
      dzitCount: stat.dzitCount,
      winRate,
      dzitRate,
      averageBestRank: stat.bestFinishCount > 0 ? Math.round((stat.bestFinishSum / stat.bestFinishCount) * 10) / 10 : null,
      scars: stat.user.scars,
      totalKhaos: stat.user.totalKhaos,
      cleanStreak: stat.user.cleanStreak,
      orbTotal,
      duplicateCount,
      progress,
      missingStars,
      missingOrbNames: missingStars.map(getDragonOrbName),
      starCounts,
      summonReady: Boolean(inventory?.summonReady),
      claimBlocked: Boolean(inventory?.claimBlocked),
      activeScale,
      scaleState: inventory?.equippedScaleItem ? 'Long Lân nhập trận' : inventory?.activeScaleItem ? 'Long Lân trong tay' : 'Chưa có Long Lân',
      suggestion: buildSuggestion({
        missingStars,
        duplicateCount,
        progress,
        summonReady: Boolean(inventory?.summonReady),
        claimBlocked: Boolean(inventory?.claimBlocked),
        activeScale,
        winRate,
        dzitRate,
        currentWeekOrbName: dragon.currentWeek?.orbName,
      }),
    }
  })

  const sortedByWins = [...members].sort((left, right) => right.wins - left.wins || right.winRate - left.winRate)
  const sortedByDzit = [...members].sort((left, right) => right.dzitRate - left.dzitRate || right.dzitCount - left.dzitCount)
  const sortedByProgress = [...members].sort((left, right) => right.progress - left.progress || right.orbTotal - left.orbTotal)

  return {
    currentWeek: dragon.currentWeek,
    totals: {
      officialRaces: officialRaces.length,
      memberCount: members.length,
      totalOrbs: members.reduce((sum, member) => sum + member.orbTotal, 0),
      totalLongLan: members.filter((member) => member.activeScale).length,
    },
    highlights: {
      topWinner: sortedByWins[0] ?? null,
      dzitMagnet: sortedByDzit[0] ?? null,
      closestToDragon: sortedByProgress[0] ?? null,
    },
    members: members.sort((left, right) => right.progress - left.progress || right.wins - left.wins || left.name.localeCompare(right.name)),
  }
}
