import type { DuckSnapshot, RaceConfig, RaceEvent, RaceResult, RecordedWildItemInput } from '../../race-protocol/src'
import { CORE_BALANCE } from './config'
import { createRaceRng, type DeterministicRng } from './rng'
import { createRiverTrack, currentAt, type RaceTrack } from './track'
import {
  createItemRaceState,
  itemActiveEffects,
  itemSpeedMultiplier,
  tickItemSystem,
  type ItemRaceState,
} from './items/engine'
import { tickAutoUseAI } from './auto-use/arbiter'
import {
  announcePickupWorld,
  applyRecordedWildInputs,
  createPickupRaceState,
  snapshotPickupWorld,
  tickPickupSystem,
  type PickupRaceState,
} from './pickups/engine'
import { PICKUP_BALANCE } from './pickups/config'

const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value))

export interface DuckPhysicsState {
  playerId: string
  name: string
  progress: number
  previousProgress: number
  lateralOffset: number
  speed: number
  acceleration: number
  lateralVelocity: number
  desiredSpeed: number
  desiredLateralOffset: number
  currentRank: number
  activeEffects: string[]
  nextImpulseTick: number
  finished: boolean
  finishTimeMs: number | null
}

export interface RaceSimulationState {
  config: RaceConfig
  track: RaceTrack
  tick: number
  ducks: DuckPhysicsState[]
  events: RaceEvent[]
  finished: boolean
  recordEvents: boolean
  onEvent?: (raceEvent: RaceEvent) => void
  rngByPlayer: Map<string, DeterministicRng>
  itemState: ItemRaceState
  pickupState: PickupRaceState
  manualInputs: RecordedWildItemInput[]
  lastCollisionEventTick: Map<string, number>
}

export interface SimulationOptions {
  recordEvents?: boolean
  onEvent?: (raceEvent: RaceEvent) => void
  manualInputs?: RecordedWildItemInput[]
}

function event(state: RaceSimulationState, value: Omit<RaceEvent, 'raceId' | 'tick' | 'timestampWithinRaceMs'>): RaceEvent {
  return {
    raceId: state.config.raceId,
    tick: state.tick,
    timestampWithinRaceMs: state.tick * (1000 / state.config.tickRate),
    ...value,
  }
}

function emitEvent(state: RaceSimulationState, value: Omit<RaceEvent, 'raceId' | 'tick' | 'timestampWithinRaceMs'>) {
  if (!state.recordEvents && !state.onEvent) return
  const raceEvent = event(state, value)
  if (state.recordEvents) state.events.push(raceEvent)
  state.onEvent?.(raceEvent)
}

function scheduleImpulse(rng: DeterministicRng, currentTick: number, tickRate: number) {
  return currentTick + Math.round(rng.range(CORE_BALANCE.impulseMinSeconds, CORE_BALANCE.impulseMaxSeconds) * tickRate)
}

export function createSimulation(config: RaceConfig, options: SimulationOptions = {}): RaceSimulationState {
  const sortedPlayers = [...config.players].sort((left, right) => left.playerId.localeCompare(right.playerId))
  const rngByPlayer = new Map<string, DeterministicRng>()
  const startRng = createRaceRng(config.seed, 'track:start')
  const lateralSlots = sortedPlayers.map((_, index) => index)
  for (let index = lateralSlots.length - 1; index > 0; index -= 1) {
    const swap = startRng.integer(0, index)
    ;[lateralSlots[index], lateralSlots[swap]] = [lateralSlots[swap], lateralSlots[index]]
  }

  const baseSpeed = 1 / CORE_BALANCE.targetDurationSeconds
  const ducks = sortedPlayers.map((player, index) => {
    const rng = createRaceRng(config.seed, `duck:${player.playerId}`)
    rngByPlayer.set(player.playerId, rng)
    const slot = lateralSlots[index]
    const lateralOffset = sortedPlayers.length === 1 ? 0 : -0.75 + (slot / (sortedPlayers.length - 1)) * 1.5
    return {
      playerId: player.playerId,
      name: player.name,
      progress: 0,
      previousProgress: 0,
      lateralOffset,
      speed: baseSpeed,
      acceleration: 0,
      lateralVelocity: 0,
      desiredSpeed: baseSpeed * rng.range(1 - CORE_BALANCE.speedVariation, 1 + CORE_BALANCE.speedVariation),
      desiredLateralOffset: rng.range(-0.75, 0.75),
      currentRank: index + 1,
      activeEffects: [],
      nextImpulseTick: scheduleImpulse(rng, 0, config.tickRate),
      finished: false,
      finishTimeMs: null,
    }
  })

  const track = createRiverTrack(config.trackVersion)
  const state: RaceSimulationState = {
    config,
    track,
    tick: 0,
    ducks,
    events: [],
    finished: false,
    recordEvents: options.recordEvents !== false,
    onEvent: options.onEvent,
    rngByPlayer,
    itemState: createItemRaceState(config),
    pickupState: createPickupRaceState(config, track),
    manualInputs: [...(options.manualInputs ?? [])],
    lastCollisionEventTick: new Map(),
  }
  emitEvent(state, { type: 'RACE_STARTED', metadata: { playerCount: ducks.length } })
  announcePickupWorld(state.pickupState, (type, sourcePlayerId, targetPlayerId, metadata = {}) => {
    emitEvent(state, { type, sourcePlayerId, targetPlayerId, metadata })
  })
  return state
}

