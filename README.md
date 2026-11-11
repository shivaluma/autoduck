## ĐUA DZỊT — Season 3

Season 3 is isolated from the v2 chest/boss/dragon modifiers. Its deterministic server engine runs the automated race, then resolves one Chaos card, Season Shields, King status, secret predictions, Duck News, and prediction-point rewards.

Chaos cards: Normal, Reverse, Duo, Triple Elimination, Cut Line, Constructors, and Bounty Hunt. Duo pairs and Constructors teams are randomized once before the race and persisted for the resolve.

- Player view: `/season-3?token=<personal-token>`
- Host control: `/admin/season-3` with `RACE_SECRET_KEY`. Host can skip inactive ducks, lock/unlock preparation, run a no-side-effect test race, then start the authoritative Monday race; ranking and Season 3 resolution are automatic.
- Race Lab: `/dev/race-lab` with `RACE_SECRET_KEY` for seed, Chaos, loadout, tuning, speed, state, and event inspection.
- Season 3 API: `/api/season3`, `/api/admin/season3`, `/api/season3/redeem`
- Database auto-bootstrap runs before `pnpm dev`, `pnpm start`, and Docker startup: it performs `prisma db push`, then applies idempotent app migrations. Each applied migration is recorded in `AppMigration.runAt`. pnpm native build permissions live in `pnpm-workspace.yaml` so the SQLite adapter is available on first boot.
- Run it manually with `pnpm db:bootstrap`; use `pnpm db:migrate:app` only when you want to run the app migration step without Prisma schema sync.

The Season 3 champion is calculated from `championshipPoints` and race wins only; prediction points never affect championship ranking.

### Racing engine commands

```bash
pnpm test
pnpm test:race
pnpm race:simulate --races 100000
pnpm race:replay <raceId>
pnpm race:profile
```

Official races store the immutable config, seed commitment, engine/balance/track versions, raw event stream, result digest, live fallback snapshots, and same-seed item telemetry. Replay refuses unsupported engine or balance versions instead of silently using current tuning.

## Getting Started (Vite SPA + API, plan Phase 4)

The pages are a Vite + React 19 SPA (`index.html`, `src/main.tsx`, `src/router.tsx`, `src/pages/*`). During
the transition the API is still the Next.js route handlers in `app/api` (or the Rust server, `crates/server`).

```fish
pnpm dev            # both: Next API on :3000 (runs db:bootstrap first) + Vite on :5173. Open http://localhost:5173
pnpm dev:api:next   # only the Next API on :3000
pnpm dev:web        # only Vite on :5173; proxies /api to $API_URL (default http://127.0.0.1:3000)
env API_URL=http://127.0.0.1:4000 pnpm dev:web   # proxy to an API on another port (e.g. the Rust server)

pnpm build          # tsc + vite build -> dist/ (SPA only)
pnpm check:bundle   # dist/ has no server code; home, rules and race load no engine, Phaser, Zod or WASM up front
pnpm build:api:next # next build (API route handlers, standalone output)
pnpm start          # after both builds: one Next standalone server on :3000 serving the API and the SPA (as Docker does)
pnpm codegen:engine # race-cli codegen -> src/engine/generated/{catalog,versions}.json (from the Rust catalog)
```

The Docker image builds both and copies `dist/` into `public/`; `next.config.ts` falls back to
`public/index.html` for every non-API path, so one Next process serves the SPA and the API. The empty
`pages/` directory only keeps Next from treating `src/pages` as Pages Router pages (see `pages/README.md`).

Vite listens on `localhost` only (IPv6 `[::1]` on macOS), so open http://localhost:5173, not 127.0.0.1
(or run `pnpm dev:web --host 127.0.0.1`). For Google sign-in in development, the OAuth client's Authorized
JavaScript origins must include `http://localhost:5173`; the button reads its client id from
`GET /api/auth/google` (`GOOGLE_CLIENT_ID` on the server).

More detail (route table, how Next and Vite run side by side, expected differences): `docs/rewrite/phase4-notes.md`.
