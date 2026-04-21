'use client'

import Image from 'next/image'

interface ShieldChipProps {
  id: number
  weeksUnused: number
  selected?: boolean
  disabled?: boolean
  onClick?: () => void
}

function tierClass(weeksUnused: number, selected: boolean) {
  if (selected) return 'shield-tier-fresh shield-chip-selected'
  if (weeksUnused >= 3) return 'shield-tier-danger'
  if (weeksUnused >= 2) return 'shield-tier-aging'
  return 'shield-tier-fresh'
}

export function ShieldChip({ id, weeksUnused, selected = false, disabled = false, onClick }: ShieldChipProps) {
  const aged = weeksUnused >= 2
  const iconSrc = weeksUnused >= 3
    ? '/assets/v2/shield-broken.svg'
    : '/assets/v2/shield-cracked.svg'
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      type="button"
      className={`shield-chip ${tierClass(weeksUnused, selected)} disabled:opacity-90 disabled:cursor-default`}
      title={`Khiên #${id} · ${weeksUnused} tuần chưa dùng${weeksUnused >= 3 ? ' · sắp vỡ!' : weeksUnused >= 2 ? ' · cảnh báo' : ''}`}
    >
      <Image src={iconSrc} alt="shield" width={18} height={18} className="shield-chip-icon" unoptimized
        style={aged ? { filter: 'grayscale(0.2) brightness(1.05)' } : undefined} />
      <span>#{id}</span>
      <span className="opacity-70">·</span>
      <span>{weeksUnused}w</span>
      {weeksUnused >= 3 && <span className="ml-0.5">⚠</span>}
    </button>
  )
}
