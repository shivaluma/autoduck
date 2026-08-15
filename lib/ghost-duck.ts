export function isGhostDuck(args: { name: string }) {
  return args.name === 'Thomas'
}

export function filterOfficialRacers<T extends { name: string }>(players: T[]) {
  return players.filter((player) => !isGhostDuck(player))
}
