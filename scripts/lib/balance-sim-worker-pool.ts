import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import readline from 'node:readline'
import { mergeMatchupAggregate, runMatchupBatch, type FullLoadout, type MatchupAggregate } from './balance-sim-core'

const workerScript = fileURLToPath(new URL('./balance-sim-worker-pool-cli.ts', import.meta.url))

interface WorkerJobPayload {
  id: number
  left: FullLoadout
  right: FullLoadout
  startIndex: number
  seedCount: number
  playerCount: number
  swapSlots: boolean
}

interface WorkerResultPayload {
  id: number
  aggregate: MatchupAggregate
}

class PersistentWorker {
  private readonly child: ChildProcessByStdio<Writable, Readable, null>
  private readonly pending = new Map<number, { resolve: (value: MatchupAggregate) => void; reject: (error: Error) => void }>()
  private readonly rl: readline.Interface
  private alive = true

  constructor() {
    const isBun = Boolean((process.versions as Record<string, string | undefined>).bun)
    const tsxCli = fileURLToPath(new URL('../../node_modules/tsx/dist/cli.mjs', import.meta.url))
    const args = isBun ? [workerScript] : [tsxCli, workerScript]
    this.child = spawn(process.execPath, args, {
      stdio: ['pipe', 'pipe', 'inherit'],
    })
    this.rl = readline.createInterface({ input: this.child.stdout })
    this.rl.on('line', (line) => {
      const message = JSON.parse(line) as WorkerResultPayload
      const job = this.pending.get(message.id)
      if (!job) return
      this.pending.delete(message.id)
      job.resolve(message.aggregate)
    })
    this.child.on('exit', () => {
      this.alive = false
      const error = new Error('Balance sim worker exited unexpectedly')
      for (const [, job] of this.pending) job.reject(error)
      this.pending.clear()
    })
  }

  run(job: WorkerJobPayload) {
    if (!this.alive) return Promise.reject(new Error('Worker is not alive'))
    return new Promise<MatchupAggregate>((resolve, reject) => {
      this.pending.set(job.id, { resolve, reject })
      this.child.stdin.write(`${JSON.stringify(job)}\n`)
    })
  }

  close() {
    this.child.stdin.end()
    this.rl.close()
  }
}

export class BalanceSimWorkerPool {
  private readonly workers: PersistentWorker[] = []
  private readonly idleWorkers: PersistentWorker[] = []
  private nextJobId = 0

  constructor(workerCount: number) {
    for (let index = 0; index < workerCount; index += 1) {
      const worker = new PersistentWorker()
      this.workers.push(worker)
      this.idleWorkers.push(worker)
    }
  }

  get size() {
    return this.workers.length
  }

  private acquireWorker(): Promise<PersistentWorker> {
    const available = this.idleWorkers.pop()
    if (available) return Promise.resolve(available)
    return new Promise((resolve) => {
      const wait = () => {
        const worker = this.idleWorkers.pop()
        if (worker) resolve(worker)
        else setImmediate(wait)
      }
      wait()
    })
  }

  async runBatch(
    left: FullLoadout,
    right: FullLoadout,
    startIndex: number,
    seedCount: number,
    playerCount: number,
    swapSlots: boolean,
  ): Promise<MatchupAggregate> {
    const worker = await this.acquireWorker()
    const id = this.nextJobId++
    try {
      return await worker.run({ id, left, right, startIndex, seedCount, playerCount, swapSlots })
    } finally {
      this.idleWorkers.push(worker)
    }
  }

  async runShardedBatch(
    left: FullLoadout,
    right: FullLoadout,
    startIndex: number,
    seedCount: number,
    playerCount: number,
    swapSlots: boolean,
  ): Promise<MatchupAggregate> {
    if (this.workers.length <= 1 || seedCount < this.workers.length * 4) {
      return this.runBatch(left, right, startIndex, seedCount, playerCount, swapSlots)
    }
    const chunk = Math.ceil(seedCount / this.workers.length)
    const jobs: Promise<MatchupAggregate>[] = []
    for (let index = 0; index < this.workers.length; index += 1) {
      const offset = index * chunk
      if (offset >= seedCount) break
      const count = Math.min(chunk, seedCount - offset)
      jobs.push(this.runBatch(left, right, startIndex + offset, count, playerCount, swapSlots))
    }
    const parts = await Promise.all(jobs)
    const merged = structuredClone(parts[0]!)
    for (let index = 1; index < parts.length; index += 1) mergeMatchupAggregate(merged, parts[index]!)
    return merged
  }

  async close() {
    await Promise.all(this.workers.map((worker) => {
      worker.close()
      return Promise.resolve()
    }))
    this.workers.length = 0
    this.idleWorkers.length = 0
  }
}

export function runInProcessBatch(
  left: FullLoadout,
  right: FullLoadout,
  startIndex: number,
  seedCount: number,
  playerCount: number,
  swapSlots: boolean,
) {
  return runMatchupBatch(left, right, startIndex, seedCount, playerCount, swapSlots)
}
