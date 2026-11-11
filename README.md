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

## Getting Started (Rust server + Vite SPA)

The pages are a Vite + React 19 SPA (`index.html`, `src/main.tsx`, `src/router.tsx`, `src/pages/*`). The API
is the Rust server in `crates/server` (binary `autoduck`, axum + sqlx over the SQLite file), which also serves
the built SPA in production.

```fish
pnpm dev            # both: Rust API on :3000 (runs db:bootstrap first) + Vite on :5173. Open http://localhost:5173
pnpm dev:api        # only the Rust API on :3000 (AUTODUCK_ENV=dev, prisma/dev.db)
pnpm dev:web        # only Vite on :5173; proxies /api to $API_URL (default http://127.0.0.1:3000)

pnpm build          # wasm engine + tsc + vite build -> dist/
pnpm check:bundle   # dist/ has no server code; home, rules and race load no engine, Phaser, Zod or WASM up front
pnpm codegen:engine # race-cli codegen -> src/engine/generated/{catalog,versions}.json (from the Rust catalog)
env SQLX_OFFLINE=true cargo test --workspace
docker build -t autoduck .   # the production image (Rust server + SPA), see Dockerfile
```

Vite listens on `localhost` only (IPv6 `[::1]` on macOS), so open http://localhost:5173, not 127.0.0.1
(or run `pnpm dev:web --host 127.0.0.1`). For Google sign-in in development, the OAuth client's Authorized
JavaScript origins must include `http://localhost:5173`; the button reads its client id from
`GET /api/auth/google` (`GOOGLE_CLIENT_ID` on the server).

More detail: `docs/rewrite-plan.md` (Phase 8), `docs/rewrite/phase3-notes.md` (server) and `docs/rewrite/phase4-notes.md` (SPA).
