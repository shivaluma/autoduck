import { performance } from 'node:perf_hooks'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

async function main() {
  const root = process.argv[2] ?? '.'
  const load = (file: string) => import(pathToFileURL(resolve(root, file)).href)
  const { resolveRocketTarget } = await load('packages/race-core/src/auto-use/evaluate.ts')
  const { createItemRaceState } = await load('packages/race-core/src/items/engine.ts')
  const { buildRaceObjectiveContext } = await load('packages/race-core/src/auto-use/objective.ts')
  const { createRaceConfig } = await load('scripts/lib/balance-sim-core.ts')
  const config = createRaceConfig(1, 16)
  const itemState = createItemRaceState(config)
  const ducks = config.players.map((p: { playerId: string }, i: number) => ({ ...p, progress: 0.5 + i * 0.007, lateralOffset: 0, lateralVelocity: 0, currentRank: 16-i, finished: false }))
  for (const [id, runtime] of itemState.byPlayer) {
    if (id !== 'duck-1') { runtime.bubbleAvailable = true; runtime.bubbleUntilTick = 10000 }
  }
  const ctx = { tick: 100, tickRate: 60, objective: buildRaceObjectiveContext(config), itemState, pickupState: { hazards: [] }, ducks, playerId: 'duck-1', secondsUntilNextPickupZone: 999, prepAutoUseEnabled: true, wildAutoUseEnabled: false, ghostPlayerIds: new Set<string>() }
  for (let i=0;i<10000;i++) resolveRocketTarget(ctx, 'PREP')
  const ms: number[] = []
  let result: string | null = null
  for (let repeat=0;repeat<5;repeat++) {
    const start = performance.now()
    for (let i=0;i<100000;i++) result = resolveRocketTarget(ctx, 'PREP')
    ms.push(performance.now()-start)
  }
  console.log(JSON.stringify({ root, scenario: '16 players, shield-heavy pack', callsPerTrial: 100000, milliseconds: ms, medianMs: [...ms].sort((a,b)=>a-b)[2], result }, null, 2))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
