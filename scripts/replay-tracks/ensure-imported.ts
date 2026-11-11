/**
 * Boot-time import of the historical replay tracks (plan §4.4 step 9, step 0.6).
 *
 *   tsx scripts/replay-tracks/ensure-imported.ts [--manifest artifacts/replay-tracks/manifest.json]
 *
 * Runs from scripts/start.sh after the app migrations, on every boot. Not ledgered, idempotent, and it never
 * exits non-zero: a failure only means fewer tracks. For each manifest entry whose race has no RaceReplayTrack
 * row it checks the guard and inserts the row:
 *   - the race exists, is finished and has an engine config;
 *   - its resultDigest equals the manifest's (or, when the stored digest is null, sha256(engineConfigJson) equals
 *     configSha256), and the config hash matches too;
 *   - for a graded entry, the gunzipped <raceId>.dtrk.gz hashes to byteSha256.
 * UNAVAILABLE entries get a row without bytes, so the §4.5 gate (every finished race with a config has a row)
 * holds. statsJson is built here, not in the artifacts (which hold ids only): HEAD's post-race aggregation over
 * the stored events, with motion from the track's speed column and the baseline ranks the resolver computed
 * with the reproducing commit. Stats are best effort; a failure leaves statsJson null.
 *
 * Logs `[replay-tracks] imported N, skipped M, rejected K` and one line per rejection.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '../../prisma/generated/prisma/client'

interface ManifestEntry {
  raceId: number
  engineVersion: string | null
  balanceVersion: string | null
  trackVersion: string | null
  resultDigest: string | null
  configSha256: string
  reproducedDigest: string | null
  fidelity: 'VERIFIED_DIGEST' | 'VERIFIED_EVENTS' | 'UNAVAILABLE'
  engineCommit: string | null
  trackGeometry: string | null
  file: string | null
  byteSha256: string | null
  tickRate: number
  tickCount: number
  baselineRank: Record<string, number> | null
  note: string | null
}

const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex')

function manifestPath(argv: string[]) {
  const index = argv.indexOf('--manifest')
  return path.resolve(index >= 0 && argv[index + 1] ? argv[index + 1]! : path.join(process.cwd(), 'artifacts/replay-tracks/manifest.json'))
}

/** Frozen post-race stats for one imported race; null when anything is missing or throws. */
async function buildStats(prisma: PrismaClient, entry: ManifestEntry, configJson: string, raw: Uint8Array | null): Promise<string | null> {
  try {
    const [{ aggregatePostRaceStats, motionFromTrack }, { decodeReplayTrack }, { normalizeRaceEvent, splitStoredEvents }] = await Promise.all([
      import('../../src/race/post-race-stats'),
      import('../../src/race/replay-track/decode'),
      import('../../src/race/event-vocab'),
    ])
    const config = JSON.parse(configJson) as { tickRate?: number; players?: Array<{ playerId: string; name?: string }>; loadouts?: Array<{ playerId: string; itemIds: string[] }> }
    const rows = await prisma.raceEngineEvent.findMany({ where: { raceId: entry.raceId }, orderBy: { id: 'asc' } })
    const events = splitStoredEvents(rows.map((row) => normalizeRaceEvent(row, String(entry.raceId)))).timeline
    const participants = await prisma.raceParticipant.findMany({ where: { raceId: entry.raceId }, include: { user: true }, orderBy: { initialRank: 'asc' } })
    const configPlayers = new Map((config.players ?? []).map((player) => [player.playerId, player] as const))
    const loadouts = new Map((config.loadouts ?? []).map((loadout) => [loadout.playerId, loadout.itemIds] as const))
    const players = participants.filter((participant) => !participant.isClone).map((participant) => {
      const playerId = String(participant.userId)
      return {
        playerId,
        name: configPlayers.get(playerId)?.name ?? participant.displayName ?? participant.user.name,
        avatarUrl: participant.user.avatarUrl,
        itemIds: (loadouts.get(playerId) ?? []) as never[],
      }
    })
    const motion = raw ? motionFromTrack(decodeReplayTrack(raw)) : null
    const baselineRank = entry.baselineRank ? new Map(Object.entries(entry.baselineRank)) : null
    return JSON.stringify(aggregatePostRaceStats({ tickRate: Number(config.tickRate) || 60 }, events, players, { motion, baselineRank }))
  } catch (error) {
    console.warn(`[replay-tracks] race ${entry.raceId}: stats not frozen (${error instanceof Error ? error.message : String(error)})`)
    return null
  }
}

