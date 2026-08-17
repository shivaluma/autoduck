'use client'

import { useMemo, useState } from 'react'
import type { RaceConfig, RaceEvent } from '@/packages/race-protocol/src'
import { Season3Avatar } from '@/components/season3-avatar'
import {
  buildPostRaceStats,
  type PostRacePlayerInput,
  type PostRacePlayerStats,
} from '@/lib/racing/post-race-stats'
import {
  extractCombatEncounters,
  type CombatEncounter,
} from '@/lib/racing/combat-encounters'

function formatSeconds(value: number) {
  if (value <= 0) return '0s'
  if (value < 1) return `${value.toFixed(2)}s`
  return `${value.toFixed(1)}s`
}

function formatSpeed(value: number) {
  return `${(value * 100).toFixed(1)}%`
}

function formatDelta(value: number) {
  if (value === 0) return '0'
  return value > 0 ? `+${value}` : `${value}`
}

function HighlightCard({
  emoji,
  title,
  name,
  detail,
}: {
  emoji: string
  title: string
  name: string
  detail: string
}) {
  return (
    <div className="rounded-2xl border-2 border-white/10 bg-black/25 p-4">
      <div className="text-2xl">{emoji}</div>
      <div className="mt-1 text-[10px] font-black tracking-[0.15em] text-white/45 uppercase">{title}</div>
      <div className="mt-1 font-black text-[var(--color-ggd-gold)]">{name}</div>
      <div className="mt-1 text-sm text-white/65">{detail}</div>
    </div>
  )
}

