export const AUTO_USE_CONFIG = {
  decisionIntervalTicks: 15,
  reactionDelayMinSeconds: 0.12,
  reactionDelayMaxSeconds: 0.28,
  cooldownMinSeconds: 0.35,
  cooldownMaxSeconds: 0.55,
  bananaPredictionHorizonSeconds: 1,
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
