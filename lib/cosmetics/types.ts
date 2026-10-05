export const COSMETIC_SLOTS = [
  'bodyColor', 'bodySkin', 'face', 'head', 'neck', 'outfit',
  'back', 'pet', 'aura', 'trail', 'finish', 'nameplate',
] as const

export const COSMETIC_RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const

export type CosmeticSlot = typeof COSMETIC_SLOTS[number]
export type CosmeticRarity = typeof COSMETIC_RARITIES[number]

export type CosmeticAnchor = 'body' | 'face' | 'head' | 'neck' | 'back' | 'petLeft' | 'petRight' | 'auraCenter' | 'tail'

export type AvatarRenderLayer =
  | 'AURA_BACK'
  | 'TRAIL_BACK'
  | 'PET_BACK'
  | 'BACK_ACCESSORY'
  | 'HEADWEAR_BACK'
  | 'BASE_DUCK'
  | 'SKIN_OVERLAY'
  | 'CLOTHING_BACK'
  | 'CLOTHING_BODY'
  | 'NECK_ACCESSORY'
  | 'FACE_ACCESSORY'
  | 'HEADWEAR'
  | 'FRONT_WING'
  | 'HAND_PROP'
  | 'PET_FRONT'
  | 'AURA_FRONT'
  | 'FRONT_FX'
  | 'NAMEPLATE'

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
  zLayer?: AvatarRenderLayer
  /** Pre-rendered animation frames (see MOTION_SPRITE) for renderers that cannot play SVG animation, e.g. the Phaser race canvas. */
  spriteAsset?: string
  hasBackLayer?: boolean
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

/** v2 render frame (512 rig coordinates padded for headroom) shared by every layer. */
export const AVATAR_FRAME = { x: -24, y: -56, size: 560 } as const

/**
 * Per-slot framing for previews and closet tiles, as a square crop [x, y, size] in rig coordinates.
 * Zooming on the part an item changes makes small tiles read instantly.
 */
export const SLOT_FRAMES: Record<CosmeticSlot, readonly [number, number, number]> = {
  bodyColor: [-24, -56, 560],
  bodySkin: [-24, -56, 560],
  face: [190, 0, 320],
  head: [150, -56, 380],
  outfit: [10, 60, 470],
  pet: [280, 196, 270],
  aura: [-24, -56, 560],
  trail: [-24, 150, 380],
  neck: [120, 140, 340],
  back: [-24, 100, 400],
  finish: [-24, -56, 560],
  nameplate: [-24, 200, 560],
}

/** Layers that render behind the duck body. */
export const BEHIND_BODY_SLOTS: CosmeticSlot[] = ['aura', 'trail']

/** Slots whose SVG animation is baked into a sprite sheet so the race canvas can play it too. */
export const SPRITE_SLOTS: CosmeticSlot[] = ['aura', 'trail']

/**
 * Sprite sheet layout for baked animations: `frames` frames sampled at `fps` (one 2.4s loop),
 * laid out in a grid `columns` wide, each frame a square of the full AVATAR_FRAME.
 */
export const MOTION_SPRITE = { frames: 24, columns: 6, frameSize: 160, fps: 10 } as const
