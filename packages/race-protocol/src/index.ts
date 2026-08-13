import { z } from 'zod'

export const RACE_PROTOCOL_VERSION = '1.0.0'
export const RACE_ENGINE_VERSION = '1.2.0'
export const RACE_BALANCE_VERSION = 'S3.4'
export const DEFAULT_TRACK_VERSION = 'river-01-v2'
export const PICKUP_SPAWN_VERSION = 'pickups-v1'
export const WILD_ITEM_BALANCE_VERSION = 'wild-items-v1'
export const HAZARD_BALANCE_VERSION = 'hazards-v1'
export const RACE_TICK_RATE = 60

export const playerIdSchema = z.string().min(1).max(128)
export const raceSeedSchema = z.string().regex(/^[a-f0-9]{64}$/i, 'Race seed must be 32-byte hex')
export const raceItemIdSchema = z.enum(['BUBBLE_SHIELD', 'HOMING_ROCKET', 'NITRO', 'BANANA', 'FEATHER', 'QUACK_HORN'])
export type RaceItemId = z.infer<typeof raceItemIdSchema>

export const wildItemIdSchema = z.enum([
  'MINI_NITRO',
  'TAILWIND',
  'MINI_BUBBLE',
  'MINI_ROCKET',
  'BANANA',
  'QUACK_HORN',
  'FEATHER',
  'SLIPSTREAM_MAGNET',
])
export type WildItemId = z.infer<typeof wildItemIdSchema>

export const wildItemUseCommandSchema = z.object({
  raceId: z.string().min(1),
  playerId: playerIdSchema,
  wildItemInstanceId: z.string().min(1).max(160),
  action: z.literal('USE'),
  clientActionId: z.string().min(8).max(160),
})
export type WildItemUseCommand = z.infer<typeof wildItemUseCommandSchema>

export interface RecordedWildItemInput extends WildItemUseCommand {
  authoritativeTick: number
}

export const pickupSpawnTypeSchema = z.enum(['QUACK_BOX', 'GOLDEN_BOX', 'CHAOS_BOX'])
export type PickupSpawnType = z.infer<typeof pickupSpawnTypeSchema>

export const hazardTypeSchema = z.enum(['ANCHOR', 'WHIRLPOOL', 'ICE_PATCH', 'STICKY_GOO'])
export type HazardType = z.infer<typeof hazardTypeSchema>

export const raceLoadoutSchema = z.object({
  playerId: playerIdSchema,
  itemIds: z.array(raceItemIdSchema).max(2),
  source: z.enum(['PLAYER', 'AUTO']),
})
export type RaceLoadout = z.infer<typeof raceLoadoutSchema>

export const raceChaosConfigSchema = z.object({
  type: z.enum(['NORMAL', 'REVERSE', 'DUO', 'TRIPLE_ELIMINATION', 'CUT_LINE', 'CONSTRUCTORS', 'BOUNTY_HUNT']),
  targetPlayerId: playerIdSchema.nullable().optional(),
  groups: z.array(z.array(playerIdSchema)).optional(),
})
export type RaceChaosConfig = z.infer<typeof raceChaosConfigSchema>

export const raceItemTuningSchema = z.object({
  nitroSpeedMultiplier: z.number().min(1).max(1.2).optional(),
  rocketSlowMultiplier: z.number().min(0.75).max(1).optional(),
  bananaSlowMultiplier: z.number().min(0.75).max(1).optional(),
})
export type RaceItemTuning = z.infer<typeof raceItemTuningSchema>

export const pickupConfigSchema = z.object({
  enabled: z.boolean().default(true),
  goldenBoxEnabled: z.boolean().default(true),
  goldenBoxProbability: z.number().min(0).max(1).default(0.12),
  hazardsEnabled: z.boolean().default(true),
  positionAwareLoot: z.boolean().default(true),
  spawnMultiplier: z.number().min(0).max(3).default(1),
  regularPickupCap: z.number().int().min(1).max(3).default(2),
  manualItemsEnabled: z.boolean().default(true),
  autoItemsEnabled: z.boolean().default(true),
  chaosBoxEnabled: z.boolean().default(false),
  forceItem: wildItemIdSchema.optional(),
  disabledItems: z.array(wildItemIdSchema).default([]),
  idealManualPlayerIds: z.array(playerIdSchema).default([]),
  forceGoldenBox: z.boolean().default(false),
})
export type PickupConfig = z.infer<typeof pickupConfigSchema>

export const racePlayerConfigSchema = z.object({
  playerId: playerIdSchema,
  name: z.string().min(1).max(80),
  cosmeticKey: z.string().max(2048).optional(),
})

