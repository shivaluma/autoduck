import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { createSimulation, simulateRace } from '../packages/race-core/src'
import { RACE_BALANCE_VERSION, RACE_ENGINE_VERSION, raceConfigSchema, type RaceConfig } from '../packages/race-protocol/src'
import { parseRaceIdParam } from '../lib/racing/race-id'
import { postRaceStatsForView } from '../src/race/post-race-engine'
import { collectPostRaceBaselineRank, collectPostRaceMotion } from '../lib/racing/post-race-stats'
import { aggregatePostRaceStats, type PostRaceStats } from '../src/race/post-race-stats'
import { planLiveView } from '../src/race/replay-plan'

// Step 0.5 follow-ups: no invented baseline columns without an engine baseline, the live canvas
// never simulates a config the browser engine can't run, and strict race ids in the race routes.

function makeConfig(): RaceConfig {
  return raceConfigSchema.parse({
    raceId: 'followups',
    seed: 'c4'.repeat(32),
    players: Array.from({ length: 6 }, (_, index) => ({ playerId: String(301 + index), name: `Duck ${index + 1}` })),
    loadouts: Array.from({ length: 6 }, (_, index) => ({
      playerId: String(301 + index),
      itemIds: [['NITRO', 'HOMING_ROCKET'], ['BANANA', 'BUBBLE_SHIELD'], ['FEATHER', 'QUACK_HORN']][index % 3],
      source: 'AUTO',
    })),
  })
}

const config = makeConfig()
const result = simulateRace(config)
const players = config.players.map((player) => ({ playerId: player.playerId, name: player.name }))
// Stored configs from other versions are passed to the viewer unparsed. Since Phase 5 the browser engine is
// race-core as WASM: the Rust pair (2.0.0/S3.16) is the one it re-simulates; the TS pair is "another version".
const oldConfig = { ...config, engineVersion: '1.1.0', balanceVersion: 'S3.2' } as RaceConfig
const rustConfig = { ...config, engineVersion: '2.0.0', balanceVersion: 'S3.16', rngVersion: 'xs32-v1' } as unknown as RaceConfig
// Engine inputs as the WASM engine would hand them over (here computed with the TS engine on the TS race).
const engineInputs = { motion: collectPostRaceMotion(config, []), baselineRank: collectPostRaceBaselineRank(config) }

function assertNoBaseline(view: { stats: PostRaceStats; showBaseline: boolean }) {
  assert.equal(view.showBaseline, false)
  assert.equal(view.stats.hasBaseline, false)
  assert.equal(view.stats.highlights.bestItemUser, null, 'no best-item-user highlight from invented deltas')
  for (const player of view.stats.players) {
    assert.equal(player.rankDelta, 0)
    assert.equal(player.baselineRank, player.finalRank)
  }
}

test('post-race stats: a current-version race without frozen stats has a real no-items baseline', () => {
  const view = postRaceStatsForView({ config: rustConfig, events: result.events, players, engine: engineInputs })
  assert.equal(view.showBaseline, true)
  assert.equal(view.stats.hasBaseline, true)
  assert.equal(view.showSpeed, true)
  const baseline = simulateRace({ ...config, raceId: `${config.raceId}-post-race-baseline`, loadouts: [] }, { recordEvents: false })
  for (const entry of baseline.standings) {
    assert.equal(view.stats.players.find((player) => player.playerId === entry.playerId)!.baselineRank, entry.rank)
  }
})

test('post-race stats: an old-version race, or a current one before the engine answered, shows no baseline columns', () => {
  for (const [stored, engine] of [[oldConfig, engineInputs], [config, engineInputs], [null, engineInputs], [rustConfig, null]] as const) {
    const view = postRaceStatsForView({ config: stored, events: result.events, players, engine })
    assertNoBaseline(view)
    assert.equal(view.showSpeed, false)
    // The event-derived columns are still there.
    assert.equal(view.stats.players.length, players.length)
    assert.deepEqual(view.stats.players.map((player) => player.finalRank), [1, 2, 3, 4, 5, 6])
  }
})

