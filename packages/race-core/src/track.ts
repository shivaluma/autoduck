export type BoostLaneTier = 'HYPER' | 'SUPER' | 'STANDARD' | 'NEUTRAL'

export interface BoostLane {
  id: string
  tier: BoostLaneTier
  minLateral: number
  maxLateral: number
  centerLateral: number
  speedMultiplier: number
  durationSeconds: number
  colorHex: number
  colorName: string
  label: string
}

export interface BoostGate {
  id: string
  progress: number
  lanes: BoostLane[]
}

export interface CurrentZone {
  startProgress: number
  endProgress: number
  speedMultiplier: number
  lateralForce: number
}

export interface TrackPoint {
  x: number
  y: number
  tangentX: number
  tangentY: number
  width: number
}

export interface PickupAnchor {
  id: string
  lateralOffset: number
  progressOffset: number
}

export interface PickupZone {
  id: string
  startProgress: number
  endProgress: number
  candidateAnchors: PickupAnchor[]
  spawnRatio: number
  allowedTypes: Array<'QUACK_BOX' | 'GOLDEN_BOX' | 'CHAOS_BOX'>
}

export interface HazardAnchor {
  id: string
  progress: number
  lateralOffset: number
  radius: number
}

export interface HazardZone {
  id: string
  anchors: HazardAnchor[]
  allowedTypes: Array<'ANCHOR' | 'WHIRLPOOL' | 'ICE_PATCH' | 'STICKY_GOO'>
}

export interface RaceTrack {
  version: string
  length: number
  currents: CurrentZone[]
  pickupZones: PickupZone[]
  hazardZones: HazardZone[]
  boostGates: BoostGate[]
  pickupLayoutVersion: string
  sample(progress: number, lateralOffset: number): TrackPoint
}

const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value))

const BOOST_TIER_CONFIG: Record<BoostLaneTier, { speedMultiplier: number; durationSeconds: number; colorHex: number; colorName: string; label: string }> = {
  HYPER: { speedMultiplier: 1.25, durationSeconds: 1.8, colorHex: 0xffb703, colorName: '#ffb703', label: 'HYPER +25%' },
  SUPER: { speedMultiplier: 1.16, durationSeconds: 1.5, colorHex: 0x00f0ff, colorName: '#00f0ff', label: 'SUPER +16%' },
  STANDARD: { speedMultiplier: 1.08, durationSeconds: 1.2, colorHex: 0x06d6a0, colorName: '#06d6a0', label: 'STANDARD +8%' },
  NEUTRAL: { speedMultiplier: 1.02, durationSeconds: 1.0, colorHex: 0xa855f7, colorName: '#a855f7', label: 'CLEAR +2%' },
}

function createBoostLanes(gateId: string, tiers: [BoostLaneTier, BoostLaneTier, BoostLaneTier, BoostLaneTier]): BoostLane[] {
  const boundaries = [-0.85, -0.425, 0.0, 0.425, 0.85]
  return tiers.map((tier, index) => {
    const minLateral = boundaries[index]!
    const maxLateral = boundaries[index + 1]!
    const centerLateral = (minLateral + maxLateral) / 2
    const config = BOOST_TIER_CONFIG[tier]
    return {
      id: `${gateId}-lane-${index + 1}`,
      tier,
      minLateral,
      maxLateral,
      centerLateral,
      speedMultiplier: config.speedMultiplier,
      durationSeconds: config.durationSeconds,
      colorHex: config.colorHex,
      colorName: config.colorName,
      label: config.label,
    }
  })
}

