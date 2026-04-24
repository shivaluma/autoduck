'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { PlayerData } from '@/lib/types'
import Image from 'next/image'
import { BossBadge } from '@/components/boss-badge'
import { ShieldAgingStack } from '@/components/shield-aging-stack'
import { MYSTERY_CHESTS_ENABLED } from '@/lib/feature-flags'

interface DashboardRaceItem {
  id: number
  status: string
  finalVerdict: string | null
  createdAt: string
  isTest?: boolean
}

interface DashboardRaceLists {
  recentAll: DashboardRaceItem[]
  recentOfficial: DashboardRaceItem[]
  totalAll: number
  totalOfficial: number
}

const emptyRaceLists: DashboardRaceLists = {
  recentAll: [],
  recentOfficial: [],
  totalAll: 0,
  totalOfficial: 0,
}

function getRaceSignal(race: DashboardRaceItem) {
  const verdict = (race.finalVerdict ?? '').toLowerCase()

  if (race.status === 'failed') {
    return {
      className: 'race-signal race-signal-danger',
      label: '💀 Failed',
      headline: 'Race bị lỗi',
    }
  }

  if (race.status === 'running') {
    return {
      className: 'race-signal race-signal-active',
      label: '🔥 Live',
      headline: 'Đang chạy',
    }
  }

  if (verdict.includes('boss')) {
    return {
      className: 'race-signal race-signal-boss',
      label: '⛑ Boss',
      headline: race.finalVerdict || 'Boss đã đổi trạng thái',
    }
  }

  if (verdict.includes('rare') || verdict.includes('chest')) {
    return {
      className: 'race-signal race-signal-rare',
      label: '🎁 Rare',
      headline: race.finalVerdict || 'Rare chest opened',
    }
  }

  if (verdict.includes('4') || verdict.includes('bốn') || verdict.includes('bon')) {
    return {
      className: 'race-signal race-signal-danger',
      label: '💀 Heavy',
      headline: race.finalVerdict || 'Nhiều con dzịt cùng chết',
    }
  }

  if (verdict.includes('thomas')) {
    return {
      className: 'race-signal race-signal-normal',
      label: '🐥 Pace',
      headline: race.finalVerdict || 'Thomas giữ pace line',
    }
  }

  return {
    className: 'race-signal race-signal-normal',
    label: race.status === 'finished' ? '💀 Done' : '⏳ Pending',
    headline: race.finalVerdict || `Trận #${race.id}`,
  }
}

