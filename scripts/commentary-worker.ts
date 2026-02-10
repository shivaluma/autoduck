/**
 * Commentary Worker
 * Background process that continuously polls and processes commentary jobs
 * 
 * Run with: pnpm tsx scripts/commentary-worker.ts
 */

import { processNextJob, getPendingJobCount } from '../lib/commentary-queue'

const POLL_INTERVAL_MS = 500 // Poll every 0.5 seconds when processing
const IDLE_INTERVAL_MS = 1000 // Wait 1 second when idle

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  console.log('🎙️ Commentary Worker started')
  console.log(`   Polling interval: ${POLL_INTERVAL_MS}ms`)
  console.log('   Press Ctrl+C to stop\n')
  console.log('   Z_AI_API_KEY:', process.env.Z_AI_API_KEY)

  let consecutiveEmpty = 0

  while (true) {
    try {
      const pendingCount = await getPendingJobCount()

      if (pendingCount > 0) {
        console.log(`📋 ${pendingCount} pending jobs in queue`)
        consecutiveEmpty = 0

        const processed = await processNextJob()
        if (processed) {
          await sleep(POLL_INTERVAL_MS)
        }
      } else {
        consecutiveEmpty++
        if (consecutiveEmpty === 1) {
          console.log('💤 Queue empty, waiting for jobs...')
        }
        await sleep(IDLE_INTERVAL_MS)
      }
    } catch (error) {
      console.error('❌ Worker error:', error)
      await sleep(IDLE_INTERVAL_MS)
    }
  }
}

main().catch(console.error)
