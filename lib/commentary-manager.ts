import { prisma } from './db'
import { generateZaiCommentary, type CommentaryHistory } from './ai-zai'
import { generateClaudeCommentary } from './ai-claude'
import { generateGeminiCommentary } from './ai-gemini'
import { raceEventBus, RACE_EVENTS } from './event-bus'
import type { RaceMetaContext } from './types'

// AI Provider switching via env var: 'gemini' (default), 'zai' or 'claude'
const AI_PROVIDER = process.env.AI_PROVIDER || 'gemini'

// In-memory storage for active races
// Mapping raceId -> Array of CommentaryHistory
const commentaryMemory: Record<number, CommentaryHistory[]> = {}

// In-flight commentary tasks per race. They run independently so live comments
// do not queue behind a slow provider response.
const commentaryTasks: Record<number, Promise<void>[]> = {}

async function generateCommentary(
  screenshotB64: string,
  timestamp: number,
  isRaceEnd: boolean,
  participantNames?: string,
  history?: CommentaryHistory[],
  raceResults?: string,
  context?: RaceMetaContext
): Promise<string> {
  if (AI_PROVIDER === 'claude') {
    return generateClaudeCommentary(screenshotB64, timestamp, isRaceEnd, participantNames, history, raceResults, context)
  }
  if (AI_PROVIDER === 'zai') {
    return generateZaiCommentary(screenshotB64, timestamp, isRaceEnd, participantNames, history, raceResults, context)
  }
  return generateGeminiCommentary(screenshotB64, timestamp, isRaceEnd, participantNames, history, raceResults, context)
}

/**
 * Record a commentary asynchronously but sequentially per race.
 * This function returns immediately (non-blocking for the caller),
 * and queues the actual generation in a promise chain.
 */
export function recordCommentary(
  raceId: number,
  timestamp: number,
  screenshotB64: string,
  isRaceEnd: boolean = false,
  participantNames?: string,
  raceResults?: string,
  context?: RaceMetaContext
): void {
  // Initialize memory for this race if not exists
  if (!commentaryMemory[raceId]) {
    commentaryMemory[raceId] = []
  }
  if (!commentaryTasks[raceId]) {
    commentaryTasks[raceId] = []
  }

  console.log(`📝 Scheduled commentary job for race ${raceId} at ${timestamp}s${isRaceEnd ? ' (RACE END)' : ''}`)

  const task = (async () => {
    try {
      console.log(`🎙️ [${AI_PROVIDER.toUpperCase()}] Processing commentary for race ${raceId} at ${timestamp}s${isRaceEnd ? ' (END)' : ''}`)

      const historySnapshot = [...commentaryMemory[raceId]]

      const commentaryText = await generateCommentary(
        screenshotB64,
        timestamp,
        isRaceEnd,
        participantNames,
        historySnapshot,
        raceResults,
        context
      )

      // Add to memory
      commentaryMemory[raceId].push({ timestamp, text: commentaryText })
      commentaryMemory[raceId].sort((left, right) => left.timestamp - right.timestamp)

      // Also create a CommentaryLog entry for the race for future reference
      await prisma.commentaryLog.create({
        data: {
          raceId,
          timestamp,
          content: commentaryText,
        },
      })

      console.log(`✅ Commentary for race ${raceId} at ${timestamp}s completed: "${commentaryText.substring(0, 60)}..."`)

      // Broadcast to live clients via EventBus
      raceEventBus.emit(RACE_EVENTS.COMMENTARY, {
        raceId,
        text: commentaryText,
        timestamp
      })

    } catch (error) {
      console.error(`❌ Commentary generation failed for race ${raceId} at ${timestamp}s:`, error)
    }
  })().catch(err => {
    console.error(`❌ Fatal error in commentary chain for race ${raceId}:`, err)
  })

  commentaryTasks[raceId].push(task)
}

/**
 * Wait for all pending commentaries for a race to finish,
 * and clean up the in-memory structures.
 */
export async function waitForCommentaryAndCleanup(raceId: number): Promise<void> {
  if (commentaryTasks[raceId] !== undefined) {
    console.log(`🧹 Waiting for final commentaries to finish for race ${raceId}...`)
    await Promise.allSettled(commentaryTasks[raceId])
    console.log(`🧹 Cleaning up memory for race ${raceId}`)
    delete commentaryTasks[raceId]
    delete commentaryMemory[raceId]
  }
}
