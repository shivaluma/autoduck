# AutoDuck: migration plan to a Rust server, a Rust/WASM engine and a Vite SPA

> **Status (2026-11-09).** The user approved the full plan. Decisions are fixed: an axum + sqlx backend, one Rust engine running natively and as WASM, old races replayed from recordings, and legacy v2 dropped.
>
> - **Shipped to `main`:** step 0.2's Google sign-in fix (`d8c69d1`). It differs from D24 in two ways. Login matches by verified Google id only, with **no** email fallback. Per the user's choice, **no** token rotation or link cleanup was done.
> - **Deploy rule:** pushes to `main` auto-deploy, so don't push deploy-triggering changes on Mondays (ICT). This replaces D28's manual-deploy proposal (Q6 answered).
> - **Branches:** Rust and Vite work happens on this `rewrite` branch.

Repo HEAD is `2ed4cba` on `main`, and this plan was written on 2026-11-09. It combines four earlier designs (engine, backend, frontend, cutover) and the fixes from three adversarial reviews (feasibility, determinism, live-ops). Where the designs conflicted, §2.2 records which one was chosen and why. The last section lists what happened to each review finding.

**What was checked in the code for this plan (read-only):**

- **Storage and replay:**
  - `prisma/schema.prisma:84-99`
  - `lib/racing/{replay,persistence,public-engine,runtime,audit}.ts`
  - `lib/season3-race.ts` (lines 85-95, 109, 129-160, 253-300, 440-486)
  - `lib/season3-race-mapping.ts:10-30`
  - `lib/season3-test-mode.ts:3-5`
  - `components/racing/phaser-race-canvas.tsx:1282-1336`
- **Auth and admin:**
  - `app/api/admin/season3/route.ts:19-23,411,427`
  - `lib/auth/google.ts:14-116`
- **Build and migrations:**
  - `scripts/run-migrations.ts:1-8`
  - `scripts/auto-migrate.sh:13`
  - `Dockerfile:8,37,79-81`
- **Inventories:**
  - The full list of 29 `route.ts` and 19 `page.tsx` files
  - Every import of `lib/racing`, `lib/season3*` and `packages/race-*` from browser code
- **History:**
  - The git history of `packages/race-core/src/track.ts`
- **Local database (`prisma/dev.db`):**
  - races 35–40
  - journal mode `delete`
  - 15 `AppMigration` rows

---

## 1. Target architecture

```
                        BROWSER  (Vite + React 19 SPA, react-router v7 data mode)
 ┌──────────────────────────────────────────────────────────────────────────────────────────┐
 │ /season-3?token=…  /season-3/race/:id  /admin/season-3  /admin/cosmetics  /dev/*           │
 │                                                                                            │
 │ PhaserRaceCanvas ── RaceSource ──┬─ RecordingDriver (EVERY finished race, old or new):      │
 │   (scene code unchanged:        │    DTRK/1 decoder (TS, DataView) + stored events         │
 │    applyWorld/applyEvent;       │    + content-addressed track geometry                    │
 │    seek = reset + replay)       ├─ LiveDriver (live race): WASM SimHandle in a Web Worker, │
 │                                 │    bounded by confirmed tick (never mispredicts),        │
 │                                 │    stateHash checks → desync report → SnapshotDriver     │
 │                                 ├─ SimDriver (race lab, "Xác minh lại"): WASM SimHandle     │
 │                                 └─ SnapshotDriver (fallback, ?snapshots=1)                 │
 │ seams: src/engine/{catalog,protocol}.ts  (re-export TS packages on main; generated on      │
 │        rewrite: src/engine/generated/{catalog.json,versions.json,types/*} via ts-rs)       │
 │ race_wasm.wasm (content-hashed, lazy with Phaser; never loaded for replays/home/rules)     │
 │ static: public/race-tracks/<trackVersion>@<sha8>.json (one per distinct geometry)          │
 └────────────▲─────────────────────────▲───────────────────────────────▲───────────────────┘
              │ JSON /api/*             │ SSE v2 (hello/start/clock/     │ GET /api/races/:id/track?h=
              │                         │ finished/resolved; input rsvd) │ (gzip DTRK/1, immutable)
 ┌────────────┴─────────────────────────┴───────────────────────────────┴───────────────────┐
 │ autoduck (ONE Rust binary, crates/server: axum 0.8 + tokio 1 + sqlx 0.8) single instance │
 │  lock(/app/data/autoduck.lock) → DB guards → backup → schema verify → recovery → bind :3000│
 │  routes/* (11 live routes [+redeem, Q7] + /track + /desync + /api/health)                 │
 │  ServeDir(dist/) + SPA fallback (never for /api/*)                                        │
 │  live/registry: per race → std::thread driver (catch_unwind) owning race_core::Simulation │
 │      60 Hz, tokio broadcast<SseFrame{seq}>, replay_log, TrackRecorder sink                │
 │  T1 tx: events+result+digest+track+RACING→FINISHED   T2 tx: chaos+meta+QP+RESOLVED         │
 │  season3/* cosmetics/* auth/* replay_import (ensure-imported)  verify (golden self-test,   │
 │  nightly re-verify)  db/: DbTime, AppMigration ledger, PRAGMA verifier, 1 writer/8 readers │
 │        │ path deps                                                                        │
 │  ┌─────▼──────────────┐  ┌────────────────────┐  ┌──────────────┐  ┌────────────────────┐ │
 │  │ race-core (no_std) │◄─┤ race-protocol      │  │ race-wasm    │  │ race-cli (rayon):  │ │
 │  │ sim/items/pickups/ │  │ (no_std; types,    │  │ (wasm-bindgen│  │ balance, oracle,   │ │
 │  │ ai/chaos/rng/JCS/  │  │ versions, DTRK/1,  │  │  → browser)  │  │ codegen, corpus,   │ │
 │  │ digest/state_hash/ │  │ LegacyRaceConfigV1)│  └──────────────┘  │ fuzz, replay, gate │ │
 │  │ stats/TrackRecorder│  └────────────────────┘                    └────────────────────┘ │
 │  └────────────────────┘                                                                    │
 └──────────────────────────────────────┬────────────────────────────────────────────────────┘
                                        ▼
        SQLite /app/data/autoduck.db (same file; Prisma-compatible values; journal=DELETE until
        point of no return). Tables: 25 live + RaceReplayTrack (new, on main first) + 12 inert
        legacy (dropped after PONR). Ledger: existing "AppMigration" (rs-* ids only after PONR).
```

**Core principles:**

- Replays play recorded data. Re-simulation is used only for live prediction, the race lab, the optional verify button and server-side self-checks.
- Old TS races are never simulated by Rust.
- A race is never shown with motion computed by a different engine than the one that ran it.

---

## 2. Decisions

### 2.1 Decisions table