export default function Dashboard() {
  const [players, setPlayers] = useState<PlayerData[]>([])
  const [loading, setLoading] = useState(true)
  const [races, setRaces] = useState<DashboardRaceLists>(emptyRaceLists)
  const [summary, setSummary] = useState<{
    rareRolledCount: number
    bossesDefeated: number
    longestStreak: { value: number; ownerName: string }
    mostUnluckyDuck: { name: string; totalKhaos: number } | null
  } | null>(null)
  const [showTestRaces, setShowTestRaces] = useState(false)

  useEffect(() => {
    fetch('/api/dashboard')
      .then((response) => response.json())
      .then((dashboardData) => {
        setPlayers(dashboardData.players)
        setRaces(dashboardData.races)
        setSummary(dashboardData.summary)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const displayedRaces = showTestRaces ? races.recentAll : races.recentOfficial
  const totalRaces = showTestRaces ? races.totalAll : races.totalOfficial
  const totalKhaos = players.reduce((sum, player) => sum + player.totalKhaos, 0)
  const sortedPlayers = [...players].sort((left, right) => right.totalKhaos - left.totalKhaos)
  const mostUnluckyDuck = summary?.mostUnluckyDuck ?? null
  const pendingItemsCount = players.filter((player) => player.activeChest).length
  const activeChestEffects = players
    .map((player) => player.activeChest?.effect)
    .filter((effect): effect is NonNullable<PlayerData['activeChest']>['effect'] => Boolean(effect))

  const bossWatch = useMemo(
    () => players
      .filter((player) => player.cleanStreak >= 2 || player.isBoss)
      .sort((left, right) => right.cleanStreak - left.cleanStreak),
    [players]
  )

  const fragileShields = useMemo(
    () => players
      .flatMap((player) =>
        player.activeShields
          .filter((shield) => shield.charges <= 2)
          .map((shield) => ({
            player,
            shield,
          }))
      )
      .sort((left, right) => left.shield.charges - right.shield.charges),
    [players]
  )

  const currentBoss = bossWatch.find((player) => player.isBoss) ?? null
  const topShieldThreat = fragileShields[0] ?? null
  const weeklyHeadline = currentBoss
    ? `WEEK ${Math.max(totalRaces, 1)}: SĂN BOSS ${currentBoss.name.replace('Zịt ', '')}`
    : topShieldThreat
      ? `WEEK ${Math.max(totalRaces, 1)}: KHIÊN ${topShieldThreat.player.name.replace('Zịt ', '')} SẮP NỔ`
      : pendingItemsCount > 0
        ? `WEEK ${Math.max(totalRaces, 1)}: ITEM ĐANG CHỜ NỔ`
        : `WEEK ${Math.max(totalRaces, 1)}: BẦY VỊT TẠM YÊN`

  const primaryStats = [
    {
      icon: '⛑',
      label: 'Current Boss',
      value: currentBoss ? currentBoss.name.replace('Zịt ', '') : 'Clear',
      detail: currentBoss ? `Boss level ${currentBoss.cleanStreak}` : `${bossWatch.length} vịt đang vào tầm ngắm`,
      tone: 'primary-kpi-gold',
    },
    {
      icon: '🎁',
      label: 'Pending Effects',
      value: String(MYSTERY_CHESTS_ENABLED ? pendingItemsCount : 0),
      detail: MYSTERY_CHESTS_ENABLED ? 'Sẽ nổ ở race kế tiếp' : 'Hệ item đang tắt',
      tone: 'primary-kpi-rare',
    },
    {
      icon: '🛡',
      label: 'Shield Risk',
      value: topShieldThreat ? `${topShieldThreat.shield.charges}c` : 'Safe',
      detail: topShieldThreat ? `${topShieldThreat.player.name.replace('Zịt ', '')} sắp vỡ khiên` : 'Chưa có khiên nguy hiểm',
      tone: topShieldThreat?.shield.charges === 1 ? 'primary-kpi-danger' : 'primary-kpi-blue',
    },
    {
      icon: '🏁',
      label: 'Total Race',
      value: totalRaces.toString(),
      detail: showTestRaces ? 'Đang tính cả race test' : 'Race official',
      tone: 'primary-kpi-green',
    },
  ]

  const secondaryStats = [
    {
      label: '🔥 Longest Streak',
      value: String(summary?.longestStreak.value ?? 0),
      detail: summary?.longestStreak.ownerName ? summary.longestStreak.ownerName.replace('Zịt ', '') : 'Chưa có chuỗi đáng kể',
    },
    {
      label: '💀 Most Unlucky',
      value: mostUnluckyDuck?.name?.replace('Zịt ', '') || '-',
      detail: mostUnluckyDuck ? `${mostUnluckyDuck.totalKhaos} lần làm dzịt` : 'Chưa xác định',
    },
    {
      label: '💀 Total Khaos',
      value: totalKhaos.toString(),
      detail: 'Tổng sẹo toàn chuồng',
    },
  ]

  const metaItems = [
    {
      label: 'Losers',
      value: activeChestEffects.includes('MORE_PEOPLE_MORE_FUN') ? '3+' : '2',
    },
    {
      label: 'Anti Shield',
      value: activeChestEffects.includes('ANTI_SHIELD') ? 'ON' : 'OFF',
    },
    {
      label: 'Thomas Mode',
      value: activeChestEffects.includes('CANT_PASS_THOMAS') ? 'ON' : 'OFF',
    },
    {
      label: 'Boss',
      value: currentBoss ? `LV ${currentBoss.cleanStreak}` : 'OFF',
    },
  ]

  return (
    <div className="min-h-screen bg-transparent bubble-bg dashboard-shell">
      <div className="neon-divider" />

      <header className="relative border-b-4 border-[var(--color-ggd-outline)] dashboard-hero">
        <div className="max-w-7xl mx-auto px-6 py-5 flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-5 animate-slide-left">
            <div className="duck-mascot">🦆</div>
            <div>
              <h1 className="font-display text-4xl text-white text-outlined">
                AUTO<span className="text-[var(--color-ggd-neon-green)]">DUCK</span>
              </h1>
              <div className="flex items-center gap-2 mt-1">
                <div className="w-3 h-3 bg-[var(--color-ggd-neon-green)] rounded-full animate-pulse shadow-[0_0_8px_rgba(61,255,143,0.6)]" />
                <p className="font-data text-sm text-[var(--color-ggd-lavender)]">🐥 QUACK QUACK CLUB v2.1</p>
              </div>
              <p className="font-readable text-sm text-white/60 mt-1">Nơi định mệnh sáng thứ 2 được quyết định bằng vịt</p>
            </div>
          </div>

          <div className="flex w-full flex-col gap-3 animate-slide-right sm:flex-row sm:flex-wrap lg:w-auto lg:items-center lg:justify-end">
            <a href="#race-history" className="w-full sm:w-auto">
              <button
                className="w-full font-display text-base tracking-widest uppercase px-5 py-3
                  border-[5px] border-[var(--color-ggd-outline)] rounded-xl cursor-pointer
                  transition-all duration-100
                  bg-[var(--color-ggd-surface)] text-white
                  shadow-[inset_0_3px_0_rgba(255,255,255,0.12),0_6px_0_var(--color-ggd-outline),0_12px_24px_rgba(0,0,0,0.45)]
                  hover:-translate-y-1 hover:text-[var(--color-ggd-gold)]
                  active:translate-y-[4px] active:shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_2px_0_var(--color-ggd-outline)]"
              >
                Lịch Sử Thảm Họa
              </button>
            </a>
            <Link href="/rules" className="w-full sm:w-auto">
              <button
                className="w-full font-display text-lg tracking-widest uppercase px-6 py-3
                  border-[5px] border-[var(--color-ggd-outline)] rounded-xl cursor-pointer
                  transition-all duration-100
                  bg-[var(--color-ggd-gold)] text-[var(--color-ggd-outline)]
                  shadow-[inset_0_3px_0_rgba(255,255,255,0.35),0_6px_0_#7a6000,0_12px_24px_rgba(0,0,0,0.45)]
                  hover:-translate-y-1 hover:shadow-[inset_0_3px_0_rgba(255,255,255,0.35),0_8px_0_#7a6000,0_16px_30px_rgba(255,204,0,0.28)]
                  active:translate-y-[4px] active:shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_2px_0_#7a6000]"
              >
                Xem Luật
              </button>
            </Link>
            <Link href="/race/new" className="w-full sm:w-auto">
              <button
                className="w-full font-display text-2xl tracking-widest uppercase px-8 py-4 xl:px-12
                  border-[5px] border-[var(--color-ggd-outline)] rounded-xl cursor-pointer
                  transition-all duration-100
                  bg-[var(--color-ggd-neon-green)] text-[var(--color-ggd-outline)]
                  shadow-[inset_0_3px_0_rgba(255,255,255,0.45),0_7px_0_#007a3a,0_12px_28px_rgba(61,255,143,0.35)]
                  hover:-translate-y-1 hover:shadow-[inset_0_3px_0_rgba(255,255,255,0.45),0_9px_0_#007a3a,0_16px_32px_rgba(61,255,143,0.45)]
                  active:translate-y-[5px] active:shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_2px_0_#007a3a]"
              >
                <span className="flex items-center gap-3">
                  <span className="text-2xl" style={{ animation: 'wiggle-duck 1s ease-in-out infinite' }}>🦆</span>
                  Chạy Đua!
                </span>
              </button>
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8 dashboard-main">
        <div className="dashboard-command animate-slide-up opacity-0" style={{ animationDelay: '0.1s' }}>
          <div className="min-w-0">
            <div className="font-data text-xs uppercase tracking-widest text-[var(--color-ggd-neon-green)]">This Week Meta</div>
            <div className="font-display text-4xl text-white text-outlined leading-tight mt-1">{weeklyHeadline}</div>
          </div>
          <div className="flex flex-wrap gap-2 justify-start lg:justify-end">
            {metaItems.map((item) => (
              <div key={item.label} className={`meta-pill ${item.value === 'ON' ? 'meta-pill-hot' : ''}`}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 animate-slide-up opacity-0" style={{ animationDelay: '0.16s' }}>
          {primaryStats.map((stat) => (
            <div key={stat.label} className={`primary-kpi ${stat.tone}`}>
              <div className="flex items-center justify-between gap-3">
                <span className="font-data text-xs uppercase tracking-widest text-white/55">{stat.label}</span>
                <span className="text-2xl">{stat.icon}</span>
              </div>
              <div className="font-display text-4xl text-white text-outlined mt-3 truncate">{stat.value}</div>
              <div className="font-readable text-xs text-white/68 mt-1 min-h-8 leading-relaxed">{stat.detail}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 animate-slide-up opacity-0" style={{ animationDelay: '0.2s' }}>
          {secondaryStats.map((stat) => (
            <div key={stat.label} className="secondary-kpi">
              <span className="font-data text-[11px] uppercase tracking-widest text-white/45">{stat.label}</span>
              <strong className="font-display text-2xl text-white text-outlined truncate">{stat.value}</strong>
              <span className="font-readable text-xs text-white/52 truncate">{stat.detail}</span>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 animate-slide-up opacity-0" style={{ animationDelay: '0.2s' }}>
            <div className="dashboard-table-panel overflow-x-auto overflow-y-hidden rounded-2xl border-5 border-[var(--color-ggd-outline)] ggd-stripe">
              <div className="ggd-panel-header bg-[rgba(61,255,143,0.78)]">
                <div className="skew-header">
                  <span className="text-[var(--color-ggd-outline)] text-2xl">💀 BXH Sinh Tồn</span>
                </div>
                <span className="font-data text-sm text-[var(--color-ggd-outline)]/70 font-black tracking-wider">Sẹo càng nhiều chưa chắc càng yếu.</span>
              </div>

              <div className="grid min-w-[760px] grid-cols-[60px_1.4fr_90px_180px_90px_100px] gap-0 px-5 py-3 border-b-[3px] border-black bg-[var(--color-ggd-panel)]">
                {['#', '🐥 Vịt', '🩹 Sẹo', '🛡 Khiên', '🔥 Đã Xài', '💀 Số Lần Dzịt'].map((header, index) => (
                  <div key={header} className={`ggd-col-header ${index >= 2 && index <= 4 ? 'text-center' : index === 5 ? 'text-right' : ''}`}>{header}</div>
                ))}
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-20">
                  <div className="text-6xl animate-bob">🦆</div>
                </div>
              ) : (
                <div className="py-1">
                  {sortedPlayers.map((player, index) => (
                    <div
                      key={player.id}
                      className={`grid min-w-[760px] grid-cols-[60px_1.4fr_90px_180px_90px_100px] gap-0 items-center px-5 py-4 duck-row
                        ${index === 0 ? 'loser' : ''}
                        animate-slide-right opacity-0`}
                      style={{ animationDelay: `${0.3 + index * 0.06}s` }}
                    >
                      <div>
                        <span
                          className={`position-number text-4xl ${index === 0 ? 'text-[var(--color-ggd-orange)] glow-orange' :
                            index === 1 ? 'text-[var(--color-ggd-gold)] glow-gold' :
                              index === 2 ? 'text-[var(--color-ggd-neon-green)] glow-green' :
                                'text-[var(--color-ggd-muted)]'
                            }`}
                          title={index === 0 ? '👑 Current champion' : undefined}
                        >
                          {index === 0 ? '👑' : String(index + 1).padStart(2, '0')}
                        </span>
                      </div>

                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-2.5 h-16 rounded-full ${index === 0 ? 'bg-[var(--color-ggd-orange)] shadow-[0_0_10px_rgba(255,87,51,0.6)]' :
                          index === 1 ? 'bg-[var(--color-ggd-gold)] shadow-[0_0_10px_rgba(255,204,0,0.6)]' :
                            index === 2 ? 'bg-[var(--color-ggd-neon-green)] shadow-[0_0_10px_rgba(61,255,143,0.6)]' :
                              'bg-[var(--color-ggd-muted)]/30'
                          }`} />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="font-body text-lg font-black text-white tracking-wide truncate">{player.name}</div>
                            {player.isBoss && <BossBadge compact streak={player.cleanStreak} />}
                            {player.cleanStreak > 0 && (
                              <span className={`ggd-tag ${player.cleanStreak >= 3 ? 'bg-[var(--color-ggd-gold)] text-[var(--color-ggd-outline)]' : 'bg-[var(--color-ggd-panel)] text-[var(--color-ggd-neon-green)]'}`}>
                                🔥 {player.cleanStreak}/3 tuần sạch
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] font-data text-white/45">
                            {player.isImmortal && <span title="Immortal duck">♾ Immortal</span>}
                            {MYSTERY_CHESTS_ENABLED && player.activeChest && (
                              <span title={`Pending reward: ${player.activeChest.effect}`}>🎁 Pending reward</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="text-center">
                        <span className={`font-data text-2xl font-black ${player.scars > 0 ? 'text-[var(--color-ggd-orange)]' : 'text-[var(--color-ggd-muted)]/20'}`}>
                          {player.scars}
                        </span>
                      </div>

                      <ShieldAgingStack shields={player.activeShields} legacyCount={player.shields} />

                      <div className="text-center">
                        <span className="font-data text-2xl font-black text-[var(--color-ggd-muted)]/50">{player.shieldsUsed}</span>
                      </div>

                      <div className="text-right">
                        <span className="font-display text-4xl text-white text-outlined">{player.totalKhaos}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="animate-slide-up opacity-0 space-y-5" style={{ animationDelay: '0.35s' }}>
            <div id="race-history" className="dashboard-sidebar-panel overflow-hidden rounded-2xl border-5 border-[var(--color-ggd-outline)] ggd-stripe scroll-mt-6">
              <div className="ggd-panel-header bg-[rgba(24,18,52,0.82)] rounded-t-[7px]">
                <span className="font-display text-xl text-white text-outlined">📜 Lịch Sử Thảm Họa</span>
                <label className="flex items-center gap-2 cursor-pointer group">
                  <div className="relative">
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={showTestRaces}
                      onChange={(event) => setShowTestRaces(event.target.checked)}
                    />
                    <div className={`w-11 h-6 rounded-full transition-colors border-2 border-[var(--color-ggd-outline)] ${showTestRaces ? 'bg-[var(--color-ggd-neon-green)]' : 'bg-[var(--color-ggd-muted)]/30'}`} />
                    <div className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white border-2 border-[var(--color-ggd-outline)] transition-transform shadow ${showTestRaces ? 'translate-x-5' : 'translate-x-0'}`} />
                  </div>
                  <span className="font-data text-xs font-black text-[var(--color-ggd-muted)] group-hover:text-white transition-colors uppercase tracking-wider">Test</span>
                </label>
              </div>

              {displayedRaces.length > 0 ? (
                <div className="py-1">
                  {displayedRaces.slice(0, 8).map((race, index) => {
                    const signal = getRaceSignal(race)

                    return (
                      <Link
                        key={race.id}
                        href={`/race/${race.id}`}
                        className={`${signal.className} block mx-2 my-1.5 px-4 py-3.5 rounded-xl transition-all hover:translate-x-2 animate-slide-right opacity-0 border-b-2 border-black/20`}
                        style={{ animationDelay: `${0.4 + index * 0.05}s` }}
                      >
                        <div className="flex items-center justify-between gap-3 mb-1">
                          <span className="font-display text-lg text-white flex items-center gap-2 min-w-0">
                            <span className="truncate">{signal.headline}</span>
                            {race.isTest && (
                              <span className="ggd-tag bg-[var(--color-ggd-sky)] text-[var(--color-ggd-outline)] text-[10px]">TEST</span>
                            )}
                          </span>
                          <span className="race-signal-label">{signal.label}</span>
                        </div>
                        <p className="font-data text-xs text-[var(--color-ggd-muted)]/70 mt-1 font-bold">
                          Trận #{race.id} · {new Date(race.createdAt).toLocaleDateString('vi-VN', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      </Link>
                    )
                  })}
                </div>
              ) : (
                <div className="px-5 py-12 text-center">
                  <div className="text-5xl mb-3 animate-bob">💤</div>
                  <p className="font-display text-xl text-white text-outlined">Chưa có race nào.</p>
                  <p className="font-readable text-sm text-[var(--color-ggd-muted)] mt-2">Bầy vịt vẫn đang ngủ.</p>
                  <p className="font-readable text-sm text-[var(--color-ggd-muted)]">Hãy bắt đầu tuần mới bằng hỗn loạn.</p>
                </div>
              )}
            </div>

            <div className="ggd-card-gold ggd-stripe p-6">
              <div className="flex items-center gap-3 mb-4">
                <Image src="/assets/v2/boss-crown.svg" alt="boss" width={32} height={32} className="animate-bob" unoptimized />
                <div>
                  <div className="font-display text-xl text-[var(--color-ggd-gold)] text-outlined leading-none">⛑ Boss Watch</div>
                  <div className="font-data text-[10px] uppercase tracking-widest text-white/50">3 tuần sạch mở Boss Mode.</div>
                </div>
              </div>
              <p className="font-readable text-sm text-white/70 mb-4">Càng sống lâu càng bị spawn thêm clone để săn.</p>
              <div className="space-y-2.5">
                {bossWatch.length > 0 ? bossWatch.map((entry) => {
                  const streak = entry.cleanStreak
                  const pct = Math.min((Math.min(streak, 3) / 3) * 100, 100)
                  return (
                    <div key={entry.id} className="stat-row">
                      <div className="stat-row-icon" style={{ background: entry.isBoss ? 'linear-gradient(180deg, #ffd84d 0%, #f59e0b 100%)' : 'rgba(0,0,0,0.4)' }}>
                        {entry.isBoss
                          ? <Image src="/assets/v2/boss-crown.svg" alt="boss" width={24} height={24} unoptimized />
                          : <Image src="/assets/v2/streak-flame.svg" alt="flame" width={22} height={22} unoptimized />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <span className="font-body text-white font-black truncate">{entry.name}</span>
                          {entry.isBoss
                            ? <BossBadge compact streak={entry.cleanStreak} />
                            : <span className="font-data text-[11px] font-black text-[var(--color-ggd-gold)]">{streak}/3</span>}
                        </div>
                        <div className="progress-track">
                          <div className="progress-fill" style={{ width: `${pct}%`, '--bar-bg': entry.isBoss ? 'linear-gradient(90deg,#ffd84d,#f59e0b)' : 'linear-gradient(90deg,#3dff8f,#ffcc00)' } as React.CSSProperties} />
                        </div>
                      </div>
                    </div>
                  )
                }) : (
                  <div className="font-data text-sm text-[var(--color-ggd-muted)] italic">Chưa ai đủ trình thành Boss.</div>
                )}
              </div>
            </div>

            <div className="ggd-card p-6">
              <div className="flex items-center gap-3 mb-4">
                <Image src="/assets/v2/shield-cracked.svg" alt="shield" width={32} height={32} className="animate-bob" unoptimized />
                <div>
                  <div className="font-display text-xl text-white text-outlined leading-none">🛡 Khiên Sắp Hỏng</div>
                  <div className="font-data text-[10px] uppercase tracking-widest text-white/50">Khiên sống theo charge: 3 → 2 → 1 → vỡ</div>
                </div>
              </div>
              <div className="space-y-2.5">
                {fragileShields.length > 0 ? fragileShields.slice(0, 6).map(({ player, shield }) => {
                  const danger = shield.charges <= 1
                  const pct = ((3 - shield.charges) / 3) * 100
                  return (
                    <div key={shield.id} className="stat-row">
                      <div className="stat-row-icon">
                        <Image
                          src={danger ? '/assets/v2/shield-broken.svg' : '/assets/v2/shield-cracked.svg'}
                          alt="shield" width={26} height={26} unoptimized
                          className={danger ? 'animate-pulse' : ''}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <span className="font-body text-white font-black truncate">
                            {player.name} <span className="text-white/50 font-data text-[11px]">#{shield.id}</span>
                          </span>
                          <span className={`font-data text-[11px] font-black ${danger ? 'text-[var(--color-ggd-orange)]' : 'text-[var(--color-ggd-gold)]'}`}>
                            {shield.charges}c {danger ? '⚠️' : ''}
                          </span>
                        </div>
                        <div className="progress-track">
                          <div className="progress-fill" style={{ width: `${pct}%`, '--bar-bg': danger ? 'linear-gradient(90deg,#ff5733,#ff8a00)' : 'linear-gradient(90deg,#ffcc00,#ff8a00)' } as React.CSSProperties} />
                        </div>
                      </div>
                    </div>
                  )
                }) : (
                  <div className="font-data text-sm text-[var(--color-ggd-muted)] italic">Chưa có khiên nào sắp nổ.</div>
                )}
              </div>
            </div>

            <div className="ggd-card p-6">
              <div className="font-display text-2xl text-white text-outlined mb-4">📖 Luật Chơi v2</div>
              <div className="space-y-3">
                {[
                  { icon: '💀', title: 'Thua Cuộc', lines: ['2 vịt cuối bảng = Làm Dzịt', 'Bao nước, nhận +1 Sẹo'] },
                  { icon: '🛡', title: 'Khiên', lines: ['2 Sẹo = auto ghép 1 Khiên', 'Declare trước race để kích hoạt', 'Cứu 1 lần rồi biến mất'] },
                  { icon: '⏳', title: 'Shield Decay', lines: ['Không dùng sau race sẽ -1 charge', '0 charge = vỡ'] },
                  { icon: '⛑', title: 'Boss Duck', lines: ['3 tuần liên tiếp không Dzịt = Boss', 'Boss spawn nhiều clone hơn mỗi tuần', 'Clone chết = Boss chết'] },
                  { icon: '🎁', title: 'Reward Chest', lines: ['Hạ Boss sẽ nhận chest', 'Streak càng cao, loot càng ngon'] },
                ].map((rule) => (
                  <div key={rule.title} className="rounded-xl border-2 border-[var(--color-ggd-outline)]/35 bg-black/20 p-3">
                    <div className="font-display text-lg text-white text-outlined">{rule.icon} {rule.title}</div>
                    <div className="font-data text-xs text-[var(--color-ggd-muted)] space-y-1 mt-2">
                      {rule.lines.map((line) => <div key={line}>• {line}</div>)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <details className="deep-stats">
              <summary>Deep Stats</summary>
              <div className="grid grid-cols-3 gap-2 mt-3">
                <div>
                  <span>🐥 Total Duck</span>
                  <strong>{players.length}</strong>
                </div>
                <div>
                  <span>🎁 Rare Rolled</span>
                  <strong>{summary?.rareRolledCount ?? 0}</strong>
                </div>
                <div>
                  <span>⛑ Boss Down</span>
                  <strong>{summary?.bossesDefeated ?? 0}</strong>
                </div>
              </div>
            </details>
          </div>
        </div>

        <footer className="border-t-4 border-[var(--color-ggd-outline)] pt-6 pb-4 flex flex-col gap-2 text-center sm:flex-row sm:items-center sm:justify-between sm:text-left animate-fade-in opacity-0" style={{ animationDelay: '0.6s' }}>
          <div className="font-data text-sm text-[var(--color-ggd-muted)]">AUTODUCK v2.0 🦆 Quack Quack!</div>
          <div className="font-data text-sm text-[var(--color-ggd-muted)] text-right">
            Built for Team Web. Phá hủy tình đồng nghiệp từ mỗi sáng thứ 2.
          </div>
        </footer>
      </main>
    </div>
  )
}
