import type PhaserType from 'phaser'
import {
  RACE_FX_DECOR, RACE_FX_ICONS, RACE_FX_SHEETS, raceFxDecorPath, raceFxIconPath, raceFxSheetPath,
  type RaceFxIconKey, type RaceFxSheetKey,
} from '@/lib/race-fx/manifest'

/** Phaser glue for the race FX v2 asset set (see lib/race-fx/manifest.ts). */

export const fxKey = (key: RaceFxSheetKey) => `fx-${key}`
export const iconKey = (key: RaceFxIconKey) => `icon-${key}`
export const decorKey = (key: typeof RACE_FX_DECOR[number]) => `decor-${key}`

const SHEET_BY_KEY = new Map<string, typeof RACE_FX_SHEETS[number]>(RACE_FX_SHEETS.map((sheet) => [sheet.key, sheet]))

export function preloadRaceFx(scene: PhaserType.Scene) {
  for (const sheet of RACE_FX_SHEETS) {
    scene.load.spritesheet(fxKey(sheet.key), raceFxSheetPath(sheet.key), { frameWidth: sheet.size, frameHeight: sheet.size })
  }
  for (const icon of RACE_FX_ICONS) scene.load.svg(iconKey(icon), raceFxIconPath(icon), { width: 96, height: 96 })
  for (const decor of RACE_FX_DECOR) scene.load.svg(decorKey(decor), raceFxDecorPath(decor), { width: 128, height: 128 })
}

export function createRaceFxAnims(scene: PhaserType.Scene) {
  for (const sheet of RACE_FX_SHEETS) {
    const key = fxKey(sheet.key)
    if (scene.anims.exists(key) || !scene.textures.exists(key)) continue
    scene.anims.create({ key, frames: scene.anims.generateFrameNumbers(key), frameRate: sheet.fps, repeat: sheet.loop ? -1 : 0 })
  }
}

/** Small runtime textures for particle emitters (no download needed). */
export function createParticleTextures(scene: PhaserType.Scene) {
  const make = (key: string, size: number, draw: (g: PhaserType.GameObjects.Graphics) => void) => {
    if (scene.textures.exists(key)) return
    const g = scene.make.graphics({ x: 0, y: 0 }, false)
    draw(g)
    g.generateTexture(key, size, size)
    g.destroy()
  }
  make('p-foam', 24, (g) => { g.fillStyle(0xffffff, 0.45).fillCircle(12, 12, 12); g.fillStyle(0xffffff, 1).fillCircle(12, 12, 7) })
  make('p-dot', 12, (g) => { g.fillStyle(0xffffff, 1).fillCircle(6, 6, 6) })
  make('p-smoke', 40, (g) => { g.fillStyle(0xe2e8f0, 0.35).fillCircle(20, 20, 20); g.fillStyle(0xf8fafc, 0.6).fillCircle(20, 20, 12) })
  make('p-spark', 20, (g) => {
    g.fillStyle(0xffffff, 1).beginPath()
    g.moveTo(10, 0).lineTo(13, 7).lineTo(20, 10).lineTo(13, 13).lineTo(10, 20).lineTo(7, 13).lineTo(0, 10).lineTo(7, 7).closePath().fillPath()
  })
  make('p-streak', 32, (g) => { g.fillStyle(0xffffff, 0.9).fillRoundedRect(0, 14, 32, 4, 2) })
}

export interface FxOptions {
  size: number
  depth?: number
  tint?: number
  angle?: number
  alpha?: number
}

/** Event effects are authored for a close camera; the race camera frames the whole pack, so scale them up. */
const FX_SCALE = 1.25

/** Plays a one-shot FX sheet at a world position and cleans it up when it finishes. */
export function playFx(scene: PhaserType.Scene, key: RaceFxSheetKey, x: number, y: number, options: FxOptions) {
  const textureKey = fxKey(key)
  if (!scene.textures.exists(textureKey)) return null
  const size = options.size * FX_SCALE
  const sprite = scene.add.sprite(x, y, textureKey).setDisplaySize(size, size).setDepth(options.depth ?? 930)
  if (options.tint !== undefined) sprite.setTint(options.tint)
  if (options.angle !== undefined) sprite.setAngle(options.angle)
  if (options.alpha !== undefined) sprite.setAlpha(options.alpha)
  sprite.play(textureKey)
  if (!SHEET_BY_KEY.get(key)?.loop) sprite.once('animationcomplete', () => sprite.destroy())
  return sprite
}

/** Looping overlay sprite (status effects, world objects). */
export function loopSprite(scene: PhaserType.Scene, key: RaceFxSheetKey, x: number, y: number, size: number, startFrame = 0) {
  const textureKey = fxKey(key)
  const sprite = scene.add.sprite(x, y, textureKey).setDisplaySize(size, size)
  if (scene.textures.exists(textureKey) && scene.anims.exists(textureKey)) {
    const frames = SHEET_BY_KEY.get(key)?.frames ?? 1
    sprite.play({ key: textureKey, startFrame: startFrame % frames })
  }
  return sprite
}

const CALLOUT_COLORS = {
  fire: { fill: '#FFE08A', stroke: '#7F1D1D' },
  ice: { fill: '#E0F2FE', stroke: '#0C4A6E' },
  nitro: { fill: '#BAE6FD', stroke: '#1E3A8A' },
  gold: { fill: '#FDE047', stroke: '#713F12' },
  pink: { fill: '#FBCFE8', stroke: '#831843' },
  green: { fill: '#BBF7D0', stroke: '#14532D' },
  gray: { fill: '#E2E8F0', stroke: '#1E293B' },
} as const

export type CalloutTone = keyof typeof CALLOUT_COLORS

/** Punchy comic callout ("BOOM!", "NITRO!") that pops, holds and floats away. */
export function callout(scene: PhaserType.Scene, x: number, y: number, label: string, tone: CalloutTone, reducedMotion: boolean, size = 26) {
  const colors = CALLOUT_COLORS[tone]
  const text = scene.add.text(x, y, label, {
    fontFamily: '"Arial Black", "Arial", sans-serif', fontSize: `${Math.round(size * 1.15)}px`, fontStyle: 'bold italic',
    color: colors.fill, stroke: colors.stroke, strokeThickness: 7,
    shadow: { offsetX: 0, offsetY: 3, color: '#100b20', blur: 0, fill: true, stroke: true },
  }).setOrigin(0.5).setDepth(990).setAngle(-6)
  if (reducedMotion) {
    scene.tweens.add({ targets: text, alpha: 0, delay: 500, duration: 200, onComplete: () => text.destroy() })
    return
  }
  text.setScale(0.3)
  scene.tweens.add({
    targets: text, scale: 1.15, duration: 150, ease: 'Back.Out',
    onComplete: () => scene.tweens.add({
      targets: text, scale: 1, duration: 90,
      onComplete: () => scene.tweens.add({ targets: text, y: y - 34, alpha: 0, delay: 420, duration: 360, ease: 'Quad.In', onComplete: () => text.destroy() }),
    }),
  })
}

/** Point offset from the track centreline by `lateral` river half-widths — unlike track.sample, not clamped to the banks. */
export function bankPoint(track: { sample(progress: number, lateralOffset: number): { x: number; y: number; tangentX: number; tangentY: number; width: number } }, progress: number, lateral: number) {
  const center = track.sample(progress, 0)
  const offset = lateral * center.width * 0.42
  return { x: center.x - center.tangentY * offset, y: center.y + center.tangentX * offset, angle: Math.atan2(center.tangentY, center.tangentX) }
}

/** Deterministic pseudo-random so scenery is identical for every viewer and replay. */
export function seededRandom(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}
