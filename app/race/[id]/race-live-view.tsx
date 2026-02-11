'use client'

import { useEffect, useState, useRef } from 'react'
import { Card } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Fireworks } from '@/components/fireworks'

interface RaceLiveViewProps {
  raceId: number
}

interface Commentary {
  id: number
  text: string
  timestamp: number
}

interface RaceResult {
  raceId: number
  winner: { name: string; avatarUrl?: string | null } | null
  victims: { name: string; avatarUrl?: string | null }[]
  verdict: string
}

export function RaceLiveView({ raceId }: RaceLiveViewProps) {
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [status, setStatus] = useState<'connecting' | 'live' | 'offline'>('connecting')
  const [commentaries, setCommentaries] = useState<Commentary[]>([])
  const [result, setResult] = useState<RaceResult | null>(null)

  // Audio ref for victory sound (optional)
  const audioRef = useRef<HTMLAudioElement | null>(null)

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

    // SSE removed for commentary - switching to polling below
    // Finished event still useful for immediate notification if it works
    evtSource.addEventListener('finished', (event) => {
      try {
        const data = JSON.parse(event.data)
        setResult(data)
      } catch (e) {
        console.error('Finished event parse error', e)
      }
    })

    return () => evtSource.close()
  }, [raceId])

  // Polling for Commentary & Status
  useEffect(() => {
    let intervalId: NodeJS.Timeout

    const fetchRaceData = async () => {
      try {
        const res = await fetch(`/api/races/${raceId}`)
        if (!res.ok) return
        const data = await res.json()

        // Update commentaries
        if (data.commentaries) {
          setCommentaries(prev => {
            // Merge new commentaries
            const newItems = data.commentaries.filter((c: any) => !prev.some(p => p.timestamp === c.timestamp && p.text === c.content))
            if (newItems.length === 0) return prev

            const mapped = newItems.map((c: any) => ({
              id: Date.now() + Math.random(),
              text: c.content,
              timestamp: c.timestamp
            }))
            return [...prev, ...mapped].sort((a, b) => a.timestamp - b.timestamp)
          })
        }

        // Check if finished
        if (data.status === 'finished' && !result) {
          // Construct result object if we missed the SSE event
          // We might need to fetch participants to get avatar urls if not present in race data root
          // But looking at API, it returns participants with avatars.
          // We need to determine winner/victims from data.participants
          // The API returns parsed data, let's reconstruct the result shape expected by UI

          // Re-derive result if missing
          const winner = data.participants.find((p: any) => p.initialRank === 1)
          const victims = data.participants.filter((p: any) => p.gotScar)

          setResult({
            raceId,
            winner: winner ? { name: winner.name, avatarUrl: winner.avatarUrl } : null,
            victims: victims.map((v: any) => ({ name: v.name, avatarUrl: v.avatarUrl })),
            verdict: data.finalVerdict || 'Race Finished'
          })
          setStatus('live') // Ensure UI shows finished state
        }
      } catch (e) {
        console.error('Polling error', e)
      }
    }

    // Poll every 2 seconds
    fetchRaceData() // Initial fetch
    intervalId = setInterval(fetchRaceData, 3000)

    return () => clearInterval(intervalId)
  }, [raceId, result])

  // Auto-scroll effect
  useEffect(() => {
    if (bottomRef.current) {
      // Use 'nearest' to prevent scrolling the parent window/viewport
      bottomRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [commentaries])

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  return (
    <div className="relative">
      {/* FINAL EFFECTS OVERLAY */}
      {result && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center animate-fade-in pointer-events-none">
          <Fireworks />

          {/* Winner Avatar (Centered) */}
          {result.winner && (
            <div className="relative animate-zoom-in mb-8">
              <div className="absolute -inset-4 bg-yellow-500 rounded-full blur-xl opacity-50 animate-pulse" />
              <img
                src={result.winner.avatarUrl || '/placeholder-avatar.png'}
                className="w-48 h-48 rounded-full border-4 border-yellow-400 shadow-[0_0_50px_rgba(255,215,0,0.6)] object-cover relative z-10"
              />
              <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 bg-yellow-500 text-black font-black uppercase px-4 py-1 rounded shadow-lg whitespace-nowrap z-20">
                🏆 CHAMPION: {result.winner.name} 🏆
              </div>
            </div>
          )}

          {/* Verdict */}
          <div className="bg-black/80 backdrop-blur text-white px-8 py-4 rounded-xl border border-white/20 shadow-2xl animate-slide-up">
            <h2 className="text-3xl font-display font-bold text-[var(--color-f1-red)] uppercase text-center glow-text">
              RACE FINISHED
            </h2>
            <p className="text-xl mt-2 text-center text-zinc-300 italic">"{result.verdict}"</p>
          </div>

          {/* Losers (Bottom) */}
          {result.victims && result.victims.length > 0 && (
            <div className="absolute bottom-10 flex gap-12 animate-slide-up delay-500">
              {result.victims.map((v, idx) => (
                <div key={idx} className="flex flex-col items-center group relative">
                  {/* Glitch/Cursed Effect */}
                  <div className="relative">
                    <div className="absolute inset-0 bg-red-600 mix-blend-overlay opacity-0 group-hover:opacity-100 animate-pulse rounded-full" />
                    <img
                      src={v.avatarUrl || '/placeholder-avatar.png'}
                      className="w-24 h-24 rounded-full border-2 border-red-900 grayscale contrast-150 brightness-75 object-cover"
                      style={{ filter: 'grayscale(100%) contrast(1.2) brightness(0.8)' }}
                    />
                    {/* Glitch overlay */}
                    <div className="absolute inset-0 bg-noise opacity-30 mix-blend-overlay rounded-full" />
                  </div>
                  <div className="mt-2 text-red-700 font-creepster font-bold uppercase tracking-widest text-sm bg-black px-2 rounded">
                    🦆 VICTIM: {v.name}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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
              <div className={`bg-red-600 text-white text-xs font-bold px-2 py-1 rounded shadow-lg flex items-center gap-1 ${status === 'live' ? 'animate-pulse' : ''}`}>
                <div className="w-2 h-2 bg-white rounded-full"></div>
                {result ? 'FINISHED' : 'LIVE'}
              </div>
              {status === 'live' && !result && (
                <div className="bg-black/50 text-[var(--color-f1-cyan)] text-xs font-mono px-2 py-1 rounded border border-[var(--color-f1-cyan)]">
                  CDP STREAM
                </div>
              )}
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
              {result ? 'Final Classification' : 'Live Feed from Server'}
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
              Race Director
            </span>
            {status === 'live' && !result && <span className="w-2 h-2 bg-[var(--color-f1-cyan)] rounded-full animate-ping" />}
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
    </div>
  )
}
