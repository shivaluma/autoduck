# Phase 2 notes: faithful engine port (Phase A, gate G1)

Phase 2 ports the TS S3.15 engine (`packages/race-core`, frozen as the
oracle) to `crates/race-core` and checks it against the oracle tick by tick
(plan §3 Phase 2, D3–D9, D26). The `ts-compat` feature carries everything the
port needs to be bit-exact with V8: `js_math` (hypot/exp/pow), the ICU model
of `localeCompare` (`collate_compat`) and `resolve_ts_compat`. The default
(shipped) build uses the soft-float libm wrappers and byte-order ids; Phase B
fixes target that build.

**Result:** G1 passes at 100% exact: 2,000/2,000 full-profile cases, 0
ulp-classified divergences, meta parity 12,017/12,017. The escape hatch
(freeze at the first auto-use decision) was not needed. Tag:
`engine-port-baseline`.

## What was ported

| Milestone | Rust | TS source |
|---|---|---|
| Chaos meta | `chaos.rs`, `loadout.rs`, `meta.rs`, `catalog.rs`, `ghost.rs` | `chaos/*`, `loadout-auto.ts`, `validate-loadout`, catalog, `ghost.ts` |
| M1 core | `sim/{create,step,lane_ai,collisions,ranks,result,events,options,state}.rs`, `track.rs`, `config.rs` | `simulation.ts`, `track.ts`, `config.ts` |
| M2 items and pickups | `items/{engine,projectiles,interactions,aim,classes,config,state,telemetry}.rs`, `pickups/{spawn,collect,wild,engine,catalog,config,state}.rs` | `items/*`, `pickups/*` |
| M3 auto-use AI | `auto_use/{evaluate,arbiter,execute,brain,director,chaos_utility,objective,config,types}.rs` | `auto-use/*` |
| Support | `js_sort.rs` (V8 sort), `sim::IdMap`/`IdSet` (JS `Map`/`Set`), `sim::case_digest` (pinned digests, not a TS port) | |

About 17.8k lines of engine code. `SimOptions { max_ticks, record_events,
manual_inputs, ai_ablation, loot_override, math }` and the `EventSink` trait
replace `SimulationOptions`/`onEvent`. `phaseProfile` is not ported (no clock
in a no_std engine). Every module header names its TS file and line ranges.

`race-core` stays `#![no_std]` + alloc with the D4 clippy bans forbidden.
`Simulation` is `Send + Sync` (compile-time assertion in `sim/mod.rs`).

## Gate G1

Run on 2026-11-10. The TS traces come from the oracle at this branch; the
Rust side was re-run on `31acf8e` (engine sources are unchanged after it):

```fish
cargo build -p race-cli --release --features ts-compat --locked
race-cli corpus gen --count 2000 --out corpus.jsonl            # full profile
# 8 shards: node --no-use-std-math-pow --import tsx scripts/oracle/dump-trace.ts --corpus corpus.jsonl --shard i/8 --out trace-i.jsonl.gz
race-cli oracle diff --corpus corpus.jsonl --trace trace.jsonl.gz --report diff.json
```

| Corpus | Oracle host | Result |
|---|---|---|
| **G1: 2,000 `full`** (every Chaos type ×250, lobbies 2–16, 599 ghost cases, 609 legacy 1.2.0 configs, pickups omitted/disabled/production/randomized, awkward floats) | darwin-arm64, Node 24.17.0, `--no-use-std-math-pow` | **2,000/2,000 bit-exact**: per-tick `sh1` hashes, per-tick event hashes, `stateChainSha256`, `motionSha256`, `eventsSha256`, `eventCount`, `finalTick`, standings by f64 bits. 0 ulp-classified. |
| 400 `items` (every loadout combo, forced golden boxes, 116 cases with manual wild-item inputs) | same | 400/400 |
| 300 `core` (`--ai-ablation all`, M1 stage) | same | 300/300 |
| `oracle meta` | same | 12,017/12,017 |
| 42 pinned cases (`tests/fixtures/determinism-pinned.json`, `tsCompat` key = TS trace) | same | 42/42, natively and under wasm32-wasip1 |
| Review 1 edge corpora (423 edge, 220 manual-input, 115 forced mini-rocket expiry, 60 collision-key aliasing, 330 option modes, 106 per-tick world snapshots) | darwin-arm64 | all exact; the 3 "every wild item disabled" cases now classify as `both-threw` (TS and Rust throw at the same step with the same message) |
| Review 1 Linux oracles (400 G1 cases plus the edge corpora, 1,158 cases) | linux-x64 (FMA) and linux-arm64, Node 24.17.0, default std pow | 1,155/1,158 each; the 3 are the same TS throws |

