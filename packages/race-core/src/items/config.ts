export const ITEM_BALANCE = {
  hitImmunitySeconds: 1,
  rocketTargetProtectionSeconds: 2,
  bubblePopImmunitySeconds: 0.5,
  minimumSpeedMultiplier: 0.05,
  maximumSpeedMultiplier: 1.60,
  maxContinuousBoostSeconds: 2.6,
  nitro: {
    armProgress: 0.28,
    fallbackProgress: 0.68,
    triggerRank: 4,
    gapThreshold: 0.045,
    speedMultiplier: 1.25,
    durationSeconds: 1.80,
    ignitionSeconds: 0.18,
    overdriveSeconds: 1.37,
    decaySeconds: 0.25,
  },
  draftFin: {
    armProgress: 0.20,
    maxGap: 0.045,
    lateralRadius: 0.20,
    holdSeconds: 0.75,
    speedMultiplier: 1.21,
    durationSeconds: 1.6,
  },
  paddleBurst: {
    armProgress: 0.65,
    speedMultiplier: 1.15,
    durationSeconds: 1.8,
  },
  // Slow distance budget: 0.88 * 0.95 + 0.50 * 0.65 = 1.161 base-speed seconds.
  rocket: {
    armProgress: 0.25,
    disableProgress: 0.98,
    maximumTargetDistance: 0.32,
    endGameTargetDistanceMultiplier: 1.8,
    projectileSpeed: 0.26,
    lifetimeSeconds: 3.5,
    hitRadius: 0.018,
    armingTicks: 2,
    staggerMultiplier: 0.12,
    staggerDurationSeconds: 0.95,
    recoverySlowMultiplier: 0.50,
    recoveryDurationSeconds: 0.65,
    slowMultiplier: 0.15,
    slowDurationSeconds: 1.50,
  },
  shockAbsorber: {
    staggerMultiplier: 0.40,
    staggerDurationSeconds: 0.30,
    recoverySlowMultiplier: 0.80,
    recoveryDurationSeconds: 0.30,
    slowMultiplier: 0.50,
    slowDurationSeconds: 0.55,
    hornPushMultiplier: 0.4,
    hornShoveMultiplier: 0.4,
  },
  banana: {
    armProgress: 0.2,
    fallbackProgress: 0.55,
    // How far sideways a banana can be tossed from the dropper's own lane.
    aimMaxOffset: 0.22,
    endGameDropProgress: 0.72,
    closeBehindDistance: 0.085,
    lifetimeSeconds: 14,
    dropBehindProgress: 0.012,
    armingSeconds: 0.2,
    hitProgressRadius: 0.02,
    hitLateralRadius: 0.32,
    minimumTrapSpacing: 0.015,
    lateralSlip: 0.65,
    staggerMultiplier: 0.15,
    staggerDurationSeconds: 0.85,
    recoverySlowMultiplier: 0.60,
    recoveryDurationSeconds: 0.70,
    slowMultiplier: 0.25,
    slowDurationSeconds: 1.20,
  },
  horn: {
    armProgress: 0.22,
    progressRadius: 0.055,
    lateralRadius: 0.40,
    // Directional blast: everything on the chosen side up to sideReach, plus a narrow centre band.
    sideReach: 0.55,
    centerBand: 0.08,
    lateralPush: 1.20,
    lateralShove: 0.25,
    fallbackProgress: 0.76,
    silenceDurationSeconds: 0.5,
    // Starts after silence expires; other horns cannot refresh either window.
    silenceRecoverySeconds: 2.0,
  },
  // An unspent Feather turns into a glide for the final sprint.
  feather: {
    glideProgress: 0.88,
    glideMultiplier: 1.04,
    glideDurationSeconds: 1.0,
  },
  bubbleShield: {
    durationSeconds: 4.5,
    endGameBurnProgress: 0.90,
    // SPEED > DEFENSE: a packed bubble is bulky; the duck swims this much slower until it is spent.
    packedDragMultiplier: 0.995,
    burstMultiplier: 1.08,
    burstDurationSeconds: 1.2,
  },
  menace: {
    predatorRushMultiplier: 1.10,
    predatorRushDurationSeconds: 1.0,
  },
  fortress: {
    surgeMultiplier: 1.08,
    surgeDurationSeconds: 1.2,
    collisionPushMultiplier: 0.8,
    collisionSpeedLossMultiplier: 0.8,
  },
  // Class counter loop: DEFENSE > ATTACK > SPEED > DEFENSE.
  counter: {
    // ATTACK > SPEED: a prep attack that breaks a speed-item boost steals its momentum.
    momentumStealMultiplier: 1.20,
    momentumStealSeconds: 2.3,
    // Horn blasts several ducks at once, so its steal is shorter.
    hornMomentumStealSeconds: 1.5,
    // When the stolen momentum is an unspent speed item, its next boost runs this fraction of its duration.
    speedDrainDurationRatio: 0.5,
    // DEFENSE > ATTACK: a prep block/dodge/absorb converts the hit into a guard surge.
    guardSurge: {
      BUBBLE_SHIELD: { multiplier: 1.08, durationSeconds: 1.0 },
      FEATHER: { multiplier: 1.15, durationSeconds: 1.8 },
      SHOCK_ABSORBER: { multiplier: 1.06, durationSeconds: 0.8 },
    },
  },
  autoUse: {
    endGameBurnProgress: 0.78,
    forceBurnProgress: 0.92,
  },
} as const
