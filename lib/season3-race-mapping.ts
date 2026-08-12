import type { Season3RankingEntry } from '@/lib/season3'

export type Season3RaceMappingPlayer = {
  userId: number
  shields: number
  user: { name: string }
}

export function mapSeason3RaceRanking(
  rawRanking: Array<{ rank: number; name: string }>,
  players: Season3RaceMappingPlayer[],
): Season3RankingEntry[] {
  const playerByName = new Map(players.map((player) => [player.user.name, player]))
  const ranking = rawRanking.map((entry) => {
    const player = playerByName.get(entry.name)
    if (!player) throw new Error(`Race trả về player không thuộc Season 3: ${entry.name}`)
    return {
      userId: player.userId,
      name: player.user.name,
      rank: entry.rank,
      hasShield: player.shields > 0,
    }
  })

  if (ranking.length !== players.length || new Set(ranking.map((entry) => entry.userId)).size !== players.length) {
    throw new Error('Race không trả đủ ranking Season 3 players')
  }

  return ranking
}