export function queueWildItemInput(state: RaceSimulationState, input: Omit<RecordedWildItemInput, 'authoritativeTick'>, authoritativeTick = state.tick + 1) {
  const recorded = { ...input, authoritativeTick: Math.max(state.tick + 1, authoritativeTick) }
  state.manualInputs.push(recorded)
  return recorded
}

function updateIntent(state: RaceSimulationState, duck: DuckPhysicsState) {
  if (state.tick < duck.nextImpulseTick) return
  const rng = state.rngByPlayer.get(duck.playerId)!
  const baseSpeed = 1 / CORE_BALANCE.targetDurationSeconds
  duck.desiredSpeed = baseSpeed * rng.range(1 - CORE_BALANCE.speedVariation, 1 + CORE_BALANCE.speedVariation)
  duck.acceleration = rng.range(-CORE_BALANCE.accelerationVariation, CORE_BALANCE.accelerationVariation) * baseSpeed
  duck.desiredLateralOffset = rng.range(-0.82, 0.82)
  duck.nextImpulseTick = scheduleImpulse(rng, state.tick, state.config.tickRate)
}

function resolveCollisions(state: RaceSimulationState) {
  const active = state.ducks.filter((duck) => !duck.finished).sort((left, right) => left.playerId.localeCompare(right.playerId))
  const lateralDelta = new Map(active.map((duck) => [duck.playerId, 0]))
  const speedDelta = new Map(active.map((duck) => [duck.playerId, 0]))

  for (let leftIndex = 0; leftIndex < active.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < active.length; rightIndex += 1) {
      const left = active[leftIndex]
      const right = active[rightIndex]
      const progressDistance = Math.abs(left.progress - right.progress)
      const lateralDistance = Math.abs(left.lateralOffset - right.lateralOffset)
      if (progressDistance >= CORE_BALANCE.collisionProgressRadius || lateralDistance >= CORE_BALANCE.collisionLateralRadius) continue

      const direction = left.lateralOffset === right.lateralOffset
        ? (left.playerId.localeCompare(right.playerId) < 0 ? -1 : 1)
        : Math.sign(left.lateralOffset - right.lateralOffset)
      const overlap = 1 - lateralDistance / CORE_BALANCE.collisionLateralRadius
      const push = CORE_BALANCE.collisionPush * overlap
      lateralDelta.set(left.playerId, (lateralDelta.get(left.playerId) ?? 0) + direction * push)
      lateralDelta.set(right.playerId, (lateralDelta.get(right.playerId) ?? 0) - direction * push)
      speedDelta.set(left.playerId, (speedDelta.get(left.playerId) ?? 0) - CORE_BALANCE.collisionSpeedLoss * left.speed)
      speedDelta.set(right.playerId, (speedDelta.get(right.playerId) ?? 0) - CORE_BALANCE.collisionSpeedLoss * right.speed)
      const pairKey = `${left.playerId}:${right.playerId}`
      const lastEventTick = state.lastCollisionEventTick.get(pairKey) ?? -Infinity
      if (state.recordEvents && state.tick - lastEventTick >= Math.round(state.config.tickRate * 0.5)) {
        emitEvent(state, {
          type: 'DUCK_COLLISION',
          sourcePlayerId: left.playerId,
          targetPlayerId: right.playerId,
          metadata: {},
        })
        state.lastCollisionEventTick.set(pairKey, state.tick)
      }
    }
  }

  for (const duck of active) {
    duck.lateralOffset = clamp(duck.lateralOffset + (lateralDelta.get(duck.playerId) ?? 0), -0.95, 0.95)
    duck.speed = Math.max(0.001, duck.speed + (speedDelta.get(duck.playerId) ?? 0))
  }
}

