'use client'

import { useEffect, useState } from 'react'
import type { ChestEffect } from '@/lib/types'
import { ChestIcon } from '@/components/chest-icon'

interface ChestRevealProps {
  chestId: number
  effect: ChestEffect
  animated?: boolean
  compact?: boolean
}

export function ChestReveal({ chestId, effect, animated = true, compact = false }: ChestRevealProps) {
  const [revealed, setRevealed] = useState(!animated)

  useEffect(() => {
    const timer = window.setTimeout(() => setRevealed(true), animated ? (compact ? 600 : 1200) : 0)
    return () => window.clearTimeout(timer)
  }, [animated, compact])

  if (!revealed) {
    return (
      <div className={`rounded-xl border-3 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] ${compact ? 'px-3 py-2' : 'px-4 py-3'} shadow-[0_3px_0_var(--color-ggd-outline)]`}>
        <div className={`font-display text-white animate-bob ${compact ? 'text-sm' : 'text-base'}`}>📦 Rương đóng</div>
        <div className="font-data text-[11px] text-[var(--color-ggd-muted)] mt-1">Đang lật bài...</div>
      </div>
    )
  }

  return (
    <div className={`rounded-xl border-3 border-[var(--color-ggd-outline)] ${effect === 'NOTHING' ? 'bg-[var(--color-ggd-panel)]' : 'bg-[var(--color-ggd-gold)]/10'} ${compact ? 'px-3 py-2' : 'px-4 py-3'} shadow-[0_3px_0_var(--color-ggd-outline)]`}>
      <div className={`font-display ${compact ? 'text-sm' : 'text-base'} text-white`}>
        {effect === 'NOTHING' ? '💨 Trống Trơn' : `🎁 #${chestId}`}
      </div>
      <div className="mt-1">
        <ChestIcon effect={effect} compact tone={effect === 'NOTHING' ? 'muted' : 'gold'} />
      </div>
      {!compact && effect !== 'NOTHING' && (
        <div className="font-data text-[11px] text-white/70 mt-2">Phải dùng trong race kế tiếp.</div>
      )}
    </div>
  )
}
