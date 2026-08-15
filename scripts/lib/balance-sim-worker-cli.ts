import { runMatchupBatch, type FullLoadout } from './balance-sim-core'

interface CliPayload {
  left: FullLoadout
  right: FullLoadout
  startIndex: number
  seedCount: number
  playerCount: number
  swapSlots: boolean
}

const payload = JSON.parse(process.argv[2] ?? '{}') as CliPayload
const result = runMatchupBatch(payload.left, payload.right, payload.startIndex, payload.seedCount, payload.playerCount, payload.swapSlots)
process.stdout.write(JSON.stringify(result))
