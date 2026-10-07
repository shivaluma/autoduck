'use client'

import { useEffect, useId, useRef } from 'react'
import { intentCopy } from '@/lib/racing/ai-intent-copy'
import type PhaserType from 'phaser'
import { createSimulation, itemActivationForEvent, queueWildItemInput, snapshotRaceWorld, stepSimulation } from '@/packages/race-core/src'
import { createRiverTrack } from '@/packages/race-core/src/track'
import { type DuckSnapshot, type RaceConfig, type RaceEvent, type RaceItemId, type RecordedWildItemInput, type StateSnapshotMessage, type WildItemId } from '@/packages/race-protocol/src'
import { RaceAudioSystem } from './race-audio'
import { COSMETIC_BY_ID, STARTER_COSMETIC_IDS } from '@/lib/cosmetics/catalog'
import { AVATAR_FRAME, COSMETIC_LAYER_ORDER, MOTION_SPRITE, type DuckAppearance } from '@/lib/cosmetics/types'
import { ITEM_ICON_BY_ID } from '@/lib/race-fx/manifest'
import { RACE_THEMES, pickRaceTheme, pickWeighted, type RaceThemeId } from '@/lib/race-fx/themes'
import { bankPoint, callout, createParticleTextures, createRaceFxAnims, decorKey, iconKey, loopSprite, playFx, preloadRaceFx, seededRandom, type CalloutTone } from './race-fx'

// Short comic shouts over a duck when its brain commits to a dramatic plan.
const INTENT_SHOUTS: Record<string, { label: string; tone: CalloutTone }> = {
  RETALIATING: { label: 'PAYBACK!', tone: 'fire' },
  HUNTING: { label: 'GET THE LEADER!', tone: 'fire' },
  RIVALRY: { label: 'RIVAL!', tone: 'pink' },
  BOUNTY: { label: 'BOUNTY!', tone: 'gold' },
  TEAM_PLAY: { label: 'FOR THE TEAM!', tone: 'ice' },
  DESPERATE: { label: 'ALL IN!', tone: 'fire' },
  CLUTCH: { label: 'CLUTCH!', tone: 'gold' },
  HOLDING: { label: '…WAIT FOR IT', tone: 'gray' },
  SHOVE: { label: 'INTO THE TRAP!', tone: 'gold' },
  TRAP_SET: { label: 'GOTCHA!', tone: 'gold' },
}

export type PlayerLabel = {
  playerId: string
  name: string
  avatarUrl?: string | null
  appearance?: DuckAppearance | null
  itemIds?: RaceItemId[]
  isGhost?: boolean
}

const EFFECT_ICONS: Record<string, string> = {
  BUBBLE_SHIELD: '🫧',
  FEATHER: '🪶',
  SHOCK_ABSORBER: '🦺',
  NITRO: '⚡',
  DRAFT_FIN: '🦈',
  PADDLE_BURST: '🛶',
  SLOWED: '💫',
}

const WILD_ICONS: Record<WildItemId, string> = {
  MINI_NITRO: '⚡',
  TAILWIND: '🌊',
  MINI_BUBBLE: '🫧',
  MINI_ROCKET: '🚀',
  BANANA: '🍌',
  QUACK_HORN: '🔊',
  FEATHER: '🪽',
  SLIPSTREAM_MAGNET: '🧲',
}

const PICKUP_FX = {
  QUACK_BOX: { key: 'box-quack', size: 82 },
  GOLDEN_BOX: { key: 'box-golden', size: 104 },
  CHAOS_BOX: { key: 'box-chaos', size: 84 },
} as const

const HAZARD_FX = {
  ANCHOR: { key: 'hazard-anchor', size: 96 },
  WHIRLPOOL: { key: 'hazard-whirlpool', size: 128 },
  ICE_PATCH: { key: 'hazard-ice', size: 96 },
  STICKY_GOO: { key: 'hazard-goo', size: 100 },
} as const

/** Rank badge colours: gold, silver, bronze, then a neutral pill. */
const RANK_COLORS = [
  { fill: 0xfacc15, text: '#100b20' },
  { fill: 0xe2e8f0, text: '#100b20' },
  { fill: 0xf59e0b, text: '#100b20' },
  { fill: 0x312e81, text: '#ffffff' },
] as const

/** How much longer the trail is drawn in races than in the closet (horizontal stretch from the tail). */
const TRAIL_STRETCH = 1.6

const WAKE_IDLE_MS = 80
const WAKE_BOOST_MS = 18

const DUCK_THEME_PRESETS: DuckAppearance[] = [
  { bodyColorId: 'body-sunshine', headId: 'head-tiny-crown', faceId: 'face-happy', outfitId: 'outfit-quack-knight', petId: 'pet-shiba-inu', auraId: 'aura-golden-rays', trailId: 'trail-golden-water' },
  { bodyColorId: 'body-mint', headId: 'head-bamboo-hat', faceId: 'face-happy', outfitId: 'outfit-lucky-ao-dai', bodySkinId: 'bodySkin-koi-patches', petId: 'pet-golden-carp', auraId: 'aura-lotus-breeze', trailId: 'trail-lotus-petals' },
  { bodyColorId: 'body-chrome', headId: 'head-cyber-mohawk', faceId: 'face-laser-visor', outfitId: 'outfit-cyber-samurai', bodySkinId: 'bodySkin-circuit-feathers', petId: 'pet-tiny-drone', auraId: 'aura-neon-glitch', trailId: 'trail-neon-wake' },
  { bodyColorId: 'body-coral', headId: 'head-dragon-horns', faceId: 'face-angry-brows', outfitId: 'outfit-racing-suit', bodySkinId: 'bodySkin-dragon-scale', petId: 'pet-baby-dragon', auraId: 'aura-storm-cloud', trailId: 'trail-dragon-sparks' },
  { bodyColorId: 'body-midnight', headId: 'head-space-dome', faceId: 'face-cosmic-eyes', outfitId: 'outfit-space-suit', bodySkinId: 'bodySkin-star-constellations', petId: 'pet-moon-rabbit', auraId: 'aura-fireflies', trailId: 'trail-bubble-wake' },
  { bodyColorId: 'body-sky', headId: 'head-office-headset', faceId: 'face-monday-face', outfitId: 'outfit-office-tie', bodySkinId: 'bodySkin-band-aid-hero', petId: 'pet-office-mouse', auraId: 'aura-coffee-steam', trailId: 'trail-coffee-spill' },
  { bodyColorId: 'body-tangerine', headId: 'head-cap-red', faceId: 'face-shades', outfitId: 'outfit-tee-white', bodySkinId: 'bodySkin-tiger-quack', petId: 'pet-calico-cat', auraId: 'aura-lucky-leaves', trailId: 'trail-ripples' },
  { bodyColorId: 'body-lavender', headId: 'head-wizard-hat', faceId: 'face-monocle', outfitId: 'outfit-wizard-robe', bodySkinId: 'bodySkin-galaxy-dust', petId: 'pet-mini-capybara', auraId: 'aura-ghost-fog', trailId: 'trail-pixel-stream' },
]

const IS_DEFAULT_UNIFORM = (app?: DuckAppearance | null) => {
  if (!app) return true
  const isSunshine = !app.bodyColorId || app.bodyColorId === 'body-sunshine'
  const isRedCap = app.headId === 'head-cap-red'
  const isWhiteTee = app.outfitId === 'outfit-tee-white'
  return isSunshine && isRedCap && isWhiteTee && !app.auraId && !app.petId && !app.backId && !app.neckId
}

function resolveDuckAppearance(player: PlayerLabel, index: number): DuckAppearance {
  if (player.appearance && !IS_DEFAULT_UNIFORM(player.appearance)) {
    return {
      bodyColorId: player.appearance.bodyColorId || DUCK_THEME_PRESETS[index % DUCK_THEME_PRESETS.length]!.bodyColorId,
      outfitId: player.appearance.outfitId,
      headId: player.appearance.headId,
      faceId: player.appearance.faceId,
      neckId: player.appearance.neckId,
      backId: player.appearance.backId,
      bodySkinId: player.appearance.bodySkinId,
      petId: player.appearance.petId,
      auraId: player.appearance.auraId,
      trailId: player.appearance.trailId,
      finishId: player.appearance.finishId,
      nameplateId: player.appearance.nameplateId,
    }
  }
  return DUCK_THEME_PRESETS[index % DUCK_THEME_PRESETS.length]!
}

export interface ReplayInspection {
  tick: number
  finished: boolean
  ducks: DuckSnapshot[]
  newEvents: RaceEvent[]
}

