/**
 * Everything the race canvas needs from the browser engine (src/engine/sim.ts), in one module the canvas
 * imports on demand: a recorded replay with track geometry never loads the engine or Zod.
 */
export { createRiverTrack } from '@/src/engine/sim'
export { createSimDriver } from './sim-driver'
export { connectLiveDriver, createLiveDriver } from './live-driver'