| # | Decision | Choice | Rationale |
|---|---|---|---|
| D1 | Cargo layout | Crates: `crates/{race-protocol,race-core,race-wasm,race-cli,server}`. `race-protocol` and `race-core` are `#![no_std]`+`alloc`. The server crate is `autoduck-server` and its binary is `autoduck`. Workspace profile: `[profile.release] panic = "unwind"` and `[profile.release.package.race-core] overflow-checks = true`. `race-wasm` alone is built with `-C panic=abort`, set by `scripts/build-wasm.sh` in its own cargo invocation. | One workspace root. no_std removes the platform libm, `HashMap` and the clock by construction. Unwinding is required so the driver thread's `catch_unwind` can contain a sim panic. Overflow checks turn silent wrapping into a caught panic. |
| D2 | Versions | Engine `RACE_ENGINE_VERSION 2.0.0`, balance `RACE_BALANCE_VERSION S3.16`, protocol `RACE_PROTOCOL_VERSION 2.0.0`. New constants: `RNG_VERSION xs32-v1`, `DIGEST_VERSION jcs-sha256-v2`, `TRACK_FORMAT dtrk/1`. Track stays `river-01-v2`; its geometry is content-addressed (D10). Pickup and hazard versions become `pickups-v2`/`hazards-v2`. `ENGINE_BUILD_ID` is new: sha256 over the race-core and race-protocol source trees, the race-core subgraph of `Cargo.lock`, and `rust-toolchain.toml`, computed by `race-core/build.rs`. | User decision 3: a new version, no TS parity. Labels alone have proved unreliable (§4.1), so the build id ties the running code to a stored race. If cutover lands in a new season, the balance label becomes that season's (Q1). |
| D3 | Port method | Phase A is a faithful port, diffed against the TS oracle (gate G1) and tagged `engine-port-baseline`. The `ts-compat` feature carries `js_math`: a port of V8's `MathHypot` Torque algorithm (max-scaling plus compensated sum) and of V8's `base::ieee754::{exp,pow}` (fdlibm-derived). It also carries the ICU-modelled id comparator (D6). Phase B applies fixes F1–F13, one commit each with a paired Rust-vs-Rust report. The final gate is G3: outcome distributions compared with TS S3.15 on identical seeds. | Parity is a **test method**, not a ship requirement. `Math.hypot` decides sort order in the pickup collector (`pickups/engine.ts:319-320`). `Math.exp` (`chaos-utility.ts:107,131`) and `Math.pow` (`brain.ts:114`) run every tick. Without `js_math`, G1 cannot pass. |
| D4 | Native↔WASM bit-identity | **Required.** It is enforced by: (a) no_std with `libm 0.2` for all transcendentals (enable `force-soft-floats` if 0.2.x at branch cut exposes it; verify); (b) clippy `disallowed_methods`/`disallowed_types` (`mul_add`, `f64::{max,min,signum,clamp,total_cmp}`, `sort_unstable*`, `HashMap/HashSet`, `usize` in hashed or serialized structs, `serde_json::{Value,Map}`); (c) the helpers `js_round/js_max/js_min/js_sign/cmp_f64_js`; (d) `serde_json = { version = "1", default-features = false, features = ["alloc","float_roundtrip"] }` declared directly in race-core and race-protocol, so every dependency graph parses floats with correct rounding; (e) a CI diff of `cargo tree -e features -i serde_json` for `-p autoduck-server` against `-p race-wasm --target wasm32-unknown-unknown`; (f) every float that is persisted or compared (sim, digest, stats) is computed inside race-core, and the server crate bans std transcendental methods; (g) the corpus in D26. A `rust-toolchain.toml` bump counts as an engine change and is gated by `golden-version`. | The browser predicts the server's sim, and verify must reproduce it. Cargo feature unification makes the server graph differ from the wasm graph; (d) and (e) neutralise that. |
| D5 | RNG | `rng.ts` is kept bit for bit: FNV-1a over UTF-16, splitmix32 seeding, xorshift32. The meta streams `chaos:week:N`, `chaos:manual:N:<ms>` and `auto-loadout:<id>` stay identical. Phase B fix F2 removes `{raceId}` from **engine** stream labels. | Keeps weekly Chaos draws, toggle-skip and auto-loadouts continuous mid-season. The meta-parity fixtures (10k cases) must match 100%. |
| D6 | Id ordering | Phase B uses byte order (`Ord for str`). Ids must match `^[0-9A-Za-z_:-]{1,64}$`; `clientActionId` must be 8–64 characters. The `ts-compat` comparator models ICU root collation over ASCII: primary pass, then tertiary pass. It uses a key table generated by `scripts/oracle/collation-table.ts` from Node's `Intl.Collator`, and a property test compares it with Node on 1M generated ids of every format. | `localeCompare` depends on the host locale. ICU puts `:` and `_` before digits, which byte order does not. That is invisible on `river-01-v2` today (4 zones × 5 anchors, digit player ids) but not structurally. |
| D7 | Event model | A typed Rust `EventKind` (68 engine variants) serializes to today's wire shape plus `seq`, the **per-race emission index**. `Option::None` keys are omitted. Metadata key names are pinned by `event_wire_keys.rs`. `CHAOS_RESOLVED` and `QP_TRACK_REWARD_GRANTED` are server meta events, excluded from `eventsSha256`. `seq` is excluded from `eventsSha256`; order already encodes it. | `metadata` is a de facto browser API. With these rules the digest contains no `undefined` tokens. |
| D8 | Config | `RaceConfigInput::resolve()` is the only place defaults live. The browser uses the same function through WASM `normalizeConfig(json: &str)`, which takes a **raw JSON string** and never a JS object, so Rust parses every decimal. There is one `goldenBoxProbability` default, 0.15. Existing TS field names (`chaosConfig`, `pickupConfig`, …) are kept. Old configs (engine ≤1.2.0) parse only into `LegacyRaceConfigV1` (lenient, display-only). | Removes the Zod 0.12/0.18 split. Keeping the field names lets the rollback image and legacy display read both generations. A JS object would let V8 parse the floats instead of Rust. |
| D9 | Commit and digest | `engineConfigJson = JCS(resolved config)` is stored verbatim, and `seedCommit = sha256(engineConfigJson)`. JCS is a hand-written writer in race-core over typed structs. Keys are sorted by UTF-16 code units (RFC 8785), numbers formatted with `ryu-js`, and no `serde_json::Value` is involved. `resultDigest = sha256(JCS(DigestEnvelope))`, with `DigestEnvelope = {digestVersion, configCommit, engineVersion, balanceVersion, protocolVersion, rngVersion, trackVersion, trackDefSha256, durationTicks, standings:[{playerId,rank,finishTick,finishTimeMs}], eventsSha256, motionSha256}`. **`trackDefSha256`** is sha256 of JCS over the *sim-relevant* track definition (length, currents, zones, gates), never over DTRK. **`motionSha256`** is a sha256 fold over `state_hash` at every 60th tick and the final tick. The envelope has no `inputsSha256`, because consumed inputs are `WILD_ITEM_MANUAL_INPUT` events already inside `eventsSha256`. `engineBuildId` is stored but kept **out** of the digest. | A Rust race can be verified from stored text, and position-only drift is detectable. Note: TS-era digests cannot be recomputed from DB rows, because TS `canonicalize` emits a literal `undefined` token (`audit.ts:4-11`). Only re-simulation can reproduce them. |
| D10 | Replays | Every race gets a `RaceReplayTrack` row holding a gzip **DTRK/1** blob (stride 1, `firstTick 0`). `byteSha256` covers the **uncompressed** payload. The header names `trackGeometry: "<trackVersion>@<sha8>"`, which resolves to `public/race-tracks/<trackVersion>@<sha8>.json`. Writers: the TS live recorder (on main, now), the offline historical resolver, and the Rust recorder. The Rust recorder writes **in T1**. | Watchability no longer depends on engine versions. The geometry is the one the race actually used (§4.1: `river-01-v2` changed without a version bump). |
| D11 | Old races | An offline resolver finds the historical commit whose TS engine reproduces each race. Stored grades: `RECORDED`, `VERIFIED_DIGEST`, `VERIFIED_EVENTS` and `UNAVAILABLE`. `OUTCOME_MATCH` is diagnostic only: it is reported in REPORT.md and stored as `UNAVAILABLE` with a note. Artifacts are committed to main and imported on every boot by the non-ledgered, idempotent `ensure-imported` step (TS now, Rust after cutover). | See §4. Verified locally: HEAD reproduces 0 of 3 stored digests, and historical commits reproduce 3 of 3. |
| D12 | Backend crates | axum 0.8, tokio 1, tower-http 0.6, sqlx 0.8 (`default-features=false`, features `runtime-tokio`, `sqlite`, `macros`; **no `chrono`/`time`/`migrate`**), serde_json (`std`, `raw_value`, `preserve_order`; server only), jsonwebtoken 9.3 (or 10.x with its rust-crypto backend if 9 is unavailable at branch cut), reqwest 0.12 (rustls), subtle 2.6, sha2 0.10 (no_std, shared with race-core), flate2 1, tracing. | User decision 1. Leaving out sqlx's datetime features means a `DATETIME` column can only be read as `String`/`DbTime`, which the compiler enforces. |
| D13 | DB compatibility | Same tables and columns, quoted identifiers. **`DbTime`** encodes exactly `%Y-%m-%dT%H:%M:%S%.3f+00:00` and decodes that format, `…Z`, `YYYY-MM-DD HH:MM:SS` and epoch-ms. Every INSERT sets `createdAt`/`updatedAt` explicitly, so the live DDL's `DEFAULT CURRENT_TIMESTAMP` never fires. cuid-style ids come from `rand`. Booleans are 0/1. **`DATABASE_URL` is parsed by our own code:** strip `file:`/`sqlite:`, require an absolute path in production, open with `create_if_missing(false)`. Hand-written SQL in runbooks uses `strftime('%Y-%m-%dT%H:%M:%f+00:00','now')`. | Matches the Prisma 7 adapter format (verified in the adapter source and in `dev.db`). The rollback image must read rows Rust writes. A space-separated timestamp sorts before a `T` timestamp on the same day. |
| D14 | Schema ownership | Migrations are recorded in the existing `AppMigration` table with `rs-NNNN-*` ids, and **only after the point of no return (PONR)**. `_sqlx_migrations` is never created. The baseline comes from `prisma migrate diff --from-empty` with `IF NOT EXISTS`. A boot verifier compares `PRAGMA table_xinfo/index_list` with an in-memory build. Columns are compared as name-keyed sets (affinity, notnull, pk), defaults are normalised (`true/false→1/0`, quotes stripped) and indexes are compared by name and column list. The verifier **fails only** on missing tables or columns that Rust queries; everything else is logged. `AUTODUCK_SCHEMA_MODE` defaults to `compat` (no DDL, no `rs-*` rows, no `ANALYZE/STRICT/jsonb/generated columns`). `owned` needs both the env var and an `AppMigration` marker row `rs-ponr`. Boot requires every id in `crates/server/data/required-ts-migrations.json`, which is generated from `scripts/run-migrations.ts`. In `AUTODUCK_ENV=dev` a missing id is only a warning, because `dev.db` has 15. | The live DDL was built by years of `db push` plus raw `ALTER TABLE` (`run-migrations.ts:301`, dragon tables `:304-454`), so strict comparison would fail on first boot. Rollback safety: Prisma `db push` would want to drop unknown tables. |
| D15 | Journal mode and pools | Journal mode is `DELETE` until PONR, then WAL. Pragmas are set explicitly on every connection: `.journal_mode(Delete).foreign_keys(true).busy_timeout(5s).synchronous(Full)`, with no `optimize_on_close`. The **writer pool** has `max_connections(1)`, and every write transaction there starts with `BEGIN IMMEDIATE` (sqlx `begin_with` if 0.8 has it, otherwise raw `BEGIN IMMEDIATE` on the pooled connection). The **reader pool** is `read_only(true)` with up to 8 connections. No reader transaction stays open across an `.await` that waits on the network. T1 events are inserted in 500-row chunks inside one transaction. | Today there is one synchronous better-sqlite3 connection. In DELETE mode, readers block a commit, and only `busy_timeout` plus a single writer keeps that safe. Read-only readers make an accidental write fail loudly. The sqlx default journal mode is unverified, hence explicit pragmas. |
| D16 | Live protocol | SSE v2 frames, each with `id: <frameSeq>` (see the frame list below). `Last-Event-ID` resumes from `replay_log`. On `Lagged` the server re-sends from `replay_log` and never drops the stream. **Rule:** an `input` frame for `atTick` is emitted at drain time, before the `clock` frame that confirms it, including in replays and after `Lagged`. The client steps to at most `min(estimatedServerTick − renderDelay, lastClockTick + INPUT_LEAD)` with `INPUT_LEAD = 6` ticks (**100 ms** at 60 Hz), so it **never mispredicts**. There is no rollback and no checkpoint ring. The engine rejects `atTick <= tick` instead of clamping. **Manual wild-item POST returns 410** until Q4 is answered yes; the protocol and engine keep input support, and tests cover it. On a hash mismatch the client POSTs `/api/races/:id/desync {tick, clientHash, serverHash, engineBuildId}` (rate-limited) and then switches to snapshots. | Removes the fragile rollback machinery: FX that can't be retracted, behavioural caches in `Clone`, and undefined `drainEvents` after a restore. It also removes about 6 days of work for a feature with no UI today (the manual-input panel is unused and the census expects 0 inputs). |
| D17 | Seed visibility | Seed and config are revealed only when `engineState ∈ {RACING, FINISHED, RESOLVED, ARCHIVED}`. `engine.players` still shows while pending. API DTOs never contain `raceSeed`, including the admin GET (`route.ts:60` today); they carry `seedCommit = sha256(seed)` instead. This ships **with cutover**. | Today the outcome can be computed during the countdown (`public-engine.ts:3-10`). After F2 the outcome is fixed at lock. Changing this on main would break the current canvas, which re-simulates during pending. |
| D18 | Frontend | Vite at the **repo root**, new code under `src/`. **Seams land on main in 0.5:** `src/engine/{catalog,protocol}.ts` re-export from `packages/*` on main and switch to generated JSON/types on `rewrite`. Client-only modules are `git mv`'d into `src/race/*` and `src/season3/*` on main. `components/` stays in place, and the `@/*` alias still points at the repo root. Only the 13 surviving `page.tsx` files are `git mv`'d to `src/pages` on the branch. React 19 native `<title>`, Fontsource fonts, `@tailwindcss/vite`, ESLint flat config without Next. | Keeps weekly main→branch merges nearly conflict-free and means Phases 8–9 delete only server code. |
| D19 | Catalogs | **Race items:** Rust `catalog.rs` is the single source, exported to `src/engine/generated/catalog.json`. The export contains `items`, `wildItems`, `classes`, `comboRules`, `autoLoadoutPresets`, `eventItemActivation` and `eventItemSuccess`. TS helpers `loadoutComboBadge`, `loadoutComboLabel`, `ITEM_CLASS_BY_ID`, `itemActivationForEvent` and `itemSuccessForEvent` are re-implemented over those tables in `src/engine/catalog.ts`. **Cosmetics:** TS `lib/cosmetics/catalog.ts` and `legacy.ts` remain the source, exported to `crates/server/data/{cosmetic-catalog,cosmetic-legacy}.json` and embedded with `include_str!`. Rust preserves unknown cosmetic ids as-is and logs them; it never drops or normalises them. CI checks both exports with `git diff --exit-code`. | Browser code uses engine *functions*, not just data (`season3-rules-guide.tsx:17-18`, `phaser-race-canvas.tsx:6`). Home and rules pages never load WASM. |
| D20 | Image | **CI builds every image.** `ghcr.io/shivaluma/autoduck:ts-<sha>` comes from main (0.7) and `:rust-<sha>` from `rewrite`. In Phase 7, Dokploy is switched to **image mode**, so cutover and rollback are both image-tag changes. The Rust runtime is `debian:bookworm-slim` with `ca-certificates sqlite3 tini`, running as root until PONR. The builder sets `ENV SQLX_OFFLINE=true` and uses the committed `.sqlx/`. `.dockerignore` adds `target/`, `dist/`, `.cache/` and `artifacts/**/approx/`, and stops excluding any `*.md` that `include_str!` needs. | Building on the production host during maintenance means a long outage with a real out-of-memory risk. A shell plus `sqlite3` keeps the runbook SQL usable from Dokploy's terminal. |
| D21 | Process model | Single instance. Boot order: acquire an exclusive lock on `/app/data/autoduck.lock` (`File::try_lock`, Rust ≥1.89; fallback `fs4`) with a 150 s retry. Log lines say which instance holds the lock. **Only then** run the DB guards and bind HTTP on `PORT` (default 3000) at `0.0.0.0`. `autoduck healthcheck` checks liveness only. On SIGTERM: refuse `start-race`, wait up to 120 s for running races, exit. Dokploy/Swarm must be set to replicas = 1, **stop-first**, `stop_grace_period ≥ 150s`. Verified on staging by deploying during a test race. | The registry, rate limits and SSE live in process. If Swarm used start-first with an HTTP healthcheck, the new task would block on the lock and the deploy would hang. |
| D22 | Crash recovery | At boot, select **only** `Race` rows with `status IN ('pending','running')` **and** engine major ≥ 2: `CAST(substr("engineVersion",1,instr("engineVersion",'.')-1) AS INT) >= 2`. **engineState LOCKED/COUNTDOWN/RACING:** set status `failed`, log the reason. Touch the week only if `w.status='racing' AND w."raceId"=r.id`, setting it back to `locked/raceId NULL`. **engineState FINISHED** (T1 committed): run T2 **from the DB only**, with no re-simulation. T2 is guarded by `UPDATE "Race" SET "engineState"='RESOLVED' … WHERE id=? AND "engineState"='FINISHED'` returning 1, in the same transaction as the meta writes, so meta can never be applied twice. Test races never touch weeks. TS-era stuck rows are logged and listed, never modified. | `dev.db` already holds `status=failed, engineState=FINISHED` races 38–40 (TS leaves `engineState` as it was, `season3-race.ts:484-485`). Selecting on `engineState` alone would reopen resolved weeks or apply meta twice. |
| D23 | Race orchestration order | **T1**, in one writer transaction: events (500-row chunks), wild actions, `RaceParticipant` result columns and `Race.resultDigest` (what `persistedRaceResult` writes today, `season3-race.ts:131-140`), the `RaceReplayTrack` row (track bytes, `statsJson NULL`), and RACING→FINISHED. Race `status` stays `running`. **T2**, one transaction: `CHAOS_RESOLVED`, meta, QP reward, `status='finished'`, RESOLVED, week resolved. **After T2**, best effort: `statsJson` and telemetry in `spawn_blocking`. `autoduck backfill-stats` and the boot sweep fill any gaps. | Today telemetry runs before resolve (`season3-race.ts:296-300`) and `CHAOS_RESOLVED` is written outside the meta transaction (`:314-323`). Writing the track in T1 means a Rust race can never lose its track once its version leaves `SUPPORTED_REPLAY`. |
| D24 | Security | **On main now (0.2):** <ul><li>Google ID token verified against JWKS: `jose` 6 `createRemoteJWKSet` + `jwtVerify`, checking `aud`, `iss` and `exp`. The audience is `GOOGLE_CLIENT_ID \|\| NEXT_PUBLIC_GOOGLE_CLIENT_ID` (same fallback as `auth/google/route.ts:10`); if both are empty the verify endpoint returns 503 and logs an error.</li><li>The raw-JSON, decode-only, bare-email and `tokeninfo` paths are deleted.</li><li>Email fallback only when `email_verified` and (`googleId IS NULL` or `googleId` contains `@` or is not all digits). On success `googleId` is overwritten with `sub`.</li><li>Admin `authorized()` fails closed only when `RACE_SECRET_KEY` is unset or empty, and logs a warning if it is shorter than 16 characters (rotation is a separate, announced step).</li><li>Comparison is `timingSafeEqual(sha256(given), sha256(expected))`.</li></ul>**Rust only:** `Referrer-Policy: same-origin`, query strings stripped from logs, avatar proxy SSRF guard, CSP report-only then enforced. | `lib/auth/google.ts:54-63` accepts raw JSON, `:105-109` a bare email, and the `tokeninfo` path at `:79` never checks `aud`: together an account takeover. `admin/season3/route.ts:22` passes when the key is unset. The old `googleId` values written by the raw-JSON and bare-email paths would otherwise lock those users out. |
| D25 | Legacy v2 | **On main (0.3a):** delete the code and **17** routes (admin/{chests×2, dragon, root, season, shields×2, tick, users/demote}, dashboard×2, dragon, members/stats, races (list), races/start, upload, users). `/api/season3/redeem` is a Season 3 feature and **stays** pending Q7. All Prisma models are kept until after PONR, then archived with `VACUUM INTO` and dropped (`rs-0010-drop-legacy-v2`). R2 credentials and the bucket are **kept**: avatars may live there (`avatars/[userId]/route.ts:4-6`). Race detail keeps the legacy keys as constant `[]`/`null`. | User decision 4. Data stays recoverable through the rollback window. |
| D26 | CI | GitHub Actions (`origin` is `github.com/shivaluma/autoduck`). Jobs: `ts`, `migrations` (runs `tsx scripts/run-migrations.ts` on a prod-schema DB), `track-format`, `rust`, `wasm`, `determinism`, `golden-version`, `db-compat`, `docker`, `client-boundary`. **`determinism`** compares a per-60-tick `state_hash` chain plus the digest across native, `wasm32-wasip1`/wasmtime and the shipped wasm-bindgen package in Node, on x86_64 and aarch64. It also runs 100 cases in Chromium, Firefox and WebKit through Playwright, and one deep-stack case under wasm's default stack. **`client-boundary`** checks that `grep -rE "packages/race-\|lib/season3(-race)?\.ts\|lib/racing/" src components` finds nothing outside `src/engine/*` seams. | There is no CI today. Comparing digests alone would miss position-only drift. |
| D27 | Toolchain | `rust-toolchain.toml` pins current stable at branch cut (minimum 1.89) with targets `wasm32-unknown-unknown` and `wasm32-wasip1`. `wasm-bindgen` is pinned with `=` to **the newest release at branch cut**, and `wasm-bindgen-cli` must match it exactly (CI-checked). This is because newer rustc enables the `bulk-memory` and `nontrapping-fptoint` wasm features by default. No `wasm-opt` at first. The determinism corpus always runs on the shipped artifact. | |
| D28 | Operating rules | <ul><li>**Deploys, not pushes, are gated.** Dokploy auto-deploy is turned **off** in Phase 0 (needs the user, Q2/Q6), and production deploys happen manually Tuesday to Thursday ICT, never on Monday. Pushing to main stays allowed at any time, which is compatible with the user's auto-push memory.</li><li>Work for `rewrite` commits and pushes to `rewrite`.</li><li>**TS engine freeze** from the branch cut: a CI rule fails PRs that touch `packages/race-*`, `lib/racing/{audit,persistence,runtime}.ts` or `lib/season3-race.ts` unless they carry the `engine-hotfix` label. Any hotfix bumps `RACE_BALANCE_VERSION` and adds a port item in the same PR.</li><li>These rules are added to `CLAUDE.md`.</li></ul> | The memory rule "commit+push to main after each finished change" plus auto-deploy would deploy on Mondays (`e199a8a` landed on Monday 10:30 ICT). An engine change on main would move the G1 oracle and the G3 baseline. |
| D29 | Backups | <ul><li>**TS boot (0.1):** `scripts/ops/backup.mjs` uses better-sqlite3 `.backup()` to write `/app/data/backups/pre-migrate-<ts>.db`. It skips if one exists from the last 6 h, and skips with a loud log if free space is under 3× the DB size. It keeps the newest 10. It never blocks boot.</li><li>**Rust boot:** `VACUUM INTO /app/data/backups/boot-<ts>.db` under the same retention and free-space rules, best effort. `PRAGMA integrity_check` failing is **fatal**.</li><li>**Runbooks** use `sqlite3 … ".backup …"`, never `cp`.</li><li>**Off-box:** Dokploy volume backups to the R2 bucket if this Dokploy version supports them (Q2), otherwise a weekly manual `.backup` pull.</li></ul> | Today every boot runs `db push --accept-data-loss` with no backup. `cp` of a DELETE-mode DB after an unclean kill can capture a half-applied transaction. Unbounded `VACUUM INTO` in a crash loop fills the disk. |

