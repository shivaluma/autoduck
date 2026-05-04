'use client'

import Image from 'next/image'
import type { ShieldData } from '@/lib/types'

interface ShieldAgingStackProps {
  shields: ShieldData[]
  maxVisible?: number
  legacyCount?: number
  highlightRaceId?: number | null
}

function shieldVisual(charges: number) {
  if (charges <= 1) {
    return {
      src: '/assets/v2/shield-broken.svg',
      className: 'bg-[var(--color-ggd-orange)]/20 border-[var(--color-ggd-orange)] shadow-[0_0_12px_rgba(255,87,51,0.35)] animate-pulse',
      label: 'vỡ ở race kế tiếp nếu không dùng',
    }
  }

  if (charges <= 2) {
    return {
      src: '/assets/v2/shield-cracked.svg',
      className: 'bg-[var(--color-ggd-gold)]/18 border-[var(--color-ggd-gold)] shadow-[0_0_10px_rgba(255,204,0,0.25)]',
      label: 'vỡ sau 2 race không dùng',
    }
  }

  return {
    src: '/assets/v2/shield-fresh.svg',
    className: 'bg-[var(--color-ggd-neon-green)]/14 border-[var(--color-ggd-neon-green)]/70 shadow-[0_0_8px_rgba(61,255,143,0.18)]',
    label: 'vỡ sau 3 race không dùng',
  }
}

export function ShieldAgingStack({ shields, maxVisible = 12, legacyCount = 0, highlightRaceId = null }: ShieldAgingStackProps) {
  if (shields.length === 0) {
    if (legacyCount > 0) {
      if (legacyCount > 100) {
        return (
          <div
            className="inline-flex items-center gap-1.5 rounded-xl border-2 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-neon-green)]/12 px-2 py-1"
            title={`${legacyCount} khiên legacy. Duck này dùng auto shield gần như vô hạn, không render từng icon để tránh quá tải.`}
          >
            <Image src="/assets/v2/shield-fresh.svg" alt="legacy shields" width={20} height={20} unoptimized />
            <span className="font-data text-[11px] font-black text-[var(--color-ggd-neon-green)]">∞</span>
          </div>
        )
      }

      const visibleLegacy = Array.from({ length: Math.min(legacyCount, maxVisible) })
      const hiddenLegacy = legacyCount - visibleLegacy.length
      return (
        <div className="flex flex-wrap justify-center gap-1 px-2">
          {visibleLegacy.map((_, index) => (
            <div
              key={`legacy-${index}`}
              className="group relative flex h-8 w-8 items-center justify-center rounded-lg border-2 border-[var(--color-ggd-neon-green)]/70 bg-[var(--color-ggd-neon-green)]/14 shadow-[0_0_8px_rgba(61,255,143,0.18)] transition-transform duration-150 hover:-translate-y-1 hover:scale-110"
              title={`Khiên legacy #${index + 1}: chưa có record Shield riêng trên DB prod, tạm xem là còn bền. Nên chạy migration tuổi thọ khiên để theo dõi chính xác.`}
            >
              <Image
                src="/assets/v2/shield-fresh.svg"
                alt={`Khiên legacy #${index + 1}`}
                width={24}
                height={24}
                unoptimized
                className="drop-shadow-[1px_1px_0_rgba(0,0,0,0.7)]"
              />
            </div>
          ))}
          {hiddenLegacy > 0 && (
            <span
              className="flex h-8 min-w-8 items-center justify-center rounded-lg border-2 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] px-2 font-data text-[10px] font-black text-[var(--color-ggd-muted)]"
              title={`Còn ${hiddenLegacy} khiên legacy khác chưa hiển thị trong leaderboard.`}
            >
              +{hiddenLegacy}
            </span>
          )}
        </div>
      )
    }
    return <span className="block h-8" aria-label="Không có khiên" />
  }

  const visible = shields.slice(0, maxVisible)
  const hidden = shields.length - visible.length

  return (
    <div className="flex flex-wrap justify-center gap-1 px-2">
      {visible.map((shield) => {
        const visual = shieldVisual(shield.charges)
        const isFreshReward = typeof highlightRaceId === 'number' && shield.earnedRaceId === highlightRaceId
        return (
          <div
            key={shield.id}
            className={`group relative flex h-8 w-8 items-center justify-center rounded-lg border-2 transition-transform duration-150 hover:-translate-y-1 hover:scale-110 ${visual.className} ${isFreshReward ? 'ring-2 ring-[var(--color-ggd-gold)] ring-offset-2 ring-offset-[var(--color-ggd-panel)]' : ''}`}
            title={`Khiên #${shield.id}: ${visual.label}.${shield.earnedRaceId ? ` Nhận từ race #${shield.earnedRaceId}.` : ''}`}
          >
            <Image
              src={visual.src}
              alt={`Khiên #${shield.id}`}
              width={24}
              height={24}
              unoptimized
              className="drop-shadow-[1px_1px_0_rgba(0,0,0,0.7)]"
            />
            {isFreshReward && (
              <span className="absolute -top-2 -left-2 rounded bg-[var(--color-ggd-gold)] px-1 font-data text-[8px] font-black text-[var(--color-ggd-outline)] shadow-[0_1px_0_var(--color-ggd-outline)]">
                NEW
              </span>
            )}
          </div>
        )
      })}
      {hidden > 0 && (
        <span
          className="flex h-8 min-w-8 items-center justify-center rounded-lg border-2 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] px-2 font-data text-[10px] font-black text-[var(--color-ggd-muted)]"
          title={`Còn ${hidden} khiên khác chưa hiển thị trong leaderboard.`}
        >
          +{hidden}
        </span>
      )}
    </div>
  )
}
