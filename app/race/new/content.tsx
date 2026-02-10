'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import type { PlayerData } from '@/lib/types'

interface ParticipantSetup {
  userId: number
  name: string
  selected: boolean
  useShield: boolean
  availableShields: number
  scars: number
}

export function NewRaceContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const testMode = searchParams.get('test') === 'true'
  const secretKey = searchParams.get('secret')

  const [players, setPlayers] = useState<ParticipantSetup[]>([])
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [countdown, setCountdown] = useState<number | null>(null)

  useEffect(() => {
    fetch('/api/users')
      .then((r) => r.json())
      .then((data: PlayerData[]) => {
        setPlayers(
          data.map((p) => ({
            userId: p.id,
            name: p.name,
            selected: true,
            useShield: false,
            availableShields: p.shields,
            scars: p.scars,
          }))
        )
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const selectedCount = players.filter((p) => p.selected).length
  const shieldsInUse = players.filter((p) => p.selected && p.useShield).length

  const handleTogglePlayer = (userId: number) => {
    setPlayers((prev) =>
      prev.map((p) =>
        p.userId === userId
          ? { ...p, selected: !p.selected, useShield: !p.selected ? false : p.useShield }
          : p
      )
    )
  }

  const handleToggleShield = (userId: number) => {
    setPlayers((prev) =>
      prev.map((p) =>
        p.userId === userId ? { ...p, useShield: !p.useShield } : p
      )
    )
  }

  const handleStartRace = async () => {
    // Countdown animation
    setCountdown(5)
    for (let i = 4; i >= 0; i--) {
      await new Promise(r => setTimeout(r, 600))
      setCountdown(i)
    }
    await new Promise(r => setTimeout(r, 400))
    setCountdown(null)
    setStarting(true)
    setError(null)

    const participants = players
      .filter((p) => p.selected)
      .map((p) => ({
        userId: p.userId,
        useShield: p.useShield,
      }))

    try {
      const res = await fetch('/api/races/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          participants,
          test: testMode,
          secret: secretKey
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Có lỗi xảy ra')
        setStarting(false)
        return
      }
      router.push(`/race/${data.raceId}`)
    } catch {
      setError('Không thể kết nối server')
      setStarting(false)
    }
  }

  // Countdown overlay
  if (countdown !== null) {
    return (
      <div className="min-h-screen bg-[var(--color-f1-dark)] flex items-center justify-center">
        <div className="text-center">
          {countdown > 0 ? (
            <>
              {/* Red lights */}
              <div className="flex gap-4 mb-12 justify-center">
                {[5, 4, 3, 2, 1].map((n) => (
                  <div
                    key={n}
                    className={`w-12 h-12 rounded-full transition-all duration-300 ${countdown <= n
                      ? 'bg-[var(--color-f1-red)] shadow-[0_0_30px_rgba(225,6,0,0.6)]'
                      : 'bg-white/5'
                      }`}
                  />
                ))}
              </div>
              <div className="font-display text-[120px] font-black text-[var(--color-f1-red)] leading-none animate-pulse glow-red">
                {countdown}
              </div>
            </>
          ) : (
            <>
              {/* Green lights - GO! */}
              <div className="flex gap-4 mb-12 justify-center">
                {[5, 4, 3, 2, 1].map((n) => (
                  <div
                    key={n}
                    className="w-12 h-12 rounded-full bg-green-500 shadow-[0_0_30px_rgba(0,255,0,0.6)]"
                  />
                ))}
              </div>
              <div className="font-display text-[80px] font-black text-green-400 leading-none tracking-[0.2em] glow-green">
                LIGHTS OUT!
              </div>
              <div className="font-body text-xl text-white/60 mt-4 tracking-[0.3em] uppercase">
                And away we go
              </div>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[var(--color-f1-dark)] noise-overlay grid-lines">
      <div className="h-1 bg-gradient-to-r from-[var(--color-f1-red)] via-[var(--color-f1-red)] to-transparent" />

      {/* Header */}
      <header className="border-b border-white/10">
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link href="/" className="font-data text-xs tracking-[0.15em] uppercase text-white/40 hover:text-white transition-colors">
            ← PADDOCK
          </Link>
          <div className="flex items-center gap-3 animate-slide-right">
            <div className="font-display text-lg font-bold tracking-[0.15em] uppercase text-white">
              GRID <span className="text-[var(--color-f1-red)]">FORMATION</span>
            </div>
            {testMode && (
              <div className="bg-yellow-500/20 border border-yellow-500/50 text-yellow-500 px-2 py-0.5 text-[10px] font-bold tracking-wider rounded uppercase animate-pulse">
                TEST MODE
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* Grid Formation */}
        <div className="bg-[var(--color-f1-surface)] border border-white/10 overflow-hidden animate-slide-up opacity-0" style={{ animationDelay: '0.1s' }}>
          {/* Header bar */}
          <div className="flex items-center justify-between px-5 py-3 bg-white/[0.04] border-b border-white/10">
            <div className="flex items-center gap-4">
              <span className="font-display text-xs font-bold tracking-[0.15em] uppercase text-white/80">
                Drivers
              </span>
              <span className="font-data text-[11px] tracking-wider text-[var(--color-f1-cyan)]">
                {selectedCount} SELECTED
              </span>
              {shieldsInUse > 0 && (
                <span className="font-data text-[11px] tracking-wider text-[var(--color-f1-cyan)]">
                  &bull; {shieldsInUse} SHIELD{shieldsInUse > 1 ? 'S' : ''} ACTIVE
                </span>
              )}
            </div>
          </div>

          {/* Driver Grid */}
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="text-4xl animate-spin">🦆</div>
            </div>
          ) : (
            <div className="divide-y divide-white/[0.06]">
              {players.map((player, idx) => (
                <div
                  key={player.userId}
                  onClick={() => handleTogglePlayer(player.userId)}
                  className={`
                    grid grid-cols-[50px_1fr_100px_120px_140px] gap-0 items-center
                    px-5 py-4 cursor-pointer transition-all duration-200
                    timing-row speed-lines
                    ${player.selected ? '' : 'opacity-30'}
                    ${player.useShield ? 'shield-active' : ''}
                    animate-slide-right opacity-0
                  `}
                  style={{ animationDelay: `${0.15 + idx * 0.05}s` }}
                >
                  {/* Grid Position */}
                  <div className="flex items-center">
                    <div className={`w-8 h-8 flex items-center justify-center border-2 transition-colors ${player.selected
                      ? 'border-[var(--color-f1-red)] bg-[var(--color-f1-red)]/20'
                      : 'border-white/10'
                      }`}>
                      {player.selected && (
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                          <path d="M2 7L5.5 10.5L12 3.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </div>
                  </div>

                  {/* Driver Info */}
                  <div className="flex items-center gap-3">
                    <div className={`w-1 h-10 rounded-full ${player.useShield ? 'bg-[var(--color-f1-cyan)]' :
                      player.selected ? 'bg-[var(--color-f1-red)]' : 'bg-white/10'
                      }`} />
                    <div>
                      <div className="font-body text-sm font-semibold text-white tracking-wide uppercase">
                        {player.name}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="font-data text-[11px] text-white/40">
                          {player.scars > 0 ? (
                            <span className="text-[var(--color-f1-red)]">{player.scars} SCAR{player.scars > 1 ? 'S' : ''}</span>
                          ) : (
                            'CLEAN'
                          )}
                        </span>
                        <span className="font-data text-[11px] text-white/40">
                          {player.availableShields > 0 ? (
                            <span className="text-[var(--color-f1-cyan)]">{player.availableShields} SHIELD{player.availableShields > 1 ? 'S' : ''}</span>
                          ) : (
                            'NO SHIELDS'
                          )}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Scars */}
                  <div className="text-center">
                    <span className={`font-data text-lg font-bold ${player.scars > 0 ? 'text-[var(--color-f1-red)]' : 'text-white/15'
                      }`}>
                      {player.scars}
                    </span>
                    <div className="font-data text-[10px] text-white/30 uppercase mt-0.5">Scars</div>
                  </div>

                  {/* Available Shields */}
                  <div className="text-center">
                    <span className={`font-data text-lg font-bold ${player.availableShields > 0 ? 'text-[var(--color-f1-cyan)]' : 'text-white/15'
                      }`}>
                      {player.availableShields}
                    </span>
                    <div className="font-data text-[10px] text-white/30 uppercase mt-0.5">Available</div>
                  </div>

                  {/* Shield Toggle */}
                  <div className="flex justify-center" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => handleToggleShield(player.userId)}
                      disabled={!player.selected || player.availableShields <= 0}
                      className={`
                        font-display text-[11px] font-bold tracking-[0.15em] uppercase
                        px-4 py-2 transition-all duration-200
                        disabled:opacity-20 disabled:cursor-not-allowed
                        ${player.useShield
                          ? 'bg-[var(--color-f1-cyan)] text-black shadow-[0_0_20px_rgba(0,210,255,0.3)]'
                          : 'bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/60'
                        }
                      `}
                    >
                      {player.useShield ? 'SHIELD ON' : 'ACTIVATE'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="bg-[var(--color-f1-red)]/10 border border-[var(--color-f1-red)]/30 px-5 py-3">
            <span className="font-data text-xs text-[var(--color-f1-red)] tracking-wider uppercase">
              ERROR: {error}
            </span>
          </div>
        )}

        {/* Active Shields Banner */}
        {shieldsInUse > 0 && (
          <div className="bg-[var(--color-f1-cyan)]/5 border border-[var(--color-f1-cyan)]/20 px-5 py-4 animate-slide-up opacity-0" style={{ animationDelay: '0.5s' }}>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-2 h-2 bg-[var(--color-f1-cyan)] rounded-full animate-pulse" />
              <span className="font-display text-[11px] font-bold tracking-[0.2em] uppercase text-[var(--color-f1-cyan)] glow-cyan">
                Shield Defense Active
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {players
                .filter((p) => p.selected && p.useShield)
                .map((p) => (
                  <span key={p.userId} className="font-data text-xs bg-[var(--color-f1-cyan)]/10 text-[var(--color-f1-cyan)] px-3 py-1 tracking-wider uppercase">
                    {p.name}
                  </span>
                ))}
            </div>
            <p className="font-body text-sm text-white/40 mt-2">
              Driver có khiên sẽ thoát kiếp dzịt nếu về cuối. Phận dzịt chuyển cho người kế tiếp không có khiên.
            </p>
          </div>
        )}

        {/* Action Bar */}
        <div className="flex items-center justify-between pt-2 animate-slide-up opacity-0" style={{ animationDelay: '0.4s' }}>
          <Link href="/">
            <button className="font-display text-xs font-bold tracking-[0.15em] uppercase text-white/30 hover:text-white transition-colors px-4 py-3">
              ← ABORT
            </button>
          </Link>
          <button
            onClick={handleStartRace}
            disabled={selectedCount < 2 || starting}
            className={`
              group relative overflow-hidden font-display text-sm font-bold tracking-[0.15em] uppercase
              px-10 py-4 transition-all duration-300 diagonal-cut
              disabled:opacity-30 disabled:cursor-not-allowed
              ${starting
                ? 'bg-[var(--color-f1-gold)] text-black'
                : 'bg-[var(--color-f1-red)] hover:bg-[#ff1a1a] text-white hover:shadow-[0_0_40px_rgba(225,6,0,0.3)]'
              }
            `}
          >
            <span className="relative z-10 flex items-center gap-3">
              {starting ? (
                <>
                  <span className="animate-spin">⏳</span>
                  LAUNCHING...
                </>
              ) : (
                <>
                  LIGHTS OUT — {selectedCount} DRIVERS
                </>
              )}
            </span>
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
          </button>
        </div>
      </main>
    </div>
  )
}
