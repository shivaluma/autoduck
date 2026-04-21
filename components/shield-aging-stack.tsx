'use client'

import Image from 'next/image'
import type { ShieldData } from '@/lib/types'

interface ShieldAgingStackProps {
  shields: ShieldData[]
  maxVisible?: number
  legacyCount?: number
}

function shieldVisual(weeksUnused: number) {
  if (weeksUnused >= 3) {
    return {
      src: '/assets/v2/shield-broken.svg',
      className: 'bg-[var(--color-ggd-orange)]/20 border-[var(--color-ggd-orange)] shadow-[0_0_12px_rgba(255,87,51,0.35)] animate-pulse',
      label: `đang vỡ thành sẹo ở weekly tick kế tiếp; mốc 5 tuần sẽ mất hẳn`,
    }
  }

  if (weeksUnused >= 2) {
    return {
      src: '/assets/v2/shield-cracked.svg',
      className: 'bg-[var(--color-ggd-gold)]/18 border-[var(--color-ggd-gold)] shadow-[0_0_10px_rgba(255,204,0,0.25)]',
      label: `còn 1 tuần nữa sẽ vỡ thành 1 sẹo`,
    }
  }

  return {
    src: '/assets/v2/shield-fresh.svg',
    className: 'bg-[var(--color-ggd-neon-green)]/14 border-[var(--color-ggd-neon-green)]/70 shadow-[0_0_8px_rgba(61,255,143,0.18)]',
    label: `an toàn; còn ${3 - weeksUnused} tuần nữa mới tới mốc vỡ`,
  }
}

export function ShieldAgingStack({ shields, maxVisible = 12, legacyCount = 0 }: ShieldAgingStackProps) {
  if (shields.length === 0) {
    if (legacyCount > 0) {
      return (
        <div
          className="inline-flex items-center gap-1.5 rounded-xl border-2 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-neon-green)]/12 px-2 py-1"
          title={`${legacyCount} khiên legacy. Thomas dùng auto shield vô hạn, không render từng icon để tránh quá tải.`}
        >
          <Image src="/assets/v2/shield-fresh.svg" alt="legacy shields" width={20} height={20} unoptimized />
          <span className="font-data text-[11px] font-black text-[var(--color-ggd-neon-green)]">
            {legacyCount >= 9999 ? '∞' : legacyCount}
          </span>
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
        const visual = shieldVisual(shield.weeksUnused)
        return (
          <div
            key={shield.id}
            className={`group relative flex h-8 w-8 items-center justify-center rounded-lg border-2 transition-transform duration-150 hover:-translate-y-1 hover:scale-110 ${visual.className}`}
            title={`Khiên #${shield.id}: ${shield.weeksUnused} tuần chưa dùng, ${visual.label}.`}
          >
            <Image
              src={visual.src}
              alt={`Khiên #${shield.id}`}
              width={24}
              height={24}
              unoptimized
              className="drop-shadow-[1px_1px_0_rgba(0,0,0,0.7)]"
            />
            <span className="absolute -bottom-1 -right-1 rounded bg-[var(--color-ggd-outline)] px-1 font-data text-[8px] font-black text-white">
              {shield.weeksUnused}w
            </span>
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
