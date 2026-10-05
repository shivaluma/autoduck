/**
 * Race FX v2 manifest — shared by the asset generator (scripts/generate-race-fx.ts) and the Phaser
 * race canvas. Every animated entry is hand-drawn SVG (scripts/race-fx/art.ts) baked into a sprite
 * sheet; icons and decor are static SVG.
 */

export interface RaceFxSheet {
  key: string
  frames: number
  fps: number
  /** Square frame size in px (the art is authored in a 256×256 viewBox). */
  size: number
  loop: boolean
}

const sheet = (key: string, frames: number, fps: number, size: number, loop: boolean): RaceFxSheet => ({ key, frames, fps, size, loop })

export const RACE_FX_SHEETS = [
  // World objects (loops)
  sheet('box-quack', 16, 12, 144, true),
  sheet('box-golden', 16, 12, 160, true),
  sheet('box-chaos', 16, 12, 144, true),
  sheet('hazard-anchor', 16, 10, 144, true),
  sheet('hazard-whirlpool', 16, 14, 176, true),
  sheet('hazard-ice', 16, 8, 144, true),
  sheet('hazard-goo', 16, 10, 144, true),
  sheet('rocket', 12, 20, 128, true),
  sheet('banana', 16, 10, 112, true),
  // Duck status overlays (loops)
  sheet('nitro-flame', 12, 20, 160, true),
  sheet('wind-streak', 12, 16, 160, true),
  sheet('shield-bubble', 16, 12, 160, true),
  sheet('dizzy', 16, 14, 112, true),
  sheet('silenced', 12, 10, 96, true),
  sheet('feather-orbit', 16, 12, 160, true),
  sheet('target-lock', 16, 16, 128, true),
  // One-shot effects
  sheet('explosion', 16, 24, 208, false),
  sheet('splash', 14, 24, 176, false),
  sheet('bubble-pop', 12, 24, 176, false),
  sheet('horn-wave', 14, 20, 224, false),
  sheet('sparkle-burst', 12, 24, 160, false),
  sheet('coin-burst', 16, 24, 192, false),
  sheet('feather-puff', 14, 20, 160, false),
  sheet('nitro-ignite', 12, 24, 192, false),
  sheet('slip-stars', 14, 20, 144, false),
  sheet('confetti', 20, 24, 256, false),
] as const satisfies readonly RaceFxSheet[]

export type RaceFxSheetKey = typeof RACE_FX_SHEETS[number]['key']

/** Item icons — one consistent set replacing the old emoji. Wild variants reuse the closest prep icon. */
export const RACE_FX_ICONS = [
  'nitro', 'draft-fin', 'paddle-burst', 'bubble-shield', 'feather', 'shock-absorber',
  'homing-rocket', 'banana', 'quack-horn', 'tailwind', 'magnet',
] as const

export type RaceFxIconKey = typeof RACE_FX_ICONS[number]

export const RACE_FX_DECOR = ['lilypad', 'lotus', 'reeds', 'rock'] as const

export const RACE_FX_COLUMNS = 8

export const raceFxSheetPath = (key: string) => `/race-fx/sheets/${key}.png`
export const raceFxIconPath = (key: string) => `/race-fx/icons/${key}.svg`
export const raceFxDecorPath = (key: string) => `/race-fx/decor/${key}.svg`

export const ITEM_ICON_BY_ID: Record<string, RaceFxIconKey> = {
  NITRO: 'nitro',
  MINI_NITRO: 'nitro',
  DRAFT_FIN: 'draft-fin',
  PADDLE_BURST: 'paddle-burst',
  BUBBLE_SHIELD: 'bubble-shield',
  MINI_BUBBLE: 'bubble-shield',
  FEATHER: 'feather',
  WILD_FEATHER: 'feather',
  SHOCK_ABSORBER: 'shock-absorber',
  HOMING_ROCKET: 'homing-rocket',
  MINI_ROCKET: 'homing-rocket',
  BANANA: 'banana',
  QUACK_HORN: 'quack-horn',
  TAILWIND: 'tailwind',
  SLIPSTREAM_MAGNET: 'magnet',
}
