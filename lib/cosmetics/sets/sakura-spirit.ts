import { cosmetic } from '../define'
import type { CosmeticDefinition } from '../types'

/** Catalog entries for the sakura-spirit collection (art in scripts/cosmetics/art/sets/sakura-spirit.ts). */
export const SAKURA_SPIRIT_ITEMS: CosmeticDefinition[] = [
  cosmetic('body-sakura-dusk', 'Sakura Dusk', 'bodyColor', 'rare', 'Sakura Spirit', { color: '#3F3A8C' }),
  cosmetic('face-sakura-kitsune-blush', 'Kitsune Blush', 'face', 'rare', 'Sakura Spirit'),
  cosmetic('trail-sakura-petal-stream', 'Hoa Anh Petal Stream', 'trail', 'rare', 'Sakura Spirit'),
  cosmetic('head-sakura-lantern-ears', 'Lantern Fox Ears', 'head', 'epic', 'Sakura Spirit'),
  cosmetic('pet-sakura-kitsune', 'Kitsune Linh', 'pet', 'epic', 'Sakura Spirit'),
  cosmetic('aura-sakura-torii-moon', 'Torii Moonrise', 'aura', 'epic', 'Sakura Spirit'),
  cosmetic('outfit-sakura-silk-kimono', 'Hoa Anh Silk Kimono', 'outfit', 'legendary', 'Sakura Spirit'),
]
