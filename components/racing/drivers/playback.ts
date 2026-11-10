import type { RaceEvent } from '@/src/engine/protocol'
import type { RaceWorld } from '@/src/race/types'
import type { DriverFrame, TimelineDriver } from './types'

/** The scene operations playback needs (DuckRaceScene implements them; tests use a fake). */
export interface PlaybackScene {
  applyWorld(world: RaceWorld, options?: { snap?: boolean }): void
  /** `silent`: update persistent state (feed, used-item icons, finish count) without FX, audio or camera. */
  applyEvent(event: RaceEvent, options?: { silent?: boolean }): void
  /** Tear the scene down to its freshly created state. */
  rebuild(): Promise<void> | void
}

export interface PlaybackFrame extends DriverFrame {
  /** True for the frame that completes a seek. */
  seeked: boolean
}

export interface Playback {
  readonly driver: TimelineDriver
  /** True while a seek is rebuilding or fast-forwarding; frames are skipped meanwhile. */
  busy(): boolean
  /** One animation frame: advance by elapsed × speed and apply world + events with FX. */
  frame(elapsedMs: number, speed: number, paused: boolean): PlaybackFrame | null
  /**
   * Seek to a tick. Forward: fast-apply (now, t] with FX suppressed. Backward: applyEvent side effects are
   * not idempotent, so the scene is rebuilt, the driver reset and [0, t] fast-applied with FX suppressed.
   * Seeks issued while one is running coalesce to the latest target.
   */
  seek(targetTick: number): Promise<PlaybackFrame | null>
}

export function createPlayback(driver: TimelineDriver, scene: PlaybackScene): Playback {
  const tickMs = 1000 / driver.tickRate
  let accumulator = 0
  let seeking = false
  let current: Promise<PlaybackFrame | null> = Promise.resolve(null)
  let pendingTarget: number | null = null

  const clampTarget = (tick: number) => {
    const floor = Math.max(0, Math.floor(tick))
    return driver.endTick === null ? floor : Math.min(driver.endTick, floor)
  }

  async function runSeeks(): Promise<PlaybackFrame | null> {
    let last: PlaybackFrame | null = null
    try {
      while (pendingTarget !== null) {
        const target = pendingTarget
        pendingTarget = null
        if (target < driver.tick()) {
          await scene.rebuild()
          driver.reset()
        }
        const frame = driver.advanceTo(target)
        scene.applyWorld(frame.world, { snap: true })
        for (const event of frame.events) scene.applyEvent(event, { silent: true })
        accumulator = 0
        last = { ...frame, seeked: true }
      }
    } finally {
      // Same synchronous segment as the loop exit, so a seek arriving later always starts a new run.
      seeking = false
    }
    return last
  }

  return {
    driver,
    busy: () => seeking,
    frame(elapsedMs, speed, paused) {
      if (seeking) return null
      let target = driver.tick()
      if (!paused) {
        accumulator += Math.min(100, Math.max(0, elapsedMs)) * speed
        const steps = Math.floor(accumulator / tickMs)
        accumulator -= steps * tickMs
        target += steps
      }
      const frame = driver.advanceTo(target)
      scene.applyWorld(frame.world)
      for (const event of frame.events) scene.applyEvent(event)
      return { ...frame, seeked: false }
    },
    seek(targetTick) {
      if (!driver.seekable) return Promise.resolve(null)
      pendingTarget = clampTarget(targetTick)
      if (!seeking) {
        seeking = true
        current = runSeeks()
      }
      return current
    },
  }
}
