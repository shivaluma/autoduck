/**
 * Dumps the config the TS S3.15 oracle effectively runs, for every line of a
 * `race-cli corpus gen` corpus (review 3 M1).
 *
 *   node --import tsx scripts/oracle/dump-config-effective.ts --corpus corpus.jsonl \
 *     [--out crates/race-cli/tests/fixtures/corpus-ts-effective.jsonl.gz]
 *
 * Each output line is the effective config of one case, in the shape of the
 * Rust `ResolvedRaceConfig`: `raceConfigSchema.parse` (Zod defaults, e.g.
 * goldenBoxProbability 0.12) followed by the engine's own fallbacks
 * (`pickups/engine.ts:86-121` pickupConfig(), `items/engine.ts:176-181`
 * itemTuning, absent chaosConfig = NORMAL). A config Zod rejects is written as
 * `{"error": "<message>"}`. `RaceConfigInput::resolve_ts_compat` must produce
 * exactly these values (`crates/race-cli/tests/config_ts_compat.rs`).
 *
 * Absent optional labels (pickupSpawnVersion, hazardBalanceVersion) are the
 * TS constants `lib/season3-race.ts:177-179` writes; the engine never reads
 * them. The oracle (packages/race-*) is imported, never modified.
 */
import { createWriteStream, readFileSync } from 'node:fs'
import { createGzip } from 'node:zlib'
import { ITEM_BALANCE } from '../../packages/race-core/src/items/config'
import { PICKUP_BALANCE } from '../../packages/race-core/src/pickups/config'
import { HAZARD_BALANCE_VERSION, PICKUP_SPAWN_VERSION, raceConfigSchema, type RaceConfig } from '../../packages/race-protocol/src'

function effective(config: RaceConfig) {
  const pickup = config.pickupConfig
  return {
    raceId: config.raceId,
    seed: config.seed,
    protocolVersion: config.protocolVersion,
    engineVersion: config.engineVersion,
    balanceVersion: config.balanceVersion,
    trackVersion: config.trackVersion,
    pickupSpawnVersion: config.pickupSpawnVersion ?? PICKUP_SPAWN_VERSION,
    wildItemBalanceVersion: config.wildItemBalanceVersion,
    hazardBalanceVersion: config.hazardBalanceVersion ?? HAZARD_BALANCE_VERSION,
    tickRate: config.tickRate,
    players: config.players.map((player) => ({
      playerId: player.playerId,
      name: player.name,
      cosmeticKey: player.cosmeticKey,
      isGhost: player.isGhost ?? false,
    })),
    loadouts: config.loadouts,
    chaosConfig: {
      type: config.chaosConfig?.type ?? 'NORMAL',
      targetPlayerId: config.chaosConfig?.targetPlayerId ?? null,
      groups: config.chaosConfig?.groups ?? [],
    },
    itemTuning: {
      nitroSpeedMultiplier: config.itemTuning?.nitroSpeedMultiplier ?? ITEM_BALANCE.nitro.speedMultiplier,
      rocketSlowMultiplier: config.itemTuning?.rocketSlowMultiplier ?? ITEM_BALANCE.rocket.slowMultiplier,
      bananaKnockbackMultiplier: config.itemTuning?.bananaKnockbackMultiplier ?? 1,
      bananaSlowMultiplier: config.itemTuning?.bananaSlowMultiplier ?? 1,
    },
    // Verbatim mirror of pickups/engine.ts pickupConfig() (not exported).
    pickupConfig: !pickup
      ? {
        enabled: false,
        goldenBoxEnabled: false,
        goldenBoxProbability: 0,
        hazardsEnabled: false,
        positionAwareLoot: true,
        spawnMultiplier: 0,
        regularPickupCap: PICKUP_BALANCE.regularPickupCap,
        manualItemsEnabled: false,
        autoItemsEnabled: false,
        chaosBoxEnabled: false,
        forceItem: undefined,
        disabledItems: [],
        idealManualPlayerIds: [],
        forceGoldenBox: false,
      }
      : {
        enabled: pickup.enabled ?? true,
        goldenBoxEnabled: pickup.goldenBoxEnabled ?? true,
        goldenBoxProbability: pickup.goldenBoxProbability ?? PICKUP_BALANCE.goldenBoxProbability,
        hazardsEnabled: pickup.hazardsEnabled ?? true,
        positionAwareLoot: pickup.positionAwareLoot ?? true,
        spawnMultiplier: pickup.spawnMultiplier ?? 1,
        regularPickupCap: pickup.regularPickupCap ?? PICKUP_BALANCE.regularPickupCap,
        manualItemsEnabled: pickup.manualItemsEnabled ?? true,
        autoItemsEnabled: pickup.autoItemsEnabled ?? true,
        chaosBoxEnabled: pickup.chaosBoxEnabled ?? false,
        forceItem: pickup.forceItem,
        disabledItems: pickup.disabledItems ?? [],
        idealManualPlayerIds: pickup.idealManualPlayerIds ?? [],
        forceGoldenBox: pickup.forceGoldenBox ?? false,
      },
  }
}

const argv = process.argv.slice(2)
const flag = (name: string) => {
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : undefined
}
const corpus = flag('--corpus')
if (!corpus) {
  console.error('usage: dump-config-effective.ts --corpus corpus.jsonl [--out file.jsonl.gz]')
  process.exit(2)
}
const outPath = flag('--out') ?? 'crates/race-cli/tests/fixtures/corpus-ts-effective.jsonl.gz'
const lines = readFileSync(corpus, 'utf8').split('\n').filter((line) => line.length > 0)
const gzip = createGzip({ level: 9 })
const file = createWriteStream(outPath)
gzip.pipe(file)
let rejected = 0
for (const line of lines) {
  const parsed = raceConfigSchema.safeParse(JSON.parse(line))
  if (parsed.success) {
    gzip.write(`${JSON.stringify(effective(parsed.data))}\n`)
  } else {
    rejected += 1
    gzip.write(`${JSON.stringify({ error: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ') })}\n`)
  }
}
gzip.end()
file.on('finish', () => console.error(`dump-config-effective: ${lines.length} cases (${rejected} rejected by Zod) -> ${outPath}`))
