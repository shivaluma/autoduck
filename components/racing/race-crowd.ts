import type PhaserType from 'phaser'
import { bankPoint, seededRandom } from './race-fx'

/**
 * Bankside crowd: cartoon fans whose faces are the competitors' real avatars, cheering along both banks.
 * Purely visual. Fans idle-sway, put their arms up when the pack passes and jump for joy when their own
 * duck goes by. Avatars that fail to load (no CORS, 404) fall back to an initials face.
 */

export interface CrowdPlayer {
  playerId: string
  name: string
  avatarUrl?: string | null
}

type Track = Parameters<typeof bankPoint>[0] & { length: number }

interface Fan {
  playerId: string
  root: PhaserType.GameObjects.Container
  body: PhaserType.GameObjects.Container
  armLeft: PhaserType.GameObjects.Image
  armRight: PhaserType.GameObjects.Image
  phase: number
  lastConfetti: number
}

const INK = 0x1b132b
const SHIRTS = [0xef4444, 0xf97316, 0xfacc15, 0x22c55e, 0x06b6d4, 0x3b82f6, 0x8b5cf6, 0xec4899, 0xf8fafc, 0x1e293b]
const SKINS = [0xf9d5b5, 0xeab68f, 0xc98b62, 0x8d5a3b]
const FACE_SIZE = 64
/** Fan groups along the track, as a fraction of its length. */
const GROUP_SPACING = 0.055
/** Pixels: pack within this range → arms up; own duck within the closer range → jumping. */
const PACK_RANGE = 520
const OWN_RANGE = 360

const avatarKey = (playerId: string) => `crowd-avatar-${playerId}`
const faceKey = (playerId: string) => `crowd-face-${playerId}`

export function preloadCrowdAvatars(scene: PhaserType.Scene, players: CrowdPlayer[]) {
  for (const player of players) {
    if (!player.avatarUrl || scene.textures.exists(avatarKey(player.playerId))) continue
    // XHR-loaded, so a host without CORS just errors out here (→ initials) instead of tainting WebGL.
    if (/\.svg(\?|$)|\/svg(\?|$)/i.test(player.avatarUrl)) scene.load.svg(avatarKey(player.playerId), player.avatarUrl, { width: FACE_SIZE * 2, height: FACE_SIZE * 2 })
    else scene.load.image(avatarKey(player.playerId), player.avatarUrl)
  }
}

function hashColor(text: string) {
  let hash = 0
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return SHIRTS[hash % SHIRTS.length]!
}

const css = (color: number) => `#${color.toString(16).padStart(6, '0')}`

/** Round face texture: the avatar clipped to a circle with an ink ring, or initials on a colour disc. */
function makeFaceTexture(scene: PhaserType.Scene, player: CrowdPlayer) {
  const key = faceKey(player.playerId)
  if (scene.textures.exists(key)) return key
  const texture = scene.textures.createCanvas(key, FACE_SIZE, FACE_SIZE)
  if (!texture) return key
  const context = texture.getContext()
  const center = FACE_SIZE / 2
  const radius = center - 3
  context.save()
  context.beginPath()
  context.arc(center, center, radius, 0, Math.PI * 2)
  context.clip()
  let drewAvatar = false
  if (scene.textures.exists(avatarKey(player.playerId))) {
    try {
      const source = scene.textures.get(avatarKey(player.playerId)).getSourceImage() as CanvasImageSource & { width: number; height: number }
      const side = Math.min(source.width, source.height)
      context.drawImage(source, (source.width - side) / 2, (source.height - side) / 2, side, side, 0, 0, FACE_SIZE, FACE_SIZE)
      drewAvatar = true
    } catch {
      drewAvatar = false
    }
  }
  if (!drewAvatar) {
    context.fillStyle = css(hashColor(player.name))
    context.fillRect(0, 0, FACE_SIZE, FACE_SIZE)
    const initials = player.name.trim().split(/\s+/).map((word) => word[0] ?? '').join('').slice(0, 2).toUpperCase() || '?'
    context.fillStyle = '#ffffff'
    context.font = `900 ${initials.length > 1 ? 24 : 30}px "Arial Black", Arial, sans-serif`
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(initials, center, center + 2)
  }
  context.restore()
  context.lineWidth = 5
  context.strokeStyle = css(INK)
  context.beginPath()
  context.arc(center, center, radius, 0, Math.PI * 2)
  context.stroke()
  texture.refresh()
  return key
}

