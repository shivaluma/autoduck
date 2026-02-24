'use client'

import { useEffect, useState, useRef } from 'react'
import { Card } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Fireworks } from '@/components/fireworks'

interface RaceLiveViewProps { raceId: number }
interface Commentary { id: number; text: string; timestamp: number }
interface RaceResult { raceId: number; winner: { name: string; avatarUrl?: string | null } | null; victims: { name: string; avatarUrl?: string | null }[]; verdict: string }

export function RaceLiveView({ raceId }: RaceLiveViewProps) {
  const [status, setStatus] = useState<'connecting' | 'live' | 'offline'>('connecting')
  const [commentaries, setCommentaries] = useState<Commentary[]>([])
  const [result, setResult] = useState<RaceResult | null>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const evtSource = new EventSource(`/api/races/${raceId}/live`)
    evtSource.onopen = () => setStatus('live')
    evtSource.onerror = () => { if (evtSource.readyState === EventSource.CLOSED) setStatus('offline') }
    evtSource.addEventListener('frame', (event) => {
      try {
        const data = JSON.parse(event.data)
        if (imgRef.current) { imgRef.current.src = `data:image/jpeg;base64,${data.image}`; imgRef.current.style.display = 'block' }
        setStatus('live')
      } catch (e) { console.error('Frame parse error', e) }
    })
    evtSource.addEventListener('finished', (event) => {
      try { setResult(JSON.parse(event.data)) } catch (e) { console.error('Finished parse error', e) }
    })
    return () => evtSource.close()
  }, [raceId])

  useEffect(() => {
    const fetchRaceData = async () => {
      try {
        const res = await fetch(`/api/races/${raceId}`); if (!res.ok) return; const data = await res.json()
        if (data.commentaries) {
          setCommentaries(prev => {
            const newItems = data.commentaries.filter((c: any) => !prev.some(p => p.timestamp === c.timestamp && p.text === c.content))
            if (newItems.length === 0) return prev
            const mapped = newItems.map((c: any) => ({ id: Date.now() + Math.random(), text: c.content, timestamp: c.timestamp }))
            return [...prev, ...mapped].sort((a, b) => a.timestamp - b.timestamp)
          })
        }
        if (data.status === 'finished' && !result) {
          const winner = data.participants.find((p: any) => p.initialRank === 1)
          const victims = data.participants.filter((p: any) => p.gotScar)
          setResult({ raceId, winner: winner ? { name: winner.name, avatarUrl: winner.avatarUrl } : null, victims: victims.map((v: any) => ({ name: v.name, avatarUrl: v.avatarUrl })), verdict: data.finalVerdict || 'Race Finished' })
          setStatus('live')
        }
      } catch (e) { console.error('Polling error', e) }
    }
    fetchRaceData()
    const intervalId = setInterval(fetchRaceData, 3000)
    return () => clearInterval(intervalId)
  }, [raceId, result])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }, [commentaries])

  const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`

  return (
    <div className="relative">
      {result && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center animate-fade-in pointer-events-none">
          <Fireworks />
          {result.winner && (
            <div className="relative animate-bounce-in mb-8">
              <div className="absolute -inset-6 bg-[var(--color-ggd-gold)] rounded-full blur-2xl opacity-40 animate-pulse" />
              <img src={result.winner.avatarUrl || '/placeholder-avatar.png'} className="w-48 h-48 rounded-full border-6 border-[var(--color-ggd-outline)] shadow-[0_0_50px_rgba(255,204,0,0.5),0_6px_0_var(--color-ggd-outline)] object-cover relative z-10" />
              <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 ggd-tag bg-[var(--color-ggd-gold)] text-[var(--color-ggd-outline)] text-lg px-5 py-1.5 z-20 whitespace-nowrap">
                👑 VỊT NHẤT: {result.winner.name} 🏆
              </div>
            </div>
          )}
          <div className="ggd-card-gold p-6 animate-slide-up">
            <h2 className="font-display text-4xl text-[var(--color-ggd-gold)] text-center text-outlined glow-gold">🎉 HẾT TRẬN!</h2>
            <p className="text-xl mt-2 text-center text-white/80 font-readable italic">&ldquo;{result.verdict}&rdquo;</p>
          </div>
          {result.victims?.length > 0 && (
            <div className="absolute bottom-10 flex gap-12 animate-slide-up" style={{ animationDelay: '0.5s' }}>
              {result.victims.map((v, idx) => (
                <div key={idx} className="flex flex-col items-center">
                  <div className="relative">
                    <div className="absolute -inset-2 bg-[var(--color-ggd-orange)] rounded-full blur-lg opacity-30 animate-pulse" />
                    <img src={v.avatarUrl || '/placeholder-avatar.png'} className="w-24 h-24 rounded-full border-4 border-[var(--color-ggd-outline)] object-cover relative z-10 saturate-50" />
                    <div className="absolute -top-2 -right-2 text-2xl z-20 animate-bob">😢</div>
                  </div>
                  <div className="mt-2 ggd-tag bg-[var(--color-ggd-orange)] text-white text-sm">🦆 VỊT XUI: {v.name}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[600px] lg:h-[700px]">
        <div className="lg:col-span-2 flex flex-col gap-4">
          <Card className="flex-1 bg-black/60 flex items-center justify-center overflow-hidden relative border-4 border-[var(--color-ggd-neon-green)] rounded-2xl shadow-[0_0_25px_rgba(61,255,143,0.2),0_6px_0_var(--color-ggd-outline)]">
            {status === 'connecting' && (
              <div className="text-[var(--color-ggd-neon-green)] animate-pulse flex flex-col items-center">
                <span className="text-4xl animate-bob">📡</span>
                <p className="mt-2 text-base font-data text-[var(--color-ggd-muted)]">Đang kết nối...</p>
              </div>
            )}
            <div className="absolute top-4 left-4 z-10 flex gap-2">
              <div className={`ggd-tag bg-[var(--color-ggd-orange)] text-white ${status === 'live' ? 'animate-pulse' : ''}`}>
                <div className="w-2 h-2 bg-white rounded-full"></div>
                {result ? '🏁 KẾT THÚC' : '🔴 LIVE'}
              </div>
            </div>
            <img ref={imgRef} alt="Live" className="w-full h-full object-contain" style={{ display: 'none' }} />
          </Card>
          <div className="ggd-card p-4 flex justify-between items-center">
            <div className="font-display text-lg text-white text-outlined">{result ? '🏆 Đã Kết Thúc' : '📺 Trực Tiếp'}</div>
            <div className="flex items-center gap-2 font-data text-sm">
              <div className={`w-3 h-3 rounded-full shadow-[0_0_8px] ${status === 'live' ? 'bg-[var(--color-ggd-neon-green)] shadow-[var(--color-ggd-neon-green)]' : 'bg-[var(--color-ggd-orange)] shadow-[var(--color-ggd-orange)]'}`} />
              <span className={status === 'live' ? 'text-[var(--color-ggd-neon-green)]' : 'text-[var(--color-ggd-orange)]'}>
                {status === 'live' ? 'Kết nối OK' : 'Đang kết nối lại...'}
              </span>
            </div>
          </div>
        </div>

        <Card className="lg:col-span-1 ggd-card flex flex-col h-full overflow-hidden">
          <div className="px-5 py-3 bg-[var(--color-ggd-panel)] rounded-t-[6px] flex items-center justify-between">
            <span className="font-display text-lg text-white text-outlined">🎤 MC Vịt</span>
            {status === 'live' && !result && <span className="w-3 h-3 bg-[var(--color-ggd-neon-green)] rounded-full animate-ping" />}
          </div>
          <ScrollArea className="flex-1 p-4" ref={scrollRef}>
            <div className="space-y-4">
              {commentaries.length === 0 && <div className="text-center text-[var(--color-ggd-muted)] py-10 font-data">🎤 MC Vịt đang chuẩn bị...</div>}
              {commentaries.map((c) => (
                <div key={c.id} className="animate-slide-up flex gap-3 group">
                  <div className="mt-1">
                    <span className="ggd-tag bg-[var(--color-ggd-neon-green)] text-[var(--color-ggd-outline)] text-[10px] py-0.5">{formatTime(c.timestamp)}</span>
                  </div>
                  <div className="flex-1 bg-[var(--color-ggd-panel)] p-3 rounded-2xl rounded-tl-sm border-2 border-[var(--color-ggd-outline)]/30 group-hover:bg-[var(--color-ggd-surface-2)] transition-colors">
                    <p className="font-readable text-base text-white/90 leading-relaxed">{c.text}</p>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          </ScrollArea>
          <div className="p-3 border-t-3 border-[var(--color-ggd-outline)]/30 bg-[var(--color-ggd-panel)]">
            <div className="h-9 bg-[var(--color-ggd-surface)] rounded-full border-2 border-[var(--color-ggd-outline)]/20 flex items-center px-4 text-sm text-[var(--color-ggd-muted)] font-data cursor-not-allowed">
              🤖 MC Vịt AI đang bình luận...
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}
