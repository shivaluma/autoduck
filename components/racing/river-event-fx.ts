import type PhaserType from 'phaser'
import type { RaceEvent } from '@/src/engine/protocol'
import { callout, iconKey, loopSprite, playFx, type CalloutTone } from './race-fx'
import { isRiverEventKind, RIVER_EVENT_COPY, type RiverEventKind } from './river-event-copy'

/**
 * Screen effects of the river events (engine S3.17, `crates/race-core/src/sim/river.rs`), in the Race FX
 * style (docs/race-fx.md):
 *
 * - a comic banner plate that drops in with the event's icon, a 3-2-1 countdown while the event is
 *   announced and a timer bar while it runs;
 * - a tint and screen-space weather (rain, wind streaks and leaves, falling loaves);
 * - a sprite on every duck the event speeds up or slows down (a surf wave pushing it, a vortex under
 *   it, wind curls, a loaf to chase), with its "+12%" / "-22%" on a pill above it.
 *
 * Everything follows the engine's RIVER_EVENT_* events; nothing here affects the race.
 */

interface DuckAnchor { root: PhaserType.GameObjects.Container }

interface RiverEventFxOptions {
  reducedMotion: boolean
  mobile: boolean
  duckView: (playerId: string) => DuckAnchor | null
}

export interface RiverEventFx {
  /** Plays the effects of a RIVER_EVENT_* event; ignores every other event. */
  handle: (raceEvent: RaceEvent) => void
  destroy: () => void
}

const INK = 0x100b20
const PLATE = 0x1b1440
const BANNER_DEPTH = 1400
const WEATHER_DEPTH = 986
const HAZARD_YELLOW = 0xfacc15

