import { cosmetic } from '../define'
import type { CosmeticDefinition } from '../types'

/** Catalog entries for the neon-protocol collection (art in scripts/cosmetics/art/sets/neon-protocol.ts). */
export const NEON_PROTOCOL_ITEMS: CosmeticDefinition[] = [
  cosmetic('body-protocol-crimson-chrome', 'Crimson Chrome', 'bodyColor', 'rare', 'Neon Protocol', { color: '#B91C2C' }),
  cosmetic('face-protocol-scanline-visor', 'Scanline Visor', 'face', 'rare', 'Neon Protocol'),
  cosmetic('trail-protocol-data-stream', 'Data Stream', 'trail', 'rare', 'Neon Protocol'),
  cosmetic('head-protocol-hunter-helm', 'Hunter Helm', 'head', 'epic', 'Neon Protocol'),
  cosmetic('pet-protocol-sentry-drone', 'Sentry Drone', 'pet', 'epic', 'Neon Protocol'),
  cosmetic('aura-protocol-red-alert', 'Red Alert Grid', 'aura', 'epic', 'Neon Protocol'),
  cosmetic('outfit-protocol-overdrive-frame', 'Overdrive Frame', 'outfit', 'legendary', 'Neon Protocol'),
]
