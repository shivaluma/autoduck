'use client'

import type { ChestEffect } from '@/lib/types'
import { ChestCard } from '@/components/chest-card'

interface ChestRevealProps {
  chestId: number
  effect: ChestEffect
  animated?: boolean
  compact?: boolean
}

export function ChestReveal({ chestId, effect, animated = true, compact = false }: ChestRevealProps) {
  return (
    <ChestCard
      effect={effect}
      chestId={chestId}
      size={compact ? 'md' : 'lg'}
      animated={animated}
      opened
      showTagline={!compact}
      interactive
    />
  )
}
