import { cosmetic } from '../define'
import type { CosmeticDefinition } from '../types'

/** Catalog entries for the dusk-outlaw collection (art in scripts/cosmetics/art/sets/dusk-outlaw.ts). */
export const DUSK_OUTLAW_ITEMS: CosmeticDefinition[] = [
  cosmetic('body-outlaw-ember', 'Ember Dust', 'bodyColor', 'rare', 'Dusk Outlaw', { color: '#D9541E' }),
  cosmetic('face-outlaw-squint', 'Dusk Squint', 'face', 'rare', 'Dusk Outlaw'),
  cosmetic('trail-outlaw-sulfur', 'Sulfur Smoke', 'trail', 'rare', 'Dusk Outlaw'),
  cosmetic('head-outlaw-stetson', 'Hellfire Stetson', 'head', 'epic', 'Dusk Outlaw'),
  cosmetic('pet-outlaw-skull', "Lil' Bone Bandit", 'pet', 'epic', 'Dusk Outlaw'),
  cosmetic('aura-outlaw-halo', 'Fallen Halo', 'aura', 'epic', 'Dusk Outlaw'),
  cosmetic('outfit-outlaw-duster', 'Dusk Reaper Duster', 'outfit', 'legendary', 'Dusk Outlaw'),
]
