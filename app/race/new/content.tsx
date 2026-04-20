'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { ChestEffect, PlayerData } from '@/lib/types'
import { BossBadge } from '@/components/boss-badge'
import { ChestCard } from '@/components/chest-card'
import { ChestIcon } from '@/components/chest-icon'
import { ShieldChip } from '@/components/shield-chip'
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
  selectedShieldId?: number
  availableShields: number
  scars: number
  cleanStreak: number
  isBoss: boolean
  activeShields: PlayerData['activeShields']
  activeChest: PlayerData['activeChest']
}

interface ChestConfigState {
  chestId: number
  ownerId: number
  effect: ChestEffect
  targetUserId?: number
}

const TARGETED_EFFECTS = new Set<ChestEffect>([
  'CURSE_SWAP',
  'INSURANCE_FRAUD',
  'PUBLIC_SHIELD',
  'I_CHOOSE_YOU',
])

const EFFECT_DESCRIPTIONS: Record<ChestEffect, string> = {
  NOTHING: 'Rương trống trơn, không cần cấu hình.',
  CURSE_SWAP: 'Đổi display name trong race với một vịt khác.',
  INSURANCE_FRAUD: 'Nếu chủ rương ăn sẹo, mục tiêu sẽ bị kéo chết theo.',
  IDENTITY_THEFT: 'Spawn thêm 1 clone và lấy rank tốt hơn giữa 2 bản thể.',
  PUBLIC_SHIELD: 'Mượn 1 khiên của người khác, khiên đó sẽ bị tiêu hao vĩnh viễn.',
  I_CHOOSE_YOU: 'Nếu mục tiêu về P1, chủ rương được +1 khiên.',
}

