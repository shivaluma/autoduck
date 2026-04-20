'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { PlayerData } from '@/lib/types'
import { BossBadge } from '@/components/boss-badge'
import { ChestIcon } from '@/components/chest-icon'
import { ShieldAgingStack } from '@/components/shield-aging-stack'

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
          .filter((shield) => shield.weeksUnused >= 2)
          .map((shield) => ({
            player,
            shield,
          }))
      )
      .sort((left, right) => right.shield.weeksUnused - left.shield.weeksUnused),
    [players]
  )

  const activeChests = useMemo(
    () => players
      .filter((player) => player.activeChest)
      .map((player) => ({
        player,
        chest: player.activeChest!,
      })),
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
                <p className="font-data text-sm text-[var(--color-ggd-lavender)]">Quack Quack Club V2.0</p>
              </div>
            </div>
          </div>

          <Link href="/race/new" className="animate-slide-right">
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
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5 animate-slide-up opacity-0" style={{ animationDelay: '0.1s' }}>
          {[
            { label: '🦆 BẦY VỊT', value: players.length.toString(), accent: 'text-white' },
            { label: '🏁 SỐ TRẬN', value: totalRaces.toString(), accent: 'text-white' },
            { label: '💀 LÀM DZỊT', value: totalKhaos.toString(), accent: 'text-[var(--color-ggd-gold)]' },
            { label: '👑 DZỊT NHẤT', value: mostKhaos?.name?.replace('Zịt ', '') || '—', accent: 'text-[var(--color-ggd-orange)]' },
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
                  <span className="text-[var(--color-ggd-outline)] text-2xl">🏆 Bảng Xếp Hạng Bầy Vịt</span>
                </div>
                <span className="font-data text-sm text-[var(--color-ggd-outline)]/70 font-black tracking-wider">Boss, Shield Decay, Mystery Chest</span>
              </div>

              <div className="grid grid-cols-[60px_1.4fr_90px_180px_90px_100px] gap-0 px-5 py-3 border-b-[3px] border-black bg-[var(--color-ggd-panel)]">
                {['#', 'VỊT 🦆', 'SẸO', 'KHIÊN', 'ĐÃ DÙNG', 'DZỊT'].map((header, index) => (
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
                            {player.activeChest && <ChestIcon effect={player.activeChest.effect} compact />}
                          </div>
                          <div className="flex flex-wrap items-center gap-2 mt-1">
                            {index === 0 && (
                              <span className="font-display text-sm text-[var(--color-ggd-orange)] glow-orange">👑 CON DZỊT SỐ 1</span>
                            )}
                            {player.cleanStreak > 0 && (
                              <span className={`ggd-tag ${player.cleanStreak >= 3 ? 'bg-[var(--color-ggd-gold)] text-[var(--color-ggd-outline)]' : 'bg-[var(--color-ggd-panel)] text-[var(--color-ggd-neon-green)]'}`}>
                                🔥 {Math.min(player.cleanStreak, 3)}/3 tuần sạch
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
            <div className="ggd-card ggd-stripe">
              <div className="ggd-panel-header bg-[var(--color-ggd-panel)] rounded-t-[7px]">
                <span className="font-display text-xl text-white text-outlined">📜 Lịch Sử</span>
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
                  <div className="text-5xl mb-3 animate-bob">🦆</div>
                  <p className="font-data text-base text-[var(--color-ggd-muted)]">Chưa có trận nào!</p>
                </div>
              )}
            </div>

            <div className="ggd-card-gold ggd-stripe p-6">
              <div className="font-display text-2xl text-[var(--color-ggd-gold)] text-outlined mb-4">👑 Boss Watch</div>
              <div className="space-y-3">
                {bossWatch.length > 0 ? bossWatch.map((entry) => (
                  <div key={entry.id} className="rounded-xl border-3 border-[var(--color-ggd-outline)] bg-black/20 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-body text-white font-black">{entry.name}</span>
                      {entry.isBoss ? <BossBadge compact streak={entry.cleanStreak} /> : <span className="ggd-tag bg-[var(--color-ggd-panel)] text-[var(--color-ggd-neon-green)]">🔥 {entry.cleanStreak}/3</span>}
                    </div>
                    <div className="mt-2 h-3 rounded-full bg-black/30 border-2 border-[var(--color-ggd-outline)] overflow-hidden">
                      <div
                        className={`h-full ${entry.isBoss ? 'bg-[var(--color-ggd-gold)]' : 'bg-[var(--color-ggd-neon-green)]'}`}
                        style={{ width: `${Math.min(entry.cleanStreak, 3) / 3 * 100}%` }}
                      />
                    </div>
                  </div>
                )) : (
                  <div className="font-data text-sm text-[var(--color-ggd-muted)]">Chưa có ai chạm mốc 2/3 tuần sạch.</div>
                )}
              </div>
            </div>

            <div className="ggd-card p-6">
              <div className="font-display text-2xl text-white text-outlined mb-4">⏳ Khiên Sắp Hỏng</div>
              <div className="space-y-3">
                {fragileShields.length > 0 ? fragileShields.slice(0, 6).map(({ player, shield }) => (
                  <div key={shield.id} className="rounded-xl border-3 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] p-3">
                    <div className="font-body text-white font-black">{player.name}</div>
                    <div className="font-data text-xs text-[var(--color-ggd-muted)] mt-1">
                      🛡️#{shield.id} đã để {shield.weeksUnused} tuần
                      {shield.weeksUnused >= 3 ? ' - đang ở vùng nguy hiểm' : ' - còn 1 nhịp nữa sẽ vỡ'}
                    </div>
                  </div>
                )) : (
                  <div className="font-data text-sm text-[var(--color-ggd-muted)]">Chưa có khiên nào ở ngưỡng cảnh báo.</div>
                )}
              </div>
            </div>

            <div className="ggd-card-orange p-6">
              <div className="font-display text-2xl text-white text-outlined mb-4">🎁 Rương Đang Cầm</div>
              <div className="space-y-3">
                {activeChests.length > 0 ? activeChests.map(({ player, chest }) => (
                  <div key={chest.id} className="rounded-xl border-3 border-[var(--color-ggd-outline)] bg-black/20 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-body text-white font-black">{player.name}</span>
                      <ChestIcon effect={chest.effect} />
                    </div>
                    <div className="font-data text-xs text-white/70 mt-1">
                      {['CURSE_SWAP', 'INSURANCE_FRAUD', 'PUBLIC_SHIELD', 'I_CHOOSE_YOU'].includes(chest.effect)
                        ? 'Cần target ở race kế tiếp.'
                        : 'Tự áp dụng khi người chơi tham gia race kế tiếp.'}
                    </div>
                  </div>
                )) : (
                  <div className="font-data text-sm text-white/75">Không ai đang cầm mystery chest active.</div>
                )}
              </div>
            </div>

            <div className="ggd-card p-6">
              <div className="font-display text-2xl text-white text-outlined mb-4">📖 Luật Chơi v2</div>
              <div className="font-data text-sm text-[var(--color-ggd-muted)] space-y-2">
                <div>🤕 2 người cuối = con dzịt (+1 Sẹo)</div>
                <div>🛡️ Dùng Khiên trước trận để thoát kiếp</div>
                <div>✨ 2 Sẹo → 1 Khiên (auto)</div>
                <div>⏳ Khiên 3 tuần không dùng → vỡ thành 1 Sẹo</div>
                <div>💀 Khiên 5 tuần không dùng → mất hẳn</div>
                <div>👑 3 tuần sạch → Boss Duck, race kế spawn 3 clone</div>
                <div>🎁 Bị làm dzịt được mở rương ngay, item phải dùng ở race kế</div>
              </div>
            </div>
          </div>
        </div>

        <footer className="border-t-4 border-[var(--color-ggd-outline)] pt-6 pb-4 flex items-center justify-between animate-fade-in opacity-0" style={{ animationDelay: '0.6s' }}>
          <div className="font-data text-sm text-[var(--color-ggd-muted)]">AUTODUCK v2.0 🦆 Quack Quack!</div>
          <div className="font-data text-sm text-[var(--color-ggd-muted)]">Team Web • Sáng thứ 2 hàng tuần</div>
        </footer>
      </main>
    </div>
  )
}