export function createRiverTrack(version = 'river-01-v2'): RaceTrack {
  const length = 4200
  const currents: CurrentZone[] = [
    { startProgress: 0.14, endProgress: 0.24, speedMultiplier: 1.035, lateralForce: 0.05 },
    { startProgress: 0.42, endProgress: 0.52, speedMultiplier: 0.97, lateralForce: -0.06 },
    { startProgress: 0.7, endProgress: 0.82, speedMultiplier: 1.045, lateralForce: 0.04 },
  ]
  const pickupOffsets = [-0.72, -0.36, 0, 0.36, 0.72]
  const pickupZones: PickupZone[] = [0.2, 0.42, 0.64, 0.82].map((center, zoneIndex) => ({
    id: `pickup-zone-${zoneIndex + 1}`,
    startProgress: center - 0.025,
    endProgress: center + 0.025,
    spawnRatio: 0.85,
    allowedTypes: ['QUACK_BOX', 'GOLDEN_BOX'],
    candidateAnchors: pickupOffsets.map((lateralOffset, anchorIndex) => ({
      id: `z${zoneIndex + 1}-a${anchorIndex + 1}`,
      lateralOffset,
      progressOffset: ((anchorIndex % 2) * 2 - 1) * 0.006,
    })),
  }))
  const hazardZones: HazardZone[] = [
    { id: 'hazard-zone-a', anchors: [
      { id: 'hz-a1', progress: 0.31, lateralOffset: -0.48, radius: 0.13 },
      { id: 'hz-a2', progress: 0.34, lateralOffset: 0.42, radius: 0.14 },
    ], allowedTypes: ['ANCHOR', 'ICE_PATCH', 'STICKY_GOO'] },
    { id: 'hazard-zone-b', anchors: [
      { id: 'hz-b1', progress: 0.54, lateralOffset: -0.3, radius: 0.14 },
      { id: 'hz-b2', progress: 0.57, lateralOffset: 0.5, radius: 0.13 },
    ], allowedTypes: ['WHIRLPOOL', 'ICE_PATCH', 'STICKY_GOO'] },
    { id: 'hazard-zone-c', anchors: [
      { id: 'hz-c1', progress: 0.73, lateralOffset: -0.52, radius: 0.13 },
      { id: 'hz-c2', progress: 0.76, lateralOffset: 0.28, radius: 0.14 },
    ], allowedTypes: ['ANCHOR', 'WHIRLPOOL', 'STICKY_GOO'] },
  ]

  const boostGates: BoostGate[] = [
    {
      id: 'boost-gate-1',
      progress: 0.26,
      lanes: createBoostLanes('bg-1', ['HYPER', 'SUPER', 'STANDARD', 'NEUTRAL']),
    },
    {
      id: 'boost-gate-2',
      progress: 0.48,
      lanes: createBoostLanes('bg-2', ['STANDARD', 'HYPER', 'NEUTRAL', 'SUPER']),
    },
    {
      id: 'boost-gate-3',
      progress: 0.68,
      lanes: createBoostLanes('bg-3', ['NEUTRAL', 'STANDARD', 'SUPER', 'HYPER']),
    },
    {
      id: 'boost-gate-4',
      progress: 0.85,
      lanes: createBoostLanes('bg-4', ['SUPER', 'HYPER', 'STANDARD', 'NEUTRAL']),
    },
  ]

  return {
    version,
    length,
    currents,
    pickupZones,
    hazardZones,
    boostGates,
    pickupLayoutVersion: 'river-pickups-v1',
    sample(progress, lateralOffset) {
      const p = clamp(progress, 0, 1)
      const centerX = p * length
      const centerY = 270 * Math.sin(p * Math.PI * 2.25) + 125 * Math.sin(p * Math.PI * 5.1 + 0.7)
      const derivativeX = length
      const derivativeY = 270 * Math.PI * 2.25 * Math.cos(p * Math.PI * 2.25)
        + 125 * Math.PI * 5.1 * Math.cos(p * Math.PI * 5.1 + 0.7)
      const magnitude = Math.hypot(derivativeX, derivativeY)
      const tangentX = derivativeX / magnitude
      const tangentY = derivativeY / magnitude
      const normalX = -tangentY
      const normalY = tangentX
      const width = 310 + 45 * Math.sin(p * Math.PI * 3.7 + 0.4)
      const offset = clamp(lateralOffset, -1, 1) * width * 0.42

      return {
        x: centerX + normalX * offset,
        y: centerY + normalY * offset,
        tangentX,
        tangentY,
        width,
      }
    },
  }
}

export function currentAt(track: RaceTrack, progress: number) {
  return track.currents.find((zone) => progress >= zone.startProgress && progress <= zone.endProgress) ?? null
}
