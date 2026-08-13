'use client'

import { useEffect, useId } from 'react'
import type PhaserType from 'phaser'
import { createSimulation, snapshotSimulation, stepSimulation } from '@/packages/race-core/src'
import { createRiverTrack } from '@/packages/race-core/src/track'
import type { DuckSnapshot, RaceConfig, RaceEvent, RaceItemId } from '@/packages/race-protocol/src'

type PlayerLabel = { playerId: string; name: string; itemIds?: RaceItemId[] }

const ITEM_ICONS: Record<RaceItemId, string> = {
  BUBBLE_SHIELD: '🫧', HOMING_ROCKET: '🚀', NITRO: '⚡', BANANA: '🍌', FEATHER: '🪶', QUACK_HORN: '🔊',
}

const EFFECT_ICONS: Record<string, string> = { BUBBLE_SHIELD: '🫧', FEATHER: '🪶', NITRO: '⚡', SLOWED: '💫' }

export function PhaserRaceCanvas({ raceId, players, replayConfig }: { raceId: number; players: PlayerLabel[]; replayConfig?: RaceConfig | null }) {
  const parentId = `duck-race-${useId().replace(/:/g, '')}`
  const serializedPlayers = JSON.stringify(players)

  useEffect(() => {
    let active = true
    let game: PhaserType.Game | null = null
    let source: EventSource | null = null
    let replayFrame = 0

    void import('phaser').then((module) => {
      if (!active) return
      const Phaser = module.default
      const track = createRiverTrack(replayConfig?.trackVersion)
      const scenePlayers = JSON.parse(serializedPlayers) as PlayerLabel[]
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

      class DuckRaceScene extends Phaser.Scene {
        private duckViews = new Map<string, { root: PhaserType.GameObjects.Container; targetX: number; targetY: number; status: PhaserType.GameObjects.Text }>()
        private leaderboard!: PhaserType.GameObjects.Text
        private eventFeed!: PhaserType.GameObjects.Text
        private recentEvents: string[] = []

        constructor() { super('duck-race') }

        create() {
          this.cameras.main.setBackgroundColor('#112b3b')
          this.cameras.main.setBounds(-250, -850, track.length + 500, 1700)
          this.drawRiver()
          scenePlayers.forEach((player, index) => this.createDuck(player, index))
          this.add.text(18, 16, replayConfig ? '↻ REPLAY' : '● LIVE', {
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
          if (!replayConfig) this.showCountdown()
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
          const start = track.sample(0, -0.7 + (index / Math.max(1, scenePlayers.length - 1)) * 1.4)
          const root = this.add.container(start.x, start.y, [body, name, rank, loadout, status]).setDepth(100 + index)
          root.setData('rank-label', rank)
          this.duckViews.set(player.playerId, { root, targetX: start.x, targetY: start.y, status })
        }

        private showCountdown() {
          const countdown = this.add.text(this.scale.width / 2, this.scale.height / 2, '3', {
            color: '#ffcc00', fontFamily: 'sans-serif', fontSize: '110px', fontStyle: 'bold', stroke: '#100b20', strokeThickness: 12,
          }).setOrigin(0.5).setScrollFactor(0).setDepth(1500)
          let value = 3
          this.time.addEvent({ delay: 750, repeat: 3, callback: () => {
            value -= 1
            countdown.setText(value > 0 ? String(value) : 'QUACK!')
            countdown.setScale(1.4).setAlpha(1)
            this.tweens.add({ targets: countdown, scale: 1, duration: 250 })
            if (value < 0) countdown.destroy()
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
            view.status.setText(duck.activeEffects.map((effect) => EFFECT_ICONS[effect] ?? '').join(' '))
            view.root.setDepth(100 + scenePlayers.length - duck.rank)
          }
          this.leaderboard.setText(ducks.slice(0, 12).map((duck) => {
            const player = scenePlayers.find((candidate) => candidate.playerId === duck.playerId)
            const effect = duck.activeEffects.map((entry) => EFFECT_ICONS[entry] ?? '').join('')
            return `${String(duck.rank).padStart(2)}  ${player?.name ?? duck.playerId} ${effect}`
          }).join('\n'))
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
          }
          const message = messages[raceEvent.type]
          if (message) {
            this.recentEvents = [message, ...this.recentEvents].slice(0, 3)
            this.eventFeed.setText(this.recentEvents.join('\n'))
          }
          const focusId = raceEvent.targetPlayerId ?? raceEvent.sourcePlayerId
          const view = focusId ? this.duckViews.get(focusId) : null
          if (!view) return
          if (raceEvent.type === 'ROCKET_FIRED' && raceEvent.sourcePlayerId && raceEvent.targetPlayerId) {
            const sourceView = this.duckViews.get(raceEvent.sourcePlayerId)
            const targetView = this.duckViews.get(raceEvent.targetPlayerId)
            if (sourceView && targetView) {
              const rocket = this.add.text(sourceView.root.x, sourceView.root.y, '🚀', { fontSize: '28px' }).setDepth(950)
              this.tweens.add({ targets: rocket, x: targetView.root.x, y: targetView.root.y, duration: reducedMotion ? 120 : 480, onComplete: () => rocket.destroy() })
            }
          }
          if (raceEvent.type === 'BANANA_DROPPED') {
            const banana = this.add.text(view.root.x, view.root.y + 16, '🍌', { fontSize: '26px' }).setDepth(80)
            this.tweens.add({ targets: banana, alpha: 0, duration: reducedMotion ? 700 : 4500, onComplete: () => banana.destroy() })
          }
          if (raceEvent.type === 'NITRO_STARTED') {
            const wake = this.add.ellipse(view.root.x - 25, view.root.y + 10, 90, 28, 0x9ff5ff, 0.7).setDepth(85)
            this.tweens.add({ targets: wake, scaleX: 2.1, alpha: 0, duration: reducedMotion ? 250 : 850, onComplete: () => wake.destroy() })
          }
          if (raceEvent.type === 'BUBBLE_POPPED' || raceEvent.type === 'HORN_USED') {
            const ring = this.add.circle(view.root.x, view.root.y, 28, 0x7de8ff, 0.12).setStrokeStyle(5, 0xb8f4ff, 0.9).setDepth(900)
            this.tweens.add({ targets: ring, scale: reducedMotion ? 1.5 : 3, alpha: 0, duration: reducedMotion ? 200 : 500, onComplete: () => ring.destroy() })
          }
          if (!reducedMotion && (raceEvent.type === 'ROCKET_HIT' || raceEvent.type === 'BANANA_HIT')) {
            this.tweens.add({ targets: view.root, angle: { from: -8, to: 8 }, yoyo: true, repeat: 2, duration: 90, onComplete: () => view.root.setAngle(0) })
          }
        }

        update(_time: number, delta: number) {
          const smoothing = 1 - Math.exp(-delta / 95)
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
          const targetZoom = Phaser.Math.Clamp(this.scale.width / Math.max(900, spread + 520), 0.62, 1.08)
          camera.zoom += (targetZoom - camera.zoom) * 0.035
          camera.scrollX += (averageX - this.scale.width / (2 * camera.zoom) - camera.scrollX) * 0.045
          camera.scrollY += (averageY - this.scale.height / (2 * camera.zoom) - camera.scrollY) * 0.045
        }
      }

      const scene = new DuckRaceScene()
      game = new Phaser.Game({
        type: Phaser.WEBGL, parent: parentId, backgroundColor: '#112b3b', width: 1280, height: 640, scene,
        render: { antialias: true, roundPixels: false },
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
        fps: { target: 60 },
      })

      if (replayConfig) {
        const simulation = createSimulation(replayConfig)
        let previous = performance.now()
        let accumulator = 0
        let replayEventCount = 0
        const tickMs = 1000 / replayConfig.tickRate
        const replay = (now: number) => {
          if (!active || simulation.finished) return
          accumulator += Math.min(100, now - previous)
          previous = now
          while (accumulator >= tickMs && !simulation.finished) {
            stepSimulation(simulation)
            accumulator -= tickMs
          }
          scene.applySnapshot(snapshotSimulation(simulation))
          for (const raceEvent of simulation.events.slice(replayEventCount)) scene.applyEvent(raceEvent)
          replayEventCount = simulation.events.length
          replayFrame = requestAnimationFrame(replay)
        }
        replayFrame = requestAnimationFrame(replay)
      } else {
        source = new EventSource(`/api/races/${raceId}/live`)
        source.addEventListener('snapshot', (event) => {
          const payload = JSON.parse((event as MessageEvent<string>).data) as { ducks: DuckSnapshot[] }
          scene.applySnapshot(payload.ducks)
        })
        source.addEventListener('engine-event', (event) => {
          scene.applyEvent(JSON.parse((event as MessageEvent<string>).data) as RaceEvent)
        })
      }
    })

    return () => {
      active = false
      source?.close()
      cancelAnimationFrame(replayFrame)
      game?.destroy(true)
    }
  }, [parentId, raceId, replayConfig, serializedPlayers])

  return <div className="overflow-hidden rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-[#112b3b] shadow-[0_8px_0_var(--color-ggd-outline)]">
    <div id={parentId} className="aspect-[2/1] min-h-[320px] w-full" aria-label="Đua Dzịt race canvas" />
  </div>
}
