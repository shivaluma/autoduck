'use client'

import Image from 'next/image'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

interface BossBadgeProps {
  compact?: boolean
  streak?: number
}

export function BossBadge({ compact = false, streak }: BossBadgeProps) {
  const crownSize = compact ? 18 : 24
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="boss-crown-badge" style={compact ? { padding: '2px 8px 2px 3px', fontSize: 10 } : undefined}>
            <Image
              src="/assets/v2/boss-crown.svg"
              alt="Boss"
              width={crownSize}
              height={crownSize}
              className="crown-svg"
              unoptimized
            />
            <span>BOSS</span>
            {typeof streak === 'number' && (
              <span className="opacity-80">{Math.min(streak, 3)}/3</span>
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent sideOffset={6} className="max-w-[220px] bg-[var(--color-ggd-panel)] text-white border-2 border-[var(--color-ggd-outline)]">
          Race kế tiếp sẽ spawn 3 clone. Chỉ cần 1 clone về nhóm cuối là Boss mất ngôi.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
