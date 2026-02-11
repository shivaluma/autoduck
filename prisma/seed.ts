import { PrismaClient } from './generated/prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import path from 'path'

const dbUrl = process.env.DATABASE_URL || `file:${path.join(process.cwd(), 'prisma', 'dev.db')}`
const adapter = new PrismaBetterSqlite3({ url: dbUrl })
const prisma = new PrismaClient({ adapter })

// Data từ bảng tracking hiện tại
// totalKhaos = shieldsUsed * 2 + shields * 2 + scars
const players = [
  { name: 'Zịt Dũng', scars: 1, shields: 0, shieldsUsed: 3, totalKhaos: 7 },   // 3*2 + 0*2 + 1
  { name: 'Zịt Lợi', scars: 1, shields: 0, shieldsUsed: 5, totalKhaos: 11 },  // 5*2 + 0*2 + 1
  { name: 'Zịt Minh', scars: 1, shields: 0, shieldsUsed: 4, totalKhaos: 9 },   // 4*2 + 0*2 + 1
  { name: 'Zịt Tâm', scars: 1, shields: 1, shieldsUsed: 4, totalKhaos: 11 },  // 4*2 + 1*2 + 1
  { name: 'Zịt Tân', scars: 1, shields: 2, shieldsUsed: 2, totalKhaos: 9 },   // 2*2 + 2*2 + 1
  { name: 'Zịt Thanh', scars: 0, shields: 1, shieldsUsed: 4, totalKhaos: 10 },  // 4*2 + 1*2 + 0
  { name: 'Zịt Tuấn', scars: 1, shields: 1, shieldsUsed: 6, totalKhaos: 15 },  // 6*2 + 1*2 + 1
  { name: 'Thomas', scars: 0, shields: 9999, shieldsUsed: 0, totalKhaos: 0, avatarUrl: 'https://api.dicebear.com/9.x/bottts-neutral/svg?seed=Thomas' }, // The Immortal Duck
]

async function main() {
  const isCI = process.env.CI === 'true' || process.argv.includes('--ci')
  console.log(`🦆 Seeding database...${isCI ? ' (CI Mode)' : ''}`)

  // Check if data already exists
  const existingUsers = await prisma.user.count()

  if (!isCI && existingUsers > 0) {
    console.log('⚠️ Database already contains data. Skipping seed.')
    return
  }

  for (const player of players) {
    if (isCI) {
      // In CI, we update if exists to ensure latest seed data
      await prisma.user.upsert({
        where: { name: player.name },
        update: player,
        create: player,
      })
      console.log(`  ✓ Upserted ${player.name}`)
    } else {
      // In dev, we just create (create throws if unique constraint violated, but we checked count > 0 above)
      // Actually, safest to just create since we returned if count > 0
      await prisma.user.create({
        data: player,
      })
      console.log(`  ✓ Created ${player.name}`)
    }
  }

  console.log('\n🎉 Seed completed! 🦆')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
