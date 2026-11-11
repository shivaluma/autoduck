# Phase 5 notes: WASM, live races, orchestration (branch `rewrite-live`)

Plan: `docs/rewrite-plan.md` §3 Phase 5, decisions D10, D16, D17, D21–D23.

`rewrite-live` is `rewrite` (Rust engine with the Phase 2 port and the Phase 6 fixes F1/F2, Rust server
Phase 3 A+B) merged with `rewrite-web` (Vite SPA, Phase 4), plus Phase 5 on top. The Rust server now runs
official and test races live end to end. The browser simulates them with the same engine compiled to
WASM. The TS engine is no longer used in the browser.

This phase was done as a **fast pass** for a pet project. The verification is unit and integration tests plus
one real end-to-end test race (see "Verification"). The heavier gates from the plan were skipped on purpose
(see "Skipped for speed").

## What exists

### Browser engine (`crates/race-wasm`, `src/engine/`)

- `crates/race-wasm/src/engine.rs` exports `engineInfo` (with `engineBuildId`), `normalizeConfig`,
  `simulate`, `verifyIntegrity`, `verifyResim` and `postRaceStats`, and the class `SimHandle` (`stepTo`,
  `drainEvents`, `queueInput`, `stateHash`, `trackPayload`). There is no checkpoint ring.
- `scripts/build-wasm.sh` builds with `-C panic=abort` and runs the `wasm-bindgen` CLI version pinned in
  `Cargo.lock` into `crates/race-wasm/pkg`, which git ignores.
- `src/engine/index.ts` is the only engine entry point for the browser. The `.wasm` is imported with Vite
  `?url`, so it is content-hashed, and it runs inside a Web Worker (`src/engine/sim-worker.ts`). The worker
  and the wasm load on first use only.
- The TS seam is gone: `src/engine/sim.ts` and `src/engine/sim-versions.ts` were deleted. Lint and the CI
  `client-boundary` step block imports of `packages/race-*` from browser code.

### Rust track recorder and stats (`crates/race-core`)

- `race_core::replay` has `RaceRun`, which steps the sim, folds finish ticks and motion, and drives the
  recorder. It also has the DTRK/1 `TrackRecorder` plus its encoder and decoder, and `track_def`.
- `race_core::stats` is the Rust `PostRaceStats`. The browser reaches it through `postRaceStats`.
- `RaceReplayTrack` rows written by Rust are `dtrk/1`, `LIVE_RUST`, `RECORDED`, `engineImpl = rust`, and
  record `engineBuild`.

### Server live core (`crates/server/src/live/`)

- **`mod.rs` (`LiveHub`):** the registry. It allows `MAX_LIVE_RACES = 3`. `start-race` reserves a slot before
  its claim transaction and calls `launch` after the commit. Shutdown follows D21: new races are refused and
  running races get up to 120 s. A panic in the async race task is caught; the race is then failed, its
  stream ends and the slot is freed.
- **`start.rs`:** the admin `start-race` action, all in one `BEGIN IMMEDIATE` transaction:
  - checks, then the Chaos preflight (a card that cannot resolve gets 409)
  - auto loadouts, the `Race` row and its participants
  - the week claim (`locked` → `racing`, official races only)
  - `COUNTDOWN` with `engineConfigJson` (JCS) and `seedCommit`
- **`race.rs`:** the per-race task, in this order:
  1. countdown (3 s), then COUNTDOWN → RACING (an official race re-checks its week claim)
  2. the driver thread
  3. **T1** (one transaction): engine events in 500-row chunks, raw ranks, digest and versions, the
     `RaceReplayTrack` row, then RACING → FINISHED
  4. **T2** (`resolve.rs`)
  5. stats and telemetry, best effort, in `spawn_blocking`

  Any failure before T2 commits sets `status = 'failed'` and returns an official week to `locked`. Only rows
  still `pending`/`running` are touched.
- **`driver.rs`:** one OS thread per race inside `catch_unwind`, paced with `sleep_until` at 60 Hz.
  - A `clock` frame every 3 ticks; every 60th tick it also carries the state hash.
  - Each new event goes out as an `engine-event` frame, to snapshot subscribers only.
  - A snapshot every 8 ticks.
  - A recording failure only logs; the race goes on without a track.
- **`resolve.rs`:** T2 reads only from the DB, in one transaction.
  - It is guarded by `engineState = 'FINISHED'`, so running it twice applies the meta once.
  - The live path and crash recovery call the same function.
