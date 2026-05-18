import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SHIELD_INITIAL_CHARGES,
  consumeShield,
  craftShieldIfEligible,
  createShield,
  tickShieldDecay,
} from '../lib/shield-decay'

type MockUser = {
  id: number
  name: string
  scars: number
  shields: number
}

type MockShield = {
  id: number
  ownerId: number
  charges: number
  weeksUnused: number
  status: string
  earnedAt: Date
  earnedRaceId?: number | null
  consumedAt?: Date | null
}

type MockWeeklyTick = {
  weekKey: string
  brokenShields: number
  lostShields: number
  details?: string
}

function applyNumberMutation(current: number, mutation: unknown) {
  if (typeof mutation === 'number') return mutation
  if (!mutation || typeof mutation !== 'object') return current

  const ops = mutation as { increment?: number; decrement?: number }
  if (typeof ops.increment === 'number') return current + ops.increment
  if (typeof ops.decrement === 'number') return current - ops.decrement
  return current
}

function pickSelect<T extends Record<string, unknown>>(row: T, select?: Record<string, boolean>) {
  if (!select) return { ...row }

  return Object.fromEntries(
    Object.entries(select)
      .filter(([, enabled]) => enabled)
      .map(([key]) => [key, row[key]])
  )
}

function matchesShieldWhere(shield: MockShield, where: Record<string, unknown> = {}) {
  if (typeof where.ownerId === 'number' && shield.ownerId !== where.ownerId) return false
  if (typeof where.status === 'string' && shield.status !== where.status) return false
  if (typeof where.id === 'number' && shield.id !== where.id) return false

  if (Array.isArray(where.OR)) {
    return where.OR.some((branch) => matchesShieldWhere(shield, branch as Record<string, unknown>))
  }

  if (where.earnedRaceId && typeof where.earnedRaceId === 'object') {
    const condition = where.earnedRaceId as { not?: number }
    if (typeof condition.not === 'number' && shield.earnedRaceId === condition.not) return false
  } else if (where.earnedRaceId === null && shield.earnedRaceId !== null && typeof shield.earnedRaceId !== 'undefined') {
    return false
  }

  return true
}

class MockPrisma {
  users = new Map<number, MockUser>()
  shields = new Map<number, MockShield>()
  weeklyTicks = new Map<string, MockWeeklyTick>()
  nextShieldId = 1

  constructor(seed: { users?: MockUser[]; shields?: Array<Omit<MockShield, 'earnedAt'> & { earnedAt?: Date }> } = {}) {
    for (const user of seed.users ?? []) {
      this.users.set(user.id, { ...user })
    }

    for (const shieldSeed of seed.shields ?? []) {
      const shield = {
        ...shieldSeed,
        earnedAt: shieldSeed.earnedAt ?? new Date(2026, 0, shieldSeed.id),
      }
      this.shields.set(shield.id, shield)
      this.nextShieldId = Math.max(this.nextShieldId, shield.id + 1)
    }
  }

  user = {
    findUnique: async ({ where, select }: { where: { id: number }; select?: Record<string, boolean> }) => {
      const user = this.users.get(where.id)
      return user ? pickSelect(user as unknown as Record<string, unknown>, select) : null
    },
    update: async ({ where, data }: { where: { id: number }; data: Partial<Record<keyof MockUser, unknown>> }) => {
      const user = this.users.get(where.id)
      assert.ok(user, `Missing mock user ${where.id}`)
      const next = { ...user }

      if ('scars' in data) next.scars = applyNumberMutation(next.scars, data.scars)
      if ('shields' in data) next.shields = applyNumberMutation(next.shields, data.shields)
      if (typeof data.name === 'string') next.name = data.name

      this.users.set(where.id, next)
      return { ...next }
    },
  }

  shield = {
    count: async ({ where }: { where?: Record<string, unknown> } = {}) =>
      [...this.shields.values()].filter((shield) => matchesShieldWhere(shield, where)).length,
    create: async ({ data }: { data: Omit<MockShield, 'id' | 'earnedAt'> & { earnedAt?: Date } }) => {
      const shield: MockShield = {
        id: this.nextShieldId,
        earnedAt: data.earnedAt ?? new Date(2026, 0, this.nextShieldId),
        ...data,
      }
      this.nextShieldId += 1
      this.shields.set(shield.id, shield)
      return { ...shield }
    },
    findFirst: async ({ where, orderBy }: { where?: Record<string, unknown>; orderBy?: Array<Record<string, string>> } = {}) => {
      const rows = [...this.shields.values()]
        .filter((shield) => matchesShieldWhere(shield, where))
        .sort((left, right) => sortShields(left, right, orderBy))
      return rows[0] ? { ...rows[0] } : null
    },
    findMany: async ({ where, orderBy }: { where?: Record<string, unknown>; orderBy?: Array<Record<string, string>> } = {}) =>
      [...this.shields.values()]
        .filter((shield) => matchesShieldWhere(shield, where))
        .sort((left, right) => sortShields(left, right, orderBy))
        .map((shield) => ({ ...shield })),
    update: async ({ where, data }: { where: { id: number }; data: Partial<MockShield> }) => {
      const shield = this.shields.get(where.id)
      assert.ok(shield, `Missing mock shield ${where.id}`)
      const next = { ...shield, ...data }
      this.shields.set(where.id, next)
      return { ...next }
    },
    groupBy: async ({ where }: { by: ['ownerId']; where?: Record<string, unknown>; _count: { _all: true } }) => {
      const counts = new Map<number, number>()
      for (const shield of this.shields.values()) {
        if (!matchesShieldWhere(shield, where)) continue
        counts.set(shield.ownerId, (counts.get(shield.ownerId) ?? 0) + 1)
      }
      return [...counts.entries()].map(([ownerId, count]) => ({
        ownerId,
        _count: { _all: count },
      }))
    },
  }

