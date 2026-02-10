import { PrismaClient } from './generated/prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import path from 'path'

const dbUrl = process.env.DATABASE_URL || `file:${path.join(process.cwd(), 'prisma', 'dev.db')}`
const adapter = new PrismaBetterSqlite3({ url: dbUrl })
const prisma = new PrismaClient({ adapter })

// Data từ bảng tracking hiện tại
const players = [
  { name: 'Zịt Dũng', scars: 1, shields: 0, shieldsUsed: 3, totalKhaos: 3 },
  { name: 'Zịt Lợi', scars: 1, shields: 0, shieldsUsed: 5, totalKhaos: 5 },
  { name: 'Zịt Minh', scars: 1, shields: 0, shieldsUsed: 4, totalKhaos: 4 },
  { name: 'Zịt Tâm', scars: 1, shields: 1, shieldsUsed: 4, totalKhaos: 4 },
  { name: 'Zịt Tân', scars: 1, shields: 2, shieldsUsed: 2, totalKhaos: 2 },
  { name: 'Zịt Thanh', scars: 0, shields: 1, shieldsUsed: 4, totalKhaos: 4 },
  { name: 'Zịt Tuấn', scars: 1, shields: 1, shieldsUsed: 6, totalKhaos: 6 },
]

async function main() {
  // Chỉ seed khi DB chưa có user nào
  const existingCount = await prisma.user.count()
  if (existingCount > 0) {
    console.log(`🦆 Database already has ${existingCount} users, skipping seed.`)
    return
  }

  console.log('🦆 Seeding database (first run)...')

  for (const player of players) {
    await prisma.user.create({ data: player })
    console.log(`  ✓ ${player.name} (Sẹo: ${player.scars}, Khiên: ${player.shields})`)
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
