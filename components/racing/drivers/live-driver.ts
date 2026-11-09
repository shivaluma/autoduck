import type { RaceConfig, RaceEvent, RecordedWildItemInput } from '@/src/engine/protocol'
import { createSimDriver, type SimDriver } from './sim-driver'

/**
 * A running race, re-simulated in the browser exactly as before drivers existed: catch up silently to the
 * server's tick, then run in real time; manual wild-item inputs arrive over SSE and are queued at their
 * authoritative tick. Not seekable.
 */
export function createLiveDriver(config: RaceConfig, options: { syncTick?: number; manualInputs?: readonly RecordedWildItemInput[] } = {}): SimDriver {
  const driver = createSimDriver(config, { manualInputs: options.manualInputs, kind: 'live' })
  const catchUpTick = Math.max(0, options.syncTick ?? 0)
  // Events from the catch-up are not shown (the old loop started counting after it).
  driver.advanceTo(catchUpTick)
  return driver
}

/** Queues an applied WILD_ITEM_MANUAL_INPUT from the live SSE stream into the local simulation. */
export function applyLiveSyncEvent(driver: SimDriver, config: RaceConfig, event: RaceEvent) {
  if (event.type !== 'WILD_ITEM_MANUAL_INPUT' || event.metadata.applied !== true) return
  const instanceId = event.metadata.instanceId
  const clientActionId = event.metadata.clientActionId
  if (!event.sourcePlayerId || typeof instanceId !== 'string' || typeof clientActionId !== 'string') return
  driver.queueInput({
    raceId: config.raceId,
    playerId: event.sourcePlayerId,
    wildItemInstanceId: instanceId,
    action: 'USE',
    clientActionId,
  }, event.tick)
}

/** Opens the live SSE stream; returns a closer. */
export function connectLiveDriver(raceId: number, driver: SimDriver, config: RaceConfig, onFinished: () => void) {
  const source = new EventSource(`/api/races/${raceId}/live`)
  source.addEventListener('engine-event', (event) => {
    try {
      const payload = JSON.parse((event as MessageEvent<string>).data) as RaceEvent
      if (payload.type === 'WILD_ITEM_MANUAL_INPUT') applyLiveSyncEvent(driver, config, payload)
      if (payload.type === 'RACE_FINISHED') onFinished()
    } catch {
      // Ignore malformed sync events.
    }
  })
  source.addEventListener('finished', () => onFinished())
  return () => source.close()
}