  weeklyTick = {
    findUnique: async ({ where }: { where: { weekKey: string } }) => this.weeklyTicks.get(where.weekKey) ?? null,
    create: async ({ data }: { data: MockWeeklyTick }) => {
      this.weeklyTicks.set(data.weekKey, { ...data })
      return { ...data }
    },
  }
}

function sortShields(left: MockShield, right: MockShield, orderBy: Array<Record<string, string>> = []) {
  for (const order of orderBy) {
    const [field, direction] = Object.entries(order)[0] as [keyof MockShield, 'asc' | 'desc']
    const leftValue = left[field]
    const rightValue = right[field]
    const multiplier = direction === 'desc' ? -1 : 1

    if (leftValue instanceof Date && rightValue instanceof Date && leftValue.getTime() !== rightValue.getTime()) {
      return (leftValue.getTime() - rightValue.getTime()) * multiplier
    }

    if (typeof leftValue === 'number' && typeof rightValue === 'number' && leftValue !== rightValue) {
      return (leftValue - rightValue) * multiplier
    }
  }
  return left.id - right.id
}

test('scar craft does not create a new shield while an active shield exists', async () => {
  const prisma = new MockPrisma({
    users: [{ id: 1, name: 'Zịt Test', scars: 2, shields: 0 }],
    shields: [{ id: 10, ownerId: 1, charges: 3, weeksUnused: 2, status: 'active' }],
  })

  const crafted = await craftShieldIfEligible(prisma, 1, 99)

  assert.equal(crafted, null)
  assert.equal(prisma.users.get(1)?.scars, 2)
  assert.equal(prisma.users.get(1)?.shields, 1)
  assert.equal([...prisma.shields.values()].filter((shield) => shield.ownerId === 1 && shield.status === 'active').length, 1)
})

test('scar craft spends exactly two scars when no active shield exists', async () => {
  const prisma = new MockPrisma({
    users: [{ id: 1, name: 'Zịt Test', scars: 3, shields: 0 }],
  })

  const crafted = await craftShieldIfEligible(prisma, 1, 99)

  assert.ok(crafted)
  assert.equal(crafted.charges, SHIELD_INITIAL_CHARGES)
  assert.equal(crafted.earnedRaceId, 99)
  assert.equal(prisma.users.get(1)?.scars, 1)
  assert.equal(prisma.users.get(1)?.shields, 1)
})

test('reward shields can stack without spending scars', async () => {
  const prisma = new MockPrisma({
    users: [{ id: 1, name: 'Zịt Test', scars: 2, shields: 1 }],
    shields: [{ id: 10, ownerId: 1, charges: 4, weeksUnused: 1, status: 'active' }],
  })

  const rewardShield = await createShield(prisma, 1, 99, 1)

  assert.equal(rewardShield.charges, 1)
  assert.equal(prisma.users.get(1)?.scars, 2)
  assert.equal(prisma.users.get(1)?.shields, 2)
  assert.equal([...prisma.shields.values()].filter((shield) => shield.ownerId === 1 && shield.status === 'active').length, 2)
})

test('consumeShield consumes only the selected active shield', async () => {
  const prisma = new MockPrisma({
    users: [{ id: 1, name: 'Zịt Test', scars: 0, shields: 2 }],
    shields: [
      { id: 10, ownerId: 1, charges: 4, weeksUnused: 1, status: 'active' },
      { id: 11, ownerId: 1, charges: 2, weeksUnused: 3, status: 'active' },
    ],
  })

  const consumed = await consumeShield(prisma, 1, 11)

  assert.equal(consumed?.id, 11)
  assert.equal(prisma.shields.get(10)?.status, 'active')
  assert.equal(prisma.shields.get(11)?.status, 'used')
  assert.equal(prisma.users.get(1)?.shields, 1)
})

test('weekly decay subtracts one charge from every old active shield and skips shields earned this race', async () => {
  const prisma = new MockPrisma({
    users: [{ id: 1, name: 'Zịt Test', scars: 0, shields: 3 }],
    shields: [
      { id: 10, ownerId: 1, charges: 5, weeksUnused: 0, status: 'active', earnedRaceId: null },
      { id: 11, ownerId: 1, charges: 3, weeksUnused: 2, status: 'active', earnedRaceId: 98 },
      { id: 12, ownerId: 1, charges: 1, weeksUnused: 4, status: 'active', earnedRaceId: 99 },
    ],
  })

  const result = await tickShieldDecay(prisma, { currentRaceId: 99 })

  assert.equal(result.broken.length, 0)
  assert.equal(prisma.shields.get(10)?.charges, 4)
  assert.equal(prisma.shields.get(11)?.charges, 2)
  assert.equal(prisma.shields.get(12)?.charges, 1)
  assert.equal(prisma.shields.get(12)?.status, 'active')
  assert.equal(prisma.users.get(1)?.shields, 3)
})
