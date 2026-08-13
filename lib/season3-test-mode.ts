export type Season3PrepStatus = 'open' | 'locked'

export function canStartSeason3TestRace(status: string): status is Season3PrepStatus {
  return status === 'open' || status === 'locked'
}

export function getSeason3RaceMode(testMode: boolean) {
  return testMode
    ? { claimsOfficialWeek: false, mutatesSeason: false } as const
    : { claimsOfficialWeek: true, mutatesSeason: true } as const
}
