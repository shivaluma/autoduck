'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { PlayerData } from '@/lib/types'
import Image from 'next/image'
import { BossBadge } from '@/components/boss-badge'
import { ShieldAgingStack } from '@/components/shield-aging-stack'
import { MYSTERY_CHESTS_ENABLED } from '@/lib/feature-flags'

export default function Dashboard() {
  const [players, setPlayers] = useState<PlayerData[]>([])
  const [loading, setLoading] = useState(true)
  const [races, setRaces] = useState<{ id: number; status: string; finalVerdict: string | null; createdAt: string; isTest?: boolean }[]>([])
  const [showTestRaces, setShowTestRaces] = useState(false)

  useEffect(() => {
    Promise.all([
      fetch('/api/users').then((response) => response.json()),
      fetch('/api/races').then((response) => response.json()),
    ])
      .then(([usersData, racesData]) => {
        setPlayers(usersData)
        setRaces(racesData)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const displayedRaces = showTestRaces ? races : races.filter((race) => !race.isTest)
  const totalRaces = displayedRaces.length
  const totalKhaos = players.reduce((sum, player) => sum + player.totalKhaos, 0)
  const sortedPlayers = [...players].sort((left, right) => right.totalKhaos - left.totalKhaos)
  const mostKhaos = sortedPlayers[0] ?? null

  const bossWatch = useMemo(
    () => players
      .filter((player) => player.cleanStreak >= 2 || player.isBoss)
      .sort((left, right) => right.cleanStreak - left.cleanStreak),
    [players]
  )

  const fragileShields = useMemo(
    () => players
      .flatMap((player) =>
        player.activeShields
          .filter((shield) => shield.charges <= 2)
          .map((shield) => ({
            player,
            shield,
          }))
      )
      .sort((left, right) => left.shield.charges - right.shield.charges),
    [players]
  )

  return (
    <div className="min-h-screen bg-transparent bubble-bg">
      <div className="neon-divider" />

      <header className="relative border-b-4 border-[var(--color-ggd-outline)]">
        <div className="max-w-7xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-5 animate-slide-left">
            <div className="duck-mascot">🦆</div>
            <div>
              <h1 className="font-display text-4xl text-white text-outlined">
                AUTO<span className="text-[var(--color-ggd-neon-green)]">DUCK</span>
              </h1>
              <div className="flex items-center gap-2 mt-1">
                <div className="w-3 h-3 bg-[var(--color-ggd-neon-green)] rounded-full animate-pulse shadow-[0_0_8px_rgba(61,255,143,0.6)]" />
                <p className="font-data text-sm text-[var(--color-ggd-lavender)]">🦆 QUACK QUACK CLUB v2.0</p>
              </div>
              <p className="font-readable text-sm text-white/60 mt-1">Nơi định mệnh sáng thứ 2 được quyết định bằng vịt</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3 animate-slide-right">
            <a href="#race-history">
              <button
                className="font-display text-base tracking-widest uppercase px-5 py-3
                  border-[5px] border-[var(--color-ggd-outline)] rounded-xl cursor-pointer
                  transition-all duration-100
                  bg-[var(--color-ggd-surface)] text-white
                  shadow-[inset_0_3px_0_rgba(255,255,255,0.12),0_6px_0_var(--color-ggd-outline),0_12px_24px_rgba(0,0,0,0.45)]
                  hover:-translate-y-1 hover:text-[var(--color-ggd-gold)]
                  active:translate-y-[4px] active:shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_2px_0_var(--color-ggd-outline)]"
              >
                Lịch Sử Thảm Họa
              </button>
            </a>
            <Link href="/rules">
              <button
                className="font-display text-lg tracking-widest uppercase px-6 py-3
                  border-[5px] border-[var(--color-ggd-outline)] rounded-xl cursor-pointer
                  transition-all duration-100
                  bg-[var(--color-ggd-gold)] text-[var(--color-ggd-outline)]
                  shadow-[inset_0_3px_0_rgba(255,255,255,0.35),0_6px_0_#7a6000,0_12px_24px_rgba(0,0,0,0.45)]
                  hover:-translate-y-1 hover:shadow-[inset_0_3px_0_rgba(255,255,255,0.35),0_8px_0_#7a6000,0_16px_30px_rgba(255,204,0,0.28)]
                  active:translate-y-[4px] active:shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_2px_0_#7a6000]"
              >
                Xem Luật
              </button>
            </Link>
            <Link href="/race/new">
              <button
                className="font-display text-2xl tracking-widest uppercase px-12 py-4
                  border-[5px] border-[var(--color-ggd-outline)] rounded-xl cursor-pointer
                  transition-all duration-100
                  bg-[var(--color-ggd-neon-green)] text-[var(--color-ggd-outline)]
                  shadow-[inset_0_3px_0_rgba(255,255,255,0.45),0_7px_0_#007a3a,0_12px_28px_rgba(61,255,143,0.35)]
                  hover:-translate-y-1 hover:shadow-[inset_0_3px_0_rgba(255,255,255,0.45),0_9px_0_#007a3a,0_16px_32px_rgba(61,255,143,0.45)]
                  active:translate-y-[5px] active:shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_2px_0_#007a3a]"
              >
                <span className="flex items-center gap-3">
                  <span className="text-2xl" style={{ animation: 'wiggle-duck 1s ease-in-out infinite' }}>🦆</span>
                  Chạy Đua!
                </span>
              </button>
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5 animate-slide-up opacity-0" style={{ animationDelay: '0.1s' }}>
          {[
            { label: '🐥 Tổng Vịt', value: players.length.toString(), accent: 'text-white' },
            { label: '🏁 Tổng Race', value: totalRaces.toString(), accent: 'text-white' },
            { label: '💀 Tổng Lần Làm Dzịt', value: totalKhaos.toString(), accent: 'text-[var(--color-ggd-gold)]' },
            { label: '👑 Vịt Thống Trị', value: mostKhaos?.name?.replace('Zịt ', '') || '—', accent: 'text-[var(--color-ggd-orange)]' },
          ].map((stat, index) => (
            <div
              key={stat.label}
              className="bg-[var(--color-ggd-surface)] border-5 border-[var(--color-ggd-outline)] rounded-2xl p-5 text-center
                shadow-[inset_0_3px_0_rgba(255,255,255,0.1),0_8px_0_var(--color-ggd-outline),0_16px_30px_rgba(0,0,0,0.7)]
                animate-bounce-in opacity-0 ggd-stripe"
              style={{
                animationDelay: `${0.15 + index * 0.08}s`,
                transform: `rotate(${index % 2 === 0 ? '-1' : '1'}deg)`,
              }}
            >
              <div className="font-data text-xs text-[var(--color-ggd-lavender)] mb-2 uppercase tracking-widest font-black">{stat.label}</div>
              <div className={`font-display text-5xl ${stat.accent} text-outlined`}>{stat.value}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 animate-slide-up opacity-0" style={{ animationDelay: '0.2s' }}>
            <div className="ggd-card-green ggd-stripe">
              <div className="ggd-panel-header bg-[var(--color-ggd-neon-green)]">
                <div className="skew-header">
                  <span className="text-[var(--color-ggd-outline)] text-2xl">🏆 BXH Sinh Tồn Bầy Vịt</span>
                </div>
                <span className="font-data text-sm text-[var(--color-ggd-outline)]/70 font-black tracking-wider">Sẹo càng nhiều chưa chắc càng yếu.</span>
              </div>

              <div className="grid grid-cols-[60px_1.4fr_90px_180px_90px_100px] gap-0 px-5 py-3 border-b-[3px] border-black bg-[var(--color-ggd-panel)]">
                {['#', '🐥 Vịt', '🩹 Sẹo', '🛡 Khiên', '🔥 Đã Xài', '💀 Số Lần Dzịt'].map((header, index) => (
                  <div key={header} className={`ggd-col-header ${index >= 2 && index <= 4 ? 'text-center' : index === 5 ? 'text-right' : ''}`}>{header}</div>
                ))}
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-20">
                  <div className="text-6xl animate-bob">🦆</div>
                </div>
              ) : (
                <div className="py-1">
                  {sortedPlayers.map((player, index) => (
                    <div
                      key={player.id}
                      className={`grid grid-cols-[60px_1.4fr_90px_180px_90px_100px] gap-0 items-center px-5 py-4 duck-row
                        ${index === 0 ? 'loser' : ''}
                        animate-slide-right opacity-0`}
                      style={{ animationDelay: `${0.3 + index * 0.06}s` }}
                    >
                      <div>
                        <span
                          className={`position-number text-4xl ${index === 0 ? 'text-[var(--color-ggd-orange)] glow-orange' :
                            index === 1 ? 'text-[var(--color-ggd-gold)] glow-gold' :
                              index === 2 ? 'text-[var(--color-ggd-neon-green)] glow-green' :
                                'text-[var(--color-ggd-muted)]'
                            }`}
                        >
                          {String(index + 1).padStart(2, '0')}
                        </span>
                      </div>

                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-2.5 h-16 rounded-full ${index === 0 ? 'bg-[var(--color-ggd-orange)] shadow-[0_0_10px_rgba(255,87,51,0.6)]' :
                          index === 1 ? 'bg-[var(--color-ggd-gold)] shadow-[0_0_10px_rgba(255,204,0,0.6)]' :
                            index === 2 ? 'bg-[var(--color-ggd-neon-green)] shadow-[0_0_10px_rgba(61,255,143,0.6)]' :
                              'bg-[var(--color-ggd-muted)]/30'
                          }`} />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="font-body text-lg font-black text-white tracking-wide truncate">{player.name}</div>
                            {player.isImmortal && <span className="ggd-tag bg-[var(--color-ggd-sky)] text-[var(--color-ggd-outline)]">♾️ Immortal</span>}
                            {player.isBoss && <BossBadge compact streak={player.cleanStreak} />}
                            {MYSTERY_CHESTS_ENABLED && player.activeChest && (
                              <span className="ggd-tag bg-[var(--color-ggd-orange)] text-white">🎁 Chest</span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-2 mt-1">
                            {index === 0 && (
                              <span className="font-display text-sm text-[var(--color-ggd-orange)] glow-orange">👑 CON DZỊT SỐ 1</span>
                            )}
                            {player.cleanStreak > 0 && (
                              <span className={`ggd-tag ${player.cleanStreak >= 3 ? 'bg-[var(--color-ggd-gold)] text-[var(--color-ggd-outline)]' : 'bg-[var(--color-ggd-panel)] text-[var(--color-ggd-neon-green)]'}`}>
                                🔥 {player.cleanStreak}/3 tuần sạch
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="text-center">
                        <span className={`font-data text-2xl font-black ${player.scars > 0 ? 'text-[var(--color-ggd-orange)]' : 'text-[var(--color-ggd-muted)]/20'}`}>
                          {player.scars}
                        </span>
                      </div>

                      <ShieldAgingStack shields={player.activeShields} legacyCount={player.shields} />

                      <div className="text-center">
                        <span className="font-data text-2xl font-black text-[var(--color-ggd-muted)]/50">{player.shieldsUsed}</span>
                      </div>

                      <div className="text-right">
                        <span className="font-display text-4xl text-white text-outlined">{player.totalKhaos}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="animate-slide-up opacity-0 space-y-5" style={{ animationDelay: '0.35s' }}>
            <div id="race-history" className="ggd-card ggd-stripe scroll-mt-6">
              <div className="ggd-panel-header bg-[var(--color-ggd-panel)] rounded-t-[7px]">
                <span className="font-display text-xl text-white text-outlined">📜 Lịch Sử Thảm Họa</span>
                <label className="flex items-center gap-2 cursor-pointer group">
                  <div className="relative">
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={showTestRaces}
                      onChange={(event) => setShowTestRaces(event.target.checked)}
                    />
                    <div className={`w-11 h-6 rounded-full transition-colors border-2 border-[var(--color-ggd-outline)] ${showTestRaces ? 'bg-[var(--color-ggd-neon-green)]' : 'bg-[var(--color-ggd-muted)]/30'}`} />
                    <div className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white border-2 border-[var(--color-ggd-outline)] transition-transform shadow ${showTestRaces ? 'translate-x-5' : 'translate-x-0'}`} />
                  </div>
                  <span className="font-data text-xs font-black text-[var(--color-ggd-muted)] group-hover:text-white transition-colors uppercase tracking-wider">Test</span>
                </label>
              </div>

              {displayedRaces.length > 0 ? (
                <div className="py-1">
                  {displayedRaces.slice(0, 8).map((race, index) => (
                    <Link
                      key={race.id}
                      href={`/race/${race.id}`}
                      className="block mx-2 my-1.5 px-4 py-3.5 rounded-xl hover:bg-[var(--color-ggd-neon-green)]/8 transition-all hover:translate-x-2 animate-slide-right opacity-0 border-b-2 border-black/20"
                      style={{ animationDelay: `${0.4 + index * 0.05}s` }}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-display text-lg text-white flex items-center gap-2">
                          Trận #{race.id}
                          {race.isTest && (
                            <span className="ggd-tag bg-[var(--color-ggd-sky)] text-[var(--color-ggd-outline)] text-[10px]">TEST</span>
                          )}
                        </span>
                        <span className={`ggd-tag text-[11px] font-black ${race.status === 'finished' ? 'bg-[var(--color-ggd-neon-green)] text-[var(--color-ggd-outline)]' :
                          race.status === 'running' ? 'bg-[var(--color-ggd-gold)] text-[var(--color-ggd-outline)]' :
                            race.status === 'failed' ? 'bg-[var(--color-ggd-orange)] text-white' :
                              'bg-[var(--color-ggd-muted)]/30 text-[var(--color-ggd-muted)]'
                          }`}>
                          {race.status === 'finished' ? '✅' : race.status === 'running' ? '🏃' : race.status === 'failed' ? '💥' : '⏳'} {race.status}
                        </span>
                      </div>
                      {race.finalVerdict && <p className="font-readable text-sm text-[var(--color-ggd-lavender)] truncate">{race.finalVerdict}</p>}
                      <p className="font-data text-xs text-[var(--color-ggd-muted)]/60 mt-1 font-bold">
                        {new Date(race.createdAt).toLocaleDateString('vi-VN', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="px-5 py-12 text-center">
                  <div className="text-5xl mb-3 animate-bob">💤</div>
                  <p className="font-display text-xl text-white text-outlined">Chưa có race nào.</p>
                  <p className="font-readable text-sm text-[var(--color-ggd-muted)] mt-2">Bầy vịt vẫn đang ngủ.</p>
                  <p className="font-readable text-sm text-[var(--color-ggd-muted)]">Hãy bắt đầu tuần mới bằng hỗn loạn.</p>
                </div>
              )}
            </div>

            <div className="ggd-card-gold ggd-stripe p-6">
              <div className="flex items-center gap-3 mb-4">
                <Image src="/assets/v2/boss-crown.svg" alt="boss" width={32} height={32} className="animate-bob" unoptimized />
                <div>
                  <div className="font-display text-xl text-[var(--color-ggd-gold)] text-outlined leading-none">👑 Boss Watch</div>
                  <div className="font-data text-[10px] uppercase tracking-widest text-white/50">3 tuần sạch mở Boss Mode.</div>
                </div>
              </div>
              <p className="font-readable text-sm text-white/70 mb-4">Càng sống lâu càng bị spawn thêm clone để săn.</p>
              <div className="space-y-2.5">
                {bossWatch.length > 0 ? bossWatch.map((entry) => {
                  const streak = entry.cleanStreak
                  const pct = Math.min((Math.min(streak, 3) / 3) * 100, 100)
                  return (
                    <div key={entry.id} className="stat-row">
                      <div className="stat-row-icon" style={{ background: entry.isBoss ? 'linear-gradient(180deg, #ffd84d 0%, #f59e0b 100%)' : 'rgba(0,0,0,0.4)' }}>
                        {entry.isBoss
                          ? <Image src="/assets/v2/boss-crown.svg" alt="boss" width={24} height={24} unoptimized />
                          : <Image src="/assets/v2/streak-flame.svg" alt="flame" width={22} height={22} unoptimized />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <span className="font-body text-white font-black truncate">{entry.name}</span>
                          {entry.isBoss
                            ? <BossBadge compact streak={entry.cleanStreak} />
                            : <span className="font-data text-[11px] font-black text-[var(--color-ggd-gold)]">{streak}/3</span>}
                        </div>
                        <div className="progress-track">
                          <div className="progress-fill" style={{ width: `${pct}%`, '--bar-bg': entry.isBoss ? 'linear-gradient(90deg,#ffd84d,#f59e0b)' : 'linear-gradient(90deg,#3dff8f,#ffcc00)' } as React.CSSProperties} />
                        </div>
                      </div>
                    </div>
                  )
                }) : (
                  <div className="font-data text-sm text-[var(--color-ggd-muted)] italic">Chưa ai đủ trình thành Boss.</div>
                )}
              </div>
            </div>

            <div className="ggd-card p-6">
              <div className="flex items-center gap-3 mb-4">
                <Image src="/assets/v2/shield-cracked.svg" alt="shield" width={32} height={32} className="animate-bob" unoptimized />
                <div>
                  <div className="font-display text-xl text-white text-outlined leading-none">🛡 Khiên Sắp Hỏng</div>
                  <div className="font-data text-[10px] uppercase tracking-widest text-white/50">Khiên sống theo charge: 3 → 2 → 1 → vỡ</div>
                </div>
              </div>
              <div className="space-y-2.5">
                {fragileShields.length > 0 ? fragileShields.slice(0, 6).map(({ player, shield }) => {
                  const danger = shield.charges <= 1
                  const pct = ((3 - shield.charges) / 3) * 100
                  return (
                    <div key={shield.id} className="stat-row">
                      <div className="stat-row-icon">
                        <Image
                          src={danger ? '/assets/v2/shield-broken.svg' : '/assets/v2/shield-cracked.svg'}
                          alt="shield" width={26} height={26} unoptimized
                          className={danger ? 'animate-pulse' : ''}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <span className="font-body text-white font-black truncate">
                            {player.name} <span className="text-white/50 font-data text-[11px]">#{shield.id}</span>
                          </span>
                          <span className={`font-data text-[11px] font-black ${danger ? 'text-[var(--color-ggd-orange)]' : 'text-[var(--color-ggd-gold)]'}`}>
                            {shield.charges}c {danger ? '⚠️' : ''}
                          </span>
                        </div>
                        <div className="progress-track">
                          <div className="progress-fill" style={{ width: `${pct}%`, '--bar-bg': danger ? 'linear-gradient(90deg,#ff5733,#ff8a00)' : 'linear-gradient(90deg,#ffcc00,#ff8a00)' } as React.CSSProperties} />
                        </div>
                      </div>
                    </div>
                  )
                }) : (
                  <div className="font-data text-sm text-[var(--color-ggd-muted)] italic">Chưa có khiên nào sắp nổ.</div>
                )}
              </div>
            </div>

            <div className="ggd-card p-6">
              <div className="font-display text-2xl text-white text-outlined mb-4">📖 Luật Chơi v2</div>
              <div className="space-y-3">
                {[
                  { icon: '💀', title: 'Thua Cuộc', lines: ['2 vịt cuối bảng = Làm Dzịt', 'Bao nước, nhận +1 Sẹo'] },
                  { icon: '🛡', title: 'Khiên', lines: ['2 Sẹo = auto ghép 1 Khiên', 'Declare trước race để kích hoạt', 'Cứu 1 lần rồi biến mất'] },
                  { icon: '⏳', title: 'Shield Decay', lines: ['Không dùng sau race sẽ -1 charge', '0 charge = vỡ'] },
                  { icon: '👑', title: 'Boss Duck', lines: ['3 tuần liên tiếp không Dzịt = Boss', 'Boss spawn nhiều clone hơn mỗi tuần', 'Clone chết = Boss chết'] },
                  { icon: '🎁', title: 'Reward Chest', lines: ['Hạ Boss sẽ nhận chest', 'Streak càng cao, loot càng ngon'] },
                ].map((rule) => (
                  <div key={rule.title} className="rounded-xl border-2 border-[var(--color-ggd-outline)]/35 bg-black/20 p-3">
                    <div className="font-display text-lg text-white text-outlined">{rule.icon} {rule.title}</div>
                    <div className="font-data text-xs text-[var(--color-ggd-muted)] space-y-1 mt-2">
                      {rule.lines.map((line) => <div key={line}>• {line}</div>)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <footer className="border-t-4 border-[var(--color-ggd-outline)] pt-6 pb-4 flex items-center justify-between animate-fade-in opacity-0" style={{ animationDelay: '0.6s' }}>
          <div className="font-data text-sm text-[var(--color-ggd-muted)]">AUTODUCK v2.0 🦆 Quack Quack!</div>
          <div className="font-data text-sm text-[var(--color-ggd-muted)] text-right">
            Built for Team Web. Phá hủy tình đồng nghiệp từ mỗi sáng thứ 2.
          </div>
        </footer>
      </main>
    </div>
  )
}
