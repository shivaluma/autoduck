'use client'

import { useEffect, useId, useRef } from 'react'
import type PhaserType from 'phaser'
import { createSimulation, snapshotRaceWorld, stepSimulation } from '@/packages/race-core/src'
import { createRiverTrack } from '@/packages/race-core/src/track'
import { raceEventSchema, stateSnapshotMessageSchema, type DuckSnapshot, type RaceConfig, type RaceEvent, type RaceItemId, type RecordedWildItemInput, type StateSnapshotMessage, type WildItemId } from '@/packages/race-protocol/src'
import { RaceAudioSystem } from './race-audio'
import { COSMETIC_BY_ID } from '@/lib/cosmetics/catalog'
import { COSMETIC_LAYER_ORDER, type DuckAppearance } from '@/lib/cosmetics/types'

type PlayerLabel = { playerId: string; name: string; avatarUrl?: string | null; appearance?: DuckAppearance | null; itemIds?: RaceItemId[] }

const ITEM_ICONS: Record<RaceItemId, string> = {
  BUBBLE_SHIELD: '🫧', HOMING_ROCKET: '🚀', NITRO: '⚡', BANANA: '🍌', FEATHER: '🪶', QUACK_HORN: '🔊',
}

const EFFECT_ICONS: Record<string, string> = { BUBBLE_SHIELD: '🫧', FEATHER: '🪶', NITRO: '⚡', SLOWED: '💫' }
const WILD_ICONS: Record<WildItemId, string> = {
  MINI_NITRO: '⚡', TAILWIND: '🌊', MINI_BUBBLE: '🫧', MINI_ROCKET: '🚀', BANANA: '🍌', QUACK_HORN: '🔊', FEATHER: '🪽', SLIPSTREAM_MAGNET: '🧲',
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
      const track = createRiverTrack(replayConfig?.trackVersion)
      const scenePlayers = JSON.parse(serializedPlayers) as PlayerLabel[]
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const mobileViewport = window.innerWidth < 640
      let markSceneReady: () => void = () => {}
      const sceneReady = new Promise<void>((resolve) => { markSceneReady = resolve })

      class DuckRaceScene extends Phaser.Scene {
        private duckViews = new Map<string, { root: PhaserType.GameObjects.Container; targetX: number; targetY: number; status: PhaserType.GameObjects.Text }>()
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

        queueWorld(world: Pick<StateSnapshotMessage, 'ducks' | 'pickups' | 'hazards' | 'rockets' | 'bananas'>) {
          this.pendingWorld = world
        }

        constructor() { super('duck-race') }

        preload() {
          for (const [key, path] of Object.entries(PICKUP_TEXTURES)) this.load.svg(key, path, { width: 128, height: 128 })
          for (const player of scenePlayers) {
            if (player.avatarUrl) this.load.image(`avatar-${player.playerId}`, player.avatarUrl)
            if (player.appearance) {
              for (const slot of COSMETIC_LAYER_ORDER) {
                const cosmeticId = player.appearance[`${slot}Id` as keyof DuckAppearance]
                const item = cosmeticId ? COSMETIC_BY_ID.get(cosmeticId) : undefined
                if (item && !this.textures.exists(`cosmetic-${item.id}`)) this.load.image(`cosmetic-${item.id}`, item.asset)
              }
            }
          }
        }

        create() {
          this.cameras.main.setBackgroundColor('#112b3b')
          this.cameras.main.setBounds(-250, -850, track.length + 500, 1700)
          this.drawRiver()
          if (debugPickups) this.drawPickupDebug()
          scenePlayers.forEach((player, index) => this.createDuck(player, index))
          const chaosLabel = chaosType ?? replayConfig?.chaosConfig?.type
          this.add.text(18, 16, `${replayConfig ? '↻ REPLAY' : '● LIVE'}${chaosLabel ? ` · 🎴 ${chaosLabel.replaceAll('_', ' ')}` : ''}`, {
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
          if (!replayConfig) this.showCountdown()
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
          const body = this.add.graphics()
          const color = [0xffd83d, 0xffb62e, 0xf7e35c, 0xffca48][index % 4]
          body.fillStyle(0x000000, 0.22).fillEllipse(0, 18, 62, 24)
          body.fillStyle(color, 1).fillEllipse(0, 0, 58, 42).fillCircle(17, -17, 19)
          body.fillStyle(0xff7a28, 1).fillTriangle(33, -18, 52, -11, 33, -7)
          body.fillStyle(0x161126, 1).fillCircle(22, -22, 3.5)
          body.lineStyle(3, 0xffffff, 0.28).strokeEllipse(0, 0, 58, 42)
          const name = this.add.text(0, 37, player.name, {
            color: '#ffffff', fontFamily: 'sans-serif', fontSize: '15px', fontStyle: 'bold', stroke: '#100b20', strokeThickness: 5,
          }).setOrigin(0.5, 0)
          const rank = this.add.text(-33, -34, String(index + 1), {
            color: '#100b20', fontFamily: 'sans-serif', fontSize: '14px', fontStyle: 'bold', backgroundColor: '#ffffffdd', padding: { x: 6, y: 3 },
          }).setOrigin(0.5)
          const loadout = this.add.text(0, -55, (player.itemIds ?? []).map((item) => ITEM_ICONS[item]).join(' '), {
            color: '#ffffff', fontFamily: 'sans-serif', fontSize: '19px', stroke: '#100b20', strokeThickness: 5,
          }).setOrigin(0.5)
          const status = this.add.text(0, 60, '', { color: '#ffffff', fontFamily: 'sans-serif', fontSize: '16px', stroke: '#100b20', strokeThickness: 4 }).setOrigin(0.5)
          const cosmeticLayers = player.appearance ? COSMETIC_LAYER_ORDER.flatMap((slot) => {
            if ((mobileViewport || scenePlayers.length > 12) && ['aura', 'finish'].includes(slot)) return []
            const cosmeticId = player.appearance?.[`${slot}Id` as keyof DuckAppearance]
            const item = cosmeticId ? COSMETIC_BY_ID.get(cosmeticId) : undefined
            return item && this.textures.exists(`cosmetic-${item.id}`)
              ? [this.add.image(0, -1, `cosmetic-${item.id}`).setDisplaySize(94, 94).setData('cosmetic-slot', slot)]
              : []
          }) : []
          for (const layer of cosmeticLayers) {
            const slot = layer.getData('cosmetic-slot')
            if (!reducedMotion && slot === 'pet') this.tweens.add({ targets: layer, y: { from: -3, to: 3 }, duration: 650, yoyo: true, repeat: -1, ease: 'Sine.InOut' })
            if (!reducedMotion && slot === 'aura') this.tweens.add({ targets: layer, alpha: { from: 0.55, to: 1 }, duration: 900, yoyo: true, repeat: -1 })
          }
          if (cosmeticLayers.length > 0) body.setVisible(false)
          const legacyCosmetic = cosmeticLayers.length === 0 && player.avatarUrl && this.textures.exists(`avatar-${player.playerId}`)
            ? this.add.image(-3, -25, `avatar-${player.playerId}`).setDisplaySize(24, 24)
            : cosmeticLayers.length === 0 ? this.add.text(-3, -29, ['🧢', '🎩', '👒', '👑'][index % 4], { fontSize: '19px' }).setOrigin(0.5) : null
          const start = track.sample(0, -0.7 + (index / Math.max(1, scenePlayers.length - 1)) * 1.4)
          const root = this.add.container(start.x, start.y, [body, ...cosmeticLayers, ...(legacyCosmetic ? [legacyCosmetic] : []), name, rank, loadout, status]).setDepth(100 + index)
          root.setData('rank-label', rank)
          this.duckViews.set(player.playerId, { root, targetX: start.x, targetY: start.y, status })
        }

        private showCountdown() {
          const countdown = this.add.text(this.scale.width / 2, this.scale.height / 2, '3', {
            color: '#ffcc00', fontFamily: 'sans-serif', fontSize: '110px', fontStyle: 'bold', stroke: '#100b20', strokeThickness: 12,
          }).setOrigin(0.5).setScrollFactor(0).setDepth(1500)
          const showcase = this.add.text(this.scale.width / 2, this.scale.height / 2 + 105, '', {
            color: '#ffffff', fontFamily: 'sans-serif', fontSize: mobileViewport ? '13px' : '17px', fontStyle: 'bold', align: 'center',
            backgroundColor: '#100b20dd', padding: { x: 14, y: 9 }, stroke: '#100b20', strokeThickness: 2,
          }).setOrigin(0.5).setScrollFactor(0).setDepth(1500)
          let showcaseIndex = 0
          const showPlayer = () => {
            const player = scenePlayers[showcaseIndex % scenePlayers.length]!
            const names = player.appearance ? ['head', 'outfit', 'pet', 'aura'].flatMap((slot) => {
              const id = player.appearance?.[`${slot}Id` as keyof DuckAppearance]
              return id ? [COSMETIC_BY_ID.get(id)?.name].filter(Boolean) : []
            }) : []
            showcase.setText(`${player.name}${names.length ? `\n${names.slice(0, 3).join(' · ')}` : ''}`)
            showcaseIndex += 1
          }
          showPlayer()
          this.time.addEvent({ delay: Math.max(250, 2800 / scenePlayers.length), repeat: scenePlayers.length - 2, callback: showPlayer })
          let value = 3
          this.time.addEvent({ delay: 750, repeat: 3, callback: () => {
            value -= 1
            countdown.setText(value > 0 ? String(value) : 'QUACK!')
            audio.countdown(value <= 0)
            countdown.setScale(1.4).setAlpha(1)
            this.tweens.add({ targets: countdown, scale: 1, duration: 250 })
            if (value < 0) { countdown.destroy(); showcase.destroy() }
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
            const target = world.ducks.find((duck) => duck.playerId === rocket.targetPlayerId)
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

        applyEvent(raceEvent: RaceEvent) {
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
            WILD_FEATHER_USED: `🪽 ${source} bật Feather`,
            WILD_FEATHER_DODGED: `🪽 ${source} DODGED!`,
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
          if (!reducedMotion && ['ROCKET_HIT', 'ROCKET_BLOCKED', 'BANANA_HIT', 'BUBBLE_POPPED', 'MINI_ROCKET_HIT', 'MINI_ROCKET_BLOCKED', 'WILD_BANANA_HIT', 'GOLDEN_BOX_COLLECTED'].includes(raceEvent.type)) {
            this.focusPlayerId = focusId ?? null
            this.focusUntil = this.time.now + 450
          }
          if ((raceEvent.type === 'ROCKET_FIRED' || raceEvent.type === 'MINI_ROCKET_FIRED') && raceEvent.sourcePlayerId && raceEvent.targetPlayerId) {
            const sourceView = this.duckViews.get(raceEvent.sourcePlayerId)
            if (sourceView) {
              const flash = (this.textPool.pop() ?? this.add.text(0, 0, '', { fontSize: '22px' })).setText('🚀').setPosition(sourceView.root.x, sourceView.root.y).setAlpha(1).setVisible(true).setDepth(940)
              this.tweens.add({ targets: flash, y: flash.y - 18, alpha: 0, duration: reducedMotion ? 120 : 280, onComplete: () => { flash.setVisible(false); this.textPool.push(flash) } })
            }
          }
          if (raceEvent.type === 'NITRO_STARTED' || (raceEvent.type === 'INSTANT_PICKUP_TRIGGERED' && raceEvent.metadata.itemId === 'MINI_NITRO')) {
            const wake = (this.ellipsePool.pop() ?? this.add.ellipse(0, 0, 90, 28, 0x9ff5ff, 0.7)).setPosition(view.root.x - 25, view.root.y + 10).setScale(1).setAlpha(0.7).setVisible(true).setDepth(85)
            this.tweens.add({ targets: wake, scaleX: 2.1, alpha: 0, duration: reducedMotion ? 250 : 850, onComplete: () => { wake.setVisible(false); this.ellipsePool.push(wake) } })
          }
          if (raceEvent.type === 'BUBBLE_POPPED' || raceEvent.type === 'HORN_USED' || raceEvent.type === 'MINI_BUBBLE_BLOCKED' || raceEvent.type === 'MINI_BUBBLE_ACTIVATED' || raceEvent.type === 'WILD_HORN_USED') {
            const ring = (this.ringPool.pop() ?? this.add.circle(0, 0, 28, 0x7de8ff, 0.12)).setPosition(view.root.x, view.root.y).setScale(1).setAlpha(1).setVisible(true).setStrokeStyle(5, 0xb8f4ff, 0.9).setDepth(900)
            this.tweens.add({ targets: ring, scale: reducedMotion ? 1.5 : 3, alpha: 0, duration: reducedMotion ? 200 : 500, onComplete: () => { ring.setVisible(false); this.ringPool.push(ring) } })
          }
          if (!reducedMotion && ['ROCKET_HIT', 'BANANA_HIT', 'MINI_ROCKET_HIT', 'WILD_BANANA_HIT', 'HAZARD_HIT'].includes(raceEvent.type)) {
            this.tweens.add({ targets: view.root, angle: { from: -8, to: 8 }, yoyo: true, repeat: 2, duration: 90, onComplete: () => view.root.setAngle(0) })
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
      game = new Phaser.Game({
        type: Phaser.AUTO, parent: parentId, backgroundColor: '#112b3b', width: mobileViewport ? 720 : 1280, height: mobileViewport ? 720 : 640, scene,
        render: { antialias: true, roundPixels: false },
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
        fps: { target: 60 },
      })

      if (replayConfig) {
        const simulation = createSimulation(replayConfig, { manualInputs: JSON.parse(serializedManualInputs) as RecordedWildItemInput[] })
        let previous = performance.now()
        let accumulator = 0
        let replayEventCount = 0
        const tickMs = 1000 / replayConfig.tickRate
        const replay = (now: number) => {
          if (!active || simulation.finished) return
          if (playbackRef.current.paused) {
            previous = now
            replayFrame = requestAnimationFrame(replay)
            return
          }
          accumulator += Math.min(100, now - previous) * playbackRef.current.speed
          previous = now
          while (accumulator >= tickMs && !simulation.finished) {
            stepSimulation(simulation)
            accumulator -= tickMs
          }
          const world = snapshotRaceWorld(simulation)
          const ducks = world.ducks
          const newEvents = simulation.events.slice(replayEventCount)
          scene.applyWorld(world)
          for (const raceEvent of newEvents) scene.applyEvent(raceEvent)
          replayEventCount = simulation.events.length
          inspectRef.current?.({ tick: simulation.tick, finished: simulation.finished, ducks, newEvents })
          if (!simulation.finished) replayFrame = requestAnimationFrame(replay)
        }
        void sceneReady.then(() => { replayFrame = requestAnimationFrame(replay) })
      } else {
        source = new EventSource(`/api/races/${raceId}/live`)
        source.addEventListener('snapshot', (event) => {
          const payload = stateSnapshotMessageSchema.safeParse(JSON.parse((event as MessageEvent<string>).data))
          if (payload.success) void sceneReady.then(() => scene.queueWorld(payload.data))
        })
        source.addEventListener('engine-event', (event) => {
          const raceEvent = raceEventSchema.safeParse(JSON.parse((event as MessageEvent<string>).data))
          if (raceEvent.success) void sceneReady.then(() => scene.applyEvent(raceEvent.data))
        })
      }
    })

    return () => {
      active = false
      source?.close()
      cancelAnimationFrame(replayFrame)
      game?.destroy(true)
      audio.close()
    }
  }, [chaosType, debugPickups, parentId, raceId, replayConfig, serializedManualInputs, serializedPlayers])

  return <div className="overflow-hidden rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-[#112b3b] shadow-[0_8px_0_var(--color-ggd-outline)]">
    <div id={parentId} className="aspect-square min-h-[320px] w-full sm:aspect-[2/1]" aria-label="Đua Dzịt race canvas" />
  </div>
}
