export type Season3PrepStatus = 'open' | 'locked'

export function canStartSeason3TestRace(status: string): status is Season3PrepStatus {
  return status === 'open' || status === 'locked'
}

export function getTestRaceRestoreStatus(predictionsLockedAt: Date | null | undefined): Season3PrepStatus {
  return predictionsLockedAt ? 'locked' : 'open'
}
