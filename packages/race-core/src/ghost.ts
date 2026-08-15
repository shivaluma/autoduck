import type { RaceConfig } from '../../race-protocol/src'

export function ghostPlayerIdsFromConfig(config: RaceConfig): Set<string> {
  return new Set(config.players.filter((player) => player.isGhost === true).map((player) => player.playerId))
}

export function isGhostPlayerId(config: RaceConfig, playerId: string): boolean {
  return config.players.some((player) => player.playerId === playerId && player.isGhost === true)
}
