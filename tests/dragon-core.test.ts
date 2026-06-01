/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict'
import test from 'node:test'
import { getDragonOrbName } from '../lib/dragon/naming'
import {
  calculateDragonWeekStar,
  getDragonOmenForDate,
  getDragonWeekKey,
  getVietnamMondayWeekStart,
} from '../lib/dragon/weekSchedule'
import {
  acceptDragonTradeOffer,
  createDragonTradeOffer,
} from '../lib/dragon/tradeDragonOrb'
import { getSummonReadiness, resolveDragonSummon } from '../lib/dragon/resolveDragonSummon'
import { applyDragonScaleProtection } from '../lib/dragon/applyDragonScaleProtection'
import { awardDragonOrbForRace } from '../lib/dragon/awardDragonOrb'

type MockUser = {
  id: number
  name: string
  shields: number
}

type MockRace = {
  id: number
  status: string
  createdAt: Date
  finishedAt?: Date | null
  isTest: boolean
}

type MockParticipant = {
  id: number
  raceId: number
  userId: number
  initialRank: number | null
  usedShield?: boolean
  gotScar?: boolean
  isClone?: boolean
  cloneOfUserId?: number | null
  cloneIndex?: number | null
  dragonEligible?: boolean
}

type MockOrb = {
  id: number
  currentOwnerId: number
  originalOwnerId?: number | null
  originalRaceId?: number | null
  dragonWeekId?: number | null
  seasonKey: string
  star: number
  status: string
  source: string
  lockedByTradeId?: number | null
  lockedBySummonId?: number | null
  createdAt: Date
  consumedAt?: Date | null
}

type MockTrade = {
  id: number
  proposerId: number
  counterpartyId?: number | null
  offeredOrbId: number
  requestedStar: number
  acceptedById?: number | null
  acceptedOrbId?: number | null
  status: string
  message?: string | null
  expiresAt?: Date | null
  acceptedAt?: Date | null
}

type MockDragonWeek = {
  id: number
  seasonKey: string
  weekKey: string
  weekStart: Date
  weekEnd: Date
  star: number
  raceId?: number | null
  awardedOrbId?: number | null
  status: string
}

type MockDragonItem = {
  id: number
  userId: number
  summonId?: number | null
  type: string
  status: string
  source: string
  label: string
  subtitle: string
  equippedForRaceId?: number | null
  consumedAt?: Date | null
}

function applyMutation<T extends Record<string, unknown>>(row: T, data: Record<string, unknown>): T {
  const next = { ...row }
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      const op = value as { increment?: number; decrement?: number }
      if (typeof op.increment === 'number') next[key as keyof T] = ((next[key as keyof T] as number) + op.increment) as T[keyof T]
      else if (typeof op.decrement === 'number') next[key as keyof T] = ((next[key as keyof T] as number) - op.decrement) as T[keyof T]
      else next[key as keyof T] = value as T[keyof T]
    } else {
      next[key as keyof T] = value as T[keyof T]
    }
  }
  return next
}

function matches(row: Record<string, unknown>, where: Record<string, unknown> = {}) {
  for (const [key, expected] of Object.entries(where)) {
    if (expected === undefined) continue
    const actual = row[key]
    if (expected && typeof expected === 'object' && !Array.isArray(expected) && !(expected instanceof Date)) {
      const condition = expected as { in?: unknown[]; not?: unknown; lt?: Date; lte?: Date; gte?: Date }
      if (condition.in && !condition.in.includes(actual)) return false
      if ('not' in condition && actual === condition.not) return false
      if (condition.lt instanceof Date && (!(actual instanceof Date) || actual >= condition.lt)) return false
      if (condition.lte instanceof Date && (!(actual instanceof Date) || actual > condition.lte)) return false
      if (condition.gte instanceof Date && (!(actual instanceof Date) || actual < condition.gte)) return false
      continue
    }
    if (actual !== expected) return false
  }
  return true
}

