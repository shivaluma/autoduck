'use client'

import { useEffect, useState, use } from 'react'
import Link from 'next/link'
import { ScrollArea } from '@/components/ui/scroll-area'
import { RaceLiveView } from './race-live-view'
import { RaceCelebration } from '@/components/race-celebration'
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
        if (data.status === 'finished' || data.status === 'failed') setPolling(false)
      } catch { setLoading(false) }
    }
    fetchRace()
    const interval = setInterval(() => { if (polling) fetchRace() }, 3000)
    return () => clearInterval(interval)
  }, [raceId, polling])

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-transparent flex items-center justify-center">
        <div className="text-center">
          <div className="text-7xl animate-bob mb-4">🦆</div>
          <div className="font-display text-2xl text-[var(--color-ggd-lavender)] text-outlined">Đang tải...</div>
        </div>
      </div>
    )
  }

  if (!race) {
    return (
      <div className="min-h-screen bg-transparent flex items-center justify-center">
        <div className="text-center">
          <div className="font-display text-8xl text-[var(--color-ggd-orange)] text-outlined mb-4">404</div>
          <p className="font-data text-lg text-[var(--color-ggd-muted)] mb-6">Không tìm thấy trận đua 🦆</p>
          <Link href="/" className="font-display text-lg text-[var(--color-ggd-neon-green)] hover:text-white transition-colors">← Về Chuồng</Link>
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
    <div className="min-h-screen bg-transparent bubble-bg">
      <div className={`h-2 ${isRunning ? 'bg-[var(--color-ggd-neon-green)] animate-pulse shadow-[0_0_15px_rgba(61,255,143,0.5)]' :
        isFinished ? 'neon-divider' : isFailed ? 'bg-[var(--color-ggd-orange)]' : 'bg-[var(--color-ggd-muted)]/20'}`} />

      <header className="border-b-4 border-[var(--color-ggd-outline)]">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="font-data text-sm text-[var(--color-ggd-muted)] hover:text-white transition-colors">← Về Chuồng</Link>
          <div className="flex items-center gap-4 animate-slide-right">
            <div className="font-display text-2xl text-white text-outlined">
              🦆 Trận <span className="text-[var(--color-ggd-neon-green)]">#{raceId}</span>
            </div>
            <div className={`ggd-tag ${isFinished ? 'bg-[var(--color-ggd-neon-green)] text-[var(--color-ggd-outline)]' :
              isRunning ? 'bg-[var(--color-ggd-gold)] text-[var(--color-ggd-outline)] animate-pulse' :
                isFailed ? 'bg-[var(--color-ggd-orange)] text-white' : 'bg-[var(--color-ggd-muted)]/30 text-[var(--color-ggd-muted)]'}`}>
              {race.status === 'pending' ? '⏳ Chờ...' : race.status === 'running' ? '🏃 ĐANG CHẠY!' :
                race.status === 'finished' ? '🏁 KẾT THÚC!' : '💥 LỖI'}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {isRunning && (
          <div className="space-y-6">
            <div className="ggd-card-green p-8 ggd-stripe">
              <div className="flex items-center justify-center gap-6">
                <div className="text-5xl animate-bob">🦆</div>
                <div className="text-center">
                  <div className="font-display text-4xl text-[var(--color-ggd-neon-green)] text-outlined">ĐANG ĐUA! 🏃💨</div>
                  <div className="font-data text-sm text-[var(--color-ggd-muted)] mt-1">Phát trực tiếp...</div>
                </div>
                <div className="text-5xl animate-bob" style={{ animationDelay: '0.3s' }}>🦆</div>
              </div>
            </div>
            <div className="animate-slide-up"><RaceLiveView raceId={parseInt(raceId)} /></div>
          </div>
        )}

        {isFinished && (
          <>
            <RaceCelebration
              allPlayers={sortedParticipants.map(p => ({ name: p.name, avatarUrl: p.avatarUrl, gotScar: p.gotScar, usedShield: p.usedShield, initialRank: p.initialRank }))}
              victims={sortedParticipants.filter(p => p.gotScar).map(p => ({ name: p.name, avatarUrl: p.avatarUrl }))}
              verdict={race.finalVerdict} duration={6000}
            />
            {race.finalVerdict && (
              <div className="ggd-card-gold ggd-stripe animate-slide-up opacity-0" style={{ animationDelay: '0.1s' }}>
                <div className="relative px-8 py-10 text-center">
                  <div className="flex justify-center gap-3 mb-6">
                    {['🎉', '🦆', '🏆', '🦆', '🎉'].map((emoji, i) => (
                      <div key={i} className="text-3xl animate-bob" style={{ animationDelay: `${i * 0.15}s` }}>{emoji}</div>
                    ))}
                  </div>
                  <div className="font-display text-lg text-[var(--color-ggd-gold)] glow-gold mb-3">✨ Kết Quả Chính Thức ✨</div>
                  <h2 className="font-display text-4xl md:text-5xl text-white leading-tight text-outlined">{race.finalVerdict}</h2>
                  <div className="font-data text-base text-[var(--color-ggd-muted)] mt-4">🦆 2 con dzịt đã lộ diện! Quack!</div>
                </div>
              </div>
            )}
          </>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className={`${isRunning ? 'lg:col-span-3' : 'lg:col-span-2'} animate-slide-up opacity-0`} style={{ animationDelay: '0.2s' }}>
            <div className="ggd-card-green ggd-stripe">
              <div className="bg-[var(--color-ggd-neon-green)] px-5 py-3 rounded-t-[6px] flex items-center justify-between">
                <span className="font-display text-lg text-[var(--color-ggd-outline)]">🏆 Bảng Xếp Hạng</span>
                <span className="font-data text-sm text-[var(--color-ggd-outline)]/70">{sortedParticipants.length} vịt</span>
              </div>

              <div className="grid grid-cols-[60px_1fr_120px_140px] gap-0 px-5 py-3 border-b-3 border-[var(--color-ggd-outline)]/30 bg-[var(--color-ggd-panel)]">
                <div className="font-data text-xs uppercase text-[var(--color-ggd-muted)]">#</div>
                <div className="font-data text-xs uppercase text-[var(--color-ggd-muted)]">VỊT 🦆</div>
                <div className="font-data text-xs uppercase text-[var(--color-ggd-muted)] text-center">PHÒNG THỦ</div>
                <div className="font-data text-xs uppercase text-[var(--color-ggd-muted)] text-right">KẾT QUẢ</div>
              </div>

              {hasResults ? (
                <div className="py-1">
                  {sortedParticipants.map((p, idx) => (
                    <div
                      key={p.userId}
                      className={`grid grid-cols-[60px_1fr_120px_140px] gap-0 items-center px-5 py-4 duck-row
                        ${p.gotScar ? 'loser' : p.usedShield ? 'shielded' : idx < 3 ? 'winner' : ''}
                        animate-slide-right opacity-0`}
                      style={{ animationDelay: `${0.3 + idx * 0.08}s` }}
                    >
                      <div>
                        <span className={`position-number text-3xl ${p.gotScar ? 'text-[var(--color-ggd-orange)] glow-orange' :
                          idx === 0 ? 'text-[var(--color-ggd-gold)] glow-gold' : idx === 1 ? 'text-white/70' :
                            idx === 2 ? 'text-[var(--color-ggd-neon-green)]' : 'text-[var(--color-ggd-muted)]/35'}`}>
                          {String((p.initialRank ?? idx + 1)).padStart(2, '0')}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className={`w-2 h-10 rounded-full ${p.gotScar ? 'bg-[var(--color-ggd-orange)]' : p.usedShield ? 'bg-[var(--color-ggd-sky)]' :
                          idx === 0 ? 'bg-[var(--color-ggd-gold)]' : 'bg-[var(--color-ggd-muted)]/20'}`} />
                        <div>
                          <div className="font-body text-base font-extrabold text-white">{p.name}</div>
                          {idx === 0 && isFinished && <div className="font-display text-sm text-[var(--color-ggd-gold)] glow-gold">👑 VỊT THẮNG CUỘC</div>}
                        </div>
                      </div>
                      <div className="text-center">
                        {p.usedShield ? (
                          <span className="ggd-tag bg-[var(--color-ggd-sky)] text-[var(--color-ggd-outline)] text-xs">🛡️ Có Khiên</span>
                        ) : (<span className="font-data text-lg text-[var(--color-ggd-muted)]/20">—</span>)}
                      </div>
                      <div className="text-right">
                        {p.gotScar ? (
                          <span className="font-display text-lg text-[var(--color-ggd-orange)] glow-orange">CON DZỊT 🦆</span>
                        ) : p.usedShield && (p.initialRank ?? 0) >= sortedParticipants.length - 1 ? (
                          <span className="font-display text-lg text-[var(--color-ggd-sky)]">🛡️ Thoát!</span>
                        ) : idx === 0 ? (
                          <span className="font-display text-lg text-[var(--color-ggd-gold)]">🏆 P1</span>
                        ) : (<span className="font-data text-sm text-[var(--color-ggd-muted)]/40">An Toàn ✨</span>)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-16 text-center">
                  <div className="text-5xl mb-3 animate-bob">🥚</div>
                  <div className="font-data text-base text-[var(--color-ggd-muted)]">{isRunning ? 'Đang đua... 🏃' : 'Chưa có kết quả'}</div>
                </div>
              )}
            </div>

            {race.videoUrl && (
              <div className="mt-6 ggd-card animate-slide-up opacity-0" style={{ animationDelay: '0.6s' }}>
                <div className="px-5 py-3 bg-[var(--color-ggd-panel)] rounded-t-[6px]">
                  <span className="font-display text-lg text-white text-outlined">🎬 Xem Lại</span>
                </div>
                <div className="aspect-video bg-black rounded-b-[18px]">
                  <video src={race.videoUrl} controls className="w-full h-full rounded-b-[18px]" />
                </div>
              </div>
            )}
          </div>

          {!isRunning && (
            <div className="animate-slide-up opacity-0" style={{ animationDelay: '0.35s' }}>
              <div className="ggd-card ggd-stripe">
                <div className="px-5 py-3 bg-[var(--color-ggd-panel)] rounded-t-[6px] flex items-center justify-between">
                  <span className="font-display text-lg text-white text-outlined">🎤 MC Vịt</span>
                  {isRunning && <span className="ggd-tag bg-[var(--color-ggd-orange)] text-white text-xs animate-pulse">LIVE</span>}
                </div>
                <ScrollArea className="h-[520px]">
                  {race.commentaries.length > 0 ? (
                    <div className="py-2">
                      {race.commentaries.map((c, idx) => (
                        <div key={idx} className="px-4 py-3 mx-2 my-1 rounded-xl hover:bg-[var(--color-ggd-neon-green)]/5 transition-colors animate-slide-right opacity-0"
                          style={{ animationDelay: `${0.4 + idx * 0.05}s` }}>
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className="ggd-tag bg-[var(--color-ggd-neon-green)] text-[var(--color-ggd-outline)] text-[10px] py-0.5">⏱️ {formatTime(c.timestamp)}</span>
                            <div className="flex-1 h-px bg-[var(--color-ggd-outline)]/30" />
                          </div>
                          <p className="font-readable text-base text-white/90 leading-relaxed">{c.content}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="px-5 py-16 text-center">
                      <div className="text-4xl mb-3 animate-bob">🎤</div>
                      <p className="font-data text-base text-[var(--color-ggd-muted)]">{isRunning ? 'MC Vịt đang chuẩn bị...' : 'Chưa có bình luận'}</p>
                    </div>
                  )}
                </ScrollArea>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between pt-4 border-t-4 border-[var(--color-ggd-outline)] animate-fade-in opacity-0" style={{ animationDelay: '0.7s' }}>
          <Link href="/" className="font-display text-lg text-[var(--color-ggd-muted)] hover:text-white transition-colors px-4 py-3">← Về Chuồng</Link>
          {isFinished && (
            <Link href="/race/new">
              <button className="ggd-btn bg-[var(--color-ggd-orange)] text-white text-lg px-10 py-3">Trận Tiếp → 🦆</button>
            </Link>
          )}
        </div>
      </main>
    </div>
  )
}
