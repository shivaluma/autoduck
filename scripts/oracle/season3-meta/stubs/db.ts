import { harness } from './harness'

export const prisma = new Proxy({}, { get: (_target, key) => (harness().prisma as Record<PropertyKey, unknown>)[key] })