**D16 frame list:**

| Frame | Contents |
|---|---|
| `hello` | `{protocolVersion, engineVersion, balanceVersion, engineBuildId, raceId, state, serverTick, countdownEndsInMs?, configJcs? (only if RACING+), inputs:[…all incl. queued atTick>serverTick], seqHighWater}` |
| `start` | `{configJcs, startTick:0}` |
| `clock` | `{tick, hash?}`, every 3 ticks; `hash` every 60 ticks, computed after step `tick` |
| `input` | `{seq, atTick, …}`, reserved |
| `finished` | `{finalTick, digest, standings}`, after T1 |
| `resolved` | after T2 |
| `snapshot` | opt-in via `?snapshots=1` |

**`state_hash` (D4, D16).** `race_core::hash::state_bytes(&Simulation, &mut impl FnMut(&[u8]))` is an explicit little-endian encoding:

- lengths are `u32`, integer fields are `u32`/`i32`
- floats are `f64::to_bits`, with every NaN mapped to `0x7ff8000000000000` and `-0.0` mapped to `+0.0`

The hash is sha256 (`sha2`, no_std). A unit test hashes a fixed state, and CI compares the result on native and wasm.

### 2.2 Conflicts between designs and how they were resolved

| # | Conflict | Winner | Why |
|---|---|---|---|
| C1 | Track format: ADRT1 binary, `autoduck-track/1` JSON, `duckrec/1` delta JSON, DTRK/1 binary | **DTRK/1, extended with the engine's header conventions** | Binary columns are about 7× smaller than JSON frames (138 KB gzip at stride 1, against 0.86 MB for gzipped full snapshots). `DUCK_CHANGES` keeps the exact `activeEffects` order. |
| C2 | Sample stride 1 vs 2 vs 4 | **Stride 1, from tick 0** | Tick-exact FX at 2× and 4× playback. Size is about 140 KB for 8 ducks and about 290 KB for 16. |
| C3 | Who writes tracks | **TS now, Rust later.** CI requires byte-identical **uncompressed** payloads on `fixtures/replay-track/*`. Each fixture pins its header, including `engine.impl` and `commit`. | Recording has to start before Rust exists. gzip output differs between Node zlib and flate2, so hashes cover uncompressed bytes. |
| C4 | Track geometry: per recording, WASM, or generated JSON | **Content-addressed static files `public/race-tracks/<trackVersion>@<sha8>.json`**, each with `sim` (length, currents, zones, gates) and `render` (2,048 polyline samples). Each file is exported from the TS commit that ran the races. Rust never recomputes `render`; `race-cli codegen` checks that the Rust sim definition's `trackDefSha256` equals the `sim` subset of the current file. | "Track versions are immutable" is false: `river-01-v2` gained 4 boost gates in `6e3f689` without a bump, and races 35–36 are `river-01-v1`. `Math.hypot` in render geometry (`track.ts:180`) can't be reproduced bit-exactly by libm, so Rust must not re-emit it. |
| C5 | Unreproducible old races | **No animation (`UNAVAILABLE`)** | Never show motion that wasn't computed by the engine that ran the race. |
| C6 | "Events match" criterion | **Full stream including metadata**; a stored digest takes precedence. | Race 36 at `695f5ea` matches the event signature but not the digest. |
| C7 | Where and when old tracks are imported | **One offline resolver. Artifacts committed to main. Imported by `ensure-imported`, a non-ledgered, idempotent step run on every boot** (TS `scripts/replay-tracks/ensure-imported.ts` after `run-migrations`; Rust `replay_import::ensure_imported` after cutover). | A one-shot ledgered migration can't import later gap fixes, and a throw in it would crash-loop boot (`run-migrations.ts` exits 1 under `set -e`). |
| C8 | Gap between snapshot and cutover | **Closed by ordering plus a HEAD backfill.** Every race after the 0.4 deploy is `RECORDED`. Races between 2026-10-06 and the 0.4 deploy reproduce at HEAD (engine unchanged since `9ee0962`). | |
| C9 | Live wire | **v2 wire plus the backend's transport mechanics.** `hello` carries the config and full input log; the client re-simulates from tick 0 **in a Web Worker, in 500-tick chunks with a progress state, FX suppressed before the join tick**. The postcard resync blob is dropped. | Avoids a serialized-state ABI between native and wasm. Mobile catch-up may take 100–300 ms; the confirmed-tick bound keeps it correct even when slow. |
| C10 | Input tick `tick+1` vs `serverTick+6` | **+6 (100 ms at 60 Hz), drained every tick, client bounded by `lastClockTick + 6`. No rollback.** | The bound makes misprediction impossible by construction (determinism review B1). Today the poll runs every 15 ticks (`season3-race.ts:270`). |
| C11 | `finished` before meta vs after T2 | **`finished` after T1, then `resolved` after T2.** | |
| C12 | Layout | **`crates/server` plus Vite at the repo root with `src/`** | |
| C13 | Additive branch vs in-place edits | **Behavioural UI changes, client-module moves and seams land on main first. On the branch, edits to shared files are only the re-runnable codemod** `scripts/codemods/next-to-vite.mjs`. | |
| C14 | WAL vs DELETE | **DELETE until PONR** | |
| C15 | Schema guard | **Normalised PRAGMA comparison** (D14), calibrated on a production copy in Phase 3 | |
| C16 | Rename config fields | **Keep TS names.** The TS rollback image gets a version guard (0.5) so it never simulates a 2.x config. | |
| C17 | `raceId` in RNG labels | **Drop it (F2)**, plus an admin "re-seed week" action (D22, Phase 3). | Without that action, a deterministic panic would re-fail the week forever. |
| C18 | Separate `race-track` crate | **`race_protocol::replay_track` + `race_core::replay::TrackRecorder`** | |
| C19 | `RacePostStats` table | **`RaceReplayTrack.statsJson`**, computed by `race_core::stats` | Float stats must come from race-core (D4f). |
| C20 | `/recording` vs `/track` | **`/track?h=<byteSha256>`** | |
| C21 | Cutover window | **Tuesday 10:00 ICT**; the default moves to a season boundary if only one engineer is available (Q1, Q5). | |
| C22 | `wasm-opt -Oz` | **None at first** | |
| C23 | Rust 1.88 vs ≥1.89 | **≥1.89** | |
| C24 | Telemetry before resolve | **After T2, best effort** | |
| C25 | `live-wild-item-panel.tsx` | **Delete now**; revive against v2 only if Q4 is yes | |
| C26 | `OUTCOME_MATCH` handling: drive FX from a stored candidate event stream, or don't animate | **Don't animate.** Stored as `UNAVAILABLE` with note `outcome-match@<sha>`. The candidate's events never reach the canvas. DTRK section id 5 is reserved in case Q10 says yes. | Consistent with C5. Otherwise rocket hits would land on ducks that aren't there. |
| C27 | Admin key shorter than 16: fail closed vs warn | **Warn**; fail closed only when unset or empty | Failing closed on length could lock the admin out on race day. |
| C28 | Phase 0 deadline before 2026-11-16 | **Dropped.** Races up to the 0.4 deploy are backfilled at HEAD. | 3 deploy days for 7–9 days of work, including a base-image swap the week of a race. |
| C29 | Interim `raw-json/1` capture to meet the deadline | **Rejected** | The deadline is gone, so DTRK/1 ships directly. |

---

## 3. Phased roadmap

**Branches and deploys (D28):**

- `main` stays deployable. Production deploys are manual, Tuesday to Thursday ICT.
- Rust and Vite work happens on `rewrite`. Merge `main` into `rewrite` every Tuesday after the race; never rebase. When a merge conflicts on a shared file, re-run the codemod.
- Staging is a second Dokploy app, `autoduck-staging`, created in Phase 3. It builds from `:rust-<sha>` images on its own volume with a sanitised production copy (Phase 7 SQL plus the sentinel).

### Phase 0: low-risk prep on `main` (start now, no deadline)

**Deploy batches:**

| Batch | When | Contents |
|---|---|---|
| A | Tue–Thu Nov 10–12 | 0.1 on Tuesday. Then, in the Dokploy terminal: check `RACE_SECRET_KEY` length and run the `googleId` census. 0.2 on Wednesday or Thursday. 0.7 CI (no deploy needed). |
| B | Week of Nov 17 | 0.4, deployed Tuesday, followed by a production **test race** the same day (test races bypass the Monday gate, `season3-race.ts:89`). |
| C | Week of Nov 24 | 0.3a |
| D | Week of Dec 1 | 0.3b alone, followed by a test race |
| E | After the production copy (Q2) | 0.5 and 0.6 in **one deploy**, then 0.8 |

