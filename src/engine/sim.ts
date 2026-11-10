/**
 * Browser seam for the deterministic race simulation (plan D18).
 *
 * On main the browser re-simulates with the TS engine (live view, current-version replays without a
 * recorded track, /dev/race-lab). On the `rewrite` branch this module is backed by the WASM build of
 * race-core. Browser code must not import packages/race-core directly (CI job `client-boundary`).
 */
export {
  createSimulation,
  queueWildItemInput,
  resultFromSimulation,
  simulateRace,
  snapshotRaceWorld,
  stepSimulation,
  type RaceSimulationState,
  type SimulationOptions,
} from '@/packages/race-core/src/simulation'
export { createRiverTrack, type BoostGate, type HazardZone, type PickupZone, type RaceTrack, type TrackPoint } from '@/packages/race-core/src/track'