export const raceConfigSchema = z.object({
  raceId: z.string().min(1),
  seed: raceSeedSchema,
  protocolVersion: z.string().min(1).default(RACE_PROTOCOL_VERSION),
  engineVersion: z.string().min(1).default(RACE_ENGINE_VERSION),
  balanceVersion: z.string().min(1).default(RACE_BALANCE_VERSION),
  trackVersion: z.string().min(1).default(DEFAULT_TRACK_VERSION),
  pickupSpawnVersion: z.string().min(1).optional(),
  wildItemBalanceVersion: z.string().min(1).optional(),
  hazardBalanceVersion: z.string().min(1).optional(),
  tickRate: z.literal(RACE_TICK_RATE).default(RACE_TICK_RATE),
  players: z.array(racePlayerConfigSchema).min(2).max(16),
  loadouts: z.array(raceLoadoutSchema).default([]),
  chaosConfig: raceChaosConfigSchema.optional(),
  itemTuning: raceItemTuningSchema.optional(),
  pickupConfig: pickupConfigSchema.optional(),
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

export const duckSnapshotSchema = z.object({
  playerId: playerIdSchema,
  progress: z.number().min(0).max(1),
  lateralOffset: z.number().min(-1).max(1),
  speed: z.number().positive(),
  rank: z.number().int().positive(),
  activeEffects: z.array(z.string()),
  wildItem: z.object({
    instanceId: z.string(),
    itemId: wildItemIdSchema,
    acquiredAtTick: z.number().int().nonnegative(),
  }).nullable().default(null),
  regularPickupCount: z.number().int().nonnegative().default(0),
})
export type DuckSnapshot = z.infer<typeof duckSnapshotSchema>

export const stateSnapshotMessageSchema = z.object({
  type: z.literal('STATE_SNAPSHOT'),
  protocolVersion: z.string().min(1),
  raceId: z.string().min(1),
  tick: z.number().int().nonnegative(),
  ducks: z.array(duckSnapshotSchema).min(2).max(16),
  pickups: z.array(z.object({
    id: z.string(),
    type: pickupSpawnTypeSchema,
    progress: z.number().min(0).max(1),
    lateralOffset: z.number().min(-1).max(1),
    state: z.enum(['ACTIVE', 'COLLECTED', 'EXPIRED']),
  })).default([]),
  hazards: z.array(z.object({
    id: z.string(),
    type: hazardTypeSchema,
    progress: z.number().min(0).max(1),
    lateralOffset: z.number().min(-1).max(1),
    radius: z.number().positive(),
  })).default([]),
})
export type StateSnapshotMessage = z.infer<typeof stateSnapshotMessageSchema>

export const raceEventTypeSchema = z.enum([
  'RACE_STARTED', 'DUCK_COLLISION', 'ITEM_ACTIVATED', 'ROCKET_FIRED', 'ROCKET_HIT', 'ROCKET_BLOCKED',
  'ROCKET_EXPIRED', 'BANANA_DROPPED', 'BANANA_HIT', 'BANANA_BLOCKED', 'BANANA_EXPIRED', 'NITRO_STARTED',
  'NITRO_ENDED', 'HORN_USED', 'FEATHER_DODGED', 'BUBBLE_POPPED', 'DUCK_FINISHED', 'RACE_FINISHED',
  'CHAOS_RESOLVED',
  'PICKUP_ZONE_ACTIVATED', 'PICKUP_SPAWNED', 'PICKUP_COLLECTED', 'PICKUP_SKIPPED_SLOT_FULL',
  'WILD_ITEM_GRANTED', 'WILD_ITEM_USED', 'WILD_ITEM_AUTO_USED', 'WILD_ITEM_MANUAL_INPUT',
  'INSTANT_PICKUP_TRIGGERED', 'TAILWIND_STARTED', 'TAILWIND_ENDED', 'MAGNET_STARTED', 'MAGNET_ENDED',
  'MINI_BUBBLE_ACTIVATED', 'MINI_BUBBLE_BLOCKED', 'MINI_BUBBLE_EXPIRED',
  'MINI_ROCKET_FIRED', 'MINI_ROCKET_HIT', 'MINI_ROCKET_BLOCKED', 'MINI_ROCKET_EXPIRED',
  'WILD_BANANA_DROPPED', 'WILD_BANANA_HIT', 'WILD_BANANA_BLOCKED', 'WILD_BANANA_EXPIRED',
  'WILD_HORN_USED', 'WILD_FEATHER_USED', 'WILD_FEATHER_DODGED',
  'HAZARD_SPAWNED', 'HAZARD_HIT', 'HAZARD_DODGED',
  'GOLDEN_BOX_SPAWNED', 'GOLDEN_BOX_COLLECTED', 'QP_TRACK_REWARD_GRANTED',
])
export type RaceEventType = z.infer<typeof raceEventTypeSchema>

export interface RaceEvent {
  raceId: string
  type: RaceEventType
  tick: number
  timestampWithinRaceMs: number
  sourcePlayerId?: string
  targetPlayerId?: string
  metadata: Record<string, unknown>
}

export const raceEventSchema = z.object({
  raceId: z.string().min(1),
  type: raceEventTypeSchema,
  tick: z.number().int().nonnegative(),
  timestampWithinRaceMs: z.number().nonnegative(),
  sourcePlayerId: playerIdSchema.optional(),
  targetPlayerId: playerIdSchema.optional(),
  metadata: z.record(z.string(), z.unknown()),
})

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