- **`session.rs` and `sse.rs`:** SSE v2 (D16).
  - The session keeps every frame of the race in a log, and each subscriber copies everything newer than
    the last id it sent. A slow client therefore never gets `Lagged` and the stream is never dropped.
    `Last-Event-ID` resumes from the log.
  - Each connection starts with a `hello` frame with no id. It carries `engineBuildId`, the state,
    `serverTick` and `countdownEndsInMs`, plus `configJcs` once the race is RACING.
  - A race that is not live answers 204.
  - Headers: `text/event-stream`, `no-cache, no-transform`, `X-Accel-Buffering: no`. The server has no
    compression layer.
  - A `: keep-alive` comment goes out every 15 s.
- **`routes/races_live.rs`:**
  - `GET /api/races/:id/live` (`?snapshots=1` adds snapshots and engine events)
  - `POST /wild-item` → 410 (manual wild items are off)
  - `POST /desync` is logged and rate-limited
- **Crash recovery (`boot/recovery.rs`, D22):** only engine ≥ 2 rows that are `pending`/`running`.
  - LOCKED/COUNTDOWN/RACING: the race is marked `failed`, and the week goes back to `locked` if it is
    still `racing` on that race.
  - FINISHED: T2 runs from the DB. A refused result fails the race; a DB error leaves it FINISHED for the
    next boot.
  - TS-era rows are logged and never changed.
- **Race detail (D17):** for engine ≥ 2 rows, `engine.seed` and `engine.config` are revealed only from
  RACING on. `engine.players` is always present. `engine.liveTick` comes from the live session.

### SPA

- **`src/race/live-sync.ts`:** `ServerClock` and a pure `LiveSync`.
  - Bound: `min(estimated server tick − render delay, last clock + 6)`.
  - Keeps its own hash ring.
  - Ignores inputs with `seq <= seqHighWater`.
  - Catches up in chunks with FX suppressed.
- **`components/racing/drivers/live-driver.ts`:**
  - Uses the WASM engine only when `hello.engineBuildId` equals `engineInfo().engineBuildId`.
  - Otherwise, or on a hash mismatch (after a `/desync` POST), it reconnects with `?snapshots=1` and
    follows the `SnapshotDriver`.
- **`SimDriver`, race lab, replay plan, post-race stats panel:** all on the WASM engine.
- **Race view fix (`components/season3-race-view.tsx`):**
  - Bug: the API hides `engine.config` during COUNTDOWN, so the canvas was rebuilt at RACING and opened
    `/live` twice.
  - Fix: players come from `engine.config.players ?? engine.players`.

### Build and CI

- `pnpm build` = `scripts/build-wasm.sh --require-bindgen && pnpm build:web` (`tsc --noEmit` + `vite build`).
- **CI web job:** installs the pinned toolchain, `wasm32-unknown-unknown` and the pinned `wasm-bindgen`
  CLI, builds first, then runs `pnpm test`. `tests/wasm-engine.test.ts` loads the built package.
- **Dockerfile:**
  - A new `wasm` stage (`rust:1.99.1-slim-bookworm`, `wasm-bindgen-cli` 0.2.129) runs
    `build-wasm.sh --out-dir /out/pkg`.
  - The builder copies that output into `crates/race-wasm/pkg` and runs `pnpm build:web`.
  - The runner is still the Next standalone server until the Rust server replaces it.

## How to run

```fish
set -x PATH $HOME/.cargo/bin $PATH
env COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm@11.22.0 install
env COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm@11.22.0 build     # wasm + tsc + vite -> dist/

# Server on a COPY of a DB (never the original). The copy needs the current schema:
# run `pnpm db:bootstrap` against it once (RaceReplayTrack, SeasonWeek.previousRaceSeeds).
env SQLX_OFFLINE=true cargo build --release -p autoduck-server
env DATABASE_URL=file:/path/to/copy.db AUTODUCK_ENV=dev RACE_SECRET_KEY=<key> AUTODUCK_DIST_DIR=dist \
    HOST=127.0.0.1 PORT=3917 AUTODUCK_LOCK_PATH=/path/to/copy.lock AUTODUCK_BACKUP=0 \
    target/release/autoduck serve
```

A test race: `POST /api/admin/season3` with `{"action":"start-race","weekId":N,"test":true}` and the
`x-race-secret` header. Then open `/season-3/race/<id>`. A test race needs a week whose prep is open or
locked. On a DB where every week is resolved, open one first with the `open-week` action.

Tests:

```fish
env SQLX_OFFLINE=true cargo test --workspace          # includes live, recovery, races, determinism_pinned
node scripts/ci/wasm-determinism.mjs                  # native digests == wasm in Node on the pinned cases
env COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm@11.22.0 test   # includes live-sync and wasm-engine tests
```

Live server tests (`crates/server/tests/live.rs`) run unpaced with a short countdown, under
`tokio::time::pause` where timing matters. They cover:

- a full test race and an official race (T1 + T2 + week)
- SSE frames and `Last-Event-ID` resume
- limits, routes and shutdown
- a panicking sim leaves the race `failed`, the week `locked` and the server up
- both crash-recovery branches, including T2 idempotence (`tests/recovery.rs` keeps the D22 selection
  rules)

## Verification done (2026-11-11)

- **Gates:**
  - `cargo test --workspace`: 477 passed.
  - fmt and clippy `-D warnings`: clean.
  - `wasm-determinism.mjs`: 42/42 pinned digests match, with the same `engineBuildId` the server sends in
    `hello`.
  - `pnpm test`: 237/237.
  - `pnpm lint`: 0 errors.
  - `pnpm build` and `pnpm check:bundle`: pass.
- **End-to-end:** the release server plus the built SPA, on a `.backup` copy of the sanitized prod DB, with
  a test race watched in headless Chrome.
  - It went countdown → `hello` → `start` → about 1150 `clock` frames → `finished` → `resolved`.
  - It used the WASM LiveDriver: no snapshot fallback and no desync.
  - Afterwards the page fetched the replay track and replay played.
  - The DB afterwards:
    - The race is `finished`/`ARCHIVED`, with digest and `seedCommit` set.
    - One `RaceReplayTrack` row, where `reproducedDigest` equals `resultDigest`.
    - The week and every `SeasonPlayer` row are byte-identical to before.
- **Crash recovery:** a SIGKILL during RACING followed by a restart left the race `failed`, the week
  untouched and no track row. `/live` then answered 204.

## Skipped for speed (deliberately)

These are plan gates and deliverables that were left out. None of them affects correctness of a live race:
determinism is still pinned, and the server is authoritative.

- **Determinism matrix:**
  - no `wasm32-wasip1` + wasmtime run
  - no three-browser Playwright run
  - no ubuntu/macOS cross-host comparison
  - Only native vs WASM in Node on the pinned cases was checked.
- **No load test:** neither the 50 SSE clients during T1 nor the p99 step-jitter budget.
- **No catch-up p95 measurement** under CPU throttling, and **no two-context Playwright smoke test**. One
  headless e2e race was run by hand instead.
- **Boot golden self-test is not wired.** `LiveHub::set_start_blocked` exists, but nothing calls it yet.
- **No nightly `verify-races` task.** `autoduck verify-races` is still a stub.
- **No boot regeneration** of missing tracks or stats.
- **No `REPLAY_TRACK_RECORDING` env kill switch.** `LiveOptions::record_track` exists, but no env var sets it.
- **Track encoder:** Rust vs TS byte equality on `fixtures/replay-track/*` was not re-checked in this pass.
- **WASM size:** the release `.wasm` is about 1.6 MB raw and about 463 KB gzip -9, over the 350 KB target.
  The target is warn-only and nothing was done to shrink it.

## Known open items

- **Docker wasm bytes differ from the macOS build** (sha256 `9ec66be0…` vs `311e94d0…`). `ENGINE_BUILD_ID`
  is derived from sources and the toolchain, not from the host, so the live build-id match is unaffected.
  Still, the "byte-identical artifact" claim in `build-wasm.sh` does not hold across these hosts. Not
  investigated.
- **One intermittent browser error:** `Cannot read properties of null (reading 'drawImage')` once, in 4 runs,
  at the live → replay switch. It is most likely Phaser drawing after the canvas was destroyed. Replay still
  played.
- **Shutdown grace vs container stop timeout:** the server waits up to 120 s for running races (D21). The
  container stop timeout must be at least that (Docker's default is 10 s), or a deploy during a race kills
  it. Recovery then marks the race `failed` and unlocks the week, so no data is lost, but the race has to be
  re-run. Never deploy during the Monday race (D28).
- **T2 failing on the live path** (for example a transient DB error) fails the race and returns the week to
  `locked`, as TS's `executeSeason3Race` did. It does not leave the race FINISHED for a retry. T1's events
  and track stay in the DB, and a re-run of the week uses the same week seed.
- **Full Docker image not built.** Only `docker build --target wasm` was run.