function makeBodyTextures(scene: PhaserType.Scene, shirt: number, skin: number) {
  const body = `crowd-body-${shirt.toString(16)}`
  const arm = `crowd-arm-${shirt.toString(16)}-${skin.toString(16)}`
  if (!scene.textures.exists(body)) {
    const g = scene.make.graphics({ x: 0, y: 0 }, false)
    // Legs, then a rounded torso with a collar, all outlined in the shared ink.
    g.fillStyle(INK, 1).fillRoundedRect(11, 30, 8, 16, 3).fillRoundedRect(21, 30, 8, 16, 3)
    g.fillStyle(0x334155, 1).fillRoundedRect(13, 31, 4, 13, 2).fillRoundedRect(23, 31, 4, 13, 2)
    g.fillStyle(INK, 1).fillRoundedRect(5, 4, 30, 32, 11)
    g.fillStyle(shirt, 1).fillRoundedRect(8, 7, 24, 26, 9)
    g.fillStyle(0xffffff, 0.22).fillRoundedRect(11, 9, 7, 16, 4)
    g.generateTexture(body, 40, 48)
    g.destroy()
  }
  if (!scene.textures.exists(arm)) {
    const g = scene.make.graphics({ x: 0, y: 0 }, false)
    g.fillStyle(INK, 1).fillRoundedRect(0, 0, 11, 24, 5)
    g.fillStyle(shirt, 1).fillRoundedRect(2, 2, 7, 11, 3)
    g.fillStyle(skin, 1).fillRoundedRect(2, 13, 7, 9, 3)
    g.generateTexture(arm, 11, 24)
    g.destroy()
  }
  return { body, arm }
}

interface FanSlot { progress: number; lateral: number; side: number; playerIndex: number; shirt: number; skin: number; scale: number; phase: number }

/** Seeded crowd layout, shared by the scenery (to keep decor out of the crowds) and createCrowd. */
export function planCrowd(track: { length: number }, playerCount: number, bankOuter: number, seed: number) {
  const slots: FanSlot[] = []
  const spans: Array<{ side: number; from: number; to: number }> = []
  if (playerCount === 0) return { slots, spans }
  const rand = seededRandom(seed)
  const fanStep = 34 / Math.max(1, track.length)
  for (let progress = 0.03; progress < 0.97; progress += GROUP_SPACING * (0.8 + rand() * 0.4)) {
    for (const side of [-1, 1]) {
      if (rand() < 0.25) continue
      const size = 3 + Math.floor(rand() * 4)
      const start = progress + rand() * 0.01
      spans.push({ side, from: start - fanStep, to: start + size * fanStep })
      for (let slot = 0; slot < size; slot += 1) {
        slots.push({
          progress: start + slot * fanStep,
          lateral: side * (bankOuter + 0.24 + rand() * 0.14 + (slot % 2) * 0.12),
          side,
          playerIndex: Math.floor(rand() * playerCount),
          shirt: SHIRTS[Math.floor(rand() * SHIRTS.length)]!,
          skin: SKINS[Math.floor(rand() * SKINS.length)]!,
          scale: 0.95 + rand() * 0.2,
          phase: rand() * Math.PI * 2,
        })
      }
    }
  }
  return { slots, spans }
}

