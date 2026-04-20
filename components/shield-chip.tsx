'use client'

interface ShieldChipProps {
  id: number
  weeksUnused: number
  selected?: boolean
  disabled?: boolean
  onClick?: () => void
}

function toneForAge(weeksUnused: number, selected: boolean) {
  if (selected) {
    return 'bg-[var(--color-ggd-sky)] text-[var(--color-ggd-outline)]'
  }
  if (weeksUnused >= 3) {
    return 'bg-[var(--color-ggd-orange)]/20 text-[var(--color-ggd-orange)]'
  }
  if (weeksUnused >= 2) {
    return 'bg-[var(--color-ggd-gold)]/20 text-[var(--color-ggd-gold)]'
  }
  return 'bg-[var(--color-ggd-panel)] text-[var(--color-ggd-neon-green)]'
}

export function ShieldChip({ id, weeksUnused, selected = false, disabled = false, onClick }: ShieldChipProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`px-3 py-2 rounded-xl border-3 border-[var(--color-ggd-outline)] text-xs font-data transition-all ${toneForAge(weeksUnused, selected)} disabled:opacity-50 disabled:cursor-not-allowed`}
    >
      🛡️ #{id} · {weeksUnused}w {weeksUnused >= 2 ? '⚠️' : ''}
    </button>
  )
}
