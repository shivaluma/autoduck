'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RaceConfig, RaceEvent, RaceItemId, RecordedWildItemInput, DuckSnapshot } from '@/packages/race-protocol/src'
import { RACE_BALANCE_VERSION } from '@/packages/race-protocol/src'
import { replayRace } from '@/lib/racing/replay'
import { PhaserRaceCanvas, type ReplayInspection } from './phaser-race-canvas'
import { LiveLeaderboardSnapshot } from './live-leaderboard-snapshot'
import { RaceEventTimeline } from './race-event-timeline'
import { CombatEncountersPanel } from './combat-encounters-panel'
import { extractCombatEncounters } from '@/lib/racing/combat-encounters'

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

export function Season3ReplayPlayer({
  raceId,
  players,
  config,
  events = [],
  resultDigest,
}: {
  raceId: number
  players: ReplayPlayer[]
  config: RaceConfig
  events?: RaceEvent[]
  resultDigest?: string | null
}) {
  const [runId, setRunId] = useState(0)
  const [started, setStarted] = useState(false)
  const [paused, setPaused] = useState(true)
  const [finished, setFinished] = useState(false)
  const [speed, setSpeed] = useState<1 | 2 | 4>(1)
  const [tick, setTick] = useState(0)
  const [latestDucks, setLatestDucks] = useState<DuckSnapshot[]>([])
  const [activeTab, setActiveTab] = useState<'leaderboard' | 'timeline' | 'combat'>('leaderboard')
  const [verifyState, setVerifyState] = useState<'idle' | 'ok' | 'mismatch' | 'unsupported'>('idle')
  const lastReportedTick = useRef(-1)
  const verifiedRef = useRef(false)
  const inputs = useMemo(() => manualInputs(events), [events])
  const combatAnalytics = useMemo(() => extractCombatEncounters(events, players), [events, players])
  const balanceDrift = config.balanceVersion !== RACE_BALANCE_VERSION
  const seedTail = config.seed.slice(-8)

  useEffect(() => {
    setRunId(0)
    setStarted(false)
    setPaused(true)
    setFinished(false)
    setTick(0)
    setLatestDucks([])
    setVerifyState('idle')
    lastReportedTick.current = -1
    verifiedRef.current = false
  }, [raceId, config.seed])

  const inspect = useCallback((state: ReplayInspection) => {
    if (state.finished || state.tick - lastReportedTick.current >= Math.max(1, Math.floor(config.tickRate / 4))) {
      lastReportedTick.current = state.tick
      setTick(state.tick)
      setLatestDucks(state.ducks)
    }
    if (state.finished && !verifiedRef.current) {
      verifiedRef.current = true
      setFinished(true)
      setPaused(true)
      if (!resultDigest) {
        setVerifyState('idle')
        return
      }
      try {
        replayRace(config, resultDigest, inputs)
        setVerifyState('ok')
      } catch (error) {
        const message = error instanceof Error ? error.message : ''
        setVerifyState(message.includes('Unsupported replay version') ? 'unsupported' : 'mismatch')
      }
    }
  }, [config, inputs, resultDigest, config.tickRate])

  function play() {
    if (finished) {
      lastReportedTick.current = -1
      verifiedRef.current = false
      setVerifyState('idle')
      setTick(0)
      setLatestDucks([])
      setFinished(false)
      setRunId((current) => current + 1)
    }
    setStarted(true)
    setPaused(false)
  }

  const elapsedSeconds = Math.floor(tick / config.tickRate)

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-black">🎬 RACE REPLAY · Race #{raceId} · {config.balanceVersion}</div>
          <div className="mt-1 text-xs font-black text-white/50">
            seed …{seedTail} · {config.engineVersion} · {config.trackVersion} · {String(Math.floor(elapsedSeconds / 60)).padStart(2, '0')}:{String(elapsedSeconds % 60).padStart(2, '0')} · {finished ? 'FINISHED' : paused ? 'PAUSED' : 'PLAYING'}
          </div>
          {balanceDrift && <div className="mt-2 rounded-lg border border-[var(--color-ggd-orange)]/40 bg-[var(--color-ggd-orange)]/10 px-3 py-2 text-xs font-bold text-[var(--color-ggd-orange)]">Race này chạy balance {config.balanceVersion}; client hiện tại {RACE_BALANCE_VERSION} — replay có thể khác kết quả thật.</div>}
          {verifyState === 'ok' && <div className="mt-2 text-xs font-bold text-[var(--color-ggd-neon-green)]">✓ Replay khớp result digest của race #{raceId}</div>}
          {verifyState === 'mismatch' && <div className="mt-2 text-xs font-bold text-[var(--color-ggd-orange)]">⚠ Replay không khớp digest đã lưu — có thể do balance/engine đổi sau race.</div>}
          {verifyState === 'unsupported' && <div className="mt-2 text-xs font-bold text-[var(--color-ggd-orange)]">⚠ Balance/engine version này không còn được replay chính xác trên client hiện tại.</div>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={paused ? play : () => setPaused(true)} className="rounded-xl bg-[var(--color-ggd-gold)] px-5 py-2 font-black text-[var(--color-ggd-outline)] shadow transition hover:brightness-110">{finished ? '↻ CHẠY LẠI' : paused ? '▶ PLAY REPLAY' : '⏸ PAUSE'}</button>
          {([1, 2, 4] as const).map((value) => <button key={value} onClick={() => setSpeed(value)} className={`rounded-xl border-2 px-3 py-2 text-sm font-black transition ${speed === value ? 'border-[var(--color-ggd-neon-green)] text-[var(--color-ggd-neon-green)] bg-[var(--color-ggd-neon-green)]/10' : 'border-white/15 text-white/55 hover:border-white/30'}`}>{value}×</button>)}
        </div>
      </div>

      <div className="relative">
        <PhaserRaceCanvas key={`${raceId}-${runId}`} raceId={raceId} players={players} replayConfig={config} replayManualInputs={inputs} replaySpeed={speed} replayPaused={!started || paused} onReplayInspect={inspect} />
        {!started && <button onClick={play} className="absolute inset-0 z-10 m-auto h-20 w-52 rounded-2xl border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-gold)] font-display text-2xl text-[var(--color-ggd-outline)] shadow-[0_7px_0_var(--color-ggd-outline)] transition hover:scale-105">▶ PLAY REPLAY</button>}
      </div>

      {/* Replay Synchronized Leaderboard & Event Feed */}
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2 border-b border-white/10 pb-2">
          <button
            type="button"
            onClick={() => setActiveTab('leaderboard')}
            className={`rounded-xl px-4 py-2 text-sm font-black transition ${
              activeTab === 'leaderboard'
                ? 'bg-[var(--color-ggd-neon-green)] text-[var(--color-ggd-outline)] shadow'
                : 'bg-black/30 text-white/60 hover:text-white'
            }`}
          >
            🏆 BXH Thời Điểm ({String(Math.floor(elapsedSeconds / 60)).padStart(2, '0')}:{String(elapsedSeconds % 60).padStart(2, '0')})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('combat')}
            className={`rounded-xl px-4 py-2 text-sm font-black transition ${
              activeTab === 'combat'
                ? 'bg-rose-500 text-white shadow'
                : 'bg-black/30 text-white/60 hover:text-white'
            }`}
          >
            ⚔️ Tấn Công & Đối Đầu ({combatAnalytics.totalAttacks})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('timeline')}
            className={`rounded-xl px-4 py-2 text-sm font-black transition ${
              activeTab === 'timeline'
                ? 'bg-[var(--color-ggd-gold)] text-[var(--color-ggd-outline)] shadow'
                : 'bg-black/30 text-white/60 hover:text-white'
            }`}
          >
            📜 Nhật Ký Sự Kiện ({events.length})
          </button>
        </div>

        {activeTab === 'leaderboard' && (
          <LiveLeaderboardSnapshot players={players} ducks={latestDucks} />
        )}
        {activeTab === 'combat' && (
          <CombatEncountersPanel events={events} players={players} />
        )}
        {activeTab === 'timeline' && (
          <RaceEventTimeline events={events} players={players} currentTick={tick} />
        )}
      </div>
    </section>
  )
}
