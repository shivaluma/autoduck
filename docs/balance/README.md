# Balance

## Engine

Balance work runs on the Rust engine (`crates/race-core`) with `race-cli`. Build it once with
`cargo build -p race-cli --release --locked`. Each mode runs races in parallel and folds results in seed order, so
output does not depend on the thread count:

- `race-cli balance mixed --races N [--chaos X]`: loadout cells, temperaments (win %, Chaos loser %, mean rank), drama
  (lead changes, durations) and wild-item grants. `--corpus file --out run.json` runs a fixed config file.
- `race-cli balance matrix --seeds N [--lobbies MIXED,SPEED,DEFENSE,ATTACK]`: the paired loadout matrix.
- `race-cli balance wild --seeds N`: the paired wild-item value audit.
- `race-cli balance run` / `balance compare`: the paired before/after report of one engine change
  (`docs/balance/S3.16.md`). Compare treatments on identical seeds and lobbies.
- `race-cli compare ts.json rs.json`: gate G3 against the TS S3.15 baseline (history; the TS side is retired).

## Version bumps and golden digests

Any change to engine output needs a version bump (`RACE_BALANCE_VERSION` or `RACE_ENGINE_VERSION` in
`crates/race-protocol/src/versions.rs`) and a new frozen entry: `race-cli golden freeze`. The `golden-version` CI job
(`race-cli golden check`) fails otherwise, and also when `rust-toolchain.toml` changes until the bump is re-frozen with
matching digests. Old entries stay as history; a frozen digest is never rewritten. The `fuzz` CI job
(`race-cli fuzz --cases 2000`, then the same with `--adversarial`) must report 0 panics, 0 unfinished races and
0 non-finite values.

Old races are not affected by a bump: they replay from their stored DTRK/1 track (`docs/replay-tracks.md`).

## Write-ups

Each balance version is documented in `docs/balance/<version>.md` (`S3.12.md` … `S3.16.md`), with raw outputs in
`artifacts/balance-<version>/` (for example `artifacts/balance-s3-16/`).

## The TS engine (retired)

Up to `S3.15` (engine `1.2.0`) races ran on the TypeScript engine. It was frozen at the rewrite branch cut
(`d8c69d1`, 2026-11-09, plan D28) so the Rust port could be measured against it (parity gates G1, balance gate G3),
and deleted in plan Phase 9 with its balance scripts (`scripts/balance-*.ts`, `scripts/lib/balance-sim-*`). The last
tree with it is git tag `ts-engine-final`; the write-ups up to `S3.15.md` refer to those scripts.
