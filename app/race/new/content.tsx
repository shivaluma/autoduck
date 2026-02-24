'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { PlayerData } from '@/lib/types'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

interface ParticipantSetup {
  userId: number
  name: string
  selected: boolean
  useShield: boolean
  availableShields: number
  scars: number
}

interface NewRaceContentProps {
  testMode: boolean
  secretKey?: string
}

export function NewRaceContent({ testMode, secretKey }: NewRaceContentProps) {
  const router = useRouter()

  const [players, setPlayers] = useState<ParticipantSetup[]>([])
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [countdown, setCountdown] = useState<number | null>(null)

  // Dialog State
  const [playerToRemove, setPlayerToRemove] = useState<number | null>(null)

  useEffect(() => {
    fetch('/api/users')
      .then((r) => r.json())
      .then((data: PlayerData[]) => {
        setPlayers(
          data.map((p) => {
            const isThomas = p.name === 'Thomas'
            return {
              userId: p.id,
              name: p.name,
              selected: true,
              useShield: isThomas,
              availableShields: p.shields,
              scars: p.scars,
            }
          })
        )
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const selectedCount = players.filter((p) => p.selected).length
  const shieldsInUse = players.filter((p) => p.selected && p.useShield).length

  const handleTogglePlayerRequest = (userId: number) => {
    const player = players.find(p => p.userId === userId)
    if (!player) return

    if (player.selected) {
      setPlayerToRemove(userId)
    } else {
      togglePlayerRef(userId)
    }
  }

  const confirmRemovePlayer = () => {
    if (playerToRemove !== null) {
      togglePlayerRef(playerToRemove)
      setPlayerToRemove(null)
    }
  }

  const togglePlayerRef = (userId: number) => {
    setPlayers((prev) =>
      prev.map((p) =>
        p.userId === userId
          ? { ...p, selected: !p.selected, useShield: !p.selected ? (p.name === 'Thomas') : p.useShield }
          : p
      )
    )
  }

  const handleToggleShield = (userId: number) => {
    setPlayers((prev) =>
      prev.map((p) => {
        if (p.userId !== userId) return p
        if (p.name === 'Thomas') return p
        return { ...p, useShield: !p.useShield }
      })
    )
  }

  const handleStartRace = async () => {
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
      .sort(() => Math.random() - 0.5)

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
      <div className="min-h-screen bg-[var(--color-ggd-deep)] bubble-bg flex items-center justify-center">
        <div className="text-center">
          {countdown > 0 ? (
            <>
              {/* Egg countdown */}
              <div className="flex gap-5 mb-12 justify-center">
                {[5, 4, 3, 2, 1].map((n) => (
                  <div
                    key={n}
                    className={`w-14 h-14 rounded-full transition-all duration-300 flex items-center justify-center text-2xl ${countdown <= n
                      ? 'bg-[var(--color-ggd-orange)] shadow-[0_0_30px_rgba(255,107,74,0.4)] scale-110'
                      : 'bg-[var(--color-ggd-surface)] scale-90 opacity-40'
                      }`}
                  >
                    {countdown <= n ? '🥚' : ''}
                  </div>
                ))}
              </div>
              <div className="font-display text-[120px] text-[var(--color-ggd-orange)] leading-none animate-pulse glow-orange">
                {countdown}
              </div>
            </>
          ) : (
            <>
              {/* GO! All eggs hatched! */}
              <div className="flex gap-5 mb-12 justify-center">
                {[5, 4, 3, 2, 1].map((n) => (
                  <div
                    key={n}
                    className="w-14 h-14 rounded-full bg-[var(--color-ggd-mint)] shadow-[0_0_30px_rgba(94,232,183,0.4)] flex items-center justify-center text-2xl animate-wiggle-duck"
                    style={{ animationDelay: `${n * 0.05}s` }}
                  >
                    🐣
                  </div>
                ))}
              </div>
              <div className="font-display text-[80px] text-[var(--color-ggd-mint)] leading-none glow-mint">
                QUACK QUACK!
              </div>
              <div className="font-body text-xl text-[var(--color-ggd-cream)]/60 mt-4">
                🦆 Chạy đi các vịt ơiiiii! 🦆
              </div>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[var(--color-ggd-deep)] bubble-bg">
      <div className="cute-divider" />

      {/* Header */}
      <header className="border-b-2 border-[var(--color-ggd-mint)]/20">
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link href="/" className="font-data text-sm text-[var(--color-ggd-lavender)] hover:text-[var(--color-ggd-cream)] transition-colors">
            ← Về Chuồng
          </Link>
          <div className="flex items-center gap-3 animate-slide-right">
            <div className="font-display text-2xl text-[var(--color-ggd-cream)]">
              🦆 Tập Hợp <span className="text-[var(--color-ggd-mint)]">Bầy Vịt</span>
            </div>
            {testMode && (
              <div className="cute-tag bg-[var(--color-ggd-gold)]/20 text-[var(--color-ggd-gold)] border border-[var(--color-ggd-gold)]/50 animate-pulse">
                TEST MODE
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* Driver Grid */}
        <div className="cartoon-card overflow-hidden animate-slide-up opacity-0" style={{ animationDelay: '0.1s' }}>
          {/* Header bar */}
          <div className="flex items-center justify-between px-5 py-3 bg-[var(--color-ggd-surface-2)]/40 border-b-2 border-[var(--color-ggd-mint)]/10 rounded-t-[17px]">
            <div className="flex items-center gap-4">
              <span className="font-display text-lg text-[var(--color-ggd-cream)]">
                🦆 Danh Sách Vịt
              </span>
              <span className="cute-tag bg-[var(--color-ggd-mint)]/15 text-[var(--color-ggd-mint)]">
                {selectedCount} đã chọn
              </span>
              {shieldsInUse > 0 && (
                <span className="cute-tag bg-[var(--color-ggd-sky)]/15 text-[var(--color-ggd-sky)]">
                  🛡️ {shieldsInUse} khiên
                </span>
              )}
            </div>
          </div>

          {/* Player Grid */}
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="text-5xl animate-bob">🦆</div>
            </div>
          ) : (
            <div className="divide-y divide-[var(--color-ggd-mint)]/8">
              {players.map((player, idx) => (
                <div
                  key={player.userId}
                  onClick={() => handleTogglePlayerRequest(player.userId)}
                  className={`
                    grid grid-cols-[50px_1fr_100px_120px_140px] gap-0 items-center
                    px-5 py-4 cursor-pointer transition-all duration-200
                    duck-row
                    ${player.selected ? '' : 'opacity-30'}
                    ${player.useShield ? 'shielded' : ''}
                    animate-slide-right opacity-0
                  `}
                  style={{ animationDelay: `${0.15 + idx * 0.05}s` }}
                >
                  {/* Selection */}
                  <div className="flex items-center">
                    <div className={`w-8 h-8 flex items-center justify-center rounded-lg border-2 transition-colors ${player.selected
                      ? 'border-[var(--color-ggd-mint)] bg-[var(--color-ggd-mint)]/20'
                      : 'border-[var(--color-ggd-lavender)]/20'
                      }`}>
                      {player.selected && (
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                          <path d="M2 7L5.5 10.5L12 3.5" stroke="var(--color-ggd-mint)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </div>
                  </div>

                  {/* Player Info */}
                  <div className="flex items-center gap-3">
                    <div className={`w-1.5 h-10 rounded-full ${player.useShield ? 'bg-[var(--color-ggd-sky)]' :
                      player.selected ? 'bg-[var(--color-ggd-mint)]' : 'bg-[var(--color-ggd-lavender)]/20'
                      }`} />
                    <div>
                      <div className="font-body text-sm font-bold text-[var(--color-ggd-cream)] tracking-wide">
                        {player.name}
                        {player.name === 'Thomas' && <span className="ml-2 cute-tag bg-[var(--color-ggd-gold)]/20 text-[var(--color-ggd-gold)] text-[10px]">BẤT TỬ ✨</span>}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="font-data text-xs text-[var(--color-ggd-lavender)]/60">
                          {player.scars > 0 ? (
                            <span className="text-[var(--color-ggd-orange)]">🤕 {player.scars} Sẹo</span>
                          ) : (
                            'Sạch sẽ ✨'
                          )}
                        </span>
                        <span className="font-data text-xs text-[var(--color-ggd-lavender)]/60">
                          {player.availableShields > 9000 ? (
                            <span className="text-[var(--color-ggd-mint)]">🛡️ ∞</span>
                          ) : player.availableShields > 0 ? (
                            <span className="text-[var(--color-ggd-mint)]">🛡️ {player.availableShields}</span>
                          ) : (
                            'Không khiên'
                          )}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Scars */}
                  <div className="text-center">
                    <span className={`font-data text-lg font-bold ${player.scars > 0 ? 'text-[var(--color-ggd-orange)]' : 'text-[var(--color-ggd-lavender)]/15'
                      }`}>
                      {player.scars}
                    </span>
                    <div className="font-data text-[10px] text-[var(--color-ggd-lavender)]/40 mt-0.5">Sẹo</div>
                  </div>

                  {/* Available Shields */}
                  <div className="text-center">
                    <span className={`font-data text-lg font-bold ${player.availableShields > 0 ? 'text-[var(--color-ggd-mint)]' : 'text-[var(--color-ggd-lavender)]/15'
                      }`}>
                      {player.availableShields > 9000 ? '∞' : player.availableShields}
                    </span>
                    <div className="font-data text-[10px] text-[var(--color-ggd-lavender)]/40 mt-0.5">Khiên</div>
                  </div>

                  {/* Shield Toggle */}
                  <div className="flex justify-center" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => handleToggleShield(player.userId)}
                      disabled={!player.selected || player.availableShields <= 0 || player.name === 'Thomas'}
                      className={`
                        puffy-btn text-xs px-4 py-2
                        disabled:opacity-20 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none
                        ${player.useShield
                          ? 'bg-[var(--color-ggd-mint)] text-[var(--color-ggd-deep)]'
                          : 'bg-[var(--color-ggd-surface-2)] text-[var(--color-ggd-lavender)] hover:bg-[var(--color-ggd-surface-2)]/80'
                        }
                      `}
                    >
                      {player.useShield ? '🛡️ Đang Bật' : 'Bật Khiên'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="cartoon-card-orange px-5 py-3">
            <span className="font-data text-sm text-[var(--color-ggd-orange)]">
              ⚠️ LỖI: {error}
            </span>
          </div>
        )}

        {/* Active Shields Banner */}
        {shieldsInUse > 0 && (
          <div className="soft-card p-5 border-[var(--color-ggd-sky)]/30 animate-slide-up opacity-0" style={{ animationDelay: '0.5s' }}>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-2 h-2 bg-[var(--color-ggd-sky)] rounded-full animate-pulse" />
              <span className="font-display text-base text-[var(--color-ggd-sky)]">
                🛡️ Khiên Đang Hoạt Động
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {players
                .filter((p) => p.selected && p.useShield)
                .map((p) => (
                  <span key={p.userId} className="cute-tag bg-[var(--color-ggd-sky)]/15 text-[var(--color-ggd-sky)]">
                    {p.name}
                  </span>
                ))}
            </div>
            <p className="font-body text-sm text-[var(--color-ggd-lavender)]/60 mt-2">
              Vịt có khiên sẽ thoát kiếp dzịt nếu về cuối. Phận dzịt chuyển cho vịt kế tiếp! 🦆
            </p>
          </div>
        )}

        {/* Action Bar */}
        <div className="flex items-center justify-between pt-2 animate-slide-up opacity-0" style={{ animationDelay: '0.4s' }}>
          <Link href="/">
            <button className="font-display text-base text-[var(--color-ggd-lavender)]/50 hover:text-[var(--color-ggd-cream)] transition-colors px-4 py-3">
              ← Hủy
            </button>
          </Link>
          <button
            onClick={handleStartRace}
            disabled={selectedCount < 2 || starting}
            className={`
              puffy-btn text-lg px-10 py-4
              disabled:opacity-30 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none
              ${starting
                ? 'bg-[var(--color-ggd-gold)] text-[var(--color-ggd-deep)]'
                : 'bg-[var(--color-ggd-orange)] hover:bg-[#ff7f5e] text-white'
              }
            `}
          >
            <span className="flex items-center gap-3">
              {starting ? (
                <>
                  <span className="animate-spin">🥚</span>
                  Đang Khởi Động...
                </>
              ) : (
                <>
                  🦆 Chạy Đi Các Vịt! ({selectedCount})
                </>
              )}
            </span>
          </button>
        </div>
      </main>

      {/* Opt-out Confirmation Dialog */}
      <AlertDialog open={playerToRemove !== null} onOpenChange={(open) => !open && setPlayerToRemove(null)}>
        <AlertDialogContent className="bg-[var(--color-ggd-surface)] border-2 border-[var(--color-ggd-mint)]/30 text-[var(--color-ggd-cream)] rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[var(--color-ggd-orange)] font-display text-xl">
              🦆 Bỏ Vịt Ra?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[var(--color-ggd-lavender)]">
              Chắc chắn muốn bỏ <strong className="text-[var(--color-ggd-cream)]">{players.find(p => p.userId === playerToRemove)?.name}</strong> ra khỏi trận đua?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-transparent border-2 border-[var(--color-ggd-lavender)]/30 hover:bg-[var(--color-ggd-surface-2)] text-[var(--color-ggd-cream)] font-display rounded-full">
              Thôi
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRemovePlayer}
              className="bg-[var(--color-ggd-orange)] hover:bg-[#ff7f5e] text-white font-display rounded-full border-0"
            >
              Bỏ Ra 🦆
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
