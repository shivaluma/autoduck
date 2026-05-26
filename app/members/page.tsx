'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { DRAGON_STARS, getDragonOrbName } from '@/lib/dragon/naming'
import { DragonOrbSlot } from '@/components/dragon/dragon-widgets'

type MemberStatsRow = {
  id: number
  name: string
  avatarUrl?: string | null
  racesEntered: number
  wins: number
  dzitCount: number
  winRate: number
  dzitRate: number
  averageBestRank: number | null
  scars: number
  totalKhaos: number
  cleanStreak: number
  orbTotal: number
  duplicateCount: number
  progress: number
  missingStars: number[]
  missingOrbNames: string[]
  starCounts: Record<string, number>
  summonReady: boolean
  claimBlocked: boolean
  activeScale: boolean
  scaleState: string
  suggestion: string
}

type MemberStatsData = {
  currentWeek?: {
    star: number
    orbName: string
    weekKey: string
    headline?: string
    subline?: string
  }
  totals: {
    officialRaces: number
    memberCount: number
    totalOrbs: number
    totalLongLan: number
  }
  highlights: {
    topWinner: MemberStatsRow | null
    dzitMagnet: MemberStatsRow | null
    closestToDragon: MemberStatsRow | null
  }
  members: MemberStatsRow[]
}

function pct(value: number) {
  return `${value.toFixed(value % 1 === 0 ? 0 : 1)}%`
}

function shortMissing(member: MemberStatsRow) {
  if (member.missingOrbNames.length === 0) return 'Thất Tinh hội tụ'
  if (member.missingOrbNames.length <= 3) return member.missingOrbNames.join(', ')
  return `${member.missingOrbNames.slice(0, 3).join(', ')} +${member.missingOrbNames.length - 3}`
}

