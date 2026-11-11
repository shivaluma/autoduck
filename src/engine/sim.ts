/**
 * Browser seam for the deterministic race simulation (plan D18).
 *
 * Until Phase 5 the browser re-simulates with the TS engine (live view, current-version replays without a
 * recorded track, /dev/race-lab); Phase 5 backs this module with the WASM build of race-core. Browser code
 * must not import packages/race-core directly (CI job `client-boundary`). Only the race canvas and the
 * race lab import this module, so the engine never lands in the home or rules chunks.
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
/** Parses and fills in a config for the browser engine (Phase 5: WASM `normalizeConfig`). */
export { raceConfigSchema as simRaceConfigSchema } from '@/packages/race-protocol/src'

/** The engine/balance pair this engine implements (also importable alone, without the engine). */
export { SIM_VERSIONS } from './sim-versions'
