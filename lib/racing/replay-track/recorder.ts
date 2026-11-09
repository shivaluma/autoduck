import type { RaceSimulationState } from '@/packages/race-core/src'
import { hazardTypeSchema, pickupSpawnTypeSchema, wildItemIdSchema } from '@/packages/race-protocol/src'
import { NO_DUCK, PICKUP_STATES, PROJECTILE_KINDS, ENTITY_CLASS } from './format'

/**
 * Live DTRK recorder. It is purely observational: it only reads the simulation state, and
 * `push` never throws. The first failure logs once and disables the recorder, so the race keeps
 * running and resolves normally (plan risk R2).
 *
 * Duck fields are copied into growable typed arrays; wild-item, effect, pickup-count and entity
 * fields are diffed. No `snapshotRaceWorld` object graph is retained.
 */

export interface ReplayRecorderDuck {
  readonly playerId: string
  readonly progress: number
  readonly lateralOffset: number
  readonly speed: number
  readonly currentRank: number
  readonly activeEffects: readonly string[]
}

export interface ReplayRecorderDuckItems {
  readonly wildItem: { readonly instanceId: string; readonly itemId: string; readonly acquiredAtTick: number } | null | undefined
  readonly regularPickupCount: number
}

/** The read-only view the recorder samples once per tick. */
export interface ReplayRecorderWorld {
  ducks: ReadonlyArray<ReplayRecorderDuck>
  duckItems(playerId: string): ReplayRecorderDuckItems | undefined
  pickups: ReadonlyArray<{ readonly id: string; readonly type: string; readonly progress: number; readonly lateralOffset: number; readonly state: string }>
  hazards: ReadonlyArray<{ readonly id: string; readonly type: string; readonly progress: number; readonly lateralOffset: number; readonly radius: number }>
  rockets: ReadonlyArray<{ readonly id: number; readonly sourcePlayerId: string; readonly targetPlayerId: string; readonly progress: number; readonly kind: string }>
  bananas: ReadonlyArray<{ readonly id: number; readonly sourcePlayerId: string; readonly progress: number; readonly lateralOffset: number; readonly kind: string }>
}

export type ReplayRecorderSource = (state: RaceSimulationState) => ReplayRecorderWorld

/** Default source: reads the same fields `snapshotRaceWorld` exposes, straight from the state (no copies). */
export const worldFromSimulation: ReplayRecorderSource = (state) => ({
  ducks: state.ducks,
  duckItems: (playerId) => state.itemState.byPlayer.get(playerId),
  pickups: state.pickupState.pickups,
  hazards: state.pickupState.hazards,
  rockets: state.itemState.rockets,
  bananas: state.itemState.bananas,
})

export type ReplayDuckChange =
  | { tick: number; duck: number; kind: 'WILD_ITEM_SET'; item: number; acquiredAtTick: number; instanceId: string }
  | { tick: number; duck: number; kind: 'WILD_ITEM_CLEAR' }
  | { tick: number; duck: number; kind: 'REGULAR_PICKUP_COUNT'; count: number }
  | { tick: number; duck: number; kind: 'EFFECTS_SET'; effects: number[] }

export interface ReplayEntityRecord {
  cls: number
  id: string | number
  type: number
  src: number
  progress: number
  lateral: number
  radius: number
  firstTick: number
  lastTick: number
  initialState: number
  stateChanges: Array<{ tick: number; state: number }>
  moving: boolean
  /** Only when moving: interleaved [progress, lateral] per tick from firstTick to lastTick. */
  samples: number[] | null
}

export interface ReplayRocketRecord {
  id: number
  kind: number
  src: number
  tgt: number
  firstTick: number
  lastTick: number
  progress: number[]
  retargets: Array<{ tick: number; tgt: number }>
}

export interface ReplayTrackRecording {
  ducks: string[]
  sampleCount: number
  /** Sample-major (index = sample * duckCount + duck). */
  progress: Float64Array
  speed: Float64Array
  lateral: Float32Array
  rank: Uint8Array
  effects: string[]
  wildItems: string[]
  pickupTypes: string[]
  hazardTypes: string[]
  changes: ReplayDuckChange[]
  entities: ReplayEntityRecord[]
  rockets: ReplayRocketRecord[]
  stats: { movingEntities: number; orderViolations: number }
}

export interface ReplayTrackRecorder {
  push(state: RaceSimulationState): void
  readonly disabled: boolean
  readonly error: unknown
  readonly sampleCount: number
  /** Throws when the recorder is disabled or empty. Call once, after the race. */
  finalize(): ReplayTrackRecording
}

