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
    <div className="min-h-screen bg-[var(--color-ggd-deep)] bubble-bg">
      {/* Top Rainbow Accent */}
      <div className="cute-divider" />

      {/* Header */}
      <header className="relative border-b-2 border-[var(--color-ggd-mint)]/20">
        <div className="max-w-7xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-5 animate-slide-left">
            <div className="relative">
              <div className="text-5xl duck-mascot">🦆</div>
            </div>
            <div>
              <h1 className="font-display text-3xl text-[var(--color-ggd-cream)]">
                AUTO<span className="text-[var(--color-ggd-mint)]">DUCK</span>
              </h1>
              <div className="flex items-center gap-2 mt-0.5">
                <div className="w-2 h-2 bg-[var(--color-ggd-mint)] rounded-full animate-pulse" />
                <p className="font-data text-sm tracking-wide text-[var(--color-ggd-lavender)]">
                  Quack Quack Club 🦆
                </p>
              </div>
            </div>
          </div>

          <Link href="/race/new" className="animate-slide-right">
            <button className="puffy-btn bg-[var(--color-ggd-orange)] hover:bg-[#ff7f5e] text-white text-lg px-8 py-4">
              <span className="flex items-center gap-3">
                <span className="text-xl animate-wiggle-duck">🦆</span>
                Chạy Đua!
              </span>
            </button>
          </Link>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* Stats Strip */}
        <div className="grid grid-cols-4 gap-4 animate-slide-up opacity-0" style={{ animationDelay: '0.1s' }}>
          {[
            { label: '🦆 Bầy Vịt', value: players.length.toString(), color: 'text-[var(--color-ggd-cream)]' },
            { label: '🏁 Số Trận', value: totalRaces.toString(), color: 'text-[var(--color-ggd-cream)]' },
            { label: '💀 Làm Dzịt', value: totalKhaos.toString(), color: 'text-[var(--color-ggd-gold)]' },
            { label: '👑 Dzịt Nhất', value: mostKhaos?.name?.replace('Zịt ', '') || '—', color: 'text-[var(--color-ggd-orange)]' },
          ].map((stat, i) => (
            <div
              key={stat.label}
              className="soft-card p-4 text-center animate-bounce-in opacity-0"
              style={{ animationDelay: `${0.15 + i * 0.08}s` }}
            >
              <div className="font-data text-xs tracking-wide text-[var(--color-ggd-lavender)] mb-1">
                {stat.label}
              </div>
              <div className={`font-display text-3xl ${stat.color}`}>
                {stat.value}
              </div>
            </div>
          ))}
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Standings - Left 2 Columns */}
          <div className="lg:col-span-2 animate-slide-up opacity-0" style={{ animationDelay: '0.2s' }}>
            <div className="cartoon-card overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-3 bg-[var(--color-ggd-mint)] rounded-t-[17px]">
                <div className="flex items-center gap-3">
                  <span className="font-display text-lg text-[var(--color-ggd-deep)]">
                    🏆 Bảng Xếp Hạng Bầy Vịt
                  </span>
                </div>
                <span className="font-data text-sm text-[var(--color-ggd-deep)]/70">
                  2 Sẹo = 1 Khiên
                </span>
              </div>

              {/* Column Headers */}
              <div className="grid grid-cols-[60px_1fr_80px_80px_80px_100px] gap-0 px-5 py-2.5 border-b-2 border-[var(--color-ggd-mint)]/10 bg-[var(--color-ggd-surface-2)]/30">
                <div className="font-data text-xs tracking-wide text-[var(--color-ggd-lavender)]">#</div>
                <div className="font-data text-xs tracking-wide text-[var(--color-ggd-lavender)]">VỊT 🦆</div>
                <div className="font-data text-xs tracking-wide text-[var(--color-ggd-lavender)] text-center">SẸO</div>
                <div className="font-data text-xs tracking-wide text-[var(--color-ggd-lavender)] text-center">KHIÊN</div>
                <div className="font-data text-xs tracking-wide text-[var(--color-ggd-lavender)] text-center">ĐÃ DÙNG</div>
                <div className="font-data text-xs tracking-wide text-[var(--color-ggd-lavender)] text-right">DZỊT</div>
              </div>

              {/* Player Rows */}
              {loading ? (
                <div className="flex items-center justify-center py-20">
                  <div className="text-5xl animate-bob">🦆</div>
                </div>
              ) : (
                <div>
                  {sortedPlayers.map((player, idx) => (
                    <div
                      key={player.id}
                      className={`
                        grid grid-cols-[60px_1fr_80px_80px_80px_100px] gap-0 items-center
                        px-5 py-3.5 border-b border-[var(--color-ggd-mint)]/8
                        duck-row
                        ${idx === 0 ? 'loser' : ''}
                        animate-slide-right opacity-0
                      `}
                      style={{ animationDelay: `${0.3 + idx * 0.06}s` }}
                    >
                      {/* Position */}
                      <div className="flex items-center gap-2">
                        <span className={`position-number text-2xl ${idx === 0 ? 'text-[var(--color-ggd-orange)] glow-orange' :
                          idx === 1 ? 'text-[var(--color-ggd-gold)] glow-gold' :
                            idx === 2 ? 'text-[var(--color-ggd-mint)] glow-mint' :
                              'text-[var(--color-ggd-lavender)]/50'
                          }`}>
                          {String(idx + 1).padStart(2, '0')}
                        </span>
                      </div>

                      {/* Name */}
                      <div className="flex items-center gap-3">
                        <div className={`w-1.5 h-8 rounded-full ${idx === 0 ? 'bg-[var(--color-ggd-orange)]' :
                          idx === 1 ? 'bg-[var(--color-ggd-gold)]' :
                            idx === 2 ? 'bg-[var(--color-ggd-mint)]' :
                              'bg-[var(--color-ggd-lavender)]/20'
                          }`} />
                        <div>
                          <div className="font-body text-sm font-bold text-[var(--color-ggd-cream)] tracking-wide">
                            {player.name}
                          </div>
                          {idx === 0 && (
                            <div className="font-data text-xs text-[var(--color-ggd-orange)] glow-orange mt-0.5">
                              👑 CON DZỊT SỐ 1
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Scars */}
                      <div className="text-center">
                        <span className={`font-data text-sm font-bold ${player.scars > 0 ? 'text-[var(--color-ggd-orange)]' : 'text-[var(--color-ggd-lavender)]/25'
                          }`}>
                          {player.scars}
                        </span>
                      </div>

                      {/* Shields */}
                      <div className="text-center">
                        <span className={`font-data text-sm font-bold ${player.shields > 0 ? 'text-[var(--color-ggd-mint)]' : 'text-[var(--color-ggd-lavender)]/25'
                          }`}>
                          {player.shields}
                        </span>
                      </div>

                      {/* Shields Used */}
                      <div className="text-center">
                        <span className="font-data text-sm text-[var(--color-ggd-lavender)]/50">
                          {player.shieldsUsed}
                        </span>
                      </div>

                      {/* Total */}
                      <div className="text-right">
                        <span className="font-display text-2xl text-[var(--color-ggd-cream)]">
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
            <div className="cartoon-card overflow-hidden">
              <div className="px-5 py-3 border-b-2 border-[var(--color-ggd-mint)]/10 bg-[var(--color-ggd-surface-2)]/30 flex items-center justify-between rounded-t-[17px]">
                <span className="font-display text-base text-[var(--color-ggd-cream)]">
                  📜 Lịch Sử Trận
                </span>
                <label className="flex items-center gap-2 cursor-pointer group">
                  <div className="relative">
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={showTestRaces}
                      onChange={(e) => setShowTestRaces(e.target.checked)}
                    />
                    <div className={`w-9 h-5 rounded-full transition-colors ${showTestRaces ? 'bg-[var(--color-ggd-mint)]' : 'bg-[var(--color-ggd-lavender)]/30'}`}></div>
                    <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform shadow ${showTestRaces ? 'translate-x-4' : 'translate-x-0'}`}></div>
                  </div>
                  <span className="font-data text-xs text-[var(--color-ggd-lavender)] group-hover:text-[var(--color-ggd-cream)] transition-colors">
                    Test
                  </span>
                </label>
              </div>

              {displayedRaces.length > 0 ? (
                <div className="divide-y divide-[var(--color-ggd-mint)]/8">
                  {displayedRaces.slice(0, 8).map((race, i) => (
                    <Link
                      key={race.id}
                      href={`/race/${race.id}`}
                      className="block px-5 py-4 hover:bg-[var(--color-ggd-mint)]/5 transition-colors animate-slide-right opacity-0"
                      style={{ animationDelay: `${0.4 + i * 0.05}s` }}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-display text-base text-[var(--color-ggd-cream)] flex items-center gap-2">
                          Trận #{race.id}
                          {race.isTest && (
                            <span className="cute-tag bg-[var(--color-ggd-sky)]/20 text-[var(--color-ggd-sky)] border border-[var(--color-ggd-sky)]/30">
                              TEST
                            </span>
                          )}
                        </span>
                        <span className={`cute-tag ${race.status === 'finished' ? 'bg-[var(--color-ggd-mint)]/15 text-[var(--color-ggd-mint)]' :
                          race.status === 'running' ? 'bg-[var(--color-ggd-gold)]/15 text-[var(--color-ggd-gold)]' :
                            race.status === 'failed' ? 'bg-[var(--color-ggd-orange)]/15 text-[var(--color-ggd-orange)]' :
                              'bg-[var(--color-ggd-lavender)]/10 text-[var(--color-ggd-lavender)]'
                          }`}>
                          {race.status === 'finished' ? '✅' : race.status === 'running' ? '🏃' : race.status === 'failed' ? '💥' : '⏳'} {race.status}
                        </span>
                      </div>
                      {race.finalVerdict && (
                        <p className="font-readable text-xs text-[var(--color-ggd-lavender)] truncate">
                          {race.finalVerdict}
                        </p>
                      )}
                      <p className="font-data text-xs text-[var(--color-ggd-lavender)]/50 mt-1">
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
                  <div className="text-4xl mb-3 animate-bob">🦆</div>
                  <p className="font-data text-sm text-[var(--color-ggd-lavender)]/50">
                    Chưa có trận nào cả!
                  </p>
                </div>
              )}
            </div>

            {/* Rules Card */}
            <div className="mt-4 cartoon-card-gold p-5 animate-slide-up opacity-0" style={{ animationDelay: '0.5s' }}>
              <div className="font-display text-lg text-[var(--color-ggd-gold)] mb-3">
                📖 Luật Chơi
              </div>
              <div className="space-y-3 font-readable text-sm text-[var(--color-ggd-cream)]/80">
                <div className="flex items-start gap-2">
                  <span className="text-lg flex-shrink-0">🤕</span>
                  <span>2 người cuối bảng sẽ là <span className="text-[var(--color-ggd-orange)] font-semibold">con dzịt</span> tuần đó (+1 Sẹo)</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-lg flex-shrink-0">🛡️</span>
                  <span>Dùng <span className="text-[var(--color-ggd-mint)] font-semibold">Khiên</span> để thoát kiếp dzịt 1 lần</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-lg flex-shrink-0">✨</span>
                  <span>Tích <span className="text-[var(--color-ggd-gold)] font-semibold">2 Sẹo</span> tự động quy đổi thành 1 Khiên</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-lg flex-shrink-0">🧹</span>
                  <span>Con dzịt phải <span className="text-[var(--color-ggd-cream)] font-semibold">làm dzịt</span> cho cả team</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="border-t-2 border-[var(--color-ggd-mint)]/10 pt-6 pb-4 flex items-center justify-between animate-fade-in opacity-0" style={{ animationDelay: '0.6s' }}>
          <div className="font-data text-sm text-[var(--color-ggd-lavender)]/40">
            AUTODUCK v1.0 🦆 Quack Quack!
          </div>
          <div className="font-data text-sm text-[var(--color-ggd-lavender)]/40">
            Team Web • Sáng thứ 2 hàng tuần
          </div>
        </footer>
      </main>
    </div>
  )
}
