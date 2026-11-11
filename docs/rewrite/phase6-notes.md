# Phase 6 notes: Phase B fixes and balance acceptance (gate G3)

Phase 6 turns the faithful S3.15 port (Phase A, gate G1) into the shipped
S3.16 engine (`RACE_ENGINE_VERSION` 2.0.0) with the Phase B fixes F1–F13,
then compares it with TS S3.15 (gate G3). The balance write-up, with every
paired report and the full G3 tables, is `docs/balance/S3.16.md`. Raw runs
are in `artifacts/balance-s3-16/`.

**Result:** every F is in effect in the default (shipped) build and is
switched off by race-core's `ts-compat` feature. The S3.15 behaviour is
byte-identical to before the phase. G3 passes but is noise-limited. Fuzz,
including adversarial configs, gives 0 panics, 0 unfinished races and 0
non-finite values. Golden digests are frozen for S3.16.

Commits on `rewrite` after the integration merge `8a5b131`:

- `8c381a6` adds the paired balance runs.
- `53c3375` … `f0acd04` are F1–F13, one commit each.
- `cf2d1b9` adds the per-fix docs.
- `6e0b92e` and `e42f009` add the balance modes, G3 compare, fuzz and goldens.
- One review commit (this note).

## How the fixes are switched

`race_core::TS_COMPAT` (`cfg!(feature = "ts-compat")`) is a `const bool`,
and each fix branches on it, so both behaviours compile and are linted in
every build. F6 and F9 are the exceptions: they use `#[cfg]`, because the
default build must not contain `hypot2` or the dead config fields at all.
F9's config shape lives behind race-protocol's `s3-15-config` feature, which
only race-core's `ts-compat` turns on.

Feature unification was checked with `cargo tree -e features`:

- No shipped crate (`autoduck-server`, `race-wasm`) enables
  `race-core/ts-compat` or `race-protocol/s3-15-config`.
- Only `race-cli --features ts-compat` (the oracle build) enables them.
- race-cli always turns on `race-protocol/ts-compat`. That feature only adds
  `resolve_ts_compat` and the S3.15 version constants, and changes no
  behaviour.

## What changed per F (default build)

| F | Change | Where | Proof it is in effect |
|---|---|---|---|
| F1 | Ids compare in byte order (`Ord for str`), not the ICU model of `localeCompare` | `sim::id_cmp`, `chaos.rs` `locale_compare` alias | `phase_b.rs::f1_*` |
| F2 | Engine RNG stream labels drop the race id: `engine_stream(kind, race_id, rest)` | `rng.rs`. Callers: arbiter (delay, cooldown), brain (temperament), pickups (spawn, gold-box, hazards, loot). Meta streams were never race-scoped. | `phase_b.rs::f2_*` (renaming a race changes nothing). All engine `create_race_rng` calls were audited, and none left builds a label with the race id. |
| F3 | One `goldenBoxProbability` default (resolver 0.15). The engine's unreachable 0.18 is gone. | `race_protocol::config`, `pickups/config.rs` | `phase_b.rs::f3_*` |
| F4 | ChaosUtility snapshot and director read are keyed by their exact inputs (rank, progress bits, finished), not by a float fingerprint | `auto_use/{chaos_utility,director}.rs` | `phase_b.rs::f4_*`. The outcome cache is still cleared on every rebuild. |
| F5 | Ghost ducks are left out of the in-sim ChaosUtility ranking (objective `chaos` and `naive`) | `chaos_utility.rs` `without_ghosts`, `objective.rs` | `phase_b.rs::f5_*` |
| F6 | The pickup collector compares squared distance. The sim has no `hypot`, and `EngineMath::hypot2` exists only under `ts-compat`. | `pickups/collect.rs`, `sim/options.rs` | Unit test `f6_squared_distance_orders_like_hypot` |
| F7 | TAILWIND/MAGNET `*_ENDED` fire on `tick >= until`, and the window is then cleared (fires once) | `pickups/engine.rs` | Unit test `f7_*` |
| F8 | `queue_wild_item_input` returns `Err(LateWildItemInput)` for `authoritative_tick <= sim.tick` instead of clamping | `sim/create.rs` | `phase_b.rs::f8_*` |
| F9 | `rocketSlowMultiplier`, `banana{Knockback,Slow}Multiplier`, `manualItemsEnabled`, `chaosBoxEnabled` and `idealManualPlayerIds` leave the resolved config. The input still accepts and range-checks them. | `race_protocol::config`, `items/state.rs` | `dead_knob.rs` (every remaining knob changes a race) |
| F10 | `*_ENDED` start metadata comes from the boost's own typed extras (cleared for non-Nitro and queued boosts) | `items/engine.rs` `record_boost_start` | `boost_start.rs` |
| F11 | `resolve()` rejects empty Chaos groups, foreign players and overlapping groups | `race_protocol::config` `validate_chaos_groups` | `race-protocol/tests/ids_config.rs`, adversarial fuzz |
| F12 | Not in the plan's list. No fix. | – | – |
| F13 | The loadout Feather copy and interaction matrix no longer claim a hazard dodge | `catalog.rs`, `items/interactions.rs`, `src/season3/season3-rules-content.ts` | `phase_b.rs::f13_*` |

