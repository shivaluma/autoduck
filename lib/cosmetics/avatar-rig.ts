/**
 * Duck Avatar Rig & Canonical Vector Architecture
 * Dzịt Season 3 - 512x512 Normalized Rig System
 */

export const DUCK_VIEWBOX = '0 0 512 512'

export interface DuckPaletteTokens {
  bodyBase: string
  bodyShadow: string
  bodyHighlight: string
  outline: string
  beakBase: string
  beakShadow: string
  beakHighlight: string
  feetBase: string
  feetShadow: string
  eyeWhite: string
  eyePupil: string
  eyeHighlight: string
  blush: string
}

export const CANONICAL_PALETTES: Record<string, DuckPaletteTokens> = {
  'body-sunshine': {
    bodyBase: '#FFD84D',
    bodyShadow: '#E5A812',
    bodyHighlight: '#FFF1A8',
    outline: '#1B132B',
    beakBase: '#FF9B42',
    beakShadow: '#C95E24',
    beakHighlight: '#FFD099',
    feetBase: '#FF9B42',
    feetShadow: '#C95E24',
    eyeWhite: '#FFFDF4',
    eyePupil: '#1B132B',
    eyeHighlight: '#FFFDF4',
    blush: '#FF78A8',
  },
  'body-tangerine': {
    bodyBase: '#FF9B42',
    bodyShadow: '#D96A14',
    bodyHighlight: '#FFC58D',
    outline: '#1B132B',
    beakBase: '#EA580C',
    beakShadow: '#9A3412',
    beakHighlight: '#FDBA74',
    feetBase: '#EA580C',
    feetShadow: '#9A3412',
    eyeWhite: '#FFFDF4',
    eyePupil: '#1B132B',
    eyeHighlight: '#FFFDF4',
    blush: '#FF78A8',
  },
  'body-mint': {
    bodyBase: '#58E6B0',
    bodyShadow: '#2BAF7D',
    bodyHighlight: '#A3F7D5',
    outline: '#1B132B',
    beakBase: '#FF9B42',
    beakShadow: '#C95E24',
    beakHighlight: '#FFD099',
    feetBase: '#FF9B42',
    feetShadow: '#C95E24',
    eyeWhite: '#FFFDF4',
    eyePupil: '#1B132B',
    eyeHighlight: '#FFFDF4',
    blush: '#FF78A8',
  },
  'body-sky': {
    bodyBase: '#61C9FF',
    bodyShadow: '#2596D4',
    bodyHighlight: '#BBE8FF',
    outline: '#1B132B',
    beakBase: '#FF9B42',
    beakShadow: '#C95E24',
    beakHighlight: '#FFD099',
    feetBase: '#FF9B42',
    feetShadow: '#C95E24',
    eyeWhite: '#FFFDF4',
    eyePupil: '#1B132B',
    eyeHighlight: '#FFFDF4',
    blush: '#FF78A8',
  },
  'body-lavender': {
    bodyBase: '#B99AFF',
    bodyShadow: '#825AD9',
    bodyHighlight: '#E4D7FF',
    outline: '#1B132B',
    beakBase: '#FF9B42',
    beakShadow: '#C95E24',
    beakHighlight: '#FFD099',
    feetBase: '#FF9B42',
    feetShadow: '#C95E24',
    eyeWhite: '#FFFDF4',
    eyePupil: '#1B132B',
    eyeHighlight: '#FFFDF4',
    blush: '#FF78A8',
  },
  'body-rose': {
    bodyBase: '#FF78A8',
    bodyShadow: '#D63F76',
    bodyHighlight: '#FFBED6',
    outline: '#1B132B',
    beakBase: '#FF9B42',
    beakShadow: '#C95E24',
    beakHighlight: '#FFD099',
    feetBase: '#FF9B42',
    feetShadow: '#C95E24',
    eyeWhite: '#FFFDF4',
    eyePupil: '#1B132B',
    eyeHighlight: '#FFFDF4',
    blush: '#FF4D88',
  },
  'body-cream': {
    bodyBase: '#FFF0BD',
    bodyShadow: '#D8C27B',
    bodyHighlight: '#FFFFFF',
    outline: '#1B132B',
    beakBase: '#FF9B42',
    beakShadow: '#C95E24',
    beakHighlight: '#FFD099',
    feetBase: '#FF9B42',
    feetShadow: '#C95E24',
    eyeWhite: '#FFFDF4',
    eyePupil: '#1B132B',
    eyeHighlight: '#FFFDF4',
    blush: '#FF78A8',
  },
  'body-midnight': {
    bodyBase: '#475569',
    bodyShadow: '#1E293B',
    bodyHighlight: '#94A3B8',
    outline: '#0B0F19',
    beakBase: '#F59E0B',
    beakShadow: '#B45309',
    beakHighlight: '#FCD34D',
    feetBase: '#F59E0B',
    feetShadow: '#B45309',
    eyeWhite: '#FFFDF4',
    eyePupil: '#0F172A',
    eyeHighlight: '#38BDF8',
    blush: '#C084FC',
  },
  'body-cyber-cyan': {
    bodyBase: '#06B6D4',
    bodyShadow: '#0891B2',
    bodyHighlight: '#67E8F9',
    outline: '#082F49',
    beakBase: '#FF007F',
    beakShadow: '#BE123C',
    beakHighlight: '#FDA4AF',
    feetBase: '#FF007F',
    feetShadow: '#BE123C',
    eyeWhite: '#FFFDF4',
    eyePupil: '#082F49',
    eyeHighlight: '#00F2FE',
    blush: '#F43F5E',
  },
  'body-ruby': {
    bodyBase: '#EF4444',
    bodyShadow: '#B91C1C',
    bodyHighlight: '#FCA5A5',
    outline: '#1B132B',
    beakBase: '#F59E0B',
    beakShadow: '#B45309',
    beakHighlight: '#FCD34D',
    feetBase: '#F59E0B',
    feetShadow: '#B45309',
    eyeWhite: '#FFFDF4',
    eyePupil: '#1B132B',
    eyeHighlight: '#FFFDF4',
    blush: '#F43F5E',
  },
  'body-emerald': {
    bodyBase: '#10B981',
    bodyShadow: '#047857',
    bodyHighlight: '#6EE7B7',
    outline: '#1B132B',
    beakBase: '#FF9B42',
    beakShadow: '#C95E24',
    beakHighlight: '#FFD099',
    feetBase: '#FF9B42',
    feetShadow: '#C95E24',
    eyeWhite: '#FFFDF4',
    eyePupil: '#1B132B',
    eyeHighlight: '#FFFDF4',
    blush: '#FF78A8',
  },
}

