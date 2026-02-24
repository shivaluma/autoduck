'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { PlayerData } from '@/lib/types'

export default function Dashboard() {
  const [players, setPlayers] = useState<PlayerData[]>([])
  const [loading, setLoading] = useState(true)
  const [races, setRaces] = useState<{ id: number; status: string; finalVerdict: string | null; createdAt: string; isTest?: boolean }[]>([])
  const [showTestRaces, setShowTestRaces] = useState(false)

  useEffect(() => {
    Promise.all([
      fetch('/api/users').then((r) => r.json()),
      fetch('/api/races').then((r) => r.json()),
    ]).then(([usersData, racesData]) => {
      setPlayers(usersData)
      setRaces(racesData)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const displayedRaces = showTestRaces ? races : races.filter(r => !r.isTest)
  const totalRaces = displayedRaces.length
  const totalKhaos = players.reduce((sum, p) => sum + p.totalKhaos, 0)
  const sortedPlayers = [...players].sort((a, b) => b.totalKhaos - a.totalKhaos)
  const mostKhaos = sortedPlayers[0] ?? null

  return (
    <div className="min-h-screen bg-transparent bubble-bg">
      {/* Top neon bar */}
      <div className="neon-divider" />

      {/* Header */}
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
                <p className="font-data text-sm text-[var(--color-ggd-lavender)]">
                  Quack Quack Club 🦆
                </p>
              </div>
            </div>
          </div>

          <Link href="/race/new" className="animate-slide-right">
            <button className="ggd-btn bg-[var(--color-ggd-orange)] text-white text-xl px-10 py-4 tracking-wider">
              <span className="flex items-center gap-3">
                <span className="text-2xl" style={{ animation: 'wiggle-duck 1s ease-in-out infinite' }}>🦆</span>
                Chạy Đua!
              </span>
            </button>
          </Link>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* Stats Strip — tilted cards */}
        <div className="grid grid-cols-4 gap-5 animate-slide-up opacity-0" style={{ animationDelay: '0.1s' }}>
          {[
            { label: '🦆 BẦY VỊT', value: players.length.toString(), bg: 'bg-[var(--color-ggd-surface)]', accent: 'text-white' },
            { label: '🏁 SỐ TRẬN', value: totalRaces.toString(), bg: 'bg-[var(--color-ggd-surface)]', accent: 'text-white' },
            { label: '💀 LÀM DZỊT', value: totalKhaos.toString(), bg: 'bg-[var(--color-ggd-surface)]', accent: 'text-[var(--color-ggd-gold)]' },
            { label: '👑 DZỊT NHẤT', value: mostKhaos?.name?.replace('Zịt ', '') || '—', bg: 'bg-[var(--color-ggd-surface)]', accent: 'text-[var(--color-ggd-orange)]' },
          ].map((stat, i) => (
            <div
              key={stat.label}
              className={`${stat.bg} border-4 border-[var(--color-ggd-outline)] rounded-2xl p-4 text-center
                shadow-[inset_0_2px_0_rgba(255,255,255,0.08),0_5px_0_var(--color-ggd-outline)]
                animate-bounce-in opacity-0 ggd-stripe`}
              style={{
                animationDelay: `${0.15 + i * 0.08}s`,
                transform: `rotate(${i % 2 === 0 ? '-1' : '1'}deg)`,
              }}
            >
              <div className="font-data text-xs text-[var(--color-ggd-lavender)] mb-1 uppercase tracking-wider">
                {stat.label}
              </div>
              <div className={`font-display text-4xl ${stat.accent} text-outlined`}>
                {stat.value}
              </div>
            </div>
          ))}
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Standings - Left 2 Columns */}
          <div className="lg:col-span-2 animate-slide-up opacity-0" style={{ animationDelay: '0.2s' }}>
            <div className="ggd-card-green ggd-stripe">
              {/* Header — skewed */}
              <div className="bg-[var(--color-ggd-neon-green)] px-5 py-3 rounded-t-[6px] flex items-center justify-between">
                <div className="skew-header">
                  <span className="font-display text-xl text-[var(--color-ggd-outline)]">
                    🏆 Bảng Xếp Hạng Bầy Vịt
                  </span>
                </div>
                <span className="font-data text-sm text-[var(--color-ggd-outline)]/70 font-bold">
                  2 Sẹo = 1 Khiên
                </span>
              </div>

              {/* Column Headers */}
              <div className="grid grid-cols-[60px_1fr_80px_80px_80px_100px] gap-0 px-5 py-3 border-b-3 border-[var(--color-ggd-outline)]/30 bg-[var(--color-ggd-panel)]">
                <div className="font-data text-xs uppercase text-[var(--color-ggd-muted)]">#</div>
                <div className="font-data text-xs uppercase text-[var(--color-ggd-muted)]">VỊT 🦆</div>
                <div className="font-data text-xs uppercase text-[var(--color-ggd-muted)] text-center">SẸO</div>
                <div className="font-data text-xs uppercase text-[var(--color-ggd-muted)] text-center">KHIÊN</div>
                <div className="font-data text-xs uppercase text-[var(--color-ggd-muted)] text-center">ĐÃ DÙNG</div>
                <div className="font-data text-xs uppercase text-[var(--color-ggd-muted)] text-right">DZỊT</div>
              </div>

              {/* Player Rows */}
              {loading ? (
                <div className="flex items-center justify-center py-20">
                  <div className="text-6xl animate-bob">🦆</div>
                </div>
              ) : (
                <div className="py-1">
                  {sortedPlayers.map((player, idx) => (
                    <div
                      key={player.id}
                      className={`
                        grid grid-cols-[60px_1fr_80px_80px_80px_100px] gap-0 items-center
                        px-5 py-3 duck-row
                        ${idx === 0 ? 'loser' : ''}
                        animate-slide-right opacity-0
                      `}
                      style={{ animationDelay: `${0.3 + idx * 0.06}s` }}
                    >
                      {/* Position */}
                      <div>
                        <span className={`position-number text-3xl ${idx === 0 ? 'text-[var(--color-ggd-orange)] glow-orange' :
                          idx === 1 ? 'text-[var(--color-ggd-gold)] glow-gold' :
                            idx === 2 ? 'text-[var(--color-ggd-neon-green)] glow-green' :
                              'text-[var(--color-ggd-muted)]'
                          }`}>
                          {String(idx + 1).padStart(2, '0')}
                        </span>
                      </div>

                      {/* Name */}
                      <div className="flex items-center gap-3">
                        <div className={`w-2 h-9 rounded-full ${idx === 0 ? 'bg-[var(--color-ggd-orange)] shadow-[0_0_8px_rgba(255,87,51,0.5)]' :
                          idx === 1 ? 'bg-[var(--color-ggd-gold)] shadow-[0_0_8px_rgba(255,204,0,0.5)]' :
                            idx === 2 ? 'bg-[var(--color-ggd-neon-green)] shadow-[0_0_8px_rgba(61,255,143,0.5)]' :
                              'bg-[var(--color-ggd-muted)]/30'
                          }`} />
                        <div>
                          <div className="font-body text-base font-extrabold text-white tracking-wide">
                            {player.name}
                          </div>
                          {idx === 0 && (
                            <div className="font-display text-sm text-[var(--color-ggd-orange)] glow-orange mt-0.5">
                              👑 CON DZỊT SỐ 1
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Scars */}
                      <div className="text-center">
                        <span className={`font-data text-lg font-extrabold ${player.scars > 0 ? 'text-[var(--color-ggd-orange)]' : 'text-[var(--color-ggd-muted)]/20'}`}>
                          {player.scars}
                        </span>
                      </div>

                      {/* Shields */}
                      <div className="text-center">
                        <span className={`font-data text-lg font-extrabold ${player.shields > 0 ? 'text-[var(--color-ggd-neon-green)]' : 'text-[var(--color-ggd-muted)]/20'}`}>
                          {player.shields}
                        </span>
                      </div>

                      {/* Used */}
                      <div className="text-center">
                        <span className="font-data text-lg text-[var(--color-ggd-muted)]/50">
                          {player.shieldsUsed}
                        </span>
                      </div>

                      {/* Total */}
                      <div className="text-right">
                        <span className="font-display text-3xl text-white text-outlined">
                          {player.totalKhaos}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right Column */}
          <div className="animate-slide-up opacity-0" style={{ animationDelay: '0.35s' }}>
            {/* Race History */}
            <div className="ggd-card ggd-stripe">
              <div className="px-5 py-3 border-b-3 border-[var(--color-ggd-outline)]/30 bg-[var(--color-ggd-panel)] flex items-center justify-between rounded-t-[6px]">
                <span className="font-display text-lg text-white text-outlined">
                  📜 Lịch Sử
                </span>
                <label className="flex items-center gap-2 cursor-pointer group">
                  <div className="relative">
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={showTestRaces}
                      onChange={(e) => setShowTestRaces(e.target.checked)}
                    />
                    <div className={`w-10 h-5 rounded-full transition-colors border-2 border-[var(--color-ggd-outline)] ${showTestRaces ? 'bg-[var(--color-ggd-neon-green)]' : 'bg-[var(--color-ggd-muted)]/30'}`}></div>
                    <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white border border-[var(--color-ggd-outline)] transition-transform shadow ${showTestRaces ? 'translate-x-5' : 'translate-x-0'}`}></div>
                  </div>
                  <span className="font-data text-xs text-[var(--color-ggd-muted)] group-hover:text-white transition-colors uppercase tracking-wider">
                    Test
                  </span>
                </label>
              </div>

              {displayedRaces.length > 0 ? (
                <div className="py-1">
                  {displayedRaces.slice(0, 8).map((race, i) => (
                    <Link
                      key={race.id}
                      href={`/race/${race.id}`}
                      className="block mx-2 my-1 px-4 py-3 rounded-xl hover:bg-[var(--color-ggd-neon-green)]/8 transition-all hover:translate-x-1 animate-slide-right opacity-0"
                      style={{ animationDelay: `${0.4 + i * 0.05}s` }}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-display text-base text-white flex items-center gap-2">
                          Trận #{race.id}
                          {race.isTest && (
                            <span className="ggd-tag bg-[var(--color-ggd-sky)] text-[var(--color-ggd-outline)] text-[10px]">
                              TEST
                            </span>
                          )}
                        </span>
                        <span className={`ggd-tag text-[10px] ${race.status === 'finished' ? 'bg-[var(--color-ggd-neon-green)] text-[var(--color-ggd-outline)]' :
                          race.status === 'running' ? 'bg-[var(--color-ggd-gold)] text-[var(--color-ggd-outline)]' :
                            race.status === 'failed' ? 'bg-[var(--color-ggd-orange)] text-white' :
                              'bg-[var(--color-ggd-muted)]/30 text-[var(--color-ggd-muted)]'
                          }`}>
                          {race.status === 'finished' ? '✅' : race.status === 'running' ? '🏃' : race.status === 'failed' ? '💥' : '⏳'} {race.status}
                        </span>
                      </div>
                      {race.finalVerdict && (
                        <p className="font-readable text-sm text-[var(--color-ggd-lavender)] truncate">
                          {race.finalVerdict}
                        </p>
                      )}
                      <p className="font-data text-xs text-[var(--color-ggd-muted)]/50 mt-1">
                        {new Date(race.createdAt).toLocaleDateString('vi-VN', {
                          day: '2-digit', month: '2-digit', year: 'numeric',
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </p>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="px-5 py-12 text-center">
                  <div className="text-5xl mb-3 animate-bob">🦆</div>
                  <p className="font-data text-base text-[var(--color-ggd-muted)]">
                    Chưa có trận nào!
                  </p>
                </div>
              )}
            </div>

            {/* Rules Card */}
            <div className="mt-5 ggd-card-gold ggd-stripe p-5 animate-slide-up opacity-0" style={{ animationDelay: '0.5s' }}>
              <div className="font-display text-xl text-[var(--color-ggd-gold)] text-outlined mb-4">
                📖 Luật Chơi
              </div>
              <div className="space-y-3 font-readable text-base text-white/90">
                <div className="flex items-start gap-3">
                  <span className="text-xl flex-shrink-0">🤕</span>
                  <span>2 người cuối = <span className="text-[var(--color-ggd-orange)] font-bold">con dzịt</span> (+1 Sẹo)</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-xl flex-shrink-0">🛡️</span>
                  <span>Dùng <span className="text-[var(--color-ggd-neon-green)] font-bold">Khiên</span> để thoát kiếp dzịt</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-xl flex-shrink-0">✨</span>
                  <span>Tích <span className="text-[var(--color-ggd-gold)] font-bold">2 Sẹo</span> → 1 Khiên</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-xl flex-shrink-0">🧹</span>
                  <span>Con dzịt phải <span className="text-white font-bold">làm dzịt</span> cho cả team!</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="border-t-4 border-[var(--color-ggd-outline)] pt-6 pb-4 flex items-center justify-between animate-fade-in opacity-0" style={{ animationDelay: '0.6s' }}>
          <div className="font-data text-sm text-[var(--color-ggd-muted)]">
            AUTODUCK v1.0 🦆 Quack Quack!
          </div>
          <div className="font-data text-sm text-[var(--color-ggd-muted)]">
            Team Web • Sáng thứ 2 hàng tuần
          </div>
        </footer>
      </main>
    </div>
  )
}
