# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

AutoDuck / "ĐUA DZỊT" is a weekly office duck race with Season 3 meta-game systems (Season Shields, scars, Chaos cards, predictions, cosmetics/gacha). Production is the **Rust server** (`crates/server`, binary `autoduck`, axum + sqlx over one SQLite file) serving the **Vite SPA** (React 19, Tailwind 4, shadcn/radix UI; `index.html`, `src/`, `components/`). The race engine is `crates/race-core`: native on the server, WASM in the browser (`crates/race-wasm`). The TS engine, the Next.js app and Prisma are retired (git tag `ts-engine-final`; the last TS production image is tag `ts-final`). Much UI copy and many docs are in Vietnamese. History and decisions: `docs/rewrite-plan.md` (D-numbers) and `docs/rewrite/`.

## Tooling rules (also in `.cursor/rules`)

- **pnpm only** (never npm/yarn/bun). **cargo** for Rust; the toolchain is pinned in `rust-toolchain.toml`.
- The user's shell is **fish**: set env vars with `env KEY=value cmd` or `set -x KEY value`, never `export` or inline `KEY=value cmd`.
- sqlx macros read the committed `.sqlx/` data: run cargo with `env SQLX_OFFLINE=true`. After changing a query, regenerate it with `cargo sqlx prepare --workspace` against a dev DB.
- Build the server with `-p autoduck-server`, never `--workspace --all-features`: feature unification would turn on `race-core/ts-compat` and change `ENGINE_BUILD_ID`.

## Operating rules (D28)

- **Pushes to `main` are production releases.** Never push a deploy-triggering change to `main` on a Monday (ICT, UTC+7): the weekly race runs then. Commit and push on Tuesday instead. Treat every push to `main` as deploy-triggering, docs- and CI-only commits included.
- Deploys are **manual through the Dokploy MCP** (the Dokploy webhook is broken). Back up the DB first (`autoduck backup --force` in the container). Dokploy builds `./Dockerfile` from `main` with replicas 1 and **stop-first** updates, stop grace period ≥ 150 s (D21: the server holds an exclusive lock on `/app/data/autoduck.lock`).
- Never force-push shared branches.

## Layout

```
crates/race-protocol   wire types, configs, version constants (src/versions.rs), ts-rs bindings
crates/race-core       deterministic engine: sim, track, items, pickups, auto-use AI, Chaos, DTRK recorder, post-race stats
crates/race-wasm       browser engine (scripts/build-wasm.sh -> crates/race-wasm/pkg, run in a Web Worker)
crates/race-cli        native tooling (commands below)
crates/server          `autoduck`: HTTP API, live races (SSE), Season 3 meta, cosmetics, boot guards
src/                   SPA: router, pages, src/engine (WASM seam, protocol types, generated catalog/versions), src/race
components/            UI and the Phaser race canvas (components/racing; React never owns the frame loop)
lib/cosmetics, lib/race-fx   TS cosmetic catalog and race-fx manifest (sources for the generators and the SPA)
scripts/               cosmetics and race-fx generators, export-catalog, build-wasm, bundle check, dev runner
```

The engine must stay deterministic: no wall clock, no OS randomness, `libm` maths only; all randomness comes from the seed. Clippy's `disallowed_*` lists (`clippy.toml`) enforce it.

## Commands

```fish
pnpm install
pnpm dev                     # Rust API on :3000 (AUTODUCK_ENV=dev, prisma/dev.db) + Vite on :5173; open http://localhost:5173
pnpm dev:api | dev:web       # one of the two
pnpm build                   # wasm engine + tsc + vite build -> dist/
pnpm lint | test | check:bundle
pnpm cosmetics:generate | cosmetics:validate | cosmetics:export-catalog [--check] | race:fx | gacha:simulate | economy:simulate
pnpm codegen:engine          # race-cli codegen -> src/engine/generated/{catalog,versions}.json

env SQLX_OFFLINE=true cargo test --workspace
env SQLX_OFFLINE=true cargo clippy --workspace --all-targets -- -D warnings   # CI also runs it with --all-features
cargo fmt --all --check
node scripts/ci/wasm-determinism.mjs   # after pnpm build:wasm: the shipped package reproduces the 42 pinned digests

cargo run -p race-cli --release -- build-id          # ENGINE_BUILD_ID; must equal the wasm engineBuildId()
cargo run -p race-cli --release -- golden check      # frozen digests per version (CI golden-version)
cargo run -p race-cli --release -- golden freeze     # after a version bump only; never rewrites a frozen digest
cargo run -p race-cli --release -- corpus pin --check
cargo run -p race-cli --release -- fuzz --cases 2000 [--adversarial]
cargo run -p race-cli --release -- balance mixed|matrix|wild|run|compare ...   # see docs/balance/README.md

docker build -t autoduck .   # production image
```

`autoduck` subcommands (in the container, or `cargo run -p autoduck-server --bin autoduck -- <cmd>`): `serve`, `verify-db` and `check-schema` (read-only), `backup [--force]`, `healthcheck`, `seed` (empty DB only).

## Database

