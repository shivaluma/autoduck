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

  // Set up SSE stream
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()

      const sendEvent = (event: string, data: any) => {
        const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
        controller.enqueue(encoder.encode(payload))
      }

      // Initial connection message
      sendEvent('status', { message: 'Connected to live stream', raceId })

      // Listener for frames
      const onFrame = (payload: { raceId: number; data: string; timestamp: number }) => {
        if (payload.raceId === raceId) {
          sendEvent('frame', { image: payload.data, timestamp: payload.timestamp })
        }
      }

      // Subscribe to events
      raceEventBus.on(RACE_EVENTS.FRAME, onFrame)

      // Keep connection alive with ping
      const heartbeat = setInterval(() => {
        sendEvent('ping', { time: Date.now() })
      }, 5000)

      // Cleanup logic needs to be handled when stream cancels
      // We'll attach cleanup to the cancel method, but we need closure access
      // So define cleanup function here

      // Store cleanup function on the controller context (hacky) or closure
      // But start doesn't expose cleanup hook directly.
    },
    cancel() {
      // This is called when client disconnects
      // We need to clean up listeners here
      // But we don't have access to onFrame here if defined inside start scope without sharing
    }
  })

  // We need to structure it so cancel can access the listener
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

      const onFrame = (payload: { raceId: number; data: string; timestamp: number }) => {
        if (payload.raceId === raceId) {
          sendEvent('frame', { image: payload.data, timestamp: payload.timestamp })
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
      }, 5000)

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
    },
  })
}