test('post-race stats: the aggregation without a baseline no longer falls back to participant order', () => {
  const stats = aggregatePostRaceStats({ tickRate: 60 }, result.events, [...players].reverse())
  assert.equal(stats.hasBaseline, false)
  assert.ok(stats.players.every((player) => player.rankDelta === 0))
})

test('post-race stats: frozen stats keep their baseline unless they say they have none', () => {
  const frozen = aggregatePostRaceStats({ tickRate: 60 }, result.events, players, { baselineRank: new Map(players.map((player, index) => [player.playerId, 6 - index])) })
  const legacyBlob = JSON.parse(JSON.stringify(frozen)) as PostRaceStats
  Reflect.deleteProperty(legacyBlob, 'hasBaseline')
  assert.equal(postRaceStatsForView({ config: rustConfig, events: result.events, players, frozenStats: legacyBlob }).showBaseline, true)
  assert.equal(postRaceStatsForView({ config: rustConfig, events: result.events, players, frozenStats: frozen }).showBaseline, true)
  assert.equal(postRaceStatsForView({ config: rustConfig, events: result.events, players, frozenStats: { ...frozen, hasBaseline: false } }).showBaseline, false)
})

test('live view: the v1 live canvas simulates only the browser engine pair and follows snapshots otherwise', () => {
  assert.equal(planLiveView(rustConfig), 'live')
  // TS-era races (the TS server's v1 stream) are no longer simulated in the browser.
  assert.equal(planLiveView({ engineVersion: RACE_ENGINE_VERSION, balanceVersion: RACE_BALANCE_VERSION }), 'snapshot')
  assert.equal(planLiveView(config), 'snapshot')
  assert.equal(planLiveView(oldConfig), 'snapshot')
  assert.equal(planLiveView(null), 'snapshot')
  assert.equal(planLiveView({}), 'snapshot')
  // The TS engine's own version guard still refuses Rust configs.
  assert.throws(() => createSimulation(rustConfig))
})

test('race id: race ids must be canonical decimal', () => {
  for (const raw of ['41abc', '041', '0', '+41', '-1', '4.1', ' 41', '41 ', '1e3', '0x29', '', 'abc', '４１']) {
    assert.deepEqual(parseRaceIdParam(raw), { ok: false, status: 400 }, raw)
  }
  assert.deepEqual(parseRaceIdParam('41'), { ok: true, raceId: 41 })
  assert.deepEqual(parseRaceIdParam('2147483647'), { ok: true, raceId: 2_147_483_647 })
  assert.deepEqual(parseRaceIdParam('2147483648'), { ok: false, status: 404 })
  assert.deepEqual(parseRaceIdParam('99999999999999999999999'), { ok: false, status: 404 })
})

const dir = mkdtempSync(path.join(tmpdir(), 'autoduck-race-id-'))
after(() => rmSync(dir, { recursive: true, force: true }))

test('race id: both race routes reject non-canonical ids before touching the database', async () => {
  // Never opened: every request below is answered before a query.
  process.env.DATABASE_URL = `file:${path.join(dir, 'unused.db')}`
  const detail = await import('../app/api/races/[id]/route')
  const track = await import('../app/api/races/[id]/track/route')
  const call = async (handler: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>, id: string) => {
    const response = await handler(new Request(`http://localhost/api/races/${encodeURIComponent(id)}`), { params: Promise.resolve({ id }) })
    return { status: response.status, body: await response.json() }
  }
  for (const id of ['41abc', '041', '4.1', '-3']) {
    assert.deepEqual(await call(detail.GET, id), { status: 400, body: { error: 'Invalid race ID' } }, `detail ${id}`)
    assert.deepEqual(await call(track.GET, id), { status: 400, body: { error: 'Invalid race ID' } }, `track ${id}`)
  }
  assert.deepEqual(await call(detail.GET, '9999999999'), { status: 404, body: { error: 'Race not found' } })
  assert.deepEqual(await call(track.GET, '9999999999'), { status: 404, body: { error: 'No replay track for this race' } })
})
