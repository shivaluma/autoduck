# Đua Dzịt Racing Engine — implementation map

## Existing systems to keep

- `Season`, `SeasonWeek`, `SeasonPlayer`: Season 3 lifecycle and standings.
- `SeasonPrediction`: private prediction and reward points.
- `SeasonShieldChoice`: Season Shield confirmation after Chaos resolution.
- `lib/season3.ts`: current Chaos and Season meta resolver while plugins are introduced.
- personal `accessToken`: magic-link authorization.
- Next.js pages and admin authentication via `RACE_SECRET_KEY`.

## New architecture inside this repository

- `packages/race-core`: pure deterministic fixed-step simulation, track, collision, items, replay.
- `packages/race-protocol`: versioned Zod schemas shared by server and browser.
- `lib/racing`: server-only seed, commit, persistence, state machine and runtime adapters.
- `components/racing`: isolated Phaser canvas and spectator HUD; React never owns the frame loop.
- `scripts/race-*`: headless simulation, replay and profiling commands.

## Integration sequence

1. Build and statistically validate the item-free deterministic core.
2. Persist immutable race configuration, seed commitment, versions, snapshots and events.
3. Replace the external Playwright race for Season 3 with the authoritative local runtime.
4. Add Phaser rendering and replay from the same protocol.
5. Add Prep Credits/loadouts to the existing personal token page and host readiness screen.
6. Add the six launch items behind central interaction rules and balance config.
7. Move Chaos to plugins while preserving existing Season Scar/Shield outcomes.
8. Add 100k balance tooling, race lab, telemetry, VFX/SFX and production hardening.

## Persistence additions

Race stores engine/balance/track/protocol versions, seed commitment, revealed seed, immutable config, result digest and lifecycle state. Race events are append-only. Weekly loadouts are owned by `SeasonPlayer` and become immutable when preparation locks.

## Hard boundaries

- Race core returns raw standings only.
- Chaos accepts raw standings and returns a variable-length loser list.
- Season meta alone applies Scar and Season Shield.
- Bubble Shield and every other race item exist only inside one race simulation.
