# `lib/**` classification (plan step 0.5, D18)

Every file under `lib/` is classified by who runs it:

- **server**: route handlers, Season meta, persistence and the TS engine adapters. These are deleted or ported to Rust in
  Phases 8 and 9.
- **shared**: plain data and helpers that both the browser and the server (or scripts) import. They stay in TS.
- **client**: browser-only. As of 0.5 none are left in `lib/`; they were `git mv`'d into `src/`.

Browser code (`src/`, `components/`, `'use client'` pages) reaches the engine only through the seams in
`src/engine/{catalog,protocol,sim}.ts`. The CI job `client-boundary` enforces this.

## Moved to `src/` in 0.5

| From | To | Why |
|---|---|---|
| `lib/season3-rules-content.ts` | `src/season3/season3-rules-content.ts` | Rules page copy (reads catalogs through `src/engine/catalog`) |
| `lib/season3-test-mode.ts` | `src/season3/season3-test-mode.ts` | Admin page and the race orchestrator share it; it has no server dependency |
| `lib/racing/combat-encounters.ts` | `src/race/combat-encounters.ts` | Combat panel over stored events |
| `lib/racing/ai-intent-copy.ts` | `src/race/ai-intent-copy.ts` | Timeline and canvas copy |
| `lib/racing/loadout-guide.ts` | `src/race/loadout-guide.ts` | Loadout picker hints |
| `lib/racing/post-race-stats.ts` (render half) | `src/race/post-race-stats.ts` | Event aggregation and types. The engine half (motion, no-items baseline) is in `src/race/post-race-engine.ts` via the sim seam. The server entry point `lib/racing/post-race-stats.ts` combines them for `statsJson`. |
| `lib/racing/replay-track/{decode,format}.ts` | `src/race/replay-track/{decode,format}.ts` | DTRK/1 decoder and constants used by the browser. `lib/racing/replay-track/{encode,recorder,store}.ts` import them from there. |

New browser modules: `src/race/{types,event-vocab,polyline-track,replay-plan,post-race-engine}.ts` and `src/engine/*`.

## Classification

| File | Class | Notes |
|---|---|---|
| `lib/auth/admin-secret.ts` | server | Admin secret check (D24) |
| `lib/auth/google.ts` | server | Google ID token verification (`jose`) |
| `lib/cosmetics/avatar-rig.ts` | shared (tooling) | SVG rig used by `scripts/cosmetics/*` and generators only |
| `lib/cosmetics/catalog.ts` | shared | Cosmetic catalog: canvas, closet and pages in the browser; shop, gacha and migrations on the server. Source for the D19 export. |
| `lib/cosmetics/define.ts` | shared | Catalog helper |
| `lib/cosmetics/sets/*.ts` | shared | Catalog data (sets) |
| `lib/cosmetics/types.ts` | shared | Cosmetic types and layer constants (canvas, closet) |
| `lib/cosmetics/economy.ts` | server | Quack ledger (`applyQuackTransaction`), reward tables |
| `lib/cosmetics/gacha.ts` | server | Gacha rolls |
| `lib/cosmetics/inventory.ts` | server | Inventory and appearance validation |
| `lib/cosmetics/shop.ts` | server | Daily shop rotation |
| `lib/cosmetics/legacy.ts` | server | Legacy id remaps (migrations, D19 export) |
| `lib/cosmetics/legacy-v1.ts` | server | Frozen v1 catalog for remap tests |
| `lib/db.ts` | server | Prisma client |
| `lib/event-bus.ts` | server | In-process race event bus (SSE) |
| `lib/ghost-duck.ts` | shared | Ghost-duck name check (Season page and race API) |
| `lib/immortal-duck.ts` | server | Race API flag |
| `lib/race-fx/manifest.ts` | shared | FX/icon manifest: canvas and pages; `scripts/race-fx` bakes it |
| `lib/race-fx/themes.ts` | shared | Canvas themes (browser), race-lab |
| `lib/racing/audit.ts` | server | Seed commit and result digest (`node:crypto`). Frozen. |
| `lib/racing/golden-reward.ts` | server | Golden-box QP reward |
| `lib/racing/live-race-session.ts` | server | In-memory live session (wild-item inputs) |
| `lib/racing/loadout.ts` | server | Loadout parse/serialise and auto loadouts |
| `lib/racing/persistence.ts` | server | Event rows, config parse, digest columns. Frozen. |
| `lib/racing/pickup-telemetry.ts` | server | Pickups-off counterfactual (engine version guard applies) |
| `lib/racing/post-race-stats.ts` | server | `buildPostRaceStats` for `statsJson` (aggregation from `src/race`) |
| `lib/racing/public-engine.ts` | server | Which config/seed a race page may see |
| `lib/racing/replay-track/encode.ts` | server | DTRK/1 encoder and gzip (`node:zlib`, `node:crypto`) |
| `lib/racing/replay-track/recorder.ts` | server | Live recorder (runs in the tick loop) |
| `lib/racing/replay-track/serve.ts` | server | `GET /api/races/:id/track` response (§4.6) |
| `lib/racing/replay-track/store.ts` | server | Finalize, self-check and insert `RaceReplayTrack` |
| `lib/racing/replay.ts` | server | Digest replay for allowlisted versions (`scripts/race-replay`) |
| `lib/racing/runtime.ts` | server | Authoritative tick loop. Frozen. |
| `lib/racing/state-machine.ts` | server | Race lifecycle transitions |
| `lib/racing/telemetry.ts` | server | Item counterfactual telemetry (engine version guard applies) |
| `lib/racing/track-geometry.ts` | server | HEAD track geometry export and content address (`pnpm race:tracks`) |
| `lib/season3-race-mapping.ts` | server | Standings → Season ranking |
| `lib/season3-race.ts` | server | Race orchestration |
| `lib/season3-schedule.ts` | server | Monday gate |
| `lib/season3.ts` | server | Season meta (Chaos results, shields, King, predictions) |
| `lib/types.ts` | shared | API response types (`RaceStatus`); imports protocol types through `src/engine/protocol` |
| `lib/utils.ts` | shared | `cn()` class helper for UI |