The threshold (100% exact, or ≤0.5% first divergences at an ulp-classified
`js_math` call site) is met with no allowance used. Timings (M-series Mac,
load ~5): TS oracle 66 s wall for 2,000 cases on 8 shards (~250 ms CPU per
case with hashing); Rust side of `oracle diff` 28 s wall, 176 s CPU (~88 ms
per case including per-tick `sh1` and event JCS).

### `oracle diff` changes in Phase 2

- A TS record that failed after parsing is no longer skipped: Rust runs the
  case too and must panic while stepping the same tick (`record.tick + 1`)
  with the same message, after identical per-tick hashes (`dump-trace.ts`
  now writes the pre-throw `tickHashes`/`tickEventHashes` into failure
  records). Only then is it `both-threw` (a pass). `both-failed` (a pass)
  is reserved for a config both sides refuse at parse; a config TS accepted
  but Rust refuses is `rust-config` (a failure). Reviews 1 (LOW 1–2) and 2
  (MINOR 4).
- A TS failure in the `hash` or `events` stage (D7: non-finite metadata) is
  still `ts-failed`; Rust's JCS writer errors there too, but the tick isn't
  compared yet.

### Build and test checks at landing

| Check | Result |
|---|---|
| `cargo fmt --all --check` | clean |
| `cargo clippy --workspace --all-targets [--all-features] --locked -- -D warnings`; `clippy -p race-wasm --target wasm32-unknown-unknown` | clean |
| `scripts/ci/check-wire-usize.sh` | ok (68 files) |
| `cargo test --workspace --all-features --locked` (debug) | 411 passed, 0 failed, 3 ignored (468 s) |
| `cargo test --workspace --locked` (debug, default features) | 218 passed, 0 failed, 3 ignored |
| `cargo test -p race-core -p race-protocol --release`, default / ts-compat | 193 / 271 passed, 0 failed |
| same, wasm32-wasip1 under wasmtime 50, default / ts-compat | 192 / 270 passed, 0 failed (the extra ignore is a `should_panic` test wasm can't run) |
| `scripts/build-wasm.sh` + `node scripts/ci/wasm-determinism.mjs` | 42/42 |
| `wasm32v1-none` build, both feature sets | ok |

## Determinism (D26)

- `sim::digest_case` folds a whole race the way `dump-trace.ts` does.
  `tests/determinism_pinned.rs` pins 42 cases per feature set: 32 `full`
  (every Chaos type with a 16-duck lobby, ghosts, legacy configs, randomized
  pickups) and 10 `items` (manual inputs, 16 ducks). `tsCompat` digests are
  the TS trace values; `default` digests are the shipped engine's.
- CI (`.github/workflows/rust.yml`): the `determinism` job runs it natively
  and under wasm32-wasip1/wasmtime on x86_64 and aarch64, both feature sets,
  in release; the `wasm` job runs `scripts/ci/wasm-determinism.mjs`, which
  checks the `default` digests through the shipped wasm-bindgen package's new
  `runCaseDigest(line)` export in Node. Playwright in three browsers is
  Phase 5.
- Regenerate after an intended engine change (Phase B):
  `cargo run -p race-cli -- corpus pin` (default) and
  `cargo run -p race-cli --features ts-compat -- corpus pin --check` (must
  stay green in Phase A).
- Review 2 ran 200 G1 cases on native arm64, native x86_64 (Rosetta),
  wasip1, wasm-bindgen in Node and in Chrome: identical chains on every
  runtime. Locally, the 42 pinned cases match on native arm64, wasip1 and the
  shipped package in Node 24.

## Preserved quirks (Phase A keeps every one; Phase B decides)

TS paths are relative to `packages/race-core/src`.

**Numbers and ordering**

| Quirk | TS | Rust |
|---|---|---|
| Id order is `localeCompare` (ICU root collation), not byte order: e.g. `a` < `B`. Every call site: `simulation.ts:156,214,448,461,497,500,563,660`, `pickups/engine.ts:148,192,201,247,304,323,353,367,449,496,512`, `items/engine.ts:491,573,694,806`, `auto-use/director.ts:32`, `chaos-utility.ts:50`, `evaluate.ts:406,1082,1137`, `arbiter.ts:185`, `execute.ts:150`, `chaos/index.ts:40` | `sim::id_cmp` → `collate_compat::compare` (ts-compat) |
| `Array.prototype.sort(cmp)`: V8 binary insertion sort below 64 elements, stable TimSort above, with the inconsistent/NaN comparators as written (`a - b \|\| ...`) | every `.sort(` | `js_sort::v8_sort_by` + `math::cmp_f64_js` |
| `Math.round` rounds half up (−0.5 → −0) | 40+ sites, e.g. `simulation.ts:112,477`, `items/engine.ts:195-214,550`, `pickups/engine.ts:125-126` | `math::js_round` |
| `Math.max`/`Math.min` NaN and ±0 semantics; `Math.max(...[])` = −Infinity, so an all-ghost race has `durationMs = -Infinity` | `simulation.ts:673` | `math::js_max`/`js_min`/`js_max_of` |
| `Math.hypot` is V8's Torque algorithm; it decides the pickup collector | `pickups/engine.ts:319-320`, `track.ts:180` | `EngineMath::hypot2` |
| `Math.exp` (Chaos swap chains) and `Math.pow` (grudge decay) are V8's fdlibm ports, host-dependent | `chaos-utility.ts:107,131`, `brain.ts:114` | `EngineMath::exp`/`pow`, host from the trace header |
| `Object.entries(weights)` order walks the loot categories | `pickups/engine.ts:231` | `pickups/collect.rs` (`POSITION_CATEGORY_WEIGHTS` order) |
| JS `Map`/`Set` iterate in insertion order (`Map.set` on an existing key keeps its slot) | `byPlayer`, `brains`, grudges, `teammatesByPlayer` | `sim::IdMap`, `IdSet`, `brain.rs` grudge map |
| `reasonByPlayer = Object.fromEntries(...)`: array-index keys ascending first, then insertion order; first insertion keeps its slot | `chaos/index.ts` | `chaos::ReasonByPlayer` |

**RNG streams**

| Quirk | TS | Rust |
|---|---|---|
| The race id is inside the stream labels (`temperament:<raceId>:<playerId>`, `auto-use-delay:<raceId>:…`, `auto-use-cooldown:<raceId>:…`, `pickup-spawn:<raceId>`, `gold-box:<raceId>`, `hazards:<raceId>`, `pickup-loot:<raceId>:<pickupId>:<playerId>`), so renaming a race changes it | `brain.ts:84`, `arbiter.ts:34,53`, `pickups/engine.ts:131,153,176,252` | `brain.rs`, `arbiter.rs`, `pickups/spawn.rs`, `pickups/collect.rs` |
| Draw order kept call for call: one Fisher-Yates over every zone's anchors whether or not it spawns; golden box `next()` skipped when forced; hazards count → shuffle → anchor → type; Chaos `prepare` shuffles `n - 1` draws, only for DUO/CONSTRUCTORS/BOUNTY_HUNT; a forced loot item draws nothing | `pickups/engine.ts:77-193,252`, `chaos/index.ts` | `pickups/spawn.rs`, `pickups/collect.rs`, `chaos.rs` |

**Caches (plain fields, TS hit/miss conditions)**

| Quirk | TS | Rust |
|---|---|---|
| `readRace` memo: a module `WeakMap` keyed by the `ducks` array; hit when the fingerprint `length + Σ progress·(i + 2.718) + (finished ? 11 : 0)` is `===` (NaN never hits) | `auto-use/director.ts:25-43` | `Simulation::director: DirectorCache` |
| `ChaosUtility.observe` reuses its snapshot while `length + Σ progress·(i + 1.618) + (finished ? 7 : 0)` is `===`; the fingerprint ignores `currentRank`, so a hit can return an order built from older ranks | `chaos-utility.ts:44-62` | `auto_use::ChaosUtility` |
| `outcomeCache` keyed by `order.join('\|')` (ids containing `\|` can alias), cleared on every snapshot rebuild and when it holds more than 512 entries, right before an insert | `chaos-utility.ts:34,58,64,82` | same |

**Events**

| Quirk | TS | Rust |
|---|---|---|
| `emitEvent` feeds `noteBrainEvent` (grudges) first, even when `recordEvents` is false and there is no `onEvent` | `simulation.ts:102-109` | `sim::Emitter::emit` |
| Collision events are throttled per `` `${left}:${right}` `` key, so two different pairs can share a key (`a` + `b:c` vs `a:b` + `c`) | `simulation.ts:475-484` | `Simulation::last_collision_event_tick` |
| `undefined` metadata members are absent on the wire; `null` stays `null`; meta events are skipped by the digest | `event(...)`, JCS | `race_protocol::events` (see `protocol-mapping.md`), `serde_jcs` |
| A mini-rocket popping a raised prep bubble emits `BUBBLE_POPPED {blocked: 'ROCKET'}`; a shock-absorbed hit queues its surge as `'ROCKET'`; `armingTicks` is the prep value for mini-rockets | `items/engine.ts:662-672` | `items/projectiles.rs::update_rockets` |
| A failed wild-rocket retarget leaves `target` undefined, so the rocket expires with its original target; it retargets at most once | `items/engine.ts:567-581` | same (`tests/rocket_retarget.rs`) |
| `shockAbsorbed` in `updateBananas` is the constant `false` (dead branches ported); Feather dodge and immunity emit `BANANA_BLOCKED` for wild bananas without `blocked: true` | `items/engine.ts:707-762` | `items/projectiles.rs` |
| A partial break (`MINI_ROCKET`/`WILD_BANANA`) that ends the boost still returns `null`; the broken `*_ENDED` event's `consumedSeconds` is the *remaining* time | `items/engine.ts:268,289` | `items/engine.rs::break_active_speed_boost` |
| A pending speed drain is consumed even when the boost is only queued or ignored; `drained: true` reaches only the direct `*_STARTED` event | `items/engine.ts` (`activateSpeedItem`) | `items/engine.rs` |
| The natural `*_ENDED` event carries the duck's last Nitro `startProgress`/`startRank`, whatever item ended | `items/engine.ts:430-449` | `items/engine.rs::finish_speed_boost` |
| Telemetry credits every `BOOST_BROKEN` (banana, horn, …) to `HOMING_ROCKET` | `items/telemetry.ts:27` | `items/telemetry.rs` |

**Chaos rules**

| Quirk | TS | Rust |
|---|---|---|
| `ordered()` sorts before rejecting fewer than 2 entries or a duplicate player | `chaos/index.ts:40` | `chaos.rs` |
| DUO: an empty custom group has average `0/0 = NaN`, worst −Infinity, best +Infinity and orders exactly as V8 sorts it | `chaos/index.ts` | `chaos.rs` |
| CONSTRUCTORS: equal averages make both teams lose; a NaN average is never equal and `a > NaN` is false, so team 1 loses | `chaos/index.ts` | `chaos.rs` |
| Auto-use objective drops `chaosConfig` for team/bounty modes (`{...config, chaosConfig: undefined}`) | `auto-use/objective.ts` | `auto_use/objective.rs:58` |

**Errors**: `At least one Wild Item must be enabled` is thrown (Rust:
panics) on the first box when every wild item is disabled
(`pickups/engine.ts:260`, `pickups/collect.rs:216`); `simulateRace`'s timeout
message names the budget in seconds (`simulation.ts:683`; Rust prints ticks
only for a `SimOptions::max_ticks` override). Chaos errors are `Result`s whose
`Display` is the TS message.

## White-box test ports

15 TS test files, 115 tests ported, all passing (`cargo test -p race-core
--features ts-compat`); 5 tests skipped because they don't test the engine.
All 120 TS tests in these files pass on the TS engine under
`--no-use-std-math-pow`.

| TS | Rust | Tests | Notes |
|---|---|---|---|
| `race-items` | `race_items.rs` | 20 | |
| `race-item-passives` | `race_item_passives.rs` | 9 | |
| `race-nitro-v2` | `race_nitro_v2.rs` | 4 | |
| `race-aim` | `race_aim.rs` | 6 | `plan_banana_aim` made `pub` like the TS export |
| `race-pickups` | `race_pickups.rs` | 15 | local copy of `recordedWildInputsFromEvents` (`lib/racing/persistence.ts`); the 100-race fuzz takes 45–67 s in debug |
| `race-boost-gates` | `race_boost_gates.rs` | 3 | |
| `race-pacing` | `race_pacing.rs` | 3 | |
| `race-auto-use-guards` | `race_auto_use_guards.rs` | 12 | |
| `race-duck-brain` | `race_duck_brain.rs` | 8 | |
| `race-counter-loop` | `race_counter_loop.rs` | 7 | |
| `race-chaos-plugins` | `race_chaos_plugins.rs` | 8 | |
| `race-chaos-team-ai` | `race_chaos_team_ai.rs` | 9 | ts-compat only (1.2.0 fixtures) |
| `balance-sim-feather` | `balance_sim_feather.rs` | 4/7 | 3 skipped: they test `scripts/lib/balance-sim-core.ts` tooling |
| `race-loadout` | `race_loadout.rs` | 3 | |
| `race-core` | `race_core_blackbox.rs` | 4/6 | 2 skipped: need `lib/racing/{audit,replay}.ts` (server, Phase 3/5); the 1,000-race slot-bias test is `#[ignore]` in debug (~277 s), runs in release CI |

Shared scaffolding: `tests/support/whitebox.rs` (config literals, item ducks,
`Harness` emitter with brains, one `DirectorCache` per TS `ducks` array).
Deviations, none of which an assertion depends on: a Rust `Emitter` always
feeds `noteBrainEvent` (TS test callbacks don't); the test that marks
`ducks[0]` finished mid-tick runs the execute/decide/item phases separately;
`'AUTO'` wild activations map to `AutoUseReason::Opportunity`; two Rust-only
required metadata fields get `Opportunity`. `items_whitebox.rs` (M2) overlaps
five counter-loop tests and some item tests in a stricter form.

New in the review fixes: `rocket_retarget.rs` (7 tests, the wild-rocket
retarget branch no corpus reaches) and `determinism_pinned.rs` (7 tests).

## Performance

| Measure | Value |
|---|---|
| Native arm64 release, 16 ducks | 25–31 µs/tick (140–165 ms per 5,400 ticks); p50 19–34 µs, p99 0.37–0.94 ms (review 2) |
| Native arm64 release, 8 ducks | ~7 µs/tick |
| wasm-bindgen in Node 24, 16 / 8 ducks | 32–59 / 8.8 µs/tick |
| Chrome 1×, 16 ducks | 44 µs/tick (~237 ms per 5,400 ticks) |
| Chrome 4× CPU throttle, 16 ducks | 140–158 µs/tick; per real race (~3,600 ticks) median 500–560 ms, **p95 680–926 ms** (plan budget p95 < 300 ms, warn-only) |
| Chrome 4×, 8 ducks | median 117 ms per race |
| 1,000-race slot-bias test, native release | ~66 s (TS: ~55 s) |
| 42 pinned races | 5.5 s debug native, 3.1 s release wasip1 (6 shards) |
| Shipped wasm (with `runCaseDigest`) | 1,159,196 bytes before wasm-opt |

Profile (review 2): 67% of samples in malloc/free/memcmp/memmove, led by
`ChaosUtility::outcome`, `moved`, `resolve_chaos_rule` and `String` clones of
player ids. Phase B: u8 player slots in ChaosUtility and Chaos resolution, no
`Vec<String>` per permutation or `String` per cache key.

## Review fixes (Phase 2 reviews 1–2)

| Finding | Fix |
|---|---|
| R2 MAJOR 1: `check-wire-usize.sh` failed CI on 6 multi-line `fn` parameters | The script now scans only struct/enum/union bodies (incl. tuple structs and struct variants), ignoring comments and strings; verified on a synthetic file that it still flags fields, tuple fields, variant fields and `where`-clause structs |
| R2 MAJOR 2: no CI determinism check for items/pickups/auto-use or the shipped feature set; no wasm export | `sim::digest_case`, 42 pinned cases × 2 feature sets, `race-cli corpus pin`, `race-wasm` `runCaseDigest`, `scripts/ci/wasm-determinism.mjs`, CI steps (above) |
| R1 LOW 1, LOW 2; R2 MINOR 4: oracle diff counted a TS mid-race throw as a pass and never ran Rust on it | `both-threw` classification (above) |
| R1 finding 4: wild-rocket retarget never exercised | `tests/rocket_retarget.rs` |
| R2 MINOR 5: `Simulation` not `Send` (`Rc<LootFn>`) | `Arc<dyn Fn + Send + Sync>` and a compile-time `Send + Sync` assertion |
| R1 note: `simulate_race` timeout message differed from TS | Prints `within 90s` unless `max_ticks` was overridden |
| R2 INFO 7: wasm instance callable after a trap | Documented in `race-wasm` (discard the instance) |

## Open issues

- **`resolve_ts_compat` input domain ≠ Zod** (R1 LOW 3). It accepts `null`
  for 12 optional keys Zod rejects (`chaosConfig`, `pickupConfig`,
  `itemTuning`, `loadouts`, `groups`, `isGhost`, `cosmeticKey`,
  `pickupConfig.enabled`, tuning keys, `pickupSpawnVersion`,
  `wildItemBalanceVersion`, `forceItem`), rejects duplicate JSON keys (TS:
  last wins), and the D6 narrowing rejects duplicate player ids, non-ASCII or
  >64-char ids and spaces in `raceId`/`clientActionId`. G1 is defined on the
  intersection (the corpus never leaves it); `oracle diff` reports such cases
  as `ts-failed`/`rust-config`. Production configs come from the server, so
  this matters only for replays of hand-made configs.
- **`resolve()` accepts a config that always panics** (R2 MINOR 3): every
  wild item disabled with pickups on. Faithful under ts-compat; Phase B's
  `resolve_pickup_config` should reject it.
- **Catch-up budget** (R2 MINOR 6): 16-duck races miss p95 < 300 ms on
  Chrome 4× (above). Phase B allocation work.
- **`sh1` hashes only duck state** (R2 INFO 8): item, pickup, projectile and
  auto-use state reach the hash only through the ducks. Consider extending it
  in Phase B for desync telemetry (a new state-hash version).
- **Oracle coverage of non-default options** (R1): `oracle diff` never runs
  `recordEvents: false`, an `onEvent` sink, partial ablation, `lootOverride`
  or world snapshots. Review 1's harness checked 330 option cases and 106
  snapshot cases (all exact), but it lives in scratch. Production uses
  `recordEvents: false` in `post-race-stats.ts` and `telemetry.ts`.
- **`hash`/`events` stage TS failures** are not yet compared tick-exactly
  (above).
- **Browsers**: D26's Playwright run in three browsers is Phase 5.
- **Test overlap**: `items_whitebox.rs` duplicates parts of `race_items.rs`
  and `race_counter_loop.rs`; trim when convenient.
- Phase 1 open issues still standing: legacy config wrong-typed keys
  dropped, `ROCKET_EXPIRED` (prep) only covered by white-box tests,
  `--linux-x64-no-fma` chosen by hand, Apple `pow`/Node patch drift. The
  `OracleHost` wiring item is closed (`EngineMath::oracle`), and x86_64 NaN
  handling is now covered by the pinned digests in the x86_64 determinism job.
