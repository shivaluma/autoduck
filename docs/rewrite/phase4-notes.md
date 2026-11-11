# Phase 4 notes: Vite shell (branch `rewrite-web`)

Plan: `docs/rewrite-plan.md` §3 Phase 4, decisions D18, D19 and D26.

The pages are now a Vite + React 19 SPA at the repo root. The API is still the Next.js route handlers
in `app/api` until the Rust server (`crates/server`, branch `rewrite-server`) replaces them. The browser
race engine is still the frozen TS engine, reached through `src/engine/sim.ts`, until Phase 5 swaps in the
WASM build.

## Running it

```fish
pnpm dev            # Next API on :3000 (db:bootstrap first) and Vite on :5173 together. Open http://localhost:5173
pnpm dev:api:next   # only the Next API on :3000
pnpm dev:web        # only Vite on :5173; proxies /api to $API_URL (default http://127.0.0.1:3000)
env API_URL=http://127.0.0.1:4000 pnpm dev:web   # proxy to an API on another port

pnpm build          # tsc --noEmit + vite build -> dist/ (SPA only)
pnpm check:bundle   # gate: no server code in dist/; home, rules and race load no engine/Phaser/Zod/WASM up front
pnpm build:api:next # next build (API route handlers, standalone output)
pnpm start          # after both builds: one Next standalone server on :3000 serving API + SPA, like the Docker image
pnpm codegen:engine # race-cli codegen -> src/engine/generated/{catalog,versions}.json
```

- **Rust server instead of Next:** run `autoduck serve` on :3000 (or another port with `API_URL=…`) and
  `pnpm dev:web`. To have the server host the built SPA itself, set `AUTODUCK_DIST_DIR=dist`.
- **Vite binds `localhost` only.** On macOS that is `[::1]`, so open `http://localhost:5173`, not
  `127.0.0.1`, or pass `--host 127.0.0.1`.
- **Google sign-in in dev:** the OAuth client's Authorized JavaScript origins must include
  `http://localhost:5173`. The button reads its client id from `GET /api/auth/google`. `NEXT_PUBLIC_*` is
  no longer read in the browser.
- **SSE through the dev proxy:** for `Accept: text/event-stream` the proxy sends `accept-encoding: identity`,
  so live race frames arrive one by one instead of waiting in a compression buffer.

### How Next and Vite run side by side

- **Development:** two processes. `scripts/dev.mjs` starts both and prefixes their output. It reuses the
  pnpm that launched it, so the corepack-pinned 11.22.0 is used even when an older `pnpm` is on PATH.
- **Production (Docker, `pnpm start`):** one Next standalone process.
  - The Dockerfile runs `pnpm build && pnpm build:api:next`, deletes `dist/.vite` (the build manifests) and
    copies `dist/` into `public/`.
  - A `fallback` rewrite in `next.config.ts` serves `index.html` for every page path. It never covers
    `/api`, `/api/*` or `/_next/*`, and never a path whose last segment contains a dot, so a missing chunk
    is a 404 and not HTML. That is the same rule as the Rust server.
  - `/assets/*` (hashed names) is served with `Cache-Control: public, max-age=31536000, immutable`.
- **`pages/README.md`:** the empty top-level `pages/` directory stops Next from treating `src/pages/*` as
  Pages Router pages. Without it, Next refuses to start because `pages` and `app` are under different
  parents. Delete it together with Next.
- **`tsconfig.next.json`:** Next type-checks with this file, because it rewrites the tsconfig it uses. That
  keeps Next's edits out of the Vite `tsconfig.json`.

### Remaining Next.js usage (removed when the Rust server takes over)

- `app/api/**` route handlers, plus `next.config.ts` (legacy redirects, the SPA fallback, asset cache
  headers), `tsconfig.next.json`, `pages/README.md`, and the scripts `dev:api:next`, `build:api:next` and
  `start` (`scripts/start-standalone.mjs`).