| Step | Deliverables | Verification gate |
|---|---|---|
| **0.1 Boot-sync safety and backups** (1 d) | <ul><li>`scripts/auto-migrate.sh:13`: no `--accept-data-loss` unless `ALLOW_DATA_LOSS=1`; honour `SKIP_DB_PUSH=1`.</li><li>`scripts/ops/backup.mjs` (D29), run first in `auto-migrate.sh`.</li><li>Runner stage: `apt-get install -y sqlite3`.</li><li>`eslint.config.mjs`: add `tmp/**` to the global ignores.</li></ul> | <ul><li>A copy of `dev.db` boots in the image and the log shows "already in sync" plus one backup file.</li><li>Removing a model on a scratch branch makes boot **fail** instead of dropping the table.</li><li>A second boot within 6 h skips the backup.</li><li>`sqlite3 --version` works in the container.</li></ul> |
| **0.2 Security** (1.5–2 d) | <ul><li>`lib/auth/google.ts` per D24.</li><li>`authorized()` per D24 in `app/api/admin/season3/route.ts` and `app/api/admin/cosmetics/route.ts`.</li><li>Before merging: `echo ${#RACE_SECRET_KEY}` in the Dokploy terminal, and the census `SELECT id,name,email,"googleId" FROM "User" WHERE "googleId" IS NOT NULL AND ("googleId" GLOB '*@*' OR "googleId" NOT GLOB '[0-9]*');` (informational; the login rule handles these rows).</li></ul> | <ul><li>Rewritten `tests/google-auth.test.ts` with a local RSA key and JWKS: wrong aud/iss, expired, `alg=none`, raw JSON and bare email are rejected.</li><li>An email-fallback user with `googleId='x@y'` logs in and gets `googleId=sub`.</li><li>Admin with the key unset → 401; wrong-length secret → 401, not 500.</li><li>`pnpm test`.</li></ul> |
| **0.3a Legacy v2 removal** (2–2.5 d) | <ul><li>Delete the 17 routes (D25) and `app/{admin/dashboard,race/new,race/[id],dragon,members,rules}`. The old URLs become redirects; `/rules` goes to `/season-3/rules`.</li><li>Delete `lib/{race-worker,ai*,r2-upload,commentary-manager,dashboard-*,dragon/*,shield-*,boss-logic,mystery-chest}`, the dead components, the `RaceLiveView` fallback in `season3-race-view.tsx:5,188`, the `videoUrl` section, unused `components/ui/*` and `components/racing/live-wild-item-panel.tsx`.</li><li>**Move** `getIsoWeekKey` and `normalizeLegacyShieldState` into `scripts/migrations/legacy-helpers.ts` (frozen copies) and repoint `scripts/run-migrations.ts:4`.</li><li>Delete `scripts/test-race.ts`, `tests/{boss-logic,dragon-core,shield-economy}.test.ts`, and the `SIMULATE_RACE`/`Z_AI`/`autoduck-videos` entries in `docker-compose.yml`. Keep the R2 env vars.</li><li>Prisma models stay.</li></ul> | <ul><li>`pnpm lint && pnpm test && pnpm build`.</li><li>CI `migrations` job green.</li><li>The image boots on a production-schema copy.</li><li>`/season-3?token=…`, a race page and the admin page render.</li></ul> |
| **0.3b Image** (1–1.5 d) | <ul><li>`node:24-bookworm-slim` for both builder and runner; better-sqlite3 is built in the builder from the same base.</li><li>Playwright moves to devDependencies (only `scripts/cosmetics/{sprites,render-contact-sheet}.ts` use it).</li><li>Xvfb removed from `start.sh`.</li><li>Still runs as root; no `USER` line.</li><li>Record the production Node version first: `docker run --rm mcr.microsoft.com/playwright:v1.59.1-noble node -v` (unverified today). If it isn't 24, pin the matching major.</li></ul> | <ul><li>The image boots on a production copy.</li><li>A test race runs the same day after the deploy.</li><li>Image size is reported.</li></ul> |
| **0.4 Track format + live recording** (3.5–4.5 d) | <ul><li>`prisma/schema.prisma`: `model RaceReplayTrack` (§4.3) and `replayTrack RaceReplayTrack?` on `Race`.</li><li>`lib/racing/replay-track/{format,encode,decode,recorder}.ts` (DTRK/1, §4.2), `fixtures/replay-track/*`, `docs/replay-tracks.md`.</li><li>**Recorder:** `push` never throws. It catches internally; on the first error it logs once and sets `disabled`. It copies primitive duck fields into growable typed arrays (`Float64Array` progress and speed, `Float32Array` lateral, `Uint8Array` rank) and diffs wild-item, effect, pickup-count and entity fields. It does not keep `snapshotRaceWorld` graphs. Tick 0 is captured in `beforeTick` when `state.tick === 0`; later ticks in `afterTick` (`runtime.ts:54-58`). It is enabled unless `REPLAY_TRACK_RECORDING === '0'`.</li><li>**After resolve**, in try/catch: `finalize()` runs the static-position assertions, encodes, decodes again, and **self-checks** that the decoded finish order and finish ticks equal `result.standings`. Then insert `{source:'LIVE_TS', fidelity:'RECORDED', engineCommit: <build sha from env SOURCE_COMMIT/GIT_SHA, else null>, reproducedDigest: resultDigest}`. `statsJson` is computed by the current `buildPostRaceStats`.</li></ul> | <ul><li>`node --import tsx --test tests/replay-track.test.ts`: encode→decode round trip within quantisation (progress ≤ 2⁻²⁴, lateral ≤ 1/32767; ranks, effects, items and entities exact).</li><li>Injecting a throwing recorder still resolves the race.</li><li>Self-check failure → no row and a log line.</li><li>The production test race (batch B) writes a `RECORDED` row, checked with `sqlite3` in the terminal.</li><li>The next Monday race writes one too.</li></ul> |
| **0.5 Track-first viewer, drivers, seams** (6–8 d) | <ul><li>**Client move (on main):** classify every `lib/**` file as client, server or shared in `docs/rewrite/lib-classification.md`. `git mv` the client modules: `lib/season3-rules-content.ts` and `lib/season3-test-mode.ts` → `src/season3/`; `lib/racing/{combat-encounters,ai-intent-copy,loadout-guide}.ts` and the render half of `post-race-stats.ts` → `src/race/`.</li><li>**Seams:** `src/engine/catalog.ts` and `src/engine/protocol.ts` re-export from `packages/*` (on main). Every browser import of `packages/race-*` goes through them. CI `client-boundary` is enabled.</li><li>**Drivers:** `components/racing/drivers/{types,recording-driver,sim-driver,live-driver,snapshot-driver}.ts` and a `RaceSource` prop on `PhaserRaceCanvas`. Scene code is unchanged except that **seeking is reset-and-replay**: `applyEvent` side effects aren't idempotent, so a backward seek rebuilds the scene and fast-applies `[0, t]` with FX suppressed.</li><li>**Geometry:** `src/race/{types,event-vocab,polyline-track}.ts`. The canvas loads geometry from the DTRK header's `trackGeometry` file instead of HEAD `createRiverTrack`. `scripts/race-tracks/export.ts` writes `public/race-tracks/river-01-v2@<sha8>.json` from HEAD.</li><li>**Version guard** inside TS `createSimulation`/`simulateRace`: throw unless `engineVersion`/`balanceVersion` equal the current constants or `{allowVersion:true}` is passed. This covers the uses in `post-race-stats.ts:133,211`, `telemetry.ts:21` and `pickup-telemetry.ts:30`.</li><li>**Replay player:** `season3-replay-player.tsx` uses the track whenever one exists, with a fidelity badge and a scrubber. It re-simulates only when `(engineVersion,balanceVersion)` equals the current pair and there is no track. Events are read `ORDER BY id`, with an assertion that ticks never decrease. Configs with engine major ≥2 are never Zod-parsed or simulated. Post-race stats read `statsJson` when present.</li><li>New route `app/api/races/[id]/track/route.ts` (§4.6).</li></ul> | <ul><li>A race with a track plays from it with identical FX timing to the current re-sim, in a side-by-side fixture.</li><li>A fixture test shows the scene-visible event sequence from DB rows (after `JSON.stringify`) equals the in-memory sequence.</li><li>A synthetic `engineVersion:"2.0.0"` race renders from its track without throwing, which is what lets the rollback image show Rust races.</li><li>The guard throws on a 2.0.0 config.</li><li>`client-boundary` is green.</li></ul> |
| **0.6 Census + historical resolver** (5–6.5 d; ships in the same deploy as 0.5) | <ul><li>The production DB copy is pulled by the user (Q2) with `sqlite3 … .backup` on the host, never through an HTTP endpoint. It is **sanitised immediately** with `UPDATE "SeasonPlayer" SET "accessToken"=lower(hex(randomblob(16))); UPDATE "User" SET email=NULL,"googleId"=NULL;`, kept outside the repo and scratchpad, and deleted after 0.6.</li><li>Census SQL (§4.5). `scripts/replay-tracks/{resolve-historical.ts,resolve-worker.mts,ensure-imported.ts,headless-check.ts}` (§4.4).</li><li>Output: `artifacts/replay-tracks/{<raceId>.dtrk.gz,manifest.json,REPORT.md}` plus geometry files `public/race-tracks/<trackVersion>@<sha8>.json` for each distinct geometry.</li><li>`start.sh` runs `ensure-imported.ts` after `run-migrations`. The Dockerfile runner gets `COPY --from=builder /app/artifacts/replay-tracks ./artifacts/replay-tracks`.</li><li>Tolerant `src/race/event-vocab.ts` normalisers keyed on `engineCommit` for historical metadata shapes.</li></ul> | <ul><li>**Calibration first:** every production race created after 2026-10-06 resolves at HEAD as `VERIFIED_DIGEST`. If not, the environment (Node, ICU, locale) is wrong and must be fixed before the commit search is trusted.</li><li>REPORT.md reviewed. Every official race is `RECORDED`/`VERIFIED_*`, or its `UNAVAILABLE` is accepted by the user.</li><li>Every distinct `(trackVersion, geometry sha)` has a file.</li><li>**Headless pass** with 0 exceptions over every imported race: Node runs `extractCombatEncounters`, the timeline formatters and stats rendering; Playwright Chromium opens `/dev/replay-check?secret=…`, which plays each imported race at maximum speed through `RecordingDriver` and collects `window.onerror` and console errors.</li><li>After deploy: the gate SQL (§4.5) returns 0 rows on production; `ensure-imported` logs "imported N, skipped M, rejected 0".</li><li>Spot-check 3 replays per grade.</li></ul> |
| **0.7 CI, images, health** (2.5–3 d) | <ul><li>`.github/workflows/ci.yml` with jobs `ts` (install, `prisma generate`, lint, test, build, `cosmetics:validate`), `migrations`, `track-format`, `client-boundary`, and `docker` (build, report size, push `ghcr.io/shivaluma/autoduck:ts-<sha>` on main).</li><li>Fix the roughly 14 live-code lint errors. The other 44 disappear with 0.3a; `tmp/**` is ignored from 0.1.</li><li>`GET /api/health`.</li><li>Admin JSON report `GET /api/admin/season3?report=ops` (secret header): returns the §4.5 gate and fidelity queries and the in-flight `Race` rows. It is read-only and returns no row data beyond ids, states and versions.</li></ul> | Green on main. The report matches `sqlite3` output on a copy. |
| **0.8 Exports, schema freeze, engine freeze** (1–1.5 d) | <ul><li>`pnpm cosmetics:export-catalog` writes `crates/server/data/{cosmetic-catalog,cosmetic-legacy}.json`.</li><li>`pnpm db:export-migration-ids` writes `crates/server/data/required-ts-migrations.json`.</li><li>`scripts/oracle/dump-meta-fixtures.ts` dumps the inputs and outputs of `tests/season3.test.ts` and `cosmetic-*` to `fixtures/meta/*.json` for the Rust ports.</li><li>Additive schema: `SeasonWeek.previousRaceSeeds String?` (JSON array, used by re-seed). `RaceReplayTrack` final columns per §4.3.</li><li>Declare the TS engine freeze (D28): CI label rule and `docs/balance/README.md`.</li><li>Add the D28 operating rules to `CLAUDE.md` once the user confirms Q6.</li></ul> | `git diff --exit-code crates/server/data/ fixtures/meta/` in CI. |

**Effort:** 23.5–30.5 d.
**Dependencies:** 0.6 needs the production copy and 0.4 deployed. 0.5 and 0.6 deploy together, so pre-S3.15 races never lose animation in between.

### Phase 1: Rust foundations (`rewrite`)

**Goal:** the workspace, determinism scaffolding and the oracle exist before any sim code.

**Deliverables:**

- **Workspace:** `Cargo.toml` (resolver 3, the D1 profiles), `rust-toolchain.toml`, `clippy.toml` (D4 bans).
- **Protocol crate:** `crates/race-protocol` (ids, config input and resolved, `EventKind`, snapshot, result, `replay_track`, `legacy`) with the D4(d) serde_json features, plus a `ts-rs 10` export.
- **Core modules:**
  - `race-core::{math,rng,canonical,digest,hash}`, where `hash::state_bytes` follows D4.
  - `race-core::js_math` (feature `ts-compat`): V8 hypot, exp and pow ports.
  - `race-core::collate_compat` (feature `ts-compat`) with the generated table.
  - `race-core/build.rs`, which computes `ENGINE_BUILD_ID`.
- **Oracle and corpus:**
  - `race-cli corpus gen`. Corpus configs include awkward 17-significant-digit floats.
  - `scripts/oracle/dump-trace.ts` dumps **per-tick state hashes**. A full f64 bit-hex dump is written only for the first divergent case (`--full-at <case>`).
  - The `race-cli oracle diff` skeleton.
  - `race-cli oracle meta` with fixtures in `crates/race-core/tests/fixtures/meta-parity.json.gz`.
- **Measurement:** a WASM perf harness that times a 5,400-tick re-sim of a stub step loop and extrapolates the budget, run in Chromium with 4× CPU throttling.
- **CI:** skeleton jobs `rust`, `wasm`, `determinism`, plus the serde_json feature diff.

**Gate:**

- `cargo clippy -p race-core -p race-protocol --all-features -- -D warnings`
- `cargo test -p race-core --test rng`: the 1M-string UTF-16 hash and first-8-draws fixture from TS, 100% match.
- `cargo test -p race-core --test canonical`: 10k JCS goldens, including `1e+21`, `5e-7` and `-0`.
- `cargo test -p race-core --features ts-compat --test js_math`: 1M inputs each for hypot, exp and pow, bit-equal to Node 24. If not 100%, record the residual rate. That rate becomes G1's allowance, and the item stays flagged.
- `cargo test -p race-core --features ts-compat --test collate`: 1M ids, 100% equal to Node's `localeCompare` sign.
- `state_hash` on a fixed state is identical natively and under `wasm32-wasip1`.
- `! cargo tree -p race-core -e normal --target wasm32-unknown-unknown | grep -E 'getrandom|rand'`

**Effort:** 12.5–14.5 d.

### Phase 2: faithful engine port (`rewrite`)

**Goal:** the Rust engine matches TS S3.15 tick by tick on the corpus (G1). This is test scaffolding, not a ship requirement.

**Deliverables:**

- **M1 core:** track (sim part only), pacing, lane AI, collisions, ranks, gates, result, events, inputs.
- **M2:** items and pickups, plus the white-box test ports.
- **M3:** auto-use AI (faithful `director`/`ChaosUtility` caches as **plain fields**, no `Rc`/`RefCell`), chaos, `loadout_auto`, `validate_loadout`.
- `SimOptions{max_ticks, ai_ablation, loot_override}` and the `EventSink` trait.
- 13 white-box test files ported (111 tests).

**Gate G1:** `cargo run -p race-cli --release -- oracle diff --corpus corpus.jsonl --ts-cmd "node --import tsx scripts/oracle/dump-trace.ts"` must pass on 2,000 cases. That means per-tick state hashes and event streams are 100% bit-exact, **or** at most 0.5% (or the residual rate measured in Phase 1, whichever is larger) of cases first diverge at a call site in `js_math` that was auto-classified as an ulp delta. Meta parity must be 100%. Then tag `engine-port-baseline`.

**Escape hatch:** if M3 runs past its 1.5-week buffer, freeze G1 at "exact up to the first auto-use decision", accept the AI layer on G3 statistics alone, and record the decision in `docs/balance/S3.16.md`.

**Effort:** 36–43 d (M3 is the critical path). **Depends on:** Phase 1.

### Phase 3: Rust server, non-race routes (`rewrite`; runs in parallel with Phase 2)

**Deliverables:**

- **`crates/server` core:**
  - Config and CLI subcommands: `serve | migrate | seed | verify-db | backup | healthcheck | check-schema | diff-since | verify-races | backfill-track | backfill-stats | sim economy | sim gacha`.
  - Pools (D15) and `DbTime` (D13).
- **DB guards at boot, in order:**
  1. Lock (D21).
  2. Parse `DATABASE_URL`.
  3. Refuse to start if the file is missing.
  4. Refuse to start if `SELECT COUNT(*) FROM "SeasonPlayer"` is 0, unless `AUTODUCK_ALLOW_EMPTY_DB=1`.
  5. **Staging sentinel:** with `AUTODUCK_ENV=staging`, require `AppMigration` id `staging-sanitized-*`; in production, refuse to start if that row exists.
  6. Backup (D29).
  7. `integrity_check`.
  8. Schema verifier (D14).
  9. Check the required TS migration ids.
  10. `ensure_imported`.
  11. Crash recovery (D22).
  12. Bind HTTP.
- **`autoduck seed`** is explicit only and refuses a non-empty DB. The destructive `CI=true` upsert path is not ported.
- **Baseline:** `crates/server/migrations/0001_baseline.sql`, generated with:
  ```fish
  pnpm exec prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script \
    | sed -E 's/CREATE TABLE "/CREATE TABLE IF NOT EXISTS "/; s/CREATE (UNIQUE )?INDEX "/CREATE \1INDEX IF NOT EXISTS "/'
  ```
  The verifier is **calibrated on the sanitised production copy**.
- **Static serving:**
  - `dist/` with SPA fallback for extensionless paths outside `/api/`.
  - `/api/*` misses return a JSON 404; a missing file with an extension returns 404.
  - `index.html` is `Cache-Control: no-cache`; hashed assets are immutable.
  - Security headers.
- **Routes:**
  - season3 GET/POST; `redeem` if Q7 says keep.
  - races/:id read side, profile, shop, gacha, admin cosmetics.
  - admin season3, everything except `start-race`, **plus `reseed-week`**. It is allowed only when the week is `locked` and its last race `failed`. It appends the old seed to `SeasonWeek.previousRaceSeeds` and logs an audit line.
  - auth google (D24), avatars (same path as `402676b`, SSRF guard; tokens treated as opaque), `/track`.
