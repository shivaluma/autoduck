'use client'

import type { ShieldData } from '@/lib/types'
import { ShieldChip } from '@/components/shield-chip'

interface ShieldAgingStackProps {
  shields: ShieldData[]
  maxVisible?: number
}

export function ShieldAgingStack({ shields, maxVisible = 4 }: ShieldAgingStackProps) {
  if (shields.length === 0) {
    return <span className="font-data text-2xl font-black text-[var(--color-ggd-muted)]/20">0</span>
  }

  const visible = shields.slice(0, maxVisible)
  const hidden = shields.length - visible.length

  return (
    <div className="flex flex-wrap justify-center gap-1 px-2">
      {visible.map((shield) => (
        <ShieldChip key={shield.id} id={shield.id} weeksUnused={shield.weeksUnused} disabled />
      ))}
      {hidden > 0 && (
        <span className="ggd-tag bg-[var(--color-ggd-panel)] text-[var(--color-ggd-muted)]">+{hidden}</span>
      )}
    </div>
  )
}