function sortBy(rows: any[], orderBy?: Array<Record<string, 'asc' | 'desc'>>) {
  if (!orderBy) return rows
  return [...rows].sort((left, right) => {
    for (const order of orderBy) {
      const [field, direction] = Object.entries(order)[0]
      const multiplier = direction === 'desc' ? -1 : 1
      const leftValue = left[field]
      const rightValue = right[field]
      const leftComparable = leftValue instanceof Date ? leftValue.getTime() : leftValue
      const rightComparable = rightValue instanceof Date ? rightValue.getTime() : rightValue
      if (leftComparable < rightComparable) return -1 * multiplier
      if (leftComparable > rightComparable) return 1 * multiplier
    }
    return left.id - right.id
  })
}

class DragonMockPrisma {
  users = new Map<number, MockUser>()
  races = new Map<number, MockRace>()
  participants = new Map<number, MockParticipant>()
  dragonWeeks = new Map<number, MockDragonWeek>()
  dragonOrbs = new Map<number, MockOrb>()
  dragonTrades = new Map<number, MockTrade>()
  dragonSummons = new Map<number, any>()
  dragonItems = new Map<number, MockDragonItem>()
  dragonOrbEvents: any[] = []
  dragonItemEvents: any[] = []
  commentaryLogs: any[] = []
  nextDragonWeekId = 1
  nextDragonOrbId = 1
  nextDragonTradeId = 1
  nextDragonSummonId = 1
  nextDragonItemId = 1

  constructor(seed: {
    users?: MockUser[]
    races?: MockRace[]
    participants?: MockParticipant[]
    dragonOrbs?: Array<Partial<MockOrb> & Pick<MockOrb, 'id' | 'currentOwnerId' | 'star'>>
    dragonItems?: MockDragonItem[]
  } = {}) {
    for (const user of seed.users ?? []) this.users.set(user.id, { ...user })
    for (const race of seed.races ?? []) this.races.set(race.id, { ...race })
    for (const participant of seed.participants ?? []) this.participants.set(participant.id, { ...participant })
    for (const orbSeed of seed.dragonOrbs ?? []) {
      const orb: MockOrb = {
        seasonKey: 'default',
        status: 'ACTIVE',
        source: 'ADMIN_GRANTED',
        createdAt: new Date(2026, 0, orbSeed.id),
        ...orbSeed,
      }
      this.dragonOrbs.set(orb.id, orb)
      this.nextDragonOrbId = Math.max(this.nextDragonOrbId, orb.id + 1)
    }
    for (const item of seed.dragonItems ?? []) {
      this.dragonItems.set(item.id, { ...item })
      this.nextDragonItemId = Math.max(this.nextDragonItemId, item.id + 1)
    }
  }

  $transaction = async (fn: (tx: this) => Promise<unknown>) => fn(this)

  user = {
    findUnique: async ({ where }: { where: { id: number } }) => this.users.get(where.id) ?? null,
    findMany: async ({ where }: { where?: Record<string, unknown> } = {}) =>
      [...this.users.values()].filter((user) => matches(user as unknown as Record<string, unknown>, where)),
  }

  race = {
    findUnique: async ({ where, include }: { where: { id: number }; include?: Record<string, unknown> }) => {
      const race = this.races.get(where.id)
      if (!race) return null
      if (!include?.participants) return { ...race }
      const participants = [...this.participants.values()]
        .filter((participant) => participant.raceId === race.id)
        .map((participant) => ({
          ...participant,
          user: this.users.get(participant.userId),
        }))
      return { ...race, participants }
    },
    findFirst: async ({ where, orderBy }: { where?: Record<string, unknown>; orderBy?: Array<Record<string, 'asc' | 'desc'>> } = {}) =>
      sortBy([...this.races.values()].filter((race) => matches(race as unknown as Record<string, unknown>, where)), orderBy)[0] ?? null,
  }

  dragonWeek = {
    findUnique: async ({ where }: { where: { seasonKey_weekKey?: { seasonKey: string; weekKey: string }; id?: number } }) => {
      if (typeof where.id === 'number') return this.dragonWeeks.get(where.id) ?? null
      const key = where.seasonKey_weekKey
      return [...this.dragonWeeks.values()].find((week) => week.seasonKey === key?.seasonKey && week.weekKey === key.weekKey) ?? null
    },
    create: async ({ data }: { data: Omit<MockDragonWeek, 'id'> }) => {
      const week = { id: this.nextDragonWeekId++, ...data }
      this.dragonWeeks.set(week.id, week)
      return { ...week }
    },
    update: async ({ where, data }: { where: { id: number }; data: Partial<MockDragonWeek> }) => {
      const week = this.dragonWeeks.get(where.id)
      assert.ok(week)
      const next = { ...week, ...data }
      this.dragonWeeks.set(where.id, next)
      return { ...next }
    },
  }

