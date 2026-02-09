'use client'

import { useEffect, useState, use } from 'react'
import Link from 'next/link'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { RaceStatus } from '@/lib/types'

export default function RaceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const resolvedParams = use(params)
  const raceId = resolvedParams.id
  const [race, setRace] = useState<RaceStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [polling, setPolling] = useState(true)

  useEffect(() => {
    const fetchRace = async () => {
      try {
        const res = await fetch(`/api/races/${raceId}`)
        const data = await res.json()
        setRace(data)
        setLoading(false)
        if (data.status === 'finished' || data.status === 'failed') {
          setPolling(false)
        }
      } catch {
        setLoading(false)
      }
    }
    fetchRace()
    const interval = setInterval(() => {
      if (polling) fetchRace()
    }, 3000)
    return () => clearInterval(interval)
  }, [raceId, polling])

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--color-f1-dark)] flex items-center justify-center">
        <div className="text-center">
          <div className="text-6xl animate-bounce mb-4">🦆</div>
          <div className="font-display text-sm tracking-[0.3em] uppercase text-white/30">Loading Race Data</div>
        </div>
      </div>
    )
  }

  if (!race) {
    return (
      <div className="min-h-screen bg-[var(--color-f1-dark)] flex items-center justify-center">
        <div className="text-center">
          <div className="font-display text-6xl font-black text-[var(--color-f1-red)]/30 mb-4">404</div>
          <p className="font-data text-xs text-white/30 tracking-wider uppercase mb-6">Race not found</p>
          <Link href="/" className="font-display text-xs tracking-[0.15em] uppercase text-[var(--color-f1-red)] hover:text-white transition-colors">
            ← RETURN TO PADDOCK
          </Link>
        </div>
      </div>
    )
  }

  const isRunning = race.status === 'running'
  const isFinished = race.status === 'finished'
  const isFailed = race.status === 'failed'
  const sortedParticipants = [...race.participants].sort((a, b) => (a.initialRank ?? 99) - (b.initialRank ?? 99))
  const hasResults = sortedParticipants.length > 0 && sortedParticipants[0].initialRank !== null

  return (
    <div className="min-h-screen bg-[var(--color-f1-dark)] noise-overlay grid-lines">
      {/* Race Status Bar */}
      <div className={`h-1 ${
        isRunning ? 'bg-green-500 animate-pulse' :
        isFinished ? 'bg-gradient-to-r from-[var(--color-f1-red)] via-[var(--color-f1-gold)] to-[var(--color-f1-red)]' :
        isFailed ? 'bg-[var(--color-f1-red)]' :
        'bg-white/10'
      }`} />

      {/* Header */}
      <header className="border-b border-white/5">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="font-data text-xs tracking-[0.15em] uppercase text-white/30 hover:text-white transition-colors">
            ← PADDOCK
          </Link>
          <div className="flex items-center gap-4 animate-slide-right">
            <div className="font-display text-lg font-bold tracking-[0.15em] uppercase text-white">
              GP <span className="text-[var(--color-f1-red)]">#{raceId}</span>
            </div>
            <div className={`font-data text-[10px] px-3 py-1.5 tracking-[0.15em] uppercase ${
              isFinished ? 'bg-green-500/10 text-green-400' :
              isRunning ? 'bg-[var(--color-f1-gold)]/10 text-[var(--color-f1-gold)] animate-pulse' :
              isFailed ? 'bg-[var(--color-f1-red)]/10 text-[var(--color-f1-red)]' :
              'bg-white/5 text-white/40'
            }`}>
              {race.status === 'pending' ? 'FORMATION LAP' :
               race.status === 'running' ? 'RACE LIVE' :
               race.status === 'finished' ? 'CHEQUERED FLAG' : 'RED FLAG'}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {/* Running State */}
        {isRunning && (
          <div className="relative overflow-hidden bg-[var(--color-f1-surface)] border border-green-500/20 p-8 animate-pulse">
            <div className="flex items-center justify-center gap-6">
              <div className="text-5xl animate-bounce">🦆</div>
              <div className="text-center">
                <div className="font-display text-2xl font-black tracking-[0.2em] uppercase text-green-400">
                  RACE IN PROGRESS
                </div>
                <div className="font-data text-xs text-white/40 tracking-wider uppercase mt-1">
                  Live timing updating automatically
                </div>
              </div>
              <div className="text-5xl animate-bounce" style={{ animationDelay: '0.15s' }}>🦆</div>
            </div>
            <div className="absolute top-0 left-0 w-full h-1 bg-green-500" />
          </div>
        )}

        {/* VERDICT BANNER */}
        {isFinished && race.finalVerdict && (
          <div className="relative overflow-hidden animate-slide-up opacity-0" style={{ animationDelay: '0.1s' }}>
            {/* Background */}
            <div className="absolute inset-0 bg-gradient-to-r from-[var(--color-f1-red)]/20 via-[var(--color-f1-dark)] to-[var(--color-f1-red)]/20" />
            <div className="absolute inset-0 checkered-bg opacity-50" />

            <div className="relative px-8 py-10 text-center">
              {/* Podium decoration */}
              <div className="flex justify-center gap-2 mb-6">
                {[...Array(5)].map((_, i) => (
                  <div
                    key={i}
                    className="w-3 h-3 bg-[var(--color-f1-gold)] rounded-full shadow-[0_0_10px_rgba(255,215,0,0.5)]"
                    style={{ animationDelay: `${i * 0.1}s` }}
                  />
                ))}
              </div>

              <div className="font-display text-[10px] tracking-[0.4em] uppercase text-[var(--color-f1-gold)] mb-3">
                Kết quả chính thức
              </div>
              <h2 className="font-display text-3xl md:text-4xl font-black tracking-wider uppercase text-white leading-tight">
                {race.finalVerdict}
              </h2>
              <div className="font-data text-xs text-white/30 tracking-wider uppercase mt-4">
                Luật Rừng &bull; 2 con dzịt đã lộ diện
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Classification - Left 2 cols */}
          <div className="lg:col-span-2 animate-slide-up opacity-0" style={{ animationDelay: '0.2s' }}>
            <div className="bg-[var(--color-f1-surface)] border border-white/5 overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-3 bg-[var(--color-f1-red)]">
                <span className="font-display text-xs font-bold tracking-[0.2em] uppercase text-white">
                  Official Classification
                </span>
                <span className="font-data text-[10px] text-white/70 tracking-wider uppercase">
                  {sortedParticipants.length} Classified
                </span>
              </div>

              {/* Column Headers */}
              <div className="grid grid-cols-[60px_1fr_120px_140px] gap-0 px-5 py-2 border-b border-white/5 bg-white/[0.02]">
                <div className="font-data text-[10px] tracking-wider uppercase text-white/30">POS</div>
                <div className="font-data text-[10px] tracking-wider uppercase text-white/30">DRIVER</div>
                <div className="font-data text-[10px] tracking-wider uppercase text-white/30 text-center">DEFENSE</div>
                <div className="font-data text-[10px] tracking-wider uppercase text-white/30 text-right">STATUS</div>
              </div>

              {hasResults ? (
                <div>
                  {sortedParticipants.map((p, idx) => (
                    <div
                      key={p.userId}
                      className={`
                        grid grid-cols-[60px_1fr_120px_140px] gap-0 items-center
                        px-5 py-4 border-b border-white/[0.03]
                        timing-row
                        ${p.gotScar ? 'penalty' : p.usedShield ? 'shield-active' : idx < 3 ? 'podium' : ''}
                        animate-slide-right opacity-0
                      `}
                      style={{ animationDelay: `${0.3 + idx * 0.08}s` }}
                    >
                      {/* Position */}
                      <div>
                        <span className={`position-number text-2xl ${
                          p.gotScar ? 'text-[var(--color-f1-red)]' :
                          idx === 0 ? 'text-[var(--color-f1-gold)]' :
                          idx === 1 ? 'text-[var(--color-f1-silver)]' :
                          idx === 2 ? 'text-amber-600' :
                          'text-white/25'
                        }`}>
                          {String((p.initialRank ?? idx + 1)).padStart(2, '0')}
                        </span>
                      </div>

                      {/* Driver */}
                      <div className="flex items-center gap-3">
                        <div className={`w-1 h-10 rounded-full ${
                          p.gotScar ? 'bg-[var(--color-f1-red)]' :
                          p.usedShield ? 'bg-[var(--color-f1-cyan)]' :
                          idx === 0 ? 'bg-[var(--color-f1-gold)]' :
                          'bg-white/10'
                        }`} />
                        <div>
                          <div className="font-body text-sm font-semibold text-white tracking-wide uppercase">
                            {p.name}
                          </div>
                          {idx === 0 && isFinished && (
                            <div className="font-data text-[9px] tracking-[0.15em] text-[var(--color-f1-gold)] uppercase">
                              RACE WINNER
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Shield Status */}
                      <div className="text-center">
                        {p.usedShield ? (
                          <span className="font-data text-[10px] px-3 py-1 bg-[var(--color-f1-cyan)]/10 text-[var(--color-f1-cyan)] tracking-wider uppercase">
                            SHIELD ON
                          </span>
                        ) : (
                          <span className="font-data text-[10px] text-white/15 tracking-wider uppercase">—</span>
                        )}
                      </div>

                      {/* Result Status */}
                      <div className="text-right">
                        {p.gotScar ? (
                          <span className="font-display text-xs font-bold tracking-wider uppercase text-[var(--color-f1-red)]">
                            CON DZỊT 🦆
                          </span>
                        ) : p.usedShield && (p.initialRank ?? 0) >= sortedParticipants.length - 1 ? (
                          <span className="font-display text-xs font-bold tracking-wider uppercase text-[var(--color-f1-cyan)]">
                            SHIELD SAVED
                          </span>
                        ) : idx === 0 ? (
                          <span className="font-display text-xs font-bold tracking-wider uppercase text-[var(--color-f1-gold)]">
                            P1
                          </span>
                        ) : (
                          <span className="font-data text-xs text-white/20 tracking-wider uppercase">
                            CLASSIFIED
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-16 text-center">
                  <div className="text-3xl mb-3 opacity-30">⏳</div>
                  <div className="font-data text-xs text-white/20 tracking-wider uppercase">
                    {isRunning ? 'Awaiting classification...' : 'No results available'}
                  </div>
                </div>
              )}
            </div>

            {/* Video */}
            {race.videoUrl && (
              <div className="mt-6 bg-[var(--color-f1-surface)] border border-white/5 overflow-hidden animate-slide-up opacity-0" style={{ animationDelay: '0.6s' }}>
                <div className="px-5 py-3 border-b border-white/5 bg-white/[0.02]">
                  <span className="font-display text-xs font-bold tracking-[0.15em] uppercase text-white/60">
                    Race Replay
                  </span>
                </div>
                <div className="aspect-video bg-black">
                  <video src={race.videoUrl} controls className="w-full h-full" />
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Race Commentary */}
          <div className="animate-slide-up opacity-0" style={{ animationDelay: '0.35s' }}>
            <div className="bg-[var(--color-f1-surface)] border border-white/5 overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-3 border-b border-white/5 bg-white/[0.02]">
                <div className="flex items-center gap-2">
                  <span className="font-display text-xs font-bold tracking-[0.15em] uppercase text-white/60">
                    Race Director
                  </span>
                  {isRunning && (
                    <span className="font-data text-[10px] px-2 py-0.5 bg-[var(--color-f1-red)] text-white tracking-wider uppercase animate-pulse">
                      LIVE
                    </span>
                  )}
                </div>
              </div>

              <ScrollArea className="h-[520px]">
                {race.commentaries.length > 0 ? (
                  <div className="divide-y divide-white/[0.03]">
                    {race.commentaries.map((c, idx) => (
                      <div
                        key={idx}
                        className="px-5 py-4 hover:bg-white/[0.02] transition-colors animate-slide-right opacity-0"
                        style={{ animationDelay: `${0.4 + idx * 0.05}s` }}
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="font-data text-[10px] px-2 py-0.5 bg-white/5 text-[var(--color-f1-cyan)] tracking-wider">
                            {formatTime(c.timestamp)}
                          </span>
                          <div className="flex-1 h-px bg-white/5" />
                        </div>
                        <p className="font-body text-sm text-white/70 leading-relaxed">
                          {c.content}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="px-5 py-16 text-center">
                    <div className="text-2xl mb-3 opacity-30">🎙️</div>
                    <p className="font-data text-xs text-white/20 tracking-wider uppercase">
                      {isRunning ? 'Awaiting commentary...' : 'No commentary recorded'}
                    </p>
                  </div>
                )}
              </ScrollArea>
            </div>
          </div>
        </div>

        {/* Action Bar */}
        <div className="flex items-center justify-between pt-4 border-t border-white/5 animate-fade-in opacity-0" style={{ animationDelay: '0.7s' }}>
          <Link href="/" className="font-display text-xs font-bold tracking-[0.15em] uppercase text-white/30 hover:text-white transition-colors px-4 py-3">
            ← PADDOCK
          </Link>
          {isFinished && (
            <Link href="/race/new">
              <button className="group relative overflow-hidden bg-[var(--color-f1-red)] hover:bg-[#ff1a1a] text-white font-display font-bold text-xs tracking-[0.15em] uppercase px-8 py-3 transition-all duration-300 diagonal-cut">
                <span className="relative z-10">NEXT RACE →</span>
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
              </button>
            </Link>
          )}
        </div>
      </main>
    </div>
  )
}