- **Meta port:**
  - Players are joined by **`userId`**, never by display name (unlike `season3-race-mapping.ts:14-17`).
  - Shop `seededScore`/rotation and gacha are ported bit-exactly.
  - `AUTODUCK_TEST_RNG_SEED` is compiled only under `#[cfg(feature="test-rng")]`.
- **TS-side deterministic-id hook** for the mutation diff: `lib/test-ids.ts` on main wraps `randomUUID` and `randomInt` (`admin/season3/route.ts:225`, `gacha/pull/route.ts:45`, `admin/cosmetics:78`, `gacha.ts:14`). It honours `AUTODUCK_TEST_RNG_SEED` only when `NODE_ENV==='test'`.
- **`scripts/ops/api-diff.ts`.**
- **Staging:** Dokploy app `autoduck-staging` is created now, with a different `RACE_SECRET_KEY` and `staging.duadzit.wtf` added to the Google OAuth origins.

**Test disposition** (all ported tests use the fixtures from 0.8):

| TS tests | Fate |
|---|---|
| `season3.test.ts` (17) | `crates/server/tests/season3_meta.rs`. The TS file is deleted in the cutover PR. |
| `cosmetic-{economy,gacha,catalog-v2}` (19) | `crates/server/tests/{cosmetics_economy,gacha,catalog}.rs`. TS deleted in the cutover PR. |
| `google-auth` (5) | `crates/server/tests/google_auth.rs` with a local JWKS |
| `race-{api-visibility,runtime,state-machine,telemetry,loadout}` (9) | `crates/server/tests/{race_visibility,live_runtime,state_machine,telemetry,loadout}.rs` (runtime parts in Phase 5) |
| `balance-sim-{determinism,feather}` (9) | `race-cli` tests in Phase 6. TS deleted in Phase 9. |
| race-core white-box (13 files, 111) | Phase 2 |
| `replay-track` | Stays until Phase 9. Rust equivalents live in race-protocol. |
| boss, dragon, shield-economy | Deleted in 0.3a |

After the cutover PR, `pnpm test` covers only the remaining TS tests: cosmetics generator, replay-track, `src/race` units.

**Gate:**

- **Boot on the sanitised production copy:**
  - migrations no-op, 0 fatal drift, all required ids present, 0 rows changed by recovery
  - booting against `dev.db` (races 38–40) also changes 0 rows
- **Guards:**
  - an empty or missing DB is refused
  - the staging sentinel is enforced both ways
- **Diffs:**
  - API diff (TS main vs Rust, same DB copy): 0 unaccepted differences on every GET, with and without a token
  - mutation diff clean
- **Datetime check:** after the mutation diff, every `DATETIME` column except `AppMigration.runAt` matches `GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]+00:00'`.
- **Tests:** all ported tests pass, plus `env SQLX_OFFLINE=true cargo test -p autoduck-server`.
- **sqlx:** `cargo sqlx prepare --workspace --check`.
- **`DbTime`:** round-trips on all stored formats.

**Effort:** 22–30 d. **Depends on:** Phase 1 (protocol, rng, chaos `prepare` for admin), 0.8.

### Phase 4: Vite shell (`rewrite`)

**Deliverables:**

- **Build setup:**
  - `index.html` and `vite.config.ts`, with a proxy to `:3000` that sets `accept-encoding: identity` for SSE.
  - `src/main.tsx` and `src/router.tsx` (redirects keep `search`/`hash`).
  - Fonts, `@tailwindcss/vite`, the `globals.css` move, `components.json` with `rsc:false`, a new `eslint.config.mjs`.
- **Code changes:**
  - Codemod run.
  - Seams switched to the generated `catalog.json`/`versions.json`/ts-rs types, with TS helpers over the D19 tables.
  - Remove `process.env.NEXT_PUBLIC_*`; the client always calls `GET /api/auth/google`.
  - Remove the verify call that pulls in `node:crypto`.
- Runs first against `dev:api:next`, then against the Rust server.

**Gate:**

- `pnpm build` (tsc + vite) is green.
- `client-boundary` is green.
- Every route renders the same as production on a DB copy (checklist screenshot pass).
- The `vite build` output contains no `node:crypto`.
- WASM is absent from the home and rules chunks.

**Effort:** 3.5–5.5 d. **Depends on:** 0.5, Phase 1 codegen.

### Phase 5: WASM, live races, orchestration (`rewrite`)

**Deliverables:**

- **`crates/race-wasm`:** `engineInfo` (returns `engineBuildId`), `normalizeConfig(&str)`, `simulate`, `verifyIntegrity`, `verifyResim`, and class `SimHandle` with `stepTo`, `world`, `drainEvents`, `queueInput`, `stateHash` and `digest`. There is no checkpoint ring.
- **Browser engine loading:** `scripts/build-wasm.sh` (`-C panic=abort`) and `src/engine/index.ts`. The wasm is imported with Vite `?url`, so it is content-hashed, and loaded inside a **Web Worker** (`src/engine/sim-worker.ts`).
- **Rust recorder and stats:** `race_core::replay::TrackRecorder` (Rust DTRK/1 encoder) and `race_core::stats` (`PostRaceStats`).
- **Server live core:** `live/{registry,runtime,session,sse}.rs`.
  - Claim, then a dedicated driver thread per race in `catch_unwind`. A panic records the tick and message, sets the race `failed`, and returns the week to `locked`.
  - `sleep_until` pacing, `MAX_LIVE_RACES=3`.
  - T1/T2 per D23, with the track in T1. Stats and telemetry in `spawn_blocking`. Crash recovery per D22. Graceful shutdown.
- **Server live protocol:** SSE per D16, `X-Accel-Buffering: no`, and compression scoped to `/api` excluding `text/event-stream` (explicit `NotForContentType`). Wild-item POST returns 410. `/api/races/:id/desync` is logged.
- **Server self-checks:**
  - At boot, re-simulate 20 embedded golden `(config, digest)` pairs per `SUPPORTED_REPLAY` entry. On a mismatch, log an error and make `start-race` return 503.
  - A daily 03:00 ICT task runs `verify-races` over every stored race whose version pair is in `SUPPORTED_REPLAY`.
  - At boot, regenerate missing tracks and stats for supported versions.
- **SPA:**
  - `src/race/live-sync.ts` (`ServerClock` and a pure `LiveSync` that applies the confirmed-tick bound, ignores `input.seq <= seqHighWater`, keeps its own hash ring, and calls `/desync` on a mismatch).
  - `LiveDriver` enters only when `hello.engineBuildId` exactly equals `engineInfo().engineBuildId`; otherwise `SnapshotDriver`.
  - Chunked catch-up with a progress state and FX suppression before the join tick.
  - A countdown driven by `countdownEndsInMs`.
  - Race lab on `normalizeConfig` + `SimDriver`.
  - The "Xác minh lại" button only for supported versions.
- **Cleanup:** `TsSimHandle` deleted; the `no-restricted-imports` ban on `packages/race-*` enabled.

**Gate:**

- **Determinism corpus** (D26) is identical across native, `wasm32-wasip1` and the shipped package in Node and in three browsers, on ubuntu x86_64 and macOS arm64:
  ```fish
  env CARGO_TARGET_WASM32_WASIP1_RUNNER="wasmtime run --dir=." cargo test -p race-core --test determinism --target wasm32-wasip1
  node --test tests/wasm-determinism.test.mjs
  pnpm exec playwright test tests/wasm-browsers.spec.ts
  ```
- **Track encoder:** Rust uncompressed bytes equal TS bytes on `fixtures/replay-track/*`.
- **`LiveSync` unit tests** (jitter, reordering, duplicate `hello`, a 30 s background gap, `Lagged` replay): the client never steps past the bound, and its final digest equals `simulate(config, allInputs).digest`. With engine inputs enabled in a test build, inputs arrive before their confirming clock.
- **Live server tests** under `tokio::time::pause()`:
  - countdown, `+6` lead, `Last-Event-ID` resume, `Lagged` recovery
  - both crash-recovery branches; T2 recovery is idempotent (run twice, meta applied once)
  - a deliberately panicking sim leaves the race `failed`, the week `locked` and the server up
  - shutdown waits on a running race
  - the golden self-test blocks `start-race` on a corrupted fixture
- **Load:** 50 SSE clients plus page GETs during a T1 commit: 0 `SQLITE_BUSY`, p99 step jitter under 2 ms.
- **Catch-up:** p95 under 300 ms on Chromium with 4× CPU throttling. If missed, warn only, because the bound keeps it correct.
- **WASM size:** ≤ 350 KB gzip, warn-only until measured.
- **Playwright two-context smoke test** of a test race.

**Effort:** 18–25 d. **Depends on:** the Phase 2 API (M1 for bindings, M3 for the full gate) and Phase 3.

### Phase 6: Phase B fixes and balance acceptance (`rewrite`)

**Deliverables:** fixes F1–F13, one commit each with a paired report:

- F1 byte order
- F2 drop `raceId` from labels
- F3 single 0.15 default
- F4 per-tick caches
- F5 ghost excluded from in-sim ChaosUtility
- F6 squared-distance collector comparator, which removes `hypot` from the sim
- F7 `>=` end events
- F8 reject late inputs
- F9 dead knobs removed via `dead_knob.rs`
- F10 typed boost-start
- F11 overlapping Chaos groups rejected by validation
- F13 feather copy and matrix data aligned with the code

Also:

- CI test that S3.16 keeps every `RaceItemId` from S3.15.
- All `race-cli balance` modes (rayon, seed-ordered folds).
- `docs/balance/S3.16.md` and `artifacts/balance-s3-16/`.
- The frozen insta corpus golden and the `golden-version` CI job, which fails when the corpus changes without a version bump or when `rust-toolchain.toml` changes.
- `race-cli fuzz` as a CI gate (100k configs per PR, 1M nightly).
- `race-cli gate --db <copy>`, which runs the §4.5 gate SQL. It is documented in `docs/balance/README.md` as a precondition of every engine or balance bump.

**Gate G3:** Rust S3.16 against TS S3.15 on identical seeds and lobbies, per engine design §9.4. Thresholds include |Δwin%| ≤ 2 pp per loadout-matrix cell, temperaments within [11.0, 13.8]% and drama within ±0.4 lead changes. Fuzz on 1M configs must give 0 panics, 0 non-finishing races and 0 non-finite values. Run with:

```fish
cargo run -p race-cli --release -- compare ts.json rs.json
```

Any failing metric is bisected to its F-commit, then reverted or signed off (Q3).

**Effort:** 10–12 d. **Depends on:** Phase 2.

### Phase 7: staging, image mode, dry runs (`rewrite`, staging, main)

**Deliverables:**

- **`Dockerfile.rust`:** three stages (rust → node web → debian runtime), `SQLX_OFFLINE=true`, the D20 `.dockerignore`.
- **Production switch to image mode** (one Tue–Thu deploy on main, followed by a test race): Dokploy app → `ghcr.io/shivaluma/autoduck:ts-<sha>` with registry credentials (the repo may be private), auto-deploy off, replicas = 1, stop-first, `stop_grace_period 150s`.
- **Staging data** on a **sanitised** copy:
  ```sql
  UPDATE "SeasonPlayer" SET "accessToken"=lower(hex(randomblob(16)));
  UPDATE "User" SET "email"=NULL,"googleId"=NULL;
  INSERT INTO "AppMigration"(id,name,"runAt") VALUES('staging-sanitized-YYYYMMDD','staging sentinel',CURRENT_TIMESTAMP);
  ```
  `AppMigration.runAt` is the one column that keeps the `CURRENT_TIMESTAMP` format.
- **Staging environment:** `AUTODUCK_ALLOW_OFFSCHEDULE=1` maps to the existing `allowOffSchedule` (`season3-race.ts:88-89`); `AUTODUCK_ENV=staging`.
- **CI:**
  - `db-compat`: Rust writes, then **`main`'s** `prisma/schema.prisma` `db push` must print "already in sync", then the datetime GLOB check runs.
  - The rollback-image prebuild.
- **Docs:** `docs/ops/{cutover-runbook,backup-restore,dokploy}.md`.

**Two dry runs; the second is a timed dress rehearsal including rollback:**

1. Rust boots on a fresh production copy: schema OK, 0 recoveries, and 0 rows changed for the TS-era stuck rows.
2. API diff is clean.
3. Meta parity: weeks 1–12 standings run through TS `resolveSeason3Race` and through the Rust port give identical scars, shields, King, predictions and QP.
4. Week N+1 is opened on Rust. The `chaos:week:N` draw equals the TS draw on the same copy.
5. Three test races and one off-schedule "official" race resolve. Each has a `LIVE_RUST` track written in T1, the digest round-trips, `verify-races` passes, and the live stateHash match rate is 100%.
6. **Deploy during a test race:** stop-first and the 150 s grace let the race finish. The new task waits on the lock and then starts.
7. **Rollback test:** boot the `:ts-<main sha>` image on the Rust-written DB. `db push` says in sync, and the TS UI renders the Rust race from its track, events and standings without simulating it (version guard from 0.5).
8. Restore drill, timed, including `autoduck diff-since`.

**Gate:** the go/no-go list in Phase 8.

**Effort:** 8–11 d. **Depends on:** Phases 3–6.

### Phase 8: cutover (`main`)

**Go/no-go (all required):**

- The §4.5 gate SQL returns 0 rows on production (via the `?report=ops` endpoint or `sqlite3`).
- Every official race is `RECORDED`/`VERIFIED_*`, or its `UNAVAILABLE` is accepted.
- API diff clean, meta parity 12/12, rollback test passed.
- CI green on `rewrite`, including determinism and `golden-version`.
- `ghcr.io/shivaluma/autoduck:ts-<sha of main HEAD>` exists and was booted in the rollback test.
- `:rust-<sha>` is built and **already pulled** on the host.
- Dokploy: image mode, replicas = 1, stop-first, grace ≥ 150 s, auto-deploy off. The volume name and host architecture are known, and the architecture is covered by CI.

