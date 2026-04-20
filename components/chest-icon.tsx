'use client'

import type { ChestEffect } from '@/lib/types'
import { ChestCard } from '@/components/chest-card'

interface ChestIconProps {
  effect: ChestEffect
  compact?: boolean
  /** @deprecated giữ tham số để backward compat, không còn ảnh hưởng tới color */
  tone?: 'orange' | 'green' | 'gold' | 'muted'
}

export function ChestIcon({ effect, compact = false }: ChestIconProps) {
  return <ChestCard effect={effect} size={compact ? 'sm' : 'md'} opened animated={false} />
}
