/**
 * Aimable items. Bananas can be tossed sideways onto a chaser's line; the Quack Horn blasts one side.
 * Callers without an aim (manual taps, legacy brains) get deterministic defaults.
 */

export type HornSide = -1 | 1

interface AimDuck {
  playerId: string
  progress: number
  lateralOffset: number
  finished: boolean
}

const clampLateral = (value: number) => Math.max(-0.95, Math.min(0.95, value))

/** Where a banana lands: the requested lane, limited to `maxOffset` from the dropper's own lane. */
export function aimedBananaLateral(dropperLateral: number, aimLateral: number | undefined, maxOffset: number) {
  if (aimLateral === undefined || !Number.isFinite(aimLateral)) return dropperLateral
  return clampLateral(dropperLateral + Math.max(-maxOffset, Math.min(maxOffset, aimLateral - dropperLateral)))
}

/** Ducks caught by a horn blasting toward `side`: everything in that half-plane plus a narrow band straight ahead/behind. */
export function hornSideTargets<T extends AimDuck>(
  horner: AimDuck,
  ducks: readonly T[],
  side: HornSide,
  progressRadius: number,
  sideReach: number,
  centerBand: number,
  isIgnored: (duck: T) => boolean = () => false,
): T[] {
  return ducks.filter((candidate) => {
    if (candidate.playerId === horner.playerId || candidate.finished || isIgnored(candidate)) return false
    if (Math.abs(candidate.progress - horner.progress) > progressRadius) return false
    const relative = (candidate.lateralOffset - horner.lateralOffset) * side
    return relative >= -centerBand && relative <= sideReach
  })
}

/** Default side for an unaimed horn: wherever more ducks are, ties toward the middle of the river. */
export function defaultHornSide<T extends AimDuck>(
  horner: AimDuck,
  ducks: readonly T[],
  progressRadius: number,
  sideReach: number,
  centerBand: number,
  isIgnored?: (duck: T) => boolean,
): HornSide {
  const left = hornSideTargets(horner, ducks, -1, progressRadius, sideReach, centerBand, isIgnored).length
  const right = hornSideTargets(horner, ducks, 1, progressRadius, sideReach, centerBand, isIgnored).length
  if (left !== right) return left > right ? -1 : 1
  return horner.lateralOffset > 0 ? -1 : 1
}
