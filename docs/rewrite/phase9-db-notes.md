# Phase 9 DB steps 2–4: owned schema, legacy drop, WAL

Branch `phase9-db`. Plan: `docs/rewrite-plan.md` Phase 9 steps 2–4, D14, D15, D25, D29.

## What the image does

The Docker image sets `AUTODUCK_SCHEMA_MODE=owned`. After every boot check has passed (lock,
missing or empty DB, staging sentinel, boot backup, `integrity_check`, schema verifier, required
TS ids), boot step 9b (`crates/server/src/db/owned.rs`) applies each pending step once. Each step
is recorded in `AppMigration`:

| Id | Effect |
|---|---|
| `rs-ponr` | Point of no return. Adopts the Prisma-made schema as-is, so no table or row changes. |
| `rs-0010-drop-legacy-v2` | 1. Archives the DB with `VACUUM INTO $AUTODUCK_BACKUP_DIR/autoduck-legacy-archive-<UTC>.db` (0600, fsynced).<br>2. Opens the archive read-only. It must pass `integrity_check` and hold the same row count for every legacy table. If not, the archive is deleted and the **boot fails with nothing dropped**.<br>3. One `BEGIN IMMEDIATE` transaction re-counts the rows, drops the 11 tables children-first and records the id. |
| `rs-0011-wal-journal` | Sets `PRAGMA journal_mode=WAL`, records the id, then reopens the pools. |

On later boots, all three ids are already recorded, so the step logs `owned schema: nothing to
migrate`.

### Dropped tables

The 11 dropped tables are the v2 tables that no Rust statement touches, in drop order. Row counts
are from the 2026-11-11 production backup:

| Table | Rows |
|---|---:|
| DragonItemEvent | 0 |
| DragonItem | 0 |
| DragonOrbEvent | 21 |
| DragonTrade | 0 |
| DragonOrb | 21 |
| DragonSummon | 0 |
| DragonWeek | 11 |
| MysteryChest | 30 |
| Shield | 37 |
| CommentaryJob | 436 |
| WeeklyTick | 17 |
| **Total** | **573** |

### Kept

**`CommentaryLog` (973 rows) is kept.** Race detail (`routes/races/detail.rs`) reads it for old
v2 races. The first rehearsal dropped it, and `/api/races/:id` returned 500. It is now in
`LIVE_TABLES`. The unit test `no_checked_query_reads_a_dropped_table` fails if any `.sqlx` query
touches a dropped table. The one exception is `autoduck seed`'s `Shield` insert, which now runs
only while that table exists.

No live table has a foreign key to a dropped table; a unit test checks this against the baseline.

After `rs-0010`, the verifier stops expecting the dropped tables.

### Journal mode

The pools take the journal mode from the file (`pool::file_journal_mode`) and set it explicitly
on every connection. Opening a pool never changes the mode. This matters because changing the
mode on a new pooled connection is unsafe: leaving WAL needs exclusive access, and a new reader
opened with `journal_mode=DELETE` on a WAL file fails with `SQLITE_BUSY`. That is why boot
reopens the pools after step 9b.

If the file has been switched back to DELETE (for example by an older image), an owned boot sets
it to WAL again.

`verify-db` and `check-schema` use a read-only connection that sets no journal mode.

### Backups in WAL mode

- **Boot backup and `autoduck backup`:** both use `VACUUM INTO`, a consistent snapshot. The output
  file is in DELETE mode, a single self-contained file.
- **Host-side backups:** use `sqlite3 autoduck.db ".backup <file>"` or `autoduck backup --force`.
  Never `cp autoduck.db` on its own, because committed pages can still sit in `autoduck.db-wal`.
  With the server stopped, copying all three files (`autoduck.db`, `-wal`, `-shm`) together also
  works.
- **After a clean stop:** `-wal` (0 bytes) and `-shm` can remain. This is harmless.
- **Restore:** stop the server, delete any `autoduck.db-wal` and `autoduck.db-shm`, then put the
  backup at `autoduck.db`. A stale `-wal` would otherwise be replayed onto the restored file.

## Rehearsal (2026-11-11, local arm64 image `autoduck-rust:phase9-db`)

**Source:** a `.backup` copy of `~/autoduck-backups/autoduck-prod-post-rust-20261111T033343Z.db`.

**Run:** the image was booted with only `DATABASE_URL=file:/app/data/autoduck.db`, a 10-character
`RACE_SECRET_KEY` and `NEXT_PUBLIC_GOOGLE_CLIENT_ID`. `AUTODUCK_ENV` defaulted to production.

**Hashes:** per-table hashes are order-independent multiset SHA-256 over typed values
(`hashdb.py` in the scratchpad).

### Boot 1

**Log:** the boot log showed, in order:

1. `pools opened journal_mode=Delete`
2. boot backup written
3. `integrity_check ok`
4. `schema verified: 0 fatal drift=0`
5. 16 required TS ids present
6. `POINT OF NO RETURN`
7. archive written and verified (`tables=11`)
8. 11 × `dropped legacy table`
9. `journal_mode switched to WAL`
10. `pools reopened journal_mode=Wal`
11. replay import 130/130 present
12. recovery `rows_changed=0`
13. `listening`