export function createRiverEventFx(scene: PhaserType.Scene, options: RiverEventFxOptions): RiverEventFx {
  const { reducedMotion, mobile, duckView } = options
  const width = scene.scale.width
  const height = scene.scale.height
  const plateWidth = Math.min(470, width - 32)
  const plateHeight = 84
  const restY = mobile ? 108 : 100
  const hiddenY = -plateHeight

  // --- Banner plate -------------------------------------------------------------------------------
  const plate = scene.add.graphics()
  const stripes = scene.add.graphics()
  const badge = scene.add.graphics()
  const icon = scene.add.image(-plateWidth / 2 + 46, 0, iconKey('river-flood')).setDisplaySize(58, 58)
  const title = scene.add.text(-plateWidth / 2 + 92, -30, '', {
    fontFamily: '"Arial Black", "Arial", sans-serif', fontSize: mobile ? '21px' : '25px', fontStyle: 'bold italic',
    color: '#ffffff', stroke: '#100b20', strokeThickness: 6,
  })
  const subtitle = scene.add.text(-plateWidth / 2 + 94, 2, '', {
    fontFamily: 'sans-serif', fontSize: '12.5px', fontStyle: 'bold', color: '#e2e8f0',
    wordWrap: { width: plateWidth - 170 },
  })
  const count = scene.add.text(plateWidth / 2 - 40, -2, '', {
    fontFamily: '"Arial Black", "Arial", sans-serif', fontSize: '40px', fontStyle: 'bold italic',
    color: '#fde047', stroke: '#100b20', strokeThickness: 8,
  }).setOrigin(0.5)
  const barWidth = plateWidth - 120
  const barBack = scene.add.rectangle(-plateWidth / 2 + 94, plateHeight / 2 - 13, barWidth, 7, INK, 0.9).setOrigin(0, 0.5)
  const bar = scene.add.rectangle(-plateWidth / 2 + 94, plateHeight / 2 - 13, barWidth, 7, 0xffffff, 1).setOrigin(0, 0.5)
  const banner = scene.add.container(width / 2, hiddenY, [plate, stripes, badge, icon, title, subtitle, barBack, bar, count])
    .setScrollFactor(0).setDepth(BANNER_DEPTH).setVisible(false)

  const drawPlate = (accent: number, warning: boolean) => {
    const x = -plateWidth / 2
    const y = -plateHeight / 2
    plate.clear()
    plate.fillStyle(INK, 0.35).fillRoundedRect(x + 4, y + 7, plateWidth, plateHeight, 20)
    plate.fillStyle(INK, 1).fillRoundedRect(x - 4, y - 4, plateWidth + 8, plateHeight + 8, 22)
    plate.fillStyle(accent, 1).fillRoundedRect(x, y, plateWidth, plateHeight, 18)
    plate.fillStyle(PLATE, 1).fillRoundedRect(x + 4, y + 4, plateWidth - 8, plateHeight - 8, 15)
    plate.fillStyle(0xffffff, 0.07).fillRoundedRect(x + 4, y + 4, plateWidth - 8, (plateHeight - 8) / 2, { tl: 15, tr: 15, bl: 0, br: 0 })
    // Hazard tape along the top edge while the event is only announced.
    stripes.clear()
    if (warning) {
      const tapeY = y - 13
      stripes.fillStyle(INK, 1).fillRoundedRect(x + 22, tapeY - 3, plateWidth - 44, 16, 6)
      for (let sx = x + 26; sx < x + plateWidth - 40; sx += 22) {
        stripes.fillStyle(HAZARD_YELLOW, 1).fillPoints([
          { x: sx + 6, y: tapeY }, { x: sx + 17, y: tapeY }, { x: sx + 11, y: tapeY + 10 }, { x: sx, y: tapeY + 10 },
        ] as PhaserType.Math.Vector2[], true)
      }
    }
    badge.clear()
    badge.fillStyle(INK, 1).fillCircle(icon.x, 0, 39)
    badge.fillStyle(accent, 1).fillCircle(icon.x, 0, 34)
    badge.fillStyle(0xffffff, 0.28).fillEllipse(icon.x - 8, -14, 34, 16)
  }

  // --- Screen tint --------------------------------------------------------------------------------
  const overlay = scene.add.rectangle(width / 2, height / 2, width * 1.6, height * 1.6, 0xffffff, 0).setScrollFactor(0).setDepth(WEATHER_DEPTH - 2)

  // --- State --------------------------------------------------------------------------------------
  let destroyed = false
  let timers: PhaserType.Time.TimerEvent[] = []
  let tweens: PhaserType.Tweens.Tween[] = []
  let emitters: PhaserType.GameObjects.Particles.ParticleEmitter[] = []
  /** Sprites and pills parented to duck containers; they follow their duck by themselves. */
  let attached: PhaserType.GameObjects.GameObject[] = []

  const later = (delay: number, callback: () => void, repeat = 0) => {
    const timer = scene.time.addEvent({ delay, repeat, callback: () => { if (!destroyed) callback() } })
    timers.push(timer)
    return timer
  }
  const every = (delay: number, callback: () => void) => {
    const timer = scene.time.addEvent({ delay, loop: true, callback: () => { if (!destroyed) callback() } })
    timers.push(timer)
  }
  const keep = (tween: PhaserType.Tweens.Tween) => { tweens.push(tween); return tween }

  const clearRunning = () => {
    for (const timer of timers) timer.remove()
    timers = []
    for (const tween of tweens) tween.stop()
    tweens = []
    for (const emitter of emitters) { emitter.stop(); scene.time.delayedCall(1600, () => emitter.destroy()) }
    emitters = []
    for (const object of attached) object.destroy()
    attached = []
    banner.setAngle(0)
    title.setScale(1)
    count.setScale(1)
  }

  const hide = () => {
    clearRunning()
    scene.tweens.killTweensOf(banner)
    scene.tweens.add({ targets: banner, y: hiddenY, duration: 240, ease: 'Back.In', onComplete: () => { if (!destroyed) banner.setVisible(false) } })
    scene.tweens.add({ targets: overlay, fillAlpha: 0, duration: 360 })
  }

  const showBanner = (kind: RiverEventKind, warning: boolean, seconds: number) => {
    const copy = RIVER_EVENT_COPY[kind]
    const accent = Number.parseInt(copy.accent.slice(1), 16)
    drawPlate(warning ? HAZARD_YELLOW : accent, warning)
    icon.setTexture(iconKey(copy.iconKey))
    title.setText(warning ? `${copy.name} SẮP ĐẾN!` : `${copy.name}!`).setColor(warning ? '#fde047' : copy.accent)
    subtitle.setText(warning ? copy.warning : copy.active)
    count.setText(warning ? String(Math.ceil(seconds)) : '')
    bar.setFillStyle(warning ? HAZARD_YELLOW : accent, 1).setScale(1, 1)
    scene.tweens.killTweensOf(banner)
    const wasVisible = banner.visible && banner.y > 0
    banner.setVisible(true)
    if (wasVisible || reducedMotion) banner.setY(restY)
    else scene.tweens.add({ targets: banner, y: restY, duration: 320, ease: 'Back.Out' })
    keep(scene.tweens.add({ targets: bar, scaleX: 0, duration: seconds * 1000, ease: 'Linear' }))
    // If the race ends before the engine's own "ended" event, the banner still goes away.
    later(seconds * 1000 + 2500, hide)
  }

  /** A pill with the duck's speed change, above its head for the length of the event. */
  const pill = (view: DuckAnchor, percent: number) => {
    const faster = percent > 0
    const label = scene.add.text(0, -66, `${faster ? '▲ +' : '▼ '}${percent}%`, {
      fontFamily: '"Arial Black", "Arial", sans-serif', fontSize: '13px', fontStyle: 'bold',
      color: faster ? '#052e16' : '#450a0a', backgroundColor: faster ? '#86efac' : '#fca5a5', padding: { x: 7, y: 3 },
      stroke: faster ? '#bbf7d0' : '#fecaca', strokeThickness: 1,
    }).setOrigin(0.5)
    view.root.add(label)
    attached.push(label)
    if (!reducedMotion) keep(scene.tweens.add({ targets: label, y: -72, duration: 420, yoyo: true, repeat: -1, ease: 'Sine.InOut' }))
  }

  /** A looping sprite under (or over) a duck, parented to its container. */
  const attach = (view: DuckAnchor, key: Parameters<typeof loopSprite>[1], x: number, y: number, size: number, under: boolean, index: number) => {
    const sprite = loopSprite(scene, key, x, y, size, index * 3)
    if (under) view.root.addAt(sprite, 0)
    else view.root.add(sprite)
    attached.push(sprite)
    if (!reducedMotion) {
      sprite.setScale(sprite.scaleX * 0.2, sprite.scaleY * 0.2)
      scene.tweens.add({ targets: sprite, displayWidth: size, displayHeight: size, duration: 320, ease: 'Back.Out' })
    }
    return sprite
  }

  const weather = (kind: RiverEventKind) => {
    if (reducedMotion) return
    const area = { x: { min: -width * 0.3, max: width * 1.3 } }
    const slow = mobile ? 2 : 1
    if (kind === 'FLASH_FLOOD') {
      // Driving rain.
      emitters.push(scene.add.particles(0, 0, 'p-streak', {
        ...area, y: -40, speedX: { min: 260, max: 380 }, speedY: { min: 900, max: 1200 }, rotate: 72,
        scale: { min: 0.5, max: 1.1 }, alpha: { min: 0.35, max: 0.7 }, lifespan: 900, frequency: 12 * slow, quantity: 2, tint: [0xbae6fd, 0xe0f2fe, 0x7dd3fc],
      }).setScrollFactor(0).setDepth(WEATHER_DEPTH))
    } else if (kind === 'GUST') {
      emitters.push(scene.add.particles(0, 0, 'p-streak', {
        x: -60, y: { min: 0, max: height }, speedX: { min: 1300, max: 1900 }, speedY: { min: -40, max: 40 },
        scaleX: { min: 1.6, max: 3.4 }, scaleY: { min: 0.5, max: 1 }, alpha: { min: 0.25, max: 0.6 }, lifespan: 1100, frequency: 26 * slow, quantity: 1,
      }).setScrollFactor(0).setDepth(WEATHER_DEPTH))
      emitters.push(scene.add.particles(0, 0, 'p-petal', {
        x: -40, y: { min: 0, max: height }, speedX: { min: 700, max: 1100 }, speedY: { min: -120, max: 160 },
        scale: { min: 0.6, max: 1.2 }, rotate: { start: 0, end: 720 }, alpha: { min: 0.7, max: 1 }, lifespan: 1900, frequency: 70 * slow, quantity: 1,
        tint: [0x86efac, 0xbbf7d0, 0xfde68a],
      }).setScrollFactor(0).setDepth(WEATHER_DEPTH))
    } else if (kind === 'WHIRLPOOL') {
      // Spray pulled in from the edges.
      emitters.push(scene.add.particles(0, 0, 'p-dot', {
        x: { min: 0, max: width }, y: { min: 0, max: height }, moveToX: width / 2, moveToY: height / 2,
        scale: { start: 1.1, end: 0 }, alpha: { start: 0.75, end: 0 }, lifespan: 850, frequency: 22 * slow, quantity: 1,
        tint: [0xc4b5fd, 0xddd6fe, 0xa78bfa],
      }).setScrollFactor(0).setDepth(WEATHER_DEPTH))
    }
  }

  const warn = (kind: RiverEventKind, seconds: number) => {
    clearRunning()
    showBanner(kind, true, seconds)
    let left = Math.ceil(seconds)
    later(1000, () => {
      left -= 1
      if (left <= 0 || !count.active) return
      count.setText(String(left))
      if (!reducedMotion) { count.setScale(1.6); keep(scene.tweens.add({ targets: count, scale: 1, duration: 240, ease: 'Back.Out' })) }
    }, Math.max(0, left - 2))
    if (reducedMotion) return
    keep(scene.tweens.add({ targets: banner, angle: { from: -1.4, to: 1.4 }, duration: 110, yoyo: true, repeat: -1, ease: 'Sine.InOut' }))
    // The tint creeps in during the warning.
    overlay.setFillStyle(RIVER_EVENT_COPY[kind].tint, 0)
    scene.tweens.add({ targets: overlay, fillAlpha: 0.06, duration: seconds * 1000 })
  }

  const start = (kind: RiverEventKind, seconds: number, effects: Array<{ playerId: string; multiplier: number }>) => {
    const copy = RIVER_EVENT_COPY[kind]
    clearRunning()
    showBanner(kind, false, seconds)
    overlay.setFillStyle(copy.tint, overlay.fillAlpha)
    scene.tweens.add({ targets: overlay, fillAlpha: reducedMotion ? 0.07 : 0.15, duration: 240 })
    if (!reducedMotion) {
      scene.cameras.main.flash(200, (copy.tint >> 16) & 0xff, (copy.tint >> 8) & 0xff, copy.tint & 0xff)
      scene.cameras.main.shake(kind === 'WHIRLPOOL' ? 380 : 240, kind === 'WHIRLPOOL' ? 0.006 : 0.004)
      title.setScale(1.45)
      keep(scene.tweens.add({ targets: title, scale: 1, duration: 320, ease: 'Back.Out' }))
    }
    weather(kind)

    const affected: DuckAnchor[] = []
    effects.forEach((effect, index) => {
      const view = duckView(effect.playerId)
      if (!view) return
      const percent = Math.round((effect.multiplier - 1) * 100)
      if (percent === 0) return
      const faster = percent > 0
      affected.push(view)
      const tone: CalloutTone = faster ? 'green' : 'fire'
      callout(scene, view.root.x, view.root.y - 84, `${faster ? '+' : ''}${percent}%`, tone, reducedMotion, 22)
      if (kind === 'FLASH_FLOOD') {
        // The push changes with the gap, so no fixed pill: the wave grows with the size of the push.
        if (percent >= 2) attach(view, 'river-surf', -60, 8, 84 + Math.min(18, percent) * 3, true, index)
        if (!reducedMotion) playFx(scene, 'splash', view.root.x - 30, view.root.y + 10, { size: 110 })
        return
      }
      pill(view, percent)
      if (kind === 'WHIRLPOOL') {
        attach(view, 'river-vortex', 0, 20, 164, true, index)
      } else if (kind === 'GUST') {
        const curl = attach(view, 'river-gust', faster ? -62 : 62, -4, 132, true, index).setTint(faster ? 0xbbf7d0 : 0xfecaca)
        if (!faster) curl.setFlipX(true)
      } else if (kind === 'BREAD_RAIN') {
        const loaf = attach(view, 'river-bread', 58, -30, 56, false, index)
        if (!reducedMotion) keep(scene.tweens.add({ targets: loaf, x: 70, duration: 300, yoyo: true, repeat: -1, ease: 'Sine.InOut' }))
      }
    })

    if (reducedMotion) return
    if (kind === 'BREAD_RAIN') {
      // Loaves rain down across the screen and splash onto the hungry ducks.
      every(mobile ? 150 : 85, () => {
        const size = 34 + Math.random() * 30
        const loaf = loopSprite(scene, 'river-bread', Math.random() * width, -40, size, Math.floor(Math.random() * 16)).setScrollFactor(0).setDepth(WEATHER_DEPTH)
        scene.tweens.add({ targets: loaf, y: height + 50, x: loaf.x + 40 + Math.random() * 60, angle: 200 + Math.random() * 200, duration: 950 + Math.random() * 600, ease: 'Quad.In', onComplete: () => loaf.destroy() })
      })
      every(520, () => {
        const view = affected[Math.floor(Math.random() * affected.length)]
        if (!view) return
        playFx(scene, 'splash', view.root.x + 34, view.root.y + 6, { size: 96 })
        callout(scene, view.root.x + 20, view.root.y - 70, 'NOM!', 'gold', false, 16)
      })
    } else if (kind === 'FLASH_FLOOD') {
      every(420, () => {
        const view = affected[Math.floor(Math.random() * affected.length)]
        if (view) playFx(scene, 'splash', view.root.x - 46, view.root.y + 14, { size: 90, alpha: 0.9 })
      })
    } else if (kind === 'WHIRLPOOL') {
      every(600, () => {
        for (const view of affected) scene.tweens.add({ targets: view.root, angle: { from: -7, to: 7 }, duration: 140, yoyo: true, repeat: 1, onComplete: () => { if (view.root.active) view.root.setAngle(0) } })
      })
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
    destroy() {
      destroyed = true
      for (const timer of timers) timer.remove()
      for (const tween of tweens) tween.stop()
      timers = []
      tweens = []
    },
  }
}
