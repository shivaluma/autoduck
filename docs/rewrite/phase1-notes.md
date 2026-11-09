# Phase 1 notes: Rust foundations

Working notes for Phase 1 of `docs/rewrite-plan.md`. Each module agent fills in
its own section. Do not edit another module's section, and do not edit the
shared files listed under "Workspace" without coordinating.

## Workspace (skeleton)

Owner files: `Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml`, `clippy.toml`,
`.gitignore` (`/target`), `crates/*/Cargo.toml`, `crates/race-core/src/lib.rs`,
`crates/race-protocol/src/lib.rs`.

- Crates: `race-protocol`, `race-core` (both `#![no_std]` + `alloc`, optional
  `std` feature, default off), `race-wasm` (cdylib + rlib), `race-cli` (std
  binary). The `server` crate arrives in Phase 3.
- Edition 2024, `resolver = "3"`, `rust-version = "1.99"`.
- Profiles (D1): `[profile.release] panic = "unwind"` and
  `overflow-checks = true` for both `race-core` and `race-protocol` through
  `[profile.release.package.<name>]`. Cargo allows `overflow-checks` in
  per-package overrides, so no workspace-wide fallback was needed. `race-wasm`'s `-C panic=abort` is applied by `scripts/build-wasm.sh`
  (see `## tooling`).
- Toolchain (D27): `rust-toolchain.toml` pins `1.99.1` with clippy, rustfmt,
  `wasm32-unknown-unknown` and `wasm32-wasip1` (profile `minimal`). rustup
  installed it as its own toolchain `1.99.1-aarch64-apple-darwin`, separate
  from `stable`. That install needed network access once.
- Clippy bans (D4(b)) are in the root `clippy.toml`. `race-core` and
  `race-protocol` set `#![forbid(clippy::disallowed_methods,
  clippy::disallowed_types)]`, so a local `#[allow]` can't switch them off.
  Besides the D4(b) list, the bans cover `f32::{max,min,signum,clamp,
  total_cmp}` and, as a second guard behind no_std, every std-only float
  method on `f64` and `f32` (`sin`, `cos`, `tan`, `sin_cos`, `exp`, `exp2`,
  `exp_m1`, `ln`, `log*`, `ln_1p`, `powi`, `powf`, `hypot`, `cbrt`, the
  `atan`/`asin`/`acos`/hyperbolic families, `sqrt`, `round`,
  `round_ties_even`, `floor`, `ceil`, `trunc`, `fract`, `rem_euclid`,
  `div_euclid`). The `std` feature of both crates only forwards `std` to
  dependencies; neither crate has `extern crate std`, so those methods don't
  even resolve in engine code. `wasm32v1-none` (no std at all) is in
  `rust-toolchain.toml` and CI builds both crates for it, with and without
  `ts-compat`. `race-cli` sets `#![allow(...)]` because it is a
  native-only tool. `race-wasm` keeps clippy's default `warn`, which
  `-D warnings` turns into errors, so the bans also hold in the browser glue.
  A scratch probe confirmed that every configured path resolves and fires:
  `f64::{mul_add,max,min,signum,clamp,total_cmp}`, `f32::mul_add`,
  `slice::sort_unstable{,_by,_by_key}`, `std::collections::{HashMap,HashSet}`
  and `serde_json::{Value,Map}`. The probe also covered
  `slice::select_nth_unstable*`. "`usize` in hashed or serialized structs" from
  D4(b) can't be expressed as a clippy path, so `scripts/ci/check-wire-usize.sh`
  greps race-core and race-protocol for `usize` fields. Error-detail fields
  that are never hashed or serialized carry `// usize-ok: <reason>`.
- Clippy's default `unnecessary_sort_by` lint suggests `sort_unstable` for
  `sort_unstable_by(|a, b| a.cmp(b))`. Its suggestion is banned anyway, so
  write `sort()` or `sort_by_key()`.

### Pinned crate versions vs. the plan

All versions are pinned with `=` in `[workspace.dependencies]`.

| Crate | Plan | Pinned | Notes |
|---|---|---|---|
| serde | 1 | 1.0.229 | `default-features = false`, `derive` + `alloc`; `std` comes through crate features. |
| serde_json | 1 (D4(d)) | 1.0.154 | `default-features = false`, `alloc` + `float_roundtrip`. Both features exist in 1.0.154, so D4(d) applies as written. It is declared directly in race-core, race-protocol and race-wasm. |
| libm | 0.2 | 0.2.16 | `force-soft-floats` **exists** and is enabled. The default `arch` feature is turned off, so no platform intrinsic (wasm `f64.sqrt`, x86 SSE) is used. |
| ryu-js | 1 | 1.0.3 | Always `#![no_std]`. There is no `std`/`no_std` feature, only `small`, which stays off. `default-features = false` is a no-op kept for clarity. |
| sha2 | 0.10 (D12) | 0.11.1 | `default-features = false` (drops `alloc`/`oid`). The 0.11 API is `Sha256::new()/update()/finalize()` from `digest 0.11`, and the output is a `hybrid-array` `Array`, not `GenericArray`. aarch64 may use SHA hardware instructions through `cpufeatures`; that changes speed only, never output. |
| indexmap | 2 | 2.14.2 | Declared in the workspace with `default-features = false`; no crate uses it yet. |
| ts-rs | 10 | 12.0.1 | Requires std. It is behind race-protocol feature `ts-export = ["std", "dep:ts-rs"]`. Default features (`serde-compat`) are kept. |
| wasm-bindgen | =newest (D27) | =0.2.129 | Matches `wasm-bindgen-cli 0.2.129`, verified with `wasm-bindgen --version`. |
| rayon / clap / flate2 / thiserror / anyhow | n/a | 1.12.0 / 4.6.7 / 1.1.10 / 2.0.21 / 1.0.104 | race-cli only. |

Transitive dependencies were resolved by `cargo fetch` and are recorded in
`Cargo.lock`. They are not individually pinned.

`! cargo tree -p race-core -e normal --target wasm32-unknown-unknown | grep -E 'getrandom|rand'` passes (nothing matches).

## versions (`race_protocol::versions`)

Owner file: `crates/race-protocol/src/versions.rs` (done in the skeleton).

D2 constants: `RACE_ENGINE_VERSION "2.0.0"`, `RACE_BALANCE_VERSION "S3.16"`,
`RACE_PROTOCOL_VERSION "2.0.0"`, `RNG_VERSION "xs32-v1"`,
`DIGEST_VERSION "jcs-sha256-v2"`, `TRACK_FORMAT "dtrk/1"`,
`TRACK_VERSION "river-01-v2"`, `PICKUP_SPAWN_VERSION "pickups-v2"`,
`HAZARD_BALANCE_VERSION "hazards-v2"`, and `RACE_TICK_RATE: u32 = 60`, which
matches `packages/race-protocol/src/index.ts:10`.

## build_id (`race_core::build_id`, `crates/race-core/build.rs`)

Owner files: `crates/race-core/build.rs`,
`crates/race-core/build/engine_build_id.rs`,
`crates/race-core/src/build_id.rs` and `crates/race-cli/tests/build_id.rs`.

`ENGINE_BUILD_ID` is a sha256 hex string passed in with
`cargo:rustc-env=ENGINE_BUILD_ID` and read with `env!`. The hashing lives in
`build/engine_build_id.rs`, which `build.rs` includes with `#[path]`, so
race-cli's `tests/build_id.rs` can include the same file, recompute the id from
the checked-out tree and assert it equals the compiled constant. That catches a
stale id when cargo skipped the build script (an mtime-preserving restore over a
cached `target/`). The hash covers, in order (each frame is
`name \0 len:u64le bytes`):

1. A domain tag (`autoduck/engine-build-id/v2`).
2. Every `*.rs` file under `crates/race-core/src` and
   `crates/race-protocol/src`, sorted by `/` path. Editor and merge leftovers
   (`*~`, `*.orig`, `*.rej`, `*.swp`, `*.bak`, `#x#`, dotfiles) are ignored.
   Any other regular file, a symlink or a special file fails the build: an
   `include_str!` target has to be added to `EXTRA_SOURCE_EXTENSIONS` on purpose.
3. `crates/race-core/{Cargo.toml,build.rs,build/engine_build_id.rs}` and
   `crates/race-protocol/Cargo.toml`.
4. The behaviour-relevant part of the root `Cargo.toml`, with comments and
   blank lines stripped: the `[workspace.dependencies]` entries of crates in the
   engine graph (so `float_roundtrip`, `force-soft-floats`, `alloc` and the
   pins are covered), `edition` from `[workspace.package]`, and every
   `[profile.*]`, `[patch.*]` and `[replace]` section.
5. `.cargo/config.toml`, if it exists. It is only watched when present,
   because cargo treats a missing `rerun-if-changed` path as always dirty.
   The self-check test catches a newly created file.
6. The engine subgraph of `Cargo.lock`: starting from the `[dependencies]`
   declared by race-core and race-protocol (normal dependencies only; dev and
   build dependencies are excluded, and so is `ts-rs`, which only generates
   `.ts` files), every reachable package as `name version source checksum`.
7. The compiler: the `release:`, `commit-hash:` and `LLVM version:` lines of
   `$RUSTC -vV`. `host:` is left out so the Mac and CI agree.
8. The `channel` of `rust-toolchain.toml`. Other keys (components, targets,
   profile) don't change engine output.
9. One byte for whether `ts-compat` is enabled.

Choices:

- **Of the cargo features, only `ts-compat` is hashed.** Hashing every enabled
  feature made the native build (race-cli enables `std`) report a different id
  from wasm, which breaks the D16 build-id match.
- The target triple and the profile are never hashed. Engine code has no
  `debug_assert!`, so debug and release behave the same.
- **Verified:** the lockfile walk excludes tooling crates (`flate2`, `clap`,
  `rayon`, `ts-rs`, `wasm-bindgen`, `anyhow`, race-cli, race-wasm; unit test
  `engine_lock_subgraph_ignores_tooling_deps`), so a race-cli-only dependency
  can't change the id; the self-check
  test passes in debug and release; the native `race-cli build-id` and the
  shipped package's `engineBuildId()` print the same id (CI checks this too).
- **Feature unification hazard.** A workspace-wide build with race-core's
  `ts-compat` enabled anywhere compiles every crate with the TS-compat maths
  and a different id. race-cli therefore enables only race-protocol's
  `ts-compat` (which adds `resolve_ts_compat` and nothing else). The Phase 3
  server must be built and tested with `-p autoduck-server`.

`race-wasm` exports `engineBuildId()` and `versions()`. `versions()` returns a
camelCase JSON string. `race-cli build-id` prints the native id.

## math (`race_core::math`)

Owner file: `crates/race-core/src/math.rs`. D4(a)/(c):
`js_round`/`js_max`/`js_min`/`js_sign`/`cmp_f64_js` and libm wrappers.

Done: see the `## math` section at the end of this file. After review 2:

