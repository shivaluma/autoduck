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
  pickupLayoutVersion: string
  sample(progress: number, lateralOffset: number): TrackPoint
}

const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value))

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
    spawnRatio: 0.67,
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

  return {
    version,
    length,
    currents,
    pickupZones,
    hazardZones,
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