export function createCrowd(scene: PhaserType.Scene, options: { track: Track; players: CrowdPlayer[]; plan: ReturnType<typeof planCrowd>; reducedMotion: boolean }) {
  const { track, players, plan, reducedMotion } = options
  const fans: Fan[] = []
  const faces = new Map(players.map((player) => [player.playerId, makeFaceTexture(scene, player)]))
  for (const slot of plan.slots) {
    const player = players[slot.playerIndex]
    if (!player) continue
    const point = bankPoint(track, slot.progress, slot.lateral)
    const textures = makeBodyTextures(scene, slot.shirt, slot.skin)
    // Shoulder pivots: the arm hangs from its top edge, so rotation swings it from the shoulder.
    const armLeft = scene.add.image(-12, -14, textures.arm).setOrigin(0.5, 0.12).setRotation(0.35)
    const armRight = scene.add.image(12, -14, textures.arm).setOrigin(0.5, 0.12).setFlipX(true).setRotation(-0.35)
    const torso = scene.add.image(0, 0, textures.body).setOrigin(0.5, 0.62)
    const face = scene.add.image(0, -32, faces.get(player.playerId)!).setDisplaySize(34, 34)
    const body = scene.add.container(0, 0, [armLeft, armRight, torso, face])
    // Lower fans draw over higher ones so rows overlap naturally.
    const root = scene.add.container(point.x, point.y, [body]).setDepth(12 + (point.y + 900) / 100000).setScale(slot.scale)
    fans.push({ playerId: player.playerId, root, body, armLeft, armRight, phase: slot.phase, lastConfetti: -10000 })
  }

  const confetti = reducedMotion ? null : scene.add.particles(0, 0, 'p-dot', {
    lifespan: { min: 600, max: 1000 }, speed: { min: 90, max: 200 }, angle: { min: 220, max: 320 }, gravityY: 320,
    scale: { start: 0.55, end: 0.15 }, alpha: { start: 1, end: 0 }, tint: [0xfde047, 0xf472b6, 0x38bdf8, 0x4ade80, 0xffffff], emitting: false,
  }).setDepth(13)

  return {
    /** Animates fans in view. `ducks` maps playerId → current duck position. */
    update(time: number, camera: PhaserType.Cameras.Scene2D.Camera, ducks: Map<string, { x: number; y: number }>, pack: { x: number; y: number } | null) {
      if (reducedMotion) return
      const view = camera.worldView
      const t = time / 1000
      for (const fan of fans) {
        const { x, y } = fan.root
        if (x < view.x - 80 || x > view.right + 80 || y < view.y - 80 || y > view.bottom + 80) continue
        const own = ducks.get(fan.playerId)
        const ownDistance = own ? Math.hypot(own.x - x, own.y - y) : Infinity
        const packNear = pack ? Math.hypot(pack.x - x, pack.y - y) < PACK_RANGE : false
        if (ownDistance < OWN_RANGE) {
          // Their duck is right here: jump and wave like mad.
          const hop = Math.abs(Math.sin(t * 9 + fan.phase))
          fan.body.y = -hop * 12
          fan.armLeft.rotation = 2.7 + Math.sin(t * 16 + fan.phase) * 0.35
          fan.armRight.rotation = -2.7 - Math.sin(t * 16 + fan.phase + 1) * 0.35
          if (confetti && ownDistance < OWN_RANGE * 0.5 && time - fan.lastConfetti > 3500) {
            fan.lastConfetti = time
            confetti.explode(8, x, y - 40)
          }
        } else if (packNear) {
          // Race passing by: arms up, little bounces.
          fan.body.y = -Math.abs(Math.sin(t * 6 + fan.phase)) * 4
          fan.armLeft.rotation = 2.4 + Math.sin(t * 8 + fan.phase) * 0.25
          fan.armRight.rotation = -2.4 - Math.sin(t * 8 + fan.phase) * 0.25
        } else {
          // Waiting: sway and clap.
          fan.body.y = 0
          fan.body.rotation = Math.sin(t * 1.6 + fan.phase) * 0.05
          const clap = Math.sin(t * 5 + fan.phase) * 0.18
          fan.armLeft.rotation = 0.6 + clap
          fan.armRight.rotation = -0.6 - clap
          continue
        }
        fan.body.rotation = Math.sin(t * 3 + fan.phase) * 0.08
      }
    },
  }
}
