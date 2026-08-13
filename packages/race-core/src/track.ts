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

export interface RaceTrack {
  version: string
  length: number
  currents: CurrentZone[]
  sample(progress: number, lateralOffset: number): TrackPoint
}

const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value))

export function createRiverTrack(version = 'river-01-v1'): RaceTrack {
  const length = 4200
  const currents: CurrentZone[] = [
    { startProgress: 0.14, endProgress: 0.24, speedMultiplier: 1.035, lateralForce: 0.05 },
    { startProgress: 0.42, endProgress: 0.52, speedMultiplier: 0.97, lateralForce: -0.06 },
    { startProgress: 0.7, endProgress: 0.82, speedMultiplier: 1.045, lateralForce: 0.04 },
  ]

  return {
    version,
    length,
    currents,
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
