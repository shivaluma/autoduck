import readline from 'node:readline'
import { runMatchupBatch, type FullLoadout } from './balance-sim-core'

interface WorkerJob {
  id: number
  left: FullLoadout
  right: FullLoadout
  startIndex: number
  seedCount: number
  playerCount: number
  swapSlots: boolean
}

const rl = readline.createInterface({ input: process.stdin })
rl.on('line', (line) => {
  if (!line.trim()) return
  const job = JSON.parse(line) as WorkerJob
  const aggregate = runMatchupBatch(job.left, job.right, job.startIndex, job.seedCount, job.playerCount, job.swapSlots)
  process.stdout.write(`${JSON.stringify({ id: job.id, aggregate })}\n`)
})
rl.on('close', () => process.exit(0))