export interface ReplayTrackRecorderOptions {
  source?: ReplayRecorderSource
  log?: (message: string, error: unknown) => void
}

export function isReplayTrackRecordingEnabled(env: Record<string, string | undefined> = process.env) {
  return env.REPLAY_TRACK_RECORDING !== '0'
}

class Interner {
  readonly values: string[]
  private readonly index = new Map<string, number>()
  constructor(seed: readonly string[] = []) {
    this.values = []
    for (const value of seed) this.id(value)
  }
  id(value: string) {
    let found = this.index.get(value)
    if (found === undefined) {
      found = this.values.length
      if (found >= 0xff) throw new Error('DTRK table overflow')
      this.values.push(value)
      this.index.set(value, found)
    }
    return found
  }
}

function grow<T extends Float64Array | Float32Array | Uint8Array>(array: T, length: number, make: (size: number) => T): T {
  if (array.length >= length) return array
  const next = make(Math.max(length, array.length * 2))
  next.set(array)
  return next
}

export function createReplayTrackRecorder(options: ReplayTrackRecorderOptions = {}): ReplayTrackRecorder {
  const source = options.source ?? worldFromSimulation
  const log = options.log ?? ((message: string, error: unknown) => console.error(message, error))

  let disabled = false
  let error: unknown = null
  let expectedTick = 0
  let duckIds: string[] | null = null
  let duckIndex = new Map<string, number>()
  let duckCount = 0
  let progress = new Float64Array(0)
  let speed = new Float64Array(0)
  let lateral = new Float32Array(0)
  let rank = new Uint8Array(0)

  const effects = new Interner()
  const wildItems = new Interner(wildItemIdSchema.options)
  const pickupTypes = new Interner(pickupSpawnTypeSchema.options)
  const hazardTypes = new Interner(hazardTypeSchema.options)
  const changes: ReplayDuckChange[] = []
  let lastEffects: Array<readonly string[]> = []
  let lastWild: Array<{ instanceId: string; itemId: string; acquiredAtTick: number } | null> = []
  let lastPickupCount: number[] = []

  const entities: ReplayEntityRecord[] = []
  const livePickups = new Map<string, ReplayEntityRecord>()
  const liveHazards = new Map<string, ReplayEntityRecord>()
  const liveBananas = new Map<number, ReplayEntityRecord>()
  const entityOrdinal = new Map<ReplayEntityRecord, number>()
  const rockets: ReplayRocketRecord[] = []
  const rocketOrdinal = new Map<ReplayRocketRecord, number>()
  const liveRockets = new Map<number, ReplayRocketRecord>()
  let orderViolations = 0

  const duckOf = (playerId: string) => duckIndex.get(playerId) ?? NO_DUCK
  const enumIndex = (values: readonly string[], value: string, label: string) => {
    const index = values.indexOf(value)
    if (index < 0) throw new Error(`DTRK unknown ${label} ${value}`)
    return index
  }

  function initDucks(ducks: ReadonlyArray<ReplayRecorderDuck>) {
    if (ducks.length < 1 || ducks.length > 0xfe) throw new Error(`DTRK duck count ${ducks.length} out of range`)
    duckIds = ducks.map((duck) => duck.playerId)
    duckIndex = new Map(duckIds.map((playerId, index) => [playerId, index] as const))
    if (duckIndex.size !== duckIds.length) throw new Error('DTRK duplicate playerId')
    duckCount = duckIds.length
    lastEffects = duckIds.map(() => [])
    lastWild = duckIds.map(() => null)
    lastPickupCount = duckIds.map(() => 0)
    const capacity = 4096 * duckCount
    progress = new Float64Array(capacity)
    speed = new Float64Array(capacity)
    lateral = new Float32Array(capacity)
    rank = new Uint8Array(capacity)
  }

  function recordDucks(world: ReplayRecorderWorld, tick: number) {
    const ducks = world.ducks
    if (!duckIds) initDucks(ducks)
    if (ducks.length !== duckCount) throw new Error('DTRK duck count changed')
    const base = tick * duckCount
    const needed = base + duckCount
    progress = grow(progress, needed, (size) => new Float64Array(size))
    speed = grow(speed, needed, (size) => new Float64Array(size))
    lateral = grow(lateral, needed, (size) => new Float32Array(size))
    rank = grow(rank, needed, (size) => new Uint8Array(size))
    for (let index = 0; index < duckCount; index += 1) {
      const duck = ducks[index]!
      if (duck.playerId !== duckIds![index]) throw new Error('DTRK duck order changed')
      progress[base + index] = duck.progress
      speed[base + index] = duck.speed
      lateral[base + index] = duck.lateralOffset
      if (!(duck.currentRank >= 1 && duck.currentRank <= 0xff)) throw new Error(`DTRK rank ${duck.currentRank} out of range`)
      rank[base + index] = duck.currentRank

      const activeEffects = duck.activeEffects
      const previousEffects = lastEffects[index]!
      let effectsChanged = activeEffects.length !== previousEffects.length
      for (let cursor = 0; !effectsChanged && cursor < activeEffects.length; cursor += 1) {
        if (activeEffects[cursor] !== previousEffects[cursor]) effectsChanged = true
      }
      if (effectsChanged) {
        if (activeEffects.length > 0xff) throw new Error('DTRK too many effects')
        changes.push({ tick, duck: index, kind: 'EFFECTS_SET', effects: activeEffects.map((effect) => effects.id(effect)) })
        lastEffects[index] = [...activeEffects]
      }

      const items = world.duckItems(duck.playerId)
      const wild = items?.wildItem ?? null
      const previousWild = lastWild[index]!
      if (wild) {
        if (!previousWild || previousWild.instanceId !== wild.instanceId || previousWild.itemId !== wild.itemId || previousWild.acquiredAtTick !== wild.acquiredAtTick) {
          changes.push({ tick, duck: index, kind: 'WILD_ITEM_SET', item: wildItems.id(wild.itemId), acquiredAtTick: wild.acquiredAtTick, instanceId: wild.instanceId })
          lastWild[index] = { instanceId: wild.instanceId, itemId: wild.itemId, acquiredAtTick: wild.acquiredAtTick }
        }
      } else if (previousWild) {
        changes.push({ tick, duck: index, kind: 'WILD_ITEM_CLEAR' })
        lastWild[index] = null
      }
      const pickupCount = items?.regularPickupCount ?? 0
      if (pickupCount !== lastPickupCount[index]) {
        if (!(pickupCount >= 0 && pickupCount <= 0xff)) throw new Error('DTRK pickup count out of range')
        changes.push({ tick, duck: index, kind: 'REGULAR_PICKUP_COUNT', count: pickupCount })
        lastPickupCount[index] = pickupCount
      }
    }
  }

  function observeEntity<K extends string | number>(
    live: Map<K, ReplayEntityRecord>,
    id: K,
    tick: number,
    progressValue: number,
    lateralValue: number,
    create: () => Omit<ReplayEntityRecord, 'firstTick' | 'lastTick' | 'stateChanges' | 'moving' | 'samples' | 'progress' | 'lateral' | 'id'>,
    lastOrdinal: number,
  ): { record: ReplayEntityRecord; ordinal: number } {
    let record = live.get(id)
    if (!record) {
      record = { ...create(), id, progress: progressValue, lateral: lateralValue, firstTick: tick, lastTick: tick, stateChanges: [], moving: false, samples: null }
      entityOrdinal.set(record, entities.length)
      entities.push(record)
      live.set(id, record)
    } else {
      if (record.moving) record.samples!.push(progressValue, lateralValue)
      else if (record.progress !== progressValue || record.lateral !== lateralValue) {
        record.moving = true
        const samples: number[] = []
        for (let past = record.firstTick; past < tick; past += 1) samples.push(record.progress, record.lateral)
        samples.push(progressValue, lateralValue)
        record.samples = samples
      }
      record.lastTick = tick
    }
    const ordinal = entityOrdinal.get(record)!
    if (ordinal < lastOrdinal) orderViolations += 1
    return { record, ordinal }
  }

  function closeEntities<K>(live: Map<K, { lastTick: number }>, tick: number) {
    for (const [id, record] of live) if (record.lastTick !== tick) live.delete(id)
  }

  function recordEntities(world: ReplayRecorderWorld, tick: number) {
    let lastOrdinal = -1
    for (const pickup of world.pickups) {
      const state = enumIndex(PICKUP_STATES, pickup.state, 'pickup state')
      const { record, ordinal } = observeEntity(livePickups, pickup.id, tick, pickup.progress, pickup.lateralOffset, () => ({
        cls: ENTITY_CLASS.PICKUP, type: pickupTypes.id(pickup.type), src: NO_DUCK, radius: Number.NaN, initialState: state,
      }), lastOrdinal)
      lastOrdinal = ordinal
      const current = record.stateChanges.length > 0 ? record.stateChanges[record.stateChanges.length - 1]!.state : record.initialState
      if (current !== state) record.stateChanges.push({ tick, state })
    }
    closeEntities(livePickups, tick)

    lastOrdinal = -1
    for (const hazard of world.hazards) {
      const { record, ordinal } = observeEntity(liveHazards, hazard.id, tick, hazard.progress, hazard.lateralOffset, () => ({
        cls: ENTITY_CLASS.HAZARD, type: hazardTypes.id(hazard.type), src: NO_DUCK, radius: hazard.radius, initialState: 0,
      }), lastOrdinal)
      lastOrdinal = ordinal
      if (record.radius !== hazard.radius) throw new Error(`DTRK hazard ${hazard.id} radius changed`)
    }
    closeEntities(liveHazards, tick)

    lastOrdinal = -1
    for (const banana of world.bananas) {
      const { ordinal } = observeEntity(liveBananas, banana.id, tick, banana.progress, banana.lateralOffset, () => ({
        cls: ENTITY_CLASS.BANANA, type: enumIndex(PROJECTILE_KINDS, banana.kind, 'banana kind'), src: duckOf(banana.sourcePlayerId), radius: Number.NaN, initialState: 0,
      }), lastOrdinal)
      lastOrdinal = ordinal
    }
    closeEntities(liveBananas, tick)

    let lastRocketOrdinal = -1
    for (const rocket of world.rockets) {
      let record = liveRockets.get(rocket.id)
      const target = duckOf(rocket.targetPlayerId)
      if (!record) {
        record = {
          id: rocket.id,
          kind: enumIndex(PROJECTILE_KINDS, rocket.kind, 'rocket kind'),
          src: duckOf(rocket.sourcePlayerId),
          tgt: target,
          firstTick: tick,
          lastTick: tick,
          progress: [rocket.progress],
          retargets: [],
        }
        rocketOrdinal.set(record, rockets.length)
        rockets.push(record)
        liveRockets.set(rocket.id, record)
      } else {
        record.progress.push(rocket.progress)
        record.lastTick = tick
        const currentTarget = record.retargets.length > 0 ? record.retargets[record.retargets.length - 1]!.tgt : record.tgt
        if (currentTarget !== target) record.retargets.push({ tick, tgt: target })
      }
      const ordinal = rocketOrdinal.get(record)!
      if (ordinal < lastRocketOrdinal) orderViolations += 1
      lastRocketOrdinal = ordinal
    }
    closeEntities(liveRockets, tick)
  }

  return {
    get disabled() { return disabled },
    get error() { return error },
    get sampleCount() { return expectedTick },
    push(state) {
      if (disabled) return
      try {
        const tick = state.tick
        if (tick < expectedTick) return
        if (tick !== expectedTick) throw new Error(`DTRK expected tick ${expectedTick}, got ${tick}`)
        const world = source(state)
        recordDucks(world, tick)
        recordEntities(world, tick)
        expectedTick += 1
      } catch (caught) {
        disabled = true
        error = caught
        try {
          log(`[replay-track] recorder disabled at tick ${expectedTick}; race continues without a recording`, caught)
        } catch {
          // Logging must never break the tick loop either.
        }
      }
    },
    finalize() {
      if (disabled) throw new Error(`replay-track recorder is disabled: ${error instanceof Error ? error.message : String(error)}`)
      if (!duckIds || expectedTick === 0) throw new Error('replay-track recorder captured no samples')
      // Static-position assertion: a non-moving entity has one position for its whole life by construction;
      // any entity whose position changed was switched to per-sample positions (flag bit 0).
      for (const entity of entities) {
        if (entity.moving && entity.samples!.length !== (entity.lastTick - entity.firstTick + 1) * 2) throw new Error(`DTRK entity ${entity.id} sample count mismatch`)
      }
      for (const rocket of rockets) {
        if (rocket.progress.length !== rocket.lastTick - rocket.firstTick + 1) throw new Error(`DTRK rocket ${rocket.id} sample count mismatch`)
      }
      const size = expectedTick * duckCount
      return {
        ducks: [...duckIds],
        sampleCount: expectedTick,
        progress: progress.subarray(0, size),
        speed: speed.subarray(0, size),
        lateral: lateral.subarray(0, size),
        rank: rank.subarray(0, size),
        effects: effects.values,
        wildItems: wildItems.values,
        pickupTypes: pickupTypes.values,
        hazardTypes: hazardTypes.values,
        changes,
        entities,
        rockets,
        stats: { movingEntities: entities.filter((entity) => entity.moving).length, orderViolations },
      }
    },
  }
}
