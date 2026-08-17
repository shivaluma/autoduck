import type { DuckSnapshot, RaceConfig, RaceEvent, RaceResult, RecordedWildItemInput } from '../../race-protocol/src'
import { isGhostPlayerId } from './ghost'
import { CORE_BALANCE } from './config'
import { ITEM_BALANCE } from './items/config'
import { createRaceRng, type DeterministicRng } from './rng'
import { createRiverTrack, currentAt, type RaceTrack } from './track'
import {
  applyItemBoost,
  createItemRaceState,
  itemActiveEffects,
  itemSpeedMultiplier,
  snapshotItemWorld,
  tickItemSystem,
  type ItemRaceState,
} from './items/engine'
import { tickAutoUseDecide, tickAutoUseExecute } from './auto-use/arbiter'
import { buildRaceObjectiveContext } from './auto-use/objective'
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
  pacingSegments: number[]
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
  phaseProfile?: SimulationPhaseProfile
}

export interface SimulationPhaseProfile {
  autoUseExecuteMs: number
  itemSystemMs: number
  movementMs: number
  pickupMs: number
  autoUseDecideMs: number
  collisionMs: number
  rankingMs: number
  ticks: number
}

export interface SimulationOptions {
  recordEvents?: boolean
  onEvent?: (raceEvent: RaceEvent) => void
  manualInputs?: RecordedWildItemInput[]
  phaseProfile?: SimulationPhaseProfile
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

export function generateDuckPacingSegments(
  rng: DeterministicRng,
  segmentCount: number = CORE_BALANCE.pacingSegmentCount,
  variation: number = CORE_BALANCE.pacingVariation,
): number[] {
  if (segmentCount <= 1 || variation <= 0) return [1]
  const deltas: number[] = []
  let sum = 0
  for (let index = 0; index < segmentCount; index += 1) {
    const delta = rng.range(-variation, variation)
    deltas.push(delta)
    sum += delta
  }
  const mean = sum / segmentCount
  return deltas.map((delta) => Math.max(0.7, Math.min(1.3, 1 + (delta - mean))))
}

export function evaluatePacingMultiplier(segments: readonly number[], progress: number): number {
  const count = segments.length
  if (count === 0) return 1
  if (count === 1) return segments[0]!

  const clampedProgress = Math.max(0, Math.min(1, progress))
  const segmentWidth = 1 / count
  const firstCenter = segmentWidth * 0.5
  const lastCenter = 1 - segmentWidth * 0.5

  if (clampedProgress <= firstCenter) return segments[0]!
  if (clampedProgress >= lastCenter) return segments[count - 1]!

  const normalizedProgress = (clampedProgress - firstCenter) / segmentWidth
  const segmentIndex = Math.min(count - 2, Math.floor(normalizedProgress))
  const localT = normalizedProgress - segmentIndex

  const smoothT = localT * localT * (3 - 2 * localT)
  const from = segments[segmentIndex]!
  const to = segments[segmentIndex + 1]!
  return from + (to - from) * smoothT
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
    const pacingSegments = generateDuckPacingSegments(rng, CORE_BALANCE.pacingSegmentCount, CORE_BALANCE.pacingVariation)
    const slot = lateralSlots[index]
    const lateralOffset = sortedPlayers.length === 1 ? 0 : -0.75 + (slot / (sortedPlayers.length - 1)) * 1.5
    return {
      playerId: player.playerId,
      name: player.name,
      progress: 0,
      previousProgress: 0,
      lateralOffset,
      speed: baseSpeed * pacingSegments[0]!,
      acceleration: 0,
      lateralVelocity: 0,
      desiredSpeed: baseSpeed * rng.range(1 - CORE_BALANCE.speedVariation, 1 + CORE_BALANCE.speedVariation),
      desiredLateralOffset: lateralOffset,
      currentRank: index + 1,
      activeEffects: [],
      nextImpulseTick: scheduleImpulse(rng, 0, config.tickRate),
      finished: false,
      finishTimeMs: null,
      pacingSegments,
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
    phaseProfile: options.phaseProfile,
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

export function evaluateSmartDesiredLateralOffset(
  state: RaceSimulationState,
  duck: DuckPhysicsState,
  rng: DeterministicRng,
): number {
  const candidateLanes = [-0.75, -0.6375, -0.50, -0.2125, 0.0, 0.2125, 0.50, 0.6375, 0.75]
  const preferred = rng.range(-0.80, 0.80)
  const candidates = [...candidateLanes, preferred, duck.lateralOffset]

  const itemRuntime = state.itemState?.byPlayer?.get(duck.playerId)
  const hasDraftFin = Boolean(itemRuntime?.itemIds.includes('DRAFT_FIN') && !itemRuntime.usedItems.has('DRAFT_FIN'))
  const hasShield = Boolean(itemRuntime?.bubbleAvailable || itemRuntime?.wildBubbleAvailable)
  const hasFeather = Boolean(itemRuntime?.featherAvailable || itemRuntime?.wildFeatherAvailable)

  let bestCandidate = duck.lateralOffset
  let highestScore = -Infinity

  for (const candidate of candidates) {
    // 1. Base score: organic wander preference + edge penalty + lane stability
    let score = 10 - Math.abs(candidate - preferred) * 4
    if (Math.abs(candidate) > 0.82) score -= 18
    score += (1 - Math.abs(candidate - duck.lateralOffset)) * 3

    // 2. Crowd / Duck traffic avoidance (Prevent clumping & occlusions)
    for (const other of state.ducks) {
      if (other.playerId === duck.playerId || other.finished) continue
      const dProgress = Math.abs(duck.progress - other.progress)
      if (dProgress < 0.065) {
        const dLateral = Math.abs(candidate - other.lateralOffset)
        if (dLateral < 0.24) {
          const proximityWeight = (1 - dProgress / 0.065) * (1 - dLateral / 0.24)
          score -= proximityWeight * 36

          // If other is directly ahead and we are about to tail-end crash into them without drafting
          if (other.progress > duck.progress && dProgress < 0.035 && dLateral < 0.12) {
            score -= 24
          }
        }
      }
    }

    // 3. Strategic Drafting: If duck has Draft Fin or wants slipstream, reward aligning behind nearest ahead duck
    if (hasDraftFin) {
      const ahead = state.ducks
        .filter((c) => !c.finished && c.playerId !== duck.playerId && c.progress > duck.progress && c.progress - duck.progress <= 0.035)
        .sort((left, right) => left.progress - right.progress)[0]
      if (ahead && Math.abs(candidate - ahead.lateralOffset) <= 0.08) {
        score += 26
      }
    }

    // 4. Boost Gate strategic positioning (Risk vs Reward on 4 multi-tier lanes)
    if (state.track.boostGates) {
      const upcomingGate = state.track.boostGates.find(
        (gate) => gate.progress > duck.progress && gate.progress - duck.progress <= 0.095,
      )
      if (upcomingGate) {
        const dGate = upcomingGate.progress - duck.progress
        const proximityWeight = 1 - dGate / 0.095
        const targetLane = upcomingGate.lanes.find((l) => candidate >= l.minLateral && candidate <= l.maxLateral)
          ?? (candidate < -0.85 ? upcomingGate.lanes[0] : upcomingGate.lanes[upcomingGate.lanes.length - 1])!

        let gateReward = 0
        if (targetLane.tier === 'HYPER') gateReward = 36
        else if (targetLane.tier === 'SUPER') gateReward = 24
        else if (targetLane.tier === 'STANDARD') gateReward = 12
        else if (targetLane.tier === 'NEUTRAL') gateReward = 2

        let competitorsInLane = 0
        for (const other of state.ducks) {
          if (other.playerId === duck.playerId || other.finished) continue
          const otherProgressDist = Math.abs(duck.progress - other.progress)
          if (otherProgressDist < 0.07) {
            if (other.lateralOffset >= targetLane.minLateral - 0.06 && other.lateralOffset <= targetLane.maxLateral + 0.06) {
              competitorsInLane += 1
            }
          }
        }

        let crowdPenalty = 0
        if (targetLane.tier === 'HYPER') crowdPenalty = competitorsInLane * 22
        else if (targetLane.tier === 'SUPER') crowdPenalty = competitorsInLane * 14
        else if (targetLane.tier === 'STANDARD') crowdPenalty = competitorsInLane * 8
        else if (targetLane.tier === 'NEUTRAL') crowdPenalty = competitorsInLane * 3

        const laneAlignmentBonus = (1 - Math.abs(candidate - targetLane.centerLateral) / 0.25) * 5
        score += (gateReward - crowdPenalty + laneAlignmentBonus) * proximityWeight
      }
    }

    // 5. Hazard & Trap avoidance (Bananas & Track Hazards)
    if (state.itemState?.bananas) {
      for (const banana of state.itemState.bananas) {
        const dProgress = banana.progress - duck.progress
        if (dProgress > 0 && dProgress < 0.045) {
          if (Math.abs(candidate - banana.lateralOffset) <= banana.hitLateralRadius * 1.4) {
            score -= (hasFeather || hasShield) ? 20 : 55
          }
        }
      }
    }
    if (state.pickupState?.hazards) {
      for (const hazard of state.pickupState.hazards) {
        const dProgress = hazard.progress - duck.progress
        if (dProgress > 0 && dProgress < 0.05) {
          if (Math.abs(candidate - hazard.lateralOffset) <= hazard.radius * 1.3) {
            score -= 45
          }
        }
      }
    }

    // 6. Item Pickup attraction (Quack Boxes & Golden Boxes)
    if (itemRuntime && state.pickupState?.config && itemRuntime.regularPickupCount < state.pickupState.config.regularPickupCap && !itemRuntime.wildItem) {
      for (const pickup of state.pickupState.pickups ?? []) {
        if (pickup.state !== 'ACTIVE') continue
        const dProgress = pickup.progress - duck.progress
        if (dProgress > 0 && dProgress < 0.055) {
          if (Math.abs(candidate - pickup.lateralOffset) <= 0.14) {
            score += pickup.type === 'GOLDEN_BOX' ? 42 : 22
          }
        }
      }
    }

    // 7. Jitter for organic variation
    score += rng.range(-1.5, 1.5)

    if (score > highestScore) {
      highestScore = score
      bestCandidate = candidate
    }
  }

  return clamp(bestCandidate + rng.range(-0.03, 0.03), -0.85, 0.85)
}

function updateIntent(state: RaceSimulationState, duck: DuckPhysicsState) {
  if (state.tick < duck.nextImpulseTick) return
  const rng = state.rngByPlayer.get(duck.playerId)!
  const baseSpeed = 1 / CORE_BALANCE.targetDurationSeconds
  duck.desiredSpeed = baseSpeed * rng.range(1 - CORE_BALANCE.speedVariation, 1 + CORE_BALANCE.speedVariation)
  duck.acceleration = rng.range(-CORE_BALANCE.accelerationVariation, CORE_BALANCE.accelerationVariation) * baseSpeed
  duck.desiredLateralOffset = evaluateSmartDesiredLateralOffset(state, duck, rng)
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
      const leftIsFortress = state.itemState.byPlayer.get(left.playerId)?.loadoutCombo === 'FORTRESS'
      const rightIsFortress = state.itemState.byPlayer.get(right.playerId)?.loadoutCombo === 'FORTRESS'
      const leftPush = leftIsFortress ? push * ITEM_BALANCE.fortress.collisionPushMultiplier : push
      const rightPush = rightIsFortress ? push * ITEM_BALANCE.fortress.collisionPushMultiplier : push
      const leftSpeedLoss = leftIsFortress ? CORE_BALANCE.collisionSpeedLoss * ITEM_BALANCE.fortress.collisionSpeedLossMultiplier : CORE_BALANCE.collisionSpeedLoss
      const rightSpeedLoss = rightIsFortress ? CORE_BALANCE.collisionSpeedLoss * ITEM_BALANCE.fortress.collisionSpeedLossMultiplier : CORE_BALANCE.collisionSpeedLoss
      lateralDelta.set(left.playerId, (lateralDelta.get(left.playerId) ?? 0) + direction * leftPush)
      lateralDelta.set(right.playerId, (lateralDelta.get(right.playerId) ?? 0) - direction * rightPush)
      speedDelta.set(left.playerId, (speedDelta.get(left.playerId) ?? 0) - leftSpeedLoss * overlap * left.speed)
      speedDelta.set(right.playerId, (speedDelta.get(right.playerId) ?? 0) - rightSpeedLoss * overlap * right.speed)
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
  const profile = state.phaseProfile
  const mark = (label: 'autoUseExecute' | 'itemSystem' | 'movement' | 'pickup' | 'autoUseDecide' | 'collision' | 'ranking', started: number) => {
    if (!profile) return
    profile[`${label}Ms`] += performance.now() - started
  }

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
  const autoObjective = buildRaceObjectiveContext(state.config)
  let phaseStart = profile ? performance.now() : 0
  tickAutoUseExecute(autoUseInput, autoObjective)
  mark('autoUseExecute', phaseStart)

  phaseStart = profile ? performance.now() : 0
  tickItemSystem(state.itemState, state.ducks, state.tick, state.config.tickRate, (type, sourcePlayerId, targetPlayerId, metadata = {}) => {
    emitEvent(state, { type, sourcePlayerId, targetPlayerId, metadata })
  })
  mark('itemSystem', phaseStart)

  phaseStart = profile ? performance.now() : 0
  for (const duck of state.ducks) {
    if (duck.finished) continue
    duck.previousProgress = duck.progress
    updateIntent(state, duck)
    const current = currentAt(state.track, duck.progress)
    const currentMultiplier = current?.speedMultiplier ?? 1
    const currentLateralForce = current?.lateralForce ?? 0
    const itemRuntime = state.itemState.byPlayer.get(duck.playerId)!
    duck.activeEffects = itemActiveEffects(itemRuntime, state.tick)
    const pacingMultiplier = evaluatePacingMultiplier(duck.pacingSegments, duck.progress)
    const targetSpeed = duck.desiredSpeed * pacingMultiplier + duck.acceleration
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

    if (state.track.boostGates) {
      for (const gate of state.track.boostGates) {
        if (duck.previousProgress < gate.progress && duck.progress >= gate.progress) {
          const lane = gate.lanes.find((l) => duck.lateralOffset >= l.minLateral && duck.lateralOffset <= l.maxLateral)
            ?? (duck.lateralOffset < -0.85 ? gate.lanes[0] : gate.lanes[gate.lanes.length - 1])!

          applyItemBoost(itemRuntime, lane.speedMultiplier, lane.durationSeconds, state.tick, state.config.tickRate)
          emitEvent(state, {
            type: 'BOOST_GATE_PASSED',
            sourcePlayerId: duck.playerId,
            metadata: {
              gateId: gate.id,
              laneId: lane.id,
              tier: lane.tier,
              multiplier: lane.speedMultiplier,
              durationSeconds: lane.durationSeconds,
              colorHex: lane.colorHex,
              colorName: lane.colorName,
              label: lane.label,
            },
          })
        }
      }
    }

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
  mark('movement', phaseStart)

  phaseStart = profile ? performance.now() : 0
  tickPickupSystem(state.config, state.track, state.pickupState, state.itemState, state.ducks, state.tick, state.config.tickRate, (type, sourcePlayerId, targetPlayerId, metadata = {}) => {
    emitEvent(state, { type, sourcePlayerId, targetPlayerId, metadata })
  })
  mark('pickup', phaseStart)

  phaseStart = profile ? performance.now() : 0
  tickAutoUseDecide(autoUseInput, autoObjective)
  mark('autoUseDecide', phaseStart)

  phaseStart = profile ? performance.now() : 0
  resolveCollisions(state)
  mark('collision', phaseStart)

  phaseStart = profile ? performance.now() : 0
  updateRanks(state)
  mark('ranking', phaseStart)

  if (profile) profile.ticks += 1
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
  return { ducks: snapshotSimulation(state), ...snapshotPickupWorld(state.pickupState), ...snapshotItemWorld(state.itemState) }
}

export function resultFromSimulation(state: RaceSimulationState): RaceResult {
  if (!state.finished) throw new Error('Race has not finished')
  const officialDucks = state.ducks.filter((duck) => !isGhostPlayerId(state.config, duck.playerId))
  const standings = [...officialDucks]
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
