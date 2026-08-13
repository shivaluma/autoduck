import { NextRequest, NextResponse } from 'next/server'
import { raceEventBus, RACE_EVENTS } from '@/lib/event-bus'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const raceId = parseInt(id)

  if (isNaN(raceId)) {
    return NextResponse.json({ error: 'Invalid race ID' }, { status: 400 })
  }

  let cleanup: () => void = () => { }

  const safeStream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()
      let lastPersistedEventId = 0
      let latestSnapshotTick = -1
      let polling = false
      const seenEventKeys = new Set<string>()
      const sendEvent = (event: string, data: unknown) => {
        try {
          const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
          controller.enqueue(encoder.encode(payload))
        } catch {
          // Controller might be closed
          cleanup()
        }
      }

      sendEvent('status', { message: 'Connected to live stream', raceId, retry: 1200 })

      const onFrame = (payload: { raceId: number; data: string; timestamp: number; sentAt?: number }) => {
        if (payload.raceId === raceId) {
          sendEvent('frame', { image: payload.data, timestamp: payload.timestamp, sentAt: payload.sentAt })
        }
      }

      const onCommentary = (payload: { raceId: number; text: string; timestamp: number }) => {
        if (payload.raceId === raceId) {
          sendEvent('commentary', { text: payload.text, timestamp: payload.timestamp })
        }
      }

      const onFinished = (payload: { raceId: number; winner: unknown; victims: unknown[]; verdict: string }) => {
        if (payload.raceId === raceId) {
          sendEvent('finished', payload)
        }
      }

      const onSnapshot = (payload: { raceId: string; protocolVersion: string; tick: number; ducks: unknown[] }) => {
        if (Number(payload.raceId) === raceId) {
          latestSnapshotTick = Math.max(latestSnapshotTick, payload.tick)
          sendEvent('snapshot', payload)
        }
      }

      const eventKey = (payload: { tick: number; type?: string; sourcePlayerId?: string | null; targetPlayerId?: string | null; metadata?: unknown }) => `${payload.tick}:${payload.type ?? ''}:${payload.sourcePlayerId ?? ''}:${payload.targetPlayerId ?? ''}:${JSON.stringify(payload.metadata ?? {})}`
      const onEngineEvent = (payload: { raceId: string; tick: number; type?: string; sourcePlayerId?: string; targetPlayerId?: string; metadata?: unknown }) => {
        if (Number(payload.raceId) === raceId) {
          seenEventKeys.add(eventKey(payload))
          sendEvent('engine-event', payload)
        }
      }

      raceEventBus.on(RACE_EVENTS.FRAME, onFrame)
      raceEventBus.on(RACE_EVENTS.COMMENTARY, onCommentary)
      raceEventBus.on(RACE_EVENTS.FINISHED, onFinished)
      raceEventBus.on(RACE_EVENTS.SNAPSHOT, onSnapshot)
      raceEventBus.on(RACE_EVENTS.ENGINE_EVENT, onEngineEvent)

      const heartbeat = setInterval(async () => {
        sendEvent('ping', { time: Date.now() })
        if (polling) return
        polling = true
        try {
          const [race, events] = await Promise.all([
            prisma.race.findUnique({ where: { id: raceId }, select: { liveSnapshotJson: true } }),
            prisma.raceEngineEvent.findMany({ where: { raceId, id: { gt: lastPersistedEventId } }, orderBy: { id: 'asc' }, take: 200 }),
          ])
          if (race?.liveSnapshotJson) {
            const snapshot = JSON.parse(race.liveSnapshotJson) as { tick: number }
            if (snapshot.tick > latestSnapshotTick) {
              latestSnapshotTick = snapshot.tick
              sendEvent('snapshot', snapshot)
            }
          }
          for (const event of events) {
            lastPersistedEventId = Math.max(lastPersistedEventId, event.id)
            const payload = {
              raceId: String(raceId), type: event.type, tick: event.tick,
              timestampWithinRaceMs: event.timestampWithinRaceMs,
              sourcePlayerId: event.sourcePlayerId, targetPlayerId: event.targetPlayerId,
              metadata: JSON.parse(event.metadataJson),
            }
            const key = eventKey(payload)
            if (!seenEventKeys.has(key)) sendEvent('engine-event', payload)
            seenEventKeys.add(key)
          }
          if (seenEventKeys.size > 500) seenEventKeys.clear()
        } catch {
          // Live in-process events continue even if persistence polling briefly fails.
        } finally {
          polling = false
        }
      }, 1000)

      cleanup = () => {
        clearInterval(heartbeat)
        raceEventBus.off(RACE_EVENTS.FRAME, onFrame)
        raceEventBus.off(RACE_EVENTS.COMMENTARY, onCommentary)
        raceEventBus.off(RACE_EVENTS.FINISHED, onFinished)
        raceEventBus.off(RACE_EVENTS.SNAPSHOT, onSnapshot)
        raceEventBus.off(RACE_EVENTS.ENGINE_EVENT, onEngineEvent)
      }
    },
    cancel() {
      cleanup()
      console.log(`Stream cancelled for race ${raceId}`)
    }
  })

  return new NextResponse(safeStream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
