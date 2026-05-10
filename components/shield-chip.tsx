'use client'

import Image from 'next/image'

interface ShieldChipProps {
  id: number
  charges: number
  selected?: boolean
  disabled?: boolean
  onClick?: () => void
}

function tierClass(charges: number, selected: boolean) {
  if (selected) return 'shield-tier-fresh shield-chip-selected'
  if (charges <= 1) return 'shield-tier-danger'
  if (charges <= 3) return 'shield-tier-aging'
  return 'shield-tier-fresh'
}

function shieldBreakText(charges: number) {
  if (charges <= 1) return 'Khiên Bất Ổn: 50% cứu, 50% phát nổ tụt 1 hạng'
  if (charges <= 2) return 'vỡ sau 2 race không dùng'
  if (charges <= 3) return 'vỡ sau 3 race không dùng'
  if (charges <= 4) return 'vỡ sau 4 race không dùng'
  return 'vỡ sau 5 race không dùng'
}

export function ShieldChip({ id, charges, selected = false, disabled = false, onClick }: ShieldChipProps) {
  const aged = charges <= 3
  const iconSrc = charges <= 1
    ? '/assets/v2/shield-broken.svg'
    : charges <= 3
      ? '/assets/v2/shield-cracked.svg'
      : '/assets/v2/shield-fresh.svg'
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      type="button"
      className={`shield-chip ${tierClass(charges, selected)} disabled:opacity-90 disabled:cursor-default`}
      title={`Khiên #${id} · ${shieldBreakText(charges)}`}
      aria-label={`Khiên #${id}, ${shieldBreakText(charges)}`}
    >
      <Image src={iconSrc} alt="shield" width={18} height={18} className="shield-chip-icon" unoptimized
        style={aged ? { filter: 'grayscale(0.2) brightness(1.05)' } : undefined} />
      <span>#{id}</span>
    </button>
  )
}
