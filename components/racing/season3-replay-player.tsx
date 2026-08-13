'use client'

import { useCallback, useRef, useState } from 'react'
import type { RaceConfig, RaceEvent, RaceItemId, RecordedWildItemInput } from '@/packages/race-protocol/src'
import { PhaserRaceCanvas, type ReplayInspection } from './phaser-race-canvas'

type ReplayPlayer = {
  playerId: string
  name: string
  avatarUrl?: string | null
  itemIds?: RaceItemId[]
}

function manualInputs(events: RaceEvent[]): RecordedWildItemInput[] {
  return events.filter((event) => event.type === 'WILD_ITEM_MANUAL_INPUT').flatMap((event) => {
    const instanceId = event.metadata.instanceId
    const clientActionId = event.metadata.clientActionId
    if (!event.sourcePlayerId || typeof instanceId !== 'string' || typeof clientActionId !== 'string') return []
    return [{ raceId: event.raceId, playerId: event.sourcePlayerId, wildItemInstanceId: instanceId, action: 'USE' as const, clientActionId, authoritativeTick: event.tick }]
  })
}

export function Season3ReplayPlayer({ raceId, players, config, events = [] }: { raceId: number; players: ReplayPlayer[]; config: RaceConfig; events?: RaceEvent[] }) {
  const [runId, setRunId] = useState(0)
  const [started, setStarted] = useState(false)
  const [paused, setPaused] = useState(true)
  const [finished, setFinished] = useState(false)
  const [speed, setSpeed] = useState<1 | 2 | 4>(1)
  const [tick, setTick] = useState(0)
  const lastReportedTick = useRef(-1)

  const inspect = useCallback((state: ReplayInspection) => {
    if (state.finished || state.tick - lastReportedTick.current >= Math.max(1, Math.floor(config.tickRate / 4))) {
      lastReportedTick.current = state.tick
      setTick(state.tick)
    }
    if (state.finished) {
      setFinished(true)
      setPaused(true)
    }
  }, [config.tickRate])

  function play() {
    if (finished) {
      lastReportedTick.current = -1
      setTick(0)
      setFinished(false)
      setRunId((current) => current + 1)
    }
    setStarted(true)
    setPaused(false)
  }

  const elapsedSeconds = Math.floor(tick / config.tickRate)

  return <section className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><div className="font-black">🎬 RACE REPLAY · {config.engineVersion} · {config.trackVersion}</div><div className="mt-1 text-xs font-black text-white/50">{String(Math.floor(elapsedSeconds / 60)).padStart(2, '0')}:{String(elapsedSeconds % 60).padStart(2, '0')} · {finished ? 'FINISHED' : paused ? 'PAUSED' : 'PLAYING'}</div></div>
      <div className="flex flex-wrap gap-2">
        <button onClick={paused ? play : () => setPaused(true)} className="rounded-xl bg-[var(--color-ggd-gold)] px-5 py-2 font-black text-[var(--color-ggd-outline)]">{finished ? '↻ CHẠY LẠI' : paused ? '▶ PLAY REPLAY' : '⏸ PAUSE'}</button>
        {([1, 2, 4] as const).map((value) => <button key={value} onClick={() => setSpeed(value)} className={`rounded-xl border-2 px-3 py-2 text-sm font-black ${speed === value ? 'border-[var(--color-ggd-neon-green)] text-[var(--color-ggd-neon-green)]' : 'border-white/15 text-white/55'}`}>{value}×</button>)}
      </div>
    </div>
    <div className="relative">
      <PhaserRaceCanvas key={runId} raceId={raceId} players={players} replayConfig={config} replayManualInputs={manualInputs(events)} replaySpeed={speed} replayPaused={!started || paused} onReplayInspect={inspect} />
      {!started && <button onClick={play} className="absolute inset-0 z-10 m-auto h-20 w-52 rounded-2xl border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-gold)] font-display text-2xl text-[var(--color-ggd-outline)] shadow-[0_7px_0_var(--color-ggd-outline)]">▶ PLAY REPLAY</button>}
    </div>
  </section>
}
