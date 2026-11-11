/**
 * Entry point of the HEAD bundle the resolver's workers load (plan §4.4): the DTRK/1 recorder and encoder,
 * the geometry export and the canonical JSON. `resolve-historical.ts` bundles this file with esbuild into
 * `.cache/engines/_head/<hash>/dtrk.mjs`, so a worker isolated to a historical commit's extraction directory
 * records with HEAD's format while simulating with that commit's engine.
 */
export { createReplayTrackRecorder, type ReplayRecorderWorld } from '../../lib/racing/replay-track/recorder'
export { encodeReplayTrack, packReplayTrack } from '../../lib/racing/replay-track/encode'
export { exportTrackGeometryFromTrack, serializeTrackGeometry } from '../../lib/racing/track-geometry'
export { canonicalHeaderJson } from '../../src/race/replay-track/format'
