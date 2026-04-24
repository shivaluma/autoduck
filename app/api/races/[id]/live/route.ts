import { NextRequest, NextResponse } from 'next/server'
import { raceEventBus, RACE_EVENTS } from '@/lib/event-bus'

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
      const sendEvent = (event: string, data: any) => {
        try {
          const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
          controller.enqueue(encoder.encode(payload))
        } catch (e) {
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

      const onFinished = (payload: { raceId: number; winner: any; victims: any[]; verdict: string }) => {
        if (payload.raceId === raceId) {
          sendEvent('finished', payload)
        }
      }

      raceEventBus.on(RACE_EVENTS.FRAME, onFrame)
      raceEventBus.on(RACE_EVENTS.COMMENTARY, onCommentary)
      raceEventBus.on(RACE_EVENTS.FINISHED, onFinished)

      const heartbeat = setInterval(() => {
        sendEvent('ping', { time: Date.now() })
      }, 3000)

      cleanup = () => {
        clearInterval(heartbeat)
        raceEventBus.off(RACE_EVENTS.FRAME, onFrame)
        raceEventBus.off(RACE_EVENTS.COMMENTARY, onCommentary)
        raceEventBus.off(RACE_EVENTS.FINISHED, onFinished)
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
