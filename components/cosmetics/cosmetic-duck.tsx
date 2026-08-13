import { COSMETIC_BY_ID, DEFAULT_APPEARANCE } from '@/lib/cosmetics/catalog'
import { COSMETIC_LAYER_ORDER, type DuckAppearance } from '@/lib/cosmetics/types'

/* eslint-disable @next/next/no-img-element -- modular SVG layers must share one exact coordinate system */

export function CosmeticDuck({ appearance = DEFAULT_APPEARANCE, size = 256, label }: { appearance?: DuckAppearance; size?: number; label?: string }) {
  const layers = COSMETIC_LAYER_ORDER.flatMap((slot) => {
    const cosmeticId = appearance[`${slot}Id` as keyof DuckAppearance]
    const item = cosmeticId ? COSMETIC_BY_ID.get(cosmeticId) : undefined
    return item ? [item] : []
  })

  return <div role="img" aria-label={label ?? 'Dzịt đã tùy biến'} className="relative shrink-0 overflow-visible" style={{ width: size, height: size }}>
    <svg aria-hidden viewBox="0 0 256 256" className="absolute inset-0 h-full w-full">
      <ellipse cx="126" cy="218" rx="85" ry="15" fill="#100A20" opacity=".28" />
    </svg>
    {layers.map((item) => <img key={item.slot} aria-hidden src={item.asset} alt="" className={`pointer-events-none absolute inset-0 h-full w-full object-contain cosmetic-layer-${item.slot}`} />)}
  </div>
}