export function NewRaceContent({ testMode, secretKey }: { testMode: boolean; secretKey?: string }) {
  const router = useRouter()

  const [players, setPlayers] = useState<ParticipantSetup[]>([])
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [playerToRemove, setPlayerToRemove] = useState<number | null>(null)
  const [chestConfigs, setChestConfigs] = useState<Record<number, ChestConfigState>>({})

  useEffect(() => {
    fetch('/api/users')
      .then((response) => response.json())
      .then((data: PlayerData[]) => {
        setPlayers(
          data.map((player) => ({
            userId: player.id,
            name: player.name,
            selected: true,
            useShield: false,
            selectedShieldId: undefined,
            availableShields: player.activeShields.length,
            scars: player.scars,
            cleanStreak: player.cleanStreak,
            isBoss: player.isBoss,
            activeShields: player.activeShields,
            activeChest: player.activeChest,
          }))
        )

        const initialChestConfigs: Record<number, ChestConfigState> = {}
        for (const player of data) {
          if (!player.activeChest || player.activeChest.effect === 'NOTHING') {
            continue
          }

          initialChestConfigs[player.activeChest.id] = {
            chestId: player.activeChest.id,
            ownerId: player.id,
            effect: player.activeChest.effect,
          }
        }

        setChestConfigs(initialChestConfigs)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const selectedPlayers = useMemo(() => players.filter((player) => player.selected), [players])
  const selectedCount = selectedPlayers.length
  const shieldsInUse = selectedPlayers.filter((player) => player.useShield).length
  const activeSelectedChests = selectedPlayers
    .map((player) => player.activeChest ? { ownerName: player.name, chest: player.activeChest } : null)
    .filter((value): value is { ownerName: string; chest: NonNullable<PlayerData['activeChest']> } => Boolean(value))

  const chestConfigErrors = activeSelectedChests.flatMap(({ ownerName, chest }) => {
    if (!TARGETED_EFFECTS.has(chest.effect)) {
      return []
    }

    const config = chestConfigs[chest.id]
    if (!config?.targetUserId) {
      return [`Cần chọn mục tiêu cho rương của ${ownerName}`]
    }

    if (!selectedPlayers.some((player) => player.userId === config.targetUserId)) {
      return [`Mục tiêu của rương ${ownerName} phải nằm trong danh sách tham gia`]
    }

    if (config.targetUserId === chest.ownerId) {
      return [`Rương của ${ownerName} không thể chọn chính chủ`]
    }

    if (chest.effect === 'PUBLIC_SHIELD') {
      const target = selectedPlayers.find((player) => player.userId === config.targetUserId)
      if (!target || target.activeShields.length === 0) {
        return [`Public Shield của ${ownerName} cần mượn từ người đang có khiên`]
      }
    }

    return []
  })

  const extraBossEntries = selectedPlayers.filter((player) => player.isBoss).length * 3
  const extraIdentityEntries = activeSelectedChests.filter(({ chest }) => chest.effect === 'IDENTITY_THEFT').length
  const borrowedShieldCount = activeSelectedChests.filter(({ chest }) => chest.effect === 'PUBLIC_SHIELD').length
  const totalEntries = selectedCount + extraBossEntries + extraIdentityEntries
  const canStartRace = selectedCount >= 2 && chestConfigErrors.length === 0 && !starting

  const handleTogglePlayerRequest = (userId: number) => {
    const player = players.find((candidate) => candidate.userId === userId)
    if (!player) {
      return
    }

    if (player.selected) {
      setPlayerToRemove(userId)
      return
    }

    togglePlayerRef(userId)
  }

  const confirmRemovePlayer = () => {
    if (playerToRemove !== null) {
      togglePlayerRef(playerToRemove)
      setPlayerToRemove(null)
    }
  }

  const togglePlayerRef = (userId: number) => {
    setPlayers((previous) =>
      previous.map((player) =>
        player.userId === userId
          ? {
              ...player,
              selected: !player.selected,
              useShield: !player.selected ? player.useShield : false,
              selectedShieldId: !player.selected ? player.selectedShieldId : undefined,
            }
          : player
      )
    )
  }

  const handleSelectShield = (userId: number, shieldId: number) => {
    setPlayers((previous) =>
      previous.map((player) => {
        if (player.userId !== userId) {
          return player
        }

        if (!player.selected) {
          return player
        }

        const isSameShield = player.selectedShieldId === shieldId
        return {
          ...player,
          useShield: !isSameShield,
          selectedShieldId: isSameShield ? undefined : shieldId,
        }
      })
    )
  }

  const updateChestTarget = (chestId: number, ownerId: number, effect: ChestEffect, targetUserId?: number) => {
    setChestConfigs((previous) => ({
      ...previous,
      [chestId]: {
        chestId,
        ownerId,
        effect,
        targetUserId,
      },
    }))
  }

  const handleStartRace = async () => {
    if (!canStartRace) {
      setError(chestConfigErrors[0] ?? 'Không thể bắt đầu race')
      return
    }

    setCountdown(5)
    for (let index = 4; index >= 0; index -= 1) {
      await new Promise((resolve) => setTimeout(resolve, 600))
      setCountdown(index)
    }
    await new Promise((resolve) => setTimeout(resolve, 400))

    setCountdown(null)
    setStarting(true)
    setError(null)

    const participants = selectedPlayers
      .map((player) => ({
        userId: player.userId,
        useShield: player.useShield,
        shieldId: player.selectedShieldId,
      }))
      .sort(() => Math.random() - 0.5)

    const payloadChestConfigs = activeSelectedChests.map(({ chest }) => ({
      chestId: chest.id,
      targetUserId: chestConfigs[chest.id]?.targetUserId,
    }))

    try {
      const response = await fetch('/api/races/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          participants,
          chestConfigs: payloadChestConfigs,
          test: testMode,
          secret: secretKey,
        }),
      })
      const data = await response.json()
      if (!response.ok) {
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

  if (countdown !== null) {
    return (
      <div className="min-h-screen bg-transparent flex items-center justify-center">
        <div className="text-center">
          {countdown > 0 ? (
            <>
              <div className="flex gap-5 mb-12 justify-center">
                {[5, 4, 3, 2, 1].map((value) => (
                  <div
                    key={value}
                    className={`w-16 h-16 rounded-full border-4 border-[var(--color-ggd-outline)] transition-all duration-300 flex items-center justify-center text-2xl
                      shadow-[inset_0_2px_0_rgba(255,255,255,0.1),0_4px_0_var(--color-ggd-outline)]
                      ${countdown <= value
                        ? 'bg-[var(--color-ggd-orange)] scale-110 shadow-[0_0_25px_rgba(255,87,51,0.5)]'
                        : 'bg-[var(--color-ggd-panel)] scale-90 opacity-30'
                      }`}
                  >
                    {countdown <= value ? '🥚' : ''}
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
                {[5, 4, 3, 2, 1].map((value) => (
                  <div
                    key={value}
                    className="w-16 h-16 rounded-full bg-[var(--color-ggd-neon-green)] border-4 border-[var(--color-ggd-outline)]
                      shadow-[0_0_25px_rgba(61,255,143,0.5),0_4px_0_var(--color-ggd-outline)]
                      flex items-center justify-center text-2xl animate-wiggle-duck"
                    style={{ animationDelay: `${value * 0.05}s` }}
                  >
                    🐣
                  </div>
                ))}
              </div>
              <div className="font-display text-[90px] text-[var(--color-ggd-neon-green)] leading-none text-outlined glow-green">
                QUACK QUACK!
              </div>
              <div className="font-body text-2xl text-white/70 mt-4 font-bold">🦆 Chạy đi các vịt ơiiiii! 🦆</div>
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
              🦆 Setup <span className="text-[var(--color-ggd-neon-green)]">Race V2</span>
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
              <span className="font-display text-lg text-[var(--color-ggd-outline)]">Section A. Danh Sách Vịt</span>
              <span className="ggd-tag bg-[var(--color-ggd-outline)] text-[var(--color-ggd-neon-green)]">
                {selectedCount} đã chọn
              </span>
              {shieldsInUse > 0 && (
                <span className="ggd-tag bg-[var(--color-ggd-sky)] text-[var(--color-ggd-outline)]">🛡️ {shieldsInUse} khiên bật</span>
              )}
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="text-6xl animate-bob">🦆</div>
            </div>
          ) : (
            <div className="py-1">
              {players.map((player, index) => (
                <div
                  key={player.userId}
                  onClick={() => handleTogglePlayerRequest(player.userId)}
                  className={`px-5 py-4 cursor-pointer transition-all duration-200 duck-row animate-slide-right opacity-0
                    ${player.selected ? '' : 'opacity-30'}
                    ${player.useShield ? 'shielded' : ''}
                  `}
                  style={{ animationDelay: `${0.15 + index * 0.05}s` }}
                >
                  <div className="grid grid-cols-[50px_1fr_170px] gap-4 items-start">
                    <div className="pt-2">
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

                    <div className="space-y-3">
                      {player.isBoss && (
                        <div className="rounded-xl border-3 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-gold)]/90 px-4 py-2 shadow-[0_4px_0_var(--color-ggd-outline)]">
                          <div><BossBadge streak={player.cleanStreak} /></div>
                          <div className="font-data text-xs text-[var(--color-ggd-outline)]/80">Race này spawn 3 clone, chỉ cần 1 clone bét là Boss ăn sẹo.</div>
                        </div>
                      )}

                      <div className="flex items-start gap-3">
                        <div className={`w-2 h-14 rounded-full ${player.useShield ? 'bg-[var(--color-ggd-sky)] shadow-[0_0_6px_rgba(61,200,255,0.5)]' :
                          player.selected ? 'bg-[var(--color-ggd-neon-green)] shadow-[0_0_6px_rgba(61,255,143,0.3)]' : 'bg-[var(--color-ggd-muted)]/20'}`} />
                        <div className="space-y-2">
                          <div className="font-body text-base font-extrabold text-white tracking-wide">{player.name}</div>
                          <div className="flex flex-wrap items-center gap-2">
                            {player.cleanStreak > 0 && (
                              <span className={`ggd-tag ${player.cleanStreak >= 3 ? 'bg-[var(--color-ggd-gold)] text-[var(--color-ggd-outline)]' : 'bg-[var(--color-ggd-panel)] text-[var(--color-ggd-neon-green)]'}`}>
                                🔥 {Math.min(player.cleanStreak, 3)}/3 tuần sạch
                              </span>
                            )}
                            {player.activeChest && <ChestIcon effect={player.activeChest.effect} compact />}
                            <span className="font-data text-xs text-[var(--color-ggd-muted)]">
                              {player.scars > 0 ? <span className="text-[var(--color-ggd-orange)]">🤕 {player.scars} Sẹo</span> : 'Sạch sẽ ✨'}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div onClick={(event) => event.stopPropagation()}>
                        <div className="font-data text-[10px] uppercase text-[var(--color-ggd-muted)] mb-2">Shield Chips</div>
                        <div className="flex flex-wrap gap-2">
                          {player.activeShields.length > 0 ? player.activeShields.map((shield) => (
                            <ShieldChip
                              key={shield.id}
                              id={shield.id}
                              weeksUnused={shield.weeksUnused}
                              selected={player.selectedShieldId === shield.id}
                              disabled={!player.selected}
                              onClick={() => handleSelectShield(player.userId, shield.id)}
                            />
                          )) : (
                            <span className="font-data text-xs text-[var(--color-ggd-muted)]/70">Không có khiên active</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="pt-2 text-right">
                      <div className="font-data text-xs uppercase text-[var(--color-ggd-muted)] mb-2">Tình Trạng</div>
                      <div className="space-y-2">
                        <div className={`font-data text-sm ${player.selected ? 'text-[var(--color-ggd-neon-green)]' : 'text-[var(--color-ggd-muted)]'}`}>
                          {player.selected ? 'Đã vào race' : 'Đang nghỉ'}
                        </div>
                        <div className="font-data text-xs text-[var(--color-ggd-muted)]">
                          {player.availableShields > 0 ? `🛡️ ${player.availableShields} khiên` : 'Không khiên'}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {activeSelectedChests.length > 0 && (
          <div className="ggd-card-orange animate-slide-up opacity-0" style={{ animationDelay: '0.2s' }}>
            <div className="px-5 py-3 border-b-3 border-[var(--color-ggd-outline)]/30">
              <div className="font-display text-lg text-white text-outlined">Section B. Mandatory Chest Configuration</div>
              <p className="font-body text-sm text-white/70 mt-1">Mọi rương active của người tham gia phải được cấu hình xong trước khi chạy đua.</p>
            </div>
            <div className="p-5 space-y-4">
              {activeSelectedChests.map(({ ownerName, chest }) => {
                const selectedTarget = chestConfigs[chest.id]?.targetUserId
                const targetOptions = selectedPlayers.filter((player) => {
                  if (player.userId === chest.ownerId) {
                    return false
                  }
                  if (chest.effect === 'PUBLIC_SHIELD') {
                    return player.activeShields.length > 0
                  }
                  return true
                })

                return (
                  <ChestCard
                    key={chest.id}
                    chestId={chest.id}
                    ownerName={ownerName}
                    effect={chest.effect}
                    description={EFFECT_DESCRIPTIONS[chest.effect]}
                    needsTarget={TARGETED_EFFECTS.has(chest.effect)}
                    targetUserId={selectedTarget}
                    targetOptions={targetOptions.map((player) => ({
                      userId: player.userId,
                      name: player.name,
                      shieldCount: chest.effect === 'PUBLIC_SHIELD' ? player.activeShields.length : undefined,
                    }))}
                    onTargetChange={(targetUserId) =>
                      updateChestTarget(chest.id, chest.ownerId, chest.effect, targetUserId)
                    }
                  />
                )
              })}
            </div>
          </div>
        )}

        <div className="ggd-card animate-slide-up opacity-0" style={{ animationDelay: '0.3s' }}>
          <div className="px-5 py-3 border-b-3 border-[var(--color-ggd-outline)]/30">
            <div className="font-display text-lg text-white text-outlined">Section C. Pre-race Summary</div>
          </div>
          <div className="p-5 space-y-3">
            <div className="font-body text-white/85">🎬 Tổng quan race:</div>
            <div className="font-data text-sm text-[var(--color-ggd-muted)] space-y-1">
              <div>• {selectedCount} vịt selected</div>
              <div>• +{extraBossEntries} entries từ Boss Duck</div>
              <div>• +{extraIdentityEntries} clone từ Identity Theft</div>
              <div>• {shieldsInUse} khiên đang bật, {borrowedShieldCount} khiên mượn</div>
              <div>• → {totalEntries} entries thật sẽ vào race</div>
            </div>

            {(selectedPlayers.some((player) => player.isBoss) || activeSelectedChests.length > 0) && (
              <div className="pt-3 border-t border-[var(--color-ggd-outline)]/30">
                <div className="font-body text-white/85 mb-2">⚠ Drama đáng xem:</div>
                <div className="font-data text-sm text-[var(--color-ggd-muted)] space-y-1">
                  {selectedPlayers.filter((player) => player.isBoss).map((player) => (
                    <div key={`boss-${player.userId}`}>• Boss {player.name} cần né 2 vị trí cuối với 4 entries</div>
                  ))}
                  {activeSelectedChests.map(({ ownerName, chest }) => (
                    <div key={`chest-${chest.id}`}>
                      • {ownerName}: {chest.effect}
                      {chestConfigs[chest.id]?.targetUserId
                        ? ` → ${players.find((player) => player.userId === chestConfigs[chest.id]?.targetUserId)?.name ?? 'đã chọn target'}`
                        : ''}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="ggd-card-orange p-4">
            <span className="font-data text-base text-white font-bold">⚠️ LỖI: {error}</span>
          </div>
        )}

        {chestConfigErrors.length > 0 && (
          <div className="ggd-card p-5 border-[var(--color-ggd-orange)]">
            <div className="font-display text-lg text-[var(--color-ggd-orange)] mb-2">Race chưa thể chạy</div>
            <div className="font-data text-sm text-white/75 space-y-1">
              {chestConfigErrors.map((message) => (
                <div key={message}>• {message}</div>
              ))}
            </div>
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
            disabled={!canStartRace}
            title={!canStartRace ? chestConfigErrors[0] ?? 'Cần ít nhất 2 người chơi' : undefined}
            className={`font-display text-2xl tracking-widest uppercase px-14 py-4
              border-[5px] border-[var(--color-ggd-outline)] rounded-xl cursor-pointer
              transition-all duration-100
              disabled:opacity-25 disabled:cursor-not-allowed disabled:shadow-none
              ${starting
                ? 'bg-[var(--color-ggd-gold)] text-[var(--color-ggd-outline)] shadow-[inset_0_3px_0_rgba(255,255,255,0.35),0_7px_0_#7a6000,0_12px_24px_rgba(0,0,0,0.5)]'
                : 'bg-[var(--color-ggd-neon-green)] text-[var(--color-ggd-outline)] shadow-[inset_0_3px_0_rgba(255,255,255,0.45),0_7px_0_#007a3a,0_12px_28px_rgba(61,255,143,0.35)] hover:-translate-y-1 hover:shadow-[inset_0_3px_0_rgba(255,255,255,0.45),0_9px_0_#007a3a,0_16px_32px_rgba(61,255,143,0.45)] active:translate-y-[5px] active:shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_2px_0_#007a3a]'
              }`}
          >
            <span className="flex items-center gap-3">
              {starting ? <><span className="animate-spin">🥚</span> Đang Khởi Động...</> : <>🦆 Chạy Đua! ({selectedCount})</>}
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
              Chắc chắn muốn bỏ <strong className="text-white">{players.find((player) => player.userId === playerToRemove)?.name}</strong> ra khỏi trận?
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
