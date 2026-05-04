'use client'

import Image from 'next/image'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { getBossExtraEntries, getBossTotalEntries } from '@/lib/boss-logic'

interface BossBadgeProps {
  compact?: boolean
  streak?: number
}

export function BossBadge({ compact = false, streak }: BossBadgeProps) {
  const crownSize = compact ? 18 : 24
  const cloneCount = getBossExtraEntries(streak)
  const totalEntries = getBossTotalEntries(streak)
  const tierClass = cloneCount >= 3
    ? 'boss-tier-3'
    : cloneCount >= 2
      ? 'boss-tier-2'
      : 'boss-tier-1'
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={`boss-crown-badge ${tierClass}`}
            style={compact ? { padding: '2px 8px 2px 3px', fontSize: 10 } : undefined}
          >
            <span className="boss-shine" aria-hidden="true">
              <span className="boss-shine-primary" />
              <span className="boss-shine-secondary" />
            </span>
            <span className="boss-sparkles" aria-hidden="true">
              <span className="boss-spark boss-spark-1" />
              <span className="boss-spark boss-spark-2" />
              <span className="boss-spark boss-spark-3" />
              <span className="boss-spark boss-spark-4" />
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
              <span className="boss-crown-label opacity-80">{streak}</span>
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent sideOffset={6} className="max-w-[220px] bg-[var(--color-ggd-panel)] text-white border-2 border-[var(--color-ggd-outline)]">
          Race kế tiếp có {totalEntries} entries ({cloneCount} clone). Chỉ cần 1 entry lọt top 2 cuối là Boss mất ngôi.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