- `js_clamp` is `js_max(lo, js_min(hi, x))`, the nesting every TS module uses
  (`Math.max(minimum, Math.min(maximum, value))`). The first version had the
  nesting reversed and gave the wrong answer for inverted bounds (`lo > hi`
  returns `lo` in TS) and for `(0, -0)` bounds. `tests/math.rs` now checks it
  against `tests/fixtures/clamp-node24.json` (9,261 triples over 21 values,
  from `scripts/oracle/dump-clamp-fixture.ts`).
- `sort_by_f64_key`, `sort_by_f64_key_desc` and `sort_by_f64_key_then` sort by
  an f64 key with `cmp_f64_js` and panic on a NaN key before sorting, so the
  failure is immediate and identical on every target. Use them instead of a
  bare `sort_by` on float keys.
- The module doc says NaN payloads and signs are not part of the contract:
  never compare engine floats with raw `to_bits()` outside
  `hash::canonical_f64_bits`.
- `tests/math.rs::libm_wrapper_outputs_are_pinned` pins sha256 over 1M seeded
  outputs each of `math::{exp,pow,hypot,sin,cos,atan2,ln,sqrt}` (canonical
  NaN). CI runs it natively on x86_64 and aarch64 and under `wasm32-wasip1`,
  so it is also the native-vs-wasm check of the Phase B maths.

## rng (`race_core::rng`)

Owner files: `crates/race-core/src/rng.rs` and `crates/race-core/tests/rng.rs`
(+ fixtures). D5.

Done: see `## rng details` further down.

## canonical (`race_core::canonical`)

Owner files: `crates/race-core/src/canonical.rs` and
`crates/race-core/tests/canonical.rs` (+ goldens). D9 JCS writer.

Also owns `scripts/oracle/dump-jcs-goldens.ts` and
`crates/race-core/tests/fixtures/jcs-goldens.jsonl`.

**API.** `JcsWriter` is a streaming writer that owns a `String`:
`begin_object/key/end_object`, `begin_array/end_array`, `null`, `bool`,
`string`, `number(f64)`, `u32/i32/u64/i64`, `value<T: JcsValue>`, `field`,
`field_opt` (omits `None`, the JS `undefined` convention), `object_unsorted`
(sorts `(&str, &dyn JcsValue)` members, then writes them) and
`finish`/`finish_bytes`. Typed structs implement `trait JcsValue`. There are
impls for `f64`, `u8..u64`, `i8..i64`, `bool`, `str`, `String`, `Option<T>`
(`None` is `null`), `[T]`, `[T; N]`, `Vec<T>`, `&T` and
`BTreeMap<String, V>`. The map impl re-sorts its keys, because byte order
is not UTF-16 order. There is deliberately no impl for `usize` (D4(b)) or
`f32`. `to_jcs_string` and `to_jcs_vec` are the one-shot helpers.

**Key order.** The writer does not buffer or sort. It **checks** that each
key is strictly greater than the previous key in UTF-16 code units, so
out-of-order keys return `KeyOrder` and repeats return `DuplicateKey`.
Several helpers handle ordering:
- `utf16_cmp` uses `encode_utf16().cmp(..)`.
- `sort_keys_utf16(&mut [&str])` and `sort_by_utf16_key(items, key_fn)` both
  use a stable `sort_by`.
- `const fn utf16_cmp_const` and `const fn keys_sorted_utf16` let a typed
  struct assert its field-name list at compile time:
  `const _: () = assert!(keys_sorted_utf16(&KEYS));`. The unit tests do this
  for the 12 `DigestEnvelope` keys.

UTF-16 order differs from byte order only between U+E000..U+FFFF and the
astral planes. The const version maps U+E000..U+FFFF above every astral
scalar.

**Errors.** `JcsError::{NonFiniteNumber, UnsafeInteger, KeyOrder,
DuplicateKey, Structure(&str), Poisoned}`. Any error poisons the writer, and
`finish` then fails. Integers outside ±(2^53−1) are rejected instead of
rounded. `JcsError` implements `core::error::Error`, so no `std` gate is
needed.

**Numbers.** After the finiteness check, numbers go through
`ryu_js::Buffer::format_finite`. ryu-js 1.0.3 already prints both zeros as
`"0"` (`pretty/mod.rs`, `ieee_exponent == 0 && ieee_mantissa == 0`), so `-0`
needs no special case. The integer methods format digits directly. The
goldens check that they match the float path for every safe-integer golden.

**Strings.** `\" \\ \b \f \n \r \t`, other bytes below 0x20 as `\u00xx`
(lowercase), everything else raw, including U+007F, U+2028/2029 and astral
characters. Lone surrogates can't occur because `&str` can't hold them, and
the goldens never generate them.

**Goldens.** Regenerate with
`node --import tsx scripts/oracle/dump-jcs-goldens.ts [--seed 8785] [--out …]`.
The script is deterministic with a xorshift32 seed; two runs are
byte-identical, sha256 `14c8994a…2dff94`.
- Size: 10,000 cases in a 3.2 MB file: 4,000 numbers, 2,000 strings and
  4,000 trees (objects and arrays up to depth 4).
- Reference: plain ECMAScript. `JSON.stringify` for numbers, asserted equal
  to `String(x)`. `JSON.stringify` for strings. Objects take explicitly
  sorted `[key, value]` member lists, sorted with JS `<`, which compares UTF-16
  code units. The member list is passed in random order and can include
  integer-like keys, which JS objects would reorder. This reference is **not**
  `audit.ts canonicalize`.
- Number inputs are carried as f64 bit patterns in hex, so no parser sits on
  the test path.
- Number coverage:
  - the RFC 8785 Appendix B patterns;
  - ±3 ulps around 1e21, 1e-6, 1e-7, 5e-7, 2^53, 0.1 and every 10^e for
    e in −12..25;
  - 2^53 ± 0..8 and big integers up to 2^80;
  - short k/10^n decimals and k/60;
  - 350 subnormals;
  - 1,000 random 17-significant-digit decimals;
  - 1,200 uniformly random finite bit patterns.
- String coverage: all control characters, U+2028/2029, BOM, U+E000–U+FFFF,
  Vietnamese, astral characters and ZWJ sequences.
- Key coverage: the RFC 8785 §3.2.3 example, plus keys around the
  U+FB33-vs-emoji ordering boundary.
- Each line also stores Node's sha256 of the JCS text, and the Rust test
  checks that through `create_race_commit`.

**Results.**
- Native (`cargo test -p race-core --test canonical`): 10,000/10,000
  byte-equal (number 4,000/4,000, string 2,000/2,000, tree 4,000/4,000), and
  sha256 10,000/10,000.
- `wasm32-wasip1` under wasmtime 50: also 10,000/10,000. That is not a gate
  requirement; I ran it with `env CARGO_TARGET_WASM32_WASIP1_RUNNER=wasmtime`.
  The fixture is embedded with `include_str!`, so no filesystem is needed.
- Mutation check: changing one golden from `1e+21` to `1e21` made the test
  fail on both affected cases.

The integration test parses the goldens with `#[derive(Deserialize)]` into a
typed enum, never `serde_json::Value`. One test carries
`#[allow(clippy::excessive_precision)]` because it uses the RFC §3.2.2 input
literal `333333333.33333329` on purpose.

## digest (`race_core::digest`)

Owner file: `crates/race-core/src/digest.rs`. D9.

Contents:
- `sha256(&[u8]) -> [u8; 32]`.
- `to_hex` (lowercase).
- `sha256_hex`.
- `create_race_commit(engine_config_json: &[u8])`, which is `seedCommit`.
- `result_digest(envelope_jcs: &[u8])`.
- `jcs_sha256_hex<T: JcsValue>`, for `trackDefSha256`, `resultDigest` or any
  digest over JCS.
- `jcs_with_commit<T>`, which returns `(engineConfigJson, seedCommit)`.

