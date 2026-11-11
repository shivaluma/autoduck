import type PhaserType from 'phaser'
import type { RaceEvent } from '@/src/engine/protocol'
import { callout, type CalloutTone } from './race-fx'
import { isRiverEventKind, RIVER_EVENT_COPY, type RiverEventKind } from './river-event-copy'

/**
 * Screen effects of the river events (engine S3.17, `crates/race-core/src/sim/river.rs`): a banner with
 * a countdown while an event is announced, then a tint, weather drifting across the screen and a
 * "+12%" / "-22%" callout over every duck it speeds up or slows down. Everything follows the engine's
 * RIVER_EVENT_* events; nothing here affects the race.
 */

interface DuckAnchor { root: { x: number; y: number } }

interface RiverEventFxOptions {
  reducedMotion: boolean
  duckView: (playerId: string) => DuckAnchor | null
}

export interface RiverEventFx {
  /** Plays the effects of a RIVER_EVENT_* event; ignores every other event. */
  handle: (raceEvent: RaceEvent) => void
  /** Call every frame: keeps the per-duck markers on their ducks. */
  update: () => void
  destroy: () => void
}

const BANNER_DEPTH = 1400
const WEATHER_DEPTH = 930

export function createRiverEventFx(scene: PhaserType.Scene, options: RiverEventFxOptions): RiverEventFx {
  const { reducedMotion, duckView } = options
  const width = scene.scale.width
  const height = scene.scale.height
  const bannerY = 62

  const overlay = scene.add.rectangle(width / 2, height / 2, width, height, 0xffffff, 0).setScrollFactor(0).setDepth(WEATHER_DEPTH - 1)
  const title = scene.add.text(width / 2, bannerY, '', {
    color: '#ffffff', fontFamily: '"Arial Black", "Arial", sans-serif', fontSize: '26px', fontStyle: 'bold',
    stroke: '#100b20', strokeThickness: 7, backgroundColor: '#100b20cc', padding: { x: 16, y: 8 },
  }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(BANNER_DEPTH).setAlpha(0)
  const subtitle = scene.add.text(width / 2, bannerY + 52, '', {
    color: '#ffffff', fontFamily: 'sans-serif', fontSize: '14px', fontStyle: 'bold',
    backgroundColor: '#100b20cc', padding: { x: 10, y: 5 },
  }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(BANNER_DEPTH).setAlpha(0)
  const barWidth = 260
  const barBack = scene.add.rectangle(width / 2, bannerY + 84, barWidth, 6, 0x100b20, 0.8).setScrollFactor(0).setDepth(BANNER_DEPTH).setAlpha(0)
  const bar = scene.add.rectangle(width / 2 - barWidth / 2, bannerY + 84, barWidth, 6, 0xffffff, 1).setOrigin(0, 0.5).setScrollFactor(0).setDepth(BANNER_DEPTH + 1).setAlpha(0)
  const banner = [title, subtitle, barBack, bar]

  let weather: PhaserType.Time.TimerEvent | null = null
  let safety: PhaserType.Time.TimerEvent | null = null
  let pulse: PhaserType.Tweens.Tween | null = null
  let barTween: PhaserType.Tweens.Tween | null = null
  let markers: Array<{ playerId: string; label: PhaserType.GameObjects.Text }> = []
  let destroyed = false

  const stopTimers = () => {
    weather?.remove()
    weather = null
    safety?.remove()
    safety = null
    pulse?.stop()
    pulse = null
    barTween?.stop()
    barTween = null
  }

  const clearMarkers = () => {
    for (const marker of markers) marker.label.destroy()
    markers = []
  }

  const hide = () => {
    stopTimers()
    clearMarkers()
    scene.tweens.add({ targets: banner, alpha: 0, duration: 220 })
    scene.tweens.add({ targets: overlay, fillAlpha: 0, duration: 320 })
  }

  const showBanner = (text: string, detail: string, accent: string, seconds: number) => {
    stopTimers()
    title.setText(text).setColor(accent).setScale(1)
    subtitle.setText(detail)
    bar.setFillStyle(Number.parseInt(accent.slice(1), 16), 1).setScale(1, 1)
    scene.tweens.killTweensOf(banner)
    for (const part of banner) part.setAlpha(1)
    barTween = scene.tweens.add({ targets: bar, scaleX: 0, duration: seconds * 1000, ease: 'Linear' })
    // If the race ends before the engine's own "ended" event, the banner still goes away.
    safety = scene.time.delayedCall(seconds * 1000 + 2500, () => { if (!destroyed) hide() })
  }

  /** One piece of weather drifting across the screen. */
  const drift = (kind: RiverEventKind) => {
    if (destroyed) return
    if (kind === 'BREAD_RAIN') {
      const piece = scene.add.text(Math.random() * width, -24, '🍞', { fontSize: `${18 + Math.random() * 14}px` })
        .setScrollFactor(0).setDepth(WEATHER_DEPTH).setAngle(Math.random() * 60 - 30)
      scene.tweens.add({ targets: piece, y: height + 30, angle: piece.angle + 120, duration: 1100 + Math.random() * 700, ease: 'Quad.In', onComplete: () => piece.destroy() })
      return
    }
    if (kind === 'WHIRLPOOL') return
    const flood = kind === 'FLASH_FLOOD'
    const streak = scene.add.rectangle(-80, Math.random() * height, 50 + Math.random() * 90, flood ? 5 : 2, flood ? 0xbae6fd : 0xffffff, flood ? 0.5 : 0.65)
      .setScrollFactor(0).setDepth(WEATHER_DEPTH)
    scene.tweens.add({ targets: streak, x: width + 120, duration: flood ? 620 + Math.random() * 380 : 380 + Math.random() * 260, onComplete: () => streak.destroy() })
  }

  const warn = (kind: RiverEventKind, seconds: number) => {
    const copy = RIVER_EVENT_COPY[kind]
    clearMarkers()
    showBanner(`⚠️ ${copy.icon} ${copy.name} SẮP ĐẾN`, copy.warning, copy.accent, seconds)
    if (!reducedMotion) pulse = scene.tweens.add({ targets: title, scale: 1.08, duration: 260, yoyo: true, repeat: -1, ease: 'Sine.InOut' })
  }

  const start = (kind: RiverEventKind, seconds: number, effects: Array<{ playerId: string; multiplier: number }>) => {
    const copy = RIVER_EVENT_COPY[kind]
    clearMarkers()
    showBanner(`${copy.icon} ${copy.name}!`, copy.active, copy.accent, seconds)
    overlay.setFillStyle(copy.tint, 0)
    scene.tweens.add({ targets: overlay, fillAlpha: reducedMotion ? 0.08 : 0.16, duration: 260 })
    if (!reducedMotion) {
      scene.cameras.main.flash(180, (copy.tint >> 16) & 0xff, (copy.tint >> 8) & 0xff, copy.tint & 0xff)
      scene.cameras.main.shake(kind === 'WHIRLPOOL' ? 320 : 200, 0.004)
      title.setScale(1.5)
      scene.tweens.add({ targets: title, scale: 1, duration: 300, ease: 'Back.Out' })
      weather = scene.time.addEvent({ delay: kind === 'BREAD_RAIN' ? 90 : 45, loop: true, callback: () => drift(kind) })
    }
    for (const effect of effects) {
      const view = duckView(effect.playerId)
      if (!view) continue
      const percent = Math.round((effect.multiplier - 1) * 100)
      if (percent === 0) continue
      const faster = percent > 0
      const tone: CalloutTone = faster ? 'green' : 'fire'
      callout(scene, view.root.x, view.root.y - 72, `${faster ? '+' : ''}${percent}%`, tone, reducedMotion, 22)
      // The flash flood's push changes with the gap, so it gets no fixed marker.
      if (kind === 'FLASH_FLOOD') continue
      const label = scene.add.text(view.root.x, view.root.y - 46, kind === 'WHIRLPOOL' ? '🌀' : faster ? '▲' : '▼', {
        color: faster ? '#bbf7d0' : '#fecaca', fontFamily: 'sans-serif', fontSize: kind === 'WHIRLPOOL' ? '26px' : '18px', fontStyle: 'bold', stroke: '#100b20', strokeThickness: 4,
      }).setOrigin(0.5).setDepth(985)
      if (kind === 'WHIRLPOOL' && !reducedMotion) scene.tweens.add({ targets: label, angle: -360, duration: 700, repeat: -1 })
      markers.push({ playerId: effect.playerId, label })
    }
  }

  return {
    handle(raceEvent) {
      if (destroyed) return
      const kind = raceEvent.metadata.kind
      if (!isRiverEventKind(kind)) return
      if (raceEvent.type === 'RIVER_EVENT_WARNING') {
        warn(kind, Number(raceEvent.metadata.warningSeconds) || 2.5)
      } else if (raceEvent.type === 'RIVER_EVENT_STARTED') {
        const effects = Array.isArray(raceEvent.metadata.effects) ? raceEvent.metadata.effects as Array<{ playerId: string; multiplier: number }> : []
        start(kind, Number(raceEvent.metadata.durationSeconds) || 3, effects)
      } else if (raceEvent.type === 'RIVER_EVENT_ENDED') {
        hide()
      }
    },
    update() {
      for (const marker of markers) {
        const view = duckView(marker.playerId)
        if (view && marker.label.active) marker.label.setPosition(view.root.x, view.root.y - 46)
      }
    },
    destroy() {
      destroyed = true
      stopTimers()
      clearMarkers()
    },
  }
}