export function PhaserRaceCanvas({
  raceId,
  players,
  replayConfig,
  liveConfig,
  liveSyncTick,
  liveManualInputs = [],
  replaySpeed = 1,
  replayPaused = false,
  replayManualInputs = [],
  onReplayInspect,
  onLiveFinished,
  chaosType,
  debugPickups = false,
  theme,
}: {
  raceId: number
  players: PlayerLabel[]
  replayConfig?: RaceConfig | null
  liveConfig?: RaceConfig | null
  liveSyncTick?: number
  liveManualInputs?: RecordedWildItemInput[]
  replaySpeed?: 1 | 2 | 4
  replayPaused?: boolean
  replayManualInputs?: RecordedWildItemInput[]
  onReplayInspect?: (inspection: ReplayInspection) => void
  onLiveFinished?: () => void
  chaosType?: string
  debugPickups?: boolean
  /** Forces a canvas theme; by default each race gets a random one seeded by its id. */
  theme?: RaceThemeId
}) {
  const parentId = `duck-race-${useId().replace(/:/g, '')}`
  const serializedPlayers = JSON.stringify(players)
  const serializedManualInputs = JSON.stringify(replayManualInputs)
  const serializedLiveConfig = JSON.stringify(liveConfig ?? null)
  const serializedReplayConfig = JSON.stringify(replayConfig ?? null)
  const initialLiveRef = useRef<{ syncTick: number; manualInputs: RecordedWildItemInput[] } | null>(null)
  if (!initialLiveRef.current && liveConfig) {
    initialLiveRef.current = { syncTick: liveSyncTick ?? 0, manualInputs: liveManualInputs }
  }
  const playbackRef = useRef({ speed: replaySpeed, paused: replayPaused })
  const inspectRef = useRef(onReplayInspect)
  const onLiveFinishedRef = useRef(onLiveFinished)

  useEffect(() => {
    playbackRef.current = { speed: replaySpeed, paused: replayPaused }
  }, [replayPaused, replaySpeed])

  useEffect(() => {
    inspectRef.current = onReplayInspect
  }, [onReplayInspect])

  useEffect(() => {
    onLiveFinishedRef.current = onLiveFinished
  }, [onLiveFinished])

  useEffect(() => {
    let active = true
    let game: PhaserType.Game | null = null
    let source: EventSource | null = null
    let replayFrame = 0
    const audio = new RaceAudioSystem()

    void import('phaser').then((module) => {
      if (!active) return
      const Phaser = module.default ?? module
      const parsedLiveConfig = serializedLiveConfig !== 'null' ? JSON.parse(serializedLiveConfig) as RaceConfig : null
      const parsedReplayConfig = serializedReplayConfig !== 'null' ? JSON.parse(serializedReplayConfig) as RaceConfig : null
      const clientSimConfig = parsedReplayConfig ?? parsedLiveConfig
      const track = createRiverTrack(clientSimConfig?.trackVersion ?? parsedReplayConfig?.trackVersion)
      const scenePlayers = JSON.parse(serializedPlayers) as PlayerLabel[]
      const reducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const mobileViewport = typeof window !== 'undefined' && window.innerWidth < 640
      const raceTheme = theme ? RACE_THEMES[theme] : pickRaceTheme(raceId)
      const themeBackground = `#${raceTheme.background.toString(16).padStart(6, '0')}`
      let markSceneReady: () => void = () => {}
      const sceneReady = new Promise<void>((resolve) => { markSceneReady = resolve })

      class DuckRaceScene extends Phaser.Scene {
        private duckViews = new Map<string, {
          root: PhaserType.GameObjects.Container
          avatarNode: PhaserType.GameObjects.Container
          shieldBubble: PhaserType.GameObjects.Sprite
          nitroFlame: PhaserType.GameObjects.Sprite
          windStreak: PhaserType.GameObjects.Sprite
          dizzyStars: PhaserType.GameObjects.Sprite
          silenced: PhaserType.GameObjects.Sprite
          featherOrbit: PhaserType.GameObjects.Sprite
          targetLock: PhaserType.GameObjects.Sprite
          rankBg: PhaserType.GameObjects.Arc
          rankLabel: PhaserType.GameObjects.Text
          wildBadge: PhaserType.GameObjects.Container
          wildIcon: PhaserType.GameObjects.Image
          wake: PhaserType.GameObjects.Particles.ParticleEmitter | null
          boosting: boolean
          spinning: boolean
          lastX: number
          lastY: number
          targetX: number
          targetY: number
          loadoutIcons: Map<RaceItemId, PhaserType.GameObjects.Container>
        }>()
        private leaderboard!: PhaserType.GameObjects.Text
        private eventFeed!: PhaserType.GameObjects.Text
        private recentEvents: string[] = []
        private pickupViews = new Map<string, PhaserType.GameObjects.Sprite>()
        private hazardViews = new Map<string, PhaserType.GameObjects.Sprite>()
        private rocketViews = new Map<number, { sprite: PhaserType.GameObjects.Sprite; smoke: PhaserType.GameObjects.Particles.ParticleEmitter | null }>()
        private bananaViews = new Map<number, PhaserType.GameObjects.Sprite>()
        private focusPlayerId: string | null = null
        private focusUntil = 0
        private pendingWorld: Pick<StateSnapshotMessage, 'ducks' | 'pickups' | 'hazards' | 'rockets' | 'bananas'> | null = null
        private lastAppliedSnapshotTick = -1

        queueWorld(world: Pick<StateSnapshotMessage, 'ducks' | 'pickups' | 'hazards' | 'rockets' | 'bananas'>, tick: number) {
          if (tick <= this.lastAppliedSnapshotTick) return
          this.lastAppliedSnapshotTick = tick
          this.pendingWorld = world
        }

        constructor() { super('duck-race') }

        preload() {
          this.load.on('loaderror', (file: { key?: string; src?: string }) => {
            console.warn('Phaser asset load error:', file?.key, file?.src)
          })

          preloadRaceFx(this)

          const cosmeticsToLoad = new Set<string>()

          for (const id of STARTER_COSMETIC_IDS) {
            cosmeticsToLoad.add(id)
          }

          for (const preset of DUCK_THEME_PRESETS) {
            for (const slot of COSMETIC_LAYER_ORDER) {
              const id = preset[`${slot}Id` as keyof DuckAppearance]
              if (id) cosmeticsToLoad.add(id)
            }
          }

          for (const [index, player] of scenePlayers.entries()) {
            const app = resolveDuckAppearance(player, index)
            for (const slot of COSMETIC_LAYER_ORDER) {
              const id = app[`${slot}Id` as keyof DuckAppearance]
              if (id) cosmeticsToLoad.add(id)
            }
          }

          for (const cosmeticId of cosmeticsToLoad) {
            const item = COSMETIC_BY_ID.get(cosmeticId)
            if (item && !this.textures.exists(`cosmetic-${item.id}`)) {
              this.load.svg(`cosmetic-${item.id}`, item.asset, { width: AVATAR_FRAME.size, height: AVATAR_FRAME.size })
            }
            // Auras and trails animate: their SVG motion is baked into a sprite sheet (Phaser can't play SMIL).
            if (item?.spriteAsset && !reducedMotion && !this.textures.exists(`cosmetic-anim-${item.id}`)) {
              this.load.spritesheet(`cosmetic-anim-${item.id}`, item.spriteAsset, { frameWidth: MOTION_SPRITE.frameSize, frameHeight: MOTION_SPRITE.frameSize })
            }
          }
        }

        create() {
          this.cameras.main.setBackgroundColor(themeBackground)
          this.cameras.main.setBounds(-250, -850, track.length + 500, 1700)
          createParticleTextures(this)
          createRaceFxAnims(this)
          this.createBurstEmitters()
          this.drawRiver()
          this.drawBoostGates()
          this.drawAtmosphere()
          if (debugPickups) this.drawPickupDebug()
          scenePlayers.forEach((player, index) => this.createDuck(player, index))
          const chaosLabel = chaosType ?? clientSimConfig?.chaosConfig?.type
          this.add.text(18, 16, `${replayConfig ? '↻ REPLAY' : clientSimConfig ? '● LIVE' : '● LIVE'} · ${raceTheme.emoji} ${raceTheme.name.toUpperCase()}${chaosLabel ? ` · 🎴 ${chaosLabel.replaceAll('_', ' ')}` : ''}`, {
            color: replayConfig ? '#ffcc00' : '#3dff8f', fontFamily: 'sans-serif', fontSize: '18px', fontStyle: 'bold',
            backgroundColor: '#100b20cc', padding: { x: 12, y: 8 },
          }).setScrollFactor(0).setDepth(1000)
          this.leaderboard = this.add.text(this.scale.width - 22, 18, '', {
            color: '#ffffff', fontFamily: 'monospace', fontSize: '16px', fontStyle: 'bold', lineSpacing: 6,
            backgroundColor: '#100b20d9', padding: { x: 14, y: 12 }, stroke: '#100b20', strokeThickness: 2,
          }).setOrigin(1, 0).setScrollFactor(0).setDepth(1000)
          this.eventFeed = this.add.text(18, this.scale.height - 18, '', {
            color: '#ffffff', fontFamily: 'sans-serif', fontSize: '17px', fontStyle: 'bold', lineSpacing: 7,
            backgroundColor: '#100b20d9', padding: { x: 14, y: 11 }, stroke: '#100b20', strokeThickness: 3,
          }).setOrigin(0, 1).setScrollFactor(0).setDepth(1000)
          const soundHint = this.add.text(this.scale.width / 2, 18, '🔈 TAP FOR SOUND', { color: '#ffffff', fontFamily: 'sans-serif', fontSize: '13px', fontStyle: 'bold', backgroundColor: '#100b20cc', padding: { x: 10, y: 7 } }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(1000)
          this.input.once('pointerdown', () => { void audio.unlock(); soundHint.destroy() })
          if (!clientSimConfig) this.showCountdown()
          markSceneReady()
        }

        private drawRiver() {
          const sample = (p: number, lateral: number) => bankPoint(track, p, lateral)
          const STEPS = 220
          const band = (inner: number, outer: number, color: number, alpha = 1) => {
            const g = this.add.graphics().setDepth(2)
            g.fillStyle(color, alpha).beginPath()
            for (let i = 0; i <= STEPS; i += 1) { const p = sample(i / STEPS, outer); if (i === 0) g.moveTo(p.x, p.y); else g.lineTo(p.x, p.y) }
            for (let i = STEPS; i >= 0; i -= 1) { const p = sample(i / STEPS, inner); g.lineTo(p.x, p.y) }
            g.closePath().fillPath()
            return g
          }
          const edge = (lateral: number, color: number, width: number, alpha: number, depth: number) => {
            const g = this.add.graphics().setDepth(depth).lineStyle(width, color, alpha).beginPath()
            for (let i = 0; i <= STEPS; i += 1) { const p = sample(i / STEPS, lateral); if (i === 0) g.moveTo(p.x, p.y); else g.lineTo(p.x, p.y) }
            g.strokePath()
          }
          const { ground, bank, water, foam, currents: current } = raceTheme
          if (ground.style === 'tufts') {
            // Ground tufts so the river sits in a place, not a void.
            const rand = seededRandom(7)
            const meadow = this.add.graphics().setDepth(1)
            for (let i = 0; i < 520; i += 1) {
              const side = rand() < 0.5 ? -1 : 1
              const point = sample(rand(), side * (1.25 + rand() * 3.2))
              meadow.fillStyle(ground.colors[Math.floor(rand() * ground.colors.length)]!, ground.alpha).fillEllipse(point.x, point.y, 26 + rand() * 50, 12 + rand() * 20)
            }
          } else {
            this.drawCityGrid(ground)
          }
          // Banks → deep water → bright channel, with a foam edge.
          band(-bank.outer, -0.96, bank.fill); band(0.96, bank.outer, bank.fill)
          if (bank.glow !== undefined) { edge(-bank.outer, bank.glow, 16, 0.22, 3); edge(bank.outer, bank.glow, 16, 0.22, 3) }
          edge(-bank.outer, bank.edge, 5, 0.9, 3); edge(bank.outer, bank.edge, 5, 0.9, 3)
          band(-1, 1, water[0])
          band(-0.78, 0.78, water[1], 0.85)
          band(-0.42, 0.42, water[2], 0.55)
          if (foam.glow) { edge(-0.97, foam.edge, 14, 0.25, 4); edge(0.97, foam.edge, 14, 0.25, 4) }
          edge(-0.97, foam.edge, 5, 0.75, 4); edge(0.97, foam.edge, 5, 0.75, 4)
          edge(-0.9, foam.inner, 2, 0.4, 4); edge(0.9, foam.inner, 2, 0.4, 4)
          const currents = this.add.graphics().setDepth(5).setAlpha(current.alpha).lineStyle(3, current.color, 1)
          if (current.additive) currents.setBlendMode(Phaser.BlendModes.ADD)
          for (let lane = -2; lane <= 2; lane += 1) {
            for (let dash = 0; dash < 70; dash += 1) {
              const a = track.sample(dash / 70, lane * 0.22)
              const b = track.sample(dash / 70 + 0.006, lane * 0.22)
              currents.lineBetween(a.x, a.y, b.x, b.y)
            }
          }
          this.drawScenery()
          this.drawStartFinish()
          if (!reducedMotion) {
            // Sun glints sparkle on the water near the camera.
            const glintSource = {
              getRandomPoint: (point: PhaserType.Types.Math.Vector2Like) => {
                const view = this.cameras.main.worldView
                const progress = Phaser.Math.Clamp((view.x + Math.random() * view.width) / track.length, 0, 1)
                const p = track.sample(progress, Math.random() * 1.9 - 0.95)
                point.x = p.x
                point.y = p.y
                return point
              },
            }
            this.add.particles(0, 0, 'p-spark', {
              emitZone: { type: 'random' as const, source: glintSource },
              lifespan: { min: 500, max: 900 }, scale: { start: 0.55, end: 0 }, alpha: { start: 0.85, end: 0 },
              frequency: mobileViewport ? 90 : 45, quantity: 1, tint: raceTheme.glints,
            }).setDepth(6)
          }
        }

        private drawScenery() {
          const rand = seededRandom(31)
          for (let progress = 0.01; progress < 0.99; progress += 0.018 + rand() * 0.02) {
            for (const side of [-1, 1]) {
              if (rand() < 0.45) continue
              const onBank = rand() < 0.55
              const point = bankPoint(track, progress + rand() * 0.008, side * (onBank ? raceTheme.bank.outer + 0.1 + rand() * 0.5 : 0.8 + rand() * 0.08))
              const piece = pickWeighted(onBank ? raceTheme.decor.bank : raceTheme.decor.water, rand())
              const key = decorKey(piece.key)
              if (!this.textures.exists(key)) continue
              const size = piece.size[0] + rand() * (piece.size[1] - piece.size[0])
              const spin = !onBank && piece.spin
              const decor = this.add.image(point.x, point.y, key).setDisplaySize(size, size).setDepth(onBank ? 8 : 7).setAngle(onBank ? 0 : spin ? rand() * 360 : 0)
              if (!onBank && !reducedMotion) this.tweens.add({ targets: decor, angle: decor.angle + (spin ? 8 : 4), y: point.y - 2, duration: 1600 + rand() * 900, yoyo: true, repeat: -1, ease: 'Sine.InOut' })
            }
          }
        }

        /** Neon theme ground: a glowing city grid with scattered window lights instead of grass. */
        private drawCityGrid(ground: { minor: number; major: number; lights: number[] }) {
          const CELL = 96
          const minX = -250
          const maxX = track.length + 250
          const minY = -850
          const maxY = 850
          const grid = this.add.graphics().setDepth(1)
          for (let x = minX, index = 0; x <= maxX; x += CELL, index += 1) {
            grid.lineStyle(index % 4 ? 2 : 3, index % 4 ? ground.minor : ground.major, index % 4 ? 0.55 : 0.45).lineBetween(x, minY, x, maxY)
          }
          for (let y = minY, index = 0; y <= maxY; y += CELL, index += 1) {
            grid.lineStyle(index % 4 ? 2 : 3, index % 4 ? ground.minor : ground.major, index % 4 ? 0.55 : 0.45).lineBetween(minX, y, maxX, y)
          }
          const rand = seededRandom(11)
          const lights = this.add.graphics().setDepth(1).setBlendMode(Phaser.BlendModes.ADD)
          for (let i = 0; i < 420; i += 1) {
            const side = rand() < 0.5 ? -1 : 1
            const point = bankPoint(track, rand(), side * (1.3 + rand() * 3.2))
            lights.fillStyle(ground.lights[Math.floor(rand() * ground.lights.length)]!, 0.35 + rand() * 0.4).fillRect(point.x, point.y, 5 + rand() * 6, 4 + rand() * 4)
          }
        }

        /** Screen-space weather. Spawns over an oversized area so it still covers the view when the camera zooms out. */
        private drawAtmosphere() {
          const { width, height } = this.scale
          const { ambient } = raceTheme
          if (!ambient || reducedMotion) return
          const falling = ambient.spawn === 'fall'
          this.add.particles(0, 0, ambient.texture, {
            x: { min: -width * 0.4, max: width * 1.4 },
            y: falling ? -height * 0.35 : { min: -height * 0.3, max: height * 1.3 },
            speedX: { min: ambient.speedX[0], max: ambient.speedX[1] },
            speedY: { min: ambient.speedY[0], max: ambient.speedY[1] },
            scale: { min: ambient.scale[0], max: ambient.scale[1] },
            alpha: falling ? ambient.alpha : { values: [0, ambient.alpha, ambient.alpha, 0] },
            rotate: ambient.rotate === 'spin' ? { start: 0, end: 540 } : ambient.rotate ?? 0,
            lifespan: ambient.lifespan, frequency: ambient.frequency * (mobileViewport ? 2 : 1), quantity: 1,
            tint: ambient.tint,
            blendMode: ambient.additive ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL,
          }).setScrollFactor(0).setDepth(985)
        }

        private drawStartFinish() {
          const g = this.add.graphics().setDepth(9)
          const COLS = 10
          for (const [start, label] of [[0.004, 'START'], [0.992, 'FINISH']] as const) {
            for (let row = 0; row < 2; row += 1) {
              for (let col = 0; col < COLS; col += 1) {
                const p0 = start + row * 0.0028
                const p1 = p0 + 0.0028
                const l0 = -1 + (col / COLS) * 2
                const l1 = -1 + ((col + 1) / COLS) * 2
                const corners = [track.sample(p0, l0), track.sample(p0, l1), track.sample(p1, l1), track.sample(p1, l0)]
                g.fillStyle((row + col) % 2 ? 0x100b20 : 0xffffff, 0.9).fillPoints(corners.map((c) => new Phaser.Math.Vector2(c.x, c.y)), true)
              }
            }
            const flagPoint = bankPoint(track, start + 0.003, -1.32)
            this.add.text(flagPoint.x, flagPoint.y, `🏁 ${label}`, {
              fontFamily: '"Arial Black", Arial, sans-serif', fontSize: '18px', color: '#ffffff', stroke: '#100b20', strokeThickness: 6,
            }).setOrigin(0.5).setDepth(10)
          }
        }

        private drawBoostGates() {
          if (!track.boostGates?.length) return

          for (const gate of track.boostGates) {
            const leftBank = track.sample(gate.progress, -1)
            const rightBank = track.sample(gate.progress, 1)

            const baseGfx = this.add.graphics().setDepth(35)
            baseGfx.lineStyle(6, 0x14283c, 0.85)
            baseGfx.lineBetween(leftBank.x, leftBank.y, rightBank.x, rightBank.y)

            for (const lane of gate.lanes) {
              const p0 = track.sample(gate.progress - 0.003, lane.minLateral)
              const p1 = track.sample(gate.progress - 0.003, lane.maxLateral)
              const p2 = track.sample(gate.progress + 0.007, lane.maxLateral)
              const p3 = track.sample(gate.progress + 0.007, lane.minLateral)
              const center = track.sample(gate.progress + 0.002, lane.centerLateral)

              const padGfx = this.add.graphics().setDepth(40)
              padGfx.fillStyle(lane.colorHex, 0.28)
              padGfx.lineStyle(3, lane.colorHex, 0.95)
              padGfx.beginPath()
              padGfx.moveTo(p0.x, p0.y)
              padGfx.lineTo(p1.x, p1.y)
              padGfx.lineTo(p2.x, p2.y)
              padGfx.lineTo(p3.x, p3.y)
              padGfx.closePath()
              padGfx.fillPath()
              padGfx.strokePath()

              const angle = Math.atan2(center.tangentY, center.tangentX)
              // Chasing chevrons sell "speed up here" without reading the label.
              ;[0, 1, 2].forEach((index) => {
                const c = track.sample(gate.progress - 0.0015 + index * 0.0028, lane.centerLateral)
                const chevron = this.add.graphics({ x: c.x, y: c.y }).setDepth(41).setRotation(angle)
                chevron.lineStyle(5, 0xffffff, 0.95).beginPath().moveTo(-6, -11).lineTo(5, 0).lineTo(-6, 11).strokePath()
                chevron.setAlpha(0.35)
                if (!reducedMotion) this.tweens.add({ targets: chevron, alpha: 1, duration: 260, delay: index * 140, yoyo: true, repeat: -1, repeatDelay: 160, ease: 'Sine.InOut' })

              })
              const tagText = lane.tier === 'HYPER' ? '+25%' : lane.tier === 'SUPER' ? '+16%' : lane.tier === 'STANDARD' ? '+8%' : '+2%'
              const tagPoint = track.sample(gate.progress - 0.006, lane.centerLateral)
              this.add.text(tagPoint.x, tagPoint.y, tagText, {
                fontFamily: '"Arial Black", Arial, sans-serif', fontSize: '12px', color: lane.colorName,
                stroke: '#0a101e', strokeThickness: 5,
              }).setOrigin(0.5).setRotation(angle).setDepth(45)

              if (!reducedMotion) {
                this.tweens.add({ targets: padGfx, alpha: { from: 0.6, to: 1.0 }, duration: 800, yoyo: true, repeat: -1, ease: 'Sine.InOut' })
              }
            }
          }
        }

        private drawPickupDebug() {
          const graphics = this.add.graphics().setDepth(60)
          graphics.lineStyle(3, 0x9ff5ff, 0.7)
          for (const zone of track.pickupZones) {
            for (const anchor of zone.candidateAnchors) {
              const progress = (zone.startProgress + zone.endProgress) / 2 + anchor.progressOffset
              const point = track.sample(progress, anchor.lateralOffset)
              graphics.strokeCircle(point.x, point.y, 24)
              this.add.text(point.x, point.y + 27, `${zone.id}\n${anchor.id}`, { fontFamily: 'monospace', fontSize: '9px', color: '#caffff', backgroundColor: '#102438bb', align: 'center' }).setOrigin(0.5, 0).setDepth(61)
            }
          }
          graphics.lineStyle(3, 0xff6b7a, 0.75)
          for (const zone of track.hazardZones) {
            for (const anchor of zone.anchors) {
              const point = track.sample(anchor.progress, anchor.lateralOffset)
              graphics.strokeCircle(point.x, point.y, anchor.radius * 150)
            }
          }
        }

        private createDuck(player: PlayerLabel, index: number) {
          const appearance = resolveDuckAppearance(player, index)
          const duckDisplaySize = 94

          // 1. Avatar Container with all cosmetic layers in exact COSMETIC_LAYER_ORDER
          const cosmeticLayers: Array<PhaserType.GameObjects.Image | PhaserType.GameObjects.Sprite> = []
          for (const slot of COSMETIC_LAYER_ORDER) {
            if ((mobileViewport || scenePlayers.length > 12) && ['finish'].includes(slot)) continue
            const cosmeticId = appearance[`${slot}Id` as keyof DuckAppearance]
            const item = cosmeticId ? COSMETIC_BY_ID.get(cosmeticId) : undefined
            if (item && this.textures.exists(`cosmetic-${item.id}`)) {
              // v2 layers use the padded avatar frame; scale + shift so rig point (256,256) stays at the origin.
              const layerSize = duckDisplaySize * (AVATAR_FRAME.size / 512)
              const frameCenterY = AVATAR_FRAME.y + AVATAR_FRAME.size / 2
              const layerY = (frameCenterY - 256) * (layerSize / AVATAR_FRAME.size)
              const animKey = `cosmetic-anim-${item.id}`
              let img: PhaserType.GameObjects.Image | PhaserType.GameObjects.Sprite
              if (this.textures.exists(animKey)) {
                if (!this.anims.exists(animKey)) {
                  this.anims.create({ key: animKey, frames: this.anims.generateFrameNumbers(animKey), frameRate: MOTION_SPRITE.fps, repeat: -1 })
                }
                // Start each duck at a different frame so a pack of identical auras doesn't pulse in lockstep.
                img = this.add.sprite(0, layerY, animKey).play({ key: animKey, startFrame: (index * 7) % MOTION_SPRITE.frames })
              } else {
                img = this.add.image(0, layerY, `cosmetic-${item.id}`)
              }
              img.setDisplaySize(layerSize, layerSize).setData('cosmetic-slot', slot)
              if (slot === 'trail') {
                // One continuous, longer wake: stretch the trail backwards from the tail tip (rig x 84).
                const tailOrigin = (84 - AVATAR_FRAME.x) / AVATAR_FRAME.size
                img.setOrigin(tailOrigin, 0.5).setPosition((tailOrigin - 0.5) * layerSize, layerY).setDisplaySize(layerSize * TRAIL_STRETCH, layerSize)
              }
              cosmeticLayers.push(img)
            }
          }

          const avatarNode = this.add.container(0, 0, cosmeticLayers)
          if (!reducedMotion) {
            // Ducks bob on the water, each on its own phase.
            this.tweens.add({ targets: avatarNode, y: -3, duration: 620 + (index % 4) * 70, delay: index * 90, yoyo: true, repeat: -1, ease: 'Sine.InOut' })
          }

          // 2. Status overlays (baked sprite loops) — behind or in front of the duck.
          const nitroFlame = loopSprite(this, 'nitro-flame', -80, 8, 128, index * 3).setVisible(false)
          const windStreak = loopSprite(this, 'wind-streak', -26, 2, 150, index * 3).setVisible(false).setAlpha(0.9)
          const shieldBubble = loopSprite(this, 'shield-bubble', 2, -2, 124, index * 3).setVisible(false)
          const dizzyStars = loopSprite(this, 'dizzy', 6, -52, 82, index * 3).setVisible(false)
          const silenced = loopSprite(this, 'silenced', 36, -40, 32, index).setVisible(false)
          const featherOrbit = loopSprite(this, 'feather-orbit', 0, -4, 120, index * 3).setVisible(false)
          const targetLock = loopSprite(this, 'target-lock', 0, -2, 104, index * 3).setVisible(false)

          // 3. Name tag, medal rank badge, loadout icons, wild item badge
          const name = this.add.text(0, 42, player.name, {
            color: '#ffffff',
            fontFamily: 'sans-serif',
            fontSize: '15px',
            fontStyle: 'bold',
            stroke: '#100b20',
            strokeThickness: 5,
          }).setOrigin(0.5, 0)

          const rankBg = this.add.circle(0, 0, 13, RANK_COLORS[0]!.fill).setStrokeStyle(3, 0x100b20, 1)
          const rankLabel = this.add.text(0, 0, String(index + 1), {
            color: '#100b20', fontFamily: '"Arial Black", Arial, sans-serif', fontSize: '14px',
          }).setOrigin(0.5)
          const rank = this.add.container(-38, -30, [rankBg, rankLabel])

          const loadoutItemIds = player.itemIds ?? []
          const loadoutIcons = new Map<RaceItemId, PhaserType.GameObjects.Container>()
          const loadoutSpacing = 22
          const loadoutStartX = -((loadoutItemIds.length - 1) * loadoutSpacing) / 2
          const loadoutNodes = loadoutItemIds.map((itemId, itemIndex) => {
            const icon = ITEM_ICON_BY_ID[itemId]
            const badge = this.add.container(loadoutStartX + itemIndex * loadoutSpacing, -62, [
              this.add.circle(0, 0, 10, 0x100b20, 0.8).setStrokeStyle(2, 0xffffff, 0.7),
              ...(icon && this.textures.exists(iconKey(icon)) ? [this.add.image(0, 0, iconKey(icon)).setDisplaySize(16, 16)] : []),
            ])
            loadoutIcons.set(itemId, badge)
            return badge
          })

          const wildIcon = this.add.image(0, 0, iconKey('nitro')).setDisplaySize(24, 24)
          const wildBadge = this.add.container(40, -54, [
            this.add.circle(0, 0, 15, 0x100b20, 0.85).setStrokeStyle(3, 0xfde047, 1),
            wildIcon,
          ]).setVisible(false)
          if (!reducedMotion) this.tweens.add({ targets: wildBadge, scale: 1.12, duration: 520, yoyo: true, repeat: -1, ease: 'Sine.InOut' })

          const start = track.sample(0, -0.7 + (index / Math.max(1, scenePlayers.length - 1)) * 1.4)
          const root = this.add.container(start.x, start.y, [
            windStreak,
            nitroFlame,
            avatarNode,
            featherOrbit,
            shieldBubble,
            targetLock,
            dizzyStars,
            silenced,
            name,
            rank,
            ...loadoutNodes,
            wildBadge,
          ]).setDepth(100 + index)

          // 4. Foam wake trailing behind the duck (busier while boosting, see update()).
          const wake = reducedMotion ? null : this.add.particles(0, 0, 'p-foam', {
            follow: root, followOffset: { x: -30, y: 22 },
            lifespan: { min: 420, max: 760 }, speedX: { min: -70, max: -25 }, speedY: { min: -16, max: 16 },
            scale: { start: 0.38, end: 1.05 }, alpha: { start: 0.55, end: 0 },
            frequency: WAKE_IDLE_MS, quantity: 1, ...(raceTheme.wakeTint ? { tint: raceTheme.wakeTint } : {}),
          }).setDepth(95)

          if (player.isGhost) {
            root.setAlpha(0.58)
            name.setText(`👻 ${player.name}`)
          }

          this.duckViews.set(player.playerId, {
            root,
            avatarNode,
            shieldBubble,
            nitroFlame,
            windStreak,
            dizzyStars,
            silenced,
            featherOrbit,
            targetLock,
            rankBg,
            rankLabel,
            wildBadge,
            wildIcon,
            wake,
            boosting: false,
            spinning: false,
            lastX: start.x,
            lastY: start.y,
            targetX: start.x,
            targetY: start.y,
            loadoutIcons,
          })
        }

        private markPrepItemUsed(playerId: string, itemId: RaceItemId) {
          const icon = this.duckViews.get(playerId)?.loadoutIcons.get(itemId)
          if (!icon || icon.alpha <= 0.35) return
          icon.setAlpha(0.3)
          this.tweens.add({ targets: icon, scale: reducedMotion ? 1 : 1.8, alpha: 0, duration: reducedMotion ? 150 : 420, ease: 'Quad.Out' })
        }

        private finishCelebrationCount = 0

        private showCountdown() {
          const centerX = this.scale.width / 2
          const centerY = this.scale.height / 2
          const overlay = this.add.rectangle(centerX, centerY, this.scale.width, this.scale.height, 0x100b20, reducedMotion ? 0.2 : 0.38).setScrollFactor(0).setDepth(1490)
          const countdown = this.add.text(centerX, centerY, '3', {
            color: '#ff6b6b', fontFamily: 'sans-serif', fontSize: '110px', fontStyle: 'bold', stroke: '#100b20', strokeThickness: 12,
          }).setOrigin(0.5).setScrollFactor(0).setDepth(1500)
          const countdownLabel = this.add.text(centerX, centerY - 88, 'GET READY', {
            color: '#ffffff', fontFamily: 'sans-serif', fontSize: '18px', fontStyle: 'bold', letterSpacing: 4,
            backgroundColor: '#100b20cc', padding: { x: 12, y: 6 },
          }).setOrigin(0.5).setScrollFactor(0).setDepth(1500).setAlpha(0.85)
          const showcase = this.add.text(centerX, centerY + 105, '', {
            color: '#ffffff', fontFamily: 'sans-serif', fontSize: mobileViewport ? '13px' : '17px', fontStyle: 'bold', align: 'center',
            backgroundColor: '#100b20dd', padding: { x: 14, y: 9 }, stroke: '#100b20', strokeThickness: 2,
          }).setOrigin(0.5).setScrollFactor(0).setDepth(1500).setAlpha(0)
          const tickColors = ['#ff6b6b', '#ffcc00', '#3dff8f', '#ffffff'] as const
          const pulseCountdown = (color: string) => {
            if (reducedMotion) return
            const pulse = this.add.circle(centerX, centerY, 42, 0xffffff, 0.08).setScrollFactor(0).setDepth(1495).setStrokeStyle(4, parseInt(color.replace('#', ''), 16), 0.9)
            this.tweens.add({ targets: pulse, scale: 2.8, alpha: 0, duration: 420, onComplete: () => pulse.destroy() })
          }
          let showcaseIndex = 0
          const showPlayer = () => {
            const player = scenePlayers[showcaseIndex % scenePlayers.length]!
            const names = player.appearance ? ['head', 'outfit', 'pet', 'aura'].flatMap((slot) => {
              const id = player.appearance?.[`${slot}Id` as keyof DuckAppearance]
              return id ? [COSMETIC_BY_ID.get(id)?.name].filter(Boolean) : []
            }) : []
            showcase.setText(`${player.name}${names.length ? `\n${names.slice(0, 3).join(' · ')}` : ''}`)
            showcase.setAlpha(0).setY(centerY + 118)
            this.tweens.add({ targets: showcase, alpha: 1, y: centerY + 105, duration: reducedMotion ? 120 : 220 })
            showcaseIndex += 1
          }
          showPlayer()
          this.time.addEvent({ delay: Math.max(250, 2800 / scenePlayers.length), repeat: scenePlayers.length - 2, callback: showPlayer })
          let value = 3
          this.time.addEvent({ delay: 750, repeat: 3, callback: () => {
            value -= 1
            const color = tickColors[Math.max(0, value)] ?? '#ffffff'
            countdown.setText(value > 0 ? String(value) : 'QUACK!')
            countdown.setColor(color)
            countdownLabel.setText(value > 0 ? 'GET READY' : 'GO GO GO')
            audio.countdown(value <= 0)
            countdown.setScale(1.45).setAlpha(1)
            this.tweens.add({ targets: countdown, scale: 1, duration: reducedMotion ? 120 : 260, ease: 'Back.Out' })
            pulseCountdown(color)
            if (value === 0 && !reducedMotion) {
              const flash = this.add.rectangle(centerX, centerY, this.scale.width, this.scale.height, 0xffffff, 0.22).setScrollFactor(0).setDepth(1498)
              this.tweens.add({ targets: flash, alpha: 0, duration: 280, onComplete: () => flash.destroy() })
            }
            if (value < 0) {
              this.tweens.add({ targets: [overlay, countdown, countdownLabel, showcase], alpha: 0, duration: reducedMotion ? 120 : 280, onComplete: () => { overlay.destroy(); countdown.destroy(); countdownLabel.destroy(); showcase.destroy() } })
            }
          } })
        }

        applySnapshot(ducks: DuckSnapshot[]) {
          for (const duck of ducks) {
            const view = this.duckViews.get(duck.playerId)
            if (!view) continue
            const point = track.sample(duck.progress, duck.lateralOffset)
            view.targetX = point.x
            view.targetY = point.y
            const medal = RANK_COLORS[Math.min(duck.rank, RANK_COLORS.length) - 1] ?? RANK_COLORS[RANK_COLORS.length - 1]!
            view.rankBg.setFillStyle(medal.fill)
            view.rankLabel.setText(String(duck.rank)).setColor(medal.text)
            view.root.setDepth(100 + scenePlayers.length - duck.rank)

            const effects = new Set(duck.activeEffects)
            view.shieldBubble.setVisible(effects.has('BUBBLE_SHIELD') || effects.has('MINI_BUBBLE'))
            const flame = ['NITRO', 'MINI_NITRO', 'PREDATOR_RUSH'].some((effect) => effects.has(effect))
            view.nitroFlame.setVisible(flame)
            if (flame) {
              if (effects.has('PREDATOR_RUSH') && !effects.has('NITRO')) view.nitroFlame.setTint(0xff7a3d)
              else view.nitroFlame.clearTint()
            }
            const wind = ['TAILWIND', 'SLIPSTREAM_MAGNET', 'DRAFT_FIN', 'PADDLE_BURST'].some((effect) => effects.has(effect))
            view.windStreak.setVisible(wind && !flame)
            view.boosting = flame || wind
            view.dizzyStars.setVisible(effects.has('SLOWED'))
            view.silenced.setVisible(effects.has('SILENCED'))
            view.featherOrbit.setVisible(effects.has('FEATHER') || effects.has('WILD_FEATHER'))

            const wildIcon = duck.wildItem ? ITEM_ICON_BY_ID[duck.wildItem.itemId] : undefined
            if (wildIcon && this.textures.exists(iconKey(wildIcon))) view.wildIcon.setTexture(iconKey(wildIcon)).setDisplaySize(24, 24)
            view.wildBadge.setVisible(Boolean(wildIcon))
          }
          this.leaderboard.setText(ducks.slice(0, 12).map((duck) => {
            const player = scenePlayers.find((candidate) => candidate.playerId === duck.playerId)
            const effect = duck.activeEffects.map((entry) => EFFECT_ICONS[entry] ?? '').join('')
            const wild = duck.wildItem ? ` 🎒${WILD_ICONS[duck.wildItem.itemId]}` : ''
            return `${String(duck.rank).padStart(2)}  ${player?.name ?? duck.playerId} ${effect}${wild}`
          }).join('\n'))
        }

        applyWorld(world: Pick<StateSnapshotMessage, 'ducks' | 'pickups' | 'hazards' | 'rockets' | 'bananas'>) {
          this.applySnapshot(world.ducks)
          const duckById = new Map(world.ducks.map((duck) => [duck.playerId, duck]))
          const activeIds = new Set(world.pickups.filter((pickup) => pickup.state === 'ACTIVE').map((pickup) => pickup.id))
          for (const pickup of world.pickups) {
            if (pickup.state !== 'ACTIVE' || this.pickupViews.has(pickup.id)) continue
            const point = track.sample(pickup.progress, pickup.lateralOffset)
            const spec = PICKUP_FX[pickup.type]
            const sprite = loopSprite(this, spec.key, point.x, point.y, spec.size, pickup.id.length * 3).setDepth(72)
            sprite.setScale(0).setData('size', spec.size)
            this.tweens.add({ targets: sprite, displayWidth: spec.size, displayHeight: spec.size, duration: reducedMotion ? 1 : 320, ease: 'Back.Out' })
            this.pickupViews.set(pickup.id, sprite)
          }
          for (const [pickupId, view] of this.pickupViews) {
            if (activeIds.has(pickupId)) continue
            this.pickupViews.delete(pickupId)
            this.tweens.killTweensOf(view)
            playFx(this, 'sparkle-burst', view.x, view.y, { size: 110, depth: 931 })
            this.tweens.add({ targets: view, scale: view.scale * (reducedMotion ? 1.1 : 1.6), alpha: 0, duration: reducedMotion ? 120 : 280, onComplete: () => view.destroy() })
          }
          for (const hazard of world.hazards) {
            if (this.hazardViews.has(hazard.id)) continue
            const point = track.sample(hazard.progress, hazard.lateralOffset)
            const spec = HAZARD_FX[hazard.type as keyof typeof HAZARD_FX] ?? HAZARD_FX.ANCHOR
            this.hazardViews.set(hazard.id, loopSprite(this, spec.key, point.x, point.y, spec.size, hazard.id.length).setDepth(68))
          }

          const rocketIds = new Set(world.rockets.map((rocket) => rocket.id))
          const lockedTargets = new Set<string>()
          for (const rocket of world.rockets) {
            const target = duckById.get(rocket.targetPlayerId)
            lockedTargets.add(rocket.targetPlayerId)
            const point = track.sample(Math.min(0.999, rocket.progress), target?.lateralOffset ?? 0)
            let view = this.rocketViews.get(rocket.id)
            if (!view) {
              const sprite = loopSprite(this, 'rocket', point.x, point.y, 78).setDepth(950)
              const smoke = reducedMotion ? null : this.add.particles(0, 0, 'p-smoke', {
                follow: sprite, lifespan: 560, speed: { min: 6, max: 24 }, scale: { start: 0.35, end: 1.1 },
                alpha: { start: 0.6, end: 0 }, frequency: 24, quantity: 1,
              }).setDepth(945)
              view = { sprite, smoke }
              this.rocketViews.set(rocket.id, view)
            }
            const dx = point.x - view.sprite.x
            const dy = point.y - view.sprite.y
            if (Math.hypot(dx, dy) > 0.5) view.sprite.setRotation(Math.atan2(dy, dx))
            view.sprite.setPosition(point.x, point.y)
          }
          for (const [rocketId, view] of this.rocketViews) {
            if (rocketIds.has(rocketId)) continue
            this.rocketViews.delete(rocketId)
            view.sprite.destroy()
            if (view.smoke) {
              view.smoke.stop()
              this.time.delayedCall(700, () => view.smoke?.destroy())
            }
          }
          for (const [playerId, view] of this.duckViews) view.targetLock.setVisible(lockedTargets.has(playerId))

          const bananaIds = new Set(world.bananas.map((banana) => banana.id))
          for (const banana of world.bananas) {
            const point = track.sample(banana.progress, banana.lateralOffset)
            const existing = this.bananaViews.get(banana.id)
            if (existing) {
              existing.setPosition(point.x, point.y)
              continue
            }
            const sprite = loopSprite(this, 'banana', point.x, point.y, 64, banana.id * 5).setDepth(80)
            this.bananaViews.set(banana.id, sprite)
          }
          for (const [bananaId, view] of this.bananaViews) {
            if (bananaIds.has(bananaId)) continue
            this.bananaViews.delete(bananaId)
            view.destroy()
          }
        }

        private duckView(playerId?: string | null) {
          return playerId ? this.duckViews.get(playerId) ?? null : null
        }

        private focusCamera(playerId: string, duration = 450) {
          this.focusPlayerId = playerId
          this.focusUntil = this.time.now + duration
        }

        private trackPoint(progress?: unknown, lateralOffset?: unknown) {
          if (typeof progress !== 'number') return null
          return track.sample(progress, typeof lateralOffset === 'number' ? lateralOffset : 0)
        }

        private sparks!: PhaserType.GameObjects.Particles.ParticleEmitter
        private coolSparks!: PhaserType.GameObjects.Particles.ParticleEmitter

        private createBurstEmitters() {
          const base = { lifespan: { min: 420, max: 760 }, speed: { min: 110, max: 280 }, scale: { start: 0.75, end: 0 }, gravityY: 260, emitting: false }
          this.sparks = this.add.particles(0, 0, 'p-spark', { ...base, tint: [0xfde047, 0xf97316, 0xffffff] }).setDepth(940)
          this.coolSparks = this.add.particles(0, 0, 'p-spark', { ...base, tint: [0x7dd3fc, 0xe0f2fe, 0xc4b5fd] }).setDepth(940)
        }

        private burst(x: number, y: number, count: number, cool = false) {
          if (reducedMotion) return
          ;(cool ? this.coolSparks : this.sparks).explode(count, x, y)
        }

        private shake(duration: number, intensity: number) {
          if (!reducedMotion) this.cameras.main.shake(duration, intensity)
        }

        private spin(view: { avatarNode: PhaserType.GameObjects.Container; spinning: boolean }, turns = 1) {
          if (reducedMotion) return
          view.spinning = true
          view.avatarNode.setAngle(0)
          this.tweens.add({
            targets: view.avatarNode, angle: 360 * turns, duration: 520, ease: 'Cubic.easeOut',
            onComplete: () => { view.avatarNode.setAngle(0); view.spinning = false },
          })
        }

        private squash(view: { avatarNode: PhaserType.GameObjects.Container }) {
          if (reducedMotion) return
          this.tweens.add({ targets: view.avatarNode, scaleX: 1.18, scaleY: 0.84, duration: 90, yoyo: true, ease: 'Quad.Out' })
        }

        private playActionEffects(raceEvent: RaceEvent) {
          const type = raceEvent.type
          const source = this.duckView(raceEvent.sourcePlayerId)
          const target = this.duckView(raceEvent.targetPlayerId)
          const say = (view: { root: PhaserType.GameObjects.Container } | null, label: string, tone: CalloutTone, size = 24) => {
            if (view) callout(this, view.root.x, view.root.y - 72, label, tone, reducedMotion, size)
          }
          const fx = (view: { root: PhaserType.GameObjects.Container } | null, key: Parameters<typeof playFx>[1], size: number, tint?: number) => {
            if (view) playFx(this, key, view.root.x, view.root.y, { size, tint })
          }

          if (type === 'AI_INTENT') {
            const shout = INTENT_SHOUTS[String(raceEvent.metadata.intent)]
            if (shout) say(source, shout.label, shout.tone, 20)
            return
          }
          if (type === 'MOMENTUM_STOLEN') {
            say(source, 'STEAL!', 'nitro', 22)
            return
          }
          if (type === 'GUARD_SURGE' && !raceEvent.metadata.glide) {
            say(source, 'GUARD!', 'green', 20)
            return
          }

          if (type === 'HORN_USED' || type === 'WILD_HORN_USED') {
            fx(source, 'horn-wave', type === 'HORN_USED' ? 230 : 190)
            say(source, 'QUACK!', 'gold', 26)
            this.shake(120, 0.003)
            if (raceEvent.sourcePlayerId) this.focusCamera(raceEvent.sourcePlayerId, 420)
            return
          }

          if (type === 'ROCKET_FIRED' || type === 'MINI_ROCKET_FIRED') {
            if (source) playFx(this, 'explosion', source.root.x + 20, source.root.y - 6, { size: 70 })
            say(source, type === 'ROCKET_FIRED' ? 'FIRE!' : 'PEW!', 'fire', 20)
            if (raceEvent.sourcePlayerId) this.focusCamera(raceEvent.sourcePlayerId, 380)
            return
          }

          if (type === 'ROCKET_HIT' || type === 'MINI_ROCKET_HIT') {
            const hitView = target ?? source
            if (hitView) {
              fx(hitView, 'explosion', type === 'ROCKET_HIT' ? 190 : 140)
              this.burst(hitView.root.x, hitView.root.y, type === 'ROCKET_HIT' ? 18 : 10)
              say(hitView, 'BOOM!', 'fire', type === 'ROCKET_HIT' ? 30 : 24)
              this.spin(hitView)
              this.shake(reducedMotion ? 60 : 220, type === 'ROCKET_HIT' ? 0.009 : 0.005)
              if (!reducedMotion && type === 'ROCKET_HIT') this.cameras.main.flash(120, 255, 190, 120)
            }
            if (raceEvent.targetPlayerId) this.focusCamera(raceEvent.targetPlayerId, 620)
            return
          }

          if (type === 'ROCKET_BLOCKED' || type === 'MINI_ROCKET_BLOCKED') {
            const blockView = target ?? source
            fx(blockView, 'bubble-pop', 150)
            if (blockView) this.burst(blockView.root.x, blockView.root.y, 10, true)
            say(blockView, raceEvent.metadata.defense === 'IMMUNITY' ? 'IMMUNE!' : 'BLOCKED!', 'ice')
            if (raceEvent.targetPlayerId) this.focusCamera(raceEvent.targetPlayerId, 400)
            return
          }

          if (type === 'BANANA_DROPPED' || type === 'WILD_BANANA_DROPPED') {
            const point = this.trackPoint(raceEvent.metadata.progress, raceEvent.metadata.lateralOffset) ?? (source ? { x: source.root.x, y: source.root.y } : null)
            if (point) playFx(this, 'splash', point.x, point.y, { size: 96, depth: 85 })
            if (raceEvent.sourcePlayerId) this.focusCamera(raceEvent.sourcePlayerId, 350)
            return
          }

          if (type === 'BANANA_HIT' || type === 'WILD_BANANA_HIT') {
            fx(target, 'splash', 140)
            fx(target, 'slip-stars', 130)
            say(target, 'SLIP!', 'gold')
            if (target) this.spin(target, 2)
            this.shake(140, 0.004)
            if (raceEvent.targetPlayerId) this.focusCamera(raceEvent.targetPlayerId, 520)
            return
          }

          if (type === 'BANANA_BLOCKED' || type === 'WILD_BANANA_BLOCKED') {
            fx(target, 'feather-puff', 130)
            say(target, raceEvent.metadata.defense === 'IMMUNITY' ? 'IMMUNE!' : 'DODGE!', 'green')
            return
          }

          if (type === 'NITRO_STARTED' || (type === 'INSTANT_PICKUP_TRIGGERED' && raceEvent.metadata.itemId === 'MINI_NITRO')) {
            if (source) {
              this.squash(source)
              playFx(this, 'nitro-ignite', source.root.x - 20, source.root.y + 4, { size: type === 'NITRO_STARTED' ? 190 : 140 })
              this.burst(source.root.x - 30, source.root.y, 12, true)
            }
            say(source, 'NITRO!', 'nitro', type === 'NITRO_STARTED' ? 28 : 22)
            this.shake(100, 0.002)
            if (raceEvent.sourcePlayerId) this.focusCamera(raceEvent.sourcePlayerId, 420)
            return
          }

          if (type === 'DRAFT_FIN_STARTED' || type === 'PADDLE_BURST_STARTED' || type === 'TAILWIND_STARTED' || type === 'MAGNET_STARTED'
            || (type === 'INSTANT_PICKUP_TRIGGERED' && (raceEvent.metadata.itemId === 'TAILWIND' || raceEvent.metadata.itemId === 'SLIPSTREAM_MAGNET'))) {
            const label = type === 'DRAFT_FIN_STARTED' ? 'DRAFT!' : type === 'PADDLE_BURST_STARTED' ? 'PADDLE!' : (type === 'MAGNET_STARTED' || raceEvent.metadata.itemId === 'SLIPSTREAM_MAGNET') ? 'MAGNET!' : 'TAILWIND!'
            if (source) {
              this.squash(source)
              playFx(this, 'sparkle-burst', source.root.x - 10, source.root.y, { size: 120, tint: 0xbff5ff })
            }
            say(source, label, 'ice', 22)
            return
          }

          if (type === 'BOOST_BROKEN') {
            const victim = source ?? target
            fx(victim, 'explosion', 120)
            if (victim) this.burst(victim.root.x, victim.root.y, 8)
            say(victim, 'BROKEN!', 'fire', 22)
            if (raceEvent.sourcePlayerId) this.focusCamera(raceEvent.sourcePlayerId, 460)
            return
          }

          if (type === 'ITEM_SILENCED') {
            const victim = source ?? target
            fx(victim, 'horn-wave', 120, 0x94a3b8)
            say(victim, 'MUTED', 'gray', 20)
            return
          }

          if (type === 'PREDATOR_RUSH_STARTED' && source) {
            playFx(this, 'nitro-ignite', source.root.x - 20, source.root.y + 4, { size: 170, tint: 0xff8a4c })
            this.burst(source.root.x - 20, source.root.y, 12)
            say(source, 'RUSH!', 'fire')
            return
          }

          if (type === 'BUBBLE_POPPED' || type === 'MINI_BUBBLE_BLOCKED') {
            const bubbleView = source ?? target
            fx(bubbleView, 'bubble-pop', 150)
            if (bubbleView) this.burst(bubbleView.root.x, bubbleView.root.y, 8, true)
            if (type === 'BUBBLE_POPPED') say(bubbleView, 'POP!', 'ice', 20)
            return
          }

          if (type === 'BUBBLE_SHIELD_ACTIVATED' || type === 'MINI_BUBBLE_ACTIVATED') {
            fx(source, 'sparkle-burst', 140)
            say(source, 'SHIELD!', 'ice', 20)
            return
          }

          if (type === 'FEATHER_DODGED' || type === 'WILD_FEATHER_DODGED' || type === 'HAZARD_DODGED') {
            fx(source, 'feather-puff', 140)
            say(source, 'DODGE!', 'green')
            return
          }

          if (type === 'WILD_FEATHER_USED' && source) {
            fx(source, 'feather-puff', 120)
            return
          }

          if (type === 'HAZARD_HIT' && source) {
            const hazard = String(raceEvent.metadata.hazardType)
            const label = ({ ANCHOR: 'SNAGGED!', WHIRLPOOL: 'SPUN!', ICE_PATCH: 'FROZEN!', STICKY_GOO: 'STUCK!' } as Record<string, string>)[hazard] ?? 'OUCH!'
            fx(source, 'splash', 140, hazard === 'STICKY_GOO' ? 0xbef264 : hazard === 'ICE_PATCH' ? 0xe0f2fe : undefined)
            if (hazard === 'ICE_PATCH') this.burst(source.root.x, source.root.y, 10, true)
            if (hazard === 'WHIRLPOOL') this.spin(source, 2)
            say(source, label, hazard === 'STICKY_GOO' ? 'green' : 'ice')
            this.shake(120, 0.003)
            if (raceEvent.sourcePlayerId) this.focusCamera(raceEvent.sourcePlayerId, 460)
            return
          }

          if (type === 'PICKUP_COLLECTED' || type === 'WILD_ITEM_GRANTED') {
            fx(source, 'sparkle-burst', 120)
            return
          }

          if (type === 'GOLDEN_BOX_COLLECTED' && source) {
            fx(source, 'coin-burst', 190)
            this.burst(source.root.x, source.root.y, 14)
            say(source, '+1 QP', 'gold', 28)
            if (!reducedMotion) this.cameras.main.flash(160, 255, 230, 140)
            if (raceEvent.sourcePlayerId) this.focusCamera(raceEvent.sourcePlayerId, 620)
            return
          }

          if (type === 'BOOST_GATE_PASSED' && source) {
            const colorHex = (raceEvent.metadata.colorHex as number) ?? 0xffb703
            const tier = String(raceEvent.metadata.tier ?? '')
            playFx(this, 'sparkle-burst', source.root.x, source.root.y, { size: tier === 'HYPER' ? 170 : 130, tint: colorHex })
            if (tier === 'HYPER' || tier === 'SUPER') {
              this.squash(source)
              say(source, tier === 'HYPER' ? 'HYPER!' : 'SUPER!', tier === 'HYPER' ? 'gold' : 'ice', 20)
            }
            return
          }

          if (type === 'DUCK_FINISHED' && source) {
            this.finishCelebrationCount += 1
            const place = this.finishCelebrationCount
            if (place <= 3) {
              fx(source, 'confetti', place === 1 ? 260 : 200)
              this.burst(source.root.x, source.root.y, place === 1 ? 20 : 12)
            } else {
              fx(source, 'sparkle-burst', 120)
            }
            say(source, place === 1 ? '🏆 #1' : place === 2 ? '🥈 #2' : place === 3 ? '🥉 #3' : `#${place}`, place === 1 ? 'gold' : place <= 3 ? 'ice' : 'gray', place === 1 ? 32 : 24)
            if (raceEvent.sourcePlayerId) this.focusCamera(raceEvent.sourcePlayerId, place === 1 ? 900 : place <= 3 ? 620 : 380)
          }
        }

        applyEvent(raceEvent: RaceEvent) {
          const activation = itemActivationForEvent(raceEvent)
          if (activation) this.markPrepItemUsed(activation.playerId, activation.itemId)

          const source = scenePlayers.find((player) => player.playerId === raceEvent.sourcePlayerId)?.name
          const target = scenePlayers.find((player) => player.playerId === raceEvent.targetPlayerId)?.name
          const messages: Partial<Record<RaceEvent['type'], string>> = {
            ROCKET_FIRED: `🚀 ${source} phóng Tên Lửa → ${target}`,
            ROCKET_HIT: `💥 ${target} trúng Tên Lửa (Hãm tốc)!`,
            ROCKET_BLOCKED: raceEvent.metadata.defense === 'IMMUNITY'
              ? `🛡️ ${target} đang miễn nhiễm!`
              : `🫧 ${target} dùng Khiên chặn Tên Lửa!`,
            BANANA_DROPPED: `🍌 ${source} thả Vỏ Chuối`,
            BANANA_HIT: `🍌 ${target} đạp trúng Chuối (Trượt lùi)!`,
            BANANA_BLOCKED: raceEvent.metadata.defense === 'FEATHER'
              ? `🪶 ${target} dùng Lông Vũ né Chuối`
              : raceEvent.metadata.defense === 'IMMUNITY'
              ? `🛡️ ${target} đang miễn nhiễm!`
              : `🛡️ ${target} né được Chuối`,
            NITRO_STARTED: `⚡ ${source} NITRO (+25%)!`,
            DRAFT_FIN_STARTED: `🦈 ${source} DRAFT FIN (+21%)!`,
            PADDLE_BURST_STARTED: `🛶 ${source} PADDLE BURST (+15%)!`,
            TAILWIND_STARTED: `🌊 ${source} THUẬN GIÓ (+7%)!`,
            MAGNET_STARTED: `🧲 ${source} NAM CHÂM HÚT TỐC (+12%)!`,
            BOOST_BROKEN: `💥 ${source} BỊ BẺ GÃY TĂNG TỐC!`,
            SHOCK_ABSORBER_PROC: `🦺 ${target || source} kích hoạt Áo Chống Sốc`,
            HORN_USED: `🔊 ${source} THỔI CÒI! Khóa item đối thủ`,
            ITEM_SILENCED: `🔇 ${source} bị Câm Lặng (${raceEvent.metadata.durationSeconds ?? 0.5}s)`,
            PREDATOR_RUSH_STARTED: `🔥 ${source} PREDATOR RUSH (+10% tốc độ)!`,
            FEATHER_DODGED: `🪶 ${source} NÉ ĐÒN BẰNG LÔNG VŨ!`,
            BUBBLE_SHIELD_ACTIVATED: `🫧 ${source} bật Khiên Bong Bóng`,
            BUBBLE_SHIELD_EXPIRED: `🫧 ${source} Khiên hết hạn`,
            BUBBLE_POPPED: `💥 ${source} Khiên vỡ nổ đẩy tốc!`,
            PICKUP_COLLECTED: `📦 ${source} mở Quack Box`,
            PICKUP_SKIPPED_SLOT_FULL: `🎒 ${source} túi đồ đã đầy`,
            WILD_ITEM_GRANTED: `${WILD_ICONS[raceEvent.metadata.itemId as WildItemId] ?? '🎒'} ${source} nhặt ${String(raceEvent.metadata.itemId ?? '').replaceAll('_', ' ')}`,
            INSTANT_PICKUP_TRIGGERED: `${WILD_ICONS[raceEvent.metadata.itemId as WildItemId] ?? '⚡'} ${source} kích hoạt ${String(raceEvent.metadata.itemId ?? '').replaceAll('_', ' ')}`,
            MINI_ROCKET_FIRED: `🚀 ${source} phóng Mini Rocket → ${target}`,
            MINI_ROCKET_HIT: `💥 ${target} trúng Mini Rocket!`,
            MINI_ROCKET_BLOCKED: raceEvent.metadata.defense === 'IMMUNITY'
              ? `🛡️ ${target} đang miễn nhiễm!`
              : `🫧 ${target} chặn Mini Rocket!`,
            WILD_BANANA_DROPPED: `🍌 ${source} thả Wild Banana`,
            WILD_BANANA_HIT: `🍌 ${target} đạp phải Wild Banana!`,
            WILD_BANANA_BLOCKED: raceEvent.metadata.defense === 'WILD_FEATHER' || raceEvent.metadata.defense === 'FEATHER'
              ? `🪶 ${target} dùng Lông Vũ né Chuối!`
              : raceEvent.metadata.defense === 'IMMUNITY'
              ? `🛡️ ${target} đang miễn nhiễm!`
              : `🪽 ${target} né được Chuối`,
            MINI_BUBBLE_ACTIVATED: `🫧 ${source} bật Mini Bubble`,
            MINI_BUBBLE_BLOCKED: `🫧 ${source} Mini Bubble chặn đòn!`,
            WILD_HORN_USED: `🔊 ${source} THỔI CÒI WILD!`,
            WILD_FEATHER_USED: `🪽 ${source} bật Feather Hop`,
            WILD_FEATHER_DODGED: `🪽 ${source} Feather Hop NÉ ĐÒN!`,
            HAZARD_HIT: `☠️ ${source} va phải ${String(raceEvent.metadata.hazardType ?? 'hazard').replaceAll('_', ' ')}`,
            HAZARD_DODGED: `🪽 ${source} né chướng ngại vật!`,
            GOLDEN_BOX_COLLECTED: `🪙 ${source} NHẶT ĐƯỢC HỘP VÀNG (+1 QP)!`,
            BOOST_GATE_PASSED: `⚡ ${source} qua Cổng ${String(raceEvent.metadata.label ?? 'Boost')}`,
            MOMENTUM_STOLEN: `🌀 ${source} CƯỚP ĐÀ của ${target}!`,
            GUARD_SURGE: `🛡️ ${source} hóa giải đòn → Guard Surge!`,
            AI_INTENT: `${intentCopy(raceEvent.metadata.intent, source ?? '', target ?? '', '').icon} ${intentCopy(raceEvent.metadata.intent, source ?? '', target ?? '', String(raceEvent.metadata.itemId ?? '').replaceAll('_', ' ')).title}`,
          }
          const message = messages[raceEvent.type]
          audio.raceEvent(raceEvent.type)
          if (message) {
            this.recentEvents = [message, ...this.recentEvents].slice(0, 3)
            this.eventFeed.setText(this.recentEvents.join('\n'))
          }
          this.playActionEffects(raceEvent)
          const focusId = raceEvent.targetPlayerId ?? raceEvent.sourcePlayerId
          const view = focusId ? this.duckViews.get(focusId) : null
          if (!view) return
          const revealedItem = raceEvent.metadata.itemId as WildItemId | undefined
          const revealedIcon = revealedItem ? ITEM_ICON_BY_ID[revealedItem] : undefined
          if (revealedIcon && this.textures.exists(iconKey(revealedIcon))) {
            const icon = this.add.image(view.root.x, view.root.y - 58, iconKey(revealedIcon)).setDisplaySize(20, 20).setDepth(980).setAlpha(1)
            this.tweens.add({ targets: icon, displayWidth: 52, displayHeight: 52, y: icon.y - 40, duration: reducedMotion ? 120 : 260, ease: 'Back.Out' })
            this.tweens.add({ targets: icon, alpha: 0, delay: reducedMotion ? 200 : 520, duration: 300, onComplete: () => icon.destroy() })
          }
          if (raceEvent.type === 'PICKUP_SKIPPED_SLOT_FULL') {
            const full = this.add.text(view.root.x, view.root.y - 48, '🎒 FULL', { color: '#ffffff', backgroundColor: '#a02f50dd', fontFamily: 'sans-serif', fontStyle: 'bold', fontSize: '14px', padding: { x: 7, y: 4 } }).setOrigin(0.5).setDepth(980)
            this.tweens.add({ targets: full, y: full.y - 24, alpha: 0, duration: 650, onComplete: () => full.destroy() })
          }
          if (raceEvent.type === 'DUCK_FINISHED' && focusId) {
            const player = scenePlayers.find((candidate) => candidate.playerId === focusId)
            const finishId = player?.appearance?.finishId
            if (finishId && this.textures.exists(`cosmetic-${finishId}`)) {
              const finish = this.add.image(view.root.x, view.root.y, `cosmetic-${finishId}`).setDisplaySize(130, 130).setDepth(920).setAlpha(1)
              this.tweens.add({ targets: finish, scale: reducedMotion ? 1.15 : 1.8, alpha: 0, duration: reducedMotion ? 250 : 800, onComplete: () => finish.destroy() })
            }
          }
        }

        update(_time: number, delta: number) {
          if (this.pendingWorld) {
            this.applyWorld(this.pendingWorld)
            this.pendingWorld = null
          }
          const smoothing = 1 - Math.exp(-delta / 85)
          const positions: Array<{ x: number; y: number }> = []
          for (const view of this.duckViews.values()) {
            view.root.x += (view.targetX - view.root.x) * smoothing
            view.root.y += (view.targetY - view.root.y) * smoothing
            positions.push({ x: view.root.x, y: view.root.y })
            if (!reducedMotion) {
              // Lean into turns and kick up more foam while boosting.
              const vx = view.root.x - view.lastX
              const vy = view.root.y - view.lastY
              const lean = Math.abs(vx) + Math.abs(vy) > 0.05 ? Phaser.Math.Clamp(Math.atan2(vy, Math.max(0.5, vx)) * 0.55, -0.22, 0.22) : 0
              if (!view.spinning) view.avatarNode.rotation += (lean - view.avatarNode.rotation) * 0.12
              view.wake?.setFrequency(view.boosting ? WAKE_BOOST_MS : WAKE_IDLE_MS)
            }
            view.lastX = view.root.x
            view.lastY = view.root.y
          }
          if (positions.length === 0) return
          const averageX = positions.reduce((sum, point) => sum + point.x, 0) / positions.length
          const averageY = positions.reduce((sum, point) => sum + point.y, 0) / positions.length
          const spread = Math.max(...positions.map((point) => point.x)) - Math.min(...positions.map((point) => point.x))
          const camera = this.cameras.main
          const focus = this.time.now < this.focusUntil && this.focusPlayerId ? this.duckViews.get(this.focusPlayerId) : null
          const targetX = focus?.root.x ?? averageX
          const targetY = focus?.root.y ?? averageY
          const targetZoom = reducedMotion ? 0.82 : focus ? 1.08 : Phaser.Math.Clamp(this.scale.width / Math.max(900, spread + 520), 0.62, 1.08)
          camera.zoom += (targetZoom - camera.zoom) * 0.035
          camera.scrollX += (targetX - this.scale.width / (2 * camera.zoom) - camera.scrollX) * 0.045
          camera.scrollY += (targetY - this.scale.height / (2 * camera.zoom) - camera.scrollY) * 0.045
        }
      }

      const scene = new DuckRaceScene()
      let liveScene: DuckRaceScene | null = null
      void sceneReady.then(() => { liveScene = scene })
      game = new Phaser.Game({
        type: Phaser.AUTO, parent: parentId, backgroundColor: themeBackground, width: mobileViewport ? 720 : 1280, height: mobileViewport ? 720 : 640, scene,
        render: { antialias: true, roundPixels: false },
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
        fps: { target: clientSimConfig ? 60 : 30 },
      })

      const runClientSimulation = (config: RaceConfig, options: { replayMode?: boolean; manualInputs?: RecordedWildItemInput[]; catchUpTick?: number }) => {
        const simulation = createSimulation(config, { manualInputs: options.manualInputs ?? [] })
        const catchUpTick = Math.max(0, options.catchUpTick ?? 0)
        while (simulation.tick < catchUpTick && !simulation.finished) stepSimulation(simulation)

        let previous = performance.now()
        let accumulator = 0
        let eventCount = simulation.events.length
        const tickMs = 1000 / config.tickRate

        const loop = (now: number) => {
          if (!active || simulation.finished) return
          const paused = options.replayMode ? playbackRef.current.paused : false
          const speed = options.replayMode ? playbackRef.current.speed : 1
          if (!paused) {
            accumulator += Math.min(100, now - previous) * speed
            previous = now
            while (accumulator >= tickMs && !simulation.finished) {
              stepSimulation(simulation)
              accumulator -= tickMs
            }
          } else {
            previous = now
          }
          const world = snapshotRaceWorld(simulation)
          const newEvents = simulation.events.slice(eventCount)
          scene.applyWorld(world)
          for (const raceEvent of newEvents) scene.applyEvent(raceEvent)
          eventCount = simulation.events.length
          inspectRef.current?.({ tick: simulation.tick, finished: simulation.finished, ducks: world.ducks, newEvents })
          if (simulation.finished) {
            onLiveFinishedRef.current?.()
          }
          if (!simulation.finished) replayFrame = requestAnimationFrame(loop)
        }

        return {
          simulation,
          start: () => { void sceneReady.then(() => { replayFrame = requestAnimationFrame(loop) }) },
          applySyncEvent: (event: RaceEvent) => {
            if (event.type !== 'WILD_ITEM_MANUAL_INPUT' || event.metadata.applied !== true) return
            const instanceId = event.metadata.instanceId
            const clientActionId = event.metadata.clientActionId
            if (!event.sourcePlayerId || typeof instanceId !== 'string' || typeof clientActionId !== 'string') return
            queueWildItemInput(simulation, {
              raceId: config.raceId,
              playerId: event.sourcePlayerId,
              wildItemInstanceId: instanceId,
              action: 'USE',
              clientActionId,
            }, event.tick)
          },
        }
      }

      if (parsedReplayConfig) {
        const runner = runClientSimulation(parsedReplayConfig, {
          replayMode: true,
          manualInputs: JSON.parse(serializedManualInputs) as RecordedWildItemInput[],
        })
        void sceneReady.then(() => runner.start())
      } else if (parsedLiveConfig) {
        const initialLive = initialLiveRef.current
        const runner = runClientSimulation(parsedLiveConfig, {
          catchUpTick: initialLive?.syncTick ?? 0,
          manualInputs: initialLive?.manualInputs ?? [],
        })
        source = new EventSource(`/api/races/${raceId}/live`)
        source.addEventListener('engine-event', (event) => {
          try {
            const payload = JSON.parse((event as MessageEvent<string>).data) as RaceEvent
            if (payload.type === 'WILD_ITEM_MANUAL_INPUT') runner.applySyncEvent(payload)
            if (payload.type === 'RACE_FINISHED') {
              onLiveFinishedRef.current?.()
            }
          } catch {
            // Ignore malformed sync events.
          }
        })
        source.addEventListener('finished', () => {
          onLiveFinishedRef.current?.()
        })
        void sceneReady.then(() => runner.start())
      } else {
        const visualEventTypes = new Set<RaceEvent['type']>([
          'ROCKET_FIRED', 'ROCKET_HIT', 'ROCKET_BLOCKED', 'BANANA_DROPPED', 'BANANA_HIT', 'BANANA_BLOCKED',
          'NITRO_STARTED', 'HORN_USED', 'FEATHER_DODGED', 'BUBBLE_POPPED', 'PICKUP_COLLECTED', 'PICKUP_SKIPPED_SLOT_FULL',
          'WILD_ITEM_GRANTED', 'INSTANT_PICKUP_TRIGGERED', 'MINI_ROCKET_FIRED', 'MINI_ROCKET_HIT', 'MINI_ROCKET_BLOCKED',
          'WILD_BANANA_DROPPED', 'WILD_BANANA_HIT', 'WILD_BANANA_BLOCKED', 'MINI_BUBBLE_ACTIVATED', 'MINI_BUBBLE_BLOCKED',
          'WILD_HORN_USED', 'WILD_FEATHER_USED', 'WILD_FEATHER_DODGED', 'HAZARD_HIT', 'HAZARD_DODGED', 'GOLDEN_BOX_COLLECTED', 'DUCK_FINISHED',
          'AI_INTENT', 'MOMENTUM_STOLEN', 'GUARD_SURGE',
        ])
        source = new EventSource(`/api/races/${raceId}/live`)
        source.addEventListener('finished', () => {
          onLiveFinishedRef.current?.()
        })
        source.addEventListener('snapshot', (event) => {
          try {
            const payload = JSON.parse((event as MessageEvent<string>).data) as StateSnapshotMessage
            if (payload.type !== 'STATE_SNAPSHOT' || !payload.ducks) return
            if (!liveScene) return
            liveScene.queueWorld(payload, payload.tick)
          } catch {
            // Ignore malformed snapshot frames.
          }
        })
        source.addEventListener('engine-event', (event) => {
          try {
            const payload = JSON.parse((event as MessageEvent<string>).data) as RaceEvent
            if (!payload.type || !visualEventTypes.has(payload.type)) return
            if (!liveScene) return
            liveScene.applyEvent(payload)
          } catch {
            // Ignore malformed engine events.
          }
        })
      }
    })

    return () => {
      active = false
      source?.close()
      if (replayFrame) cancelAnimationFrame(replayFrame)
      game?.destroy(true)
      audio.close()
    }
  }, [chaosType, debugPickups, parentId, raceId, serializedLiveConfig, serializedManualInputs, serializedPlayers, serializedReplayConfig, theme])

  return (
    <div className="overflow-hidden rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-[#2f7a46] shadow-2xl">
      <div id={parentId} className="aspect-[16/9] w-full min-h-[360px] max-h-[640px]" />
    </div>
  )
}
