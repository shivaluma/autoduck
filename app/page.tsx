'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { PlayerData } from '@/lib/types'

export default function Dashboard() {
  const [players, setPlayers] = useState<PlayerData[]>([])
  const [loading, setLoading] = useState(true)
  const [races, setRaces] = useState<{ id: number; status: string; finalVerdict: string | null; createdAt: string; isTest?: boolean }[]>([])

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

  const totalRaces = races.length
  const totalKhaos = players.reduce((sum, p) => sum + p.totalKhaos, 0)
  const sortedPlayers = [...players].sort((a, b) => b.totalKhaos - a.totalKhaos)
  const mostKhaos = sortedPlayers[0] ?? null

  return (
    <div className="min-h-screen bg-[var(--color-f1-dark)] noise-overlay grid-lines">
      {/* Top Red Accent Bar */}
      <div className="h-1 bg-gradient-to-r from-[var(--color-f1-red)] via-[var(--color-f1-red)] to-transparent" />

      {/* Header */}
      <header className="relative border-b border-white/5">
        <div className="max-w-7xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-5 animate-slide-left">
            <div className="relative">
              <div className="text-5xl filter drop-shadow-[0_0_15px_rgba(225,6,0,0.3)]">🦆</div>
            </div>
            <div>
              <h1 className="font-display text-2xl font-black tracking-[0.15em] uppercase text-white">
                AUTO<span className="text-[var(--color-f1-red)]">DUCK</span>
              </h1>
              <div className="flex items-center gap-2 mt-0.5">
                <div className="w-2 h-2 bg-[var(--color-f1-red)] rounded-full animate-pulse" />
                <p className="font-data text-[11px] tracking-[0.3em] uppercase text-white/60">
                  Grand Prix Championship
                </p>
              </div>
            </div>
          </div>

          <Link href="/race/new" className="animate-slide-right">
            <button className="group relative overflow-hidden bg-[var(--color-f1-red)] hover:bg-[#ff1a1a] text-white font-display font-bold text-sm tracking-[0.1em] uppercase px-8 py-4 transition-all duration-300 diagonal-cut">
              <span className="relative z-10 flex items-center gap-3">
                <span className="text-lg">🏁</span>
                RACE START
              </span>
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
            </button>
          </Link>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* Stats Strip - F1 Race Info Bar style */}
        <div className="grid grid-cols-4 gap-[1px] bg-white/10 animate-slide-up opacity-0" style={{ animationDelay: '0.1s' }}>
          {[
            { label: 'DRIVERS', value: players.length.toString(), accent: false },
            { label: 'RACES', value: totalRaces.toString(), accent: false },
            { label: 'LÀM DZỊT', value: totalKhaos.toString(), accent: true },
            { label: 'DZỊT NHẤT', value: mostKhaos?.name?.replace('Zịt ', '') || '—', accent: true },
          ].map((stat, i) => (
            <div
              key={stat.label}
              className={`relative bg-[var(--color-f1-surface)] p-5 ${i === 0 ? 'border-l-2 border-[var(--color-f1-red)]' : ''}`}
            >
              <div className="font-data text-[11px] tracking-[0.2em] uppercase text-white/50 mb-2">
                {stat.label}
              </div>
              <div className={`font-display text-3xl font-black ${stat.accent ? 'text-[var(--color-f1-gold)] glow-gold' : 'text-white'}`}>
                {stat.value}
              </div>
            </div>
          ))}
        </div>

        {/* Main Content: Timing Tower + Season Stats */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Timing Tower - Left 2 Columns */}
          <div className="lg:col-span-2 animate-slide-up opacity-0" style={{ animationDelay: '0.2s' }}>
            <div className="bg-[var(--color-f1-surface)] border border-white/10 overflow-hidden">
              {/* Tower Header */}
              <div className="flex items-center justify-between px-5 py-3 bg-[var(--color-f1-red)]">
                <div className="flex items-center gap-3">
                  <span className="font-display text-xs font-bold tracking-[0.2em] uppercase text-white">
                    Championship Standings
                  </span>
                </div>
                <span className="font-data text-[10px] tracking-[0.15em] text-white/70 uppercase">
                  2 Sẹo = 1 Khiên
                </span>
              </div>

              {/* Column Headers */}
              <div className="grid grid-cols-[60px_1fr_80px_80px_80px_100px] gap-0 px-5 py-2 border-b border-white/10 bg-white/[0.04]">
                <div className="font-data text-[11px] tracking-wider uppercase text-white/50">POS</div>
                <div className="font-data text-[11px] tracking-wider uppercase text-white/50">DRIVER</div>
                <div className="font-data text-[11px] tracking-wider uppercase text-white/50 text-center">SCARS</div>
                <div className="font-data text-[11px] tracking-wider uppercase text-white/50 text-center">SHIELD</div>
                <div className="font-data text-[11px] tracking-wider uppercase text-white/50 text-center">USED</div>
                <div className="font-data text-[11px] tracking-wider uppercase text-white/50 text-right">DZỊT</div>
              </div>

              {/* Driver Rows */}
              {loading ? (
                <div className="flex items-center justify-center py-20">
                  <div className="text-4xl animate-spin">🦆</div>
                </div>
              ) : (
                <div>
                  {sortedPlayers.map((player, idx) => (
                    <div
                      key={player.id}
                      className={`
                        grid grid-cols-[60px_1fr_80px_80px_80px_100px] gap-0 items-center
                        px-5 py-3 border-b border-white/[0.06]
                        timing-row speed-lines
                        ${idx === 0 ? 'penalty' : ''}
                        animate-slide-right opacity-0
                      `}
                      style={{ animationDelay: `${0.3 + idx * 0.06}s` }}
                    >
                      {/* Position */}
                      <div className="flex items-center gap-2">
                        <span className={`position-number text-2xl ${idx === 0 ? 'text-[var(--color-f1-red)] glow-red' :
                          idx === 1 ? 'text-[var(--color-f1-gold)] glow-gold' :
                            idx === 2 ? 'text-[var(--color-f1-cyan)] glow-cyan' :
                              'text-white/40'
                          }`}>
                          {String(idx + 1).padStart(2, '0')}
                        </span>
                      </div>

                      {/* Driver Name */}
                      <div className="flex items-center gap-3">
                        <div className={`w-1 h-8 rounded-full ${idx === 0 ? 'bg-[var(--color-f1-red)]' :
                          idx === 1 ? 'bg-[var(--color-f1-gold)]' :
                            idx === 2 ? 'bg-[var(--color-f1-cyan)]' :
                              'bg-white/10'
                          }`} />
                        <div>
                          <div className="font-body text-sm font-semibold text-white tracking-wide uppercase">
                            {player.name}
                          </div>
                          {idx === 0 && (
                            <div className="font-data text-[10px] tracking-[0.15em] text-[var(--color-f1-red)] glow-red uppercase mt-0.5">
                              CON DZỊT SỐ 1
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Scars */}
                      <div className="text-center">
                        <span className={`font-data text-sm font-bold ${player.scars > 0 ? 'text-[var(--color-f1-red)] glow-red' : 'text-white/25'
                          }`}>
                          {player.scars}
                        </span>
                      </div>

                      {/* Shields */}
                      <div className="text-center">
                        <span className={`font-data text-sm font-bold ${player.shields > 0 ? 'text-[var(--color-f1-cyan)] glow-cyan' : 'text-white/25'
                          }`}>
                          {player.shields}
                        </span>
                      </div>

                      {/* Shields Used */}
                      <div className="text-center">
                        <span className="font-data text-sm text-white/50">
                          {player.shieldsUsed}
                        </span>
                      </div>

                      {/* Total Penalties */}
                      <div className="text-right">
                        <span className="font-display text-xl font-black text-white">
                          {player.totalKhaos}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Race History */}
          <div className="animate-slide-up opacity-0" style={{ animationDelay: '0.35s' }}>
            {/* Race History */}
            <div className="bg-[var(--color-f1-surface)] border border-white/10 overflow-hidden">
              <div className="px-5 py-3 border-b border-white/10 bg-white/[0.04]">
                <span className="font-display text-xs font-bold tracking-[0.15em] uppercase text-white/80">
                  Race Log
                </span>
              </div>

              {races.length > 0 ? (
                <div className="divide-y divide-white/[0.06]">
                  {races.slice(0, 8).map((race, i) => (
                    <Link
                      key={race.id}
                      href={`/race/${race.id}`}
                      className="block px-5 py-4 hover:bg-white/[0.04] transition-colors speed-lines animate-slide-right opacity-0"
                      style={{ animationDelay: `${0.4 + i * 0.05}s` }}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-display text-xs font-bold tracking-wider uppercase text-white flex items-center gap-2">
                          GP #{race.id}
                          {race.isTest && (
                            <span className="text-[var(--color-f1-cyan)] border border-[var(--color-f1-cyan)]/50 px-1.5 py-0.5 rounded-[2px] text-[9px] font-mono tracking-widest bg-[var(--color-f1-cyan)]/10">
                              TEST
                            </span>
                          )}
                        </span>
                        <span className={`font-data text-[11px] px-2 py-0.5 tracking-wider uppercase ${race.status === 'finished' ? 'bg-green-500/10 text-green-400' :
                          race.status === 'running' ? 'bg-[var(--color-f1-gold)]/10 text-[var(--color-f1-gold)]' :
                            race.status === 'failed' ? 'bg-[var(--color-f1-red)]/10 text-[var(--color-f1-red)]' :
                              'bg-white/5 text-white/40'
                          }`}>
                          {race.status}
                        </span>
                      </div>
                      {race.finalVerdict && (
                        <p className="font-readable text-xs text-white/60 truncate">
                          {race.finalVerdict}
                        </p>
                      )}
                      <p className="font-data text-[11px] text-white/35 mt-1">
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
                  <div className="text-3xl mb-3 opacity-30">🏁</div>
                  <p className="font-data text-xs text-white/30 tracking-wider uppercase">
                    No races yet
                  </p>
                </div>
              )}
            </div>

            {/* Quick Rules Card */}
            <div className="mt-4 bg-[var(--color-f1-surface)] border border-white/10 p-5 animate-slide-up opacity-0" style={{ animationDelay: '0.5s' }}>
              <div className="font-display text-[11px] tracking-[0.2em] uppercase text-[var(--color-f1-red)] glow-red mb-3">
                Race Regulations
              </div>
              <div className="space-y-2.5 font-readable text-sm text-white/70">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 bg-[var(--color-f1-red)] rounded-full flex-shrink-0" />
                  <span>2 người cuối bảng sẽ là <span className="text-[var(--color-f1-red)] font-semibold">con dzịt</span> tuần đó (+1 Sẹo)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 bg-[var(--color-f1-cyan)] rounded-full flex-shrink-0" />
                  <span>Dùng <span className="text-[var(--color-f1-cyan)] font-semibold">Khiên</span> để thoát kiếp dzịt 1 lần</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 bg-[var(--color-f1-gold)] rounded-full flex-shrink-0" />
                  <span>Tích <span className="text-[var(--color-f1-gold)] font-semibold">2 Sẹo</span> tự động quy đổi thành 1 Khiên</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 bg-white/30 rounded-full flex-shrink-0" />
                  <span>Con dzịt phải <span className="text-white font-semibold">làm dzịt</span> cho cả team</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="border-t border-white/10 pt-6 pb-4 flex items-center justify-between animate-fade-in opacity-0" style={{ animationDelay: '0.6s' }}>
          <div className="font-data text-[11px] tracking-[0.2em] uppercase text-white/30">
            AUTODUCK v1.0 &mdash; Zero-Touch Racing System
          </div>
          <div className="font-data text-[11px] tracking-[0.2em] uppercase text-white/30">
            Team Web &bull; Sáng thứ 2 hàng tuần
          </div>
        </footer>
      </main>
    </div>
  )
}
