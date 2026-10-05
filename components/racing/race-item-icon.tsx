import { ITEM_ICON_BY_ID, raceFxIconPath } from '@/lib/race-fx/manifest'

/* eslint-disable @next/next/no-img-element -- tiny static SVG icons, no optimisation needed */

/** Race item icon from the race FX set (same art as the race canvas); falls back to the catalog emoji. */
export function RaceItemIcon({ id, fallback, size = 36, className = '' }: { id: string; fallback?: string; size?: number; className?: string }) {
  const icon = ITEM_ICON_BY_ID[id]
  if (!icon) return <span className={className} style={{ fontSize: size * 0.85 }} aria-hidden>{fallback}</span>
  return <img src={raceFxIconPath(icon)} alt="" aria-hidden width={size} height={size} className={`shrink-0 drop-shadow-[0_2px_0_rgba(16,11,32,0.6)] ${className}`} draggable={false} />
}
