import { simulateRace } from '@/packages/race-core/src'
import type { RaceConfig } from '@/packages/race-protocol/src'
import { createResultDigest } from './audit'

export function replayRace(config: RaceConfig, expectedDigest?: string) {
  const result = simulateRace(config)
  const digest = createResultDigest(result)
  if (expectedDigest && digest !== expectedDigest) {
    throw new Error(`Replay mismatch: expected ${expectedDigest}, received ${digest}`)
  }
  return { result, digest }
}
