import type { CosmeticSlot } from '../../../../lib/cosmetics/types'

/** slot → catalog id → SVG content drawer (same contract as the per-slot art files). */
export type SetArt = Partial<Record<CosmeticSlot, Record<string, () => string>>>
