/**
 * Browser seam for the race wire protocol (plan D18).
 *
 * Version constants come from the Rust `race-protocol` crate through ./generated/versions.json
 * (`pnpm codegen:engine`). They describe the engine the Rust server stamps on new races.
 *
 * Wire types are plain TypeScript in ./protocol-types.ts (the shapes the retired TS protocol defined; the
 * Rust server and the WASM engine send the same JSON). A type-only re-export adds nothing to the bundle.
 * Browser code imports protocol types from here.
 */
import versions from './generated/versions.json'

export type * from './protocol-types'

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
