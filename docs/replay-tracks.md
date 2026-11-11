# Replay tracks (DTRK/1)

Every Season 3 race (official and test) gets a **recorded track**: what each duck, pickup, hazard, banana and
rocket looked like on every tick. It is stored in the `RaceReplayTrack` table. The goal is that replays stop
depending on the engine version: the canvas can play a track back without re-simulating from the seed.

This is plan step 0.4 (`docs/rewrite-plan.md` in the rewrite branch: §4.2 format, §4.3 table, §4.5 gates,
D10, D23, risk R2).

Code: `lib/racing/replay-track/` (server) and `src/race/replay-track/` (browser-safe, moved there in plan step 0.5).

| File | Role |
|---|---|
| `src/race/replay-track/format.ts` | Constants, header type, canonical header JSON and quantisation. No Node imports. |
| `lib/racing/replay-track/recorder.ts` | Live recorder. `push(state)` never throws. Also has the `REPLAY_TRACK_RECORDING` kill switch. |
| `lib/racing/replay-track/encode.ts` | Recording → uncompressed DTRK/1 payload; `packReplayTrack` gzips it and hashes it. Node only. |
| `src/race/replay-track/decode.ts` | Payload → per-tick world (`worldAt(tick)`), finish ticks and final ranks. Safe in the browser. |
| `lib/racing/replay-track/store.ts` | After resolve: finalize → encode → gzip → gunzip → decode → self-check → insert. Never throws. |
| `lib/racing/replay-track/serve.ts` | `GET /api/races/:id/track` response (gzip, ETag, caching). |

## How a race is recorded

`lib/season3-race.ts` makes a recorder unless `REPLAY_TRACK_RECORDING=0`. Recording only reads state;
it never changes the race:

- Tick 0 is pushed from `beforeTick` when `state.tick === 0`. Each later tick is pushed from `afterTick`.
  This is the same state that `snapshotRaceWorld` would see for that tick.
- `push` copies the duck fields into growable typed arrays: `Float64Array` progress and speed,
  `Float32Array` lateral and `Uint8Array` rank. It records wild-item, effect, regular-pickup-count and entity
  fields only when they change. It keeps no `snapshotRaceWorld` objects.
- `push` catches every error. The first failure logs one line and disables the recorder, and the race goes on.
  A logger that throws is swallowed too.

After the meta transaction, and after a test race moves to ARCHIVED, `storeRecordedReplayTrack` runs:

1. `finalize()` checks the entity sample counts (the static-position assertion, see §3) and returns the recording.
2. Encode, gzip, gunzip, check sha256, decode.
3. **Self-check:** the decoded finish order (final rank, official ducks only) must equal `result.standings`.
   Each duck's decoded finish tick must agree with its `finishTimeMs`
   (`(tick-1)·dt ≤ finishTimeMs ≤ tick·dt`). The last tick must be the `RACE_FINISHED` tick.
4. `statsJson` = `JSON.stringify(buildPostRaceStats(config, events, players))`, with the inputs the race page
   uses: DB-ordered events including `CHAOS_RESOLVED` / `QP_TRACK_REWARD_GRANTED`, and non-clone
   participants ordered by `initialRank`. It costs about 2 extra simulations (~250 ms). If it fails,
   `statsJson` is just `null`.
5. Insert the row:

| Column | Value |
|---|---|
| `format` | `dtrk/1` |
| `source` | `LIVE_TS` |
| `fidelity` | `RECORDED` |
| `engineImpl` | `ts` |
| `engineCommit` | `SOURCE_COMMIT` or `GIT_SHA`, otherwise `null` |
| `engineBuild` | `null` |
| `engineVersion`, `balanceVersion`, `trackVersion`, `tickRate` | from the result |
| `trackGeometry` | `<trackVersion>@<sha8>` of the committed HEAD geometry export (see [Geometry](#geometry)), or `null` if that file is missing. Rows written before 0.5 have `null`. |
| `tickCount` | final simulation tick (= `RACE_FINISHED` tick); there are `tickCount + 1` samples, ticks `0..tickCount` |
| `stride` | 1 |
| `reproducedDigest` | `Race.resultDigest` |
| `byteSha256` | sha256 of the **uncompressed** payload |
| `bytes` | gzip |
| `note` | `null`, or a diagnostic such as `moving entities: N` |

Any failure (disabled recorder, self-check, encode or DB) writes **no row** and logs one line:
`[replay-track] race <id>: no track stored (<reason>)`. The §4.5 gate finds such races, and they are backfilled
at HEAD.

## Payload layout

Everything is little-endian. The stored bytes are the gzip of this payload.

```
"DTRK" | u16 version=1 | u16 flags=0 | u32 headerLen | header (UTF-8 JSON, keys sorted recursively, no undefined)
then sections, each: u8 id | u32 byteLen | bytes
```

Decoders skip section ids they don't know. Id 5 is reserved for a possible event stream.

### Header

```jsonc
{
  "raceId": "41", "tickRate": 60, "firstTick": 0, "lastTick": 3447, "stride": 1,
  "trackVersion": "river-01-v2", "trackGeometry": "river-01-v2@678a27dc",
  "ducks": ["101", "102", …],            // playerIds in simulation order (state.ducks, sorted by playerId)
  "effects": ["SLOWED", "NITRO", …],     // effect table, in order of first appearance
  "wildItems": [...], "pickupTypes": [...], "hazardTypes": [...],   // protocol enums first, then anything new
  "q": { "progress": 16777216, "speed": 16777216, "lateral": 32767 },
  "engine": { "impl": "ts", "engineVersion": "1.2.0", "balanceVersion": "S3.15", "commit": null, "build": null },
  "source": "LIVE_TS", "fidelity": "RECORDED", "resultDigest": "…"
}
```

Fixed tables, not stored in the header:

- pickup states: `ACTIVE=0, COLLECTED=1, EXPIRED=2`
- projectile kinds: `PREP=0, WILD=1`
- `0xFF` = no duck

### §1 DUCK_COLUMNS (id 1)

```
u16 duckCount | u32 sampleCount
progressΔ  i32 × duckCount × sampleCount   (duck-major; delta from the previous sample, first from 0)
speedΔ     i32 × duckCount × sampleCount
lateral    i16 × duckCount × sampleCount
rank       u8  × duckCount × sampleCount
```

Quantisation uses js-round (`Math.round`, ties go up; Rust must use `(x + 0.5).floor()`):

- `q(progress) = round(p·2^24)`. One exception: if `p < 1` the value is capped at `2^24 − 1`. So
  `q == 2^24` exactly when the duck has finished, and finish ticks can be read directly from the column.
- `q(speed) = round(s·2^24)`
- `q(lateral) = round(l·32767)`, clamped to ±32767. The recorder stores lateral as f32 before quantising,
  and the total error stays under 1/32767.

### §2 DUCK_CHANGES (id 2)

`u32 count`, then records ordered by tick and then duck: `u32 tick | u8 duck | u8 kind | payload`.

| kind | name | payload |
|---|---|---|
| 1 | `WILD_ITEM_SET` | `u8 wildItemIdx, u32 acquiredAtTick, u16 len + UTF-8 instanceId` |
| 2 | `WILD_ITEM_CLEAR` | none |
| 3 | `REGULAR_PICKUP_COUNT` | `u8 count` |
| 4 | `EFFECTS_SET` | `u8 n, u8 effectIdx × n` (exactly the `activeEffects` order) |

The defaults before the first change are no wild item, count 0 and no effects. A change at tick 0 records the
starting value.

### §3 ENTITIES (id 3): pickups, hazards, bananas

`u32 count`, then one record per entity lifetime, in order of first appearance. That order equals the
snapshot array order (the recorder counts violations in `note`).

```
u8 class (0 pickup, 1 hazard, 2 banana) | u8 flags (bit0 = moving)
id: banana → u32; pickup/hazard → u16 len + UTF-8
u8 type (pickupTypes / hazardTypes index; banana: projectile kind) | u8 srcDuck | 0xFF
f64 progress | f64 lateral | f64 radius | NaN (hazards only)
u32 firstTick | u32 lastTick           (present on every tick in between)
u8 initialState | u16 n | (u32 tick, u8 state) × n      (pickup state changes)
if moving: (f64 progress, f64 lateral) × (lastTick − firstTick + 1)
```

Positions are exact (f64). An entity whose position never changes is stored once. If it ever moves, the
recorder switches it to per-sample positions and sets flag bit 0. In S3.15 pickups, hazards and bananas
never move. Hazard radius is asserted constant.

### §4 ROCKETS (id 4)

`u32 count`, then for each rocket:

```
u32 id | u8 kind | u8 srcDuck | u8 tgtDuck | u32 firstTick | u32 n | i32 round(progress·2^24) × n
u16 r | (u32 tick, u8 tgtDuck) × r      (retargets: a wild rocket may retarget once)
```

## Decoder output

`decodeReplayTrack(payload).worldAt(tick)` returns `Pick<StateSnapshotMessage, 'ducks'|'pickups'|'hazards'|'rockets'|'bananas'>`.
This is what `applyWorld` in `components/racing/phaser-race-canvas.tsx` takes. Ducks come sorted by rank, like
`snapshotSimulation`.

Every field the canvas reads is recorded. For ducks that is `playerId, progress, lateralOffset, rank,
activeEffects, wildItem.itemId`. `speed`, `regularPickupCount` and the rest of `wildItem` are recorded too.
For entities it is `id, type, progress, lateralOffset, state, radius, kind, sourcePlayerId, targetPlayerId`.
Nothing is filled from protocol defaults. The one exception: a source or target index of `0xFF` decodes to `''`.

The round-trip guarantees, from `tests/replay-track.test.ts`:

- progress and speed within 2^-24
- lateral within 1/32767
- rocket progress within 2^-24
- ranks, effects (with order), wild items, pickup counts, pickups, hazards and bananas exact

## Geometry

The canvas draws the river, gates and zones from a geometry file, not from HEAD code, so a track keeps the geometry it
was recorded on (plan D10; `river-01-v2` gained boost gates without a version bump).

- `pnpm race:tracks` (`scripts/race-tracks/export.ts`) exports HEAD `createRiverTrack(DEFAULT_TRACK_VERSION)` to
  `public/race-tracks/<trackVersion>@<sha8>.json`. `sha8` is the start of the sha256 of the file's bytes
  (canonical JSON, keys sorted). `pnpm race:tracks --check` fails if the committed file for HEAD is missing.
- The file has `sim` (length, currents, pickup and hazard zones, boost gates) and `render` (the centreline sampled at
  1024 segments as `[x, y, tangentX, tangentY, width]`, `lateralScale` 0.42). `src/race/polyline-track.ts` turns it
  into the `sample(progress, lateral)` the canvas uses; it stays within 0.05 px of HEAD (`tests/replay-viewer.test.ts`).
- New recordings name the HEAD file in the header and the row (`resolveHeadTrackGeometryId`). The race API exposes it as
  `replay.geometryUrl`. Without a geometry id or file, the canvas falls back to HEAD `createRiverTrack`.
- If HEAD geometry changes, export a new file and keep the old one: stored tracks still reference it.

## Viewer (plan step 0.5, §4.6)

`GET /api/races/:id` returns stored events in **id order** (emission order) and:

```jsonc
"replay": { "mode": "track" | "none", "fidelity": "RECORDED" | … | null,
            "trackUrl": "/api/races/41/track?h=<byteSha256>", "geometryUrl": "/race-tracks/river-01-v2@678a27dc.json",
            "engineVersion": "1.2.0", "balanceVersion": "S3.15", "byteSha256": "…", "verify": "none" },
"postRaceStats": { … }   // RaceReplayTrack.statsJson, when stored
```

`mode` is `track` for a finished race whose row has bytes and isn't `UNAVAILABLE`. `verify` stays `none` on main.

`GET /api/races/:id/track?h=<byteSha256>` serves the stored gzip with `Content-Encoding: gzip` (or decompresses when the
client doesn't accept gzip), `ETag: "<byteSha256>"`, and `Cache-Control: public, max-age=31536000, immutable` only when
`h` matches; otherwise `no-cache`. A matching `If-None-Match` gets 304.

The race page (`components/racing/season3-replay-player.tsx`) then:

1. **Track exists:** downloads it (checks the sha256 when WebCrypto is available), decodes it and plays it through
   `RecordingDriver` with the fidelity badge and a scrubber. Nothing is simulated, so any engine version plays,
   including engine major ≥ 2.
2. **No track, current engine/balance pair:** re-simulates through `SimDriver` (also seekable).
3. **Otherwise:** no canvas, `Replay không khả dụng cho race này`. Results, timeline, combat and event-derived stats
   still show; the speed columns are hidden.

Configs are never Zod-parsed by the viewer, and the TS engine's version guard (`createSimulation`/`simulateRace` throw
unless the config is the current pair or `{ allowVersion: true }` is passed) makes a wrong-version re-simulation
impossible.

**Events.** `src/race/event-vocab.ts` splits the id-ordered rows: engine events (asserted never to go back in tick)
drive FX; meta events (`CHAOS_RESOLVED`, `QP_TRACK_REWARD_GRANTED`) are only shown in the timeline, where every event is
stable-sorted by tick. The canvas plays engine events with tick > 0.

**Drivers** (`components/racing/drivers/`): `recording-driver`, `sim-driver`, `live-driver` (the live re-simulation with
SSE manual inputs, unchanged) and `snapshot-driver` (SSE snapshots). `PhaserRaceCanvas` takes a `source` prop.
Seeking is reset-and-replay (`playback.ts`): a forward seek fast-applies the skipped events with FX suppressed; a
backward seek restarts the Phaser scene, resets the driver and fast-applies `[0, t]` the same way, because
`applyEvent` side effects (feed, used-item icons, finish order) are not idempotent.

**Stats.** The panel uses `postRaceStats` when present. Without it, it aggregates the stored events and takes motion from
the track's speed column, or from a re-simulation for the current pair only.

## Fixture

`fixtures/replay-track/short-race.dtrk.gz` and `short-race.json` hold a 3-duck race (config in
`scripts/lib/replay-track-fixture.ts`). The test re-records it and compares `byteSha256`. If the format, the
engine or the balance changes on purpose, regenerate it with `pnpm replay:fixture`.

## Sizes

A full 8-duck race with production pickups is about 3,450 ticks:

| | bytes |
|---|---|
| raw | ~308 KB |
| gzip | ~125 KB |

The plan estimated ~140 KB.

## Gate and fidelity SQL (§4.5)

These run in `sqlite3` in the container and in `GET /api/admin/season3?report=ops` (`replayTrackGate`,
`replayTrackFidelity`).

```sql
-- GATE before cutover, before TS engine deletion, and before EVERY engine/balance bump: must return 0 rows
SELECT r.id, r."balanceVersion" FROM "Race" r LEFT JOIN "RaceReplayTrack" t ON t."raceId"=r.id
WHERE r."engineConfigJson" IS NOT NULL AND r.status='finished' AND t."raceId" IS NULL;

-- fidelity report
SELECT t.fidelity, r."balanceVersion", r."isTest", COUNT(*) FROM "RaceReplayTrack" t
JOIN "Race" r ON r.id=t."raceId" GROUP BY 1,2,3;

-- census (run on the sanitised prod copy first)
SELECT "isTest", status, "engineVersion", "balanceVersion", "trackVersion", COUNT(*) n,
       SUM("resultDigest" IS NOT NULL) digests, MIN("createdAt"), MAX("createdAt")
FROM "Race" WHERE "engineConfigJson" IS NOT NULL GROUP BY 1,2,3,4,5 ORDER BY MIN("createdAt");
```

Races finished before 0.4 was deployed are covered by the historical tracks below.

## Historical tracks (plan step 0.6, §4.4)

Races that ran before live recording are backfilled offline and imported at boot.

- **Resolver:** `pnpm replay:resolve --db <sanitised copy> [--race N ...] [--workers 4] [--budget-min 25]`
  (`scripts/replay-tracks/resolve-historical.ts`). It opens the DB read-only. For each finished race with a
  config and no track row it tries the TS engine commits (first-parent history of `packages/race-core`,
  `packages/race-protocol`, `lib/racing/{audit,persistence,runtime}.ts`, deduplicated by tree). The order is the
  newest commit at or before `Race.createdAt` and the 3 before it, the next newer one, the rest of the balance
  label, HEAD, then the others by distance in time. Each commit is extracted with `git archive` into
  `.cache/engines/<key>` (gitignored) and run by `resolve-worker.mts` in a child process; `guard-hook.mjs`
  fails any import that resolves outside that tree. The worker simulates with the commit's engine and records
  with HEAD's DTRK/1 encoder (`head-dtrk.ts`, bundled by esbuild). S3.15 races must verify at HEAD first
  (calibration). Official races search every commit; test races at most `--test-candidates` (8).
- **Grades:** `VERIFIED_DIGEST` (stored `resultDigest` reproduced), `VERIFIED_EVENTS` (whole event stream
  reproduced but not the digest; never for the `0b67096` era), else `UNAVAILABLE` (no bytes).
- **Output:** `artifacts/replay-tracks/{<raceId>.dtrk.gz,manifest.json,REPORT.md}` (ids, versions and grades
  only) and `public/race-tracks/<trackVersion>@<sha8>.json` for each geometry the reproducing commits used.
  Test races are dropped to `UNAVAILABLE` if the bundle exceeds `--max-bundle-mb` (20).
- **Import:** `scripts/start.sh` runs `scripts/replay-tracks/ensure-imported.ts` after the app migrations
  (`pnpm replay:import` locally). It inserts a `BACKFILL` row for each manifest race that has none, after
  checking that the race is finished, that `sha256(engineConfigJson)` and `resultDigest` equal the manifest,
  and that the gunzipped bytes hash to `byteSha256`. `statsJson` is built at import (names come from the DB,
  motion from the track, baseline ranks from the manifest). It never fails the boot and logs
  `[replay-tracks] imported N, skipped M, rejected K` plus one line per rejection.
- **Gaps:** a race that finished on an image without live recording after the DB copy was taken shows up in
  the gate. Re-run the resolver with `--race N` against a fresh copy (it merges into the manifest) and deploy.

First run (2026-11-11, sanitised copy, Node 24.17 / ICU 78.3): all 130 finished races with a config
(13 official, 117 test) are `VERIFIED_DIGEST`, 17 MB of tracks, 4 geometries, about 90 s with 4 workers.

## Operations

- **Kill switch:** set `REPLAY_TRACK_RECORDING=0` and restart. Races resolve normally and no row is written.
- **Check a race:** `sqlite3 /app/data/<db> 'SELECT raceId, fidelity, tickCount, length(bytes), byteSha256 FROM RaceReplayTrack ORDER BY raceId DESC LIMIT 5'`.
- **Schema:** `RaceReplayTrack` is a new model plus an optional relation on `Race`. `prisma db push` applies it
  without `--accept-data-loss`.
