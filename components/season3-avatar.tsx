import Image from 'next/image'
import { CosmeticDuck } from '@/components/cosmetics/cosmetic-duck'
import type { DuckAppearance } from '@/lib/cosmetics/types'

function initials(name: string) {
  return name
    .replace(/^Zịt\s+/i, '')
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

/** Head-and-shoulders crop of the duck rig used for portraits. */
const PORTRAIT_FRAME = [176, -10, 330] as const

/**
 * Player portrait. With an appearance it shows the player's own duck (same art as the race), framed in
 * a round token; otherwise falls back to their photo, then initials.
 */
export function Season3Avatar({ name, avatarUrl, appearance, size = 40, ring }: {
  name: string
  avatarUrl?: string | null
  appearance?: DuckAppearance | null
  size?: number
  ring?: string
}) {
  const frameStyle = { width: size, height: size, borderColor: ring ?? 'var(--gx-ink, #1b132b)' }
  if (appearance?.bodyColorId) {
    const portrait = { bodyColorId: appearance.bodyColorId, bodySkinId: appearance.bodySkinId, faceId: appearance.faceId, headId: appearance.headId, outfitId: appearance.outfitId } as DuckAppearance
    return (
      <span
        className="relative inline-block shrink-0 overflow-hidden rounded-full border-[3px] bg-[radial-gradient(circle_at_60%_30%,#7dd3fc,#1a78ab_70%)] shadow-[0_3px_0_var(--gx-ink,#1b132b)]"
        style={frameStyle}
        role="img"
        aria-label={name}
      >
        <CosmeticDuck appearance={portrait} size="100%" frame={PORTRAIT_FRAME} animate={false} label={name} />
      </span>
    )
  }
  return avatarUrl ? (
    <Image
      src={avatarUrl}
      alt={name}
      width={size}
      height={size}
      unoptimized
      className="shrink-0 rounded-full border-[3px] object-cover shadow-[0_3px_0_var(--gx-ink,#1b132b)]"
      style={frameStyle}
    />
  ) : (
    <span
      className="flex shrink-0 items-center justify-center rounded-full border-[3px] bg-[linear-gradient(180deg,#4c3a96,#2a1d57)] text-xs font-black text-white shadow-[0_3px_0_var(--gx-ink,#1b132b)]"
      style={frameStyle}
      aria-label={name}
    >
      {initials(name)}
    </span>
  )
}
