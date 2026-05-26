'use client'

import Link from 'next/link'
import { DRAGON_STARS, getDragonOrbName } from '@/lib/dragon/naming'

type DragonInventory = {
  stars: Record<string, { count: number; orbs: Array<{ id: number }> }>
  progress: number
  missingStars: number[]
  summonReady: boolean
  claimBlocked: boolean
  blockedReason?: string
  tradeLockedOrbs?: unknown[]
  consumedOrbs?: unknown[]
  activeScaleItem?: { id: number } | null
  equippedScaleItem?: { id: number; equippedForRaceId?: number | null } | null
}

type DragonUserState = {
  id: number
  name: string
  avatarUrl?: string | null
  inventory: DragonInventory
}

export type DragonStateData = {
  currentWeek?: {
    star: number
    orbName: string
    weekKey: string
    weekStart?: string | Date
    weekEnd?: string | Date
    isOverride?: boolean
    headline?: string
    subline?: string
  }
  users: DragonUserState[]
  immortalUsers: Array<{ id: number; name: string; title: string }>
  trades?: Array<Record<string, unknown>>
  recentOrbEvents?: Array<{ id: number; type: string; message?: string | null; createdAt?: string }>
  recentItemEvents?: Array<{ id: number; type: string; message?: string | null; createdAt?: string }>
}

export function DragonOrbSlot({ star, count, compact = false }: { star: number; count: number; compact?: boolean }) {
  const acquired = count > 0
  const name = getDragonOrbName(star)

  return (
    <div
      aria-label={acquired ? `${name} acquired, count ${count}` : `${name} missing`}
      title={acquired ? `${name} x${count}` : `${name} missing`}
      className={`relative grid place-items-center rounded-full border-2 border-[var(--color-ggd-outline)] shadow-[inset_0_2px_0_rgba(255,255,255,0.22),0_3px_0_var(--color-ggd-outline)] transition-transform
        ${compact ? 'h-8 w-8 text-xs' : 'h-11 w-11 text-sm'}
        ${acquired
          ? 'bg-[radial-gradient(circle_at_30%_25%,rgba(255,255,255,0.92),rgba(255,216,77,0.95)_24%,rgba(255,122,48,0.84)_58%,rgba(78,24,8,0.92))] text-[var(--color-ggd-outline)] shadow-[0_0_16px_rgba(255,204,0,0.48),inset_0_2px_0_rgba(255,255,255,0.35),0_3px_0_var(--color-ggd-outline)]'
          : 'bg-[radial-gradient(circle_at_30%_25%,rgba(255,255,255,0.18),rgba(95,95,116,0.20)_36%,rgba(0,0,0,0.42))] text-white/35 opacity-70'
        }`}
    >
      <span className="font-display leading-none">{star}</span>
      {count > 1 && (
        <span className="absolute -right-1 -top-1 rounded-full border-2 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-neon-green)] px-1.5 py-0.5 font-data text-[9px] font-black text-[var(--color-ggd-outline)]">
          x{count}
        </span>
      )}
    </div>
  )
}

function WeeklyOmenOrb({ star, orbName }: { star: number; orbName: string }) {
  return (
    <div className="relative h-40 w-40 shrink-0 sm:h-48 sm:w-48" aria-hidden="true">
      <div className="absolute inset-0 rounded-full border border-[var(--color-ggd-gold)]/35 bg-[radial-gradient(circle,rgba(255,204,0,0.16),rgba(255,204,0,0)_58%)] motion-safe:animate-pulse motion-reduce:animate-none" />
      <div className="absolute inset-4 rounded-full border-2 border-[var(--color-ggd-outline)]/55" />
      {DRAGON_STARS.map((ringStar, index) => {
        const angle = (index / DRAGON_STARS.length) * Math.PI * 2 - Math.PI / 2
        const active = ringStar === star
        return (
          <div
            key={ringStar}
            className={`absolute grid h-9 w-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-[var(--color-ggd-outline)] font-display text-xs shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]
              ${active
                ? 'bg-[radial-gradient(circle_at_30%_24%,#fff8bd,#ffd84d_30%,#ff8538_65%,#431007)] text-[var(--color-ggd-outline)] shadow-[0_0_18px_rgba(255,204,0,0.62),inset_0_1px_0_rgba(255,255,255,0.45)]'
                : 'bg-[radial-gradient(circle_at_30%_24%,rgba(255,255,255,0.38),rgba(255,169,64,0.26)_42%,rgba(0,0,0,0.48))] text-white/45'
              }`}
            style={{
              left: `${50 + Math.cos(angle) * 41}%`,
              top: `${50 + Math.sin(angle) * 41}%`,
            }}
          >
            {ringStar}
          </div>
        )
      })}
      <div
        className="absolute left-1/2 top-1/2 grid h-20 w-20 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-[5px] border-[var(--color-ggd-outline)] bg-[radial-gradient(circle_at_28%_22%,#ffffff_0,#fff4a8_17%,#ffd13d_34%,#ff7a30_67%,#4f1405_100%)] text-[var(--color-ggd-outline)] shadow-[0_0_28px_rgba(255,204,0,0.74),inset_0_4px_0_rgba(255,255,255,0.42),0_5px_0_#5b2507]"
        title={orbName}
      >
        <span className="font-display text-4xl leading-none">{star}</span>
      </div>
    </div>
  )
}