**Runbook (Tuesday 10:00 ICT, after week N's Monday race has resolved):**

1. **Announce and freeze.** Announce maintenance and freeze admin actions. Check that nothing is in flight; this must return 0 rows:
   ```sql
   SELECT id,status,"engineState" FROM "Race" WHERE status IN ('pending','running');
   ```
2. **Stop and back up.** Stop the TS app, then take a consistent copy:
   ```sh
   docker run --rm -v <autoduck-data>:/d -v $PWD:/o alpine sh -c 'apk add --no-cache sqlite >/dev/null && sqlite3 /d/autoduck.db ".backup /o/autoduck-pre-rust-YYYYMMDD.db"'
   ```
   Record the sha256, `PRAGMA integrity_check`, and per-table `COUNT(*)` and `MAX(id)`. Keep one copy off-box and one in `/app/data/backups/`.
3. **Tag and merge.**
   - Retag `:ts-<sha>` as `:ts-final`; tag git `ts-final`; create branch `release/ts-final`.
   - Regenerate `required-ts-migrations.json` from `release/ts-final`.
   - Merge the cutover PR. It:
     - renames `Dockerfile.rust` to `Dockerfile`
     - deletes `app/`, the Next config, `next-env.d.ts`, `postcss.config.mjs`, `start.sh`, `auto-migrate.sh`, `lib/db.ts`, `lib/season3*.ts` (client files already moved in 0.5)
     - deletes server cosmetics (`lib/cosmetics/{shop,gacha,economy,inventory}*`), the TS tests ported in Phase 3, and the Next/Prisma runtime deps
     - moves `app/favicon.ico` to `public/` and removes the Next placeholder SVGs
     - **keeps** `packages/race-*`, `lib/racing/**`, `scripts/replay-tracks/**`, `scripts/run-migrations.ts`, `prisma/`, `lib/cosmetics/{catalog,legacy}.ts` and the cosmetics/race-fx generators
     - is green on `client-boundary`
4. **Start Rust.** Set the Dokploy image to `:rust-<sha>` and start it. Expected boot log:
   - lock acquired
   - DB guards ok
   - `VACUUM INTO /app/data/backups/boot-…`
   - integrity ok
   - schema guard ok (compat, 0 fatal)
   - required TS ids present
   - ensure-imported 0 new
   - track gate 0 missing
   - golden self-test ok
   - 0 recoveries
5. **Read smoke test:**
   - `/api/health`
   - `/season-3?token=` for two players
   - admin GET (no `raceSeed` in the payload)
   - one replay each of `RECORDED`, `VERIFIED_DIGEST`, `VERIFIED_EVENTS` (if any) and `UNAVAILABLE`
   - Google login on a linked account
   - shop and gacha reads
6. **Open week N+1** on Rust.
7. **Test race end to end:** SSE v2, `LiveDriver` engaged, track written in T1, digest ✓.
8. **Compare and lift maintenance.** Compare row counts with step 2; only the week N+1 opening and test-race rows should be new. Lift maintenance and watch the logs for an hour.
9. **Next Monday:** a test race at 09:00 ICT, then the first official race on S3.16.

**Rollback** (triggers: an official race fails, data is wrong, or an unrecoverable runtime error):

1. Stop the app.
2. **Decide whether to restore.** Keep the current file unless `integrity_check` fails or the meta-parity check fails.
   - If a restore is unavoidable, first run `docker run --rm -v <vol>:/app/data :rust-<sha> autoduck diff-since --since <cutover ISO> --out /app/data/backups/diff-….json`. It is read-only, takes no lock, and dumps every row whose `createdAt`/`updatedAt` is after cutover or whose id is above the step-2 `MAX(id)`.
   - Restore, then re-apply or refund from the dump and announce it.
3. Set the Dokploy image to `:ts-final`.
4. TS boots. `db push` is a no-op (proved in Phase 7). `ensure-imported` runs. Rust-run races render from their tracks; the version guard prevents TS from simulating them.
5. Fix stuck races with the documented SQL. It uses `strftime('%Y-%m-%dT%H:%M:%f+00:00','now')` and touches only the stuck race and its week.

This works because of four rules:

- Rust makes no DDL and writes no `rs-*` rows in compat mode.
- Rust writes Prisma-format datetimes and sets timestamps explicitly.
- Rust never creates `_sqlx_migrations`.
- TS refuses to simulate 2.x configs.

**Between cutover and PONR**, cosmetic ID retirement and other data migrations are frozen.

**Effort:** 1–2 d plus a week of on-call.

### Phase 9: point of no return and retirement (`main`)

**Trigger:** two official Rust races OK, the gate SQL at 0, no rollback needed.

**Steps, as separate deploys:**

1. **Tag and delete code.** Tag `ts-engine-final`. Delete:
   - `packages/race-*`, `lib/racing/**`, the TS engine tests, `scripts/race-*`, the balance scripts, `scripts/lib/balance-sim-*`
   - `scripts/replay-tracks/{resolve-*,headless-check}.ts`, `scripts/run-migrations.ts`, `scripts/migrations/`, `scripts/auto-migrate.sh`
   - `prisma/` (schema, seed, config, generated), the `prisma`/`@prisma/*`/`better-sqlite3` packages, `zod` (unless the SPA uses it) and `@tailwindcss/postcss`
   - the `ts-compat` feature, `js_math`, `collate_compat` and the oracle scripts
   - `pnpm-workspace.yaml` `allowBuilds` entries that are no longer needed

   `scripts/replay-tracks/ensure-imported.ts` is replaced by the Rust step. The Rust `replay_import` keeps reading `artifacts/replay-tracks/`. `economy:simulate`/`gacha:simulate` become `autoduck sim economy|gacha`.
2. **Owned mode.** Insert the `rs-ponr` marker row and set `AUTODUCK_SCHEMA_MODE=owned`.
3. **Archive legacy tables.** `VACUUM INTO autoduck-legacy-archive-YYYYMMDD.db` (kept off-box), then `rs-0010-drop-legacy-v2`, dropping children before parents (`DragonItemEvent` … `WeeklyTick`). As built: 11 tables; `CommentaryLog` is kept because race detail reads it (`docs/rewrite/phase9-db-notes.md`).
4. **WAL**, in its own deploy. Backups already use `.backup`/`VACUUM INTO`.
5. **Non-root** (optional), in a separate deploy: an entrypoint runs `chown -R app /app/data && exec setpriv --reuid app …`.
6. **Volumes and env.** Drop the `autoduck-videos` volume and the dead env vars. **Keep the R2 bucket and credentials** (avatars and off-box backups).
7. **Docs and rules:**
   - `CLAUDE.md`: Cargo layout, `race-cli` commands, fish `env` usage, DB owned by `crates/server/migrations`, the replay model, the golden-digest rule, D28, and cosmetic retirement as "edit `legacy.ts` → export JSON → `rs-` data migration".
   - `.cursor/rules/nodejs-pnpm-fish.mdc`: add cargo rules.
   - `docs/racing-engine-plan.md`: a "TS engine 1.x, retired" section.
   - `docs/balance/README.md` and `docs/replay-tracks.md`.
   - README: remove "Deploy on Vercel".

**Kept forever:** the cosmetics and race-fx generators (TS, with Playwright as a devDependency), `artifacts/replay-tracks/` and `public/race-tracks/`.

**Effort:** 3–5 d.

---

## 4. Old-race handling (final design)

### 4.1 Facts (verified)

**No positions are stored:**
- `RaceEngineEvent` holds `type, tick, timestampWithinRaceMs, source, target, metadataJson` (`prisma/schema.prisma:84-99`).
- Season 3 runs with `persistDuringRace:false` (`season3-race.ts:266`), and `liveSnapshotJson` is nulled on resolve (`:466`).
- The replay player and canvas re-simulate from the seed with HEAD code (`phaser-race-canvas.tsx:1282-1336`; `replay.ts:5-18`).

**Meta events in the engine table:**
- `CHAOS_RESOLVED` (`season3-race.ts:314-323`) and `QP_TRACK_REWARD_GRANTED` (`:446-456`) live in the same table.
- Every comparison excludes them.

**The current TS engine does not reproduce old digests.** Re-run on the scratchpad `dev.db` copy:

| Race (version, track) | HEAD | `09add72` | `98e4ecc` | `4037abf` | `695f5ea` |
|---|---|---|---|---|---|
| 35 (1.1.0/S3.2, river-01-v1) | ✗ | digest ✓ | digest ✓ | digest ✓ | digest ✓ |
| 36 (1.1.0/S3.2, river-01-v1) | ✗ | digest ✓ | digest ✓ | digest ✓ | **digest ✗, signature ✓** |
| 37 (1.2.0/S3.4, river-01-v2) | ✗ | Zod error | Zod error | ✗ (360 vs 395 events) | digest ✓ |

- The `replay.ts:7-8` allowlist entries for S3.2 and S3.9 are therefore false. The tests behind them are deleted in the port.
- Race 37 was created at 11:14 UTC, before `695f5ea` was committed at 12:00 UTC, so it ran from a dev working tree.

**TS digests can't be recomputed from rows.** `audit.ts:4-11` emits a literal `undefined` for undefined values, so only re-simulation can reproduce a TS-era digest.

**Track geometry is not immutable:**
- `river-01-v1` exists (races 35–36).
- `river-01-v2` gained 4 boost gates in `6e3f689` (2026-08-17) without a version bump.
- The canvas draws gates and zones from HEAD `createRiverTrack`.

**Failed races keep stale `engineState`:** races 38–40 are `status=failed, engineState=FINISHED`. TS failure handling (`season3-race.ts:484-485`) doesn't reset it.

**The engine is unchanged since S3.15:**
- `git log 9ee0962..HEAD -- packages lib/racing lib/season3-race.ts lib/season3-race-mapping.ts` is empty, so every race since 2026-10-06 should verify at HEAD.
- Before that, 46 engine commits. Several changed output without a version bump, so the search must be by commit.
- `0b67096` persisted events during the race with `fireAndForget`. For that commit's era, DB event rows may be reordered or missing, and only the digest is authoritative.

**`dev.db` is stale:** it has 15 `AppMigration` ids; production should have 16.

### 4.2 DTRK/1 format (`lib/racing/replay-track/format.ts`, mirrored in `race_protocol::replay_track`)

```
payload (LE): "DTRK" | u16 version=1 | u16 flags | u32 headerLen | header (UTF-8 JSON, sorted keys, no undefined)
              then sections: u8 id | u32 byteLen | bytes          — stored gzip, served Content-Encoding: gzip
header: { raceId, tickRate, firstTick:0, lastTick, stride:1, trackVersion, trackGeometry:"<trackVersion>@<sha8>",
          ducks:[playerId…] (sim order), effects:[…], wildItems:[…], pickupTypes:[…], hazardTypes:[…],
          q:{progress:16777216, speed:16777216, lateral:32767},
          engine:{impl:"ts"|"rust", engineVersion, balanceVersion, commit, build}, source, fidelity, resultDigest }
§1 DUCK_COLUMNS  per column, all ducks × samples: progressΔ i32 (js_round(p·2^24) delta), speedΔ i32, lateral i16, rank u8
§2 DUCK_CHANGES  {u32 tick, u8 duck, u8 kind, payload}: WILD_ITEM_SET{item,acquiredAtTick,instanceId}, WILD_ITEM_CLEAR,
                 REGULAR_PICKUP_COUNT{u8}, EFFECTS_SET{n, effectIdx…}  (exact activeEffects order)
§3 ENTITIES      pickups/hazards/bananas: id, type, srcDuck|0xFF, f64 progress, f64 lateral, f64 radius|NaN,
                 firstTick, lastTick, state changes (finalize() asserts static positions; else flag bit0 + per-sample)
§4 ROCKETS       id, kind, src, tgt, firstTick, n × i32 progress·2^24
§5               reserved (candidate event stream; only if Q10 = yes)
```

**As built on main in 0.4 (`0c355e4`, see `docs/replay-tracks.md`), the Rust mirror must match these three choices:**

- **§4 ROCKETS has a retarget list:** each rocket also stores `u16 r | (u32 tick, u8 tgt) × r`.
- **`tickCount` is the last tick:** samples = `tickCount + 1`, counting from tick 0.
- **Unfinished progress is capped:** a duck that hasn't finished has its quantised progress capped at `2^24 − 1`.

Prisma's `db push` gives `RaceReplayTrack.raceId` the DDL `INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT`. The D14 verifier must expect this.

TS and Rust tracks of the same race are not required to be byte-identical. TS quantises lateral through an f32 intermediate.

**Rules:**

- `byteSha256` and the ETag are sha256 of the **uncompressed** payload.
- The decoder yields the `Pick<StateSnapshotMessage,'ducks'|'pickups'|'hazards'|'rockets'|'bananas'>` that `applyWorld` takes (`phaser-race-canvas.tsx:806`).
- Events come from DB rows `ORDER BY id`, excluding meta events, and pass through `event-vocab` normalisers for historical shapes.
- Geometry comes from `public/race-tracks/<trackGeometry>.json`.

**Old snapshot shapes.** Commits before `695f5ea` lack `snapshotRaceWorld`. Fall back to `{ducks: snapshotSimulation(s)}` and fill protocol defaults (`null`, `0`, `[]`).

### 4.3 Table (Prisma, added on main in 0.4; Rust uses the same columns)

```prisma
model RaceReplayTrack {
  raceId           Int      @id
  format           String   // "dtrk/1"
  source           String   // LIVE_TS | BACKFILL | LIVE_RUST
  fidelity         String   // RECORDED | VERIFIED_DIGEST | VERIFIED_EVENTS | UNAVAILABLE
  engineImpl       String   // ts | rust
  engineCommit     String?  // git sha (TS build / resolver candidate / Rust build commit)
  engineBuild      String?  // Rust ENGINE_BUILD_ID
  engineVersion    String
  balanceVersion   String
  trackVersion     String
  trackGeometry    String?  // "<trackVersion>@<sha8>"
  tickRate         Int
  tickCount        Int
  stride           Int      @default(1)
  reproducedDigest String?
  byteSha256       String?  // sha256 of UNCOMPRESSED payload
  bytes            Bytes?   // gzip; null iff UNAVAILABLE
  statsJson        String?  // frozen PostRaceStats
  note             String?  // e.g. "digest envelope differs", "outcome-match@<sha>"
  createdAt        DateTime @default(now())
  race Race @relation(fields: [raceId], references: [id], onDelete: Cascade)
}
```

`SeasonWeek.previousRaceSeeds String?` is also added in 0.8.

### 4.4 Historical resolver (`pnpm replay:resolve --db <sanitised copy> --out artifacts/replay-tracks`)

**Scope.** Every race with `engineConfigJson IS NOT NULL AND status='finished'` and no `RaceReplayTrack` row. Test races are included; if the bundle exceeds 20 MB, test races are skipped and marked `UNAVAILABLE`.

1. **Environment.**
   - Workers run inside `mcr.microsoft.com/playwright:v1.59.1-noble` (production's base image until 0.3b), with the production `LANG`/`TZ` if known.
   - `manifest.json` records `process.versions.{node,v8,icu}` and `Intl.Collator().resolvedOptions().locale`.
   - **Calibration first:** races after 2026-10-06 must reproduce at HEAD as `VERIFIED_DIGEST` before any older race is trusted.
2. **Candidate commits.**
   - **Source:** first-parent commits touching `packages/race-core`, `packages/race-protocol` or `lib/racing/{audit,persistence,runtime}.ts`.
   - **Extras:** hits from `git fsck --unreachable | grep commit` and the reflog. Run `git config gc.reflogExpireUnreachable never; git config gc.pruneExpire never` on every machine that may hold them.
   - **Dedupe key:** the composite of the `packages` tree hash plus the blobs of `audit.ts`, `persistence.ts` and `runtime.ts`.
   - **Order:**
     1. Dokploy deployment history (sha plus time), if available (Q2). Otherwise recent GitHub push events: `gh api repos/shivaluma/autoduck/events`.
     2. The newest commit with committer date ≤ `Race.createdAt`, plus the 3 before it.
     3. The rest of that balance-label range.
     4. HEAD.
     5. All remaining commits.
3. **Extraction and isolation.**
   - `git archive <sha> packages lib tsconfig.json package.json pnpm-lock.yaml | tar -x -C .cache/engines/<key>`, with `node_modules` symlinked. Zod has been 4.3.6 throughout Season 3.
   - Each candidate runs in a **child process** with `cwd=.cache/engines/<key>` and `TSX_TSCONFIG_PATH` set to that directory's tsconfig: `node --import <abs tsx loader> --import <abs guard-hook.mjs> resolve-worker.mts`. The race arrives on stdin.
   - `guard-hook.mjs` is a `module.register` resolve hook that throws if any resolved path outside `node_modules` is not under the extraction directory. This matters because `lib/racing/persistence.ts` imports `@/packages/...` at runtime.
   - A ZodError means "not this commit". Fallback: re-run the top 3 candidates with that commit's own lockfile installed.
4. **Simulate.**
   - Use that commit's `raceConfigSchema` and `createSimulation`/`stepSimulation`.
   - Inputs are **all** `WILD_ITEM_MANUAL_INPUT` rows, sorted as `persistence.ts:57` does.
   - Record from tick 0, with exact f64 `duck.speed`. Compute that commit's `createResultDigest`.
5. **Grade.** Stop at the first `VERIFIED_DIGEST`.
   - **`VERIFIED_DIGEST`:** the digest equals the stored `resultDigest`.
   - **`VERIFIED_EVENTS`:** the full stream matches: `type`, `tick`, `timestampWithinRaceMs`, `source ?? null`, `target ?? null`, and deep-equality of `JSON.parse(JSON.stringify(metadata))` against `JSON.parse(metadataJson)`, with rows ordered by `id`. It counts only when the digest is null, or when it is stored but no candidate reproduces it (note "digest envelope differs"). It is never accepted for races created in the `0b67096` era.
   - **`UNAVAILABLE`:** nothing else reproduces. If finish order and `RaceParticipant` order match at some candidate, the note records `outcome-match@<sha>` for diagnostics. **No bytes are stored**, never a HEAD re-sim and never a synthesised track.
6. **Geometry.** For each graded race, export that commit's `createRiverTrack(trackVersion)` as `{sim, render}` JSON, hash it, and write `public/race-tracks/<trackVersion>@<sha8>.json` if new. Set `trackGeometry` in the header.
7. **Stats.** `statsJson` is the HEAD `buildPostRaceStats` aggregation over the stored events, with motion from the track's speed column and baseline ranks from the same commit's `-post-race-baseline` sim.
8. **Output:**
   - `<raceId>.dtrk.gz`
   - `manifest.json` with `raceId`, `resultDigest`, `configSha256`, `reproducedDigest`, `fidelity`, `engineCommit`, `trackGeometry`, `byteSha256`, `tickCount`, `note`, plus the environment block
   - `REPORT.md` with the census and per-race outcome; ids, versions and grades only, no player names
9. **Import.** `ensure-imported` runs on every boot, is not ledgered and never exits non-zero. For each manifest entry whose `raceId` has no row, it:
   - checks the guard: the production `resultDigest` (or `sha256(engineConfigJson)` when the digest is null) equals the manifest value
   - checks that the gunzipped bytes hash to `byteSha256`
   - inserts the row

   It catches errors per race and logs `imported N, skipped M, rejected K` with a reason for every rejection.
10. **Gaps.** Any race left without a row is re-run with `--race N`, appended to the manifest, and imported on the next deploy.
11. **Headless check.** `headless-check.ts` and `/dev/replay-check` (0.6 gate) must pass over every imported race before the 0.5+0.6 deploy.

### 4.5 Census and gates

```sql
-- census (run on the sanitised prod copy first)
SELECT "isTest", status, "engineVersion", "balanceVersion", "trackVersion", COUNT(*) n,
       SUM("resultDigest" IS NOT NULL) digests, MIN("createdAt"), MAX("createdAt")
FROM "Race" WHERE "engineConfigJson" IS NOT NULL GROUP BY 1,2,3,4,5 ORDER BY MIN("createdAt");
SELECT COUNT(*) FROM "RaceEngineEvent" WHERE type='WILD_ITEM_MANUAL_INPUT';   -- expected 0 (no UI)
SELECT id,status,"engineState" FROM "Race" WHERE status IN ('pending','running','failed');   -- stuck/failed inventory

-- GATE before cutover, before TS engine deletion, and before EVERY engine/balance bump: must return 0 rows
SELECT r.id, r."balanceVersion" FROM "Race" r LEFT JOIN "RaceReplayTrack" t ON t."raceId"=r.id
WHERE r."engineConfigJson" IS NOT NULL AND r.status='finished' AND t."raceId" IS NULL;

-- fidelity report
SELECT t.fidelity, r."balanceVersion", r."isTest", COUNT(*) FROM "RaceReplayTrack" t
JOIN "Race" r ON r.id=t."raceId" GROUP BY 1,2,3;
```

**Where these queries run:**

- `sqlite3` in the container (from 0.1).
- `GET /api/admin/season3?report=ops` (from 0.7; ported to Rust).
- `race-cli gate --db`.

The Rust server runs the gate at boot and logs the count. Before that, it regenerates any missing tracks for supported versions. It never refuses to start because of the gate.

### 4.6 How old races are served and shown

- **`GET /api/races/:id`** adds `replay: { mode:'track'|'none', fidelity, trackUrl:'/api/races/:id/track?h=<byteSha256>', geometryUrl, verify:'wasm'|'none' }`. `verify` is `wasm` only when `(engineVersion, balanceVersion)` is in `race_core::SUPPORTED_REPLAY` (initially `2.0.0/S3.16`) **and** the client's `engineBuildId` matches `RaceReplayTrack.engineBuild`. It is never offered for TS-era races.
- **`GET /api/races/:id/track?h=…`** returns the stored gzip bytes with `Content-Encoding: gzip`, `Cache-Control: public, max-age=31536000, immutable` and `ETag: "<byteSha256>"`. Without `h`, or with a stale `h`, it returns `Cache-Control: no-cache`. If the client doesn't accept gzip, the server decompresses with `flate2`.
- **Legacy configs** parse only into `LegacyRaceConfigV1` and are never simulated, in Rust or in the TS rollback image.

| Fidelity | Badge |
|---|---|
| `RECORDED` / `VERIFIED_DIGEST` | `✓ Ghi hình khớp kết quả gốc · engine {engineVersion}/{balanceVersion}` |
| `VERIFIED_EVENTS` | `✓ Diễn biến khớp toàn bộ · digest gốc chưa tái lập được` |
| `UNAVAILABLE` | No canvas: `Replay không khả dụng cho race này`. Results, timeline, combat and event-derived stats still show (speed columns hidden). |

---

## 5. Risk register

| # | Risk | Likelihood | Impact | Mitigation | Phase |
|---|---|---|---|---|---|
| R1 | Some production races don't reproduce at any commit (dirty or unpushed builds, deploy lag, different Node/ICU) | Low–Med | Med: lost animation | Calibration at HEAD first; production base image; reflog/fsck/push-event candidates; lockfile fallback; user accepts exceptions | 0 |
| R2 | A live recording fails, or crashes a race | Low | **High** if it throws in the tick loop | Infallible `push`, typed arrays, kill switch `REPLAY_TRACK_RECORDING=0`, finalize after resolve, self-check, gate SQL, HEAD backfill (TS) or boot regeneration (Rust) | 0, 5 |
| R3 | The faithful AI port (M3) overruns | **High** | High (critical path) | 1.5-week buffer; oracle localises divergences; G3-only escape hatch | 2 |
| R4 | V8 vs libm math blocks G1 | Med | Low | `js_math` ports with a 1M differential gate; measured allowance; irrelevant after Phase B | 1–2 |
| R5 | Native↔WASM divergence (FMA, NaN, ±0, sort, libm, serde feature unification, `usize`) | Low | High: live desync, wrong verify | D4 (a)–(g), explicit `state_hash`, `motionSha256`, corpus on 3 runtimes, 3 browsers and 2 arches; build-id match before `LiveDriver`; desync telemetry | 1, 5 |
| R6 | S3.16 balance shift noticeable mid-season | Med | Med | G3 thresholds; per-fix bisect; season-boundary default with one engineer (Q1/Q5) | 6 |
| R7 | RNG drift changes weekly Chaos draws or auto-loadouts | Low | High | Bit-identical rng; 10k meta-parity fixtures; live `chaos:week:N` check in the Phase 7 dry run | 1–2, 7 |
| R8 | Rust writes something the rollback image can't read | Low | High | D13/D14; no sqlx chrono/time; explicit timestamps; datetime GLOB CI; `db-compat`; rollback rehearsal; TS version guard | 3, 7 |
| R9 | Prisma `db push` drops or blocks on something during rollback | Low | High | 0.1 removes `--accept-data-loss`; boot backups; schema freeze; rehearsal must print "already in sync" | 0, 7 |
| R10 | Two containers on one SQLite file, or a stalled deploy | Med | High | Lock before bind; liveness-only healthcheck; stop-first; grace 150 s; tested by deploying during a test race | 7–8 |
| R11 | SIGTERM during a live race | Low | Med | 120 s graceful wait; D22 recovery (DB-only T2, idempotent) | 5, 8 |
| R12 | SSE buffered or compressed by Traefik, Cloudflare or tower-http | Med | Med | `X-Accel-Buffering: no`; explicit `NotForContentType("text/event-stream")`; staging test; check whether Cloudflare is in front (Q2) | 5, 7 |
| R13 | API shape drift breaks SPA screens | Med | Med | API diff harness on a production copy; ts-rs DTOs | 3 |
| R14 | Google login regression after the fix | Med | Med | `googleId` census; email fallback for non-`sub` ids; local-JWKS tests; production smoke test with a linked account; the magic link still works | 0 |
| R15 | Production DB copy leaks PII or tokens | Low | High | Pulled only via host `.backup`; sanitised at once; kept outside the repo and scratchpad; deleted after 0.6; no snapshot endpoint; artifacts hold ids and positions only | 0, 7 |
| R16 | Repo bloat from committed tracks | Low | Low | About 140 KB per race; skip test races above 20 MB | 0 |
| R17 | Merge conflicts on the long-lived branch | Med | Med | Seams and client moves on main; codemod; additive Rust; weekly merges (8 d budgeted) | all |
| R18 | Unverified crate or toolchain details (`ryu-js` no_std, `libm` `force-soft-floats`, ts-rs adjacently tagged enums, `File::try_lock`, sqlx `begin_with` and default journal mode, `jsonwebtoken::DecodingKey::from_jwk`, per-package `overflow-checks`) | Med | Low | Each has a fallback: an adapter over `ryu`, a pure-Rust libm without the feature, a codegen template, `fs4`, raw `BEGIN IMMEDIATE` plus explicit pragmas, a hand-built key, `overflow-checks` on the whole release profile | 1–5 |
| R19 | WASM too large or catch-up too slow on mobile | Low–Med | Low | Lazy load in a Worker; chunked catch-up; the confirmed-tick bound keeps it correct; binaryen later | 5 |
| R20 | Spoilers once RACING (client fast-forward) | Certain | Low | Accepted: predictions and loadouts lock before start; seed hidden until RACING | 5 |
| R21 | Crash recovery touches TS-era or already-resolved rows | Low (after fix) | **High** | D22 selection (engine major ≥2, `pending/running`, week must be `racing` with a matching `raceId`); boot test on `dev.db` races 38–40 | 3, 5 |
| R22 | Rust opens an empty or wrong DB and seeds it | Low | **High** | Own URL parsing, `create_if_missing(false)`, non-empty check, no seed on boot, staging sentinel | 3 |
| R23 | Version skew between a cached SPA/WASM and the server | Med | Med | `engineBuildId` in `hello`; content-hashed wasm; `index.html` `no-cache` | 5 |
| R24 | A deterministic engine panic locks a week forever (after F2) | Low | High | `catch_unwind` record; admin `reseed-week`; fuzz CI gate; overflow checks | 3, 5, 6 |
| R25 | A Monday deploy through auto-push plus auto-deploy | Med | High | D28: auto-deploy off; manual Tue–Thu deploys; user confirms (Q6) | 0 |
| R26 | A rollback restore silently drops post-cutover player data | Low | Med | Narrow "suspect" definition; `autoduck diff-since` before any restore | 8 |

---

## 6. Open questions for the user

1. **Cutover timing vs season.** Does Season 3 have an end date now that it has been extended? With one engineer (Q5), cutting over at a season boundary is the default. It lets S3.16's balance start fresh and relaxes RNG continuity.
2. **Production access.** Who pulls the production DB copy (host `sqlite3 .backup` or `docker exec … node -e "…backup(…)"`), and when? Can someone confirm these Dokploy settings? The Dokploy MCP failed to connect in this session.
   - host CPU architecture and RAM
   - Swarm update order and stop grace
   - volume names
   - auto-deploy (to be turned off)
   - deployment history (sha plus time)
   - whether volume backups to S3/R2 are supported
   - image-mode registry credentials
   - whether Cloudflare fronts duadzit.wtf
   - whether `staging.duadzit.wtf` is OK
3. **Balance sign-off.** If a G3 metric falls outside its threshold, do you want to review each deviation in `docs/balance/S3.16.md`, or delegate that?
4. **Manual wild items.** Should the in-race manual item UI come back? Until it does, `POST /wild-item` returns 410; protocol v2 and the engine keep input support.
5. **Staffing.** Is there a second engineer? This decides between roughly April 2027 and roughly August 2027 (§7).
6. **Deploy rule vs auto-push memory.** Your memory says "commit+push to main after each finished change". With D28, pushes stay free but Dokploy auto-deploy is turned off and production deploys are manual, Tuesday to Thursday. Do you accept this and want it added to `CLAUDE.md`? An agent can't change your memory rule.
7. **`/api/season3/redeem`.** It is a Season 3 feature with no UI caller, though rewards are still created (`admin/season3/route.ts:226`). Keep it (port to Rust) or delete it?
8. **Repo visibility.** Is `shivaluma/autoduck` public? Committed artifacts hold race ids, player ids, positions and digests, with no names or tokens.
9. **`RACE_SECRET_KEY`.** If it is shorter than 16 characters, when should it be rotated? It only warns until then.
10. **Approximate replays.** For races graded `UNAVAILABLE` with an `outcome-match` note, do you want a later opt-in "approximate" replay that drives FX from the candidate engine's own events (DTRK §5)? The default is no.

---

## 7. Total effort

| Phase | Engineer-days |
|---|---|
| 0 Main prep (boot safety, backups, security, legacy removal, image, live recording, viewer and seams, resolver, CI, freezes) | 23.5–30.5 |
| 1 Rust foundations (incl. `js_math`, collation, `state_hash`, perf harness) | 12.5–14.5 |
| 2 Faithful engine port (G1) | 36–43 |
| 3 Rust server, non-race routes (incl. test ports, DB guards, verifier calibration, TS id hook, cosmetics sims) | 22–30 |
| 4 Vite shell | 3.5–5.5 |
| 5 WASM, live (no rollback; Web Worker), orchestration, self-checks | 18–25 |
| 6 Phase B and balance (G3) | 10–12 |
| 7 Staging, image mode, dry runs | 8–11 |
| 8 Cutover | 1–2 (+ on-call week) |
| 9 Retirement and docs | 3–5 |
| Weekly main→rewrite merges (about 17 weeks) | about 8 |
| **Total** | **≈146–187 engineer-days (29–37 engineer-weeks)** |

**Calendar:**

- **Critical path.** Phases 1 → 2 → 5 (engine part, about 10–13 d) → 6 → 7 → 8 total about 78–96 engineer-days, roughly 16–19 weeks.
- **Two engineers** (one on the engine; one on Phase 0, then server and SPA): cutover is realistic around **April 2027**, allowing for Tết (early February 2027).
- **One engineer:** about 8–9 months, around **August 2027**. Then a season-boundary cutover is the default.
- **Phase 0** is independent and delivers value immediately: closing a live account takeover and the admin fail-open, boot backups, exact recordings of every race once 0.4 deploys, and honest old-race replays with the right geometry.

**Unverified:**
- Production race and version mix, `RACE_SECRET_KEY` length, `googleId` contents, journal mode, Node version in the Playwright image.
- Dokploy configuration, and whether Cloudflare is in front.
- Exact crate patch versions; no cargo or network was used in this session.
- `libm` `force-soft-floats` and serde_json `float_roundtrip` names in the pinned versions; `ryu-js` under no_std.
- sqlx 0.8 default journal mode and whether `begin_with` exists; per-package `overflow-checks`.
- tower-http's SSE compression predicate.
- V8 vs fdlibm bit-equality for exp and pow (the gate measures it).
- WASM size and mobile catch-up time.
- Repo visibility.

---

## Review disposition

**Feasibility review**
- B1 SPA imports server/engine modules: **fixed.** D18/D19 seams and client `git mv` on main in 0.5; catalog tables plus TS helpers; CI `client-boundary`; the Phase 8 list keeps client files.
- B2 track geometry not immutable: **fixed.** Content-addressed `<trackVersion>@<sha8>` files from the reproducing commit; `trackGeometry` header and column; per-geometry gate in 0.6; v1 included.
- M1 Phase 0 schedule and order: **fixed.** Deadline dropped (C28), batches A–E, HEAD backfill covers the gap; the raw-json interim was rejected (C29).
- M2 0.3 breaks `run-migrations.ts` and others: **fixed.** `legacy-helpers.ts`, explicit test and script deletions, docker-compose cleanup, CI `migrations` job.
- M3 ~50 tests unplanned: **fixed.** Phase 3 test-disposition table, fixtures dumped in 0.8, ports in the Phase 3 gate.
- M4 rollback netcode for zero users: **fixed.** Confirmed-tick bound, no rollback or checkpoint ring, wild-item POST 410 until Q4 (D16, C10).
- M5 G1 vs V8 math: **fixed.** `js_math` in `ts-compat` with a 1M differential gate in Phase 1; measured allowance.
- M6 no SQL client in production: **fixed.** `sqlite3` in the runner (0.1) plus the `?report=ops` admin endpoint (0.7).
- M7 OUTCOME_MATCH incoherent: **fixed.** Option (a) chosen (C26); stored as `UNAVAILABLE` with a note; option (b) is Q10.
- M8 historical event vocabularies: **fixed.** Headless Node and Playwright pass over every imported race gating 0.6; `event-vocab` normalisers.
- M9 TS engine changes during the rewrite: **fixed.** D28 freeze with CI label rule and bump-plus-port requirement.
- M10 auto-push memory conflict: **fixed.** D28 gates deploys rather than pushes; user confirmation is Q6.
- M11 Rust build on the Dokploy host: **fixed.** CI-built images, image mode from Phase 7, `SQLX_OFFLINE`, `.dockerignore` (D20).
- M12 effort understated: **fixed.** §7 restated as 146–187 d; staffing is Q5.
- m1 redeem is not v2: **fixed.** Kept pending Q7; D25 lists 17 routes.
- m2 one-shot import migration: **fixed.** Non-ledgered `ensure-imported` (C7).
- m3 hard-coded 16 ids: **fixed.** Generated `required-ts-migrations.json`; dev-mode warning.
- m4 gates reference future items: **fixed.** 0.4 uses a production test race; `db-compat` uses main's schema; go/no-go uses the existing `:ts-<sha>`, retagged in step 3.
- m5 lint not green: **fixed.** `tmp/**` ignored in 0.1, live-code fixes budgeted in 0.7.
- m6 orphaned tooling: **fixed.** `autoduck sim economy|gacha`; `cosmetic-legacy.json` export; retirement workflow after PONR; contact sheet keeps Playwright as a devDependency.
- m7 deletion list errors: **fixed.** Phase 8/9 lists corrected (`scripts/run-migrations.ts`, postcss, `next-env.d.ts`, favicon, SVGs, cursor rules, `allowBuilds`).
- m8 Google env fallback and key length: **fixed.** D24 audience fallback with 503 plus log; key length checked in 0.2; C27.
- m9 resolver `@/` isolation and dedupe: **fixed.** `cwd` plus `TSX_TSCONFIG_PATH` plus guard hook; composite dedupe key (§4.4 steps 2–3).
- m10 gzip hashing: **fixed.** `byteSha256`, ETag and C3 over the uncompressed payload.
- m11 tick-0 sample: **fixed.** `firstTick:0`, captured in `beforeTick`.
- m12 oracle size: **fixed.** Per-tick state hashes, full dump only for the first divergent case.
- m13 backup retention: **fixed.** D29.
- m14 verifier normalisation: **fixed.** D14 name-keyed comparison, fatal only on missing tables or columns Rust queries.
- m15 join by userId: **fixed.** Phase 3 meta port.
- m16 staging Google login: **fixed.** OAuth origin added in Phase 3; linked-account smoke test only in production (Phase 8 step 5).
- m17 R2 bucket: **fixed.** D25 and Phase 9 keep the bucket and credentials.
- m18 wasm-bindgen pin and `! grep`: **fixed.** D27 pins the newest release at branch cut; Phase 1 gate uses `! grep`.

**Determinism review**
- A1 serde_json feature unification and float parsing: **fixed.** D4(d)(e), hand-written JCS, raw-string `normalizeConfig` (D8), 17-digit corpus floats.
- A2 `stateHash` encoding: **fixed.** Explicit LE `state_bytes` with NaN and −0 rules; `usize` banned; cross-target unit test.
- A3 digest lacks positions: **fixed.** `motionSha256` in the envelope; the corpus compares the hash chain.
- A4 libm and std float paths: **fixed.** `force-soft-floats` if available; persisted floats only in race-core (`race_core::stats`); server bans std transcendentals.
- A5 codegen re-emitting geometry: **fixed.** Geometry JSON is the source; Rust checks only the sim-part sha (C4).
- A6 toolchain, stack, browsers: **fixed.** Toolchain bump treated as an engine change; deep-stack case; three-browser corpus run.
- B1 rollback unnecessary, +6 = 100 ms: **fixed.** Confirmed-tick bound, input-before-clock rule, no checkpoint ring; C10 corrected.
- B2 version skew: **fixed.** `ENGINE_BUILD_ID` in `hello`, exact match for `LiveDriver`, content-hashed wasm.
- B3 join budget: **fixed.** Web Worker, chunked catch-up, measured in Phase 1 and Phase 5.
- B4 protocol details: **fixed.** `hello.inputs` includes queued inputs, `seqHighWater`, hash after step, desync POST, FX suppression.
- C1 `trackSha256` circular: **fixed.** `trackDefSha256` over the sim track definition; DTRK hashed separately.
- C2 inputs and seq in the envelope: **fixed.** `inputsSha256` dropped; `seq` excluded from `eventsSha256`.
- C3 labels not tied to code: **fixed.** `engineBuild` stored, boot golden self-test blocks `start-race`, nightly `verify-races`.
- C4 missing Rust track unrecoverable: **fixed.** Track written in T1; boot regeneration; gate before every bump.
- C5 FINISHED recovery re-simulates: **fixed.** Digest and standings in T1; T2 recovery is DB-only and idempotent.
- C6 deterministic panic locks the week: **fixed.** `reseed-week`, panic recording, fuzz CI gate, overflow checks.
- C7 seed exposed from lock: **fixed.** DTOs carry `seedCommit` only (D17); seed revealed at RACING.
- D1 OUTCOME_MATCH: **fixed.** Downgraded to `UNAVAILABLE` (C26).
- D2 recorder can fail a race: **fixed.** Infallible `push`, typed arrays, finalize after resolve, self-check, kill switch.
- D3 import runs once: **fixed.** `ensure-imported` with `byteSha256` verification and logged skips.
- D4 dedupe and candidates, `0b67096`: **fixed.** Composite key, push events, fsck/reflog, `0b67096`-era digest-only rule.
- D5 resolver environment: **fixed.** Production base image, recorded versions, the commit's own tsconfig, HEAD calibration.
- D6 compat comparator: **fixed.** ICU-modelled table with a 1M property test vs Node (D6).
- D7 DTRK gaps: **fixed.** Tick 0, JSON-roundtrip fixture test, `ORDER BY id`.
- D8 TS rollback re-simulating Rust configs: **fixed.** Version guard in TS `createSimulation`/`simulateRace` (0.5).
- E `undefined` tokens fact: **fixed.** Stated in §4.1 and D9.

**Live-ops review**
- B1 crash recovery resurrects old races: **fixed.** D22 selection rules and the `dev.db` races 38–40 boot test.
- B2 recorder in `afterTick`: **fixed.** Same as determinism D2, plus the `REPLAY_TRACK_RECORDING` kill switch.
- B3 wrong or empty DB plus seed: **fixed.** Own URL parsing, `create_if_missing(false)`, non-empty check, explicit seed, staging sentinel.
- B4 admin key length lockout: **fixed.** Fail closed only when unset; sha256 plus `timingSafeEqual`; pre-merge length check (C27).
- M1 Phase 0 deadline and Monday deploys: **fixed.** C28, batches, auto-deploy off (D28).
- M2 googleId lockout: **fixed.** D24 email-fallback rule for non-`sub` ids, plus census.
- M3 backups: **fixed.** D29, `.backup` in the runbook, off-box via Dokploy or a manual pull. Hourly R2 push is deferred to the Q2 answer, with R2 credentials kept.
- M4 sqlx defaults and datetimes: **fixed.** D12 features, D13 explicit timestamps, D15 explicit pragmas, datetime GLOB CI, `strftime` in SQL.
- M5 DELETE-mode concurrency: **fixed.** D15 single writer with `BEGIN IMMEDIATE`, read-only readers, chunked T1, load assertion.
- M6 restore drops data: **fixed.** Narrow "suspect" definition; `autoduck diff-since`; `MAX(id)` recorded.
- M7 runbook build and smoke ordering: **fixed.** Image pre-pulled; `SQLX_OFFLINE`; week N+1 opened before the test race.
- M8 lock vs Swarm: **fixed.** D21 lock before bind, liveness healthcheck, stop-first, grace 150 s, staging test.
- M9 one-shot import: **fixed.** `ensure-imported` (C7).
- M10 VACUUM endpoint exfiltration: **fixed.** No endpoint; host `.backup`; immediate sanitisation; copies deleted after 0.6.
- M11 verifier flags production DDL: **fixed.** D14 normalisation, compat default, `rs-ponr` marker, calibration on a production copy.
- M12 `panic=abort`: **fixed.** D1 workspace unwind; abort only in the `race-wasm` build; panic test in Phase 5.
- M13 0.3 crash loop and image swap: **fixed.** Helpers extracted, CI `migrations` job, root kept, 0.3b alone with a test race.
- m1 16-id check stale: **fixed.** Generated list; dev-mode warning.
- m2 SPA fallback on `/api` and index caching: **fixed.** Phase 3 static serving rules.
- m3 immutable `/track` vs re-import: **fixed.** `?h=` hashed URL immutable, unhashed `no-cache`.
- m4 gap between 0.5 and 0.6: **fixed.** Shipped in one deploy (batch E).
- m5 reflog expiry and Node major: **fixed.** gc config, fsck candidates, Dokploy history first, production base image.
- m6 VERIFIED_EVENTS badge: **fixed.** Distinct badge text (§4.6).
- m7 no `rs-*` or new SQLite features before PONR: **fixed.** D14 compat-mode prohibitions.
- m8 WAL and non-root together: **fixed.** Separate deploys in Phase 9; backups already `.backup`/`VACUUM INTO`.
- m9 test RNG env in release: **fixed.** `cfg(feature="test-rng")` only; TS hook only under `NODE_ENV=test`.
- m10 cosmetic catalog drift: **fixed.** D19 preserves unknown ids and logs them.
- m11 port and URL parity: **fixed.** Default `PORT` 3000 and `0.0.0.0`; avatar path unchanged; opaque tokens; Vite proxy targets :3000.
- m12 staging hygiene: **fixed.** Different `RACE_SECRET_KEY` and sentinel. Nulling Google `avatarUrl` was **rejected**: the URLs are public profile images and the avatar proxy needs them for rendering.