function updateRanks(state: RaceSimulationState) {
  const ordered = [...state.ducks].sort((left, right) => {
    if (left.finished && right.finished) return left.finishTimeMs! - right.finishTimeMs! || left.playerId.localeCompare(right.playerId)
    if (left.finished) return -1
    if (right.finished) return 1
    return right.progress - left.progress || left.playerId.localeCompare(right.playerId)
  })
  ordered.forEach((duck, index) => { duck.currentRank = index + 1 })
}

export function stepSimulation(state: RaceSimulationState) {
  if (state.finished) return state
  state.tick += 1
  const deltaSeconds = 1 / state.config.tickRate
  const tickStartMs = (state.tick - 1) * (1000 / state.config.tickRate)

  applyRecordedWildInputs(state.itemState, state.ducks, state.manualInputs, state.tick, state.config.tickRate, (type, sourcePlayerId, targetPlayerId, metadata = {}) => {
    emitEvent(state, { type, sourcePlayerId, targetPlayerId, metadata })
  })

  const autoUseInput = {
    config: state.config,
    track: state.track,
    itemState: state.itemState,
    pickupState: state.pickupState,
    ducks: state.ducks,
    tick: state.tick,
    tickRate: state.config.tickRate,
    prepAutoUseEnabled: true,
    wildAutoUseEnabled: state.pickupState.config.enabled && state.pickupState.config.autoItemsEnabled,
    emitItem: (type: Parameters<typeof emitEvent>[1]['type'], sourcePlayerId?: string, targetPlayerId?: string, metadata: Record<string, unknown> = {}) => {
      emitEvent(state, { type, sourcePlayerId, targetPlayerId, metadata })
    },
    emitPickup: (type: Parameters<typeof emitEvent>[1]['type'], sourcePlayerId?: string, targetPlayerId?: string, metadata: Record<string, unknown> = {}) => {
      emitEvent(state, { type, sourcePlayerId, targetPlayerId, metadata })
    },
  }
  tickAutoUseAI(autoUseInput)

  tickItemSystem(state.itemState, state.ducks, state.tick, state.config.tickRate, (type, sourcePlayerId, targetPlayerId, metadata = {}) => {
    emitEvent(state, { type, sourcePlayerId, targetPlayerId, metadata })
  })

  for (const duck of state.ducks) {
    if (duck.finished) continue
    duck.previousProgress = duck.progress
    updateIntent(state, duck)
    const current = currentAt(state.track, duck.progress)
    const currentMultiplier = current?.speedMultiplier ?? 1
    const currentLateralForce = current?.lateralForce ?? 0
    const itemRuntime = state.itemState.byPlayer.get(duck.playerId)!
    duck.activeEffects = itemActiveEffects(itemRuntime, state.tick)
    const targetSpeed = duck.desiredSpeed + duck.acceleration
    duck.speed += (targetSpeed - duck.speed) * CORE_BALANCE.speedResponse * deltaSeconds
    if (state.tick < itemRuntime.magnetUntilTick) {
      const target = state.ducks.filter((candidate) => !candidate.finished && candidate.progress > duck.progress && candidate.progress - duck.progress <= PICKUP_BALANCE.magnet.maximumTargetDistance)
        .sort((left, right) => left.progress - right.progress || left.playerId.localeCompare(right.playerId))[0]
      if (target) duck.desiredLateralOffset = target.lateralOffset
    }
    const stability = state.tick < itemRuntime.tailwindUntilTick ? PICKUP_BALANCE.tailwind.lateralStability : 1
    const desiredLateralVelocity = ((duck.desiredLateralOffset - duck.lateralOffset) * CORE_BALANCE.lateralResponse + currentLateralForce) * stability
    duck.lateralVelocity += (desiredLateralVelocity - duck.lateralVelocity) * 2.8 * deltaSeconds
    duck.lateralVelocity = clamp(duck.lateralVelocity, -CORE_BALANCE.maximumLateralVelocity, CORE_BALANCE.maximumLateralVelocity)
    duck.lateralOffset = clamp(duck.lateralOffset + duck.lateralVelocity * deltaSeconds, -0.95, 0.95)
    duck.progress += Math.max(0, duck.speed * currentMultiplier * itemSpeedMultiplier(itemRuntime, state.tick) * deltaSeconds)

    if (duck.progress >= 1) {
      const travelled = duck.progress - duck.previousProgress
      const fraction = travelled > 0 ? clamp((1 - duck.previousProgress) / travelled, 0, 1) : 1
      duck.finished = true
      duck.progress = 1
      duck.finishTimeMs = tickStartMs + fraction * (1000 / state.config.tickRate)
      emitEvent(state, {
        type: 'DUCK_FINISHED',
        sourcePlayerId: duck.playerId,
        metadata: { finishTimeMs: duck.finishTimeMs },
      })
    }
  }

  tickPickupSystem(state.config, state.track, state.pickupState, state.itemState, state.ducks, state.tick, state.config.tickRate, (type, sourcePlayerId, targetPlayerId, metadata = {}) => {
    emitEvent(state, { type, sourcePlayerId, targetPlayerId, metadata })
  })

  tickAutoUseAI(autoUseInput)

  resolveCollisions(state)
  updateRanks(state)
  state.finished = state.ducks.every((duck) => duck.finished)
  if (state.finished) emitEvent(state, { type: 'RACE_FINISHED', metadata: {} })
  return state
}