The CI test `item_ids_kept.rs` checks that every S3.15 `RaceItemId` and
`WildItemId` still parses and has a catalog entry.

Only F2 (a reseed) and F4 (3 of 300 races) change race outcomes on
`balance-v1/300`. F5 changes ghost cases, and F10 changes event metadata. The
other fixes leave the simulation output unchanged on that corpus (per-fix
table in S3.16.md).

## Review (2026-11-11): gates re-run on `e42f009` plus the review commit

| Check | Result |
|---|---|
| G1 slice: 200 cases of the 2,000-case `full` G1 corpus (every 7th line; 25 per Chaos type, lobbies 2–16, ghosts). TS oracle at this branch vs `race-cli --features ts-compat oracle diff` | **200/200 bit-exact** |
| `determinism-pinned.json` `tsCompat` digests and case lines, `8a5b131` vs HEAD | unchanged. Only `default` entries were re-pinned. |
| `cargo test -p race-core -p race-protocol --release`, default and ts-compat (native) | all pass |
| `determinism_pinned` under wasm32-wasip1 (wasmtime), default and ts-compat | 7/7 each |
| `scripts/build-wasm.sh --require-bindgen` + `node scripts/ci/wasm-determinism.mjs` | 42/42. `engineBuildId` matches the native `race-cli build-id`: `59581f15…51aa54`. |
| `race-cli golden check` | 42/42, toolchain unchanged |
| `race-cli fuzz --cases 1000 --start 7000` | 994 finished, 6 rejected, 0 failures |
| `race-cli fuzz --cases 5000 --adversarial` (new) | 883 finished, 4,117 rejected, **0 panics**, 0 unfinished, 0 non-finite |
| fmt, clippy `-p race-cli --all-targets` (default and `--all-features`, `-D warnings`), race-cli fuzz tests (default and ts-compat) | clean |

Findings, all fixed in the review commit:

- **(major) No adversarial-config coverage.** `fuzz` only ran
  generator-shaped configs, and `parse_corpus_line` (parse and `resolve()`)
  sat outside `catch_unwind`, so a resolver panic would have killed the run
  instead of being reported. The fix adds `race-cli fuzz --adversarial`
  (mutations listed in S3.16.md § Fuzz) and moves parse/resolve under
  `catch_unwind`. It also adds the unit test `adversarial_cases_never_panic`
  (shipped build) and a CI step that runs 2,000 adversarial configs per
  push.
- No blocker or major finding in the F commits themselves.

## G3 (Rust S3.16 vs TS S3.15, `g3-v1`, 300 races, 8 ducks)

| Metric | Threshold | Result |
|---|---|---|
| Unfinished races | 0 | 0 / 0 |
| Loadout cells (18 + 3 class rows) | \|Δ\| ≤ 2 pp | 10 pass, 11 within noise, 0 fail. Largest: NITRO+SHOCK_ABSORBER −6.61 (SE 5.19). |
| Temperaments (Rust win %) | [11.0, 13.8] % | 3 pass. SHOWMAN 13.91 is within noise (SE 1.41). |
| Lead changes per race | \|Δ\| ≤ 0.4 | 4.067 vs 4.067 |
| Duration / winner p50 / wild grants | info | 57.621→57.620 s / 55.08→55.05 s / 10.41→10.35 |

Verdict: **pass (noise-limited)**. No F was bisected or reverted. At 300
races, G3 only detects shifts of about 8–10 pp per cell and about 5 pp per
class row. The full tables are in S3.16.md and
`artifacts/balance-s3-16/g3-report.md`.

## Fuzz and goldens

- `race-cli fuzz` uses generator configs, plus `--adversarial` mutations.
  The CI `fuzz` job runs 2,000 of each per push or PR, from a window chosen
  by the run number.
- `race-cli golden check|freeze` uses
  `crates/race-core/tests/fixtures/golden-digests.json`. It holds the 42
  shipped-build digests and the `rust-toolchain.toml` sha256 under
  `engine=2.0.0 balance=S3.16 track=river-01-v2 pickups=pickups-v2
  hazards=hazards-v2`. The CI job is `golden-version`.

## Open items

- **Fuzz size.** The plan's 100k-per-PR and 1M-nightly fuzz runs are
  deferred, because the user asked for lightweight runs only. The local
  total is 6,000 generator configs plus 5,000 adversarial ones.
- **G3 statistical power.** G3 ran on 300 races. A bigger run of the same
  commands (`balance g3-corpus`, `scripts/oracle/g3-balance.ts`,
  `balance mixed --corpus`, `compare`) would tighten the noise band.
- **`race-cli gate --db <copy>`** (§4.5 gate SQL) is not built yet. It is
  needed before the first production engine bump.
- **F5 scope.** Only the ChaosUtility ranking skips ghosts. The objective's
  `player_count` and `loser_cutoff`, and the duck `current_rank` they are
  compared with, still count ghosts. The two sides are consistent with each
  other, so this is an AI-heuristic nuance, not a correctness bug.
  Revisit only if ghost lobbies show odd item use.
- **F8 caller.** The F8 error is not wired to a caller yet. The Rust live
  session (server runtime) must map `LateWildItemInput` to a client-visible
  rejection when it is ported.
- **New CI jobs.** `golden-version` and `fuzz` have not had a CI run yet.
  Check the first run after this push.
