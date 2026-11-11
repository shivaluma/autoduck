# Balance and the TS engine freeze

## The TS engine is frozen

From the rewrite branch cut (`d8c69d1`, 2026-11-09), the TypeScript race engine on `main` is **frozen** (rewrite plan D28). The Rust engine on the `rewrite*` branches is a bit-exact port of it, and the parity oracles (G1) and balance baseline (G3) are measured against it. An engine change on `main` would move both.

Frozen paths:

- `packages/race-*` (`race-core`, `race-protocol`)
- `lib/racing/audit.ts`, `lib/racing/persistence.ts`, `lib/racing/runtime.ts`
- `lib/season3-race.ts`

The only changes made since the cut are the planned Phase 0 seams, and none of them changes simulation output: the replay-track recorder hooks in `lib/season3-race.ts` (step 0.4) and the version guard in `createSimulation`/`simulateRace` (step 0.5). `RACE_ENGINE_VERSION` stays `1.2.0` and `RACE_BALANCE_VERSION` stays `S3.15`.

### How it is enforced

The `engine-freeze` workflow (`.github/workflows/engine-freeze.yml`) fails any pull request that touches a frozen path unless the PR carries the **`engine-hotfix`** label. Adding or removing the label re-runs the check. Pushes straight to `main` are not gated, so the rule also binds anyone (or any agent) that pushes without a PR.

### Hotfixes

A hotfix is for a bug that breaks official races, not for balance tuning. An `engine-hotfix` PR must, in the same PR:

1. Bump `RACE_BALANCE_VERSION` (or `RACE_ENGINE_VERSION`) in `packages/race-protocol/src/index.ts` if simulation output changes, and keep the old pair in the `lib/racing/replay.ts` allowlist only if it still replays identically.
2. Add a port item for the Rust engine (the same change in `crates/race-core` on the `rewrite` branch) so the parity oracles move together.
3. Write the change up here as `docs/balance/<version>.md`, as for any balance version.

Balance tuning waits for the Rust engine.

## Balance write-ups

Each balance version is documented in `docs/balance/<version>.md` (`S3.12.md` … `S3.15.md`), with raw outputs in `artifacts/balance-<version>/` (for example `artifacts/balance-s3-14/`). Compare treatments on identical seeds and lobbies (`scripts/balance-audit.ts`, `scripts/compare-balance-audit.ts`).

## Rust engine (`rewrite` branch)

From S3.16 on, balance work runs on the Rust engine with `race-cli` (build once with `cargo build -p race-cli --release --locked`). The modes replace the TS worker pool (`scripts/balance-*.ts`); each runs races in parallel and folds results in seed order, so output does not depend on the thread count:

- `race-cli balance mixed --races N [--chaos X]`: loadout cells, temperaments (win %, Chaos loser %, mean rank), drama (lead changes, durations) and wild-item grants. `--corpus file --out run.json` runs a fixed config file.
- `race-cli balance matrix --seeds N [--lobbies MIXED,SPEED,DEFENSE,ATTACK]`: the paired loadout matrix.
- `race-cli balance wild --seeds N`: the paired wild-item value audit.
- `race-cli balance run` / `balance compare`: the paired Rust-vs-Rust report of one engine change (`docs/balance/S3.16.md`).
- `race-cli compare ts.json rs.json`: gate G3 against TS S3.15 (`docs/balance/S3.16.md`).

**Golden digests.** Any change to Rust engine output needs a version bump (`RACE_BALANCE_VERSION` or `RACE_ENGINE_VERSION` in `crates/race-protocol/src/versions.rs`) and a new frozen entry: `race-cli golden freeze`. The `golden-version` CI job (`race-cli golden check`) fails otherwise, and also when `rust-toolchain.toml` changes until the bump is re-frozen with matching digests. The `fuzz` CI job (`race-cli fuzz --cases 2000`, then the same with `--adversarial`) must report 0 panics, 0 unfinished races and 0 non-finite values.

