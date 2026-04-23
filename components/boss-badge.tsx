'use client'

import Image from 'next/image'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

interface BossBadgeProps {
  compact?: boolean
  streak?: number
}

export function BossBadge({ compact = false, streak }: BossBadgeProps) {
  const crownSize = compact ? 18 : 24
  const cloneCount = Math.max(streak ?? 3, 3)
  const fireTierClass = cloneCount >= 5
    ? 'boss-fire-tier-3'
    : cloneCount >= 4
      ? 'boss-fire-tier-2'
      : 'boss-fire-tier-1'
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={`boss-crown-badge ${fireTierClass}`}
            style={compact ? { padding: '2px 8px 2px 3px', fontSize: 10 } : undefined}
          >
            <span className="boss-fire-aura" aria-hidden="true">
              <span className="boss-fire-tongue boss-fire-tongue-1" />
              <span className="boss-fire-tongue boss-fire-tongue-2" />
              <span className="boss-fire-tongue boss-fire-tongue-3" />
              <span className="boss-fire-tongue boss-fire-tongue-4" />
              <span className="boss-fire-tongue boss-fire-tongue-5" />
            </span>
            <Image
              src="/assets/v2/boss-crown.svg"
              alt="Boss"
              width={crownSize}
              height={crownSize}
              className="crown-svg"
              unoptimized
            />
            <span className="boss-crown-label">BOSS</span>
            {typeof streak === 'number' && (
              <span className="boss-crown-label opacity-80">{streak}/3</span>
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent sideOffset={6} className="max-w-[220px] bg-[var(--color-ggd-panel)] text-white border-2 border-[var(--color-ggd-outline)]">
          Race kế tiếp sẽ spawn {cloneCount} clone. Chỉ cần 1 clone về nhóm cuối là Boss mất ngôi.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
