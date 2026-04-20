'use client'

import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import { Card } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { RaceStatus } from '@/lib/types'

interface RaceLiveViewProps {
  raceId: number
}

interface Commentary {
  id: number
  text: string
  timestamp: number
}

interface RaceFinishedEvent {
  raceId: number
  winner: { name: string; avatarUrl?: string | null } | null
  victims: { name: string; avatarUrl?: string | null }[]
  verdict: string
}

export function RaceLiveView({ raceId }: RaceLiveViewProps) {
  const [status, setStatus] = useState<'connecting' | 'live' | 'offline'>('connecting')
  const [commentaries, setCommentaries] = useState<Commentary[]>([])
  const [result, setResult] = useState<RaceFinishedEvent | null>(null)
  const [raceData, setRaceData] = useState<RaceStatus | null>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const evtSource = new EventSource(`/api/races/${raceId}/live`)
    evtSource.onopen = () => setStatus('live')
    evtSource.onerror = () => {
      if (evtSource.readyState === EventSource.CLOSED) {
        setStatus('offline')
      }
    }

    evtSource.addEventListener('frame', (event) => {
      try {
        const data = JSON.parse(event.data) as { image: string }
        if (imgRef.current) {
          imgRef.current.src = `data:image/jpeg;base64,${data.image}`
          imgRef.current.style.display = 'block'
        }
        setStatus('live')
      } catch (error) {
        console.error('Frame parse error', error)
      }
    })

    evtSource.addEventListener('finished', (event) => {
      try {
        setResult(JSON.parse(event.data) as RaceFinishedEvent)
      } catch (error) {
        console.error('Finished parse error', error)
      }
    })

    return () => evtSource.close()
  }, [raceId])

  useEffect(() => {
    const fetchRaceData = async () => {
      try {
        const response = await fetch(`/api/races/${raceId}`)
        if (!response.ok) {
          return
        }

        const data = await response.json() as RaceStatus
        setRaceData(data)

        if (data.commentaries) {
          setCommentaries((previous) => {
            const newItems = data.commentaries.filter(
              (commentary) => !previous.some((item) => item.timestamp === commentary.timestamp && item.text === commentary.content)
            )
            if (newItems.length === 0) {
              return previous
            }

            const mapped = newItems.map((commentary) => ({
              id: Date.now() + Math.random(),
              text: commentary.content,
              timestamp: commentary.timestamp,
            }))
            return [...previous, ...mapped].sort((left, right) => left.timestamp - right.timestamp)
          })
        }

        if (data.status === 'finished' && !result) {
          const winner = data.participants.find((participant) => participant.initialRank === 1)
          const victims = data.participants.filter((participant) => participant.gotScar)
          setResult({
            raceId,
            winner: winner ? { name: winner.displayName ?? winner.name, avatarUrl: winner.avatarUrl } : null,
            victims: victims.map((victim) => ({ name: victim.displayName ?? victim.name, avatarUrl: victim.avatarUrl })),
            verdict: data.finalVerdict || 'Race Finished',
          })
          setStatus('live')
        }
      } catch (error) {
        console.error('Polling error', error)
      }
    }

    fetchRaceData()
    const intervalId = setInterval(fetchRaceData, 3000)
    return () => clearInterval(intervalId)
  }, [raceId, result])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [commentaries])

  const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`

  const participants = raceData?.participants ?? []
  const bossOwners = Array.from(
    new Set(
      participants
        .filter((participant) => participant.isClone && typeof participant.cloneOfUserId === 'number')
        .map((participant) => participant.cloneOfUserId as number)
    )
  )

  const bossArc = bossOwners
    .map((bossOwnerId) => participants.find((participant) => participant.userId === bossOwnerId && !participant.isClone))
    .filter((participant): participant is NonNullable<typeof participant> => Boolean(participant))

  const curseSwaps = participants.filter(
    (participant) => !participant.isClone && participant.chestEffect === 'CURSE_SWAP' && participant.displayName && participant.displayName !== participant.name
  )

  const activeEffects = participants
    .filter((participant) => !participant.isClone && participant.chestEffect)
    .map((participant) => ({
      ownerName: participant.name,
      effect: participant.chestEffect!,
      targetName: participant.chestTargetUserId
        ? participants.find((candidate) => candidate.userId === participant.chestTargetUserId && !candidate.isClone)?.name ?? null
        : null,
    }))

  const clones = participants.filter((participant) => participant.isClone)

  return (
    <div className="relative">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[700px] lg:h-[760px]">
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
                <div className="w-2 h-2 bg-white rounded-full" />
                {result ? '🏁 KẾT THÚC' : '🔴 LIVE'}
              </div>
            </div>
            <Image ref={imgRef} alt="Live" src="/next.svg" width={1200} height={800} unoptimized className="w-full h-full object-contain" style={{ display: 'none' }} />
          </Card>

          {bossArc.length > 0 && (
            <div className="ggd-card-gold p-4">
              <div className="font-display text-lg text-[var(--color-ggd-gold)] text-outlined">👑 BOSS DUCK ARC</div>
              <div className="font-data text-sm text-white/80 mt-1">
                {bossArc.map((boss) => `${boss.name} (${participants.filter((participant) => participant.cloneOfUserId === boss.userId).length + 1} entries)`).join(' • ')} cần né top 2 cuối.
              </div>
            </div>
          )}

          {curseSwaps.length > 0 && (
            <div className="ggd-card-orange p-4">
              <div className="font-display text-lg text-white text-outlined">⚠️ Curse Swap</div>
              <div className="font-data text-sm text-white/80 mt-1">
                {curseSwaps.map((swap) => `${swap.name} đang chạy dưới tên "${swap.displayName}"`).join(' • ')}
              </div>
            </div>
          )}

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

        <div className="lg:col-span-1 flex flex-col gap-4 h-full">
          <Card className="ggd-card flex flex-col h-[360px] overflow-hidden">
            <div className="px-5 py-3 bg-[var(--color-ggd-panel)] rounded-t-[6px] flex items-center justify-between">
              <span className="font-display text-lg text-white text-outlined">🎤 MC Vịt</span>
              {status === 'live' && !result && <span className="w-3 h-3 bg-[var(--color-ggd-neon-green)] rounded-full animate-ping" />}
            </div>
            <ScrollArea className="flex-1 p-4">
              <div className="space-y-4">
                {commentaries.length === 0 && <div className="text-center text-[var(--color-ggd-muted)] py-10 font-data">🎤 MC Vịt đang chuẩn bị...</div>}
                {commentaries.map((commentary) => (
                  <div key={commentary.id} className="animate-slide-up flex gap-3 group">
                    <div className="mt-1">
                      <span className="ggd-tag bg-[var(--color-ggd-neon-green)] text-[var(--color-ggd-outline)] text-[10px] py-0.5">{formatTime(commentary.timestamp)}</span>
                    </div>
                    <div className="flex-1 bg-[var(--color-ggd-panel)] p-3 rounded-2xl rounded-tl-sm border-2 border-[var(--color-ggd-outline)]/30 group-hover:bg-[var(--color-ggd-surface-2)] transition-colors">
                      <p className="font-readable text-base text-white/90 leading-relaxed">{commentary.text}</p>
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
            </ScrollArea>
          </Card>

          <Card className="ggd-card p-4">
            <div className="font-display text-lg text-white text-outlined mb-3">🎁 EFFECTS ACTIVE</div>
            <div className="space-y-2">
              {activeEffects.length > 0 ? activeEffects.map((effect) => (
                <div key={`${effect.ownerName}-${effect.effect}`} className="rounded-xl bg-[var(--color-ggd-panel)] p-3 border-2 border-[var(--color-ggd-outline)]/30">
                  <div className="font-body text-sm text-white font-black">{effect.ownerName}</div>
                  <div className="font-data text-xs text-[var(--color-ggd-gold)] mt-1">
                    {effect.effect}{effect.targetName ? ` → ${effect.targetName}` : ''}
                  </div>
                </div>
              )) : (
                <div className="font-data text-sm text-[var(--color-ggd-muted)]">Không có chest effect active.</div>
              )}
            </div>
          </Card>

          <Card className="ggd-card p-4 flex-1">
            <div className="font-display text-lg text-white text-outlined mb-3">👤 CLONES</div>
            <div className="space-y-2 max-h-[180px] overflow-y-auto pr-1">
              {clones.length > 0 ? clones.map((clone) => {
                const owner = participants.find((participant) => participant.userId === clone.cloneOfUserId && !participant.isClone)
                return (
                  <div key={`${clone.userId}-${clone.cloneIndex ?? 0}`} className="rounded-xl bg-[var(--color-ggd-panel)] p-3 border-2 border-[var(--color-ggd-outline)]/30 opacity-85">
                    <div className="font-body text-sm text-white font-black">{clone.displayName ?? clone.name}</div>
                    <div className="font-data text-xs text-[var(--color-ggd-muted)] mt-1">
                      Clone #{clone.cloneIndex ?? '?'} of {owner?.name ?? 'Unknown'}
                    </div>
                  </div>
                )
              }) : (
                <div className="font-data text-sm text-[var(--color-ggd-muted)]">Không có clone active.</div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
