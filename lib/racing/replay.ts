import { simulateRace } from '@/packages/race-core/src'
import { RACE_BALANCE_VERSION, RACE_ENGINE_VERSION, type RaceConfig, type RecordedWildItemInput } from '@/packages/race-protocol/src'
import { createResultDigest } from './audit'

export function replayRace(config: RaceConfig, expectedDigest?: string, manualInputs: RecordedWildItemInput[] = []) {
  const supported = (config.engineVersion === RACE_ENGINE_VERSION && config.balanceVersion === RACE_BALANCE_VERSION)
    || (config.engineVersion === '1.1.0' && config.balanceVersion === 'S3.2')
  if (!supported) {
    throw new Error(`Unsupported replay version: engine ${config.engineVersion}, balance ${config.balanceVersion}`)
  }
  const result = simulateRace(config, { manualInputs })
  const digest = createResultDigest(result)
  if (expectedDigest && digest !== expectedDigest) {
    throw new Error(`Replay mismatch: expected ${expectedDigest}, received ${digest}`)
  }
  return { result, digest }
}