- The Dockerfile's Next standalone runner stage.
- `next` stays in dependencies. No browser code imports `next/*`, and lint blocks Node globals, Node
  builtins and server modules in `src/` and `components/`.

## Route table (`src/router.tsx`)

Every page is a lazy route and sets its document title with React 19 `<title>` (`src/pages/root-layout.tsx`).

| Path | Page | Title |
|---|---|---|
| `/` | redirects to `/season-3`, keeping `?search` and `#hash` (magic-link `?token=`) | |
| `/season-3` | `src/pages/season-3/index.tsx` (inside `season-3/layout.tsx`) | ĐUA DZỊT — SEASON 3 🦆 |
| `/season-3/rules` | `season-3/rules.tsx` | from the rules content |
| `/season-3/race/:id` | `season-3/race.tsx`; an id that isn't a positive integer shows the 404 page | Race #id — ĐUA DZỊT S3 |
| `/season-3/duck/:userId` | `season-3/duck.tsx` | Hồ sơ vịt — … |
| `/admin/season-3` | `admin/season-3.tsx` | Race Desk — … |
| `/admin/cosmetics` | `admin/cosmetics.tsx` | Quản lý shop — … |
| `/dev/race-lab`, `/dev/race-fx`, `/dev/cosmetics`, `/dev/avatar-matrix`, `/dev/avatar-showcase`, `/dev/avatar-compatibility` | `src/pages/dev/*` | per page |
| `/rules` | redirects to `/season-3/rules` | |
| `/admin/dashboard` | redirects to `/admin/season-3` | |
| `/dragon`, `/members`, `/race/new` | redirect to `/season-3` | |
| `/race/:id` | redirects to `/season-3/race/:id` (id re-encoded) | |
| `*` | themed 404 ("Về ao" keeps `?token=`) | Không tìm thấy — … |

All redirects keep search and hash. Next's `redirects()` still answers the legacy URLs with a 307 in
production, and the SPA router answers them on the client.

## Engine seams (D19)

- **`src/engine/catalog.ts`** reads `src/engine/generated/catalog.json`, which `race-cli codegen` exports
  from the Rust race-core catalog. `ITEM_CLASS_BY_ID`, `loadoutComboBadge`/`Label` and
  `itemActivationForEvent`/`itemSuccessForEvent` are rebuilt over those tables.
  `tests/engine-seam-catalog.test.ts` checks them against `packages/race-core` for every item, every loadout
  pair, and every event type with every source/target combination. CI's rust job fails if the generated
  JSON is out of date.
- **`src/engine/protocol.ts`** exports the Rust versions from `generated/versions.json` (engine 2.0.0,
  balance S3.16). For now it re-exports the TS protocol types as type-only imports, which add nothing to the
  bundle.
- **`src/engine/sim.ts`** is still the TS engine (1.2.0 / S3.15). Code that re-simulates in the browser
  (race-lab, `src/race/replay-plan.ts`) reads `SIM_VERSIONS` from `src/engine/sim-versions.ts`, a constants
  module that doesn't load the engine.
- **Race canvas:** the canvas imports Phaser and `components/racing/drivers/engine-drivers.ts` on demand. A
  replay of a recorded track never loads the engine or Zod.
- **Verify path:** the result-digest verify code that pulled `node:crypto` into the client is gone.
  `check:bundle` fails on any `node:` import, `process.env`, `__vite-browser-external`, Prisma or
  better-sqlite3 in `dist/`.

## Gates (last run 2026-11-11)

