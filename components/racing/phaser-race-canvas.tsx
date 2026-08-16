'use client'

import { useEffect, useId, useRef } from 'react'
import type PhaserType from 'phaser'
import { createSimulation, itemActivationForEvent, queueWildItemInput, snapshotRaceWorld, stepSimulation } from '@/packages/race-core/src'
import { createRiverTrack } from '@/packages/race-core/src/track'
import { type DuckSnapshot, type RaceConfig, type RaceEvent, type RaceItemId, type RecordedWildItemInput, type StateSnapshotMessage, type WildItemId } from '@/packages/race-protocol/src'
import { RaceAudioSystem } from './race-audio'
import { COSMETIC_BY_ID, STARTER_COSMETIC_IDS } from '@/lib/cosmetics/catalog'
import { COSMETIC_LAYER_ORDER, type DuckAppearance } from '@/lib/cosmetics/types'

export type PlayerLabel = {
  playerId: string
  name: string
  avatarUrl?: string | null
  appearance?: DuckAppearance | null
  itemIds?: RaceItemId[]
  isGhost?: boolean
}

const ITEM_ICONS: Record<RaceItemId, string> = {
  BUBBLE_SHIELD: '🫧',
  HOMING_ROCKET: '🚀',
  NITRO: '⚡',
  BANANA: '🍌',
  FEATHER: '🪶',
  QUACK_HORN: '🔊',
  DRAFT_FIN: '🦈',
  PADDLE_BURST: '🛶',
  SHOCK_ABSORBER: '🦺',
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

const PICKUP_TEXTURES = {
  'pickup-QUACK_BOX': '/race-pickups/box-idle.svg',
  'pickup-GOLDEN_BOX': '/race-pickups/golden-box.svg',
  'pickup-CHAOS_BOX': '/race-pickups/chaos-box.svg',
  'hazard-ANCHOR': '/race-pickups/hazard-anchor.svg',
  'hazard-WHIRLPOOL': '/race-pickups/hazard-whirlpool.svg',
  'hazard-ICE_PATCH': '/race-pickups/hazard-ice.svg',
  'hazard-STICKY_GOO': '/race-pickups/hazard-goo.svg',
  'wild-MINI_NITRO': '/race-pickups/item-mini-nitro.svg',
  'wild-TAILWIND': '/race-pickups/item-tailwind.svg',
  'wild-MINI_BUBBLE': '/race-pickups/item-mini-bubble.svg',
  'wild-MINI_ROCKET': '/race-pickups/item-mini-rocket.svg',
  'wild-BANANA': '/race-pickups/item-banana.svg',
  'wild-QUACK_HORN': '/race-pickups/item-quack-horn.svg',
  'wild-FEATHER': '/race-pickups/item-feather.svg',
  'wild-SLIPSTREAM_MAGNET': '/race-pickups/item-magnet.svg',
} as const

const DUCK_THEME_PRESETS: DuckAppearance[] = [
  {
    bodyColorId: 'body-sunshine',
    headId: 'head-tiny-crown',
    faceId: 'face-happy',
    outfitId: 'outfit-quack-knight',
    bodySkinId: 'bodySkin-gold-veins',
    petId: 'pet-corgi-pup',
    auraId: 'aura-golden-rays',
    trailId: 'trail-golden-water',
  },
  {
    bodyColorId: 'body-mint',
    headId: 'head-bamboo-hat',
    faceId: 'face-happy',
    outfitId: 'outfit-lucky-ao-dai',
    bodySkinId: 'bodySkin-lotus-speckles',
    petId: 'pet-calico-cat',
    auraId: 'aura-lotus-breeze',
    trailId: 'trail-lotus-petals',
  },
  {
    bodyColorId: 'body-cyber-cyan',
    headId: 'head-cyber-mohawk',
    faceId: 'face-laser-visor',
    outfitId: 'outfit-cyber-samurai',
    bodySkinId: 'bodySkin-neon-scales',
    petId: 'pet-tiny-drone',
    auraId: 'aura-neon-glitch',
    trailId: 'trail-neon-wake',
  },
  {
    bodyColorId: 'body-ruby',
    headId: 'head-dragon-horns',
    faceId: 'face-happy',
    outfitId: 'outfit-racing-suit',
    bodySkinId: 'bodySkin-dragon-scale',
    petId: 'pet-baby-dragon',
    auraId: 'aura-dragon-flame',
    trailId: 'trail-dragon-sparks',
  },
  {
    bodyColorId: 'body-midnight',
    headId: 'head-space-dome',
    faceId: 'face-happy',
    outfitId: 'outfit-space-suit',
    bodySkinId: 'bodySkin-galaxy-dust',
    petId: 'pet-moon-rabbit',
    auraId: 'aura-space-dust',
    trailId: 'trail-moon-dust',
  },
  {
    bodyColorId: 'body-sky',
    headId: 'head-office-headset',
    faceId: 'face-office-burnout',
    outfitId: 'outfit-office-tie',
    bodySkinId: 'bodySkin-coffee-stains',
    petId: 'pet-office-mouse',
    auraId: 'aura-coffee-steam',
    trailId: 'trail-coffee-spill',
  },
  {
    bodyColorId: 'body-tangerine',
    headId: 'head-cap-red',
    faceId: 'face-shades',
    outfitId: 'outfit-tee-white',
    bodySkinId: 'bodySkin-tiger-quack',
    petId: 'pet-shiba-inu',
    auraId: 'aura-fireflies',
    trailId: 'trail-ripples',
  },
  {
    bodyColorId: 'body-lavender',
    headId: 'head-wizard-hat',
    faceId: 'face-happy',
    outfitId: 'outfit-dev-hoodie',
    bodySkinId: 'bodySkin-galaxy-dust',
    petId: 'pet-mini-capybara',
    auraId: 'aura-pixel-orbit',
    trailId: 'trail-pixel-stream',
  },
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
  chaosType,
  debugPickups = false,
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
  chaosType?: string
  debugPickups?: boolean
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

  useEffect(() => {
    playbackRef.current = { speed: replaySpeed, paused: replayPaused }
  }, [replayPaused, replaySpeed])

  useEffect(() => {
    inspectRef.current = onReplayInspect
  }, [onReplayInspect])

  useEffect(() => {
    let active = true
    let game: PhaserType.Game | null = null
    let source: EventSource | null = null
    let replayFrame = 0
    const audio = new RaceAudioSystem()

    void import('phaser').then((module) => {
      if (!active) return
      const Phaser = module.default
      const parsedLiveConfig = serializedLiveConfig !== 'null' ? JSON.parse(serializedLiveConfig) as RaceConfig : null
      const parsedReplayConfig = serializedReplayConfig !== 'null' ? JSON.parse(serializedReplayConfig) as RaceConfig : null
      const clientSimConfig = parsedReplayConfig ?? parsedLiveConfig
      const track = createRiverTrack(clientSimConfig?.trackVersion ?? parsedReplayConfig?.trackVersion)
      const scenePlayers = JSON.parse(serializedPlayers) as PlayerLabel[]
      const reducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const mobileViewport = typeof window !== 'undefined' && window.innerWidth < 640
      let markSceneReady: () => void = () => {}
      const sceneReady = new Promise<void>((resolve) => { markSceneReady = resolve })

      class DuckRaceScene extends Phaser.Scene {
        private duckViews = new Map<string, {
          root: PhaserType.GameObjects.Container
          avatarNode: PhaserType.GameObjects.Container
          shieldBubble: PhaserType.GameObjects.Arc
          boostFlame: PhaserType.GameObjects.Container
          dizzyStars: PhaserType.GameObjects.Text
          targetX: number
          targetY: number
          status: PhaserType.GameObjects.Text
          loadoutIcons: Map<RaceItemId, PhaserType.GameObjects.Text>
        }>()
        private leaderboard!: PhaserType.GameObjects.Text
        private eventFeed!: PhaserType.GameObjects.Text
        private recentEvents: string[] = []
        private textPool: PhaserType.GameObjects.Text[] = []
        private ellipsePool: PhaserType.GameObjects.Ellipse[] = []
        private ringPool: PhaserType.GameObjects.Arc[] = []
        private pickupViews = new Map<string, PhaserType.GameObjects.Container>()
        private hazardViews = new Map<string, PhaserType.GameObjects.Image>()
        private rocketViews = new Map<number, PhaserType.GameObjects.Text>()
        private bananaViews = new Map<number, PhaserType.GameObjects.Text>()
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
          for (const [key, path] of Object.entries(PICKUP_TEXTURES)) {
            this.load.svg(key, path, { width: 128, height: 128 })
          }

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
            if (player.avatarUrl) this.load.image(`avatar-${player.playerId}`, player.avatarUrl)
            const app = resolveDuckAppearance(player, index)
            for (const slot of COSMETIC_LAYER_ORDER) {
              const id = app[`${slot}Id` as keyof DuckAppearance]
              if (id) cosmeticsToLoad.add(id)
            }
          }

          for (const cosmeticId of cosmeticsToLoad) {
            const item = COSMETIC_BY_ID.get(cosmeticId)
            if (item && !this.textures.exists(`cosmetic-${item.id}`)) {
              this.load.svg(`cosmetic-${item.id}`, item.asset, { width: 512, height: 512 })
            }
          }
        }

        create() {
          this.cameras.main.setBackgroundColor('#112b3b')
          this.cameras.main.setBounds(-250, -850, track.length + 500, 1700)
          this.drawRiver()
          if (debugPickups) this.drawPickupDebug()
          scenePlayers.forEach((player, index) => this.createDuck(player, index))
          const chaosLabel = chaosType ?? clientSimConfig?.chaosConfig?.type
          this.add.text(18, 16, `${replayConfig ? '↻ REPLAY' : clientSimConfig ? '● LIVE' : '● LIVE'}${chaosLabel ? ` · 🎴 ${chaosLabel.replaceAll('_', ' ')}` : ''}`, {
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
          const water = this.add.graphics()
          water.fillStyle(0x2388b8, 1).lineStyle(8, 0x77d9e8, 0.8).beginPath()
          for (let index = 0; index <= 180; index += 1) {
            const point = track.sample(index / 180, -1)
            if (index === 0) water.moveTo(point.x, point.y)
            else water.lineTo(point.x, point.y)
          }
          for (let index = 180; index >= 0; index -= 1) {
            const point = track.sample(index / 180, 1)
            water.lineTo(point.x, point.y)
          }
          water.closePath().fillPath().strokePath()

          const currents = this.add.graphics().setAlpha(0.24).lineStyle(4, 0xb8f4ff, 1)
          for (let lane = -2; lane <= 2; lane += 1) {
            currents.beginPath()
            for (let index = 0; index <= 100; index += 1) {
              const point = track.sample(index / 100, lane * 0.22)
              if (index === 0) currents.moveTo(point.x, point.y)
              else currents.lineTo(point.x, point.y)
            }
            currents.strokePath()
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

          // 1. Subtle water wake below duck
          const waterWake = this.add.ellipse(-8, 16, 56, 18, 0x8be5ff, 0.35)

          // 2. Avatar Container with all cosmetic layers in exact COSMETIC_LAYER_ORDER
          const cosmeticLayers: PhaserType.GameObjects.Image[] = []
          for (const slot of COSMETIC_LAYER_ORDER) {
            if ((mobileViewport || scenePlayers.length > 12) && ['finish'].includes(slot)) continue
            const cosmeticId = appearance[`${slot}Id` as keyof DuckAppearance]
            const item = cosmeticId ? COSMETIC_BY_ID.get(cosmeticId) : undefined
            if (item && this.textures.exists(`cosmetic-${item.id}`)) {
              const img = this.add.image(0, 0, `cosmetic-${item.id}`)
                .setDisplaySize(duckDisplaySize, duckDisplaySize)
                .setData('cosmetic-slot', slot)
              cosmeticLayers.push(img)

              if (!reducedMotion) {
                if (slot === 'aura') {
                  this.tweens.add({
                    targets: img,
                    alpha: { from: 0.65, to: 0.95 },
                    duration: 900,
                    yoyo: true,
                    repeat: -1,
                    ease: 'Sine.InOut',
                  })
                }
              }
            }
          }

          const avatarNode = this.add.container(0, 0, cosmeticLayers)

          // 3. Dynamic Effect Overlays
          const shieldBubble = this.add.circle(0, -2, 46, 0x67e8f9, 0.22)
            .setStrokeStyle(3, 0x38bdf8, 0.85)
            .setVisible(false)

          const boostFlame = this.add.container(-38, 4, [
            this.add.ellipse(0, 0, 42, 14, 0xffd84d, 0.6),
            this.add.text(-4, -9, '⚡', { fontSize: '18px' }),
          ]).setVisible(false)

          const dizzyStars = this.add.text(0, -42, '💫', { fontSize: '20px' })
            .setOrigin(0.5)
            .setVisible(false)
          if (!reducedMotion) {
            this.tweens.add({
              targets: dizzyStars,
              angle: 360,
              duration: 1200,
              repeat: -1,
            })
          }

          // 4. Name tag, Rank badge, Loadout icons, Status text
          const name = this.add.text(0, 42, player.name, {
            color: '#ffffff',
            fontFamily: 'sans-serif',
            fontSize: '15px',
            fontStyle: 'bold',
            stroke: '#100b20',
            strokeThickness: 5,
          }).setOrigin(0.5, 0)

          const rank = this.add.text(-34, -34, String(index + 1), {
            color: '#100b20',
            fontFamily: 'sans-serif',
            fontSize: '14px',
            fontStyle: 'bold',
            backgroundColor: '#ffffffdd',
            padding: { x: 6, y: 3 },
          }).setOrigin(0.5)

          const loadoutItemIds = player.itemIds ?? []
          const loadoutIcons = new Map<RaceItemId, PhaserType.GameObjects.Text>()
          const loadoutSpacing = 22
          const loadoutStartX = loadoutItemIds.length > 1 ? -loadoutSpacing / 2 : 0
          const loadoutNodes = loadoutItemIds.map((itemId, itemIndex) => {
            const icon = this.add.text(loadoutStartX + itemIndex * loadoutSpacing, -55, ITEM_ICONS[itemId], {
              color: '#ffffff',
              fontFamily: 'sans-serif',
              fontSize: '19px',
              stroke: '#100b20',
              strokeThickness: 5,
            }).setOrigin(0.5)
            loadoutIcons.set(itemId, icon)
            return icon
          })

          const status = this.add.text(0, 64, '', {
            color: '#ffffff',
            fontFamily: 'sans-serif',
            fontSize: '16px',
            stroke: '#100b20',
            strokeThickness: 4,
          }).setOrigin(0.5)

          const start = track.sample(0, -0.7 + (index / Math.max(1, scenePlayers.length - 1)) * 1.4)
          const root = this.add.container(start.x, start.y, [
            waterWake,
            avatarNode,
            shieldBubble,
            boostFlame,
            dizzyStars,
            name,
            rank,
            ...loadoutNodes,
            status,
          ]).setDepth(100 + index)

          if (player.isGhost) {
            root.setAlpha(0.58)
            name.setText(`👻 ${player.name}`)
          }
          root.setData('rank-label', rank)

          this.duckViews.set(player.playerId, {
            root,
            avatarNode,
            shieldBubble,
            boostFlame,
            dizzyStars,
            targetX: start.x,
            targetY: start.y,
            status,
            loadoutIcons,
          })
        }

        private markPrepItemUsed(playerId: string, itemId: RaceItemId) {
          const icon = this.duckViews.get(playerId)?.loadoutIcons.get(itemId)
          if (!icon || icon.alpha <= 0.35) return
          icon.setAlpha(0.28)
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
            ;(view.root.getData('rank-label') as PhaserType.GameObjects.Text).setText(String(duck.rank))
            const wild = duck.wildItem ? `🎒${WILD_ICONS[duck.wildItem.itemId]}` : ''
            view.status.setText([wild, ...duck.activeEffects.map((effect) => EFFECT_ICONS[effect] ?? WILD_ICONS[effect as WildItemId] ?? '')].filter(Boolean).join(' '))
            view.root.setDepth(100 + scenePlayers.length - duck.rank)

            // Dynamic Effect Visibility
            const hasShield = duck.activeEffects.includes('BUBBLE_SHIELD') || duck.activeEffects.includes('MINI_BUBBLE')
            view.shieldBubble.setVisible(hasShield)

            const hasBoost = duck.activeEffects.some((e) => ['NITRO', 'MINI_NITRO', 'TAILWIND', 'DRAFT_FIN', 'PADDLE_BURST'].includes(e))
            view.boostFlame.setVisible(hasBoost)

            const hasSlow = duck.activeEffects.includes('SLOWED')
            view.dizzyStars.setVisible(hasSlow)
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
            const beam = pickup.type === 'GOLDEN_BOX' ? this.add.rectangle(0, -70, 18, 150, 0xffe66d, 0.18) : null
            const image = this.add.image(0, 0, `pickup-${pickup.type}`).setDisplaySize(pickup.type === 'GOLDEN_BOX' ? 62 : 52, pickup.type === 'GOLDEN_BOX' ? 62 : 52)
            const view = this.add.container(point.x, point.y, [...(beam ? [beam] : []), image]).setDepth(72)
            if (!reducedMotion) this.tweens.add({ targets: view, y: point.y - 7, angle: { from: -5, to: 5 }, duration: pickup.type === 'GOLDEN_BOX' ? 620 : 900, yoyo: true, repeat: -1, ease: 'Sine.InOut' })
            this.pickupViews.set(pickup.id, view)
          }
          for (const [pickupId, view] of this.pickupViews) {
            if (activeIds.has(pickupId)) continue
            this.pickupViews.delete(pickupId)
            this.tweens.killTweensOf(view)
            this.tweens.add({ targets: view, scale: reducedMotion ? 1.1 : 1.55, alpha: 0, duration: reducedMotion ? 120 : 360, onComplete: () => view.destroy() })
          }
          for (const hazard of world.hazards) {
            if (this.hazardViews.has(hazard.id)) continue
            const point = track.sample(hazard.progress, hazard.lateralOffset)
            const image = this.add.image(point.x, point.y, `hazard-${hazard.type}`).setDisplaySize(hazard.type === 'WHIRLPOOL' ? 76 : 58, hazard.type === 'WHIRLPOOL' ? 76 : 58).setDepth(68)
            if (!reducedMotion && hazard.type === 'WHIRLPOOL') this.tweens.add({ targets: image, angle: 360, duration: 1800, repeat: -1 })
            this.hazardViews.set(hazard.id, image)
          }
          const rocketIds = new Set(world.rockets.map((rocket) => rocket.id))
          for (const rocket of world.rockets) {
            const target = duckById.get(rocket.targetPlayerId)
            const point = track.sample(Math.min(0.999, rocket.progress), target?.lateralOffset ?? 0)
            const view = this.rocketViews.get(rocket.id) ?? this.add.text(point.x, point.y, '🚀', { fontSize: '28px' }).setDepth(950)
            view.setPosition(point.x, point.y).setVisible(true)
            this.rocketViews.set(rocket.id, view)
          }
          for (const [rocketId, view] of this.rocketViews) {
            if (rocketIds.has(rocketId)) continue
            this.rocketViews.delete(rocketId)
            view.setVisible(false)
            this.textPool.push(view)
          }
          const bananaIds = new Set(world.bananas.map((banana) => banana.id))
          for (const banana of world.bananas) {
            const point = track.sample(banana.progress, banana.lateralOffset)
            const view = this.bananaViews.get(banana.id) ?? this.add.text(point.x, point.y, '🍌', { fontSize: '26px' }).setDepth(80)
            view.setPosition(point.x, point.y).setVisible(true).setAlpha(1)
            this.bananaViews.set(banana.id, view)
          }
          for (const [bananaId, view] of this.bananaViews) {
            if (bananaIds.has(bananaId)) continue
            this.bananaViews.delete(bananaId)
            view.setVisible(false)
            this.textPool.push(view)
          }
        }

        private duckView(playerId?: string | null) {
          return playerId ? this.duckViews.get(playerId) ?? null : null
        }

        private focusCamera(playerId: string, duration = 450) {
          this.focusPlayerId = playerId
          this.focusUntil = this.time.now + duration
        }

        private floatEmoji(x: number, y: number, emoji: string, fontSize = '22px', duration = 320) {
          const label = (this.textPool.pop() ?? this.add.text(0, 0, '', { fontSize, fontFamily: 'sans-serif' })).setText(emoji).setPosition(x, y).setAlpha(1).setVisible(true).setDepth(940)
          this.tweens.add({
            targets: label,
            y: y - 24,
            alpha: 0,
            duration: reducedMotion ? Math.min(duration, 180) : duration,
            onComplete: () => { label.setVisible(false); this.textPool.push(label) },
          })
        }

        private burstRing(x: number, y: number, strokeColor: number, fillColor = strokeColor, fillAlpha = 0.14, maxScale = 3) {
          const ring = (this.ringPool.pop() ?? this.add.circle(0, 0, 28, fillColor, fillAlpha)).setPosition(x, y).setScale(1).setAlpha(1).setVisible(true).setStrokeStyle(5, strokeColor, 0.9).setDepth(900)
          this.tweens.add({
            targets: ring,
            scale: reducedMotion ? 1.5 : maxScale,
            alpha: 0,
            duration: reducedMotion ? 200 : 480,
            onComplete: () => { ring.setVisible(false); this.ringPool.push(ring) },
          })
        }

        private trackPoint(progress?: unknown, lateralOffset?: unknown) {
          if (typeof progress !== 'number') return null
          return track.sample(progress, typeof lateralOffset === 'number' ? lateralOffset : 0)
        }

        private playHornEffect(raceEvent: RaceEvent) {
          const sourceView = this.duckView(raceEvent.sourcePlayerId)
          if (sourceView) {
            this.burstRing(sourceView.root.x, sourceView.root.y, 0xffe08a, 0xffe08a, 0.14, 3.4)
            this.floatEmoji(sourceView.root.x, sourceView.root.y - 8, '🔊', '24px', 360)
          }
          if (raceEvent.sourcePlayerId) this.focusCamera(raceEvent.sourcePlayerId, 420)
        }

        private playActionEffects(raceEvent: RaceEvent) {
          const type = raceEvent.type
          const source = this.duckView(raceEvent.sourcePlayerId)
          const target = this.duckView(raceEvent.targetPlayerId)

          if (type === 'HORN_USED' || type === 'WILD_HORN_USED') {
            this.playHornEffect(raceEvent)
            return
          }

          if (type === 'ROCKET_FIRED' || type === 'MINI_ROCKET_FIRED') {
            if (source) this.floatEmoji(source.root.x, source.root.y - 10, '🚀', '24px', 280)
            if (source && target) {
              const trail = this.add.graphics().setDepth(930)
              trail.lineStyle(4, 0xff8844, 0.85).lineBetween(source.root.x, source.root.y, target.root.x, target.root.y)
              this.tweens.add({ targets: trail, alpha: 0, duration: reducedMotion ? 120 : 260, onComplete: () => trail.destroy() })
            }
            if (raceEvent.sourcePlayerId) this.focusCamera(raceEvent.sourcePlayerId, 380)
            return
          }

          if (type === 'ROCKET_HIT' || type === 'MINI_ROCKET_HIT') {
            const hitView = target ?? source
            if (hitView) {
              this.burstRing(hitView.root.x, hitView.root.y, 0xff5a4a, 0xff5a4a, 0.18, 3.2)
              this.floatEmoji(hitView.root.x, hitView.root.y - 12, '💥', '26px', 420)
            }
            if (raceEvent.targetPlayerId) this.focusCamera(raceEvent.targetPlayerId, 520)
            return
          }

          if (type === 'ROCKET_BLOCKED' || type === 'MINI_ROCKET_BLOCKED') {
            const blockView = target ?? source
            if (blockView) {
              this.burstRing(blockView.root.x, blockView.root.y, 0x7de8ff, 0x7de8ff, 0.2, 2.6)
              this.floatEmoji(blockView.root.x, blockView.root.y - 10, '🫧', '24px')
            }
            if (raceEvent.targetPlayerId) this.focusCamera(raceEvent.targetPlayerId, 400)
            return
          }

          if (type === 'BANANA_DROPPED' || type === 'WILD_BANANA_DROPPED') {
            const point = this.trackPoint(raceEvent.metadata.progress, raceEvent.metadata.lateralOffset) ?? (source ? { x: source.root.x, y: source.root.y } : null)
            if (point) {
              this.floatEmoji(point.x, point.y, '🍌', '28px', 500)
              this.burstRing(point.x, point.y, 0xffe66d, 0xffe66d, 0.1, 2.2)
            }
            if (raceEvent.sourcePlayerId) this.focusCamera(raceEvent.sourcePlayerId, 350)
            return
          }

          if (type === 'BANANA_HIT' || type === 'WILD_BANANA_HIT') {
            if (target) {
              this.floatEmoji(target.root.x, target.root.y - 8, '💫', '24px', 480)
              this.burstRing(target.root.x, target.root.y, 0xffe08a, 0xffe08a, 0.14, 2.8)
            }
            if (raceEvent.targetPlayerId) this.focusCamera(raceEvent.targetPlayerId, 480)
            return
          }

          if (type === 'BANANA_BLOCKED' || type === 'WILD_BANANA_BLOCKED') {
            if (target) this.floatEmoji(target.root.x, target.root.y - 10, '🪽', '22px')
            return
          }

          if (type === 'NITRO_STARTED' || (type === 'INSTANT_PICKUP_TRIGGERED' && raceEvent.metadata.itemId === 'MINI_NITRO')) {
            if (source) {
              for (let index = 0; index < 3; index += 1) {
                const wake = (this.ellipsePool.pop() ?? this.add.ellipse(0, 0, 80, 22, 0x9ff5ff, 0.65)).setPosition(source.root.x - 22 - index * 10, source.root.y + 8).setAlpha(0.65).setVisible(true).setDepth(85)
                this.tweens.add({ targets: wake, scaleX: 2.2 + index * 0.2, alpha: 0, duration: reducedMotion ? 200 : 600 + index * 80, onComplete: () => { wake.setVisible(false); this.ellipsePool.push(wake) } })
              }
              this.floatEmoji(source.root.x, source.root.y - 16, '⚡', '26px', 520)
            }
            if (raceEvent.sourcePlayerId) this.focusCamera(raceEvent.sourcePlayerId, 420)
            return
          }

          if (type === 'INSTANT_PICKUP_TRIGGERED' && raceEvent.metadata.itemId === 'TAILWIND') {
            if (source) this.floatEmoji(source.root.x, source.root.y - 12, '🌊', '24px', 480)
            return
          }

          if (type === 'INSTANT_PICKUP_TRIGGERED' && raceEvent.metadata.itemId === 'SLIPSTREAM_MAGNET') {
            if (source) {
              this.floatEmoji(source.root.x, source.root.y - 12, '🧲', '22px', 420)
              this.burstRing(source.root.x, source.root.y, 0xb8f4ff, 0x55d4ff, 0.12, 2.3)
            }
            return
          }

          if (type === 'BUBBLE_POPPED' || type === 'MINI_BUBBLE_BLOCKED') {
            const bubbleView = source ?? target
            if (bubbleView) {
              this.burstRing(bubbleView.root.x, bubbleView.root.y, 0xb8f4ff, 0x7de8ff, 0.22, 3)
              this.floatEmoji(bubbleView.root.x, bubbleView.root.y - 10, '💧', '18px', 360)
            }
            return
          }

          if (type === 'MINI_BUBBLE_ACTIVATED') {
            if (source) {
              this.burstRing(source.root.x, source.root.y, 0xb8f4ff, 0x7de8ff, 0.16, 2.4)
              this.floatEmoji(source.root.x, source.root.y - 14, '🫧', '22px')
            }
            return
          }

          if (type === 'FEATHER_DODGED' || type === 'WILD_FEATHER_DODGED' || type === 'HAZARD_DODGED') {
            if (source) {
              this.floatEmoji(source.root.x, source.root.y - 18, '🪽', '24px', 520)
            }
            return
          }

          if (type === 'WILD_FEATHER_USED' && source) {
            this.floatEmoji(source.root.x, source.root.y - 14, '🪽', '22px')
            this.burstRing(source.root.x, source.root.y, 0xd8c7ff, 0xd8c7ff, 0.12, 2.2)
            return
          }

          if (type === 'HAZARD_HIT' && source) {
            const hazardEmoji = ({ ANCHOR: '⚓', WHIRLPOOL: '🌀', ICE_PATCH: '🧊', STICKY_GOO: '🟢' } as Record<string, string>)[String(raceEvent.metadata.hazardType)] ?? '☠️'
            this.floatEmoji(source.root.x, source.root.y - 10, hazardEmoji, '26px', 460)
            this.burstRing(source.root.x, source.root.y, 0x9bd4ff, 0x4a90a4, 0.16, 2.6)
            if (raceEvent.sourcePlayerId) this.focusCamera(raceEvent.sourcePlayerId, 460)
            return
          }

          if (type === 'PICKUP_COLLECTED' || type === 'WILD_ITEM_GRANTED') {
            if (source) {
              this.burstRing(source.root.x, source.root.y, 0x9ff5ff, 0x55d4ff, 0.14, 2.4)
              const itemIcon = type === 'WILD_ITEM_GRANTED' ? (WILD_ICONS[raceEvent.metadata.itemId as WildItemId] ?? '🎒') : '📦'
              this.floatEmoji(source.root.x, source.root.y - 14, itemIcon, '24px', 560)
            }
            return
          }

          if (type === 'GOLDEN_BOX_COLLECTED' && source) {
            this.burstRing(source.root.x, source.root.y, 0xffe66d, 0xffcc00, 0.24, 3.6)
            this.floatEmoji(source.root.x, source.root.y - 16, '🪙', '30px', 720)
            if (!reducedMotion) {
              for (let index = 0; index < 4; index += 1) {
                this.time.delayedCall(index * 70, () => this.floatEmoji(source.root.x + (index - 2) * 14, source.root.y - 8, '✨', '16px', 400))
              }
            }
            if (raceEvent.sourcePlayerId) this.focusCamera(raceEvent.sourcePlayerId, 620)
            return
          }

          if (type === 'DUCK_FINISHED' && source) {
            this.finishCelebrationCount += 1
            const place = this.finishCelebrationCount
            const medals = ['🏆', '🥈', '🥉'] as const
            const medal = place <= 3 ? medals[place - 1] : '🏁'
            const ringColor = place === 1 ? 0xffd700 : place === 2 ? 0xdde4ee : place === 3 ? 0xffa45b : 0xffffff
            this.burstRing(source.root.x, source.root.y, ringColor, ringColor, place <= 3 ? 0.22 : 0.1, place === 1 ? 4 : 2.8)
            this.floatEmoji(source.root.x, source.root.y - 20, medal, place === 1 ? '34px' : '28px', place === 1 ? 900 : 620)
            this.floatEmoji(source.root.x, source.root.y - 46, `#${place}`, place === 1 ? '22px' : '18px', 520)
            if (raceEvent.sourcePlayerId) this.focusCamera(raceEvent.sourcePlayerId, place === 1 ? 900 : place <= 3 ? 620 : 380)
          }
        }

        applyEvent(raceEvent: RaceEvent) {
          const activation = itemActivationForEvent(raceEvent)
          if (activation) this.markPrepItemUsed(activation.playerId, activation.itemId)

          const source = scenePlayers.find((player) => player.playerId === raceEvent.sourcePlayerId)?.name
          const target = scenePlayers.find((player) => player.playerId === raceEvent.targetPlayerId)?.name
          const messages: Partial<Record<RaceEvent['type'], string>> = {
            ROCKET_FIRED: `🚀 ${source} → ${target}`,
            ROCKET_HIT: `💥 ${target} trúng Rocket!`,
            ROCKET_BLOCKED: `🫧 ${target} BLOCKED!`,
            BANANA_DROPPED: `🍌 ${source} thả Banana`,
            BANANA_HIT: `🍌 ${target} trượt vỏ chuối!`,
            BANANA_BLOCKED: `🛡️ ${target} né được Banana`,
            NITRO_STARTED: `⚡ ${source} NITRO!`,
            DRAFT_FIN_STARTED: `🦈 ${source} DRAFT!`,
            PADDLE_BURST_STARTED: `🛶 ${source} PADDLE BURST!`,
            BOOST_BROKEN: `💥 ${target} BOOST BROKEN!`,
            SHOCK_ABSORBER_PROC: `🦺 ${target} absorbed hit`,
            HORN_USED: `🔊 ${source} QUACKED THE PACK`,
            FEATHER_DODGED: `🪶 ${source} DODGED!`,
            BUBBLE_POPPED: `🫧 ${source} POP!`,
            PICKUP_COLLECTED: `📦 ${source} mở Quack Box`,
            PICKUP_SKIPPED_SLOT_FULL: `🎒 ${source} đang FULL`,
            WILD_ITEM_GRANTED: `${WILD_ICONS[raceEvent.metadata.itemId as WildItemId] ?? '🎒'} ${source} nhặt ${String(raceEvent.metadata.itemId ?? '').replaceAll('_', ' ')}`,
            INSTANT_PICKUP_TRIGGERED: `${WILD_ICONS[raceEvent.metadata.itemId as WildItemId] ?? '⚡'} ${source} kích hoạt ${String(raceEvent.metadata.itemId ?? '').replaceAll('_', ' ')}`,
            MINI_ROCKET_FIRED: `🚀 ${source} → ${target}`,
            MINI_ROCKET_HIT: `💥 ${target} trúng Mini Rocket!`,
            MINI_ROCKET_BLOCKED: `🫧 ${target} BLOCKED!`,
            WILD_BANANA_DROPPED: `🍌 ${source} thả Wild Banana`,
            WILD_BANANA_HIT: `🍌 ${target} đụng Banana!`,
            WILD_BANANA_BLOCKED: `🪽 ${target} né Banana`,
            MINI_BUBBLE_ACTIVATED: `🫧 ${source} bật Mini Bubble`,
            MINI_BUBBLE_BLOCKED: `🫧 ${source} BLOCKED!`,
            WILD_HORN_USED: `🔊 ${source} QUACK!`,
            WILD_FEATHER_USED: `🪽 ${source} Feather Hop`,
            WILD_FEATHER_DODGED: `🪽 ${source} Feather Hop DODGED!`,
            HAZARD_HIT: `☠️ ${source} đụng ${String(raceEvent.metadata.hazardType ?? 'hazard').replaceAll('_', ' ')}`,
            HAZARD_DODGED: `🪽 ${source} né hazard!`,
            GOLDEN_BOX_COLLECTED: `🪙 ${source} FOUND THE GOLDEN BOX!`,
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
          if (revealedItem && this.textures.exists(`wild-${revealedItem}`)) {
            const icon = this.add.image(view.root.x, view.root.y - 58, `wild-${revealedItem}`).setDisplaySize(46, 46).setDepth(980).setAlpha(1)
            this.tweens.add({ targets: icon, y: icon.y - 34, alpha: 0, duration: reducedMotion ? 300 : 720, onComplete: () => icon.destroy() })
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
        type: Phaser.AUTO, parent: parentId, backgroundColor: '#112b3b', width: mobileViewport ? 720 : 1280, height: mobileViewport ? 720 : 640, scene,
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
          } catch {
            // Ignore malformed sync events.
          }
        })
        void sceneReady.then(() => runner.start())
      } else {
        const visualEventTypes = new Set<RaceEvent['type']>([
          'ROCKET_FIRED', 'ROCKET_HIT', 'ROCKET_BLOCKED', 'BANANA_DROPPED', 'BANANA_HIT', 'BANANA_BLOCKED',
          'NITRO_STARTED', 'HORN_USED', 'FEATHER_DODGED', 'BUBBLE_POPPED', 'PICKUP_COLLECTED', 'PICKUP_SKIPPED_SLOT_FULL',
          'WILD_ITEM_GRANTED', 'INSTANT_PICKUP_TRIGGERED', 'MINI_ROCKET_FIRED', 'MINI_ROCKET_HIT', 'MINI_ROCKET_BLOCKED',
          'WILD_BANANA_DROPPED', 'WILD_BANANA_HIT', 'WILD_BANANA_BLOCKED', 'MINI_BUBBLE_ACTIVATED', 'MINI_BUBBLE_BLOCKED',
          'WILD_HORN_USED', 'WILD_FEATHER_USED', 'WILD_FEATHER_DODGED', 'HAZARD_HIT', 'HAZARD_DODGED', 'GOLDEN_BOX_COLLECTED', 'DUCK_FINISHED',
        ])
        source = new EventSource(`/api/races/${raceId}/live`)
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
  }, [chaosType, debugPickups, parentId, raceId, serializedLiveConfig, serializedManualInputs, serializedPlayers, serializedReplayConfig])

  return (
    <div className="overflow-hidden rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-[#112b3b] shadow-2xl">
      <div id={parentId} className="aspect-[16/9] w-full min-h-[360px] max-h-[640px]" />
    </div>
  )
}
