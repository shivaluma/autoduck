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
  const [playerToRemove, setPlayerToRemove] = useState<number | null>(null)

  useEffect(() => {
    fetch('/api/users')
      .then((r) => r.json())
      .then((data: PlayerData[]) => {
        setPlayers(
          data.map((p) => {
            const isThomas = p.name === 'Thomas'
            return {
              userId: p.id, name: p.name, selected: true,
              useShield: isThomas, availableShields: p.shields, scars: p.scars,
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
    if (player.selected) { setPlayerToRemove(userId) } else { togglePlayerRef(userId) }
  }

  const confirmRemovePlayer = () => {
    if (playerToRemove !== null) { togglePlayerRef(playerToRemove); setPlayerToRemove(null) }
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
    for (let i = 4; i >= 0; i--) { await new Promise(r => setTimeout(r, 600)); setCountdown(i) }
    await new Promise(r => setTimeout(r, 400))
    setCountdown(null); setStarting(true); setError(null)

    const participants = players
      .filter((p) => p.selected)
      .map((p) => ({ userId: p.userId, useShield: p.useShield }))
      .sort(() => Math.random() - 0.5)

    try {
      const res = await fetch('/api/races/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participants, test: testMode, secret: secretKey }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Có lỗi xảy ra'); setStarting(false); return }
      router.push(`/race/${data.raceId}`)
    } catch { setError('Không thể kết nối server'); setStarting(false) }
  }

  // Countdown overlay
  if (countdown !== null) {
    return (
      <div className="min-h-screen bg-transparent flex items-center justify-center">
        <div className="text-center">
          {countdown > 0 ? (
            <>
              <div className="flex gap-5 mb-12 justify-center">
                {[5, 4, 3, 2, 1].map((n) => (
                  <div
                    key={n}
                    className={`w-16 h-16 rounded-full border-4 border-[var(--color-ggd-outline)] transition-all duration-300 flex items-center justify-center text-2xl
                      shadow-[inset_0_2px_0_rgba(255,255,255,0.1),0_4px_0_var(--color-ggd-outline)]
                      ${countdown <= n
                        ? 'bg-[var(--color-ggd-orange)] scale-110 shadow-[0_0_25px_rgba(255,87,51,0.5)]'
                        : 'bg-[var(--color-ggd-panel)] scale-90 opacity-30'
                      }`}
                  >
                    {countdown <= n ? '🥚' : ''}
                  </div>
                ))}
              </div>
              <div className="font-display text-[140px] text-[var(--color-ggd-orange)] leading-none animate-pulse text-outlined">
                {countdown}
              </div>
            </>
          ) : (
            <>
              <div className="flex gap-5 mb-12 justify-center">
                {[5, 4, 3, 2, 1].map((n) => (
                  <div
                    key={n}
                    className="w-16 h-16 rounded-full bg-[var(--color-ggd-neon-green)] border-4 border-[var(--color-ggd-outline)]
                      shadow-[0_0_25px_rgba(61,255,143,0.5),0_4px_0_var(--color-ggd-outline)]
                      flex items-center justify-center text-2xl animate-wiggle-duck"
                    style={{ animationDelay: `${n * 0.05}s` }}
                  >
                    🐣
                  </div>
                ))}
              </div>
              <div className="font-display text-[90px] text-[var(--color-ggd-neon-green)] leading-none text-outlined glow-green">
                QUACK QUACK!
              </div>
              <div className="font-body text-2xl text-white/70 mt-4 font-bold">
                🦆 Chạy đi các vịt ơiiiii! 🦆
              </div>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-transparent bubble-bg">
      <div className="neon-divider" />

      <header className="border-b-4 border-[var(--color-ggd-outline)]">
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link href="/" className="font-data text-sm text-[var(--color-ggd-muted)] hover:text-white transition-colors">
            ← Về Chuồng
          </Link>
          <div className="flex items-center gap-3 animate-slide-right">
            <div className="font-display text-2xl text-white text-outlined">
              🦆 Tập Hợp <span className="text-[var(--color-ggd-neon-green)]">Bầy Vịt</span>
            </div>
            {testMode && (
              <div className="ggd-tag bg-[var(--color-ggd-gold)] text-[var(--color-ggd-outline)] animate-pulse">
                TEST MODE
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <div className="ggd-card-green ggd-stripe animate-slide-up opacity-0" style={{ animationDelay: '0.1s' }}>
          <div className="flex items-center justify-between px-5 py-3 bg-[var(--color-ggd-neon-green)] rounded-t-[6px]">
            <div className="flex items-center gap-4">
              <span className="font-display text-lg text-[var(--color-ggd-outline)]">
                🦆 Danh Sách Vịt
              </span>
              <span className="ggd-tag bg-[var(--color-ggd-outline)] text-[var(--color-ggd-neon-green)]">
                {selectedCount} đã chọn
              </span>
              {shieldsInUse > 0 && (
                <span className="ggd-tag bg-[var(--color-ggd-sky)] text-[var(--color-ggd-outline)]">
                  🛡️ {shieldsInUse} khiên
                </span>
              )}
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="text-6xl animate-bob">🦆</div>
            </div>
          ) : (
            <div className="py-1">
              {players.map((player, idx) => (
                <div
                  key={player.userId}
                  onClick={() => handleTogglePlayerRequest(player.userId)}
                  className={`
                    grid grid-cols-[50px_1fr_90px_100px_140px] gap-0 items-center
                    px-5 py-4 cursor-pointer transition-all duration-200
                    duck-row
                    ${player.selected ? '' : 'opacity-25'}
                    ${player.useShield ? 'shielded' : ''}
                    animate-slide-right opacity-0
                  `}
                  style={{ animationDelay: `${0.15 + idx * 0.05}s` }}
                >
                  <div className="flex items-center">
                    <div className={`w-9 h-9 flex items-center justify-center rounded-xl border-3 border-[var(--color-ggd-outline)] transition-colors
                      shadow-[inset_0_2px_0_rgba(255,255,255,0.1),0_2px_0_var(--color-ggd-outline)]
                      ${player.selected ? 'bg-[var(--color-ggd-neon-green)]' : 'bg-[var(--color-ggd-panel)]'}`}>
                      {player.selected && (
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                          <path d="M2 7L5.5 10.5L12 3.5" stroke="var(--color-ggd-outline)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-10 rounded-full ${player.useShield ? 'bg-[var(--color-ggd-sky)] shadow-[0_0_6px_rgba(61,200,255,0.5)]' :
                      player.selected ? 'bg-[var(--color-ggd-neon-green)] shadow-[0_0_6px_rgba(61,255,143,0.3)]' : 'bg-[var(--color-ggd-muted)]/20'}`} />
                    <div>
                      <div className="font-body text-base font-extrabold text-white tracking-wide">
                        {player.name}
                        {player.name === 'Thomas' && <span className="ml-2 ggd-tag bg-[var(--color-ggd-gold)] text-[var(--color-ggd-outline)] text-[10px] py-0">BẤT TỬ ✨</span>}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="font-data text-xs text-[var(--color-ggd-muted)]">
                          {player.scars > 0 ? (<span className="text-[var(--color-ggd-orange)]">🤕 {player.scars} Sẹo</span>) : 'Sạch sẽ ✨'}
                        </span>
                        <span className="font-data text-xs text-[var(--color-ggd-muted)]">
                          {player.availableShields > 9000 ? (<span className="text-[var(--color-ggd-neon-green)]">🛡️ ∞</span>) :
                            player.availableShields > 0 ? (<span className="text-[var(--color-ggd-neon-green)]">🛡️ {player.availableShields}</span>) : 'Không khiên'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="text-center">
                    <span className={`font-data text-xl font-extrabold ${player.scars > 0 ? 'text-[var(--color-ggd-orange)]' : 'text-[var(--color-ggd-muted)]/15'}`}>
                      {player.scars}
                    </span>
                    <div className="font-data text-[10px] text-[var(--color-ggd-muted)]/50 mt-0.5 uppercase">Sẹo</div>
                  </div>

                  <div className="text-center">
                    <span className={`font-data text-xl font-extrabold ${player.availableShields > 0 ? 'text-[var(--color-ggd-neon-green)]' : 'text-[var(--color-ggd-muted)]/15'}`}>
                      {player.availableShields > 9000 ? '∞' : player.availableShields}
                    </span>
                    <div className="font-data text-[10px] text-[var(--color-ggd-muted)]/50 mt-0.5 uppercase">Khiên</div>
                  </div>

                  <div className="flex justify-center" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => handleToggleShield(player.userId)}
                      disabled={!player.selected || player.availableShields <= 0 || player.name === 'Thomas'}
                      className={`ggd-btn text-sm px-5 py-2
                        disabled:opacity-15 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none
                        ${player.useShield
                          ? 'bg-[var(--color-ggd-neon-green)] text-[var(--color-ggd-outline)]'
                          : 'bg-[var(--color-ggd-panel)] text-[var(--color-ggd-muted)] hover:bg-[var(--color-ggd-surface-2)]'
                        }`}
                    >
                      {player.useShield ? '🛡️ Đang Bật' : 'Bật Khiên'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {error && (
          <div className="ggd-card-orange p-4">
            <span className="font-data text-base text-white font-bold">⚠️ LỖI: {error}</span>
          </div>
        )}

        {shieldsInUse > 0 && (
          <div className="ggd-card p-5 border-[var(--color-ggd-sky)] animate-slide-up opacity-0" style={{ animationDelay: '0.5s' }}>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-3 h-3 bg-[var(--color-ggd-sky)] rounded-full animate-pulse shadow-[0_0_8px_rgba(61,200,255,0.6)]" />
              <span className="font-display text-lg text-[var(--color-ggd-sky)] text-outlined">🛡️ Khiên Đang Bật</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {players.filter((p) => p.selected && p.useShield).map((p) => (
                <span key={p.userId} className="ggd-tag bg-[var(--color-ggd-sky)] text-[var(--color-ggd-outline)]">{p.name}</span>
              ))}
            </div>
            <p className="font-body text-sm text-[var(--color-ggd-muted)] mt-2">
              Vịt có khiên sẽ thoát kiếp dzịt nếu về cuối. Phận dzịt chuyển cho vịt kế tiếp! 🦆
            </p>
          </div>
        )}

        <div className="flex items-center justify-between pt-2 animate-slide-up opacity-0" style={{ animationDelay: '0.4s' }}>
          <Link href="/">
            <button className="font-display text-lg text-[var(--color-ggd-muted)] hover:text-white transition-colors px-4 py-3">
              ← Hủy
            </button>
          </Link>
          <button
            onClick={handleStartRace}
            disabled={selectedCount < 2 || starting}
            className={`ggd-btn text-xl px-12 py-4
              disabled:opacity-25 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none
              ${starting
                ? 'bg-[var(--color-ggd-gold)] text-[var(--color-ggd-outline)]'
                : 'bg-[var(--color-ggd-orange)] text-white'
              }`}
          >
            <span className="flex items-center gap-3">
              {starting ? (<><span className="animate-spin">🥚</span> Đang Khởi Động...</>)
                : (<>🦆 Chạy Đi Các Vịt! ({selectedCount})</>)}
            </span>
          </button>
        </div>
      </main>

      <AlertDialog open={playerToRemove !== null} onOpenChange={(open) => !open && setPlayerToRemove(null)}>
        <AlertDialogContent className="bg-[var(--color-ggd-surface)] border-4 border-[var(--color-ggd-outline)] text-white rounded-2xl shadow-[0_6px_0_var(--color-ggd-outline),0_12px_30px_rgba(0,0,0,0.6)]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[var(--color-ggd-orange)] font-display text-2xl text-outlined">
              🦆 Bỏ Vịt Ra?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[var(--color-ggd-lavender)] text-base">
              Chắc chắn muốn bỏ <strong className="text-white">{players.find(p => p.userId === playerToRemove)?.name}</strong> ra khỏi trận?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="ggd-btn bg-[var(--color-ggd-panel)] text-[var(--color-ggd-muted)] hover:bg-[var(--color-ggd-surface-2)] text-sm">
              Thôi
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmRemovePlayer} className="ggd-btn bg-[var(--color-ggd-orange)] text-white text-sm">
              Bỏ Ra 🦆
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
