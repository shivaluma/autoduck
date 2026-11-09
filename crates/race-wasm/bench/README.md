# race-wasm perf harness (Phase 1 measurement)

Sizes the late-join catch-up budget (plan C9, R19) before the engine port
exists. A stub step loop (`race_wasm::bench_stub_resim`, exported as
`benchStubResim(ducks, ticks, work, seed)`) re-simulates **8 ducks × 5,400
ticks** with float work shaped like `stepSimulation`: an impulse schedule on
xorshift32, smoothstep pacing, river currents, speed and lateral response with
JS-style clamps, an O(n²) neighbour pass with `hypot`, per-duck `exp`/`powf`, a
stable rank sort and a state fold every 60 ticks. Ducks are tuned to be slower
than the real 56 s pace, so nobody finishes and all 5,400 ticks do full work
(the 90 s worst case).

`bench-core.mjs` holds a line-for-line JS port of the same stub
(`jsStubResim`). Timing both in one runtime gives the wasm-vs-V8 ratio for
this kind of code.

| File | Purpose |
|---|---|
| `bench-core.mjs` | JS stub, timing loop, summary (median/min/p90, µs per tick, ms per 500-tick chunk, ticks per 16.7 ms frame). |
| `run-node.mjs` | Node runner. `--ts-reference` also times the real TS engine. |
| `index.html`, `bench-browser.mjs` | Browser page. Serve `crates/race-wasm/` over HTTP. |
| `run-chromium.mjs` | Optional headless Chromium run with CDP CPU throttling (Playwright). |

## Run

```fish
scripts/build-wasm.sh                      # release, -C panic=abort, wasm-bindgen --target web -> crates/race-wasm/pkg
node crates/race-wasm/bench/run-node.mjs   # wasm stub vs JS stub in Node
node --import tsx crates/race-wasm/bench/run-node.mjs --ts-reference   # + real TS engine and R
```

### Chromium with 4× CPU throttling (by hand)

1. `scripts/build-wasm.sh`
2. `cd crates/race-wasm; python3 -m http.server 8787`. Any static server works;
   it must serve `.wasm` as `application/wasm`.
3. Open `http://localhost:8787/bench/index.html?r=<R from the Node run>` in Chromium.
4. DevTools → **Performance** → gear icon → **CPU: 4× slowdown**. Keep DevTools
   open, because throttling stops when it closes.
5. Press **Run**. The page prints both stubs, the ratio, and the engine
   estimate when `r` is set. `window.__benchResult` holds the JSON.

### Chromium with 4× CPU throttling (scripted)

```fish
node crates/race-wasm/bench/run-chromium.mjs --channel chrome --rate 4 --r 19
```

This sends CDP `Emulation.setCPUThrottlingRate {rate: 4}`, the same setting as
the DevTools menu. Without `--channel chrome`, run `pnpm exec playwright install
chromium` first.

## Extrapolating the budget

```text
R = (TS engine µs/tick) / (JS stub µs/tick)          # both in V8, from run-node --ts-reference
estimated ported-engine full re-sim ≈ wasm stub ms × R # in the target runtime (e.g. Chromium 4×)
```

The assumption is that the real engine costs about R times the stub in wasm,
just as it does in V8. Replace the estimate with the real engine as soon as
Phase 2 has a `step()`; Phase 5 measures the real Web Worker catch-up.

## Phase 1 numbers

Measured on an 8-core Apple Silicon Mac under heavy load from parallel builds
(load average about 16–22). Treat them as rough and re-measure on a quiet
machine.

| Runtime | wasm stub 5,400 ticks | JS stub | wasm/JS |
|---|---|---|---|
| Node 24, no throttle | 128–158 ms (24–29 µs/tick) | 82–93 ms | 1.6–1.7 |
| Headless Chrome 156, CPU 4× | 540 ms (100 µs/tick, 50 ms per 500-tick chunk) | 216 ms | 2.5 |

TS engine (Node, 8 ducks, production pickups, loaded machine): 83–290 µs/tick,
which gives R ≈ 19. See `docs/rewrite/phase1-notes.md` § tooling for what this
means for C9.