export function snapshotSimulation(state: RaceSimulationState): DuckSnapshot[] {
  return [...state.ducks]
    .sort((left, right) => left.currentRank - right.currentRank)
    .map((duck) => ({
      playerId: duck.playerId,
      progress: duck.progress,
      lateralOffset: duck.lateralOffset,
      speed: duck.speed,
      rank: duck.currentRank,
      activeEffects: [...duck.activeEffects],
      wildItem: state.itemState.byPlayer.get(duck.playerId)!.wildItem ? { ...state.itemState.byPlayer.get(duck.playerId)!.wildItem! } : null,
      regularPickupCount: state.itemState.byPlayer.get(duck.playerId)!.regularPickupCount,
    }))
}

export function snapshotRaceWorld(state: RaceSimulationState) {
  return { ducks: snapshotSimulation(state), ...snapshotPickupWorld(state.pickupState) }
}

export function resultFromSimulation(state: RaceSimulationState): RaceResult {
  if (!state.finished) throw new Error('Race has not finished')
  const standings = [...state.ducks]
    .sort((left, right) => left.finishTimeMs! - right.finishTimeMs! || left.playerId.localeCompare(right.playerId))
    .map((duck, index) => ({
      playerId: duck.playerId,
      name: duck.name,
      rank: index + 1,
      finishTimeMs: duck.finishTimeMs!,
    }))
  return {
    raceId: state.config.raceId,
    engineVersion: state.config.engineVersion,
    balanceVersion: state.config.balanceVersion,
    trackVersion: state.config.trackVersion,
    tickRate: state.config.tickRate,
    durationMs: Math.max(...standings.map((entry) => entry.finishTimeMs)),
    standings,
    events: state.events,
  }
}

export function simulateRace(config: RaceConfig, options: SimulationOptions = {}): RaceResult {
  const state = createSimulation(config, options)
  const maximumTicks = CORE_BALANCE.maximumDurationSeconds * config.tickRate
  while (!state.finished && state.tick < maximumTicks) stepSimulation(state)
  if (!state.finished) throw new Error(`Race did not finish within ${CORE_BALANCE.maximumDurationSeconds}s`)
  return resultFromSimulation(state)
}
