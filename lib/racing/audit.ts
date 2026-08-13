import { createHash, randomBytes } from 'node:crypto'
import type { RaceConfig, RaceResult } from '@/packages/race-protocol/src'

export function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function createRaceSeed() {
  return randomBytes(32).toString('hex')
}

export function createRaceCommit(config: RaceConfig) {
  return createHash('sha256').update(canonicalize(config)).digest('hex')
}

export function createResultDigest(result: RaceResult) {
  return createHash('sha256').update(canonicalize(result)).digest('hex')
}
