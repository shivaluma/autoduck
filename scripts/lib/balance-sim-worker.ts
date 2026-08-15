import { parentPort, workerData } from 'node:worker_threads'
import { runMatchupBatch, type FullLoadout } from './balance-sim-core.ts'

interface WorkerPayload {
  left: FullLoadout
  right: FullLoadout
  startIndex: number
  seedCount: number
  playerCount: number
  swapSlots: boolean
}

const payload = workerData as WorkerPayload
const result = runMatchupBatch(payload.left, payload.right, payload.startIndex, payload.seedCount, payload.playerCount, payload.swapSlots)
parentPort?.postMessage(result)