export function getDuckPalette(colorIdOrHex = 'body-sunshine'): DuckPaletteTokens {
  if (CANONICAL_PALETTES[colorIdOrHex]) return CANONICAL_PALETTES[colorIdOrHex]
  
  // Custom hex color fallback
  const base = colorIdOrHex.startsWith('#') ? colorIdOrHex : '#FFD84D'
  return {
    bodyBase: base,
    bodyShadow: '#C29312',
    bodyHighlight: '#FFF7C2',
    outline: '#1B132B',
    beakBase: '#FF9B42',
    beakShadow: '#C95E24',
    beakHighlight: '#FFD099',
    feetBase: '#FF9B42',
    feetShadow: '#C95E24',
    eyeWhite: '#FFFDF4',
    eyePupil: '#1B132B',
    eyeHighlight: '#FFFDF4',
    blush: '#FF78A8',
  }
}

/**
 * Semantic Avatar Rig Anchors in 512x512 Space
 */
export const DUCK_RIG_ANCHORS = {
  HEAD_TOP: { x: 330, y: 44 },
  HEAD_CENTER: { x: 336, y: 144 },
  EYE_LEFT: { x: 320, y: 138 },
  EYE_RIGHT: { x: 382, y: 144 },
  EYE_CENTER: { x: 352, y: 140 },
  FACE_CENTER: { x: 352, y: 160 },
  BEAK_ROOT: { x: 354, y: 186 },
  BEAK_CENTER: { x: 386, y: 206 },
  BEAK_TIP: { x: 464, y: 214 },
  NECK: { x: 256, y: 248 },
  CHEST_FRONT: { x: 320, y: 310 },
  TORSO_CENTER: { x: 248, y: 328 },
  BACK_CENTER: { x: 144, y: 286 },
  TAIL_TIP: { x: 84, y: 322 },
  WING_FRONT: { x: 170, y: 320 },
  FEET_LEFT: { x: 178, y: 402 },
  FEET_RIGHT: { x: 238, y: 402 },
  FEET_CENTER: { x: 248, y: 412 },
  GROUND: { x: 256, y: 436 },
  PET_LEFT: { x: 68, y: 370 },
  PET_RIGHT: { x: 436, y: 370 },
  AURA_CENTER: { x: 256, y: 274 },
} as const

/**
 * Generates the canonical base duck SVG body in 512x512 space
 */
