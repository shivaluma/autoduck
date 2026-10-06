export const AUTO_USE_CONFIG = {
  decisionIntervalTicks: 15,
  reactionDelayMinSeconds: 0.12,
  reactionDelayMaxSeconds: 0.28,
  reactiveThreatMinVisibleSeconds: 0.15,
  cooldownMinSeconds: 0.35,
  cooldownMaxSeconds: 0.55,
  bananaPredictionHorizonSeconds: 1,
  // Target score for an attack that would steal a speed duck's momentum.
  momentumStealValue: 8,
  brain: {
    // Max opportunity cost (score points) of firing a prep item long before its planned window.
    holdCostScale: 60,
    // Progress over which the hold cost ramps down to zero as the planned window approaches.
    holdRampProgress: 0.15,
    // Score shift for attacks per unit of aggression above/below neutral (0.5).
    aggressionScale: 8,
    // Bonus for speed/attack items when the duck is in a final-stretch duel for first.
    clutchDuelBonus: 20,
    // Bonus once the duck is stuck in the loser set late in the race.
    desperationBonus: 10,
    // Minimum ticks between two announced intents of one duck.
    intentCooldownTicks: 60,
    // Extra horn value for shoving a duck onto a live peel or hazard.
    shoveIntoTrapValue: 24,
  },
  thresholds: {
    early: 72,
    mid: 64,
    late: 54,
    finalStretch: 42,
  },
  progressMid: 0.45,
  progressLate: 0.75,
  progressFinal: 0.92,
  inventoryPressure: {
    under1s: 30,
    under2s: 20,
    under3_5s: 10,
  },
} as const
