'use client'

import { useEffect, useState, use } from 'react'
import Link from 'next/link'
import { ScrollArea } from '@/components/ui/scroll-area'
import { RaceLiveView } from './race-live-view'
import { RaceCelebration } from '@/components/race-celebration'
import type { RaceStatus } from '@/lib/types'
import Image from 'next/image'
import { ChestCard } from '@/components/chest-card'
import { ChestReveal } from '@/components/chest-reveal'
import { MYSTERY_CHESTS_ENABLED } from '@/lib/feature-flags'

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
  const consumedChestByOwnerId = new Map(MYSTERY_CHESTS_ENABLED ? (race.consumedChests ?? []).map((chest) => [chest.ownerId, chest]) : [])
  const awardedChestByOwnerId = new Map(MYSTERY_CHESTS_ENABLED ? (race.awardedChests ?? []).map((chest) => [chest.ownerId, chest]) : [])
  const resultGridClass = MYSTERY_CHESTS_ENABLED
    ? 'grid-cols-[56px_minmax(0,1.35fr)_132px_110px_minmax(0,1.15fr)]'
    : 'grid-cols-[56px_minmax(0,1.35fr)_132px_110px]'
  const bossFalls = Array.from(
    new Set(
      sortedParticipants
        .filter((participant) => participant.isClone && participant.gotScar && typeof participant.cloneOfUserId === 'number')
        .map((participant) => sortedParticipants.find((candidate) => candidate.userId === participant.cloneOfUserId && !candidate.isClone)?.name)
        .filter((name): name is string => Boolean(name))
    )
  )
  const victims = sortedParticipants.filter((participant) => participant.gotScar)
  const winner = sortedParticipants.find((participant) => participant.initialRank === 1)
  const thomasWinner = winner?.name.toLowerCase() === 'thomas'
  const bossOwnerIds = Array.from(new Set(sortedParticipants.filter((participant) => participant.isClone && typeof participant.cloneOfUserId === 'number').map((participant) => participant.cloneOfUserId as number)))
  const bossNames = bossOwnerIds
    .map((bossOwnerId) => sortedParticipants.find((participant) => participant.userId === bossOwnerId && !participant.isClone)?.name)
    .filter((name): name is string => Boolean(name))
  const activeModifiers = Array.from(new Set((race.consumedChests ?? []).map((chest) => chest.effect.replaceAll('_', ' '))))
  const cleanDuckName = (name: string) => name.replace(/^Zịt\s+/i, '')
  const heroHeadline = (() => {
    if (victims.length >= 4) return '☠️ THẢM HỌA TẬP THỂ'
    if (bossFalls.length > 0) return '👑 TRIỀU ĐẠI ĐÃ SỤP ĐỔ'
    if (thomasWinner) return '🦆 Thomas vừa làm điều không ai tin nổi'
    if (victims.length > 0) {
      const names = victims.map((victim) => cleanDuckName(victim.displayName ?? victim.name))
      const renderedNames = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} và ${names.at(-1)}`
      return `💀 ${renderedNames} đã ngã xuống.`
    }
    return '🏁 Race đã chốt sổ.'
  })()
  const heroSubline = (() => {
    if (bossFalls.length > 0) return `${bossFalls.map(cleanDuckName).join(', ')} mất ngôi Boss ngay trong race này.`
    if (victims.length >= 4) return `${victims.length} con dzịt cùng rơi khỏi vùng an toàn.`
    return race.finalVerdict ?? 'Kết quả chính thức đã được ghi nhận.'
  })()
  const getParticipantStatus = (participant: typeof sortedParticipants[number], index: number) => {
    if (participant.gotScar && participant.isClone && typeof participant.cloneOfUserId === 'number') return 'Boss Down'
    if (participant.gotScar) return 'Dzịt'
    if (index === 0) return 'Winner'
    return 'Safe'
  }
  const shortCommentary = (content: string) => {
    const sentences = content
      .replace(/\s+/g, ' ')
      .split(/(?<=[.!?。！？])\s+/)
      .filter(Boolean)
    const shortText = sentences.slice(0, 2).join(' ') || content
    return shortText.length > 150 ? `${shortText.slice(0, 147)}...` : shortText
  }

  return (
    <div className="min-h-screen bg-transparent bubble-bg">
      <div className={`h-2 ${isRunning ? 'bg-[var(--color-ggd-neon-green)] animate-pulse shadow-[0_0_15px_rgba(61,255,143,0.5)]' :
        isFinished ? 'neon-divider' : isFailed ? 'bg-[var(--color-ggd-orange)]' : 'bg-[var(--color-ggd-muted)]/20'}`} />

      <header className="border-b-4 border-[var(--color-ggd-outline)]">
        <div className="max-w-7xl mx-auto px-4 py-4 flex flex-col gap-3 sm:px-6 sm:flex-row sm:items-center sm:justify-between">
          <Link href="/" className="font-data text-sm text-[var(--color-ggd-muted)] hover:text-white transition-colors">← Về Chuồng</Link>
          <div className="flex flex-wrap items-center gap-3 sm:gap-4 animate-slide-right">
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

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6 sm:px-6 sm:py-8">
        {isRunning && (
          <div className="space-y-6">
            <div className="ggd-card-green p-5 ggd-stripe sm:p-8">
              <div className="flex items-center justify-center gap-3 sm:gap-6">
                <div className="hidden text-5xl animate-bob sm:block">🦆</div>
                <div className="text-center">
                  <div className="font-display text-3xl text-[var(--color-ggd-neon-green)] text-outlined sm:text-4xl">ĐANG ĐUA! 🏃💨</div>
                  <div className="font-data text-sm text-[var(--color-ggd-muted)] mt-1">Phát trực tiếp...</div>
                </div>
                <div className="hidden text-5xl animate-bob sm:block" style={{ animationDelay: '0.3s' }}>🦆</div>
              </div>
            </div>
            <div className="animate-slide-up"><RaceLiveView raceId={parseInt(raceId)} /></div>
          </div>
        )}

        {isFinished && (
          <>
            <RaceCelebration
              allPlayers={sortedParticipants.map(p => ({ name: p.displayName ?? p.name, avatarUrl: p.avatarUrl, gotScar: p.gotScar, usedShield: p.usedShield, initialRank: p.initialRank }))}
              victims={victims.map(p => ({ name: p.displayName ?? p.name, avatarUrl: p.avatarUrl }))}
              verdict={race.finalVerdict} duration={3000}
              bossFalls={bossFalls}
              consumedChests={MYSTERY_CHESTS_ENABLED ? race.consumedChests : []}
              awardedChests={MYSTERY_CHESTS_ENABLED ? race.awardedChests : []}
              raceId={Number(raceId)}
            />
            {race.finalVerdict && (
              <div className={`ggd-card-gold ggd-stripe animate-slide-up opacity-0 overflow-hidden ${bossFalls.length > 0 ? 'shadow-[0_0_35px_rgba(255,204,0,0.35),0_8px_0_var(--color-ggd-outline)]' : victims.length >= 4 ? 'shadow-[0_0_42px_rgba(255,87,51,0.45),0_8px_0_var(--color-ggd-outline)]' : ''}`} style={{ animationDelay: '0.1s' }}>
                <div className="relative px-4 py-7 text-center sm:px-8 sm:py-9">
                  <div className="flex justify-center gap-3 mb-6">
                    {(victims.length >= 4 ? ['🚨', '💀', '☠️', '💀', '🚨'] : bossFalls.length > 0 ? ['👑', '💔', '⚡', '💔', '👑'] : ['🎉', '🦆', '🏆', '🦆', '🎉']).map((emoji, i) => (
                      <div key={i} className="text-3xl animate-bob" style={{ animationDelay: `${i * 0.15}s` }}>{emoji}</div>
                    ))}
                  </div>
                  <div className="font-display text-lg text-[var(--color-ggd-gold)] glow-gold mb-3">✨ Kết Quả Chính Thức ✨</div>
                  <h2 className="font-display text-4xl text-white leading-tight text-outlined md:text-6xl">{heroHeadline}</h2>
                  <p className="mx-auto mt-4 max-w-3xl font-readable text-lg text-white/88 leading-relaxed md:text-xl">{heroSubline}</p>
                  <div className="mt-6 flex flex-wrap justify-center gap-2">
                    <span className="ggd-tag bg-[var(--color-ggd-neon-green)] text-[var(--color-ggd-outline)]">{sortedParticipants.length} vịt</span>
                    <span className="ggd-tag bg-[var(--color-ggd-orange)] text-white">{victims.length} losers</span>
                    <span className="ggd-tag bg-[var(--color-ggd-panel)] text-white">Boss: {bossNames.length > 0 ? bossNames.map(cleanDuckName).join(', ') : 'Không'}</span>
                    {activeModifiers.slice(0, 2).map((modifier) => (
                      <span key={modifier} className="ggd-tag bg-[var(--color-ggd-hot-pink)] text-white">{modifier}</span>
                    ))}
                    {race.awardedChests?.some((chest) => chest.effect === 'GOLDEN_SHIELD') && (
                      <span className="ggd-tag bg-[var(--color-ggd-sky)] text-[var(--color-ggd-outline)]">🛡 Legendary defense</span>
                    )}
                    {race.awardedChests?.some((chest) => chest.effect !== 'NOTHING') && (
                      <span className="ggd-tag bg-[var(--color-ggd-gold)] text-[var(--color-ggd-outline)]">✨ Chest dropped</span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className={`${isRunning ? 'lg:col-span-3' : 'lg:col-span-2'} animate-slide-up opacity-0`} style={{ animationDelay: '0.2s' }}>
            <div className="ggd-card-green ggd-stripe overflow-x-auto">
              <div className="bg-[var(--color-ggd-neon-green)] px-5 py-3 rounded-t-[6px] flex items-center justify-between">
                <span className="font-display text-lg text-[var(--color-ggd-outline)]">🏆 Bảng Xếp Hạng</span>
                <span className="font-data text-sm text-[var(--color-ggd-outline)]/70">{sortedParticipants.length} vịt</span>
              </div>

              <div className={`grid ${resultGridClass} min-w-[920px] gap-2 px-5 py-3 border-b-[3px] border-[var(--color-ggd-outline)]/40 bg-[var(--color-ggd-panel)]`}>
                <div className="ggd-col-header">Rank</div>
                <div className="ggd-col-header">VỊT 🦆</div>
                <div className="ggd-col-header">Status</div>
                <div className="ggd-col-header text-center">KHIÊN</div>
                {MYSTERY_CHESTS_ENABLED && <div className="ggd-col-header">Loot / Chest</div>}
              </div>

              {hasResults ? (
                <div className="py-1">
                  {sortedParticipants.map((p, idx) => {
                    const consumedChest = !p.isClone ? consumedChestByOwnerId.get(p.userId) : undefined
                    const awardedChest = p.gotScar && !p.isClone ? awardedChestByOwnerId.get(p.userId) : undefined

                    const totalSlots = sortedParticipants.length
                    const status = getParticipantStatus(p, idx)
                    const rowBadges = [
                      p.isClone ? 'Clone' : null,
                      p.isImmortal ? 'Immortal' : null,
                      p.chestEffect ? p.chestEffect.replaceAll('_', ' ') : null,
                    ].filter((badge): badge is string => Boolean(badge)).slice(0, 2)
                    return (
                    <div
                      key={`${p.userId}-${p.cloneIndex ?? 0}-${p.initialRank ?? idx}`}
                      className={`grid ${resultGridClass} min-w-[920px] gap-2 items-center px-5 py-3.5 duck-row
                        ${p.gotScar ? 'loser' : p.usedShield ? 'shielded' : idx < 3 ? 'winner' : ''}
                        animate-slide-right opacity-0`}
                      style={{ animationDelay: `${0.3 + idx * 0.08}s` }}
                    >
                      <div className="flex items-center justify-center relative">
                        <span className={`position-number text-3xl ${p.gotScar ? 'text-[var(--color-ggd-orange)] glow-orange' :
                          idx === 0 ? 'text-[var(--color-ggd-gold)] glow-gold' : idx === 1 ? 'text-white/80' :
                            idx === 2 ? 'text-[var(--color-ggd-neon-green)] glow-green' : 'text-[var(--color-ggd-muted)]/40'}`}>
                          {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : String((p.initialRank ?? idx + 1)).padStart(2, '0')}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-2 h-12 rounded-full flex-shrink-0 ${p.gotScar ? 'bg-[var(--color-ggd-orange)] shadow-[0_0_8px_rgba(255,87,51,0.6)]' : p.usedShield ? 'bg-[var(--color-ggd-sky)] shadow-[0_0_8px_rgba(61,200,255,0.5)]' :
                          idx === 0 ? 'bg-[var(--color-ggd-gold)] shadow-[0_0_8px_rgba(255,204,0,0.5)]' : 'bg-[var(--color-ggd-muted)]/20'}`} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="font-body text-base font-extrabold text-white truncate">
                              {p.displayName ?? p.name}
                            </div>
                            {rowBadges.map((badge) => (
                              <span key={badge} className="ggd-tag bg-[var(--color-ggd-panel)] text-white/75 text-[10px] px-2 py-0">{badge}</span>
                            ))}
                          </div>
                          {idx === 0 && isFinished && <div className="font-display text-xs text-[var(--color-ggd-gold)] glow-gold mt-0.5">👑 VỊT THẮNG CUỘC</div>}
                        </div>
                      </div>
                      <div>
                        {status === 'Dzịt' ? (
                          <span className="font-display text-xl text-[var(--color-ggd-orange)] glow-orange">💀 Dzịt</span>
                        ) : status === 'Boss Down' ? (
                          <span className="font-display text-base text-[var(--color-ggd-gold)] glow-gold">👑 Boss Down</span>
                        ) : status === 'Winner' ? (
                          <span className="font-display text-xl text-[var(--color-ggd-gold)] glow-gold">Winner</span>
                        ) : p.usedShield && (p.initialRank ?? 0) >= totalSlots - 1 ? (
                          <span className="font-display text-base text-[var(--color-ggd-sky)] glow-sky">🛡 Thoát</span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 font-data text-[11px] uppercase tracking-wider text-white/68 font-black">
                            <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-ggd-neon-green)]/75" /> Safe
                          </span>
                        )}
                      </div>
                      <div className="flex justify-center">
                        {p.usedShield ? (
                          <span className="shield-chip shield-tier-fresh">
                            <Image src="/assets/v2/shield-cracked.svg" alt="shield" width={18} height={18} className="shield-chip-icon" unoptimized />
                            <span>USED</span>
                          </span>
                        ) : (<span className="empty-cell">—</span>)}
                      </div>
                      {MYSTERY_CHESTS_ENABLED && (
                        <div className="min-w-0">
                          {consumedChest || awardedChest ? (
                            <div className="flex flex-col gap-2 min-w-0">
                              {consumedChest && (
                                <>
                              <ChestCard effect={consumedChest.effect} size="sm" opened animated={false} />
                              <div className="font-data text-[10px] text-[var(--color-ggd-muted)] truncate flex items-center gap-1">
                                <span className={consumedChest.outcome === 'success' ? 'text-[var(--color-ggd-neon-green)]' : 'text-[var(--color-ggd-orange)]'}>
                                  {consumedChest.outcome === 'success' ? '✓ HIT' : '✗ FIZZLED'}
                                </span>
                                {consumedChest.targetName && <span className="opacity-70">→ {consumedChest.targetName}</span>}
                              </div>
                                </>
                              )}
                              {awardedChest && (
                                <ChestReveal
                                  chestId={awardedChest.id}
                                  effect={awardedChest.effect}
                                  compact
                                  animated
                                />
                              )}
                            </div>
                          ) : (<span className="empty-cell">—</span>)}
                        </div>
                      )}
                    </div>
                  )})}
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
            <div className="animate-slide-up opacity-0 lg:sticky lg:top-4 lg:self-start" style={{ animationDelay: '0.35s' }}>
              <div className="ggd-card ggd-stripe overflow-hidden">
                <div className="px-5 py-3 bg-[var(--color-ggd-panel)] rounded-t-[6px] flex items-center justify-between">
                  <span className="font-display text-lg text-white text-outlined">🎤 MC Vịt</span>
                  <span className="ggd-tag bg-[var(--color-ggd-neon-green)] text-[var(--color-ggd-outline)] text-xs">TIMELINE</span>
                </div>
                <ScrollArea className="h-[360px] sm:h-[520px]">
                  {race.commentaries.length > 0 ? (
                    <div className="relative py-3 pl-5 pr-3">
                      <div className="absolute left-[31px] top-5 bottom-5 w-0.5 bg-gradient-to-b from-[var(--color-ggd-neon-green)] via-[var(--color-ggd-gold)] to-[var(--color-ggd-orange)]/70" />
                      {race.commentaries.map((c, idx) => (
                        <div key={idx} className="relative ml-7 mb-3 rounded-xl border-2 border-[var(--color-ggd-outline)]/35 bg-black/30 px-4 py-3 shadow-[0_4px_0_rgba(0,0,0,0.55)] transition-colors hover:bg-[var(--color-ggd-neon-green)]/8 animate-slide-right opacity-0"
                          style={{ animationDelay: `${0.4 + idx * 0.05}s` }}>
                          <div className="absolute -left-[38px] top-4 h-4 w-4 rounded-full border-2 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-gold)] shadow-[0_0_12px_rgba(255,204,0,0.55)]" />
                          <div className="flex items-center gap-2 mb-2">
                            <span className="font-data text-xs font-black text-[var(--color-ggd-neon-green)]">{formatTime(c.timestamp)}</span>
                            <div className="h-px flex-1 bg-white/12" />
                          </div>
                          <p className="font-readable text-base text-white/92 leading-snug">{shortCommentary(c.content)}</p>
                        </div>
                      ))}
                      {victims.map((victim, index) => (
                        <div key={`victim-${victim.userId}-${victim.cloneIndex ?? index}`} className="relative ml-7 mb-3 rounded-xl border-2 border-[var(--color-ggd-orange)]/70 bg-[rgba(255,87,51,0.18)] px-4 py-3 shadow-[0_4px_0_rgba(0,0,0,0.65)] animate-slide-right opacity-0"
                          style={{ animationDelay: `${0.45 + (race.commentaries.length + index) * 0.05}s` }}>
                          <div className="absolute -left-[38px] top-4 h-4 w-4 rounded-full border-2 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-orange)] shadow-[0_0_14px_rgba(255,87,51,0.65)]" />
                          <div className="font-data text-xs font-black text-[var(--color-ggd-orange)]">FINAL</div>
                          <p className="mt-1 font-display text-lg text-white text-outlined">☠️ {cleanDuckName(victim.displayName ?? victim.name)} bị loại.</p>
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

        <div className="flex flex-col gap-3 pt-4 border-t-4 border-[var(--color-ggd-outline)] animate-fade-in opacity-0 sm:flex-row sm:items-center sm:justify-between" style={{ animationDelay: '0.7s' }}>
          <Link href="/" className="font-display text-lg text-[var(--color-ggd-muted)] hover:text-white transition-colors px-4 py-3 text-center sm:text-left">← Về Chuồng</Link>
          {isFinished && (
            <Link href="/race/new" className="w-full sm:w-auto">
              <button className="ggd-btn w-full bg-[var(--color-ggd-orange)] text-white text-lg px-10 py-3 sm:w-auto">Trận Tiếp → 🦆</button>
            </Link>
          )}
        </div>
      </main>
    </div>
  )
}
