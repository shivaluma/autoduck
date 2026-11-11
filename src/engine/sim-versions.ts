/**
 * The version fields the browser engine (src/engine/sim.ts, the frozen TS engine until Phase 5) implements.
 * A stored race can be re-simulated locally only when its config carries this engine/balance pair
 * (src/race/replay-plan.ts).
 *
 * Kept apart from sim.ts so pages that only need the versions (the race page's replay plan) don't pull the
 * engine and Zod into their chunk. The values are packages/race-protocol's constants;
 * tests/engine-seam-catalog.test.ts checks they still match.
 */
export const SIM_VERSIONS = {
  protocolVersion: '1.0.0',
  engineVersion: '1.2.0',
  balanceVersion: 'S3.15',
  trackVersion: 'river-01-v2',
  pickupSpawnVersion: 'pickups-v1',
  wildItemBalanceVersion: 'wild-items-v6',
  hazardBalanceVersion: 'hazards-v1',
  tickRate: 60,
} as const