**Kept tables:** all 26 kept data tables (58,508 rows) have identical row counts and content
hashes before and after. The 16 existing `AppMigration` rows are identical; the 3 new rows are the
`rs-*` ids. The 14 `sqlite_sequence` entries of kept tables are identical. The `sqlite_master` DDL
of every kept table and index is byte-identical (SHA-1 `620738c1…`).

**Archive:** all 11 dropped tables (573 rows) are in the archive with identical row counts and
content hashes. The archive equals the pre-boot DB except for `AppMigration` (it already holds
`rs-ponr`). Its `integrity_check` is `ok`.

**After the boot:** `integrity_check` is `ok` and `journal_mode` is `wal`.

### Boot 2

The log showed `pools opened journal_mode=Wal`, the backup skipped (younger than 6 h) and
`owned schema: nothing to migrate`. All 28 tables were identical to their state after boot 1,
and no second archive was written.

### Read smoke

| Check | Result |
|---|---|
| `autoduck backup --force` in WAL mode | Wrote a DELETE-mode file with `integrity_check` ok |
| `autoduck verify-db` | OK: 0 fatal, 0 drift; `rs-ponr`, `rs-0010` and `rs-0011` applied; `journal_mode=wal` |
| `/api/health` | 200 |
| `/season-3` | 200, SPA root |
| `/api/season3?token=<real token>` | 200, viewer set, 8 players |
| `/api/races/246` | 200 |
| An old v2 race with commentary | 200, 9 commentaries |
| `/api/races/246/track` | 200, 305,111 bytes |
| `GET /api/admin/season3` with the secret | 200, 13 weeks |
| `GET /api/admin/season3` with a wrong secret | 401 |

### Test race

`open-week` (week 14, on the copy only) was followed by `start-race {test:true}`, which created
race 247.

- **Race:** `finished` in about 60 s.
- **Replay track:** `RaceReplayTrack` has `fidelity=RECORDED` and `source=LIVE_RUST`.
- **Digest:** `reproducedDigest == resultDigest`.
- **Events:** 387 events.
- **Logs:** no 5xx and no error lines.

## Production deploy runbook

**Preconditions:**

- It is not a Monday (ICT).
- No race is pending or running.
- Deploying `main` = `phase9-db` also ships Phase 9 step 1 (`rewrite-live`).

### 1. Back up first

This backup is also the rollback point.

```fish
# in the running container (Dokploy app), then copy it off-box like the 2026-11-11 cutover backups
autoduck backup --force                    # prints /app/data/backups/boot-<ts>.db
sqlite3 /app/data/backups/boot-<ts>.db "PRAGMA integrity_check"   # must print ok
```

Record per-table counts of that file, as in `~/autoduck-backups/*.counts.txt`.

### 2. Deploy

Fast-forward `main` to `phase9-db`, push, then deploy through the Dokploy MCP. The deploy uses
stop-first updates, so the old instance releases the lock before the new one boots.

### 3. Watch the boot log

Expect these lines in order:

1. `pools opened journal_mode=Delete`
2. `boot backup skipped` (step 1 is under 6 h old) or `boot backup written`
3. `integrity_check ok`
4. `schema mode: owned, first owned boot`
5. `schema verified: 0 fatal`
6. `required TS migrations present count=16`
7. `POINT OF NO RETURN`
8. `legacy archive written and verified file=/app/data/backups/autoduck-legacy-archive-<ts>.db tables=11`
9. 11 × `dropped legacy table` with the counts above (production may have changed since: nothing
   writes these tables)
10. `journal_mode switched to WAL`
11. `pools reopened journal_mode=Wal`
12. `replay import: 0 missing`
13. `crash recovery done … rows_changed=0`
14. `listening`

**Failure signals:**

- `legacy archive failed, nothing was dropped`: the boot exits 1. The DB is unchanged apart from
  the harmless `rs-ponr` row. Typical cause: disk space (the archive needs about 1× the DB, 76 MB).
  Fix it and redeploy, or roll back.
- Any `schema drift (fatal)` or `integrity_check` error: the boot stops before step 9b.

### 4. After the boot

- Run `autoduck verify-db` in the container. Expect `verify-db: OK` with all three `rs-*` ids
  applied and `journal_mode=wal`.
- Check `/api/health`, `/season-3`, `/api/races/246` and an old v2 race.
- Copy `autoduck-legacy-archive-<ts>.db` off-box and keep it: it is the only copy of the dropped
  tables (it holds PII, so chmod 600).
- From now on, host-side backups use `.backup`, `autoduck backup`, or all three files with the
  server stopped.

### 5. Rollback

Restore the pre-deploy backup and run the previous image:

1. Stop the app in Dokploy.
2. On the `autoduck-data` volume, for example through a one-off container
   `docker run --rm -it -v autoduck-data:/app/data --entrypoint sh <image>`:
   - move `autoduck.db`, `autoduck.db-wal` and `autoduck.db-shm` aside into a dated directory;
     don't delete them;
   - copy the step-1 backup to `/app/data/autoduck.db` and `chmod 600` it;
   - make sure no `-wal`/`-shm` files are left next to it.
3. Redeploy the previous image or commit (`d7c9fb8`, compat mode).
4. Expect the old image's boot log: the backup, `integrity_check ok` and
   `schema verified: 0 fatal`.

Writes made between the deploy and the rollback are lost.

**Not rehearsed:** running the previous image directly on the migrated DB. It would see WAL plus
dropped legacy tables, which its verifier treats as non-fatal drift.
