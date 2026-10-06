import { cosmetic } from '../define'
import type { CosmeticDefinition } from '../types'

/** Catalog entries for the idol-pop collection (art in scripts/cosmetics/art/sets/idol-pop.ts). */
export const IDOL_POP_ITEMS: CosmeticDefinition[] = [
  cosmetic('body-idol-amethyst', 'Amethyst Spotlight', 'bodyColor', 'rare', 'Idol Pop', { color: '#7C3AED' }),
  cosmetic('face-idol-star-shades', 'Superstar Shades', 'face', 'rare', 'Idol Pop'),
  cosmetic('trail-idol-confetti', 'Confetti Encore', 'trail', 'rare', 'Idol Pop'),
  cosmetic('head-idol-headset', 'Encore Headset', 'head', 'epic', 'Idol Pop'),
  cosmetic('pet-idol-lightstick', 'Lightstick Buddy', 'pet', 'epic', 'Idol Pop'),
  cosmetic('aura-idol-spotlights', 'Spotlight Stage', 'aura', 'epic', 'Idol Pop'),
  cosmetic('outfit-idol-holo-stagewear', 'Holo Stagewear', 'outfit', 'legendary', 'Idol Pop'),
]