  dragonOrb = {
    findFirst: async ({ where, orderBy }: { where?: Record<string, unknown>; orderBy?: Array<Record<string, 'asc' | 'desc'>> } = {}) =>
      sortBy([...this.dragonOrbs.values()].filter((orb) => matches(orb as unknown as Record<string, unknown>, where)), orderBy)[0] ?? null,
    findMany: async ({ where, orderBy }: { where?: Record<string, unknown>; orderBy?: Array<Record<string, 'asc' | 'desc'>> } = {}) =>
      sortBy([...this.dragonOrbs.values()].filter((orb) => matches(orb as unknown as Record<string, unknown>, where)), orderBy),
    count: async ({ where }: { where?: Record<string, unknown> } = {}) =>
      [...this.dragonOrbs.values()].filter((orb) => matches(orb as unknown as Record<string, unknown>, where)).length,
    create: async ({ data }: { data: Omit<MockOrb, 'id' | 'createdAt'> & { createdAt?: Date } }) => {
      const orb = { id: this.nextDragonOrbId++, createdAt: data.createdAt ?? new Date(), ...data }
      this.dragonOrbs.set(orb.id, orb)
      return { ...orb }
    },
    update: async ({ where, data }: { where: { id: number }; data: Partial<MockOrb> }) => {
      const orb = this.dragonOrbs.get(where.id)
      assert.ok(orb)
      const next = applyMutation(orb as unknown as Record<string, unknown>, data as Record<string, unknown>) as unknown as MockOrb
      this.dragonOrbs.set(where.id, next)
      return { ...next }
    },
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<MockOrb> }) => {
      let count = 0
      for (const [id, orb] of this.dragonOrbs) {
        if (!matches(orb as unknown as Record<string, unknown>, where)) continue
        this.dragonOrbs.set(id, applyMutation(orb as unknown as Record<string, unknown>, data as Record<string, unknown>) as unknown as MockOrb)
        count += 1
      }
      return { count }
    },
  }

  dragonOrbEvent = {
    create: async ({ data }: { data: any }) => {
      const row = { id: this.dragonOrbEvents.length + 1, createdAt: new Date(), ...data }
      this.dragonOrbEvents.push(row)
      return row
    },
    findMany: async () => this.dragonOrbEvents,
  }

  dragonTrade = {
    findUnique: async ({ where }: { where: { id: number } }) => this.dragonTrades.get(where.id) ?? null,
    create: async ({ data }: { data: Omit<MockTrade, 'id'> }) => {
      const trade = { id: this.nextDragonTradeId++, ...data }
      this.dragonTrades.set(trade.id, trade)
      return { ...trade }
    },
    update: async ({ where, data }: { where: { id: number }; data: Partial<MockTrade> }) => {
      const trade = this.dragonTrades.get(where.id)
      assert.ok(trade)
      const next = { ...trade, ...data }
      this.dragonTrades.set(where.id, next)
      return { ...next }
    },
  }

  dragonSummon = {
    create: async ({ data }: { data: any }) => {
      const summon = { id: this.nextDragonSummonId++, ...data }
      this.dragonSummons.set(summon.id, summon)
      return { ...summon }
    },
    update: async ({ where, data }: { where: { id: number }; data: any }) => {
      const summon = this.dragonSummons.get(where.id)
      assert.ok(summon)
      const next = { ...summon, ...data }
      this.dragonSummons.set(where.id, next)
      return { ...next }
    },
  }

  dragonItem = {
    findFirst: async ({ where }: { where?: Record<string, unknown> } = {}) =>
      [...this.dragonItems.values()].find((item) => matches(item as unknown as Record<string, unknown>, where)) ?? null,
    findMany: async ({ where }: { where?: Record<string, unknown> } = {}) =>
      [...this.dragonItems.values()].filter((item) => matches(item as unknown as Record<string, unknown>, where)),
    create: async ({ data }: { data: Omit<MockDragonItem, 'id'> }) => {
      const item = { id: this.nextDragonItemId++, ...data }
      this.dragonItems.set(item.id, item)
      return { ...item }
    },
    update: async ({ where, data }: { where: { id: number }; data: Partial<MockDragonItem> }) => {
      const item = this.dragonItems.get(where.id)
      assert.ok(item)
      const next = { ...item, ...data }
      this.dragonItems.set(where.id, next)
      return { ...next }
    },
  }

  dragonItemEvent = {
    create: async ({ data }: { data: any }) => {
      const row = { id: this.dragonItemEvents.length + 1, createdAt: new Date(), ...data }
      this.dragonItemEvents.push(row)
      return row
    },
  }

  commentaryLog = {
    create: async ({ data }: { data: any }) => {
      this.commentaryLogs.push(data)
      return data
    },
  }
}