export function generateBaseDuckSvg(palette: DuckPaletteTokens): string {
  return `<!-- Base Duck Body -->
  <!-- Feet -->
  <path d="M178 402 c2 18 -8 30 -30 40 c24 6 48 0 64 -18" fill="none" stroke="${palette.feetBase}" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M178 402 c2 18 -8 30 -30 40 c24 6 48 0 64 -18" fill="none" stroke="${palette.outline}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" opacity="0.3"/>
  <path d="M238 386 c2 18 -8 30 -30 40 c24 4 46 0 62 -16" fill="none" stroke="${palette.feetBase}" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M238 386 c2 18 -8 30 -30 40 c24 4 46 0 62 -16" fill="none" stroke="${palette.outline}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" opacity="0.3"/>

  <!-- Tail Feathers -->
  <path d="M94 322 c-18 -16 -30 -36 -34 -58 c28 8 52 20 70 34" fill="${palette.bodyBase}" stroke="${palette.outline}" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>

  <!-- Main Torso Body -->
  <path d="M80 328 c0 -72 70 -114 164 -110 c92 2 156 44 166 102 c14 68 -52 102 -166 98 c-108 -2 -164 -34 -164 -90 Z" fill="${palette.bodyBase}" stroke="${palette.outline}" stroke-width="14" stroke-linejoin="round"/>
  
  <!-- Torso Shadow Form -->
  <path d="M84 340 c10 42 60 72 150 72 c74 0 134 -20 162 -54 c-22 56 -86 82 -168 80 c-94 -2 -144 -36 -144 -98 Z" fill="${palette.bodyShadow}" opacity="0.55"/>

  <!-- Head & Neck -->
  <path d="M212 216 c-10 -62 14 -126 66 -158 c54 -34 118 -16 150 30 c36 50 20 118 -20 156 c-44 44 -118 54 -166 18 c-16 -12 -26 -28 -30 -46 Z" fill="${palette.bodyBase}" stroke="${palette.outline}" stroke-width="14" stroke-linejoin="round"/>

  <!-- Head Highlight & Shadow Form -->
  <path d="M296 74 c34 -20 72 -14 96 14 c16 18 18 42 8 66 c-4 -28 -24 -56 -62 -66 c-18 -4 -32 -2 -42 -14 Z" fill="${palette.bodyHighlight}" opacity="0.75"/>
  <path d="M216 220 c6 14 18 24 34 32 c-16 -8 -26 -18 -34 -32 Z" fill="${palette.bodyShadow}" opacity="0.6"/>

  <!-- Wing Silhouette & Highlight -->
  <path d="M136 316 c32 -40 90 -50 138 -24 c-14 50 -76 78 -132 58" fill="${palette.bodyHighlight}" opacity="0.4"/>
  <path d="M136 316 c32 -40 90 -50 138 -24 c-14 50 -76 78 -132 58" fill="none" stroke="${palette.outline}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>

  <!-- Cheeks / Blush -->
  <circle cx="270" cy="190" r="14" fill="${palette.blush}" opacity="0.4"/>

  <!-- Left Eye -->
  <ellipse cx="320" cy="138" rx="42" ry="50" fill="${palette.eyeWhite}" stroke="${palette.outline}" stroke-width="12"/>
  <ellipse cx="330" cy="152" rx="11" ry="18" fill="${palette.eyePupil}"/>
  <circle cx="326" cy="144" r="5" fill="${palette.eyeHighlight}"/>

  <!-- Right Eye -->
  <ellipse cx="382" cy="144" rx="32" ry="42" fill="${palette.eyeWhite}" stroke="${palette.outline}" stroke-width="12"/>
  <ellipse cx="390" cy="156" rx="9" ry="16" fill="${palette.eyePupil}"/>
  <circle cx="388" cy="150" r="4" fill="${palette.eyeHighlight}"/>

  <!-- Orange Beak -->
  <path d="M354 186 c34 -2 68 8 110 22 c18 6 18 22 0 32 c-40 20 -84 24 -118 10 c-20 -8 -24 -28 -10 -46 c6 -8 12 -14 18 -18 Z" fill="${palette.beakBase}" stroke="${palette.outline}" stroke-width="14" stroke-linejoin="round"/>
  <!-- Beak Top Highlight -->
  <path d="M362 192 c28 0 54 8 84 18" stroke="${palette.beakHighlight}" stroke-width="8" stroke-linecap="round" fill="none"/>
  <!-- Beak Smile Crease & Shadow -->
  <path d="M342 230 c38 10 78 6 120 -10" stroke="${palette.beakShadow}" stroke-width="8" stroke-linecap="round" fill="none"/>`
}
