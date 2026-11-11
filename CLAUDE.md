# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

AutoDuck / "ĐUA DZỊT" is a weekly office duck race with Season 3 meta-game systems (Season Shields, scars, Chaos cards, predictions, cosmetics/gacha). Since the Phase 8 cutover (`docs/rewrite-plan.md`) production is the **Rust server** in `crates/server` (binary `autoduck`, axum + sqlx over SQLite, in compat mode: the schema is still owned by `prisma/schema.prisma`) serving the **Vite SPA** (React 19, Tailwind 4, shadcn/radix UI; `index.html`, `src/`, `components/`). The race engine is `crates/race-core` (native on the server, WASM in the browser via `crates/race-wasm`). Next.js is gone. Much UI copy and many docs are in Vietnamese.

## Tooling rules (from `.cursor/rules`)

- Use **pnpm only** (never npm/yarn/bun).
- The user's shell is **fish**: for env vars use `env KEY=value cmd` or `set -x KEY value`, not `export` / inline `KEY=value cmd`.

## Operating rules (rewrite plan D28)

- **Pushes to `main` auto-deploy to production.** Never push a deploy-triggering change to `main` on a Monday (ICT, UTC+7): the weekly race runs then. Commit locally and push on Tuesday instead. Treat every push to `main` as deploy-triggering, docs- and CI-only commits included.
- Dokploy builds `./Dockerfile` (Rust server + SPA) from `main`. It needs replicas 1 and **stop-first** updates with a stop grace period of at least 150 s (D21: the server takes an exclusive lock on `/app/data/autoduck.lock`).
- **The TS engine is frozen** from the rewrite branch cut: `packages/race-*`, `lib/racing/{audit,persistence,runtime}.ts` and `lib/season3-race.ts`. Don't change them. The `engine-freeze` workflow fails PRs touching them unless they carry the `engine-hotfix` label; direct pushes aren't gated, so the rule is on you. A hotfix bumps `RACE_BALANCE_VERSION` and adds a Rust port item in the same change. Details: `docs/balance/README.md`.
- Files the Rust server embeds are generated from TS and checked in CI with `--check`: `pnpm cosmetics:export-catalog` (`crates/server/data/cosmetic-{catalog,legacy}.json`) after editing `lib/cosmetics/{catalog,legacy,legacy-v1}.ts`, and `pnpm db:export-migration-ids` (`crates/server/data/required-ts-migrations.json`) after adding an app migration.

## Commands

```fish
pnpm dev                 # db:bootstrap, then the Rust API on :3000 (AUTODUCK_ENV=dev) + Vite on :5173
pnpm dev:api | dev:web   # one of the two
pnpm build               # wasm engine + tsc + vite build -> dist/
env SQLX_OFFLINE=true cargo test --workspace
env SQLX_OFFLINE=true cargo clippy --workspace --all-targets -- -D warnings
docker build -t autoduck .   # production image
pnpm lint                # eslint (flat config)
pnpm test                # node:test via tsx over tests/**/*.test.ts
pnpm test:race           # tests/race-core.test.ts only
node --import tsx --test tests/season3.test.ts                       # single test file
node --import tsx --test --test-name-pattern "replay" tests/race-core.test.ts   # single test by name

pnpm db:bootstrap        # scripts/auto-migrate.sh: prisma db push --accept-data-loss, then scripts/run-migrations.ts
pnpm db:migrate:app      # only the idempotent app migrations (recorded in AppMigration)
pnpm db:seed | pnpm db:studio

pnpm race:simulate --races 100000
pnpm race:simulate-balance --mode <mode> --seeds N --players 8 --workers N   # worker-pool balance sims (scripts/lib/balance-sim-*)
pnpm race:replay <raceId>
pnpm race:profile | race:profile-cpu | race:simulate-pickups | race:validate-pickups
pnpm cosmetics:generate | cosmetics:validate | gacha:simulate | economy:simulate
```

There is no `prisma/migrations` workflow: schema changes go into `prisma/schema.prisma` (synced by `db push`), and data backfills go into the migration list in `scripts/run-migrations.ts` (each must be idempotent and gets a unique id). The Prisma client is generated to `prisma/generated/prisma` (used by the TS tooling and tests only). The Rust server refuses to boot when a required app migration id is missing (`crates/server/data/required-ts-migrations.json`). DB defaults to `prisma/dev.db` when `DATABASE_URL` is unset.

## Architecture

