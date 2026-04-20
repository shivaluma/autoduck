'use client'

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

interface BossBadgeProps {
  compact?: boolean
  streak?: number
}

export function BossBadge({ compact = false, streak }: BossBadgeProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={`inline-flex items-center gap-1 rounded-full border-2 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-gold)] text-[var(--color-ggd-outline)] shadow-[0_2px_0_var(--color-ggd-outline)] ${
              compact ? 'px-2 py-0.5 text-[10px]' : 'px-3 py-1 text-xs'
            }`}
          >
            <span>👑</span>
            <span className="font-data font-black uppercase tracking-wider">Boss</span>
            {typeof streak === 'number' && <span className="font-data font-black">{Math.min(streak, 3)}/3</span>}
          </span>
        </TooltipTrigger>
        <TooltipContent sideOffset={6} className="max-w-[220px] bg-[var(--color-ggd-panel)] text-white border-2 border-[var(--color-ggd-outline)]">
          Race kế tiếp sẽ spawn 3 clone. Chỉ cần 1 clone về nhóm cuối là Boss mất ngôi.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