function PlayerRow({
  player,
  expanded,
  onToggle,
  encountersDealt,
  encountersReceived,
}: {
  player: PostRacePlayerStats
  expanded: boolean
  onToggle: () => void
  encountersDealt: CombatEncounter[]
  encountersReceived: CombatEncounter[]
}) {
  const topEfficiency = player.efficiencyScore >= 8
  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 border-b border-white/10 px-5 py-4 text-left last:border-0 hover:bg-white/5"
      >
        <span className="w-8 text-2xl font-black text-white/45">{player.finalRank}</span>
        <Season3Avatar name={player.name} avatarUrl={player.avatarUrl} size={40} />
        <span className="min-w-0 flex-1 truncate font-black">{player.name}</span>
        {topEfficiency && <span className="rounded-full bg-[var(--color-ggd-neon-green)] px-2 py-0.5 text-[10px] font-black text-[var(--color-ggd-outline)]">MVP ITEM</span>}
        <span className="hidden text-sm font-bold text-white/55 sm:block">{formatSpeed(player.averageSpeed)} avg</span>
        <span className="hidden text-sm font-bold text-[var(--color-ggd-gold)] sm:block">Δ {formatDelta(player.rankDelta)}</span>
        <span className="text-xs text-white/35">{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <div className="border-b border-white/10 bg-black/20 px-5 py-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div><div className="text-[10px] font-black uppercase text-white/40">Tốc độ TB / đỉnh</div><div className="font-black">{formatSpeed(player.averageSpeed)} · {formatSpeed(player.peakSpeed)}</div></div>
            <div><div className="text-[10px] font-black uppercase text-white/40">Hạng không item</div><div className="font-black">#{player.baselineRank} → #{player.finalRank} ({formatDelta(player.rankDelta)})</div></div>
            <div><div className="text-[10px] font-black uppercase text-white/40">Tấn công / bị đánh</div><div className="font-black">{player.attacksDealt} gây · {player.attacksReceived} nhận · {player.attacksBlocked} chặn</div></div>
            <div><div className="text-[10px] font-black uppercase text-white/40">Thời gian mất (ước tính)</div><div className="font-black text-[var(--color-ggd-orange)]">{formatSeconds(player.timeLostFromAttacksSeconds)}</div></div>
            <div><div className="text-[10px] font-black uppercase text-white/40">Pickup / wild item</div><div className="font-black">{player.pickupsCollected} pickup · {player.wildItemsUsed} wild</div></div>
            <div><div className="text-[10px] font-black uppercase text-white/40">Va chạm / boost break</div><div className="font-black">{player.collisions} va chạm · {player.boostBreaks} boost break</div></div>
            <div><div className="text-[10px] font-black uppercase text-white/40">Finish time</div><div className="font-black">{player.finishTimeMs ? formatSeconds(player.finishTimeMs / 1000) : '—'}</div></div>
            <div><div className="text-[10px] font-black uppercase text-white/40">Điểm hiệu quả</div><div className="font-black text-[var(--color-ggd-neon-green)]">{player.efficiencyScore.toFixed(1)}</div></div>
          </div>

          {/* Combat Log for this Player */}
          {(encountersDealt.length > 0 || encountersReceived.length > 0) && (
            <div className="rounded-2xl border border-white/10 bg-black/30 p-3.5 space-y-3">
              <div className="text-[10px] font-black uppercase tracking-[0.15em] text-[var(--color-ggd-gold)]">
                ⚔️ Nhật ký tác chiến cá nhân
              </div>

              {/* Attacks Dealt */}
              {encountersDealt.length > 0 && (
                <div>
                  <div className="text-xs font-bold text-white/60 mb-1.5">Đòn tấn công đã tung ra:</div>
                  <div className="space-y-1.5">
                    {encountersDealt.map((enc) => (
                      <div
                        key={enc.id}
                        className={`flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-1.5 text-xs border ${
                          enc.success
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                            : 'border-sky-500/30 bg-sky-500/10 text-sky-300'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] text-white/50">{enc.timeFormatted}</span>
                          <span>{enc.weaponIcon} ➔ <strong>{enc.targetName}</strong></span>
                        </div>
                        <div className="text-right font-medium text-white/80">
                          {enc.success ? '✅ Trúng đích' : `❌ ${enc.defenseName || 'Bị chặn'}`}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Attacks Received */}
              {encountersReceived.length > 0 && (
                <div>
                  <div className="text-xs font-bold text-white/60 mb-1.5">Đòn tấn công đã hứng chịu:</div>
                  <div className="space-y-1.5">
                    {encountersReceived.map((enc) => (
                      <div
                        key={enc.id}
                        className={`flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-1.5 text-xs border ${
                          enc.success
                            ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                            : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] text-white/50">{enc.timeFormatted}</span>
                          <span>{enc.weaponIcon} ⬅️ từ <strong>{enc.attackerName}</strong></span>
                        </div>
                        <div className="text-right font-medium text-white/80">
                          {enc.success ? '💥 Dính đòn' : `🛡️ Hóa giải (${enc.defenseName})`}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {player.itemStats.length > 0 && (
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.15em] text-white/40">Item breakdown</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {player.itemStats.map((item) => (
                  <span key={item.itemId} className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm font-black">
                    {item.icon} {item.name}: {item.successes}/{item.activations} hiệu quả
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}

export function PostRaceStatsPanel({
  config,
  events,
  players,
}: {
  config: RaceConfig
  events: RaceEvent[]
  players: PostRacePlayerInput[]
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const stats = useMemo(() => buildPostRaceStats(config, events, players), [config, events, players])
  const combat = useMemo(() => extractCombatEncounters(events, players), [events, players])

  const combatByPlayer = useMemo(() => {
    const dealt = new Map<string, CombatEncounter[]>()
    const received = new Map<string, CombatEncounter[]>()
    for (const p of players) {
      dealt.set(p.playerId, [])
      received.set(p.playerId, [])
    }
    for (const enc of combat.encounters) {
      if (dealt.has(enc.attackerId)) {
        dealt.get(enc.attackerId)!.push(enc)
      }
      if (received.has(enc.targetId)) {
        received.get(enc.targetId)!.push(enc)
      }
    }
    return { dealt, received }
  }, [combat.encounters, players])

  if (events.length === 0) {
    return (
      <section className="rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] p-6 text-center">
        <div className="font-display text-2xl">📊 POST-RACE STATS</div>
        <p className="mt-2 text-white/55">Race này chưa có event log — không thể phân tích chi tiết.</p>
      </section>
    )
  }

  const { highlights } = stats

  return (
    <section className="overflow-hidden rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)]">
      <div className="border-b-2 border-white/10 px-5 py-4">
        <div className="font-display text-2xl">📊 POST-RACE STATS</div>
        <p className="mt-1 text-sm text-white/55">
          {stats.totalEvents.toLocaleString()} events · {formatSeconds(stats.raceDurationMs / 1000)} race time · phân tích từ engine replay
        </p>
      </div>

      <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
        {highlights.bestItemUser && (
          <HighlightCard
            emoji="🎯"
            title="Tận dụng item tốt nhất"
            name={highlights.bestItemUser.name}
            detail={`Cải thiện ${formatDelta(highlights.bestItemUser.rankDelta)} hạng so với không item`}
          />
        )}
        {highlights.mostAttacked && (
          <HighlightCard
            emoji="🛡️"
            title="Bị tấn công nhiều nhất"
            name={highlights.mostAttacked.name}
            detail={`${highlights.mostAttacked.attacksReceived} lần bị hit`}
          />
        )}
        {highlights.bestAttacker && (
          <HighlightCard
            emoji="💥"
            title="Tấn công hiệu quả nhất"
            name={highlights.bestAttacker.name}
            detail={`${highlights.bestAttacker.attacksDealt} hit gây ra`}
          />
        )}
        {highlights.fastestAverage && (
          <HighlightCard
            emoji="⚡"
            title="Tốc độ trung bình cao nhất"
            name={highlights.fastestAverage.name}
            detail={formatSpeed(highlights.fastestAverage.averageSpeed)}
          />
        )}
        {highlights.mostTimeLost && (
          <HighlightCard
            emoji="⏱️"
            title="Mất nhiều thời gian vì bị đánh"
            name={highlights.mostTimeLost.name}
            detail={formatSeconds(highlights.mostTimeLost.timeLostFromAttacksSeconds)}
          />
        )}
        {(() => {
          const best = [...stats.players].sort((left, right) => right.efficiencyScore - left.efficiencyScore)[0]
          if (!best || best.efficiencyScore <= 0) return null
          return (
            <HighlightCard
              emoji="🏆"
              title="Hiệu quả tổng thể"
              name={best.name}
              detail={`Điểm ${best.efficiencyScore.toFixed(1)}`}
            />
          )
        })()}
      </div>

      <div className="border-t-2 border-white/10">
        <div className="border-b border-white/10 px-5 py-3 text-xs font-black tracking-[0.15em] text-white/45 uppercase">
          Chi tiết theo vịt — bấm để mở rộng
        </div>
        {stats.players.map((player) => (
          <PlayerRow
            key={player.playerId}
            player={player}
            expanded={expandedId === player.playerId}
            onToggle={() => setExpandedId((current) => current === player.playerId ? null : player.playerId)}
            encountersDealt={combatByPlayer.dealt.get(player.playerId) ?? []}
            encountersReceived={combatByPlayer.received.get(player.playerId) ?? []}
          />
        ))}
      </div>
    </section>
  )
}
