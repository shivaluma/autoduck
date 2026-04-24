'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { ChestEffect, PlayerData } from '@/lib/types'
import { ChestConfigCard } from '@/components/chest-config-card'
import { ChestIcon } from '@/components/chest-icon'
import { ShieldChip } from '@/components/shield-chip'
import { MYSTERY_CHESTS_ENABLED } from '@/lib/feature-flags'
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
  isImmortal?: boolean
  activeShields: PlayerData['activeShields']
  activeChest: PlayerData['activeChest']
}

interface ChestConfigState {
  chestId: number
  ownerId: number
  effect: ChestEffect
  targetUserId?: number
}

const TARGETED_EFFECTS = new Set<ChestEffect>()

const EFFECT_DESCRIPTIONS: Record<ChestEffect, string> = {
  BONUS_SCAR: '+1 sẹo ngay lập tức, có thể auto craft shield nếu đủ 2 sẹo.',
  FRAGILE_SHIELD: '+1 khiên tạm 1 charge. Race sau không dùng là vỡ.',
  CLONE_CHAOS: 'Race sau toàn lobby +1 clone, tạo một round hỗn loạn nhẹ.',
  SAFE_WEEK: 'Race sau shield không decay sau khi resolve.',
  REVERSE_RESULTS: 'Race sau đảo ngược bảng kết quả trước khi tính phạt.',
  LAST_LAUGH: 'Nếu chủ rương thành dzịt, kéo người an toàn gần nhất xuống làm dzịt theo.',
  ANTI_SHIELD: 'Race sau toàn lobby không được dùng shield thường.',
  CANT_PASS_THOMAS: 'Race sau ai vượt Thomas sẽ bị tính thua.',
  GOLDEN_SHIELD: 'Nhận ngay 1 shield full 3 charge.',
  MORE_PEOPLE_MORE_FUN: 'Race sau số người thua tăng thành 3 hoặc 4.',
  LUCKY_CLONE: 'Legacy effect đã ngưng dùng.',
  NOTHING: 'Legacy effect đã ngưng dùng.',
  CURSE_SWAP: 'Legacy effect đã ngưng dùng.',
  INSURANCE_FRAUD: 'Legacy effect đã ngưng dùng.',
  IDENTITY_THEFT: 'Legacy effect đã ngưng dùng.',
  PUBLIC_SHIELD: 'Legacy effect đã ngưng dùng.',
  I_CHOOSE_YOU: 'Legacy effect đã ngưng dùng.',
}

