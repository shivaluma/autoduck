# TS oracle tooling

The TS engine in `packages/race-core` and `packages/race-protocol` is the
**oracle** for the Rust port (`docs/rewrite-plan.md`, D3 and gate G1). It is
frozen: nothing here changes it. These scripts run it and write traces that
`race-cli oracle diff` compares against the Rust engine.

| File | Purpose |
|---|---|
| `dump-trace.ts` | Runs the TS engine per corpus case and writes per-tick state hashes, the event digest and standings. |
| `collation-table.ts` | D6 collation key table (owned by the `collate_compat` module). |
| `dump-cosmetic-fixtures.ts` | Shop `seededScore`/week/rotation, gacha roll/selection/pity, QP rewards and appearance/legacy planner fixtures for `crates/server/tests/{gacha,cosmetics_economy,catalog}.rs` (`crates/server/tests/fixtures/cosmetics.json.gz`; `--check` verifies it is current). |
| `dump-meta-fixtures.ts` | Season meta parity fixture (D5): Chaos rules, card draws on `chaos:week:N` / `chaos:manual:N:<ms>`, toggle-skip, auto-loadouts, `validateLoadout`, catalog. Writes `crates/race-core/tests/fixtures/meta-parity.json.gz` (12,017 cases); checked by `cargo run -p race-cli --features ts-compat -- oracle meta` and `cargo test -p race-core --features ts-compat --test meta_parity`. |

## Workflow

```fish
# 1. Corpus (deterministic; case i depends only on the root seed and i)
cargo run -p race-cli --release -- corpus gen --count 2000 --out corpus.jsonl
#    Phase 2 stage "core": no loadouts, pickups, golden box or hazards
#    (same lobbies, seeds, ghosts and Chaos as `full`); trace it with
#    `dump-trace.ts --ai-ablation all`
cargo run -p race-cli --release -- corpus gen --count 300 --profile core --out core.jsonl
#    Phase 2 stage "items+pickups": every player gets a loadout (all 46
#    combos), the golden box is forced in some cases and some cases carry
#    manual wild-item inputs (`oracleManualInputs`, below)
cargo run -p race-cli --release -- corpus gen --count 400 --profile items --out items.jsonl

# 2. Check every line against the TS raceConfigSchema (no simulation)
node --import tsx scripts/oracle/dump-trace.ts --corpus corpus.jsonl --validate-only

# 3. TS traces (about 0.15-0.45 s per case; shard across processes)
node --import tsx scripts/oracle/dump-trace.ts --corpus corpus.jsonl --out trace.jsonl
node --import tsx scripts/oracle/dump-trace.ts --corpus corpus.jsonl --shard 0/4 --out trace-0.jsonl.gz

# 4. Full f64 bit dump of the first divergent case only
node --import tsx scripts/oracle/dump-trace.ts --corpus corpus.jsonl --from 137 --limit 1 \
  --full-at 137 --full-out case-137.full.jsonl --out /dev/null

# 5. Diff the Rust engine against the trace (gate G1). On macOS the oracle
#    must run with `node --no-use-std-math-pow` (the header is checked).
cargo run -p race-cli --release --features ts-compat -- oracle diff \
  --corpus corpus.jsonl --trace trace.jsonl.gz [--report diff.json]
#    or let it run the oracle: --ts-cmd "node --no-use-std-math-pow --import tsx scripts/oracle/dump-trace.ts"

# 6. Rust side of one case in the --full-at format, compared field by field
cargo run -p race-cli --release --features ts-compat -- oracle diff \
  --corpus corpus.jsonl --trace trace.jsonl.gz --dump-case 137 \
  --dump-out case-137.rust.jsonl --ts-full case-137.full.jsonl
```