function DragonWeeklyOmen({ currentWeek }: { currentWeek: NonNullable<DragonStateData['currentWeek']> }) {
  const orbName = currentWeek.orbName || getDragonOrbName(currentWeek.star)

  return (
    <div
      className="mt-5 overflow-hidden rounded-xl border-3 border-[var(--color-ggd-outline)] bg-[radial-gradient(circle_at_12%_18%,rgba(255,204,0,0.26),transparent_34%),linear-gradient(135deg,rgba(20,16,35,0.9),rgba(92,39,6,0.78),rgba(10,16,28,0.86))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]"
      aria-label={`Thiên tượng tuần này: ${orbName} xuất thế`}
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="font-data text-xs uppercase tracking-widest text-[var(--color-ggd-neon-green)]">
            Thiên tượng tuần này
          </div>
          <div className="mt-1 font-display text-4xl leading-tight text-white text-outlined">
            {currentWeek.headline ?? `${orbName} xuất thế.`}
          </div>
          <p className="mt-2 max-w-2xl font-readable text-sm leading-relaxed text-white/72">
            {currentWeek.subline ?? `Winner official race tuần này sẽ nhận ${orbName}.`} Ai về nhất thì ôm châu về Tàng Châu Các.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="ggd-tag bg-[var(--color-ggd-gold)] text-[var(--color-ggd-outline)]">
              Tuần {currentWeek.weekKey}
            </span>
            <span className="ggd-tag bg-[var(--color-ggd-neon-green)] text-[var(--color-ggd-outline)]">
              {orbName}
            </span>
            {currentWeek.isOverride && (
              <span className="ggd-tag bg-white text-[var(--color-ggd-outline)]">
                Admin override
              </span>
            )}
          </div>
        </div>
        <WeeklyOmenOrb star={currentWeek.star} orbName={orbName} />
      </div>
    </div>
  )
}

export function DragonCompassCard({ dragon }: { dragon?: DragonStateData | null }) {
  if (!dragon) {
    return null
  }

  return (
    <section className="ggd-card-gold ggd-stripe p-5 animate-slide-up opacity-0" style={{ animationDelay: '0.24s' }}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="font-display text-3xl text-[var(--color-ggd-gold)] text-outlined">Thất Tinh La Bàn</div>
          <p className="mt-1 font-readable text-sm text-white/70">Bảy viên xoay vòng theo tuần. Duplicate là nhiên liệu đổi kèo.</p>
        </div>
        <Link href="/dragon" className="ggd-btn bg-[var(--color-ggd-gold)] px-4 py-2 text-sm text-[var(--color-ggd-outline)]">
          Mở Tàng Châu Các
        </Link>
      </div>

      {dragon.currentWeek && (
        <DragonWeeklyOmen currentWeek={dragon.currentWeek} />
      )}

      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        {dragon.users.map((user) => {
          const inventory = user.inventory
          const badges = [
            inventory.summonReady && !inventory.claimBlocked ? 'Thất Tinh đã đủ' : null,
            inventory.claimBlocked ? 'Đủ bộ, nhưng đang giữ Long Lân' : null,
            inventory.activeScaleItem ? 'Đang giữ Long Lân' : null,
            inventory.equippedScaleItem ? 'Long Lân đã nhập trận' : null,
          ].filter((badge): badge is string => Boolean(badge))

          return (
            <article key={user.id} className="rounded-xl border-3 border-[var(--color-ggd-outline)] bg-black/22 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-body text-base font-black text-white">{user.name}</div>
                  <div className="font-data text-xs text-white/55">Bộ hiện tại: {inventory.progress}/7</div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {badges.map((badge) => (
                    <span key={badge} className="ggd-tag bg-[var(--color-ggd-neon-green)] text-[var(--color-ggd-outline)] text-[10px]">
                      {badge}
                    </span>
                  ))}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {DRAGON_STARS.map((star) => (
                  <DragonOrbSlot key={star} star={star} count={inventory.stars[String(star)]?.count ?? 0} compact />
                ))}
              </div>
              <div className="mt-3 font-data text-[11px] text-white/55">
                Thiếu: {inventory.missingStars.length > 0 ? inventory.missingStars.map(getDragonOrbName).join(', ') : 'Không thiếu viên nào'}
              </div>
            </article>
          )
        })}
      </div>

      {dragon.immortalUsers.length > 0 && (
        <div className="mt-4 rounded-xl border-3 border-[var(--color-ggd-outline)] bg-black/24 p-4">
          {dragon.immortalUsers.map((user) => (
            <div key={user.id} className="font-data text-sm text-white/70">
              {user.name} · {user.title} · no orb progress
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {[...(dragon.recentOrbEvents ?? []), ...(dragon.recentItemEvents ?? [])].slice(0, 4).map((event) => (
          <div key={`${event.type}-${event.id}`} className="rounded-lg border-2 border-[var(--color-ggd-outline)]/45 bg-[var(--color-ggd-panel)] px-3 py-2 font-readable text-xs text-white/70">
            {event.message ?? event.type}
          </div>
        ))}
      </div>
    </section>
  )
}
