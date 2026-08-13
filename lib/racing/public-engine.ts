import type { RaceConfig } from '@/packages/race-protocol/src'

export function publicRaceEngineVisibility(status: string, raceSeed: string | null, config: RaceConfig | null) {
  return {
    seed: status === 'finished' ? raceSeed : null,
    config: status === 'finished' ? config : null,
    players: config?.players ?? [],
  }
}
