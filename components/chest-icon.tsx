'use client'

import type { ChestEffect } from '@/lib/types'

const effectLabel: Record<ChestEffect, string> = {
  NOTHING: '💨 Trống Trơn',
  CURSE_SWAP: '🎭 Curse Swap',
  INSURANCE_FRAUD: '💣 Insurance Fraud',
  IDENTITY_THEFT: '👤 Identity Theft',
  PUBLIC_SHIELD: '🛡️ Public Shield',
  I_CHOOSE_YOU: '🎯 I Choose You',
}

interface ChestIconProps {
  effect: ChestEffect
  compact?: boolean
  tone?: 'orange' | 'green' | 'gold' | 'muted'
}

export function ChestIcon({ effect, compact = false, tone = 'orange' }: ChestIconProps) {
  const toneClass = tone === 'green'
    ? 'bg-[var(--color-ggd-neon-green)] text-[var(--color-ggd-outline)]'
    : tone === 'gold'
      ? 'bg-[var(--color-ggd-gold)] text-[var(--color-ggd-outline)]'
      : tone === 'muted'
        ? 'bg-[var(--color-ggd-muted)] text-white'
        : 'bg-[var(--color-ggd-orange)] text-white'

  return (
    <span className={`ggd-tag ${toneClass} ${compact ? 'text-[10px]' : 'text-xs'}`}>
      {compact ? `🎁 ${effect}` : effectLabel[effect]}
    </span>
  )
}
