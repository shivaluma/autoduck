/**
 * Race wire types, as plain TypeScript (plan Phase 9). They are the output shapes of the retired TS
 * protocol's Zod schemas (`packages/race-protocol`, tag `ts-engine-final`): fields with a default are
 * required, `.optional()` fields optional. The Rust `race-protocol` crate is the source of truth for the
 * engine; these types only describe what the server and the WASM engine send to the browser.
 */

export type RaceItemId =
  | 'NITRO'
  | 'DRAFT_FIN'
  | 'PADDLE_BURST'
  | 'BUBBLE_SHIELD'
  | 'FEATHER'
  | 'SHOCK_ABSORBER'
  | 'HOMING_ROCKET'
  | 'BANANA'
  | 'QUACK_HORN'

export type WildItemId =
  | 'MINI_NITRO'
  | 'TAILWIND'
  | 'MINI_BUBBLE'
  | 'MINI_ROCKET'
  | 'BANANA'
  | 'QUACK_HORN'
  | 'FEATHER'
  | 'SLIPSTREAM_MAGNET'

export interface WildItemUseCommand {
  raceId: string
  playerId: string
  wildItemInstanceId: string
  action: 'USE'
  clientActionId: string
}

export interface RecordedWildItemInput extends WildItemUseCommand {
  authoritativeTick: number
}

export type PickupSpawnType = 'QUACK_BOX' | 'GOLDEN_BOX' | 'CHAOS_BOX'

export type HazardType = 'ANCHOR' | 'WHIRLPOOL' | 'ICE_PATCH' | 'STICKY_GOO'

export interface RaceLoadout {
  playerId: string
  itemIds: RaceItemId[]
  source: 'PLAYER' | 'AUTO'
}

export interface RaceChaosConfig {
  type: 'NORMAL' | 'REVERSE' | 'DUO' | 'TRIPLE_ELIMINATION' | 'CUT_LINE' | 'CONSTRUCTORS' | 'BOUNTY_HUNT'
  targetPlayerId?: string | null
  groups?: string[][]
}

export interface RaceItemTuning {
  nitroSpeedMultiplier?: number
  rocketSlowMultiplier?: number
  bananaKnockbackMultiplier?: number
  bananaSlowMultiplier?: number
}

export interface PickupConfig {
  enabled: boolean
  goldenBoxEnabled: boolean
  goldenBoxProbability: number
  hazardsEnabled: boolean
  positionAwareLoot: boolean
  spawnMultiplier: number
  regularPickupCap: number
  manualItemsEnabled: boolean
  autoItemsEnabled: boolean
  chaosBoxEnabled: boolean
  forceItem?: WildItemId
  disabledItems: WildItemId[]
  idealManualPlayerIds: string[]
  forceGoldenBox: boolean
}

export interface RacePlayerConfig {
  playerId: string
  name: string
  cosmeticKey?: string
  isGhost?: boolean
}

export interface RaceConfig {
  raceId: string
  seed: string
  protocolVersion: string
  engineVersion: string
  balanceVersion: string
  trackVersion: string
  pickupSpawnVersion?: string
  wildItemBalanceVersion?: string
  hazardBalanceVersion?: string
  tickRate: number
  players: RacePlayerConfig[]
  loadouts: RaceLoadout[]
  chaosConfig?: RaceChaosConfig
  itemTuning?: RaceItemTuning
  pickupConfig?: PickupConfig
}

export type RaceLifecycleState =
  | 'CREATED'
  | 'CHAOS_REVEALED'
  | 'PREPARING'
  | 'LOCKED'
  | 'COUNTDOWN'
  | 'RACING'
  | 'FINISHED'
  | 'RESOLVED'
  | 'ARCHIVED'

export interface DuckSnapshot {
  playerId: string
  progress: number
  lateralOffset: number
  speed: number
  rank: number
  activeEffects: string[]
  wildItem: { instanceId: string; itemId: WildItemId; acquiredAtTick: number } | null
  regularPickupCount: number
}

