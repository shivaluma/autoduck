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
          const winner = data.participants.find((p: any) => p.initialRank === 1)
          const victims = data.participants.filter((p: any) => p.gotScar)

          setResult({
            raceId,
            winner: winner ? { name: winner.name, avatarUrl: winner.avatarUrl } : null,
            victims: victims.map((v: any) => ({ name: v.name, avatarUrl: v.avatarUrl })),
            verdict: data.finalVerdict || 'Race Finished'
          })
          setStatus('live')
        }
      } catch (e) {
        console.error('Polling error', e)
      }
    }

    fetchRaceData()
    intervalId = setInterval(fetchRaceData, 3000)

    return () => clearInterval(intervalId)
  }, [raceId, result])

  // Auto-scroll effect
  useEffect(() => {
    if (bottomRef.current) {
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

          {/* Winner Avatar */}
          {result.winner && (
            <div className="relative animate-bounce-in mb-8">
              <div className="absolute -inset-6 bg-[var(--color-ggd-gold)] rounded-full blur-2xl opacity-40 animate-pulse" />
              <img
                src={result.winner.avatarUrl || '/placeholder-avatar.png'}
                className="w-48 h-48 rounded-full border-4 border-[var(--color-ggd-gold)] shadow-[0_0_50px_rgba(255,200,87,0.5)] object-cover relative z-10"
              />
              <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 bg-[var(--color-ggd-gold)] text-[var(--color-ggd-deep)] font-display text-lg px-5 py-1.5 rounded-full shadow-lg whitespace-nowrap z-20">
                👑 VỊT NHẤT: {result.winner.name} 🏆
              </div>
            </div>
          )}

          {/* Verdict */}
          <div className="cartoon-card-gold p-6 animate-slide-up">
            <h2 className="font-display text-4xl text-[var(--color-ggd-gold)] text-center glow-gold">
              🎉 HẾT TRẬN RỒI!
            </h2>
            <p className="text-xl mt-2 text-center text-[var(--color-ggd-cream)]/80 font-readable italic">&ldquo;{result.verdict}&rdquo;</p>
          </div>

          {/* Losers */}
          {result.victims && result.victims.length > 0 && (
            <div className="absolute bottom-10 flex gap-12 animate-slide-up" style={{ animationDelay: '0.5s' }}>
              {result.victims.map((v, idx) => (
                <div key={idx} className="flex flex-col items-center group relative">
                  <div className="relative">
                    <div className="absolute -inset-2 bg-[var(--color-ggd-orange)] rounded-full blur-lg opacity-30 animate-pulse" />
                    <img
                      src={v.avatarUrl || '/placeholder-avatar.png'}
                      className="w-24 h-24 rounded-full border-3 border-[var(--color-ggd-orange)] object-cover relative z-10 saturate-50"
                    />
                    <div className="absolute -top-2 -right-2 text-2xl z-20 animate-bob">😢</div>
                  </div>
                  <div className="mt-2 font-display text-base text-[var(--color-ggd-orange)] bg-[var(--color-ggd-deep)]/80 px-3 py-1 rounded-full">
                    🦆 VỊT XUI: {v.name}
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
          <Card className="flex-1 bg-black/50 flex items-center justify-center overflow-hidden relative border-3 border-[var(--color-ggd-mint)] rounded-2xl shadow-[0_0_20px_rgba(94,232,183,0.2)]">
            {status === 'connecting' && (
              <div className="text-[var(--color-ggd-mint)] animate-pulse flex flex-col items-center">
                <span className="text-4xl animate-bob">📡</span>
                <p className="mt-2 text-sm font-data text-[var(--color-ggd-lavender)]">Đang kết nối...</p>
              </div>
            )}

            {/* Live Badge */}
            <div className="absolute top-4 left-4 z-10 flex gap-2">
              <div className={`cute-tag bg-[var(--color-ggd-orange)] text-white shadow-lg ${status === 'live' ? 'animate-pulse' : ''}`}>
                <div className="w-2 h-2 bg-white rounded-full mr-1.5"></div>
                {result ? '🏁 KẾT THÚC' : '🔴 LIVE'}
              </div>
              {status === 'live' && !result && (
                <div className="cute-tag bg-[var(--color-ggd-deep)]/70 text-[var(--color-ggd-mint)] border border-[var(--color-ggd-mint)]/30">
                  📺 Trực Tiếp
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

          {/* Stream Info */}
          <div className="soft-card p-4 flex justify-between items-center">
            <div className="font-display text-base text-[var(--color-ggd-cream)]">
              {result ? '🏆 Đã Kết Thúc' : '📺 Phát Trực Tiếp'}
            </div>
            <div className="flex items-center gap-2 text-sm font-data">
              <div className={`w-2 h-2 rounded-full ${status === 'live' ? 'bg-[var(--color-ggd-mint)]' : 'bg-[var(--color-ggd-orange)]'}`} />
              <span className={status === 'live' ? 'text-[var(--color-ggd-mint)]' : 'text-[var(--color-ggd-orange)]'}>
                {status === 'live' ? 'Đang kết nối' : 'Đang kết nối lại...'}
              </span>
            </div>
          </div>
        </div>

        {/* RIGHT: Live Commentary (1 col) */}
        <Card className="lg:col-span-1 cartoon-card flex flex-col h-full overflow-hidden">
          {/* Header */}
          <div className="px-5 py-3 border-b-2 border-[var(--color-ggd-mint)]/10 bg-[var(--color-ggd-surface-2)]/30 flex items-center justify-between rounded-t-[17px]">
            <span className="font-display text-base text-[var(--color-ggd-cream)]">
              🎤 MC Vịt
            </span>
            {status === 'live' && !result && <span className="w-2.5 h-2.5 bg-[var(--color-ggd-mint)] rounded-full animate-ping" />}
          </div>

          {/* Chat Area */}
          <ScrollArea className="flex-1 p-4" ref={scrollRef}>
            <div className="space-y-4">
              {commentaries.length === 0 && (
                <div className="text-center text-[var(--color-ggd-lavender)]/30 py-10 text-sm font-data">
                  🎤 MC Vịt đang chuẩn bị... 🦆
                </div>
              )}

              {commentaries.map((c) => (
                <div key={c.id} className="animate-slide-up flex gap-3 group">
                  <div className="mt-1">
                    <span className="cute-tag bg-[var(--color-ggd-mint)]/10 text-[var(--color-ggd-mint)] text-[10px]">
                      {formatTime(c.timestamp)}
                    </span>
                  </div>
                  <div className="flex-1 bg-[var(--color-ggd-surface-2)]/40 p-3 rounded-2xl rounded-tl-sm border border-[var(--color-ggd-mint)]/10 group-hover:bg-[var(--color-ggd-surface-2)]/60 transition-colors">
                    <p className="font-readable text-sm text-[var(--color-ggd-cream)]/90 leading-relaxed">
                      {c.text}
                    </p>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          </ScrollArea>

          {/* Input area mimic */}
          <div className="p-3 border-t-2 border-[var(--color-ggd-mint)]/10 bg-[var(--color-ggd-deep)]/40">
            <div className="h-8 bg-[var(--color-ggd-surface-2)]/30 rounded-full border border-[var(--color-ggd-mint)]/10 flex items-center px-3 text-xs text-[var(--color-ggd-lavender)]/40 font-data cursor-not-allowed">
              🤖 MC Vịt AI đang bình luận...
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}
