import assert from 'node:assert/strict'
import test from 'node:test'
import { runMatchupBatch } from '../scripts/lib/balance-sim-core'
import { BalanceSimWorkerPool } from '../scripts/lib/balance-sim-worker-pool'

const left = ['NITRO', 'DRAFT_FIN'] as const
const right = ['HOMING_ROCKET', 'BANANA'] as const

function aggregateFingerprint(seedCount: number) {
  const aggregate = runMatchupBatch(left, right, 1, seedCount, 8, true)
  const rate = aggregate.left.wins / aggregate.left.samples
  return {
    leftWins: aggregate.left.wins,
    rightWins: aggregate.right.wins,
    leftSamples: aggregate.left.samples,
    boostBreakSuccess: aggregate.instrumentation.counters.boostBreakSuccess,
    featherProcs: aggregate.instrumentation.items.FEATHER!.successfulProcs,
    seedOutcomeCount: aggregate.seedOutcomes.length,
    winRate: Number(rate.toFixed(6)),
  }
}

test('worker pool returns identical aggregate to in-process run', async () => {
  const seedCount = 24
  const expected = aggregateFingerprint(seedCount)
  const pool = new BalanceSimWorkerPool(2)
  try {
    const actualAggregate = await pool.runShardedBatch(left, right, 1, seedCount, 8, true)
    const actual = {
      leftWins: actualAggregate.left.wins,
      rightWins: actualAggregate.right.wins,
      leftSamples: actualAggregate.left.samples,
      boostBreakSuccess: actualAggregate.instrumentation.counters.boostBreakSuccess,
      featherProcs: actualAggregate.instrumentation.items.FEATHER!.successfulProcs,
      seedOutcomeCount: actualAggregate.seedOutcomes.length,
      winRate: Number((actualAggregate.left.wins / actualAggregate.left.samples).toFixed(6)),
    }
    assert.deepEqual(actual, expected)
  } finally {
    await pool.close()
  }
})

test('single-worker and sharded worker pool produce identical gameplay counters', async () => {
  const seedCount = 32
  const single = aggregateFingerprint(seedCount)
  const pool = new BalanceSimWorkerPool(4)
  try {
    const aggregate = await pool.runShardedBatch(left, right, 1, seedCount, 8, true)
    const sharded = {
      leftWins: aggregate.left.wins,
      rightWins: aggregate.right.wins,
      leftSamples: aggregate.left.samples,
      boostBreakSuccess: aggregate.instrumentation.counters.boostBreakSuccess,
      featherProcs: aggregate.instrumentation.items.FEATHER!.successfulProcs,
      seedOutcomeCount: aggregate.seedOutcomes.length,
      winRate: Number((aggregate.left.wins / aggregate.left.samples).toFixed(6)),
    }
    assert.deepEqual(sharded, single)
  } finally {
    await pool.close()
  }
})
