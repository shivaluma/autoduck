import path from 'path'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '../prisma/generated/prisma/client'
import { isImmortalDuck } from '../lib/immortal-duck'

const dbUrl = process.env.DATABASE_URL || `file:${path.join(process.cwd(), 'prisma', 'dev.db')}`
const adapter = new PrismaBetterSqlite3({ url: dbUrl })
const prisma = new PrismaClient({ adapter })

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const users = await prisma.user.findMany({
    orderBy: { id: 'asc' },
    include: {
      ownedShields: {
        where: { status: 'active' },
        orderBy: [{ weeksUnused: 'desc' }, { earnedAt: 'asc' }],
      },
    },
  })

  console.log(`🛡️ Migrating legacy User.shields -> Shield rows${dryRun ? ' (dry-run)' : ''}`)
  console.log(`DB: ${dbUrl}`)

  let createdTotal = 0
  let syncedTotal = 0

  for (const user of users) {
    const immortal = isImmortalDuck({ name: user.name, shields: user.shields })

    if (immortal) {
      console.log(`  ∞ ${user.name}: immortal legacy=${user.shields}, activeRows=${user.ownedShields.length} -> skip materializing huge shield stack`)
      continue
    }

    const legacyCount = Math.max(0, user.shields)
    const activeCount = user.ownedShields.length
    const missingRows = Math.max(0, legacyCount - activeCount)

    if (missingRows > 0) {
      console.log(`  + ${user.name}: create ${missingRows} Shield rows (${activeCount} active rows, legacy=${legacyCount})`)
      createdTotal += missingRows

      if (!dryRun) {
        await prisma.shield.createMany({
          data: Array.from({ length: missingRows }).map(() => ({
            ownerId: user.id,
            status: 'active',
            weeksUnused: 0,
          })),
        })
      }
    } else {
      console.log(`  = ${user.name}: already migrated (${activeCount} active rows, legacy=${legacyCount})`)
    }

    const nextActiveCount = activeCount + missingRows
    if (user.shields !== nextActiveCount) {
      syncedTotal += 1
      console.log(`    sync User.shields: ${user.shields} -> ${nextActiveCount}`)
      if (!dryRun) {
        await prisma.user.update({
          where: { id: user.id },
          data: { shields: nextActiveCount },
        })
      }
    }
  }

  console.log(`\n✅ Done. Created ${createdTotal} Shield rows. Synced ${syncedTotal} users.`)
}

main()
  .catch((error) => {
    console.error('❌ Shield migration failed:', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