test('dragon orb names use Thất Tinh Dzịt Châu naming', () => {
  assert.equal(getDragonOrbName(1), 'Nhất Tinh Châu')
  assert.equal(getDragonOrbName(7), 'Thất Tinh Châu')
  assert.throws(() => getDragonOrbName(8), /Invalid Dragon Orb star/)
})

test('dragon week rotation wraps after seven weeks', () => {
  const seasonStart = new Date('2026-01-05T00:00:00.000Z')
  assert.equal(calculateDragonWeekStar(new Date('2026-01-05T12:00:00.000Z'), seasonStart), 1)
  assert.equal(calculateDragonWeekStar(new Date('2026-01-12T12:00:00.000Z'), seasonStart), 2)
  assert.equal(calculateDragonWeekStar(new Date('2026-02-16T12:00:00.000Z'), seasonStart), 7)
  assert.equal(calculateDragonWeekStar(new Date('2026-02-23T12:00:00.000Z'), seasonStart), 1)
})

test('dragon weekly omen announces the current drop and honors admin override', async () => {
  const prisma = new DragonMockPrisma()
  const seasonStart = new Date('2026-01-05T00:00:00.000Z')
  const currentWeekDate = new Date('2026-01-19T12:00:00.000Z')
  const omen = await getDragonOmenForDate(prisma, currentWeekDate, { seasonStart })

  assert.equal(omen.star, 3)
  assert.equal(omen.isOverride, false)
  assert.equal(prisma.dragonWeeks.size, 0)

  const weekStart = getVietnamMondayWeekStart(currentWeekDate)
  await prisma.dragonWeek.create({
    data: {
      seasonKey: 'default',
      weekKey: getDragonWeekKey(currentWeekDate),
      weekStart,
      weekEnd: new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000 - 1),
      star: 7,
      status: 'OVERRIDDEN',
    },
  })

  const overridden = await getDragonOmenForDate(prisma, currentWeekDate, { seasonStart })
  assert.equal(overridden.star, 7)
  assert.equal(overridden.isOverride, true)
})

test('official race awards featured plus bonus orb and reruns are idempotent', async () => {
  const prisma = new DragonMockPrisma({
    users: [
      { id: 1, name: 'Thomas', shields: 9999 },
      { id: 2, name: 'Vincent', shields: 0 },
      { id: 3, name: 'Linh', shields: 0 },
    ],
    races: [{ id: 10, status: 'finished', isTest: false, createdAt: new Date('2026-01-05T01:00:00.000Z'), finishedAt: new Date('2026-01-05T01:40:00.000Z') }],
    participants: [
      { id: 1, raceId: 10, userId: 1, initialRank: 1 },
      { id: 2, raceId: 10, userId: 2, initialRank: 2 },
      { id: 3, raceId: 10, userId: 3, initialRank: 3 },
    ],
  })

  const first = await awardDragonOrbForRace(prisma, 10, { seasonStart: new Date('2026-01-05T00:00:00.000Z'), bonusStar: 4 })
  const second = await awardDragonOrbForRace(prisma, 10, { seasonStart: new Date('2026-01-05T00:00:00.000Z'), bonusStar: 4 })

  assert.equal(first.awarded, true)
  assert.equal(first.winnerUserId, 2)
  assert.equal(first.awardedStar, 1)
  assert.deepEqual((first as any).awardedOrbs.map((orb: { star: number }) => orb.star), [1, 4])
  assert.equal(second.awarded, false)
  assert.equal(second.reason, 'ALREADY_AWARDED')
  assert.equal([...prisma.dragonOrbs.values()].length, 2)
})

