# Đua Dzịt Racing Engine — implementation map

## Existing systems to keep

- `Season`, `SeasonWeek`, `SeasonPlayer`: Season 3 lifecycle and standings.
- `SeasonPrediction`: private prediction and reward points.
- `SeasonShieldChoice`: Season Shield confirmation after Chaos resolution.
- `crates/server/src/season3`: Season meta adapter over the standalone Chaos plugins.
- personal `accessToken`: magic-link authorization.
- SPA pages and admin authentication via `RACE_SECRET_KEY`.

## Architecture (Rust engine 2.x)

- `crates/race-core`: pure deterministic fixed-step simulation, track, collision, items, Chaos, DTRK recorder, stats.
- `crates/race-protocol`: versioned wire types and version constants shared by server and browser (ts-rs bindings).
- `crates/race-wasm`: the same engine for the browser (live prediction, race lab).
- `crates/server`: seed commitment, persistence, state machine, live runtime (SSE) and Season meta.
- `components/racing`: isolated Phaser canvas and spectator HUD; React never owns the frame loop.
- `crates/race-cli`: headless balance modes, fuzz, golden digests and determinism pins.

## Integration sequence

1. Build and statistically validate the item-free deterministic core.
2. Persist immutable race configuration, seed commitment, versions, snapshots and events.
3. Replace the external Playwright race for Season 3 with the authoritative local runtime.
4. Add Phaser rendering and replay from the same protocol.
5. Add Prep Credits/loadouts to the existing personal token page and host readiness screen.
6. Add the six launch items behind central interaction rules and balance config.
7. Move Chaos to plugins while preserving existing Season Scar/Shield outcomes.
8. Add 100k balance tooling, race lab, telemetry, VFX/SFX and production hardening.

All eight slices are implemented. Acceptance remains tied to automated tests, production build, the 100k simulation run, replay verification, and browser QA.

## Persistence additions

Race stores engine/balance/track/protocol versions, seed commitment, revealed seed, immutable config, result digest, lifecycle state, and a durable live snapshot. Race events are append-only during the race. Weekly loadouts are owned by `SeasonPlayer` and become immutable when preparation locks. Official item telemetry stores same-seed no-item rank deltas; test races are excluded.

## Hard boundaries

- Race core returns raw standings only.
- Chaos accepts raw standings and returns a variable-length loser list.
- Season meta alone applies Scar and Season Shield.
- Bubble Shield and every other race item exist only inside one race simulation.

## TS engine 1.x, retired

The first engine was TypeScript (`packages/race-core`, `packages/race-protocol` with Zod schemas, `lib/racing/*`
server adapters, `lib/season3*.ts`, `scripts/race-*` and the balance worker pool). It ran every race up to engine
`1.2.0` / balance `S3.15`, was frozen at the rewrite branch cut (plan D28), served as the parity oracle for the Rust
port (gates G1 meta/trace parity and G3 balance), and was deleted in plan Phase 9 together with Prisma and the
Next.js server. The last tree that has it is git tag `ts-engine-final`.

What survives from it:

- **Old races** replay from stored DTRK/1 tracks (`RaceReplayTrack`), never by re-simulation. Races from before live
  recording were backfilled offline by re-running the historical TS commits (`artifacts/replay-tracks/`,
  `docs/replay-tracks.md`).
- **Wire shapes**: the browser's protocol types (`src/engine/protocol-types.ts`) are the TS schemas' output types.
- **TS-compat code in the Rust engine** (`ts-compat` and `s3-15-config` features, `js_math`, `collate_compat`, their
  tests and the `tsCompat` pinned digests): it modelled V8 maths and ICU collation for the oracle diff. It stays
  because the engine sources are hashed into `ENGINE_BUILD_ID`, and removing it would change the id that live
  clients are matched against (and that tracks record as `engineBuild`). It is never enabled in shipped builds.
