import { COSMETIC_BY_ID, DEFAULT_APPEARANCE } from '@/lib/cosmetics/catalog'
import { AVATAR_FRAME, COSMETIC_LAYER_ORDER, type DuckAppearance } from '@/lib/cosmetics/types'

/* eslint-disable @next/next/no-img-element -- modular SVG layers share one canonical coordinate frame */

export function CosmeticDuck({
  appearance = DEFAULT_APPEARANCE,
  size = 256,
  label,
  animate = true,
  frame,
}: {
  appearance?: DuckAppearance
  /** Pixels, or any CSS length (e.g. '100%') to fill the parent. */
  size?: number | string
  label?: string
  animate?: boolean
  /** Square crop [x, y, size] in rig coordinates (see SLOT_FRAMES) — zooms the duck to one area. */
  frame?: readonly [number, number, number]
}) {
  const layers = COSMETIC_LAYER_ORDER.flatMap((slot) => {
    const cosmeticId = appearance[`${slot}Id` as keyof DuckAppearance]
    const item = cosmeticId ? COSMETIC_BY_ID.get(cosmeticId) : undefined
    return item ? [item] : []
  })
  const [frameX, frameY, frameSize] = frame ?? [AVATAR_FRAME.x, AVATAR_FRAME.y, AVATAR_FRAME.size]
  const scale = AVATAR_FRAME.size / frameSize
  const stage = `${scale * 100}%`
  const offsetX = `${-((frameX - AVATAR_FRAME.x) / frameSize) * 100}%`
  const offsetY = `${-((frameY - AVATAR_FRAME.y) / frameSize) * 100}%`

  return (
    <div
      role="img"
      aria-label={label ?? 'Dzịt đã tùy biến'}
      className="relative shrink-0 select-none overflow-hidden"
      style={{ width: size, height: size }}
    >
      <div
        className={`absolute ${animate ? 'duck-avatar-rig-idle' : ''}`}
        style={{ width: stage, height: stage, left: offsetX, top: offsetY }}
      >
        <svg aria-hidden viewBox={`${AVATAR_FRAME.x} ${AVATAR_FRAME.y} ${AVATAR_FRAME.size} ${AVATAR_FRAME.size}`} className="pointer-events-none absolute inset-0 h-full w-full">
          <ellipse cx="252" cy="436" rx="170" ry="30" fill="#100A20" opacity=".28" />
        </svg>
        {layers.map((item) => (
          <img
            key={item.slot}
            aria-hidden
            src={item.asset}
            alt=""
            draggable={false}
            className={`pointer-events-none absolute inset-0 h-full w-full cosmetic-layer-${item.slot}`}
          />
        ))}
      </div>
    </div>
  )
}
