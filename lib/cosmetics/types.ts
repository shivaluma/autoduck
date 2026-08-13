export const COSMETIC_SLOTS = [
  'bodyColor', 'bodySkin', 'face', 'head', 'neck', 'outfit',
  'back', 'pet', 'aura', 'trail', 'finish', 'nameplate',
] as const

export const COSMETIC_RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const

export type CosmeticSlot = typeof COSMETIC_SLOTS[number]
export type CosmeticRarity = typeof COSMETIC_RARITIES[number]

export type CosmeticAnchor = 'body' | 'face' | 'head' | 'neck' | 'back' | 'petLeft' | 'petRight' | 'auraCenter' | 'tail'

export interface CosmeticDefinition {
  id: string
  name: string
  slot: CosmeticSlot
  rarity: CosmeticRarity
  collection?: string
  asset: string
  previewAsset?: string
  animation?: string
  shopEligible: boolean
  gachaEligible: boolean
  tags: string[]
  version: number
  anchor: CosmeticAnchor
  color?: string
}

export type DuckAppearance = Partial<Record<`${CosmeticSlot}Id`, string>> & {
  bodyColorId: string
}

export const DUCK_COSMETIC_ANCHORS = {
  head: { x: 158, y: 30 },
  face: { x: 176, y: 78 },
  neck: { x: 128, y: 124 },
  body: { x: 124, y: 160 },
  back: { x: 72, y: 143 },
  tail: { x: 42, y: 158 },
  petLeft: { x: 34, y: 178 },
  petRight: { x: 218, y: 178 },
  auraCenter: { x: 128, y: 137 },
} as const

export const COSMETIC_LAYER_ORDER: CosmeticSlot[] = [
  'aura', 'trail', 'bodyColor', 'bodySkin', 'back', 'outfit',
  'neck', 'face', 'head', 'pet', 'nameplate', 'finish',
]
