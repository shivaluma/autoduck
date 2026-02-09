// Shared types for the AutoDuck project

export interface PlayerData {
  id: number
  name: string
  scars: number
  shields: number
  shieldsUsed: number
  totalKhaos: number
}

export interface RaceSetupPlayer {
  userId: number
  name: string
  useShield: boolean
  availableShields: number
}

export interface RaceStatus {
  id: number
  status: 'pending' | 'running' | 'finished' | 'failed'
  videoUrl: string | null
  finalVerdict: string | null
  participants: {
    userId: number
    name: string
    usedShield: boolean
    initialRank: number | null
    gotScar: boolean
  }[]
  commentaries: {
    timestamp: number
    content: string
  }[]
}

export interface RaceRecap {
  id: number
  videoUrl: string | null
  finalVerdict: string
  finishedAt: string
  participants: {
    name: string
    initialRank: number
    usedShield: boolean
    gotScar: boolean
  }[]
  commentaries: {
    timestamp: number
    content: string
  }[]
}