test('boss clone visual winner awards the orb to the real owner', async () => {
  const prisma = new DragonMockPrisma({
    users: [
      { id: 2, name: 'Vincent', shields: 0 },
      { id: 3, name: 'Linh', shields: 0 },
    ],
    races: [{ id: 11, status: 'finished', isTest: false, createdAt: new Date('2026-01-12T01:00:00.000Z'), finishedAt: new Date('2026-01-12T01:40:00.000Z') }],
    participants: [
      { id: 4, raceId: 11, userId: 2, initialRank: 1, isClone: true, cloneOfUserId: 2, cloneIndex: 1 },
      { id: 5, raceId: 11, userId: 3, initialRank: 2 },
      { id: 6, raceId: 11, userId: 2, initialRank: 3 },
    ],
  })

  const result = await awardDragonOrbForRace(prisma, 11, { seasonStart: new Date('2026-01-05T00:00:00.000Z') })

  assert.equal(result.awarded, true)
  assert.equal(result.winnerUserId, 2)
  assert.equal(prisma.dragonOrbs.get(1)?.currentOwnerId, 2)
})

test('test races do not award Dragon Orbs', async () => {
  const prisma = new DragonMockPrisma({
    users: [
      { id: 2, name: 'Vincent', shields: 0 },
      { id: 3, name: 'Linh', shields: 0 },
    ],
    races: [{ id: 12, status: 'finished', isTest: true, createdAt: new Date('2026-01-05T01:00:00.000Z') }],
    participants: [
      { id: 7, raceId: 12, userId: 2, initialRank: 1 },
      { id: 8, raceId: 12, userId: 3, initialRank: 2 },
    ],
  })

  const result = await awardDragonOrbForRace(prisma, 12)

  assert.equal(result.awarded, false)
  assert.equal(result.reason, 'TEST_RACE')
  assert.equal([...prisma.dragonOrbs.values()].length, 0)
})

test('trades are one-for-one and atomically swap orb owners', async () => {
  const prisma = new DragonMockPrisma({
    users: [
      { id: 2, name: 'Vincent', shields: 0 },
      { id: 3, name: 'Linh', shields: 0 },
    ],
    dragonOrbs: [
      { id: 1, currentOwnerId: 2, star: 1 },
      { id: 2, currentOwnerId: 3, star: 4 },
    ],
  })

  const created = await createDragonTradeOffer(prisma, 2, 1, 4)
  assert.equal(created.created, true)
  assert.equal(prisma.dragonOrbs.get(1)?.lockedByTradeId, created.trade?.id)

  const accepted = await acceptDragonTradeOffer(prisma, created.trade!.id, 3, 2)

  assert.equal(accepted.accepted, true)
  assert.equal(prisma.dragonOrbs.get(1)?.currentOwnerId, 3)
  assert.equal(prisma.dragonOrbs.get(2)?.currentOwnerId, 2)
  assert.equal(prisma.dragonOrbs.get(1)?.lockedByTradeId, null)
  assert.equal(prisma.dragonTrades.get(created.trade!.id)?.status, 'ACCEPTED')
})

test('Thomas cannot create or accept Dragon trades', async () => {
  const prisma = new DragonMockPrisma({
    users: [
      { id: 1, name: 'Thomas', shields: 9999 },
      { id: 2, name: 'Vincent', shields: 0 },
    ],
    dragonOrbs: [
      { id: 1, currentOwnerId: 1, star: 1 },
      { id: 2, currentOwnerId: 2, star: 4 },
    ],
  })

  const created = await createDragonTradeOffer(prisma, 1, 1, 4)
  assert.equal(created.created, false)
  assert.equal(created.reason, 'THOMAS_BLOCKED')
})

