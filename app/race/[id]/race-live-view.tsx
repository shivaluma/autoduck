'use client'

import { useEffect, useState, useRef } from 'react'
import { Card } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'

interface RaceLiveViewProps {
  raceId: number
}

interface Commentary {
  id: number
  text: string
  timestamp: number
}

export function RaceLiveView({ raceId }: RaceLiveViewProps) {
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [status, setStatus] = useState<'connecting' | 'live' | 'offline'>('connecting')
  const [commentaries, setCommentaries] = useState<Commentary[]>([])

  const imgRef = useRef<HTMLImageElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const evtSource = new EventSource(`/api/races/${raceId}/live`)

    evtSource.onopen = () => setStatus('live')

    evtSource.onerror = (err) => {
      if (evtSource.readyState === EventSource.CLOSED) {
        setStatus('offline')
      }
    }

    evtSource.addEventListener('frame', (event) => {
      try {
        const data = JSON.parse(event.data)
        if (imgRef.current) {
          imgRef.current.src = `data:image/jpeg;base64,${data.image}`
          imgRef.current.style.display = 'block'
        }
        setStatus('live')
      } catch (e) {
        console.error('Frame parse error', e)
      }
    })

    evtSource.addEventListener('commentary', (event) => {
      try {
        const data = JSON.parse(event.data)
        // Add new commentary
        setCommentaries(prev => {
          // Avoid duplicates if any
          if (prev.some(c => c.timestamp === data.timestamp && c.text === data.text)) return prev
          return [...prev, { id: Date.now(), text: data.text, timestamp: data.timestamp }]
        })
      } catch (e) {
        console.error('Commentary parse error', e)
      }
    })

    return () => evtSource.close()
  }, [raceId])

  // Auto-scroll effect
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [commentaries])

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[600px] lg:h-[700px]">
      {/* LEFT: Live Stream (2 cols) */}
      <div className="lg:col-span-2 flex flex-col gap-4">
        <Card className="flex-1 bg-black flex items-center justify-center overflow-hidden relative border-2 border-[var(--color-f1-red)] shadow-[0_0_20px_rgba(255,24,1,0.3)]">
          {status === 'connecting' && (
            <div className="text-[var(--color-f1-cyan)] animate-pulse flex flex-col items-center">
              <span className="text-3xl">📡</span>
              <p className="mt-2 text-sm font-mono">ESTABLISHING LINK...</p>
            </div>
          )}

          {/* Live Badge */}
          <div className="absolute top-4 left-4 z-10 flex gap-2">
            <div className="bg-red-600 text-white text-xs font-bold px-2 py-1 rounded animate-pulse shadow-lg flex items-center gap-1">
              <div className="w-2 h-2 bg-white rounded-full"></div>
              LIVE
            </div>
            <div className="bg-black/50 text-[var(--color-f1-cyan)] text-xs font-mono px-2 py-1 rounded border border-[var(--color-f1-cyan)]">
              CDP STREAM
            </div>
          </div>

          <img
            ref={imgRef}
            alt="Live Stream"
            className="w-full h-full object-contain"
            style={{ display: 'none' }}
          />
        </Card>

        {/* Stream Info / Stats could go here */}
        <div className="bg-[var(--color-f1-surface)] p-4 border border-white/10 flex justify-between items-center">
          <div className="font-display text-sm uppercase text-white tracking-widest">
            Live Feed from Server
          </div>
          <div className="text-xs font-mono text-green-400">
            ● {status === 'live' ? 'Connected' : 'Reconnecting...'}
          </div>
        </div>
      </div>

      {/* RIGHT: Live Commentary (1 col) */}
      <Card className="lg:col-span-1 bg-[var(--color-f1-surface)] border border-white/10 flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3 border-b border-white/10 bg-white/[0.04] flex items-center justify-between">
          <span className="font-display text-xs font-bold tracking-[0.15em] uppercase text-white/80">
            Live Commentary
          </span>
          <span className="w-2 h-2 bg-[var(--color-f1-cyan)] rounded-full animate-ping" />
        </div>

        {/* Chat Area */}
        <ScrollArea className="flex-1 p-4" ref={scrollRef}>
          <div className="space-y-4">
            {commentaries.length === 0 && (
              <div className="text-center text-white/20 py-10 text-sm italic">
                Waiting for commentary...
              </div>
            )}

            {commentaries.map((c) => (
              <div key={c.id} className="animate-slide-up flex gap-3 group">
                <div className="mt-1">
                  <span className="font-mono text-[10px] text-[var(--color-f1-red)] bg-white/5 px-1.5 py-0.5 rounded">
                    {formatTime(c.timestamp)}
                  </span>
                </div>
                <div className="flex-1 bg-white/5 p-3 rounded-tr-xl rounded-bl-xl rounded-br-xl border border-white/5 group-hover:bg-white/10 transition-colors">
                  <p className="font-readable text-sm text-white/90 leading-relaxed">
                    {c.text}
                  </p>
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>

        {/* Input area mimic (optional, just visual) */}
        <div className="p-3 border-t border-white/10 bg-black/20">
          <div className="h-8 bg-white/5 rounded border border-white/10 flex items-center px-3 text-xs text-white/30 italic cursor-not-allowed">
            Commentary is generated by AI...
          </div>
        </div>
      </Card>
    </div>
  )
}