export interface StateSnapshotMessage {
  type: 'STATE_SNAPSHOT'
  protocolVersion: string
  raceId: string
  tick: number
  ducks: DuckSnapshot[]
  pickups: Array<{ id: string; type: PickupSpawnType; progress: number; lateralOffset: number; state: 'ACTIVE' | 'COLLECTED' | 'EXPIRED' }>
  hazards: Array<{ id: string; type: HazardType; progress: number; lateralOffset: number; radius: number }>
  rockets: Array<{ id: number; sourcePlayerId: string; targetPlayerId: string; progress: number; kind: 'PREP' | 'WILD' }>
  bananas: Array<{ id: number; sourcePlayerId: string; progress: number; lateralOffset: number; kind: 'PREP' | 'WILD' }>
}

export type RaceEventType =
  | 'RACE_STARTED' | 'DUCK_COLLISION' | 'ITEM_ACTIVATED' | 'ROCKET_FIRED' | 'ROCKET_HIT' | 'ROCKET_BLOCKED'
  | 'ROCKET_EXPIRED' | 'BANANA_DROPPED' | 'BANANA_HIT' | 'BANANA_BLOCKED' | 'BANANA_EXPIRED' | 'NITRO_STARTED'
  | 'NITRO_ENDED' | 'DRAFT_FIN_STARTED' | 'DRAFT_FIN_ENDED' | 'PADDLE_BURST_STARTED' | 'PADDLE_BURST_ENDED'
  | 'PREDATOR_RUSH_STARTED' | 'PREDATOR_RUSH_ENDED'
  | 'BOOST_BROKEN' | 'SPEED_BOOST_QUEUED' | 'SHOCK_ABSORBER_PROC' | 'HORN_USED' | 'ITEM_SILENCED' | 'FEATHER_DODGED'
  | 'BUBBLE_SHIELD_ACTIVATED' | 'BUBBLE_SHIELD_EXPIRED' | 'BUBBLE_POPPED' | 'DUCK_FINISHED' | 'RACE_FINISHED'
  | 'CHAOS_RESOLVED'
  | 'PICKUP_ZONE_ACTIVATED' | 'PICKUP_SPAWNED' | 'PICKUP_COLLECTED' | 'PICKUP_SKIPPED_SLOT_FULL'
  | 'WILD_ITEM_GRANTED' | 'WILD_ITEM_USED' | 'WILD_ITEM_AUTO_USED' | 'WILD_ITEM_MANUAL_INPUT'
  | 'INSTANT_PICKUP_TRIGGERED' | 'TAILWIND_STARTED' | 'TAILWIND_ENDED' | 'MAGNET_STARTED' | 'MAGNET_ENDED'
  | 'MINI_BUBBLE_ACTIVATED' | 'MINI_BUBBLE_BLOCKED' | 'MINI_BUBBLE_EXPIRED'
  | 'MINI_ROCKET_FIRED' | 'MINI_ROCKET_HIT' | 'MINI_ROCKET_BLOCKED' | 'MINI_ROCKET_EXPIRED'
  | 'WILD_BANANA_DROPPED' | 'WILD_BANANA_HIT' | 'WILD_BANANA_BLOCKED' | 'WILD_BANANA_EXPIRED'
  | 'WILD_HORN_USED' | 'WILD_FEATHER_USED' | 'WILD_FEATHER_DODGED'
  | 'HAZARD_SPAWNED' | 'HAZARD_HIT' | 'HAZARD_DODGED'
  | 'GOLDEN_BOX_SPAWNED' | 'GOLDEN_BOX_COLLECTED' | 'QP_TRACK_REWARD_GRANTED'
  | 'BOOST_GATE_PASSED'
  | 'MOMENTUM_STOLEN' | 'GUARD_SURGE'
  | 'DUCK_TEMPERAMENT' | 'AI_INTENT'
  | 'RIVER_EVENT_WARNING' | 'RIVER_EVENT_STARTED' | 'RIVER_EVENT_ENDED'

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