export function NewRaceContent({ testMode, secretKey }: { testMode: boolean; secretKey?: string }) {
  const router = useRouter()

  const [players, setPlayers] = useState<ParticipantSetup[]>([])
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [playerToRemove, setPlayerToRemove] = useState<number | null>(null)
  const [confirmStartOpen, setConfirmStartOpen] = useState(false)
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
            useShield: Boolean(player.isImmortal),
            selectedShieldId: undefined,
            availableShields: player.activeShields.length,
            scars: player.scars,
            cleanStreak: player.cleanStreak,
            isBoss: player.isBoss,
            isImmortal: player.isImmortal,
            activeShields: player.activeShields,
            activeChest: player.activeChest,
          }))
        )

        const initialChestConfigs: Record<number, ChestConfigState> = {}
        if (MYSTERY_CHESTS_ENABLED) {
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
        }

        setChestConfigs(initialChestConfigs)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const selectedPlayers = useMemo(() => players.filter((player) => player.selected), [players])
  const selectedCount = selectedPlayers.length
  const shieldsInUse = selectedPlayers.filter((player) => player.useShield).length
  const activeSelectedChests = MYSTERY_CHESTS_ENABLED
    ? selectedPlayers
        .map((player) => player.activeChest ? { ownerName: player.name, chest: player.activeChest } : null)
        .filter((value): value is { ownerName: string; chest: NonNullable<PlayerData['activeChest']> } => Boolean(value))
    : []

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

  const extraBossEntries = selectedPlayers
    .filter((player) => player.isBoss)
    .reduce((sum, player) => sum + Math.max(player.cleanStreak, 3), 0)
  const hasCloneChaos = activeSelectedChests.some(({ chest }) => chest.effect === 'CLONE_CHAOS')
  const extraItemEntries = hasCloneChaos ? selectedCount : 0
  const totalEntries = selectedCount + extraBossEntries + extraItemEntries
  const canStartRace = selectedCount >= 2 && chestConfigErrors.length === 0 && !starting
  const bossCount = selectedPlayers.filter((player) => player.isBoss).length
  const armedShieldCount = selectedPlayers.filter((player) => player.useShield && !player.isImmortal).length
  const highScarPlayers = selectedPlayers.filter((player) => player.scars >= 6)
  const cleanDuckName = (name: string) => name.replace(/^Zịt\s+/i, '')
  const riskScore = (player: ParticipantSetup) =>
    (player.selected ? 1000 : 0) +
    (player.isBoss ? 600 : 0) +
    (player.useShield && !player.isImmortal ? 260 : 0) +
    (player.activeChest ? 180 : 0) +
    (player.scars * 24) +
    (player.cleanStreak * 18) +
    (player.isImmortal ? -80 : 0)
  const orderedPlayers = useMemo(
    () => [...players].sort((left, right) => riskScore(right) - riskScore(left)),
    [players]
  )
  const dramaWatch = [
    ...selectedPlayers
      .filter((player) => player.isBoss)
      .map((player) => `Boss ${cleanDuckName(player.name)} phải né top 2 cuối với ${Math.max(player.cleanStreak, 3) + 1} entries`),
    ...highScarPlayers.map((player) => `${cleanDuckName(player.name)} đang giữ ${player.scars} sẹo, chỉ chờ thêm drama`),
    ...activeSelectedChests.map(({ ownerName, chest }) => `${cleanDuckName(ownerName)} mang modifier ${chest.effect.replaceAll('_', ' ')}`),
  ].slice(0, 5)

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

  const handleStartRaceRequest = () => {
    if (!canStartRace) {
      setError(chestConfigErrors[0] ?? 'Cần ít nhất 2 người chơi')
      return
    }

    setConfirmStartOpen(true)
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
              useShield: !player.selected ? player.useShield : Boolean(player.isImmortal),
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

        if (player.isImmortal) {
          return {
            ...player,
            useShield: true,
            selectedShieldId: undefined,
          }
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

      <header className="border-b-3 border-[var(--color-ggd-outline)]/75">
        <div className="max-w-6xl mx-auto px-4 py-4 flex flex-col gap-2 sm:px-6 sm:flex-row sm:items-center sm:justify-between">
          <Link href="/" className="font-data text-sm text-[var(--color-ggd-muted)] hover:text-white transition-colors">
            ← Về Chuồng
          </Link>
          <div className="flex flex-wrap items-center gap-3 animate-slide-right">
            <div className="font-display text-xl text-white text-outlined">
              🦆 Setup <span className="text-[var(--color-ggd-neon-green)]">Race</span>
            </div>
            {testMode && (
              <div className="ggd-tag bg-[var(--color-ggd-gold)] text-[var(--color-ggd-outline)] animate-pulse">
                TEST MODE
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-4 space-y-4 sm:px-6 sm:py-6">
        <div className="rounded-lg border-2 border-[var(--color-ggd-outline)]/70 bg-[rgba(16,18,35,0.78)] px-3 py-2 backdrop-blur">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-data text-xs text-white/76">
              <span className="text-[var(--color-ggd-neon-green)]">🐥 {selectedCount} ready</span>
              <span>🎟 {totalEntries} entries</span>
              <span>👑 {bossCount} boss</span>
              <span>🛡 {armedShieldCount} armed</span>
              {activeSelectedChests.length > 0 && <span>⚙ {activeSelectedChests.length} modifiers</span>}
            </div>
            <button
              onClick={handleStartRaceRequest}
              disabled={!canStartRace}
              title={!canStartRace ? chestConfigErrors[0] ?? 'Cần ít nhất 2 người chơi' : undefined}
              className="ggd-btn bg-[var(--color-ggd-neon-green)] px-4 py-2 font-display text-sm text-[var(--color-ggd-outline)] disabled:cursor-not-allowed disabled:opacity-30"
            >
              {starting ? '🥚 Đang chạy...' : '🚀 RUN'}
            </button>
          </div>
        </div>

        <div className="ggd-card animate-slide-up opacity-0" style={{ animationDelay: '0.1s' }}>
          <div className="flex flex-col gap-2 px-4 py-3 border-b-2 border-[var(--color-ggd-outline)]/45 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-3 sm:gap-4">
              <span className="font-display text-lg text-white text-outlined">🐥 Chọn Đội Hình</span>
              <span className="ggd-tag bg-[var(--color-ggd-neon-green)] text-[var(--color-ggd-outline)]">
                ✅ {selectedCount} Ready
              </span>
              {shieldsInUse > 0 && (
                <span className="ggd-tag bg-[var(--color-ggd-sky)] text-[var(--color-ggd-outline)]">🛡️ {shieldsInUse} Shield ON</span>
              )}
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="text-6xl animate-bob">🦆</div>
            </div>
          ) : (
            <div className="py-1">
              {orderedPlayers.map((player, index) => {
                return (
                  <div
                    key={player.userId}
                    onClick={() => handleTogglePlayerRequest(player.userId)}
                    className={`px-3 py-2.5 cursor-pointer transition-all duration-200 duck-row animate-slide-right opacity-0
                      ${player.selected ? '' : 'opacity-30'}
                      ${player.useShield ? 'shielded shield-armed' : ''}
                    `}
                    style={{ animationDelay: `${0.15 + index * 0.05}s` }}
                  >
                    <div className="grid grid-cols-1 gap-2 items-center sm:grid-cols-[38px_minmax(0,1fr)_minmax(180px,auto)]">
                      <div>
                        <div className={`w-8 h-8 flex items-center justify-center rounded-lg border-3 border-[var(--color-ggd-outline)] transition-colors
                          shadow-[inset_0_2px_0_rgba(255,255,255,0.1),0_2px_0_var(--color-ggd-outline)]
                          ${player.selected ? 'bg-[var(--color-ggd-neon-green)]' : 'bg-[var(--color-ggd-panel)]'}`}>
                          {player.selected && (
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                              <path d="M2 7L5.5 10.5L12 3.5" stroke="var(--color-ggd-outline)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </div>
                      </div>

                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-3">
                          <div className={`w-1.5 h-9 rounded-full ${player.useShield ? 'bg-[var(--color-ggd-sky)] shadow-[0_0_6px_rgba(61,200,255,0.5)]' :
                            player.selected ? 'bg-[var(--color-ggd-neon-green)] shadow-[0_0_6px_rgba(61,255,143,0.3)]' : 'bg-[var(--color-ggd-muted)]/20'}`} />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="font-body text-base font-extrabold text-white tracking-wide">{player.name}</div>
                              {player.isBoss && <span className="ggd-tag bg-[var(--color-ggd-gold)] text-[var(--color-ggd-outline)] text-[10px] px-2 py-0">👑 Boss {player.cleanStreak}</span>}
                              {player.isImmortal && <span className="ggd-tag bg-[var(--color-ggd-sky)] text-[var(--color-ggd-outline)] text-[10px] px-2 py-0">∞ Auto Shield ON</span>}
                              {player.cleanStreak > 0 && (
                                <span className={`ggd-tag text-[10px] px-2 py-0 ${player.cleanStreak >= 3 ? 'bg-[var(--color-ggd-gold)] text-[var(--color-ggd-outline)]' : 'bg-[var(--color-ggd-panel)] text-[var(--color-ggd-neon-green)]'}`}>
                                  🔥 {player.cleanStreak} streak
                                </span>
                              )}
                              {MYSTERY_CHESTS_ENABLED && player.activeChest && <ChestIcon effect={player.activeChest.effect} compact />}
                              <span className="font-data text-xs text-[var(--color-ggd-muted)]">
                                {player.scars > 0 ? <span className="text-[var(--color-ggd-orange)]">🤕 {player.scars} Sẹo</span> : 'Sạch sẽ ✨'}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-left sm:justify-end" onClick={(event) => event.stopPropagation()}>
                        {player.selected ? (
                          player.isImmortal ? (
                            <span className="ggd-tag bg-[var(--color-ggd-sky)] text-[var(--color-ggd-outline)] text-[10px] px-2 py-0">♾ Auto shield</span>
                          ) : player.activeShields.length > 0 ? (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  if (player.selectedShieldId) {
                                    handleSelectShield(player.userId, player.selectedShieldId)
                                  }
                                }}
                                className={`rounded-full border-2 border-[var(--color-ggd-outline)] px-3 py-1 font-data text-[11px] font-black transition-colors
                                  ${player.useShield
                                    ? 'bg-[var(--color-ggd-panel)] text-white/55 hover:text-white'
                                    : 'bg-white/12 text-white'
                                  }`}
                              >
                                Không khiên
                              </button>
                              {player.activeShields.map((shield) => (
                                <ShieldChip
                                  key={shield.id}
                                  id={shield.id}
                                  charges={shield.charges}
                                  selected={player.selectedShieldId === shield.id}
                                  onClick={() => handleSelectShield(player.userId, shield.id)}
                                />
                              ))}
                            </>
                          ) : (
                            <span className="font-data text-xs text-[var(--color-ggd-muted)]/70">Không có khiên</span>
                          )
                        ) : (
                          <span className="font-data text-xs font-black uppercase text-white/40">OUT</span>
                        )}
                      </div>
                    </div>
	                  </div>
	                )
              })}
            </div>
          )}
        </div>

        {activeSelectedChests.length > 0 && (
          <div className="ggd-card-orange animate-slide-up opacity-0" style={{ animationDelay: '0.2s' }}>
            <div className="px-5 py-3 border-b-3 border-[var(--color-ggd-outline)]/30">
              <div className="font-display text-lg text-white text-outlined">⚙️ Tình Trạng Trước Race</div>
              <p className="font-body text-sm text-white/70 mt-1">Modifier đang armed, race vào là tự nổ.</p>
            </div>
            <div className="p-5 space-y-4">
              {activeSelectedChests.map(({ ownerName, chest }) => {
                const selectedTarget = chestConfigs[chest.id]?.targetUserId
                const targetOptions = selectedPlayers.filter((player) => {
                  if (player.userId === chest.ownerId) {
                    return false
                  }
                  return true
                })

                return (
                  <ChestConfigCard
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
                      shieldCount: undefined,
                    }))}
                    onTargetChange={(targetUserId?: number) =>
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
            <div className="font-display text-lg text-white text-outlined">🎬 Tổng Quan Drama Tuần Này</div>
          </div>
          <div className="p-5 space-y-3">
            <div className="font-body text-white/85">🎬 Race Intel</div>
            <div className="font-data text-sm text-[var(--color-ggd-muted)] space-y-1">
              <div>🐥 {selectedCount} vịt tham chiến</div>
              <div>👑 +{extraBossEntries} clone từ Boss system</div>
              <div>⚙️ +{extraItemEntries} entries từ item clone</div>
              <div>🛡 {shieldsInUse} khiên đang armed</div>
              <div>🎟 Tổng {totalEntries} entries vào race</div>
            </div>

            {dramaWatch.length > 0 && (
              <div className="pt-3 border-t border-[var(--color-ggd-outline)]/30">
                <div className="font-body text-white/85 mb-2">⚠ Drama Watch</div>
                <div className="font-data text-sm text-[var(--color-ggd-muted)] space-y-1">
                  {dramaWatch.map((line) => (
                    <div key={line}>• {line}</div>
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

        <div className="flex flex-col gap-3 pt-1 animate-slide-up opacity-0 sm:flex-row sm:items-center sm:justify-between" style={{ animationDelay: '0.4s' }}>
          <Link href="/" className="w-full sm:w-auto">
            <button className="w-full font-display text-base text-[var(--color-ggd-muted)] hover:text-white transition-colors px-3 py-2 sm:w-auto">
              ← Hủy
            </button>
          </Link>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Link href="/rules" className="w-full sm:w-auto">
              <button
                className="w-full font-display text-base tracking-widest uppercase px-5 py-2.5 sm:w-auto
                  border-4 border-[var(--color-ggd-outline)] rounded-lg cursor-pointer
                  transition-all duration-100
                  bg-[var(--color-ggd-gold)] text-[var(--color-ggd-outline)]
                  shadow-[inset_0_2px_0_rgba(255,255,255,0.35),0_4px_0_#7a6000,0_8px_18px_rgba(0,0,0,0.35)]
                  hover:-translate-y-0.5 hover:shadow-[inset_0_2px_0_rgba(255,255,255,0.35),0_5px_0_#7a6000,0_10px_20px_rgba(255,204,0,0.2)]
                  active:translate-y-[3px] active:shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_1px_0_#7a6000]"
              >
                📜 Rules V2
              </button>
            </Link>
            <button
              onClick={handleStartRaceRequest}
              disabled={!canStartRace}
              title={!canStartRace ? chestConfigErrors[0] ?? 'Cần ít nhất 2 người chơi' : undefined}
              className={`w-full font-display text-lg tracking-widest uppercase px-6 py-3 sm:w-auto sm:px-8
                border-4 border-[var(--color-ggd-outline)] rounded-lg cursor-pointer
                transition-all duration-100
                disabled:opacity-25 disabled:cursor-not-allowed disabled:shadow-none
                ${starting
                  ? 'bg-[var(--color-ggd-gold)] text-[var(--color-ggd-outline)] shadow-[inset_0_2px_0_rgba(255,255,255,0.35),0_4px_0_#7a6000,0_8px_18px_rgba(0,0,0,0.4)]'
                  : 'bg-[var(--color-ggd-neon-green)] text-[var(--color-ggd-outline)] shadow-[inset_0_2px_0_rgba(255,255,255,0.45),0_4px_0_#007a3a,0_8px_20px_rgba(61,255,143,0.28)] hover:-translate-y-0.5 hover:shadow-[inset_0_2px_0_rgba(255,255,255,0.45),0_5px_0_#007a3a,0_10px_22px_rgba(61,255,143,0.32)] active:translate-y-[3px] active:shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_1px_0_#007a3a]'
                }`}
            >
              <span className="flex items-center gap-3">
                {starting ? <><span className="animate-spin">🥚</span> Đang Khởi Động...</> : <>🦆 Chạy Đua! ({selectedCount})</>}
              </span>
            </button>
          </div>
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

      <AlertDialog open={confirmStartOpen} onOpenChange={setConfirmStartOpen}>
        <AlertDialogContent className="bg-[var(--color-ggd-surface)] border-4 border-[var(--color-ggd-outline)] text-white rounded-2xl shadow-[0_6px_0_var(--color-ggd-outline),0_12px_30px_rgba(0,0,0,0.6)]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[var(--color-ggd-neon-green)] font-display text-3xl text-outlined">
              Ready to unleash chaos?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[var(--color-ggd-lavender)] text-base">
              {selectedCount} vịt, {totalEntries} entries, {bossCount} Boss active, {shieldsInUse} khiên armed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-xl border-3 border-[var(--color-ggd-outline)] bg-black/25 p-4 font-data text-sm text-white/78 space-y-1">
            <div>🐥 {selectedCount} Ducks Ready</div>
            <div>🎟 {totalEntries} entries vào race</div>
            <div>👑 {bossCount} Boss active</div>
            <div>🛡 {shieldsInUse} Shield Armed</div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel className="ggd-btn bg-[var(--color-ggd-panel)] text-[var(--color-ggd-muted)] hover:bg-[var(--color-ggd-surface-2)] text-sm">
              Khoan
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleStartRace} className="ggd-btn bg-[var(--color-ggd-neon-green)] text-[var(--color-ggd-outline)] text-sm">
              RUN IT 🦆
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