test('summon consumes one orb of each star and leaves duplicates active', async () => {
  const orbs = Array.from({ length: 7 }, (_, index) => ({
    id: index + 1,
    currentOwnerId: 2,
    star: index + 1,
  }))
  const prisma = new DragonMockPrisma({
    users: [{ id: 2, name: 'Vincent', shields: 0 }],
    dragonOrbs: [...orbs, { id: 20, currentOwnerId: 2, star: 3 }],
  })

  const readiness = await getSummonReadiness(prisma, 2)
  assert.equal(readiness.ready, true)

  const resolved = await resolveDragonSummon(prisma, 2, 2)

  assert.equal(resolved.resolved, true)
  assert.equal(resolved.item?.label, 'Long Lân Hộ Mệnh')
  assert.equal(resolved.consumedOrbIds?.length, 7)
  assert.equal(prisma.dragonOrbs.get(20)?.status, 'ACTIVE')
  assert.equal(prisma.dragonItems.get(1)?.subtitle, 'Vảy Rồng')
})

test('summon is blocked without consuming orbs when user already has Long Lân', async () => {
  const prisma = new DragonMockPrisma({
    users: [{ id: 2, name: 'Vincent', shields: 0 }],
    dragonOrbs: Array.from({ length: 7 }, (_, index) => ({
      id: index + 1,
      currentOwnerId: 2,
      star: index + 1,
    })),
    dragonItems: [{
      id: 1,
      userId: 2,
      type: 'DRAGON_SCALE',
      status: 'ACTIVE',
      source: 'DRAGON_SUMMON',
      label: 'Long Lân Hộ Mệnh',
      subtitle: 'Vảy Rồng',
    }],
  })

  const resolved = await resolveDragonSummon(prisma, 2, 2)

  assert.equal(resolved.resolved, false)
  assert.equal(resolved.blocked, true)
  assert.equal([...prisma.dragonOrbs.values()].filter((orb) => orb.status === 'ACTIVE').length, 7)
})

test('Long Lân protects all owner-mapped victim entries and is consumed only when triggered', async () => {
  const prisma = new DragonMockPrisma({
    users: [
      { id: 2, name: 'Vincent', shields: 0 },
      { id: 3, name: 'Linh', shields: 0 },
      { id: 4, name: 'Minh', shields: 0 },
    ],
    dragonItems: [{
      id: 1,
      userId: 2,
      type: 'DRAGON_SCALE',
      status: 'EQUIPPED',
      source: 'DRAGON_SUMMON',
      label: 'Long Lân Hộ Mệnh',
      subtitle: 'Vảy Rồng',
      equippedForRaceId: 99,
    }],
  })
  const raceResults = [
    { name: 'Minh', userId: 4, initialRank: 1, usedShield: false, isImmortal: false, isClone: false, cloneOfUserId: null, cloneIndex: null },
    { name: 'Linh', userId: 3, initialRank: 2, usedShield: false, isImmortal: false, isClone: false, cloneOfUserId: null, cloneIndex: null },
    { name: 'Vincent Clone 1', userId: 2, initialRank: 3, usedShield: false, isImmortal: false, isClone: true, cloneOfUserId: 2, cloneIndex: 1 },
    { name: 'Vincent', userId: 2, initialRank: 4, usedShield: false, isImmortal: false, isClone: false, cloneOfUserId: null, cloneIndex: null },
  ]
  const victims = [
    { name: 'Vincent Clone 1', userId: 2, initialRank: 3, isClone: true, cloneOfUserId: 2, cloneIndex: 1 },
    { name: 'Vincent', userId: 2, initialRank: 4, isClone: false, cloneOfUserId: null, cloneIndex: null },
  ]

  const result = await applyDragonScaleProtection(prisma, 99, raceResults, victims)

  assert.equal(result.protectionApplied, true)
  assert.deepEqual(result.protectedUserIds, [2])
  assert.equal(prisma.dragonItems.get(1)?.status, 'CONSUMED')
  const finalVictims = result.finalVictims as Array<{ userId: number; cloneOfUserId?: number | null }>
  assert.ok(finalVictims.every((victim) => (victim.cloneOfUserId ?? victim.userId) !== 2))
  assert.ok(finalVictims.some((victim) => victim.userId === 3))
})
