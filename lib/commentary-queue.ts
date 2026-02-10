/**
 * Commentary Job Queue
 * SQLite-based async queue for AI commentary generation
 */

import { prisma } from './db'
import { generateZaiCommentary } from './ai-zai'
import { generateClaudeCommentary } from './ai-claude'

// AI Provider switching via env var: 'zai' (default) or 'claude'
const AI_PROVIDER = process.env.AI_PROVIDER || 'zai'

async function generateCommentary(
  screenshotB64: string,
  timestamp: number,
  isRaceEnd: boolean
): Promise<string> {
  if (AI_PROVIDER === 'claude') {
    return generateClaudeCommentary(screenshotB64, timestamp, isRaceEnd)
  }
  return generateZaiCommentary(screenshotB64, timestamp, isRaceEnd)
}

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed'

/**
 * Queue a screenshot for async commentary generation
 */
export async function queueCommentary(
  raceId: number,
  timestamp: number,
  screenshotB64: string,
  isRaceEnd: boolean = false
): Promise<number> {
  const job = await prisma.commentaryJob.create({
    data: {
      raceId,
      timestamp,
      screenshotB64,
      isRaceEnd,
      status: 'pending',
    },
  })
  console.log(`📝 Queued commentary job #${job.id} for race ${raceId} at ${timestamp}s`)
  return job.id
}

/**
 * Process the next pending job
 * Returns true if a job was processed, false if queue is empty
 */
export async function processNextJob(): Promise<boolean> {
  // Get next pending job (FIFO)
  const job = await prisma.commentaryJob.findFirst({
    where: { status: 'pending' },
    orderBy: { createdAt: 'asc' },
  })

  if (!job) {
    return false
  }

  console.log(`🎙️ [${AI_PROVIDER.toUpperCase()}] Processing job #${job.id} for race ${job.raceId} at ${job.timestamp}s`)

  // Mark as processing
  await prisma.commentaryJob.update({
    where: { id: job.id },
    data: { status: 'processing' },
  })

  try {
    // Generate commentary using selected provider
    const commentary = await generateCommentary(
      job.screenshotB64,
      job.timestamp,
      job.isRaceEnd
    )

    // Mark as completed and store result
    await prisma.commentaryJob.update({
      where: { id: job.id },
      data: {
        status: 'completed',
        result: commentary,
        processedAt: new Date(),
      },
    })

    // Also create a CommentaryLog entry for the race
    await prisma.commentaryLog.create({
      data: {
        raceId: job.raceId,
        timestamp: job.timestamp,
        content: commentary,
      },
    })

    console.log(`✅ Job #${job.id} completed: "${commentary.substring(0, 50)}..."`)
    return true
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error(`❌ Job #${job.id} failed:`, errorMessage)

    await prisma.commentaryJob.update({
      where: { id: job.id },
      data: {
        status: 'failed',
        error: errorMessage,
        processedAt: new Date(),
      },
    })
    return true // Still processed (failed)
  }
}

/**
 * Get all jobs for a race
 */
export async function getJobsForRace(raceId: number) {
  return prisma.commentaryJob.findMany({
    where: { raceId },
    orderBy: { timestamp: 'asc' },
  })
}

/**
 * Get pending job count
 */
export async function getPendingJobCount(): Promise<number> {
  return prisma.commentaryJob.count({
    where: { status: 'pending' },
  })
}

/**
 * Process all pending jobs (batch mode)
 */
export async function processAllPendingJobs(): Promise<number> {
  let processed = 0
  while (await processNextJob()) {
    processed++
    // Small delay between jobs to avoid rate limiting (reduced for faster processing)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return processed
}
