import type { RaceConfig } from '@/packages/race-protocol/src'

export function publicRaceEngineVisibility(status: string, raceSeed: string | null, config: RaceConfig | null) {
  const revealGameplay = status === 'pending' || status === 'running' || status === 'finished'
  return {
    seed: revealGameplay ? raceSeed : null,
    config: revealGameplay ? config : null,
    players: config?.players ?? [],
  }
}
