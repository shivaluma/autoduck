/* eslint-disable @typescript-eslint/no-explicit-any */
import { getIsoWeekKey } from '@/lib/shield-decay'
import { assertDragonStar } from './naming'
import { DEFAULT_DRAGON_SEASON_KEY } from './utils'

const VN_OFFSET_MS = 7 * 60 * 60 * 1000
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

function toVietnamWallClock(date: Date) {
  return new Date(date.getTime() + VN_OFFSET_MS)
}

function fromVietnamWallClock(date: Date) {
  return new Date(date.getTime() - VN_OFFSET_MS)
}

export function getVietnamMondayWeekStart(date: Date) {
  const vn = toVietnamWallClock(date)
  const day = vn.getUTCDay() || 7
  vn.setUTCDate(vn.getUTCDate() - day + 1)
  vn.setUTCHours(0, 0, 0, 0)
  return fromVietnamWallClock(vn)
}

export function getDragonWeekKey(date: Date) {
  return getIsoWeekKey(toVietnamWallClock(date))
}

export function calculateDragonWeekIndex(raceDate: Date, seasonStart: Date) {
  const raceWeekStart = getVietnamMondayWeekStart(raceDate)
  const seasonWeekStart = getVietnamMondayWeekStart(seasonStart)
  return Math.max(0, Math.floor((raceWeekStart.getTime() - seasonWeekStart.getTime()) / WEEK_MS))
}

export function calculateDragonWeekStar(raceDate: Date, seasonStart: Date) {
  return (calculateDragonWeekIndex(raceDate, seasonStart) % 7) + 1
}

export async function getSeasonStart(prisma: any, raceDate: Date, explicitSeasonStart?: Date) {
  if (explicitSeasonStart) {
    return explicitSeasonStart
  }

  const configured = process.env.DRAGON_SEASON_START_DATE
  if (configured) {
    const parsed = new Date(configured)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed
    }
  }

  const firstOfficialRace = await prisma.race.findFirst?.({
    where: {
      isTest: false,
      status: 'finished',
    },
    orderBy: [{ finishedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
  })

  return firstOfficialRace?.finishedAt ?? firstOfficialRace?.createdAt ?? raceDate
}

export async function getDragonOmenForDate(
  prisma: any,
  date = new Date(),
  options: { seasonKey?: string; seasonStart?: Date } = {}
) {
  const seasonKey = options.seasonKey ?? DEFAULT_DRAGON_SEASON_KEY
  const seasonStart = await getSeasonStart(prisma, date, options.seasonStart)
  const weekKey = getDragonWeekKey(date)
  const weekStart = getVietnamMondayWeekStart(date)
  const weekEnd = new Date(weekStart.getTime() + WEEK_MS - 1)
  const existing = await prisma.dragonWeek.findUnique?.({
    where: { seasonKey_weekKey: { seasonKey, weekKey } },
  })
  const computedStar = calculateDragonWeekStar(date, seasonStart)
  const star = existing?.star ?? computedStar
  assertDragonStar(star)

  return {
    seasonKey,
    weekKey,
    weekStart,
    weekEnd,
    star,
    isOverride: Boolean(existing && existing.star !== computedStar),
    dragonWeekId: existing?.id ?? null,
  }
}

export async function getDragonWeekForRace(
  prisma: any,
  race: { id: number; createdAt: Date; finishedAt?: Date | null },
  options: { seasonKey?: string; seasonStart?: Date } = {}
) {
  const raceDate = race.finishedAt ?? race.createdAt
  const seasonKey = options.seasonKey ?? DEFAULT_DRAGON_SEASON_KEY
  const seasonStart = await getSeasonStart(prisma, raceDate, options.seasonStart)
  const weekKey = getDragonWeekKey(raceDate)
  const existing = await prisma.dragonWeek.findUnique({
    where: { seasonKey_weekKey: { seasonKey, weekKey } },
  })

  if (existing) {
    return existing
  }

  const weekStart = getVietnamMondayWeekStart(raceDate)
  const weekEnd = new Date(weekStart.getTime() + WEEK_MS - 1)
  const star = calculateDragonWeekStar(raceDate, seasonStart)
  assertDragonStar(star)

  return prisma.dragonWeek.create({
    data: {
      seasonKey,
      weekKey,
      weekStart,
      weekEnd,
      star,
      raceId: race.id,
      status: 'SCHEDULED',
    },
  })
}

export async function adminSetDragonWeekStar(
  prisma: any,
  dragonWeekId: number,
  star: number,
  actorLabel = 'admin'
) {
  assertDragonStar(star)
  const week = await prisma.dragonWeek.update({
    where: { id: dragonWeekId },
    data: { star, status: 'OVERRIDDEN' },
  })

  await prisma.dragonOrbEvent.create({
    data: {
      type: 'ADMIN_GRANTED',
      message: `${actorLabel} override tuần ${week.weekKey} sang ${star}`,
      payloadJson: JSON.stringify({ dragonWeekId, star }),
    },
  })

  return week
}
