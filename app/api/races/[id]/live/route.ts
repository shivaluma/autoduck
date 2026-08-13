import { NextRequest, NextResponse } from 'next/server'
import { raceEventBus, RACE_EVENTS } from '@/lib/event-bus'
import { prisma } from '@/lib/db'
import { getLiveRaceSession } from '@/lib/racing/live-race-session'

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

      const eventKey = (payload: { tick: number; type?: string; sourcePlayerId?: string | null; targetPlayerId?: string | null }) => `${payload.tick}:${payload.type ?? ''}:${payload.sourcePlayerId ?? ''}:${payload.targetPlayerId ?? ''}`
      const visualEngineEvents = new Set([
        'ROCKET_FIRED', 'ROCKET_HIT', 'ROCKET_BLOCKED', 'BANANA_DROPPED', 'BANANA_HIT', 'BANANA_BLOCKED',
        'NITRO_STARTED', 'HORN_USED', 'FEATHER_DODGED', 'BUBBLE_POPPED', 'PICKUP_COLLECTED', 'PICKUP_SKIPPED_SLOT_FULL',
        'WILD_ITEM_GRANTED', 'INSTANT_PICKUP_TRIGGERED', 'MINI_ROCKET_FIRED', 'MINI_ROCKET_HIT', 'MINI_ROCKET_BLOCKED',
        'WILD_BANANA_DROPPED', 'WILD_BANANA_HIT', 'WILD_BANANA_BLOCKED', 'MINI_BUBBLE_ACTIVATED', 'MINI_BUBBLE_BLOCKED',
        'WILD_HORN_USED', 'WILD_FEATHER_USED', 'WILD_FEATHER_DODGED', 'HAZARD_HIT', 'HAZARD_DODGED', 'GOLDEN_BOX_COLLECTED', 'DUCK_FINISHED',
      ])
      const syncEngineEvents = new Set(['WILD_ITEM_MANUAL_INPUT'])
      const onEngineEvent = (payload: { raceId: string; tick: number; type?: string; sourcePlayerId?: string; targetPlayerId?: string; metadata?: unknown }) => {
        if (Number(payload.raceId) !== raceId) return
        if (!payload.type || (!visualEngineEvents.has(payload.type) && !syncEngineEvents.has(payload.type))) return
        const key = eventKey(payload)
        if (seenEventKeys.has(key)) return
        seenEventKeys.add(key)
        sendEvent('engine-event', payload)
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
          const session = getLiveRaceSession(raceId)
          if (session?.latestSnapshot && session.latestSnapshot.tick > latestSnapshotTick) {
            latestSnapshotTick = session.latestSnapshot.tick
            sendEvent('snapshot', session.latestSnapshot)
          }

          if (session) return

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
