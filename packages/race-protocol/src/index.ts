import { z } from 'zod'

export const RACE_PROTOCOL_VERSION = '1.0.0'
export const RACE_ENGINE_VERSION = '1.0.0'
export const RACE_BALANCE_VERSION = 'S3.1'
export const DEFAULT_TRACK_VERSION = 'river-01-v1'
export const RACE_TICK_RATE = 60

export const playerIdSchema = z.string().min(1).max(128)
export const raceSeedSchema = z.string().regex(/^[a-f0-9]{64}$/i, 'Race seed must be 32-byte hex')
export const raceItemIdSchema = z.enum(['BUBBLE_SHIELD', 'HOMING_ROCKET', 'NITRO', 'BANANA', 'FEATHER', 'QUACK_HORN'])
export type RaceItemId = z.infer<typeof raceItemIdSchema>

export const raceLoadoutSchema = z.object({
  playerId: playerIdSchema,
  itemIds: z.array(raceItemIdSchema).max(2),
  source: z.enum(['PLAYER', 'AUTO']),
})
export type RaceLoadout = z.infer<typeof raceLoadoutSchema>

export const racePlayerConfigSchema = z.object({
  playerId: playerIdSchema,
  name: z.string().min(1).max(80),
  cosmeticKey: z.string().max(80).optional(),
})

export const raceConfigSchema = z.object({
  raceId: z.string().min(1),
  seed: raceSeedSchema,
  protocolVersion: z.string().min(1).default(RACE_PROTOCOL_VERSION),
  engineVersion: z.string().min(1).default(RACE_ENGINE_VERSION),
  balanceVersion: z.string().min(1).default(RACE_BALANCE_VERSION),
  trackVersion: z.string().min(1).default(DEFAULT_TRACK_VERSION),
  tickRate: z.literal(RACE_TICK_RATE).default(RACE_TICK_RATE),
  players: z.array(racePlayerConfigSchema).min(2).max(16),
  loadouts: z.array(raceLoadoutSchema).default([]),
})

export type RacePlayerConfig = z.infer<typeof racePlayerConfigSchema>
export type RaceConfig = z.infer<typeof raceConfigSchema>

export const raceLifecycleStateSchema = z.enum([
  'CREATED',
  'CHAOS_REVEALED',
  'PREPARING',
  'LOCKED',
  'COUNTDOWN',
  'RACING',
  'FINISHED',
  'RESOLVED',
  'ARCHIVED',
])

export type RaceLifecycleState = z.infer<typeof raceLifecycleStateSchema>

export interface DuckSnapshot {
  playerId: string
  progress: number
  lateralOffset: number
  speed: number
  rank: number
  activeEffects: string[]
}

export interface StateSnapshotMessage {
  type: 'STATE_SNAPSHOT'
  protocolVersion: string
  raceId: string
  tick: number
  ducks: DuckSnapshot[]
}

export type RaceEventType =
  | 'RACE_STARTED'
  | 'DUCK_COLLISION'
  | 'DUCK_FINISHED'
  | 'RACE_FINISHED'

export interface RaceEvent {
  raceId: string
  type: RaceEventType
  tick: number
  timestampWithinRaceMs: number
  sourcePlayerId?: string
  targetPlayerId?: string
  metadata: Record<string, unknown>
}

export interface RaceFinishEntry {
  playerId: string
  name: string
  rank: number
  finishTimeMs: number
}

export interface RaceResult {
  raceId: string
  engineVersion: string
  balanceVersion: string
  trackVersion: string
  tickRate: number
  durationMs: number
  standings: RaceFinishEntry[]
  events: RaceEvent[]
}

export type ServerRaceMessage =
  | { type: 'RACE_START'; protocolVersion: string; raceId: string; configCommit: string }
  | StateSnapshotMessage
  | { type: 'RACE_EVENT'; protocolVersion: string; event: RaceEvent }
  | { type: 'RACE_FINISH'; protocolVersion: string; result: RaceResult }
