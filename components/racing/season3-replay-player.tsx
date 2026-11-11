import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DuckSnapshot, RaceConfig, RaceEvent, RaceItemId } from '@/src/engine/protocol'
import { manualInputsFromEvents, raceFinishedTick, readStoredEvents } from '@/src/race/event-vocab'
import { fidelityBadge, planReplay, REPLAY_UNAVAILABLE_COPY } from '@/src/race/replay-plan'
import type { RaceReplayInfo } from '@/src/race/types'
import { extractCombatEncounters } from '@/src/race/combat-encounters'
import { PhaserRaceCanvas, type RaceSource, type ReplayInspection } from './phaser-race-canvas'
import { LiveLeaderboardSnapshot } from './live-leaderboard-snapshot'
import { RaceEventTimeline } from './race-event-timeline'
import { CombatEncountersPanel } from './combat-encounters-panel'
import type { ReplayTrackState } from './use-replay-track'

type ReplayPlayer = {
  playerId: string
  name: string
  avatarUrl?: string | null
  itemIds?: RaceItemId[]
}

function clock(tick: number, tickRate: number) {
  const seconds = Math.floor(tick / tickRate)
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

/**
 * Finished-race replay. Plays the recorded track whenever the race has one (with its fidelity badge),
 * re-simulates only a current-version race without a track, and otherwise shows no canvas.
 * `events` are the stored events in id order (GET /api/races/:id).
 */
export function Season3ReplayPlayer({
  raceId,
  players,
  config,
  events = [],
  replay,
  trackState,
}: {
  raceId: number
  players: ReplayPlayer[]
  /** The stored config, unparsed: it may come from another engine version. */
  config: RaceConfig | null
  events?: RaceEvent[]
  replay?: RaceReplayInfo | null
  trackState: ReplayTrackState
}) {
  const stored = useMemo(() => readStoredEvents(events), [events])
  const plan = planReplay({ replay, config, eventsUsable: stored.usable, trackFailed: trackState.status === 'error' })
  const tickRate = (trackState.status === 'ready' ? trackState.track.header.tickRate : Number(config?.tickRate)) || 60

  const [started, setStarted] = useState(false)
  const [paused, setPaused] = useState(true)
  const [finished, setFinished] = useState(false)
  const [speed, setSpeed] = useState<1 | 2 | 4>(1)
  const [tick, setTick] = useState(0)
  const [endTick, setEndTick] = useState<number | null>(null)
  const [seekRequest, setSeekRequest] = useState<{ tick: number; nonce: number } | null>(null)
  const [latestDucks, setLatestDucks] = useState<DuckSnapshot[]>([])
  const [activeTab, setActiveTab] = useState<'leaderboard' | 'timeline' | 'combat'>('leaderboard')
  const lastReportedTick = useRef(-1)
  const finishedRef = useRef(false)
  const combatAnalytics = useMemo(() => extractCombatEncounters(stored.timeline, players), [stored.timeline, players])

  const source = useMemo<RaceSource | null>(() => {
    if (plan === 'track' && trackState.status === 'ready') {
      return { kind: 'recording', track: trackState.track, events: stored.engine, geometry: trackState.geometry, chaosType: config?.chaosConfig?.type }
    }
    if (plan === 'sim' && config) {
      return { kind: 'sim', config, manualInputs: manualInputsFromEvents(stored.engine), endTick: raceFinishedTick(stored.engine) }
    }
    return null
  }, [config, plan, stored.engine, trackState])
  const sourceEndTick = source?.kind === 'recording' ? source.track.lastTick : source?.kind === 'sim' ? source.endTick ?? null : null
  const knownEndTick = endTick ?? sourceEndTick

  // Reset playback when a different race (or source) is shown: state during render, refs in an effect.
  const replayKey = `${raceId}:${plan}:${source?.kind ?? 'none'}`
  const [shownReplayKey, setShownReplayKey] = useState(replayKey)
  if (shownReplayKey !== replayKey) {
    setShownReplayKey(replayKey)
    setStarted(false)
    setPaused(true)
    setFinished(false)
    setTick(0)
    setEndTick(null)
    setSeekRequest(null)
    setLatestDucks([])
  }

  useEffect(() => {
    lastReportedTick.current = -1
    finishedRef.current = false
  }, [replayKey])

  const inspect = useCallback((state: ReplayInspection) => {
    if (state.endTick !== undefined && state.endTick !== null) setEndTick(state.endTick)
    if (state.seeked || state.finished || state.tick - lastReportedTick.current >= Math.max(1, Math.floor(tickRate / 4))) {
      lastReportedTick.current = state.tick
      setTick(state.tick)
      setLatestDucks(state.ducks)
    }
    if (state.finished && !finishedRef.current) {
      finishedRef.current = true
      setFinished(true)
      setPaused(true)
      setEndTick(state.tick)
    } else if (!state.finished && finishedRef.current) {
      finishedRef.current = false
      setFinished(false)
    }
  }, [tickRate])

  const seek = useCallback((target: number) => {
    setTick(target)
    setSeekRequest((current) => ({ tick: target, nonce: (current?.nonce ?? 0) + 1 }))
  }, [])

  function play() {
    if (finished) seek(0)
    setStarted(true)
    setPaused(false)
  }

  const badge = fidelityBadge(replay)
  const shownEngine = replay?.mode === 'track'
    ? `${replay.engineVersion ?? '?'}/${replay.balanceVersion ?? '?'}`
    : `${String(config?.engineVersion ?? '?')}/${String(config?.balanceVersion ?? '?')}`
  const seedTail = typeof config?.seed === 'string' ? config.seed.slice(-8) : '—'

  if (plan === 'unavailable') {
    return (
      <section className="space-y-4">
        <div className="gx-panel p-5 text-center" data-testid="replay-unavailable">
          <div className="font-black">🎬 RACE REPLAY · Race #{raceId}</div>
          <p className="mt-2 font-black text-[var(--color-ggd-orange)]">{REPLAY_UNAVAILABLE_COPY}</p>
          <p className="mt-1 text-xs text-white/50">engine {shownEngine} · kết quả, diễn biến và thống kê từ event log vẫn xem được bên dưới.</p>
        </div>
        {stored.timeline.length > 0 && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 border-b border-white/10 pb-2">
              <button type="button" onClick={() => setActiveTab('timeline')} className={`rounded-xl px-4 py-2 text-sm font-black transition ${activeTab !== 'combat' ? 'bg-[var(--color-ggd-gold)] text-[var(--color-ggd-outline)] shadow' : 'bg-black/30 text-white/60 hover:text-white'}`}>📜 Nhật Ký Sự Kiện ({stored.timeline.length})</button>
              <button type="button" onClick={() => setActiveTab('combat')} className={`rounded-xl px-4 py-2 text-sm font-black transition ${activeTab === 'combat' ? 'bg-rose-500 text-white shadow' : 'bg-black/30 text-white/60 hover:text-white'}`}>⚔️ Tấn Công & Đối Đầu ({combatAnalytics.totalAttacks})</button>
            </div>
            {activeTab === 'combat'
              ? <CombatEncountersPanel events={stored.timeline} players={players} />
              : <RaceEventTimeline events={stored.timeline} players={players} />}
          </div>
        )}
      </section>
    )
  }

  const scrubMax = knownEndTick ?? Math.max(tick, 1)

  return (
    <section className="space-y-4" data-testid="replay-player" data-replay-source={source?.kind ?? 'loading'}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-black">🎬 RACE REPLAY · Race #{raceId} · {replay?.mode === 'track' ? replay.balanceVersion : String(config?.balanceVersion ?? '')}</div>
          <div className="mt-1 text-xs font-black text-white/50">
            seed …{seedTail} · {shownEngine} · {clock(tick, tickRate)} · {finished ? 'FINISHED' : paused ? 'PAUSED' : 'PLAYING'}
          </div>
          {badge && <div className="mt-2 text-xs font-bold text-[var(--color-ggd-neon-green)]" data-testid="replay-fidelity">{badge}</div>}
          {plan === 'sim' && <div className="mt-2 text-xs font-bold text-white/55">↻ Mô phỏng lại từ seed bằng engine hiện tại ({shownEngine})</div>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button disabled={!source} onClick={paused ? play : () => setPaused(true)} className="rounded-xl bg-[var(--color-ggd-gold)] px-5 py-2 font-black text-[var(--color-ggd-outline)] shadow transition hover:brightness-110 disabled:opacity-50">{finished ? '↻ CHẠY LẠI' : paused ? '▶ PLAY REPLAY' : '⏸ PAUSE'}</button>
          {([1, 2, 4] as const).map((value) => <button key={value} onClick={() => setSpeed(value)} className={`rounded-xl border-2 px-3 py-2 text-sm font-black transition ${speed === value ? 'border-[var(--color-ggd-neon-green)] text-[var(--color-ggd-neon-green)] bg-[var(--color-ggd-neon-green)]/10' : 'border-white/15 text-white/55 hover:border-white/30'}`}>{value}×</button>)}
        </div>
      </div>

      <div className="relative">
        {source
          ? <PhaserRaceCanvas key={`${raceId}-${source.kind}`} raceId={raceId} players={players} source={source} replaySpeed={speed} replayPaused={!started || paused} seekRequest={seekRequest} onReplayInspect={inspect} />
          : <div className="grid aspect-[16/9] max-h-[640px] min-h-[360px] w-full place-items-center rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-[#2f7a46] text-sm font-black text-white/70">Đang tải bản ghi race…</div>}
        {source && !started && <button onClick={play} className="absolute inset-0 z-10 m-auto h-20 w-52 rounded-2xl border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-gold)] gx-title text-2xl text-[var(--color-ggd-outline)] shadow-[0_7px_0_var(--color-ggd-outline)] transition hover:scale-105">▶ PLAY REPLAY</button>}
      </div>

      {source && (
        <label className="flex items-center gap-3 text-xs font-black text-white/60">
          <span className="w-12 tabular-nums">{clock(tick, tickRate)}</span>
          <input
            type="range"
            aria-label="Tua replay"
            data-testid="replay-scrubber"
            min={0}
            max={scrubMax}
            step={1}
            value={Math.min(tick, scrubMax)}
            disabled={knownEndTick === null}
            onChange={(event) => seek(Number(event.target.value))}
            className="h-2 flex-1 cursor-pointer accent-[var(--color-ggd-gold)] disabled:cursor-not-allowed"
          />
          <span className="w-12 text-right tabular-nums">{knownEndTick !== null ? clock(knownEndTick, tickRate) : '--:--'}</span>
        </label>
      )}

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
            🏆 BXH Thời Điểm ({clock(tick, tickRate)})
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
            📜 Nhật Ký Sự Kiện ({stored.timeline.length})
          </button>
        </div>

        {activeTab === 'leaderboard' && (
          <LiveLeaderboardSnapshot players={players} ducks={latestDucks} />
        )}
        {activeTab === 'combat' && (
          <CombatEncountersPanel events={stored.timeline} players={players} />
        )}
        {activeTab === 'timeline' && (
          <RaceEventTimeline events={stored.timeline} players={players} currentTick={tick} />
        )}
      </div>
    </section>
  )
}