- One SQLite file: `DATABASE_URL` (`file:/app/data/autoduck.db` in production; `prisma/dev.db`, gitignored, in dev). The server runs in **compat mode** (`AUTODUCK_SCHEMA_MODE=compat`): no DDL, no `rs-*` migration rows. The schema baseline is `crates/server/migrations/0001_baseline.sql`. Schema changes wait for owned mode (plan Phase 9 step 2: the `rs-ponr` marker row plus `AUTODUCK_SCHEMA_MODE=owned`), after which the DB is owned by `crates/server/migrations` (`rs-NNNN-*` ids recorded in `AppMigration`).
- `crates/server/data/required-ts-migrations.json` is a frozen list of TS-era migration ids the DB must hold.
- **Boot guards, in order** (`crates/server/src/boot`): exclusive lock; refuse a missing DB file; refuse an empty DB unless `AUTODUCK_ALLOW_EMPTY_DB=1`; staging sentinel both ways; **backup** (`VACUUM INTO $AUTODUCK_BACKUP_DIR/boot-<ts>.db`, skipped when one is younger than 6 h or free space is under 3× the DB, keeps 10, never fails the boot); `integrity_check` (fatal); schema verifier (fatal only on missing tables/columns Rust queries); required migration ids; replay-track manifest check (read-only); crash recovery of interrupted races.
- Never copy a live DB with `cp`: use `sqlite3 <db> ".backup <file>"` or `autoduck backup`.
- New dev DB: `sqlite3 prisma/dev.db < crates/server/migrations/0001_baseline.sql`, then `env AUTODUCK_ENV=dev SQLX_OFFLINE=true cargo run -p autoduck-server --bin autoduck -- seed`.

## Races, replays and versions

- Official races persist the immutable config, seed commitment, engine/balance/track versions, event stream and result digest. A live race runs on a server driver thread and streams over SSE; the browser predicts it with the WASM engine only when `hello.engineBuildId` equals its own `engineBuildId()`, otherwise it plays server snapshots.
- **Replay model:** every race stores a DTRK/1 track (`RaceReplayTrack`, written by the Rust recorder at resolve). The viewer plays stored tracks and never re-simulates old races, so engine changes can't break old replays. TS-era races were backfilled from `artifacts/replay-tracks/`; keep it and the `public/race-tracks/` geometry files forever. Details: `docs/replay-tracks.md`.
- **Golden-digest rule:** any change to engine output needs a bump of `RACE_BALANCE_VERSION` or `RACE_ENGINE_VERSION` (`crates/race-protocol/src/versions.rs`) and a new frozen entry via `race-cli golden freeze`; `golden check` fails otherwise, and also when `rust-toolchain.toml` changes until it is re-frozen with matching digests. `ENGINE_BUILD_ID` hashes the engine sources, the engine Cargo files, the engine's lockfile graph and the compiler, so any edit under `crates/race-core` or `crates/race-protocol/src` changes it (open live views then fall back to snapshots).
- The engine's `ts-compat` / `s3-15-config` features, `js_math` and `collate_compat` remain only because deleting them would change `ENGINE_BUILD_ID`. Never enable them in shipped builds.

Hard boundaries (`docs/racing-engine-plan.md`): race core returns raw standings only. Chaos takes raw standings and returns a variable-length loser list. Only Season meta applies Scar/Season Shield. Race items exist only inside one simulation. The Season 3 champion is computed from `championshipPoints` and race wins; prediction points never affect championship ranking.

Pages: `/season-3?token=<personal-token>` (player, magic-link `accessToken`), `/admin/season-3` and `/dev/race-lab` (gated by `RACE_SECRET_KEY` via `?secret=`, the `x-race-secret` header, or `body.secret`). Old v2 URLs are redirects in `src/router.tsx`; the v2 tables stay in the DB.

## Cosmetics

The catalog is `lib/cosmetics/catalog.ts`; hand-drawn SVG art is in `scripts/cosmetics/art/<slot>.ts` (one function per ID). After editing either: `pnpm cosmetics:generate && pnpm cosmetics:validate`, then `pnpm cosmetics:export-catalog` (the server embeds `crates/server/data/cosmetic-{catalog,legacy}.json`; CI runs it with `--check`). Assets in `public/cosmetics/v2` are generated; never hand-edit them. **Retiring or renaming an owned ID:** add it to `lib/cosmetics/legacy.ts` → `pnpm cosmetics:export-catalog` → a server data migration (`rs-NNNN-*`, owned mode) that rewrites the owned rows. Details: `docs/COSMETICS.md`.

## Race visuals

Race FX are hand-drawn SVG in `scripts/race-fx/art.ts`, listed in `lib/race-fx/manifest.ts` and baked to sprite sheets with `pnpm race:fx`. Preview at `/dev/race-fx`. Phaser glue: `components/racing/race-fx.ts`. Details: `docs/race-fx.md`.

Other docs: `docs/balance/README.md`, `docs/race-pickups.md`, `docs/COSMETIC_SIMULATION.md`, `docs/duck-avatar-art-system.md`.