async function main() {
  const file = manifestPath(process.argv.slice(2))
  if (!existsSync(file)) {
    console.log(`[replay-tracks] no manifest at ${path.relative(process.cwd(), file)}; nothing to import`)
    return
  }
  const manifest = JSON.parse(readFileSync(file, 'utf8')) as { races: ManifestEntry[] }
  const dir = path.dirname(file)
  const dbUrl = process.env.DATABASE_URL || `file:${path.join(process.cwd(), 'prisma', 'dev.db')}`
  const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: dbUrl }) })
  let imported = 0
  let skipped = 0
  let absent = 0
  const rejected: string[] = []
  try {
    const existing = new Set((await prisma.raceReplayTrack.findMany({ select: { raceId: true } })).map((row) => row.raceId))
    for (const entry of manifest.races) {
      if (existing.has(entry.raceId)) {
        skipped += 1
        continue
      }
      try {
        const race = await prisma.race.findUnique({
          where: { id: entry.raceId },
          select: { status: true, resultDigest: true, engineConfigJson: true, engineVersion: true, balanceVersion: true, trackVersion: true },
        })
        if (!race) {
          absent += 1
          continue
        }
        if (race.status !== 'finished' || !race.engineConfigJson) {
          rejected.push(`${entry.raceId}: race is ${race.status}${race.engineConfigJson ? '' : ' without an engine config'}`)
          continue
        }
        const configSha = sha256(race.engineConfigJson)
        if (configSha !== entry.configSha256) {
          rejected.push(`${entry.raceId}: engineConfigJson hash differs from the manifest`)
          continue
        }
        if ((race.resultDigest ?? null) !== (entry.resultDigest ?? null)) {
          rejected.push(`${entry.raceId}: resultDigest differs from the manifest`)
          continue
        }
        let gzip: Uint8Array<ArrayBuffer> | null = null
        let raw: Uint8Array | null = null
        if (entry.fidelity !== 'UNAVAILABLE') {
          if (!entry.file || !entry.byteSha256) {
            rejected.push(`${entry.raceId}: ${entry.fidelity} entry without file/byteSha256`)
            continue
          }
          gzip = new Uint8Array(readFileSync(path.join(dir, path.basename(entry.file))))
          raw = new Uint8Array(gunzipSync(gzip))
          if (sha256(raw) !== entry.byteSha256) {
            rejected.push(`${entry.raceId}: track bytes do not hash to byteSha256`)
            continue
          }
        }
        const statsJson = raw ? await buildStats(prisma, entry, race.engineConfigJson, raw) : null
        await prisma.raceReplayTrack.create({
          data: {
            raceId: entry.raceId,
            format: 'dtrk/1',
            source: 'BACKFILL',
            fidelity: entry.fidelity,
            engineImpl: 'ts',
            engineCommit: entry.engineCommit,
            engineBuild: null,
            engineVersion: entry.engineVersion ?? race.engineVersion ?? '',
            balanceVersion: entry.balanceVersion ?? race.balanceVersion ?? '',
            trackVersion: entry.trackVersion ?? race.trackVersion ?? '',
            trackGeometry: entry.trackGeometry,
            tickRate: entry.tickRate,
            tickCount: entry.tickCount,
            stride: 1,
            reproducedDigest: entry.reproducedDigest,
            byteSha256: entry.byteSha256,
            bytes: gzip,
            statsJson,
            note: entry.note,
          },
        })
        imported += 1
      } catch (error) {
        rejected.push(`${entry.raceId}: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`)
      }
    }
  } finally {
    await prisma.$disconnect().catch(() => undefined)
  }
  console.log(`[replay-tracks] imported ${imported}, skipped ${skipped}, rejected ${rejected.length}${absent ? ` (${absent} manifest races not in this database)` : ''}`)
  for (const reason of rejected) console.log(`[replay-tracks]   rejected ${reason}`)
}

main().catch((error) => {
  console.error('[replay-tracks] import failed; continuing boot:', error instanceof Error ? error.message : error)
}).finally(() => {
  process.exitCode = 0
})
