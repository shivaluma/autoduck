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
      <div className="min-h-screen bg-[var(--color-ggd-deep)] bubble-bg flex items-center justify-center">
        <div className="text-center">
          <div className="text-6xl animate-bob mb-4">🦆</div>
          <div className="font-display text-xl text-[var(--color-ggd-lavender)]">Đang tải dữ liệu...</div>
        </div>
      </div>
    )
  }

  if (!race) {
    return (
      <div className="min-h-screen bg-[var(--color-ggd-deep)] bubble-bg flex items-center justify-center">
        <div className="text-center">
          <div className="font-display text-7xl text-[var(--color-ggd-orange)]/40 mb-4">404</div>
          <p className="font-data text-sm text-[var(--color-ggd-lavender)] mb-6">Không tìm thấy trận đua 🦆</p>
          <Link href="/" className="font-display text-base text-[var(--color-ggd-mint)] hover:text-[var(--color-ggd-cream)] transition-colors">
            ← Về Chuồng
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
    <div className="min-h-screen bg-[var(--color-ggd-deep)] bubble-bg">
      {/* Status Bar */}
      <div className={`h-1.5 rounded-b-full ${isRunning ? 'bg-[var(--color-ggd-mint)] animate-pulse' :
        isFinished ? 'cute-divider' :
          isFailed ? 'bg-[var(--color-ggd-orange)]' :
            'bg-[var(--color-ggd-lavender)]/20'
        }`} />

      {/* Header */}
      <header className="border-b-2 border-[var(--color-ggd-mint)]/20">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="font-data text-sm text-[var(--color-ggd-lavender)] hover:text-[var(--color-ggd-cream)] transition-colors">
            ← Về Chuồng
          </Link>
          <div className="flex items-center gap-4 animate-slide-right">
            <div className="font-display text-2xl text-[var(--color-ggd-cream)]">
              🦆 Trận <span className="text-[var(--color-ggd-mint)]">#{raceId}</span>
            </div>
            <div className={`cute-tag ${isFinished ? 'bg-[var(--color-ggd-mint)]/15 text-[var(--color-ggd-mint)]' :
              isRunning ? 'bg-[var(--color-ggd-gold)]/15 text-[var(--color-ggd-gold)] animate-pulse' :
                isFailed ? 'bg-[var(--color-ggd-orange)]/15 text-[var(--color-ggd-orange)]' :
                  'bg-[var(--color-ggd-lavender)]/10 text-[var(--color-ggd-lavender)]'
              }`}>
              {race.status === 'pending' ? '⏳ Đang xếp hàng...' :
                race.status === 'running' ? '🏃 ĐANG CHẠY!' :
                  race.status === 'finished' ? '🏁 KẾT THÚC!' : '💥 LỖI'}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {/* Running State & Live Stream */}
        {isRunning && (
          <div className="space-y-6">
            <div className="relative overflow-hidden cartoon-card border-[var(--color-ggd-mint)] p-8">
              <div className="flex items-center justify-center gap-6">
                <div className="text-5xl animate-bob">🦆</div>
                <div className="text-center">
                  <div className="font-display text-3xl text-[var(--color-ggd-mint)]">
                    ĐANG ĐUA! 🏃💨
                  </div>
                  <div className="font-data text-sm text-[var(--color-ggd-lavender)] mt-1">
                    Đang phát trực tiếp...
                  </div>
                </div>
                <div className="text-5xl animate-bob" style={{ animationDelay: '0.3s' }}>🦆</div>
              </div>
            </div>

            {/* LIVE STREAM & COMMENTARY VIEW */}
            <div className="animate-slide-up">
              <RaceLiveView raceId={parseInt(raceId)} />
            </div>
          </div>
        )}

        {/* VERDICT BANNER (only if finished) */}
        {isFinished && (
          <>
            <RaceCelebration
              winner={sortedParticipants[0] ? { name: sortedParticipants[0].name, avatarUrl: sortedParticipants[0].avatarUrl } : null}
              victims={sortedParticipants.filter(p => p.gotScar).map(p => ({ name: p.name, avatarUrl: p.avatarUrl }))}
              verdict={race.finalVerdict}
              duration={4000}
            />

            {race.finalVerdict && (
              <div className="relative overflow-hidden cartoon-card-gold animate-slide-up opacity-0" style={{ animationDelay: '0.1s' }}>
                <div className="relative px-8 py-10 text-center">
                  {/* Celebration emojis */}
                  <div className="flex justify-center gap-3 mb-6">
                    {['🎉', '🦆', '🏆', '🦆', '🎉'].map((emoji, i) => (
                      <div
                        key={i}
                        className="text-2xl animate-bob"
                        style={{ animationDelay: `${i * 0.15}s` }}
                      >
                        {emoji}
                      </div>
                    ))}
                  </div>

                  <div className="font-display text-base text-[var(--color-ggd-gold)] glow-gold mb-3">
                    ✨ Kết Quả Chính Thức ✨
                  </div>
                  <h2 className="font-display text-4xl md:text-5xl text-[var(--color-ggd-cream)] leading-tight">
                    {race.finalVerdict}
                  </h2>
                  <div className="font-data text-sm text-[var(--color-ggd-lavender)] mt-4">
                    🦆 2 con dzịt đã lộ diện! Quack quack!
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Classification */}
          <div className={`${isRunning ? 'lg:col-span-3' : 'lg:col-span-2'} animate-slide-up opacity-0`} style={{ animationDelay: '0.2s' }}>
            <div className="cartoon-card overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-3 bg-[var(--color-ggd-mint)] rounded-t-[17px]">
                <span className="font-display text-lg text-[var(--color-ggd-deep)]">
                  🏆 Bảng Xếp Hạng
                </span>
                <span className="font-data text-sm text-[var(--color-ggd-deep)]/70">
                  {sortedParticipants.length} vịt tham gia
                </span>
              </div>

              {/* Column Headers */}
              <div className="grid grid-cols-[60px_1fr_120px_140px] gap-0 px-5 py-2.5 border-b-2 border-[var(--color-ggd-mint)]/10 bg-[var(--color-ggd-surface-2)]/30">
                <div className="font-data text-xs tracking-wide text-[var(--color-ggd-lavender)]">#</div>
                <div className="font-data text-xs tracking-wide text-[var(--color-ggd-lavender)]">VỊT 🦆</div>
                <div className="font-data text-xs tracking-wide text-[var(--color-ggd-lavender)] text-center">PHÒNG THỦ</div>
                <div className="font-data text-xs tracking-wide text-[var(--color-ggd-lavender)] text-right">KẾT QUẢ</div>
              </div>

              {hasResults ? (
                <div>
                  {sortedParticipants.map((p, idx) => (
                    <div
                      key={p.userId}
                      className={`
                        grid grid-cols-[60px_1fr_120px_140px] gap-0 items-center
                        px-5 py-4 border-b border-[var(--color-ggd-mint)]/8
                        duck-row
                        ${p.gotScar ? 'loser' : p.usedShield ? 'shielded' : idx < 3 ? 'winner' : ''}
                        animate-slide-right opacity-0
                      `}
                      style={{ animationDelay: `${0.3 + idx * 0.08}s` }}
                    >
                      {/* Position */}
                      <div>
                        <span className={`position-number text-2xl ${p.gotScar ? 'text-[var(--color-ggd-orange)] glow-orange' :
                          idx === 0 ? 'text-[var(--color-ggd-gold)] glow-gold' :
                            idx === 1 ? 'text-[var(--color-ggd-cream)]/70' :
                              idx === 2 ? 'text-[var(--color-ggd-mint)]' :
                                'text-[var(--color-ggd-lavender)]/35'
                          }`}>
                          {String((p.initialRank ?? idx + 1)).padStart(2, '0')}
                        </span>
                      </div>

                      {/* Name */}
                      <div className="flex items-center gap-3">
                        <div className={`w-1.5 h-10 rounded-full ${p.gotScar ? 'bg-[var(--color-ggd-orange)]' :
                          p.usedShield ? 'bg-[var(--color-ggd-sky)]' :
                            idx === 0 ? 'bg-[var(--color-ggd-gold)]' :
                              'bg-[var(--color-ggd-lavender)]/20'
                          }`} />
                        <div>
                          <div className="font-body text-sm font-bold text-[var(--color-ggd-cream)] tracking-wide">
                            {p.name}
                          </div>
                          {idx === 0 && isFinished && (
                            <div className="font-data text-xs text-[var(--color-ggd-gold)] glow-gold mt-0.5">
                              👑 VỊT THẮNG CUỘC
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Shield Status */}
                      <div className="text-center">
                        {p.usedShield ? (
                          <span className="cute-tag bg-[var(--color-ggd-sky)]/15 text-[var(--color-ggd-sky)]">
                            🛡️ Có Khiên
                          </span>
                        ) : (
                          <span className="font-data text-sm text-[var(--color-ggd-lavender)]/25">—</span>
                        )}
                      </div>

                      {/* Result Status */}
                      <div className="text-right">
                        {p.gotScar ? (
                          <span className="font-display text-base text-[var(--color-ggd-orange)] glow-orange">
                            CON DZỊT 🦆
                          </span>
                        ) : p.usedShield && (p.initialRank ?? 0) >= sortedParticipants.length - 1 ? (
                          <span className="font-display text-base text-[var(--color-ggd-sky)]">
                            🛡️ Thoát Nạn!
                          </span>
                        ) : idx === 0 ? (
                          <span className="font-display text-base text-[var(--color-ggd-gold)]">
                            🏆 P1
                          </span>
                        ) : (
                          <span className="font-data text-sm text-[var(--color-ggd-lavender)]/40">
                            An Toàn ✨
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-16 text-center">
                  <div className="text-4xl mb-3 animate-bob">🥚</div>
                  <div className="font-data text-sm text-[var(--color-ggd-lavender)]/50">
                    {isRunning ? 'Đang đua... chờ kết quả! 🏃' : 'Chưa có kết quả'}
                  </div>
                </div>
              )}
            </div>

            {/* Video */}
            {race.videoUrl && (
              <div className="mt-6 cartoon-card overflow-hidden animate-slide-up opacity-0" style={{ animationDelay: '0.6s' }}>
                <div className="px-5 py-3 border-b-2 border-[var(--color-ggd-mint)]/10 bg-[var(--color-ggd-surface-2)]/30 rounded-t-[17px]">
                  <span className="font-display text-base text-[var(--color-ggd-cream)]">
                    🎬 Xem Lại Trận Đua
                  </span>
                </div>
                <div className="aspect-video bg-black rounded-b-[17px]">
                  <video src={race.videoUrl} controls className="w-full h-full rounded-b-[17px]" />
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Commentary */}
          {!isRunning && (
            <div className="animate-slide-up opacity-0" style={{ animationDelay: '0.35s' }}>
              <div className="cartoon-card overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-3 border-b-2 border-[var(--color-ggd-mint)]/10 bg-[var(--color-ggd-surface-2)]/30 rounded-t-[17px]">
                  <div className="flex items-center gap-2">
                    <span className="font-display text-base text-[var(--color-ggd-cream)]">
                      🎤 MC Vịt
                    </span>
                    {isRunning && (
                      <span className="cute-tag bg-[var(--color-ggd-orange)]/20 text-[var(--color-ggd-orange)] animate-pulse">
                        LIVE
                      </span>
                    )}
                  </div>
                </div>

                <ScrollArea className="h-[520px]">
                  {race.commentaries.length > 0 ? (
                    <div className="divide-y divide-[var(--color-ggd-mint)]/8">
                      {race.commentaries.map((c, idx) => (
                        <div
                          key={idx}
                          className="px-5 py-4 hover:bg-[var(--color-ggd-mint)]/5 transition-colors animate-slide-right opacity-0"
                          style={{ animationDelay: `${0.4 + idx * 0.05}s` }}
                        >
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className="cute-tag bg-[var(--color-ggd-mint)]/10 text-[var(--color-ggd-mint)]">
                              ⏱️ {formatTime(c.timestamp)}
                            </span>
                            <div className="flex-1 h-px bg-[var(--color-ggd-mint)]/8" />
                          </div>
                          <p className="font-readable text-sm text-[var(--color-ggd-cream)]/85 leading-relaxed">
                            {c.content}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="px-5 py-16 text-center">
                      <div className="text-3xl mb-3 animate-bob">🎤</div>
                      <p className="font-data text-sm text-[var(--color-ggd-lavender)]/50">
                        {isRunning ? 'MC Vịt đang chuẩn bị... 🦆' : 'Chưa có bình luận'}
                      </p>
                    </div>
                  )}
                </ScrollArea>
              </div>
            </div>
          )}
        </div>

        {/* Action Bar */}
        <div className="flex items-center justify-between pt-4 border-t-2 border-[var(--color-ggd-mint)]/10 animate-fade-in opacity-0" style={{ animationDelay: '0.7s' }}>
          <Link href="/" className="font-display text-base text-[var(--color-ggd-lavender)]/50 hover:text-[var(--color-ggd-cream)] transition-colors px-4 py-3">
            ← Về Chuồng
          </Link>
          {isFinished && (
            <Link href="/race/new">
              <button className="puffy-btn bg-[var(--color-ggd-orange)] hover:bg-[#ff7f5e] text-white text-base px-8 py-3">
                Trận Tiếp → 🦆
              </button>
            </Link>
          )}
        </div>
      </main>
    </div>
  )
}