The sha2 0.11 output (`hybrid_array::Array`) is copied into a `[u8; 32]` with
`copy_from_slice`. The tests pin the empty and `abc` NIST vectors and a
Node-computed hash of `[1e+21,5e-7,0]`. `DigestEnvelope`, `eventsSha256` and
the `motionSha256` fold are not here yet. Their input types (race-protocol
`result.rs`, the hash module's `state_hash`) belong to other modules and
Phase 2. They should implement `JcsValue` in race-core, which the orphan rule
allows because the trait is local, and call `jcs_sha256_hex`.

## hash (`race_core::hash`)

Owner file: `crates/race-core/src/hash.rs`. `StateHasher` with typed `write_*`
methods, following the `state_hash` encoding paragraph after the D16 frame list.

Done during integration (no module agent had picked it up).

- `canonical_f64_bits`: every NaN becomes `0x7ff8000000000000`, `-0.0`
  becomes `+0.0`, everything else is `to_bits()`.
- Trait `StateWrite`. Implementors provide `write_bytes`, and the trait
  supplies `write_u8`, `write_bool`, `write_u32`, `write_i32`, `write_f64`,
  `write_len` (a `usize` that must fit in `u32`, otherwise it panics),
  `write_str` (`u32` UTF-8 length, then the bytes), `write_opt_f64` (a `u8`
  presence flag, then the value) and `write_f64_slice` / `write_str_slice`
  (a `u32` count, then the elements). Everything is little-endian.
- `StateHasher` (the sha256 sink, `finish() -> [u8; 32]`) and `ByteSink(F)`.
  `ByteSink` forwards to any `FnMut(&[u8])`, and the Phase 2 signature
  `state_bytes(&Simulation, &mut impl FnMut(&[u8]))` is built on it.
- `HashFold`: `acc = sha256(acc ‖ u32le(tick) ‖ state_hash)` starting from
  32 zero bytes, with `is_motion_tick(tick)` (`t > 0 && t % MOTION_STRIDE ==
  0`, `MOTION_STRIDE = 60` fixed by D9 and never the config tick rate) and
  `push_final` (folds the final tick only if it was not folded already). This
  matches `stateChainSha256` / `motionSha256` in `scripts/oracle/README.md`.
- `STATE_HASH_VERSION = "sh1"`. The field list Phase 2 has to mirror is the
  `sh1` list in `scripts/oracle/README.md`. The TS side is `visitState` in
  `dump-trace.ts`.
- Gate item "`state_hash` on a fixed state is identical natively and under
  `wasm32-wasip1`": `write_fixed_test_state` writes a 264-byte `sh1`-shaped
  state with 2 ducks. It covers both NaN payloads, `-0`, a subnormal,
  `f64::MAX`, `+Inf`, `1e21`, `u32::MAX`, an absent and a present optional, an
  empty array, Vietnamese text and an `i32`. The unit test
  `hash::tests::fixed_state_hash` pins
  `4ea499aa7bc9bc9cf3ed9009696fe244f91f2f602d07e3d854dfd24bb8310ceb`, which was
  computed independently with Python `struct` + `hashlib`. It passes natively
  and under wasmtime 50 (`wasm32-wasip1`, release).
- `tests/trace_sh1.rs` checks the encoder against the TS oracle itself: it
  re-encodes the committed `--full-at` dump of corpus case 13 (900 ticks,
  `tests/fixtures/trace-sh1-case13.full.jsonl.gz`, 176 KB) with
  `StateHasher`, folds `stateChainSha256`/`motionSha256` with `HashFold` and
  the `eventsSha256` digest, and requires every value in the trace record.
  901/901 tick hashes, both folds, and 22/22 events (digest and typed
  `RaceEvent` parse) match.

## js_math (`race_core::js_math`, feature `ts-compat`)

Owner files: `crates/race-core/src/js_math.rs` and
`crates/race-core/tests/js_math.rs`. D3: V8 hypot/exp/pow.

Done: see the `## math` section at the end of this file.

## collate_compat (`race_core::collate_compat`, feature `ts-compat`)

Owner files: `crates/race-core/src/collate_compat.rs`,
`crates/race-core/tests/collate.rs` and `scripts/oracle/collation-table.ts`.
D6.

Done. See "## collate" at the end of this file.

## race-protocol modules

Owner files: `crates/race-protocol/src/{ids,config,events,snapshot,result,replay_track,legacy}.rs`.
These implement D6 (ids), D8 (config, legacy), D7 (events), D16 (snapshot),
D9 (result) and D10/§4.2 (replay_track).

Done: see `## protocol` further down, and `docs/rewrite/protocol-mapping.md`.

## race-cli (`corpus gen`, `oracle diff`, `oracle meta`, `gate`)

Owner file: `crates/race-cli/src/main.rs` (split into submodules as needed).
`corpus gen` is implemented (`crates/race-cli/src/corpus.rs`; see `## tooling`).
`oracle diff`, `oracle meta` and `gate` are still stubs that print "not
implemented" and exit 2. `oracle diff` needs Phase 2's `step()`. `oracle meta`
and its `meta-parity.json.gz` fixture are **not done** (see "Phase 1 gate
(integration)" at the end).

## race-wasm

Owner file: `crates/race-wasm/src/lib.rs`. Phase 1 exports
`engineBuildId()` and `versions()`, plus the `benchStubResim` perf stub (see
`## tooling`, "WASM perf harness"). The Phase 5 driver comes later.

## collate

Owner files: `crates/race-core/src/collate_compat.rs`,
`crates/race-core/src/collation_table.rs` (generated),
`crates/race-core/tests/collate.rs`, `crates/race-core/tests/fixtures/collate*`,
`scripts/oracle/collation-table.ts`. Decision D6.

**API** (`race_core::collate_compat`):

- `byte_order(a, b)` is `Ord for str`, the Phase B order. It is always compiled.
- `is_id_byte`, `is_valid_id` (`^[0-9A-Za-z_:-]{1,64}$`),
  `is_valid_client_action_id` (same alphabet, 8–64 chars), `MAX_ID_LEN`,
  `MIN_CLIENT_ACTION_ID_LEN`. Always compiled.
- `compare(a, b) -> Ordering` and `ICU_ORDER` need feature `ts-compat`. The
  comparison runs a primary pass over the shared prefix, then compares
  lengths (the shorter string sorts first), then runs a tertiary (case)
  pass. Bytes outside the alphabet get a deterministic order after every id
  byte. That order does not model ICU, so callers must validate ids first.
- **Shared-file edit:** in `crates/race-core/src/lib.rs`, `pub mod
  collate_compat;` is no longer gated on `ts-compat`, so `byte_order` and
  the validators exist without it. The ICU items inside the module are
  gated. `collation_table.rs` is loaded with `#[path]` from inside
  `collate_compat`, so `lib.rs` lists no module for it. Nothing else shared
  was changed.

**Findings in Node 24.17.0 (ICU 78.3, CLDR 48.0, Unicode 17.0):**

- The ICU primary order is `_ < - < : < 0-9 < a/A < … < z/Z`. Punctuation
  sorts before digits, and `_` sorts before `-` and `:`. In byte order the
  sequence is `- < 0-9 < : < A-Z < _ < a-z`.
- Each character in the alphabet maps to exactly one collation element:
  there are no contractions, expansions, ignorables or secondary
  differences.
- Case is tertiary with lowercase first (`caseFirst: "false"`). `localeCompare`
  returns 0 only for identical ids.
- The production locale doesn't matter. `localeCompare` resolves to `en-US`
  when `LANG` is unset, `C`, `C.UTF-8` or `en_US.UTF-8`, and to `vi-VN` under
  `vi_VN.UTF-8`. V8 maps ICU's POSIX fallback to `en-US`, so code-point
  order is never used. `Intl.Collator('en-US-u-va-posix')` *would* use
  code-point order, but nothing in the app requests it.
- `localeCompare`, `Intl.Collator()`, `Intl.Collator('en')` and
  `Intl.Collator('vi')` gave the same sign on every exhaustive case and every
  generated pair (0 disagreements). The `vi` tailoring only touches
  non-ASCII letters. `--check` passes with `LANG=C` and `LANG=vi_VN.UTF-8`,
  and its output is byte-identical to the committed fixtures.

**Oracle and fixtures:** `node --import tsx scripts/oracle/collation-table.ts`
writes the outputs below. `--check` regenerates them in memory and diffs them
against disk (for CI). `--pairs N --seed S` override the defaults.

- `src/collation_table.rs` holds `ORDER`, and `PRIMARY`/`TERTIARY` as
  `[u8; 128]` (0 means outside the alphabet). It carries `#[rustfmt::skip]`,
  so `cargo fmt` doesn't make it stale.
- `tests/fixtures/collate-pairs.bin` (250,048 bytes): `COLLATE1`, a u32 seed,
  a u32 count, the sha256 of the pair stream (`a\nb\n` per pair), then the
  `localeCompare` signs packed 2 bits each (0 `=`, 1 `<`, 2 `>`). The 1M
  pairs themselves would take about 40 MB, so they aren't stored. The Rust
  test regenerates them with the `collate-gen-v1` xorshift32 generator,
  which is mirrored in the test, and asserts the sha256 matches before it
  trusts any sign.
- `tests/fixtures/collate-short.txt` lists all 4,290 ids of length ≤ 2 in
  Node's sort order.
- `tests/fixtures/collate-meta.json` records versions, sign counts and the
  per-collator disagreement counts.
- **Generated formats:** `String(userId)` digit strings; `duck-N`;
  `p1`/`P1`; `prep:<RaceItemId>`; `wild:<WildItemId>` (plus `MAGNET`); wild
  instance ids `wild:<raceId>:<box|gold>:pickup-zone-N:zN-aM:<userId>`;
  hazard ids; lowercase UUIDs (`clientActionId` comes from
  `crypto.randomUUID()`); track ids (`zN-aM`, `pickup-zone-N`,
  `gate-N-lane-M`); random strings over the full alphabet up to 64 chars; a
  collision-heavy `aAbB0_:-` alphabet; and misc ghost/king ids.
- **Pair mutations:** another id of the same format, another format, a
  one-character replacement, random case flips, truncation to a prefix, an
  extension, an insertion, an identical copy, and a mixed case-flip plus
  replacement. Every generated id passes `is_valid_id`.
- **Sign mix:** 430,521 `<`, 138,704 `=`, 430,775 `>`.

**Gate results:**

- `cargo test -p race-core --features ts-compat --test collate` runs 6
  tests, all passing. **1,000,000 / 1,000,000 pairs (100.0000%)** are
  sign-equal to Node's `localeCompare`. The stream sha256 matches
  (`5b6660d3…24cd`). All 4,290 short ids sort in Node's order.
- The JS mirror of the model was also checked exhaustively for every id of
  length ≤ 3 (278,915 ids, sorted) against all 4 collators, with 0
  mismatches.
- Byte order agrees with `localeCompare` on only 827,636 / 1M pairs
  (82.76%). Phase B's switch to byte order is therefore a real ordering
  change wherever ids mix case, punctuation or digits at the same position.
  It belongs with the F-fixes and the G3 comparison, not G1.
- `cargo test -p race-core --test collate` (without `ts-compat`) runs 2
  tests, both passing.
- `cargo clippy -p race-core --all-features [--all-targets] -- -D warnings`
  passes. `cargo clippy -p race-core --tests -- -D warnings` passes.
  `rustfmt --check` passes on the owned files.
- Building race-core and race-protocol for `wasm32-unknown-unknown` passes,
  with and without `ts-compat`. Building race-core with `ts-compat` for
  `wasm32-wasip1` passes.

**Open items:**

- The TS schema allows `clientActionId` of 8–160 characters with any
  content (`packages/race-protocol/src/index.ts:44`). D6 tightens that to
  8–64 characters over the id alphabet. The production
  `crypto.randomUUID()` values (36 chars) fit, but the server-side
  validation in Phase 3 must reject what TS used to accept.
- The model is ASCII-only by design. If D6 validation is ever relaxed (to
  allow display names or non-ASCII), `compare` stops modelling ICU.
- The table comes from Node 24.17 / ICU 78.3. A Node or ICU upgrade should
  re-run `--check`. Root collation for ASCII has been stable across ICU
  versions, but that is an assumption, not a guarantee.

## rng details

Owner files: `crates/race-core/src/rng.rs`, `crates/race-core/tests/rng.rs`,
`scripts/oracle/dump-rng-fixtures.ts`, `crates/race-core/tests/fixtures/rng-*.json.gz`.

Port of `packages/race-core/src/rng.ts` (D5, `RNG_VERSION xs32-v1`).

- API: `hash_string(&str)` (FNV-1a over `encode_utf16()` and the avalanche),
  `hash_utf16(impl IntoIterator<Item = u16>)` (accepts lone surrogates),
  `DeterministicRng::{new(&str), from_utf16(..), state(), next_u32(),
  next_f64(), range(f64, f64), integer_f64(f64, f64), integer(i64, i64),
  index(usize)}` and `create_race_rng(seed, stream)` keyed `"{seed}:{stream}"`.
  `next()` is named `next_f64` because `next` reads like `Iterator::next`.
- Seeding: only the first splitmix32 output is used, and zero becomes
  `0x6d2b79f5`, as in TS. `Math.imul`, `>>> 0` and `+=` on int32 values map
  to `wrapping_mul`, `u32` shifts and `wrapping_add`; JS's
  `hash += hash << 13` can exceed 2^32, but every following op goes through
  ToInt32/ToUint32, so `u32` wrapping is exact.
- `range` is a separate multiply then add, never `mul_add`. `integer` is
  computed in `f64` (`min + libm::floor(next * (max - min + 1))`), so it equals
  TS for bounds up to 2^53 in magnitude, including reversed bounds
  (`integer(5, 2)`). `integer` takes `i64` (debug-asserted to be within ±2^53),
  and `integer_f64` keeps the raw JS signature. `index(len)` is the common
  `items[rng.integer(0, items.length - 1)]` form; it panics on `len == 0`,
  where TS would read `undefined`.
- `hashString` is module-private in TS, and the oracle must not be edited. The
  dump script writes a verbatim copy of `rng.ts` plus one
  `export { hashString as __oracleHashString }` line to a temp directory and
  imports it. Before using the copy, it checks that the copy's
  `DeterministicRng` matches the real module's. The fixtures record the
  oracle's sha256 (`cf930b4f…f14b`).
- The hash fixture (`rng-hash.json.gz`, 428 KB) stores no strings. Committing
  1M strings and hashes would be several MB of incompressible data, so both
  sides generate the strings with `strgen-v1`, a mulberry32-driven,
  integer-only UTF-16 generator. TS writes it in the dump script, and the Rust
  test has a line-for-line port. The generator covers 16 character classes:
  ASCII, separators, Latin-1, Vietnamese precomposed and NFD combining marks,
  CJK, Hangul, emoji pairs, any astral character, lone high/low surrogates,
  any code unit, controls, BOM and noncharacters. Lengths run from 0 to 2,000
  code units. The fixture stores, per 1,000-string chunk, sha256 over the
  strings' code units (to catch generator drift) and sha256 over the u32 LE
  hashes. It also stores 3,996 explicit samples (units + hash; the first 2,000
  and every 500th) and 28 curated edge cases. 1M strings, 43.96M code units:
  9,899 empty, 202,186 with lone surrogates, 171,448 with astral pairs. Both
  `hash_utf16` and, for well-formed input, `hash_string` are checked.
- The stream fixture (`rng-streams.json.gz`, 1.8 MB) has 10,000
  `createRaceRng(seed, stream)` cases. Seeds are cuid, uuid, numeric,
  Vietnamese/emoji text and empty. Streams are the real engine and meta labels
  (`track:start`, `duck:`, `auto-use-*`, `temperament:`, `pickup-*`,
  `gold-box:`, `hazards:`, `auto-loadout:`, `chaos:week:N`,
  `chaos:manual:N:<ms>`, `balance-matrix:MIXED`, empty, random well-formed
  text). Each case has the first 8 `next()` values as f64 bit-hex, then 3
  `range` calls (bit-hex in and out, including ±0, ±1e308, reversed and
  degenerate bounds) and 3 `integer` calls (including `[-2^40, 2^40]` and
  reversed bounds). A separate `meta` block covers 5 seeds × 9 meta streams.
  Seeds and streams there are always well-formed, because production seeds are
  DB strings and Rust takes `&str`.
- `meta_streams_match_inline_ts_values` hardcodes TS output for
  `chaos:week:3` (two seeds), `auto-loadout:<id>` and `chaos:manual:3:<ms>`,
  so meta continuity is pinned even without the fixture files.
- The fixtures are byte-reproducible: two dump runs gave identical sha256s.
  Regenerate with `node --import tsx scripts/oracle/dump-rng-fixtures.ts
  [outDir]` (~10 s).
- Shared-file edit: `crates/race-core/Cargo.toml` gained
  `[dev-dependencies] flate2 = { workspace = true }` to read the gzip
  fixtures. It is not in the normal or wasm graph. Fixtures are parsed with
  `serde_json::from_slice` into typed structs, so serde_json's `alloc`-only
  feature set is enough and no `Value` is used.

Results:

| Check | Result |
|---|---|
| `hashString`, 1,000,000 generated strings | 1,000,000/1,000,000 (1000/1000 chunk digests); generator port 1000/1000 chunks; samples 3,996/3,996 |
| `hashString` edge cases | 28/28 |
| `createRaceRng`, 10,000 (seed, stream) cases | 10,000/10,000 (140,000 values: 80,000 `next`, 30,000 `range`, 30,000 `integer`) |
| Meta streams (fixture) | 45/45 (630 values) |
| Meta streams (inline, incl. `chaos:week:3`) | pass |
| Same test, `wasm32-wasip1` release under wasmtime 50 | 6/6 pass, same numbers |
| `cargo clippy -p race-core --all-features --all-targets -- -D warnings` | pass |
| `cargo build -p race-core -p race-protocol --target wasm32-unknown-unknown` (debug and release) | pass |

The full `--test rng` takes ~37 s in the debug profile (sha2 and the
generator are unoptimized) and ~2.3 s with `--release`.

## tooling

Owner files: `crates/race-cli/src/corpus.rs`, the `corpus` subcommand in
`crates/race-cli/src/main.rs`, `scripts/oracle/dump-trace.ts`,
`scripts/oracle/README.md`, `scripts/build-wasm.sh`,
`crates/race-wasm/src/lib.rs` (the `benchStubResim` stub only),
`crates/race-wasm/bench/*` and `.github/workflows/rust.yml`. No shared file was
changed: no `Cargo.toml`, lockfile, `.gitignore` or `lib.rs` module list.

### `race-cli corpus gen`

`race-cli corpus gen --count N --out corpus.jsonl [--seed <u64|0xhex>]`. The
default count is 2000. `--out -` writes to stdout. A coverage summary goes to
stderr.

- **Determinism.** It uses splitmix64, a tooling-only stream that is never the
  engine RNG. Each case is seeded from `(root seed 0x4455434b52414345, index)`,
  so case `i` is the same in any corpus length, and longer corpora extend
  shorter ones. `CORPUS_GENERATOR_VERSION = "corpus-v1"`.
- **Coverage.** Chaos slot is `i % 8`: no `chaosConfig`, then the 7 types.
  `DUO` gets shuffled pairs (a trailing single joins the last pair), as the TS
  `prepare` does. `CONSTRUCTORS` gets two `ceil(n/2)` teams and `BOUNTY_HUNT` a
  target. Lobby size is `2 + (i/8) % 15`, so the first 120 cases cover all
  8 × 15 (chaos, lobby) pairs. A unit test checks this.
- **Pickups.** 25% omitted (the TS engine treats a missing block as off), 10%
  `enabled:false`, 25% the official block from `lib/season3-race.ts`, and 40%
  randomised. `disabledItems` holds at most 4 items, because `rollWildItem`
  throws when every item is disabled.
- **Other draws.** Ghosts (30% of cases, sometimes 2), loadouts, item tuning,
  and explicit copies of the TS version strings.
- **Awkward inputs.** Upper-case and mixed-case seeds (the regex is `/i`, and
  case changes the FNV stream). Player ids from `[0-9A-Za-z_:-]{1,12}`, mixed
  digit lengths, and `p:`/`u_`/`:` prefixes, for D6 collation. Names with
  Vietnamese, CJK, emoji, quotes, backslashes and tabs.
- **Float knobs.** These are the 6 numeric knobs in the schema: 4 in
  `itemTuning`, plus `goldenBoxProbability` and `spawnMultiplier`. Each is
  written as one of five text forms:
  - shortest text that needs 17 significant digits;
  - a range bound or the adjacent double just inside it, including `5e-324`
    written out in full;
  - 18–25 significant digits in exponent form;
  - the exact decimal of a midpoint between two adjacent doubles, which must
    round ties-to-even;
  - a short value in an unusual form (`1e0`, `125e-2`, `1E-1`, `1.0`).
- **JSON writer.** It is hand-written, so number text is kept exactly as
  generated (serde_json would re-format it).
- **Integer fields** are always plain integers. TS would also accept `3.0`,
  but no producer writes it. If D8 `resolve()` should accept it, add it as an
  explicit case later.

Results:

| Check | Result |
|---|---|
| `cargo test -p race-cli` | 6/6 pass |
| awkward-float unit test: serde_json (`float_roundtrip`) and `str::parse` vs the intended f64 | 20,000/20,000 bit-equal |
| `dump-trace.ts --validate-only` on 2,000 cases (TS `raceConfigSchema`) | 2,000/2,000 accepted |
| V8 `JSON.parse` vs Python `float()` on every float knob in the 2,000-case corpus | 3,790/3,790 bit-equal |
| Coverage of 2,000 cases | every lobby 128–136×; every chaos slot 250×; pickups omitted 501, disabled 200, production 494, randomised 805; 599 ghost cases; float forms 1003/630/437/431/301 |

### `scripts/oracle/dump-trace.ts`

This script defines the `sh1` state hash, the folds and the `ev-jcs-v1`
event digest. All three are specified in `scripts/oracle/README.md`, which
Phase 2's `race_core::hash::state_bytes` and `race-cli oracle diff` must mirror
exactly.

`sh1` is little-endian. Integers are `u32` (`u8` for flags); lengths are `u32`.
f64 values are written as their bits, with every NaN as `0x7ff8000000000000`
and `-0` as `+0`. Strings are a `u32` UTF-8 byte length followed by the bytes.
The encoded fields are:

- `tick`, `finished` and the duck count;
- for each duck in `state.ducks` order:
  - `playerId`;
  - 8 physics f64s;
  - `currentRank` and `nextImpulseTick`;
  - `finished`;
  - an optional `finishTimeMs`;
  - `pacingSegments`;
  - the duck's xorshift32 `rngState`;
  - `activeEffects`.

Item and pickup world state is not hashed. Extending the hash means a new
version, `sh2`, on both sides.

- **Motion fold.** `motionSha256` folds `sha256(acc ‖ u32le(tick) ‖
  state_hash)` over ticks `t > 0` with `t % 60 == 0`, then over the final tick.
  I propose this as the concrete D9 `motionSha256` definition.
- **Per-tick hashes.** Each tick's hash and each tick's event hash are stored
  as prefixes, 8 and 4 bytes by default, to keep traces small. The full chain
  `stateChainSha256` covers every tick at full width.
- **Full dump.** `--full-at <case>` writes every hashed field by name for every
  tick. Each f64 is the raw bit pattern before canonicalisation. Each event is
  written as its JCS text plus the bits of every number in it.
- **Host header (trace format `oracle-trace-v2`, review 2 finding 2).** The
  first line records `platform`, `arch`, Node and V8 versions, `execArgv`,
  `NODE_OPTIONS` and `useStdMathPow`. `race-cli oracle diff --trace <file>`
  checks that every (shard) header agrees, maps it to a `V8Target` name and
  refuses darwin with the default std `pow`. The Rust side uses
  `js_math::OracleHost { target, use_std_math_pow }` (exp, pow, hypot2), not the
  host-blind `exp()`/`pow()` defaults. The diff itself still waits for Phase 2.
- **Non-finite numbers** in event metadata now throw (the case fails at stage
  `events`) instead of being written as `null`, matching the Rust JCS writer
  and D7. `nonFiniteEventNumbers` is gone from the record (it was 0 in every
  case measured).
- **Importable.** `main()` runs only when the file is the entry script, so
  tools can import `visitState`/`jcs`.

Results:

| Check | Result |
|---|---|
| 2,000-case corpus, 4 shards (`--shard i/4`, gz) | 2,000/2,000 ok, 2,000 finished, 0 TS errors. Final ticks 3,262–3,687. 987,065 events (14–1,481 per case). 0 non-finite event numbers. ~260 s wall per shard on a loaded machine. 4 × 16.7 MB gz. |
| Rerun determinism (first 40 cases, two runs and a refactor apart) | 40/40 records byte-identical |
| Independent Python re-implementation of `sh1`, the folds and the event digest from the README, fed by `--full-at` dumps (case 3: 2 ducks, 3,283 ticks; case 117: 16 ducks, 3,610 ticks, 1,279 events) | every per-tick hash, `stateChainSha256`, `motionSha256`, `eventsSha256`, `eventCount` and per-tick event hash matched (0 mismatches) |
| `tsc --strict` (nodenext) and `eslint` on the script | clean |

### `scripts/build-wasm.sh`

- **Build.** `RUSTFLAGS='-C panic=abort --remap-path-prefix=…'` (and
  `CARGO_ENCODED_RUSTFLAGS` unset) `cargo build -p race-wasm --release --locked
  --target wasm32-unknown-unknown --target-dir target/race-wasm`. The remaps
  map `$CARGO_HOME/registry/src`, `$CARGO_HOME/git/checkouts` and the repo
  root to `/cargo/…` and `/src`, so panic-location strings no longer contain
  the local path or username and the artifact is the same on a dev machine and
  in CI (`strings` finds no home path).
- **Version check.** The script reads the `wasm-bindgen` version from
  `Cargo.lock` and requires `wasm-bindgen --version` to equal it (D27).
- **Packaging.** `wasm-bindgen --target web` writes to `crates/race-wasm/pkg`.
  The script then writes `pkg/.gitignore` (`*`) and `pkg/package.json`
  (`"type":"module"`). That keeps the build output out of git without editing
  the shared `.gitignore`, and lets Node import the package without a
  module-type warning.
- **Missing CLI.** Without the wasm-bindgen CLI it warns and exits 0, unless
  `--require-bindgen` or `RACE_WASM_REQUIRE_BINDGEN=1` is set. CI sets it.
- **Overrides.** `--bindgen-target`, `--out-dir` and environment variables.
- **Verified.** Built and packaged with wasm-bindgen 0.2.129. The
  `race_wasm_bg.wasm` is about 62 KB with the stub. The module loads in Node
  and in headless Chrome.

### WASM perf harness (`crates/race-wasm/bench`)

`benchStubResim(ducks, ticks, work, seed)` is exported from race-wasm and
documented as non-engine code. `bench-core.mjs` has a line-for-line JS port.
`run-node.mjs` is the Node runner; with `--ts-reference` it also times the real
TS engine and prints `R = TS engine µs/tick ÷ JS stub µs/tick`. `index.html`
plus `bench-browser.mjs` run the same comparison in a page. `run-chromium.mjs`
is an optional Playwright runner that uses CDP
`Emulation.setCPUThrottlingRate`. The README covers manual DevTools 4×
throttling and the extrapolation `ported-engine ≈ wasm stub × R`.

The stub keeps all ducks racing for 5,400 ticks (the worst case). The machine
was an 8-core arm64 Mac under heavy parallel-build load (load average 16–22),
so treat these numbers as rough:

| Runtime | wasm stub, 8 × 5,400 | JS stub | wasm/JS |
|---|---|---|---|
| Node 24 | 128–158 ms | 82–93 ms | 1.6–1.7 |
| Headless Chrome 156, CPU 4× (scripted run, `--channel chrome`) | 540 ms (100 µs/tick, 50 ms per 500-tick chunk) | 216 ms | 2.5 |

With TS engine R ≈ 19 (8 ducks, production pickups, Node), the extrapolated
ported engine is about 2.4 s in Node and about 10 s in Chrome at 4×, for a full
5,400-tick re-sim. The TS engine measured 83–110 µs/tick for 8 ducks with
`recordEvents:false` and 290 µs/tick with events.

### `.github/workflows/rust.yml`

There are four jobs. Every job reads `channel` from `rust-toolchain.toml` and
passes it to `dtolnay/rust-toolchain@master`, which installs it with the
targets and components; rustup then selects it through the file. Caching uses
`Swatinem/rust-cache@v2`, and the tool installs use `taiki-e/install-action@v2`.

- **`rust`:**
  - `cargo fmt --all --check`;
  - `cargo clippy --workspace --all-targets --locked -- -D warnings`, once
    with `--all-features` and once with default features (the shipped
    configuration);
  - `scripts/ci/check-wire-usize.sh` (D4(b) `usize` rule);
  - `cargo test --workspace --all-features --locked`, then the build-id
    self-check again without `ts-compat`;
  - the `! cargo tree … | grep getrandom|rand` gate for race-core **and**
    race-wasm;
  - a corpus-generation smoke test.
- **`wasm`:**
  - install wasm-bindgen at the `Cargo.lock` version;
  - check that the CLI version equals the crate pin;
  - build race-core and race-protocol for `wasm32-unknown-unknown`, and for
    `wasm32v1-none` with and without `ts-compat` (no std exists there, so a
    dependency that quietly needs std fails the build);
  - run clippy on race-wasm for the wasm target;
  - run `scripts/build-wasm.sh --require-bindgen`;
  - Node smoke run of the package;
  - `race-cli build-id` must equal the package's `engineBuildId()`;
  - upload `crates/race-wasm/pkg` as `race-wasm-pkg` for the later corpus run
    on the shipped artifact (D27).
- **`determinism`:**
  - matrix of ubuntu-latest (x86_64) and macos-latest (aarch64);
  - run `cargo test -p race-core -p race-protocol --release` natively with
    default features (the shipped configuration) and with
    `--features race-core/ts-compat`, then both again with
    `--target wasm32-wasip1` under wasmtime 50.0.0. This covers the pinned libm
    outputs, the fixed `state_hash` and the TS `sh1` trace on both
    architectures;
  - Phase 2 extends this job to compare corpus state-hash chains.
- **`serde-features`** (D4(e)), which checks three things:
  - `cargo tree -p race-core -e features -i serde_json` is identical native and
    `--target wasm32-unknown-unknown`;
  - the unified native workspace graph and the race-wasm wasm graph agree on
    the parse-relevant features. These are `float_roundtrip`, which must be
    present, and `arbitrary_precision`, which must be absent. The `std`/`alloc`
    difference is printed but allowed: today native has
    `{alloc, float_roundtrip, std}` and wasm has `{alloc, float_roundtrip}`;
  - when the server crate lands in Phase 3, switch the native side to
    `-p autoduck-server`.
- **Checked locally.** The YAML parses. The serde-features script was
  dry-run locally and passes.

### Deviations

- **wasmtime runner.** `CARGO_TARGET_WASM32_WASIP1_RUNNER` is `wasmtime run
  --dir=${{ github.workspace }}`, not bare `wasmtime`. The race-core `rng` and
  `collate` tests open fixtures by absolute path under the workspace. With bare
  `wasmtime`, the `rng` test aborted (exit 134); with the preopen, all 6
  `--test rng` tests passed under wasmtime locally.
- **Determinism tests use `--release`.** They are much faster under wasmtime;
  `--test rng` takes about 47 s in debug.
- **No `oracle diff` yet.** The `determinism` job has no corpus comparison,
  because there is no Rust `step()` yet. `race-cli oracle diff` belongs to
  another module.
- **aarch64 runner.** aarch64 runs on `macos-latest`, which is available to
  private repositories, instead of `ubuntu-24.04-arm`.

### Unresolved

- **The C9/R19 catch-up budget looks off by an order of magnitude.** The plan
  assumes 100–300 ms on mobile. The stub extrapolates to seconds at 4×.
  - In this workload wasm is 1.6–2.5× **slower** than V8 JIT. The likely cause
    is that `exp`, `powf` and `hypot` run as soft-float libm compiled to wasm,
    while V8 runs them as native builtins. The real port will also use soft
    libm because of D4(a).
  - Re-measure on a quiet machine. Then decide in Phase 2/5 between three
    options: a smaller re-sim window (snapshot-assisted join), cheaper AI
    evaluation on the client, or accepting a longer join spinner.
- **Trace size.** A 2,000-case trace is about 67 MB gzipped with 8-byte tick
  prefixes. Shrink it with `--hash-prefix-bytes 4` if CI storage matters.
- **TS sim cost.** The TS sim takes about 0.13–0.5 s per case on this machine.
  G1 on 2,000 cases needs sharding, which is supported (`--shard i/n`).

## protocol

Owner files: `crates/race-protocol/src/{ids,config,events,snapshot,result,replay_track,legacy}.rs`,
`crates/race-protocol/tests/*`, `crates/race-protocol/bindings/` (generated),
`docs/rewrite/protocol-mapping.md` (the full schema/event mapping with TS
source lines). This section fills the "race-protocol modules" placeholder
above.

**Gate.** `cargo fmt -p race-protocol --check` passes.
`cargo clippy -p race-protocol --all-features --all-targets -- -D warnings`
passes, and so does the same command without `--all-features`.
`cargo build -p race-core -p race-protocol --target wasm32-unknown-unknown`
(debug and release) and `--target wasm32-wasip1` pass. `cargo test -p
race-protocol --all-features` runs 146 tests: 31 protocol tests plus 115
ts-rs export tests. All pass, and 1 env-gated test is ignored. At the time of
writing, `cargo clippy -p race-core --all-features` fails on three lints in
`js_math.rs`, which belongs to the js_math module, not this one.

**TS oracle round-trip.** `tests/fixtures/ts-oracle/dump-protocol-fixtures.mts`
runs the unmodified TS engine (Zod parse plus `createSimulation`/`stepSimulation`)
and writes the fixtures. Output is deterministic and takes about 35 s.

| Check | Result |
|---|---|
| Every event in 5 full races | 1,553 / 1,553 deserialise and re-serialise identically (keys + f64 bits) |
| One event per distinct (type, keys, value shapes) over 400 races | 98 / 98, 63 types |
| Every event over 400 races (ignored test, `RACE_PROTOCOL_ALL_EVENTS=<ndjson>`) | 178,921 / 178,921 |
| Handwritten events for types the corpus never emits | 9 / 9; all 69 types covered |
| `STATE_SNAPSHOT` every 180 ticks | 102 / 102 |
| `RaceResult` | 5 / 5 |
| Config input → `resolve()` vs Zod; stored config → legacy | 5 / 5 |

**Decisions and deviations**

- **Feature name.** The ts-rs export sits behind the skeleton's `ts-export`
  feature, not `ts`. `cargo test -p race-protocol --features ts-export` writes
  115 files to `crates/race-protocol/bindings/`.
- **Shared-file edits (minimal).**
  - `crates/race-protocol/src/lib.rs`: `#![no_std]` became
    `#![cfg_attr(not(feature = "ts-export"), no_std)]`. (After review 1 there
    is no `extern crate std` at all; `std` only forwards to dependencies.) ts-rs 12
    derive output calls `format!`, `.to_string()` and similar unqualified, so it
    needs the std prelude. `ts-export` already implies std, and the default
    and wasm builds stay no_std. The module list is unchanged.
  - `crates/race-protocol/Cargo.toml`: ts-rs adds the feature
    `no-serde-warnings`, which silences the compile-time notes ts-rs prints
    for `deserialize_with`. No version changed, and `Cargo.lock` is unaffected.
- **ts-rs 12 vs 10.** ts-rs 12 makes a field optional automatically when it
  has `default` + `skip_serializing_if`, and renders it as `key?: T | null`.
  Each omittable field therefore carries an explicit `ts(optional)` so it
  renders as `key?: T`. `draftTarget` and the legacy chaos `targetPlayerId`
  use `ts(optional = nullable, as = "Option<…>")`.
- **69 variants, not 68.** `EventKind` has one variant per
  `raceEventTypeSchema` literal (69). 65 are emitted by the engine, 2 are
  server meta events, and 2 (`ITEM_ACTIVATED`, `PREDATOR_RUSH_ENDED`) are
  declared but never emitted. A test pins `TYPE_NAMES` to
  `raceEventTypeSchema.options`.
- **Metadata strictness.** All 45 metadata structs use
  `deny_unknown_fields`, so a key the Rust side does not model fails loudly.
  `tests/event_wire_keys.rs` (the D7 file) pins required, nullable and
  optional keys for all 69 types. Keys that TS sometimes leaves `undefined`
  are `Option` + `skip_serializing_if`. Keys that TS writes as `null`
  (`BOOST_BROKEN.endedItem`, `ROCKET_FIRED.decisionTargetId/executeTargetId`)
  are `Option` without it. `draftTarget` can be absent, `null` or an id, so it
  is `Option<Option<PlayerId>>`.
- **`seq`** is required on `RaceEvent`. TS fixtures get it injected as the
  event index.
- **D6 scope.**
  - `PlayerId` and `RaceId` use `^[0-9A-Za-z_:-]{1,64}$`. All current race ids
    match, including `race-lab-N` and `balance-eval-N`.
  - `ClientActionId` uses the same alphabet with length 8..64.
  - `wildItemInstanceId` stays a free string (TS bound 1..160) because the
    engine generates it.
  - `RaceSeed` is 64 hex digits, either case, kept verbatim.
- **D8 `resolve()`.**
  - It is the only place defaults live.
  - An absent `pickupConfig` resolves to the engine's "off" preset
    (`pickups/engine.ts:87-104`), not to the per-field defaults.
  - A present `pickupConfig` gets `goldenBoxProbability` 0.15.
  - An absent `chaosConfig` resolves to `NORMAL`, no target, no groups.
  - `itemTuning` becomes concrete numbers (1.25 / 0.15 / 1 / 1).
  - The versions default to the D2 constants, and a label that is present
    must describe this engine (review 3 M3): `engineVersion`,
    `protocolVersion`, `trackVersion`, `pickupSpawnVersion` and
    `hazardBalanceVersion` must equal the D2 constants and `balanceVersion`
    must be in `versions::SUPPORTED_BALANCE_VERSIONS` (today `["S3.16"]`);
    anything else is `ConfigError::UnsupportedVersion { field, value }`.
    `wildItemBalanceVersion` has no D2 constant, so it is passed through.
  - Range and size checks follow Zod, with UTF-16 lengths for `name` and
    `cosmeticKey`. Rust also rejects duplicate `playerId`s.
  - `engineVersion` with major < 2 is refused (`LegacyEngineVersion`). Stored
    TS configs go through `LegacyRaceConfigV1`.
  - **G1: `resolve_ts_compat()`** (feature `ts-compat` on race-protocol,
    enabled by race-core's `ts-compat` and by race-cli). It resolves a config
    exactly as the TS S3.15 oracle runs it: Zod's defaults
    (`goldenBoxProbability` 0.12, version labels `1.0.0`/`1.2.0`/`S3.15`/
    `river-01-v2`), labels passed through unchecked, engine ≤1.2.0 accepted.
    Absent `pickupSpawnVersion`/`hazardBalanceVersion` become the TS constants
    `lib/season3-race.ts` writes (`pickups-v1`/`hazards-v1`); the TS engine
    never reads them. It is the only resolver `oracle diff` may use; Phase B
    keeps `resolve()` and 0.15. `crates/race-cli/tests/config_ts_compat.rs`
    regenerates the 2,000-case corpus in process and compares every case with
    `scripts/oracle/dump-config-effective.ts` (Zod parse plus the engine's
    `pickupConfig()`/`itemTuning`/chaos fallbacks):
    **2,000 / 2,000 identical**, 448 of them on the 0.12 default. Before this,
    609 corpus cases could not resolve at all and 12 / 2,000 would have
    spawned a golden box the oracle doesn't.
- **Legacy.** `serde_json::Value` is banned (D4(b)), so `legacy.rs` has its
  own `LegacyJson` value type. `LegacyJson` also implements `Deserializer`, so
  typed legacy structs can be read out of it leniently. Numbers are `f64`,
  which is fine for display. `LegacyRaceConfigV1::parse` reads the text into
  `LegacyJson` first, so a repeated key keeps its last value like
  `JSON.parse` instead of failing the parse.
- **Legacy events (review 3 M2).** `LegacyRaceEvent { type, tick,
  timestampWithinRaceMs, sourcePlayerId?, targetPlayerId?, metadata:
  LegacyJson }`, built with `from_row(..)` from the `RaceEngineEvent` columns
  (unparsable `metadataJson` is kept as a string) and serialised without
  `seq`. Every row of an engine ≤1.2.0 race goes through it, never through
  `EventKind` (route with `LegacyRaceConfigV1::is_legacy_engine_version`).
  Tests: the 11 refused shapes from dev.db, plus an ignored test over a
  `sqlite3 -json` export (`RACE_PROTOCOL_LEGACY_EVENTS=<file>`). On the
  read-only dev.db export: 2,171 / 2,171 rows parse as `LegacyRaceEvent`; the
  typed `RaceEvent` would refuse 66, matching the review.
- **DTRK.** `DtrkHeader` declares its fields in UTF-16 sorted order, so the
  header JSON has sorted keys (tested on the raw text). `format.ts` (plan
  0.4) does not exist yet on any branch, so the section ids (1-5), change-kind
  codes (1-4) and preamble flag bit 0 are provisional.
- **Phase 2 notes for race-core.**
  - The faithful port must reproduce the TS quirk where natural
    `DRAFT_FIN_ENDED`/`PADDLE_BURST_ENDED` carry `startProgress`/`startRank`
    from the duck's last Nitro.
  - Every event emitted while an auto-used wild item activates gets
    `autoReason` appended (`auto-use/execute.ts:256`).
  - `JcsValue` impls for protocol types belong in race-core (orphan rule
    permits it). `eventsSha256` must skip `seq` and the two meta events
    (`EventKind::is_meta`).

**Unresolved / follow-ups**

- DTRK numbering must be reconciled with `lib/racing/replay-track/format.ts`
  when it lands on main.
- `ServerRaceMessage` (TS, unused) is not ported. The D16 SSE frames (`hello`,
  `clock`, …) are Phase 5 and are not defined here.
- No D2 `WILD_ITEM_BALANCE_VERSION` constant exists. Decide whether the 2.0
  engine should default it.
- TS consumers read keys no code writes: `BOOST_BROKEN.source` (the engine
  writes `breakSource`; `race-event-timeline.tsx:253` therefore always says
  "ROCKET"), `DUCK_FINISHED.rank`, `wildItemId` (`:61`), and
  `CHAOS_RESOLVED.summary` (`:452`) (details in `protocol-mapping.md`). The
  Rust wire keeps the TS keys; fix these consumers in Phase 4, when the
  strict generated types will flag them.
- serde_json writes integral floats as `1.0` where JS writes `1`. That only
  matters if someone compares wire text. Digests go through race-core's JCS
  writer.

## math

Covers `race_core::math` and `race_core::js_math` (feature `ts-compat`).

Owner files:
- `crates/race-core/src/math.rs`
- `crates/race-core/src/js_math.rs`
- `crates/race-core/tests/math.rs`
- `crates/race-core/tests/js_math.rs`
- `crates/race-core/tests/fixtures/math_gen.rs`, the input generator and fixture reader shared by both tests
- `crates/race-core/tests/fixtures/math-node24-{linux-x64,linux-x64-nofma,linux-arm64,darwin-arm64}.json`, about 365 KB each
- `scripts/oracle/dump-math-fixtures.ts`

No shared file was changed. The tests only use race-core's normal
dependencies: serde, serde_json and sha2.

### Results

Every test passes natively, in debug with overflow checks and in release. It
also passes under `wasm32-wasip1`/wasmtime: both test files give the same
digests, and the libm-wrapper reports are line-for-line identical to native.
`cargo build -p race-core -p race-protocol --target wasm32-unknown-unknown`
passes, with and without `ts-compat`. `cargo clippy -p race-core
--all-features [--all-targets] -- -D warnings` and `cargo fmt --all --check`
are clean.

Bit-equality with Node 24 per host. The generated inputs are 1,000,000 per
function for `hypot`/`exp`/`pow` and 100,000 for the helpers, plus 18 to
1,050 edge cases each:

| Function | linux-x64 | linux-x64-nofma | linux-arm64 | darwin-arm64 |
|---|---|---|---|---|
| `js_math::hypot2` / `hypot3` (`Math.hypot`) | 100% | 100% | 100% | 100% |
| `js_math::exp_on` (`Math.exp`) | 100% | 100% | 100% | 100% |
| `js_math::pow_legacy_on` (`Math.pow`, `--no-use-std-math-pow`) | 100% | 100% | 100% | 100% |
| `js_math::pow_on` (`Math.pow`, default flags) | 100% | 100% | 100% | **99.8745%** (1,255 differ, all ±1 ulp) |
| `math::js_round` / `js_sign` / `js_max` / `js_min` / `cmp_f64_js` | 100% | 100% | 100% | 100% |

The one residual is darwin `Math.pow` with default flags. By segment:
engine_grudge 254/250k, engine_half 232/150k, positive 247/150k,
int_exponent 160/100k, unit 87/50k, magnitude 74/50k, near_one 69/100k,
half_wide 67/50k, specials 64/50k, bits 1/50k. The test pins the count at
1,255.

For reference, the plain libm wrappers in `math.rs` against `Math.*` (not
V8's algorithms, informational only):

| Wrapper | linux-x64 | linux-arm64 | darwin-arm64 |
|---|---|---|---|
| `exp` | 99.9989% | 99.9626% | 99.9626% |
| `pow` vs default `Math.pow` | 92.31% | 92.31% | 92.29% |
| `hypot` | 71.58% | 71.58% | 71.58% |
| `sin` | 99.17% | 98.70% | 98.70% |
| `cos` | 99.15% | 98.74% | 98.74% |

### What V8 actually computes

The plan assumed fdlibm everywhere. These are the differences found, each
confirmed against V8 13.6.233.17 source (`src/base/ieee754.cc`,
`src/numbers/ieee754.cc`, `src/builtins/math.tq`) and the fixtures.

1. **`Math.pow` defaults to the host C library.** V8 13.6 ships
   `--use-std-math-pow` on by default. `math::pow` applies the ES special
   cases (`y` NaN gives NaN, `±1 ** ±∞` gives NaN, `y == 2` gives `x*x`,
   `y == 0.5` gives `sqrt(x+0)`, or ∞ when `x` is infinite) and then calls
   `std::pow`.
   - On Linux that is glibc 2.36's pow, the ARM optimized-routines algorithm.
     It is ported in `glibc_pow_impl`, from musl's MIT-licensed copy with the
     same tables, and is 100%.
   - On macOS it is Apple's closed-source libm. That one is not portable, and
     it is not correctly rounded either: on the 1,170 checkable diffs, glibc's
     result is closer to the exact value than Apple's in 828 cases (checked
     with Python `decimal`).
   - Default pow differs from legacy pow on 7.8% of inputs.
2. **V8's legacy pow (`--no-use-std-math-pow`) is not textbook fdlibm.** It
   has a misplaced parenthesis:
   `r = Divide(z*t1, (t1 - two) - (w + z*w))`. fdlibm has
   `(z*t1)/(t1-two) - (w+z*w)`. It is ported as is; without it the match
   rate is 96.4%.
3. **FP contraction differs by host.** Node's arm64 builds fuse `a*b + c`
   into FMAs. x86-64 baseline builds cannot.
   - macOS V8 is built by clang (`-ffp-contract=on`): only within a single
     expression, and the left product is preferred.
   - Linux V8 and glibc are built by gcc (`-ffp-contract=fast`): also across
     statements, when every use of the product is an add/sub in the same
     basic block.
   - Two cases had to be modelled explicitly. In V8's legacy pow on
     linux-arm64, `u = ivln2_h*t` is fused in the `|y| > 2^31` near-one
     branch; without that, 19 inputs differ. In glibc's `specialcase`, the
     CSE'd `scale*tmp` has a second use in another basic block, so gcc fuses
     neither use; without that, 5 inputs differ.
   - Without contraction modelling, exp is 99.96% and legacy pow 99.97% on
     arm64.
4. **glibc on x86-64 selects its FMA build of pow through `ifunc`.** The
   linux-x64 fixture comes from a CPU with FMA (Docker on Apple silicon
   reports `fma`/`avx2`). The non-FMA build is also ported and verified, as
   `V8Target::LinuxX64NoFma`, against a run with
   `GLIBC_TUNABLES=glibc.cpu.hwcaps=-AVX2,-FMA,-AVX512F`. `from_node` can't
   detect a CPU without FMA, so select that target explicitly.
5. **Apple's `scalbn` rounds twice for subnormal results.** It behaves as
   `x * 2^-1022 * 2^(n+1022)`. This only affects legacy pow outputs below
   2^-1022 on darwin and is modelled in `pow_scalbn::<APPLE>`.
6. **`Math.hypot` takes `FastMathHypot` for ≤ 3 arguments** in V8 13.6
   (`sqrt((a/m)^2 + (b/m)^2) * m`, with one compensation step for 3 args).
   For those arities it performs the same operations in the same order as the
   Kahan loop used for more arguments. `js_math::hypot(&[f64])` implements
   the loop, so it covers every arity. It is Torque/CSA code, so it does not
   depend on the host.
7. **`sin`/`cos` are not fdlibm in V8 either.** Node builds V8 with
   `V8_USE_LIBM_TRIG_FUNCTIONS`, which uses glibc-derived sin/cos, and the
   results also differ between x64 and arm64. libm matches 98.7–99.2%. The
   engine uses them only in `track.ts` `sample()`, which only
   `components/racing/*` (rendering) calls, so they don't affect G1. They
   would matter if Rust ever produced render coordinates that must match TS.
   Not ported.

### API

`math` (always available):
- `js_round`: V8's `Float64Round`, `c = ceil(x); c - 0.5 > x ? c - 1 : c`.
- `js_max`, `js_min`: NaN propagates; `max` returns +0 for a ±0 tie and
  `min` returns -0.
- `js_max_of`, `js_min_of`: fold over a slice; an empty slice gives ∓∞.
- `js_clamp`: `min(max(x, lo), hi)`.
- `js_sign`: preserves ±0 and NaN.
- `cmp_f64_js(a, b)`: the sign of `a - b` as an `Ordering`, and `Equal` when
  `a - b` is NaN, exactly like `Array.prototype.sort` treats a NaN comparator
  result. So ±0 are equal, `∞` vs `∞` is equal, and NaN is "equal" to
  everything. That is not a total order: Rust ≥ 1.81 `sort_by` may order
  differently from V8 or panic. NaN must never reach a sort key. Map
  `x - y || tiebreak` to `cmp_f64_js(x, y).then_with(...)`.
- `cmp_f64_js_sign`: the same comparison as a `-1`/`0`/`1` number.
- libm wrappers: `sqrt`, `exp`, `pow`, `hypot`, `sin`, `cos`, `atan2`, `ln`,
  `floor`, `ceil`, `trunc`, `abs`. They run as soft float, with the same bits
  on every target.

`js_math` (feature `ts-compat`):
- `V8Target`: `LinuxX64` (`DEFAULT`), `LinuxX64NoFma`, `LinuxArm64`,
  `DarwinArm64`.
  - `from_node(process.platform, process.arch)`, `from_name("linux-x64")`
    and `name()` convert to and from the host names.
  - `fp_contract()` and `apple_libm()` report the host traits.
- `hypot(&[f64])`, `hypot2`, `hypot3`: host-independent.
- `exp_on(target, x)`; `exp(x)` uses `DEFAULT`.
- `pow_on(target, x, y)` follows default Node flags; `pow(x, y)` uses
  `DEFAULT`.
- `pow_legacy_on(target, x, y)` follows `--no-use-std-math-pow`.
- Everything uses plain `+ - * /` and the software `libm::fma`, `sqrt` and
  `scalbn`, so each target's results are deterministic and identical
  natively and on wasm. The engine will call these under `ts-compat`, at
  `pickups/engine.ts:319-320` (hypot2), `chaos-utility.ts:107,131` (exp) and
  `brain.ts:114` (pow).

### Fixtures

- **Generator.** `scripts/oracle/dump-math-fixtures.ts` and `math_gen.rs`
  implement the same deterministic generator (`math-gen-v1`). Both use a
  splitmix32-style PRNG on `Math.imul`, and only exact IEEE ops (`+ - * /`,
  `abs`) plus bit construction, so the inputs are never stored.
- **Input segments.**
  - Engine-shaped: `exp(-|Δprogress|/0.02)`, `pow(0.5, (tick-g)/600)`,
    `hypot` of pickup deltas, `hypot(4200, dY)`.
  - Branch boundaries of the algorithms (0.5·ln2, 1.5·ln2, overflow and
    underflow thresholds, ±64 ulp around them).
  - Wide magnitudes, specials (±0, ±∞, NaN, subnormals, `1±ulp`) and raw
    random bit patterns.
- **What a fixture stores.** For each function:
  - sha256 per 1,024 outputs (first 8 bytes), as LE u64 with NaN mapped to
    `0x7ff8…`;
  - the full-stream sha256;
  - edge cases with their full bits.
  - For pow it also stores the legacy stream and a `diffVsLegacy` summary.
- **Exact mismatch counts.** `--full-dir <root>/<host>` plus
  `RACE_MATH_FULL_DIR=<root>` give exact per-input counts, per-segment
  counts and failing samples. Without them, the tests prove equality through
  the digests.
- **Regenerating.**
  - darwin-arm64 (Node v24.17.0, V8 13.6.233.17-node.49) runs natively.
  - Linux (Node v24.22.2, V8 13.6.233.17-node.63) runs in the official image
    `node:24-bookworm-slim`, index digest
    `sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9`,
    with `--platform linux/amd64` and `linux/arm64`. Node 24 strips the TS
    types itself, so no tsx is needed.
  - The exact commands are in the script header.
  - A rerun reproduces the darwin fixture byte for byte.

### Implications for G1 and what remains open

- **The G1 allowance depends on the oracle host.** `race-cli oracle diff`
  must pass the oracle's `V8Target`. `dump-trace.ts` should record
  `process.platform`/`process.arch` and the `--use-std-math-pow` state.
  - On Linux (CI, Docker) every engine function is 100%, so the measured
    residual is **0%**.
  - On macOS with default flags, `Math.pow` has a **0.1255%** residual
    (0.10% on the engine-shaped `pow(0.5, k/600)`). `brain.ts` calls pow
    every tick, so many races would diverge. Run the oracle with
    `node --no-use-std-math-pow` and use `pow_legacy_on(DarwinArm64)`, which
    is 100%, or run it in the Linux image.
  - Recommendation: G1's allowance is **0%** with the oracle on linux-x64.
- **Unresolved: Apple's default `Math.pow`.** It is not portable. The
  residual is documented and pinned, and there is no fix.
- **Unresolved: the contraction model is empirical.** It is 100% on these
  4M+ inputs per host, but a path the fixtures never exercise could fuse
  differently. Examples are glibc's k>0 `specialcase` (overflow-adjacent
  results) and pow with |y| ≥ 2^63. None of them is engine-shaped.
- **Unresolved: Node patch drift.** The Linux fixtures are from 24.22.2 and
  darwin's from 24.17.0, both on V8 13.6.233.17. A V8 minor bump could
  change `math.tq`, `ieee754.cc` or the `use_std_math_pow` default, so
  regenerate the fixtures whenever the oracle's Node changes.
- **Unresolved: `LinuxX64NoFma` is chosen by hand.** `from_node("linux", "x64")`
  assumes FMA.
- **Unresolved: sin/cos are not ported.** They are render-only today (see
  item 7 above).

## Review fixes (adversarial reviews 1–3)

Every blocker and major finding is fixed; minor findings are fixed where cheap
and otherwise listed under "Open issues" below. There were no blockers.

| Finding | Disposition |
|---|---|
| R1 M1: id ignores the root `Cargo.toml` | Fixed. Engine `[workspace.dependencies]` entries, `edition`, `[profile.*]`, `[patch.*]`, `[replace]` and `.cargo/config.toml` are hashed (see `## build_id`). race-protocol also gets `overflow-checks = true`. |
| R1 M2: whole `Cargo.lock` hashed | Fixed. Only the engine subgraph (normal deps of race-core/race-protocol, minus `ts-rs`) is hashed; adding a race-cli dependency leaves the id alone (unit test `engine_lock_subgraph_ignores_tooling_deps`). |
| R1 m3: editor leftovers change the id | Fixed. Only `*.rs` is hashed, leftovers are ignored, other files and symlinks fail the build. |
| R1 m4: toolchain file, not compiler | Fixed. `rustc -vV` release/commit-hash/LLVM lines and only the `channel` key are hashed. |
| R1 m5: backdated mtime leaves a stale id | Fixed. Shared `build/engine_build_id.rs` plus the race-cli self-check test (run in CI). |
| R1 m6: `std` feature hole | Fixed. No `extern crate std`; std float methods and `f32::{max,min,signum,clamp,total_cmp}` banned; `forbid` instead of `deny`. The race-wasm perf stub now uses the libm wrappers. |
| R1 m7: no_std not enforced | Fixed. CI builds both crates for `wasm32v1-none`, with and without `ts-compat`. |
| R1 m8: shipped config and libm untested | Fixed. Pinned libm wrapper outputs; default-feature tests natively and under wasip1 on both arches; clippy without `--all-features`. |
| R1 m9: `debug_assert!` in `rng.rs` | Fixed (`assert!`). |
| R1 m10: NaN sort keys panic | Fixed. `math::sort_by_f64_key{,_desc,_then}` refuse NaN keys up front. |
| R1 m11: local paths in the wasm | Fixed. `--remap-path-prefix` in `build-wasm.sh`. |
| R1 m12: `ts-compat` unification | Mitigated. race-cli enables only race-protocol's `ts-compat`; CI asserts `race-cli build-id` equals the package's `engineBuildId()`. The Phase 3 server rule (`-p autoduck-server`) is documented in `## build_id`. |
| R1 nits: `usize` guard, getrandom on race-wasm | Fixed (`scripts/ci/check-wire-usize.sh`; the getrandom check covers race-wasm). |
| R2 M1: `js_clamp` nesting | Fixed, with a Node fixture over 9,261 triples. |
| R2 M2: host not selected or recorded | Fixed for Phase 1. Trace host header, `oracle diff` host mapping that refuses darwin + std pow, `js_math::OracleHost`. Threading `OracleHost` through `SimOptions` is Phase 2 work. |
| R2 m3 / R3 m2: oracle writes NaN as `null` | Fixed. `dump-trace.ts` throws on non-finite event numbers. |
| R2 m4: `is_motion_tick(tick, tick_rate)` | Fixed. `MOTION_STRIDE = 60`, no parameter. |
| R2 m5: NaN payloads | Documented in the `math` module doc. |
| R3 M1: config resolution vs the oracle | Fixed. `resolve_ts_compat()` plus a 2,000-case Zod comparison (2,000 / 2,000). |
| R3 M2: stored legacy events | Fixed. `LegacyRaceEvent`; dev.db export 2,171 / 2,171 parse. |
| R3 M3: version labels unchecked | Fixed. `ConfigError::UnsupportedVersion`. |
| R3 m1: fixed-state hash never checked against TS | Fixed. `tests/trace_sh1.rs` over a committed `--full-at` dump; `main()` is guarded. |
| R3 m3: browser reads keys no event has | Documented for Phase 4 (protocol follow-ups). |
| R3 m4: legacy config leniency | Partly fixed: duplicate keys keep the last value. Wrong-typed known keys are still dropped (open issue). |
| R3 m5: coverage gaps | Open issue (low risk). |

## Open issues

- **Legacy config: wrong-typed known keys are dropped, not kept** (R3 m4).
  `tickRate:"60"`, `isGhost:"yes"`, `chaosConfig:null` and similar become
  their default, and the original value is lost. Keeping them in `extra` would
  emit a duplicate key on serialisation for non-optional fields (`players`),
  so this needs a design choice. None of the 6 dev.db configs is affected;
  re-check against the production copy (plan step 0.6).
- **Rocket expiry and `chaosBoxEnabled` coverage** (R3 m5).
  `ROCKET_EXPIRED`/`MINI_ROCKET_EXPIRED` never occur in ~340k TS events, so
  their `{}` shape is only covered by handwritten fixtures (the emit site,
  `items/engine.ts:579-581`, passes `{}`). `chaosBoxEnabled` has no effect on
  `river-01-v2` (no zone allows `CHAOS_BOX`).
- **`OracleHost` is not yet wired into the engine** (R2 M2, item 3). Phase 2
  must take it through `SimOptions` under `ts-compat`; `js_math::exp()` and
  `pow()` remain as linux-x64 defaults for tests and tools only.
- **G1 host.** The oracle should run in `linux/amd64` (or with
  `--no-use-std-math-pow` on macOS). The local production image
  `autoduck-phase0:ci07` is arm64, so it maps to `linux-arm64`, not the
  `linux-x64` default; `oracle diff` now reads the host from the trace instead
  of assuming it.
- **x86_64 NaN sign.** Not tested locally (no x86_64 machine); the CI
  `determinism` matrix runs the pinned libm outputs and the trace test on
  x86_64. `state_hash` canonicalises NaN, and nothing else may expose raw NaN
  bits (module doc).
- **`LinuxX64NoFma`** can't be detected from Node; `oracle diff
  --linux-x64-no-fma` selects it by hand.
- The earlier unresolved items under `## tooling` (catch-up budget, trace
  size, TS sim cost) and `## math` (Apple `pow`, the empirical contraction
  model, Node patch drift, sin/cos) still stand.

## Phase 1 gate (integration)

Run on 2026-11-09 (macOS arm64, Rust 1.99.1, wasmtime 50.0.0, wasm-bindgen
0.2.129) after every module had landed. The shared files needed no conflict
resolution. `Cargo.toml` and `lib.rs` already held each module's single edit
(flate2 dev-dep, ungated `collate_compat`, race-protocol's `ts-export`
no_std gate). In this file, the duplicate `## rng` heading was renamed to
`## rng details`, and every `_TBD_` placeholder now points at the section
that holds the details. `hash` had no module agent, so it was implemented
during integration (see `## hash`).

| Gate step | Result |
|---|---|
| `cargo fmt --all --check` | pass |
| `cargo clippy --workspace --all-features --all-targets -- -D warnings` | pass (also without `--all-features`, and race-wasm on `wasm32-unknown-unknown`) |
| `cargo clippy -p race-core -p race-protocol --all-features -- -D warnings` | pass |
| `cargo test --workspace --all-features` (debug) | all pass, 1 ignored (the env-driven protocol NDJSON test). race-core lib 22, canonical 5, collate 6, js_math 7, math 7, rng 6, race-protocol 115 + 7 + 12 + 4 + 8, race-cli 6, race-wasm 2, doctests 2 |
| rng: `hashString`, 1M UTF-16 strings | 1,000,000 / 1,000,000; 1000/1000 chunk digests; 3,996/3,996 samples; 28/28 edge cases |
| rng: `createRaceRng` first 8 draws (+3 range, +3 integer) | 10,000 / 10,000 cases (140,000 values); meta streams 45/45 (630 values) |
| canonical: JCS goldens | 10,000 / 10,000 byte-equal (numbers 4,000, strings 2,000, trees 4,000) |
| js_math: hypot2 / hypot3 / exp, 1M each | 100% on linux-x64, linux-x64-nofma, linux-arm64 and darwin-arm64 |
| js_math: pow, 1M | 100% on all Linux targets and for `--no-use-std-math-pow` on every target. **Residual: darwin-arm64 with default flags, 1,255 / 1,000,000 differ (0.1255%), each 1 ulp.** The G1 allowance stays 0% with the oracle on linux-x64 (see `## math`). |
| collate: 1M id pairs vs `localeCompare` | 1,000,000 / 1,000,000 (100.0000%); `collation-table.ts --check` reproduces the fixtures |
| `state_hash` fixed state, native vs `wasm32-wasip1` | identical (`4ea499aa…0ceb`, 264 bytes) |
| race-core tests under `wasm32-wasip1` / wasmtime (release, `ts-compat`) | all pass, and the printed match counts are identical to native (diffed) |
| race-protocol tests under `wasm32-wasip1` | all pass |
| race-core + race-protocol for `wasm32-unknown-unknown` | builds in debug and release, with and without `--all-features` |
| `! cargo tree -p race-core -e normal --target wasm32-unknown-unknown \| grep -E 'getrandom\|rand'` | pass (also with `--all-features`) |
| `scripts/build-wasm.sh` | pass. `race_wasm_bg.wasm` is 61,823 bytes. The Node smoke test prints `engineBuildId()` equal to the native build id. |

The wasmtime runner has to preopen the workspace, because the fixture tests
read files by absolute path:
`CARGO_TARGET_WASM32_WASIP1_RUNNER="wasmtime run --dir=<workspace>"`.

### Gate re-run after the review fixes

Run on 2026-11-09 (macOS arm64, Rust 1.99.1, wasmtime 50.0.0, wasm-bindgen
0.2.129, Node 24.17.0).

| Gate step | Result |
|---|---|
| `cargo fmt --all --check` | pass |
| `cargo clippy --workspace --all-targets -- -D warnings`, with and without `--all-features`; `-p race-core -p race-protocol --all-features`; race-wasm on `wasm32-unknown-unknown` | pass (all four) |
| `cargo test --workspace --all-features` (debug) | all pass, 2 ignored (env-driven). race-core lib 25, canonical 5, collate 6, js_math 8, math 9, rng 6, trace_sh1 1; race-protocol lib 116 (ts-rs export), event_wire_keys 7, ids_config 14, legacy_and_track 6, ts_oracle_roundtrip 8; race-cli bin 8, build_id 4, config_ts_compat 7 |
| rng: `hashString`, 1M UTF-16 strings | 1,000,000 / 1,000,000; 1000/1000 chunk digests; 3,996/3,996 samples |
| rng: `createRaceRng` first 8 draws (+3 range, +3 integer) | 10,000 / 10,000 cases (140,000 values); meta streams 45/45 (630 values) |
| canonical: JCS goldens | 10,000 / 10,000 |
| js_math (`ts-compat`): hypot2 / hypot3 / exp / pow, 1M each | 977/977 chunk digests on every Linux target and for darwin `pow_legacy`; darwin default `pow` 297/977 chunks (the documented 0.1255% residual; `oracle diff` refuses that host) |
| collate (`ts-compat`): 1M id pairs vs `localeCompare` | 1,000,000 / 1,000,000 |
| `js_clamp` vs the TS clamp | 9,261 / 9,261 |
| libm wrapper pins (8 × 1M outputs) | pass natively and under `wasm32-wasip1` |
| `sh1` vs the TS encoder (case 13, 900 ticks) | 901/901 tick hashes, chain, motion, 22/22 events, `eventsSha256` |
| `resolve_ts_compat` vs Zod + engine fallbacks | 2,000 / 2,000 (448 on the 0.12 default) |
| Legacy events, dev.db export (ignored test) | 2,171 / 2,171 parse; typed route would refuse 66 |
| `state_hash` fixed state and every printed count, native vs `wasm32-wasip1` | identical, default features (57 report lines) and `ts-compat` (78); 80/97 tests native, 62/72 under wasip1 (the ts-rs export and filesystem-only tests don't run there) |
| race-core + race-protocol on `wasm32v1-none` (no std) | builds with and without `ts-compat` |
| `! cargo tree … --target wasm32-unknown-unknown \| grep -E 'getrandom\|rand'` | pass for race-core and race-wasm, with and without `--all-features` |
| `scripts/ci/check-wire-usize.sh` | pass |
| serde_json feature diff (D4(e)) | pass (native `alloc float_roundtrip std`, wasm `alloc float_roundtrip`) |
| build-id self-check (debug and release, no `ts-compat`) | pass |
| `scripts/build-wasm.sh --require-bindgen` | pass; `race_wasm_bg.wasm` 60,052 bytes, no home path inside; `engineBuildId()` equals `race-cli build-id` |
| `dump-trace.ts --validate-only` on the 2,000-case corpus | 2,000 / 2,000 accepted |

**Fixture sizes.** About 8.9 MB will be committed in total, so no 1M-case
test needs `#[ignore]`. Every 1M check stores a generator plus checksums
instead of the inputs. The largest files are `jcs-goldens.jsonl` (3.2 MB,
uncompressed) and `rng-streams.json.gz` (1.8 MB).

**Not done in Phase 1:**

- `race-cli oracle meta` and `crates/race-core/tests/fixtures/meta-parity.json.gz`
  (10k meta-parity cases, D5/R7). This is a listed deliverable but not a gate
  step, and no module owned it. The `rng` fixtures already cover the meta
  stream functions: 45 fixture cases plus hardcoded `chaos:week:3`,
  `auto-loadout:<id>` and `chaos:manual:3:<ms>`. They are not the 10k-case
  meta-parity set.
- `race-cli oracle diff` and `gate` are stubs, waiting on Phase 2 `step()`.
- `DigestEnvelope` JCS, `eventsSha256` and the `motionSha256` wiring into
  `result_digest` wait for Phase 2. `HashFold` is ready for them.