export default function MemberStatsPage() {
  const [data, setData] = useState<MemberStatsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch('/api/members/stats', { cache: 'no-store' })
      .then((response) => response.json())
      .then((stats) => {
        if (!cancelled) setData(stats)
      })
      .catch(() => {
        if (!cancelled) setData(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const currentOrbName = data?.currentWeek?.orbName ?? (data?.currentWeek?.star ? getDragonOrbName(data.currentWeek.star) : null)

  return (
    <div className="min-h-screen bg-transparent bubble-bg text-white">
      <div className="neon-divider" />
      <header className="border-b-4 border-[var(--color-ggd-outline)]">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <Link href="/" className="font-data text-sm text-[var(--color-ggd-muted)] hover:text-white">← Về Chuồng</Link>
            <h1 className="mt-2 font-display text-4xl text-[var(--color-ggd-gold)] text-outlined">Long Bảng Thành Viên</h1>
            <p className="mt-1 max-w-2xl font-readable text-sm text-white/68">
              Sổ phong độ bầy vịt: ai hay thắng, ai hay làm dzịt, ai đang gần mở cổng rồng.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/dragon" className="ggd-btn bg-[var(--color-ggd-gold)] px-4 py-2 text-sm text-[var(--color-ggd-outline)]">
              Mở Tàng Châu Các
            </Link>
            <Link href="/race/new" className="ggd-btn bg-[var(--color-ggd-neon-green)] px-4 py-2 text-sm text-[var(--color-ggd-outline)]">
              Chạy Đua
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[
            ['Race chính thức', loading ? '...' : String(data?.totals.officialRaces ?? 0), 'Chỉ tính trận đã chốt sổ'],
            ['Đang trong bảng', loading ? '...' : String(data?.totals.memberCount ?? 0), 'Không tính Thomas bất tử'],
            ['Long Châu lưu thông', loading ? '...' : String(data?.totals.totalOrbs ?? 0), currentOrbName ? `Tuần này: ${currentOrbName}` : 'Chờ thiên tượng'],
            ['Long Lân đang giữ', loading ? '...' : String(data?.totals.totalLongLan ?? 0), 'Bảo vật hộ mệnh hiếm'],
          ].map(([label, value, detail]) => (
            <article key={label} className="primary-kpi primary-kpi-gold">
              <span className="font-data text-xs uppercase tracking-widest text-white/55">{label}</span>
              <div className="mt-2 font-display text-4xl text-white text-outlined">{value}</div>
              <p className="mt-1 font-readable text-xs text-white/68">{detail}</p>
            </article>
          ))}
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          {[
            ['Vịt dẫn đầu', data?.highlights.topWinner, (member?: MemberStatsRow | null) => member ? `${member.wins} thắng · ${pct(member.winRate)}` : 'Chưa có dữ liệu'],
            ['Nam châm dzịt', data?.highlights.dzitMagnet, (member?: MemberStatsRow | null) => member ? `${member.dzitCount} lần · ${pct(member.dzitRate)}` : 'Chưa có dữ liệu'],
            ['Gần gọi rồng nhất', data?.highlights.closestToDragon, (member?: MemberStatsRow | null) => member ? `${member.progress}/7 · ${member.orbTotal} châu` : 'Chưa có dữ liệu'],
          ].map(([title, member, detail]) => (
            <article key={title as string} className="ggd-card-gold p-4">
              <div className="font-data text-xs uppercase tracking-widest text-[var(--color-ggd-neon-green)]">{title as string}</div>
              <div className="mt-2 font-display text-3xl text-white text-outlined">{(member as MemberStatsRow | null)?.name ?? '-'}</div>
              <p className="mt-1 font-readable text-sm text-white/68">{(detail as (member?: MemberStatsRow | null) => string)(member as MemberStatsRow | null)}</p>
            </article>
          ))}
        </section>

        <section className="ggd-card p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="font-display text-3xl text-white text-outlined">Bảng Soi Thành Viên</div>
              <p className="mt-1 font-readable text-sm text-white/62">Win rate, dzịt rate, châu đang giữ và lời nhắc từ La Bàn.</p>
            </div>
            {currentOrbName && (
              <span className="ggd-tag bg-[var(--color-ggd-gold)] text-[var(--color-ggd-outline)]">
                Tuần này săn {currentOrbName}
              </span>
            )}
          </div>

          {loading ? (
            <div className="py-16 text-center font-display text-3xl text-white text-outlined">Đang mở sổ...</div>
          ) : (data?.members ?? []).length === 0 ? (
            <div className="mt-4 rounded-xl border-3 border-[var(--color-ggd-outline)] bg-black/20 p-5 font-readable text-sm text-white/68">
              Chưa có member nào đủ dữ liệu. Chạy vài race rồi Long Bảng sẽ lên tiếng.
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {data?.members.map((member) => (
                <article key={member.id} className="rounded-xl border-3 border-[var(--color-ggd-outline)] bg-black/22 p-4">
                  <div className="grid gap-4 xl:grid-cols-[1.15fr_1.1fr_1.35fr] xl:items-center">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-display text-2xl text-white text-outlined">{member.name}</h2>
                        {member.summonReady && (
                          <span className="ggd-tag bg-[var(--color-ggd-neon-green)] text-[var(--color-ggd-outline)]">Thất Tinh đã đủ</span>
                        )}
                        {member.activeScale && (
                          <span className="ggd-tag bg-[var(--color-ggd-gold)] text-[var(--color-ggd-outline)]">{member.scaleState}</span>
                        )}
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-2">
                        <div className="rounded-lg bg-black/22 p-2">
                          <div className="font-data text-[10px] uppercase text-white/45">Win rate</div>
                          <div className="font-display text-2xl text-[var(--color-ggd-gold)] text-outlined">{pct(member.winRate)}</div>
                        </div>
                        <div className="rounded-lg bg-black/22 p-2">
                          <div className="font-data text-[10px] uppercase text-white/45">Dzịt rate</div>
                          <div className="font-display text-2xl text-[var(--color-ggd-orange)] text-outlined">{pct(member.dzitRate)}</div>
                        </div>
                        <div className="rounded-lg bg-black/22 p-2">
                          <div className="font-data text-[10px] uppercase text-white/45">Race</div>
                          <div className="font-display text-2xl text-white text-outlined">{member.racesEntered}</div>
                        </div>
                        <div className="rounded-lg bg-black/22 p-2">
                          <div className="font-data text-[10px] uppercase text-white/45">Avg best</div>
                          <div className="font-display text-2xl text-white text-outlined">{member.averageBestRank ?? '-'}</div>
                        </div>
                      </div>
                    </div>

                    <div>
                      <div className="font-data text-xs uppercase tracking-widest text-white/45">Tàng châu</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {DRAGON_STARS.map((star) => (
                          <DragonOrbSlot key={star} star={star} count={member.starCounts[String(star)] ?? 0} compact />
                        ))}
                      </div>
                      <div className="mt-2 font-readable text-sm text-white/65">
                        {member.progress}/7 tinh · {member.orbTotal} châu · dư {member.duplicateCount}
                      </div>
                      <div className="mt-1 font-data text-xs text-white/48" title={member.missingOrbNames.join(', ')}>
                        Còn thiếu: {shortMissing(member)}
                      </div>
                    </div>

                    <div className="rounded-xl border-2 border-[var(--color-ggd-outline)]/45 bg-[var(--color-ggd-panel)] p-3">
                      <div className="font-data text-xs uppercase tracking-widest text-[var(--color-ggd-neon-green)]">La Bàn nhắc</div>
                      <p className="mt-2 font-readable text-sm leading-relaxed text-white/75">{member.suggestion}</p>
                      <div className="mt-3 flex flex-wrap gap-2 font-data text-[11px] text-white/50">
                        <span>Thắng {member.wins}</span>
                        <span>·</span>
                        <span>Làm dzịt {member.dzitCount}</span>
                        <span>·</span>
                        <span>Streak {member.cleanStreak}</span>
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
