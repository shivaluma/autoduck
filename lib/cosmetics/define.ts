import { SPRITE_SLOTS, type CosmeticDefinition } from './types'

/** Shared constructor for catalog entries (core catalog and themed sets). */
type Options = Partial<Pick<CosmeticDefinition, 'color' | 'animation' | 'tags' | 'shopEligible' | 'gachaEligible'>>

const ANCHORS: Record<CosmeticDefinition['slot'], CosmeticDefinition['anchor']> = {
  bodyColor: 'body', bodySkin: 'body', face: 'face', head: 'head', neck: 'neck', outfit: 'body',
  back: 'back', pet: 'petRight', aura: 'auraCenter', trail: 'tail', finish: 'auraCenter', nameplate: 'body',
}

export const cosmetic = (
  id: string,
  name: string,
  slot: CosmeticDefinition['slot'],
  rarity: CosmeticDefinition['rarity'],
  collection: string,
  options: Options = {},
): CosmeticDefinition => ({
  id,
  name,
  slot,
  rarity,
  collection,
  anchor: ANCHORS[slot],
  asset: `/cosmetics/v2/${slot}/${id}.svg`,
  previewAsset: `/cosmetics/v2/previews/${id}.svg`,
  shopEligible: true,
  gachaEligible: true,
  tags: [collection.toLowerCase().replace(/[^a-z0-9]+/g, '-'), slot],
  version: 2,
  animation: rarity === 'epic' || rarity === 'legendary' ? 'idle' : undefined,
  spriteAsset: SPRITE_SLOTS.includes(slot) ? `/cosmetics/v2/sprites/${id}.png` : undefined,
  ...options,
})

