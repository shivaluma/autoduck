'use client'

import type { ChestEffect } from '@/lib/types'
import { ChestIcon } from '@/components/chest-icon'

interface ChestCardOption {
  userId: number
  name: string
  shieldCount?: number
}

interface ChestCardProps {
  chestId: number
  ownerName: string
  effect: ChestEffect
  description: string
  targetUserId?: number
  targetOptions: ChestCardOption[]
  needsTarget: boolean
  onTargetChange: (targetUserId?: number) => void
}

export function ChestCard({
  chestId,
  ownerName,
  effect,
  description,
  targetUserId,
  targetOptions,
  needsTarget,
  onTargetChange,
}: ChestCardProps) {
  const targetLabel = effect === 'CURSE_SWAP'
    ? 'Đổi tên với'
    : effect === 'INSURANCE_FRAUD'
      ? 'Kéo theo nếu chết'
      : effect === 'PUBLIC_SHIELD'
        ? 'Mượn khiên của'
        : 'Đặt cược vào'

  const helper = effect === 'PUBLIC_SHIELD'
    ? 'Chỉ hiện những người đang còn ít nhất 1 khiên active.'
    : effect === 'INSURANCE_FRAUD'
      ? 'Target sẽ dính theo nếu chủ rương thành con dzit, bypass cả khiên.'
      : effect === 'CURSE_SWAP'
        ? 'Live và commentary sẽ nhìn theo tên giả, nhưng scar vẫn map về đúng người.'
        : 'Nếu target về P1 thì chủ rương ăn thêm 1 khiên.'

  return (
    <div className="rounded-2xl border-3 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] p-4 shadow-[0_4px_0_var(--color-ggd-outline)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-display text-lg text-white">🎁 Rương #{chestId} - {ownerName}</div>
          <p className="font-body text-sm text-white/75 mt-2">{description}</p>
        </div>
        <ChestIcon effect={effect} tone="gold" />
      </div>

      {needsTarget ? (
        <div className="mt-4">
          <label className="font-data text-xs uppercase text-[var(--color-ggd-muted)]">{targetLabel}</label>
          <select
            value={targetUserId ?? ''}
            onChange={(event) => onTargetChange(event.target.value ? Number(event.target.value) : undefined)}
            className="mt-2 w-full rounded-xl border-3 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-surface)] px-4 py-3 text-white font-data outline-none"
          >
            <option value="">-- Chọn một vịt --</option>
            {targetOptions.map((option) => (
              <option key={option.userId} value={option.userId}>
                {option.name}
                {typeof option.shieldCount === 'number' ? ` (${option.shieldCount} khiên)` : ''}
              </option>
            ))}
          </select>
          <div className="font-data text-xs text-white/60 mt-2">{helper}</div>
          {!targetUserId && (
            <div className="font-data text-xs text-[var(--color-ggd-orange)] mt-2">⚠ Chưa chọn, race sẽ bị khóa.</div>
          )}
        </div>
      ) : (
        <div className="mt-4 rounded-xl border-2 border-[var(--color-ggd-outline)]/30 bg-black/20 px-3 py-2 font-data text-xs text-[var(--color-ggd-neon-green)]">
          Effect này không cần target, hệ thống sẽ tự áp dụng trong race.
        </div>
      )}
    </div>
  )
}
