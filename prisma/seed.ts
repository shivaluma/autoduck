import { PrismaClient } from './generated/prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import path from 'path'

const dbPath = path.join(process.cwd(), 'prisma', 'dev.db')
const adapter = new PrismaBetterSqlite3({
  url: `file:${dbPath}`,
})
const prisma = new PrismaClient({ adapter })

// Data từ bảng tracking hiện tại (từ hình ảnh)
const players = [
  { name: 'Zịt Lợi',   scars: 1, shields: 0, shieldsUsed: 5, totalKhaos: 5 },
  { name: 'Zịt Minh',  scars: 1, shields: 0, shieldsUsed: 4, totalKhaos: 4 },
  { name: 'Zịt Tâm',   scars: 1, shields: 1, shieldsUsed: 4, totalKhaos: 4 },
  { name: 'Zịt Tân',   scars: 1, shields: 2, shieldsUsed: 2, totalKhaos: 2 },
  { name: 'Zịt Thanh', scars: 0, shields: 1, shieldsUsed: 4, totalKhaos: 4 },
  { name: 'Zịt Tuấn',  scars: 1, shields: 1, shieldsUsed: 6, totalKhaos: 6 },
]

async function main() {
  console.log('🦆 Seeding database...')

  for (const player of players) {
    await prisma.user.upsert({
      where: { name: player.name },
      update: {
        scars: player.scars,
        shields: player.shields,
        shieldsUsed: player.shieldsUsed,
        totalKhaos: player.totalKhaos,
      },
      create: player,
    })
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
