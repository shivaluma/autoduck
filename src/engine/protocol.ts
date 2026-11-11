/**
 * Browser seam for the race wire protocol (plan D18).
 *
 * Version constants come from the Rust `race-protocol` crate through ./generated/versions.json
 * (`pnpm codegen:engine`). They describe the engine the Rust server stamps on new races.
 *
 * Wire types are type-only re-exports of the TS protocol: the Next API and the browser's TS engine
 * (src/engine/sim.ts) still produce that shape until Phase 5 switches the browser to WASM and the types
 * to the ts-rs output. A type-only re-export adds nothing to the bundle, so importing this module never
 * pulls Zod or an engine into a page. Browser code imports protocol types from here (CI job
 * `client-boundary`); the engine's own versions and config normalizer live in src/engine/sim.ts.
 */
import versions from './generated/versions.json'

export type * from '@/packages/race-protocol/src'

export const RACE_PROTOCOL_VERSION: string = versions.RACE_PROTOCOL_VERSION
export const RACE_ENGINE_VERSION: string = versions.RACE_ENGINE_VERSION
export const RACE_BALANCE_VERSION: string = versions.RACE_BALANCE_VERSION
export const RNG_VERSION: string = versions.RNG_VERSION
export const DIGEST_VERSION: string = versions.DIGEST_VERSION
export const TRACK_FORMAT: string = versions.TRACK_FORMAT
export const DEFAULT_TRACK_VERSION: string = versions.TRACK_VERSION
export const PICKUP_SPAWN_VERSION: string = versions.PICKUP_SPAWN_VERSION
export const HAZARD_BALANCE_VERSION: string = versions.HAZARD_BALANCE_VERSION
export const RACE_TICK_RATE: number = versions.RACE_TICK_RATE
export const SUPPORTED_BALANCE_VERSIONS: readonly string[] = versions.SUPPORTED_BALANCE_VERSIONS