The legacy v2 race (Playwright-driven browser game, AI commentary, video upload, and the shield/boss/chest/dragon meta) has been **removed**, along with its API routes and pages. Old URLs (`/rules`, `/race/:id`, `/race/new`, `/dragon`, `/members`, `/admin/dashboard`) are redirects in the SPA router (`src/router.tsx`). Its Prisma models are intentionally kept (data stays recoverable), and `GET /api/races/{id}` still returns the old legacy keys (`consumedChests`, `awardedChests`, `dragonAward`, `dragonScaleEvents`) as constant empty values. Historical app migrations that need v2 logic use the frozen copies in `scripts/migrations/legacy-helpers.ts`; don't reintroduce `lib/` imports for them.

**Season 3 race** — fully deterministic and authoritative on the server. Production runs the Rust port (`crates/race-core`, `crates/server/src/{live,season3}`); the TS engine below is the frozen oracle and stays until Phase 9:
  - `packages/race-core/src` — pure fixed-step simulation (`simulation.ts`, `track.ts`, seeded `rng.ts`), items (`items/`), wild pickups (`pickups/`), the AI item-use system (`auto-use/`: evaluate → arbiter → execute, with per-Chaos objectives in `objective.ts`), Chaos card plugins (`chaos/`), and ghost ducks. It must stay deterministic: no `Math.random`/`Date.now`, and all randomness comes from the seed.
  - `packages/race-protocol/src` — Zod schemas shared by server and browser, plus version constants (`RACE_ENGINE_VERSION`, `RACE_BALANCE_VERSION`, track/pickup/hazard versions, `RACE_TICK_RATE`).
  - These "packages" are **not** pnpm workspace packages. Import them by path (`@/packages/race-core/src`, or relative from tests/scripts).
  - `lib/racing/*` — server-only adapters: seed commitment and result digest (`audit.ts`), `runtime.ts` (`runAuthoritativeRace` tick loop with live snapshot callbacks), lifecycle `state-machine.ts`, `persistence.ts`, `replay.ts`, telemetry, loadouts, and the in-memory live session for wild-item inputs (`live-race-session.ts`).
  - `lib/season3*.ts` — season meta: `season3-race.ts` orchestrates an official or test race end to end; `season3.ts` applies Chaos results, Season Shields, King status, predictions and rewards.
  - `components/racing/*` — Phaser canvas and spectator HUD. React never owns the frame loop.
  - Pages: `/season-3?token=<personal-token>` (player, magic-link `accessToken`), `/admin/season-3` and `/dev/race-lab` (gated by `RACE_SECRET_KEY` via `?secret=`, the `x-race-secret` header, or `body.secret`).

Hard boundaries (`docs/racing-engine-plan.md`): race core returns raw standings only. Chaos takes raw standings and returns a variable-length loser list. Only Season meta applies Scar/Season Shield. Race items exist only inside one simulation. The Season 3 champion is computed from `championshipPoints` and race wins; prediction points never affect championship ranking.

### Versioning and balance changes

Official races persist the immutable config, seed commitment, engine/balance/track versions, event stream, result digest and telemetry. `lib/racing/replay.ts` refuses versions it doesn't support. Any change that alters simulation output needs a bump to `RACE_BALANCE_VERSION` (or the engine version), and the previous version pair stays in the replay allowlist only if it still replays identically. Balance work is documented in `docs/balance/<version>.md`, with raw outputs in `artifacts/balance-<version>/`. Compare treatments on identical seeds and lobbies (`scripts/balance-audit.ts`, `compare-balance-audit.ts`), not with `item-balance-comprehensive.ts`.

### Cosmetics

The catalog is in `lib/cosmetics/catalog.ts` and the hand-drawn SVG art in `scripts/cosmetics/art/<slot>.ts` (one function per ID). After editing either, run `pnpm cosmetics:generate && pnpm cosmetics:validate`. The validator rejects recolor duplicates and missing rarities. Assets in `public/cosmetics/v2` are generated; never hand-edit them. Retiring or renaming an owned ID needs an entry in `lib/cosmetics/legacy.ts` and an app migration. Details: `docs/COSMETICS.md`.

### Race visuals

Race FX (pickups, hazards, rockets, status overlays, event effects, icons) are hand-drawn SVG in `scripts/race-fx/art.ts`, listed in `lib/race-fx/manifest.ts` and baked to sprite sheets with `pnpm race:fx`. Preview them at `/dev/race-fx`. Phaser glue is in `components/racing/race-fx.ts`. Details: `docs/race-fx.md`.

Other docs: `docs/race-pickups.md`, `docs/COSMETICS.md`, `docs/COSMETIC_SIMULATION.md`, `docs/duck-avatar-art-system.md`.
