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
  head: { x: 132, y: 62 },
  face: { x: 154, y: 101 },
  neck: { x: 123, y: 125 },
  body: { x: 124, y: 151 },
  back: { x: 83, y: 127 },
  tail: { x: 55, y: 144 },
  petLeft: { x: 34, y: 178 },
  petRight: { x: 218, y: 178 },
  auraCenter: { x: 128, y: 137 },
} as const

export const COSMETIC_LAYER_ORDER: CosmeticSlot[] = [
  'aura', 'trail', 'bodyColor', 'bodySkin', 'back', 'outfit',
  'neck', 'face', 'head', 'pet', 'nameplate', 'finish',
]
