/**
 * Browser seam for the race wire protocol: types, Zod schemas and version constants (plan D18).
 *
 * On main this re-exports packages/race-protocol. On the `rewrite` branch it switches to types generated
 * from the Rust protocol crate. Browser code imports protocol types from here (CI job `client-boundary`).
 */
export * from '@/packages/race-protocol/src'
