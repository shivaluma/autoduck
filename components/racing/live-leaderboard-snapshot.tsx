'use client'

import { useMemo } from 'react'
import type { DuckSnapshot, RaceItemId, WildItemId } from '@/packages/race-protocol/src'
import { Season3Avatar } from '@/components/season3-avatar'

export type LeaderboardPlayer = {
  playerId: string
  name: string
  avatarUrl?: string | null
  itemIds?: RaceItemId[]
  isGhost?: boolean
  initialRank?: number | null
}

const EFFECT_BADGES: Record<string, { label: string; icon: string; bg: string }> = {
  BUBBLE_SHIELD: { label: 'Khiên', icon: '🫧', bg: 'bg-sky-500/20 text-sky-300 border-sky-500/30' },
  MINI_BUBBLE: { label: 'Khiên', icon: '🫧', bg: 'bg-sky-500/20 text-sky-300 border-sky-500/30' },
  NITRO: { label: 'Nitro', icon: '⚡', bg: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
  MINI_NITRO: { label: 'Mini Nitro', icon: '⚡', bg: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
  TAILWIND: { label: 'Gió Xuôi', icon: '🌊', bg: 'bg-teal-500/20 text-teal-300 border-teal-500/30' },
  DRAFT_FIN: { label: 'Draft Fin', icon: '🦈', bg: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30' },
  PADDLE_BURST: { label: 'Paddle', icon: '🛶', bg: 'bg-lime-500/20 text-lime-300 border-lime-500/30' },
  PREDATOR_RUSH: { label: 'Predator', icon: '🔥', bg: 'bg-orange-500/20 text-orange-300 border-orange-500/30' },
  SLOWED: { label: 'Choáng / Giảm tốc', icon: '💫', bg: 'bg-rose-500/20 text-rose-300 border-rose-500/30' },
  SILENCED: { label: 'Câm Lặng', icon: '🔇', bg: 'bg-purple-500/20 text-purple-300 border-purple-500/30' },
  FEATHER: { label: 'Lông Vũ', icon: '🪽', bg: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
  SHOCK_ABSORBER: { label: 'Chống Sốc', icon: '🦺', bg: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30' },
}

const ITEM_ICONS: Record<string, string> = {
  BUBBLE_SHIELD: '🫧',
  HOMING_ROCKET: '🚀',
  NITRO: '⚡',
  BANANA: '🍌',
  FEATHER: '🪽',
  QUACK_HORN: '🔊',
  DRAFT_FIN: '🦈',
  PADDLE_BURST: '🛶',
  SHOCK_ABSORBER: '🦺',
  MINI_NITRO: '⚡',
  TAILWIND: '🌊',
  MINI_BUBBLE: '🫧',
  MINI_ROCKET: '🚀',
  SLIPSTREAM_MAGNET: '🧲',
}

export function LiveLeaderboardSnapshot({
  players,
  ducks,
  highlightPlayerId,
  isLive = false,
}: {
  players: LeaderboardPlayer[]
  ducks?: DuckSnapshot[]
  highlightPlayerId?: string | null
  isLive?: boolean
}) {
  const playerMap = useMemo(() => new Map(players.map((p) => [p.playerId, p])), [players])

  // Compute standings based on ducks snapshots or fallback to players order
  const standings = useMemo(() => {
    if (ducks && ducks.length > 0) {
      const sortedDucks = [...ducks].sort((left, right) => left.rank - right.rank)
      return sortedDucks.map((duck) => {
        const info = playerMap.get(duck.playerId)
        return {
          playerId: duck.playerId,
          rank: duck.rank,
          name: info?.name ?? duck.playerId,
          avatarUrl: info?.avatarUrl,
          isGhost: info?.isGhost ?? false,
          progress: Math.min(1, Math.max(0, duck.progress)),
          speed: duck.speed,
          activeEffects: duck.activeEffects ?? [],
          wildItem: duck.wildItem,
          itemIds: info?.itemIds ?? [],
        }
      })
    }

    // Fallback static ranking
    const sorted = [...players].sort((a, b) => (a.initialRank ?? 99) - (b.initialRank ?? 99))
    return sorted.map((p, idx) => ({
      playerId: p.playerId,
      rank: idx + 1,
      name: p.name,
      avatarUrl: p.avatarUrl,
      isGhost: p.isGhost ?? false,
      progress: 0,
      speed: 1,
      activeEffects: [],
      wildItem: null,
      itemIds: p.itemIds ?? [],
    }))
  }, [ducks, playerMap, players])

  const officialStandings = useMemo(() => standings.filter((s) => !s.isGhost), [standings])
  const ghostStandings = useMemo(() => standings.filter((s) => s.isGhost), [standings])

  const bottomCutoffRank = Math.max(1, officialStandings.length - 1)

  return (
    <section className="rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] p-5 shadow-[0_6px_0_var(--color-ggd-outline)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
        <div>
          <div className="text-xs font-black tracking-[0.2em] text-[var(--color-ggd-neon-green)]">
            {isLive ? 'TIẾN ĐỘ THỜI GIAN THỰC' : 'BẢNG THỨ HẠNG CHI TIẾT'}
          </div>
          <h2 className="mt-1 font-display text-2xl">
            🏆 Bảng Xếp Hạng Vịt ({officialStandings.length})
          </h2>
        </div>
        <div className="flex items-center gap-2 text-xs font-bold text-white/50">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-rose-500" />
            Top 2 cuối (Nguy cơ bị làm Dzịt)
          </span>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {officialStandings.map((duck) => {
          const isDangerZone = duck.rank >= bottomCutoffRank && officialStandings.length > 2
          const isHighlighted = duck.playerId === highlightPlayerId
          const speedPct = Math.round(duck.speed * 100)
          const isFast = speedPct > 105
          const isSlow = speedPct < 90

          return (
            <div
              key={duck.playerId}
              className={`flex flex-col gap-2 rounded-2xl border-2 p-3.5 transition sm:flex-row sm:items-center sm:gap-4 ${
                isHighlighted
                  ? 'border-[var(--color-ggd-gold)] bg-[var(--color-ggd-gold)]/15 shadow-[0_0_15px_rgba(255,204,0,0.15)]'
                  : isDangerZone
                    ? 'border-rose-500/35 bg-rose-500/10'
                    : 'border-white/10 bg-black/20 hover:border-white/25'
              }`}
            >
              {/* Rank & Avatar */}
              <div className="flex items-center gap-3">
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-xl font-display text-lg font-black ${
                    duck.rank === 1
                      ? 'bg-[var(--color-ggd-gold)] text-[var(--color-ggd-outline)]'
                      : duck.rank === 2
                        ? 'bg-slate-300 text-slate-900'
                        : duck.rank === 3
                          ? 'bg-amber-700 text-white'
                          : isDangerZone
                            ? 'bg-rose-500 text-white'
                            : 'bg-white/10 text-white/70'
                  }`}
                >
                  {duck.rank}
                </span>

                <Season3Avatar name={duck.name} avatarUrl={duck.avatarUrl} size={36} />

                <div className="min-w-[120px]">
                  <div className="flex items-center gap-1.5">
                    <span className="font-black text-white">{duck.name}</span>
                    {isHighlighted && (
                      <span className="rounded bg-[var(--color-ggd-gold)] px-1.5 py-0.2 text-[10px] font-black text-[var(--color-ggd-outline)]">
                        BẠN
                      </span>
                    )}
                  </div>
                  {isDangerZone && (
                    <span className="text-[10px] font-bold text-rose-400">⚠️ Vùng nguy hiểm</span>
                  )}
                </div>
              </div>

              {/* Progress Bar */}
              <div className="flex-1">
                <div className="flex justify-between text-[11px] font-bold text-white/55 mb-1">
                  <span>Tiến độ</span>
                  <span>{(duck.progress * 100).toFixed(1)}%</span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-black/40 p-0.5 border border-white/10">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      duck.progress >= 1
                        ? 'bg-[var(--color-ggd-gold)]'
                        : isDangerZone
                          ? 'bg-rose-500'
                          : 'bg-[var(--color-ggd-neon-green)]'
                    }`}
                    style={{ width: `${Math.min(100, Math.max(2, duck.progress * 100))}%` }}
                  />
                </div>
              </div>

              {/* Speed Meter */}
              <div className="flex items-center gap-2 text-xs font-bold sm:flex-col sm:items-end">
                <span className="text-white/45 text-[10px] uppercase">Tốc độ</span>
                <span
                  className={`font-black ${
                    isFast
                      ? 'text-[var(--color-ggd-neon-green)]'
                      : isSlow
                        ? 'text-rose-400'
                        : 'text-white/80'
                  }`}
                >
                  {speedPct}% {isFast ? '⚡' : isSlow ? '💫' : ''}
                </span>
              </div>

              {/* Active Effects & Items */}
              <div className="flex flex-wrap items-center gap-1.5 sm:min-w-[140px] sm:justify-end">
                {duck.activeEffects.map((effect) => {
                  const badge = EFFECT_BADGES[effect]
                  if (!badge) return null
                  return (
                    <span
                      key={effect}
                      className={`flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-black ${badge.bg}`}
                    >
                      <span>{badge.icon}</span>
                      <span>{badge.label}</span>
                    </span>
                  )
                })}

                {duck.wildItem && (
                  <span className="flex items-center gap-1 rounded-md border border-teal-500/30 bg-teal-500/20 px-2 py-0.5 text-[10px] font-black text-teal-300">
                    <span>{ITEM_ICONS[duck.wildItem.itemId] || '🎁'}</span>
                    <span>{duck.wildItem.itemId}</span>
                  </span>
                )}

                {duck.itemIds.length > 0 && duck.activeEffects.length === 0 && !duck.wildItem && (
                  <div className="flex items-center gap-1 opacity-60">
                    {duck.itemIds.map((itemId) => (
                      <span key={itemId} title={itemId} className="text-sm">
                        {ITEM_ICONS[itemId] || '📦'}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        })}

        {/* Ghost ducks if present */}
        {ghostStandings.length > 0 && (
          <div className="mt-4 border-t border-dashed border-white/20 pt-3">
            <div className="text-[11px] font-black text-white/40 uppercase tracking-wider mb-2">
              👻 Vịt Nhiễu (Ghost Ducks - Không tính hạng)
            </div>
            <div className="space-y-1.5">
              {ghostStandings.map((duck) => (
                <div
                  key={duck.playerId}
                  className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/15 px-3 py-2 text-xs text-white/60"
                >
                  <span className="font-bold">👻</span>
                  <Season3Avatar name={duck.name} avatarUrl={duck.avatarUrl} size={24} />
                  <span className="font-bold">{duck.name}</span>
                  <span className="ml-auto font-mono text-[10px]">{(duck.progress * 100).toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