`dump-trace.ts` flags: `--corpus <path>` (or a positional path), `--out
<path|->` (default stdout; a `.gz` suffix gzips), `--from N`, `--limit N`,
`--shard i/n` (keeps cases with `index % n == i`), `--max-ticks N` (default
`CORE_BALANCE.maximumDurationSeconds * tickRate` = 5,400), `--hash-prefix-bytes
N` (default 8), `--event-prefix-bytes N` (default 4), `--full-at <case>`,
`--full-out <path>`, `--validate-only` and `--ai-ablation none|all` (`all`
passes every player as `aiAblationPlayerIds`, so lane tactics are off; the
header then carries `"aiAblation":"all"` and `race-cli oracle diff` runs the
Rust engine with the same `SimOptions::ai_ablation`). The case index is the 0-based line
number in the corpus, independent of `--from`/`--shard`. It exits 1 if any case
failed and 2 on bad arguments.

## Corpus format

One JSON object per line, in the **TS input shape** accepted by
`raceConfigSchema.parse` (defaults not applied, optional keys may be absent).
The generator is `crates/race-cli/src/corpus.rs` (`corpus-v1`, root seed
`0x4455434b52414345`). Case `i` uses chaos slot `i % 8` (none, then `NORMAL`,
`REVERSE`, `DUO`, `TRIPLE_ELIMINATION`, `CUT_LINE`, `CONSTRUCTORS`,
`BOUNTY_HUNT`) and lobby `2 + (i / 8) % 15`, so any 120 consecutive cases
starting at a multiple of 120 cover every pair. Pickups (omitted = off, `enabled:
false`, the official production block, randomised), ghost ducks, loadouts,
item tuning, upper/mixed-case seeds and player-id formats are drawn per case.

Float knobs (`itemTuning.*`, `pickupConfig.goldenBoxProbability`,
`pickupConfig.spawnMultiplier`) are written as awkward decimal text:

- shortest round-trip text that needs 17 significant digits;
- the range bounds and the adjacent doubles just inside them (including
  `5e-324` written out in full);
- 18-25 significant digits in exponent form (`1.7947783424100667293288e0`);
- the exact decimal expansion of the midpoint between two adjacent doubles,
  which only a correctly rounding parser resolves (ties to even);
- short values in unusual forms (`1e0`, `125e-2`, `1E-1`, `1.0`).

An `items` corpus line may carry one extra top-level key,
`oracleManualInputs`: an array of `RecordedWildItemInput`s (`{raceId,
playerId, wildItemInstanceId, action: "USE", clientActionId,
authoritativeTick}`). It is not part of `raceConfigSchema`: `dump-trace.ts`
(`parseCaseLine`) strips it and passes it verbatim as
`SimulationOptions.manualInputs`, and `race-cli oracle diff` does the same with
`SimOptions::manual_inputs`.

Integer fields are always plain integers. TS would also accept `3.0` for
`regularPickupCap`, but no producer writes that.

## Trace record (`oracle-trace-v2`)

The first line is the **host header**:
`{"kind":"header", traceFormat, stateHashVersion, eventDigestVersion, platform,
arch, node, v8, execArgv, nodeOptions, useStdMathPow, aiAblation?}` (`aiAblation` only when not `none`). `Math.exp`/`Math.pow`
depend on the host (see `docs/rewrite/phase1-notes.md`, `## math`), so
`race-cli oracle diff` maps the header to a `js_math::V8Target` and refuses a
host it can't model: darwin with the default `--use-std-math-pow` (run the
oracle with `node --no-use-std-math-pow`, or in `linux/amd64`). Concatenated
shards repeat the header; all copies must agree. Since v2, a NaN/±Infinity in
event metadata makes the case fail (`stage: "events"`) instead of being
written as `null`, matching the Rust JCS writer (D7).

Then one JSON line per case:

| Key | Meaning |
|---|---|
| `case` | 0-based corpus line. |
| `ok` | `false` means the TS side threw. The record then has `stage` (`parse`, `create`, `step`, `hash`, `events`), `tick` and `error`. |
| `raceId`, `players`, `engineVersion`, `balanceVersion` | From the parsed config. |
| `finished`, `finalTick`, `maxTicks` | The loop is `observe(); while (!finished && tick < maxTicks) { step; observe() }`. |
| `stateHashVersion` | `sh1` (below). |
| `tickHashes` | Concatenated hex of the first `hashPrefixBytes` bytes of `state_hash` for ticks `0..=finalTick`. Tick 0 is the state right after `createSimulation`. Entry `t` is at hex offset `t * 2 * hashPrefixBytes`. |
| `stateChainSha256` | Fold over **every** tick: `acc_0 = 32 zero bytes`, `acc = sha256(acc ‖ u32le(tick) ‖ state_hash(tick))` for ticks `0..=finalTick`. |
| `motionSha256` | The same fold over ticks `t > 0` with `t % 60 == 0`, then the final tick if it was not already folded. This is the D9 `motionSha256` definition the Rust digest should use. |
| `eventDigestVersion`, `eventCount`, `eventsSha256` | `ev-jcs-v1` (below). |
| `tickEventHashes` | Concatenated hex of the first `eventPrefixBytes` bytes of sha256 over the events emitted during each observation step (tick 0 = events from `createSimulation`). A tick with no events hashes the empty string (`e3b0c442…`). |
| `standings` | `resultFromSimulation(state).standings` (ghosts excluded) with `finishTimeBits` (raw f64 bits, big-endian hex). `null` if unfinished. |

`--full-at <case>` writes one line per tick for that case: `{case, tick,
stateSha256, fields: [[name, type, value], ...], events: [{jcs, f64: [...]}]}`.
`fields` is the `sh1` field list below, in order, with each f64 given as its
**raw** bits (16 hex digits, big-endian, so `-0` shows as `8000000000000000`
and NaN payloads are visible; the hash canonicalises them). `events[].f64` lists
the raw bits of every number in that event in JCS order.

## `sh1` state encoding (what Phase 2 `state_bytes` must mirror)

`state_hash = sha256(state_bytes)`. Encoding rules (plan D4/D16):

- `u8`: 1 byte. `u32`: 4 bytes little-endian. The TS side throws if an
  integer field is not an integer in range.
- `f64`: `to_bits()` little-endian, except every NaN is written as
  `0x7ff8000000000000` and `-0.0` as `+0.0`.
- `str`: `u32` UTF-8 byte length, then the UTF-8 bytes.
- Arrays: `u32` element count, then the elements.

Fields, in order:

```text
u32  tick                         state.tick (0 before the first step)
u8   finished                     state.finished
u32  ducks.length
for each duck in state.ducks order (= players sorted by playerId with
localeCompare at createSimulation; the order never changes afterwards):
  str  playerId
  f64  progress
  f64  previousProgress
  f64  lateralOffset
  f64  speed
  f64  acceleration
  f64  lateralVelocity
  f64  desiredSpeed
  f64  desiredLateralOffset
  u32  currentRank
  u32  nextImpulseTick
  u8   finished
  u8   finishTimeMs.present       0 when finishTimeMs is null
  f64  finishTimeMs               only when present == 1
  u32  pacingSegments.length
  f64  pacingSegments[i]          each
  u32  rngState                   the duck's xorshift32 state (rngByPlayer)
  u32  activeEffects.length
  str  activeEffects[i]           wire names, in itemActiveEffects order
```

`sh1` covers duck physics, the per-duck RNG position and the visible effects.
Item runtimes, rockets, bananas, pickups and hazards are not hashed directly.
Their effects show up in duck physics, `activeEffects` and the event stream
within a tick or two. If Phase 2 needs earlier localisation, add fields as a
new version (`sh2`) on **both** sides; never change `sh1` in place.

## `ev-jcs-v1` event digest

Each engine event is serialised with RFC 8785 JCS over its TS wire shape
`{raceId, type, tick, timestampWithinRaceMs, sourcePlayerId?, targetPlayerId?,
metadata}`:

- keys sorted by UTF-16 code units, recursively;
- `undefined` members omitted (so absent optional ids leave no key; D7);
  `undefined` array elements written as `null`;
- numbers as ES `Number::toString` (the ryu-js format; `-0` becomes `0`),
  with NaN/Infinity as `null` (what `JSON.stringify` persisted);
- strings as `JSON.stringify` writes them;
- no `seq` (D7). `CHAOS_RESOLVED` and `QP_TRACK_REWARD_GRANTED` are skipped;
  the engine never emits them.

`eventsSha256 = sha256(concat(jcs(event) + "\n"))` over all events in emission
order.
