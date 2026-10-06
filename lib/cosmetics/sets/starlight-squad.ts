import { cosmetic } from '../define'
import type { CosmeticDefinition } from '../types'

/** Catalog entries for the starlight-squad collection (art in scripts/cosmetics/art/sets/starlight-squad.ts). */
export const STARLIGHT_SQUAD_ITEMS: CosmeticDefinition[] = [
  cosmetic('body-starlight-pastel', 'Pastel Starlight', 'bodyColor', 'rare', 'Starlight Squad', { color: '#F9A8D4' }),
  cosmetic('face-starlight-twinkle', 'Twinkle Gaze', 'face', 'rare', 'Starlight Squad'),
  cosmetic('trail-starlight-ribbon', 'Ribbon Comet', 'trail', 'rare', 'Starlight Squad'),
  cosmetic('head-starlight-tiara', 'Crescent Tiara', 'head', 'epic', 'Starlight Squad'),
  cosmetic('pet-starlight-mochi', 'Mochi Star Sprite', 'pet', 'epic', 'Starlight Squad'),
  cosmetic('aura-starlight-halo', 'Guardian Starfall', 'aura', 'epic', 'Starlight Squad'),
  cosmetic('outfit-starlight-captain', 'Squad Captain Uniform', 'outfit', 'legendary', 'Starlight Squad'),
]
