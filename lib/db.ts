/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import path from 'path'

// Prisma 7 generates ESM-only client code with import.meta.url
// which doesn't work with Next.js Turbopack bundler.
// Using require() as a workaround.
const generated = require('../prisma/generated/prisma/client') as any
const PrismaClient = generated.PrismaClient as any

const globalForPrisma = globalThis as unknown as {
  prisma: any | undefined
}

function createPrismaClient() {
  // Use DATABASE_URL env var, fallback to local dev.db
  const dbUrl = process.env.DATABASE_URL || `file:${path.join(process.cwd(), 'prisma', 'dev.db')}`
  const adapter = new PrismaBetterSqlite3({
    url: dbUrl,
  })
  return new PrismaClient({ adapter })
}

export const prisma: any = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