| Gate | Result |
|---|---|
| `pnpm build` (tsc + vite) | pass |
| `pnpm check:bundle` | pass: home loads 3 chunks, rules 9, race 13; none contains Phaser, `packages/race-*`, `sim.ts`, Zod or WASM |
| `pnpm lint` | 0 errors, 24 warnings (older warnings in scripts, tests and moved pages) |
| `pnpm test` | 208/208 |
| `pnpm build:api:next` | pass (14 API routes) |
| `race-cli codegen` vs checked-in JSON; `cargo fmt --check`; clippy on race-cli | in sync; clean; clean |
| Standalone (Next API + SPA, copied DB), 22 routes | all load with no console errors, failed requests or HTTP ≥ 400, and with the right titles and final URLs |
| Review-fix checks | pass: race/abc is a 404; legacy ids re-encoded; one `<title>`; the route announcer reads the new title and focus moves; a stale chunk reloads once with no loop; a wrong cosmetics secret keeps the page |

Parity screenshots (old Next app vs new SPA, 26 routes × 2 viewports, plus the SPA served by the Rust
server) are in the scratch report, phase4/parity/report.md. Rules, race, admin, race-lab, race-fx and every
redirect are pixel-identical. The remaining differences are animated SVG avatar art.

## Expected differences from the Next pages

1. **Titles are per route.** The old app used the root title everywhere except rules.
2. **Unknown URLs show the themed SPA 404**, with HTTP 200 for page paths. The old app showed Next's
   unstyled 404 with HTTP 404.
3. **Legacy redirects** come back as a 307 from Next in production, or as a client-side replace from Vite
   or the Rust server. The final URL is the same either way.
4. **No "preloaded but not used" console warnings.** The old app's SSR image preloads produced them.
5. **`document.fonts` lists variable-weight faces** ("Nunito 300 800"). They come from the same Fontsource
   variable files with the Vietnamese subset, and rendering is the same. Nunito and Baloo 2 (Latin and
   Vietnamese) are preloaded from `index.html`, as next/font did.
6. **Screen readers:** a visually hidden `aria-live` element reads the new title on path changes, and focus
   moves to the page container. This replaces Next's route announcer.
7. **Static title and description in `index.html`** serve link unfurlers. `main.tsx` removes them on boot,
   so the head ends up with one `<title>`.
8. **No link prefetch.** The first click to a route waits for its chunk.

## Open items

Rust server (`rewrite-server`, at d50229f; for that workflow, not fixable here):
- **Google sign-in breaks.** `crates/server/src/http/headers.rs:40` sends `referrer-policy: same-origin`, so
  the GIS button iframe goes out with no Referer and Google rejects the origin. Send
  `strict-origin-when-cross-origin`.
- **Tokens and the admin secret reach the logs.** `crates/server/src/http/csp_report.rs:32` logs raw CSP
  reports, and their `document-uri`/`referrer`/`source-file` carry `?token=` and `?secret=`. Strip queries
  and fragments, or log only the directive and path.
- **The CSP can't be enforced on race pages yet.** Phaser's `eval` violates `script-src`: it would need
  `'unsafe-eval'` or a Phaser build without eval.

Phase 5:
- **Swap `src/engine/sim.ts` to the WASM engine** and drop `SIM_VERSIONS` (the TS 1.2.0 / S3.15 pair).
  After that, race-lab and the replay plan use the Rust versions from `protocol.ts`, and `check:bundle`
  should allow the `.wasm` file only in the canvas's lazy chunk.
- **Generate protocol types from Rust** and stop re-exporting `packages/race-protocol` types.
- **Remove the TS engine from the browser build entirely.** The `engine-drivers` lazy chunk still bundles
  `packages/race-*` and Zod.

Later:
- **Remove Next** once the Rust server serves `/api`: `app/api`, `next.config.ts`, `tsconfig.next.json`,
  `pages/`, the `*:api:next` scripts, `start-standalone.mjs` and the Docker runner stage.
- **Older bugs, unchanged from main:**
  - The GIS button warns that width `100%` is invalid.
  - The Race Desk's "TẢI DỮ LIỆU" button doesn't save the secret.
- **Optional:** warm the race route's chunks on hover or idle from `/season-3`.
