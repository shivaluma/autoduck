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
  if (charges <= 2) return 'shield-tier-aging'
  return 'shield-tier-fresh'
}

export function ShieldChip({ id, charges, selected = false, disabled = false, onClick }: ShieldChipProps) {
  const aged = charges <= 2
  const iconSrc = charges <= 1
    ? '/assets/v2/shield-broken.svg'
    : charges <= 2
      ? '/assets/v2/shield-cracked.svg'
      : '/assets/v2/shield-fresh.svg'
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      type="button"
      className={`shield-chip ${tierClass(charges, selected)} disabled:opacity-90 disabled:cursor-default`}
      title={`Khiên #${id} · còn ${charges} charge${charges <= 1 ? ' · sắp vỡ!' : charges <= 2 ? ' · cảnh báo' : ''}`}
    >
      <Image src={iconSrc} alt="shield" width={18} height={18} className="shield-chip-icon" unoptimized
        style={aged ? { filter: 'grayscale(0.2) brightness(1.05)' } : undefined} />
      <span>#{id}</span>
      <span className="opacity-70">·</span>
      <span>{charges}c</span>
      {charges <= 1 && <span className="ml-0.5">⚠</span>}
    </button>
  )
}
