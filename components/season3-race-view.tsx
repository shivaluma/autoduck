'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { RaceLiveView } from '@/app/race/[id]/race-live-view'
import { RaceCelebration } from '@/components/race-celebration'
import { Season3Avatar } from '@/components/season3-avatar'
import { PhaserRaceCanvas, type ReplayInspection } from '@/components/racing/phaser-race-canvas'
import { Season3ReplayPlayer } from '@/components/racing/season3-replay-player'
import { PostRaceStatsPanel } from '@/components/racing/post-race-stats-panel'
import { LiveLeaderboardSnapshot } from '@/components/racing/live-leaderboard-snapshot'
import { RaceEventTimeline } from '@/components/racing/race-event-timeline'
import { CombatEncountersPanel } from '@/components/racing/combat-encounters-panel'
import type { RaceStatus } from '@/lib/types'
import type { DuckAppearance } from '@/lib/cosmetics/types'
import type { DuckSnapshot, RaceEvent } from '@/packages/race-protocol/src'

function parseAppearance(value?: string) {
  if (!value?.startsWith('{')) return null
  try { return JSON.parse(value) as DuckAppearance } catch { return null }
}

export function Season3RaceView({ raceId }: { raceId: number }) {
  const [race, setRace] = useState<RaceStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [liveDucks, setLiveDucks] = useState<DuckSnapshot[]>([])
  const [liveTick, setLiveTick] = useState(0)
  const [liveEvents, setLiveEvents] = useState<RaceEvent[]>([])
  const [liveTab, setLiveTab] = useState<'leaderboard' | 'timeline'>('leaderboard')

  const fetchRace = useCallback(async () => {
    const token = typeof window !== 'undefined'
      ? (new URLSearchParams(window.location.search).get('token') || window.localStorage.getItem('autoduck_season3_token') || '')
      : ''
    const url = token ? `/api/races/${raceId}?token=${encodeURIComponent(token)}` : `/api/races/${raceId}`
    const response = await fetch(url)
    if (!response.ok) return
    const nextRace = await response.json() as RaceStatus
    setRace(nextRace)
    setLoading(false)
  }, [raceId])

  useEffect(() => {
    let active = true
    setLoading(true)
    setRace(null)
    setLiveDucks([])
    setLiveTick(0)
    setLiveEvents([])

    void fetchRace()

    const interval = window.setInterval(() => {
      const token = typeof window !== 'undefined'
        ? (new URLSearchParams(window.location.search).get('token') || window.localStorage.getItem('autoduck_season3_token') || '')
        : ''
      const url = token ? `/api/races/${raceId}?token=${encodeURIComponent(token)}` : `/api/races/${raceId}`
      void fetch(url).then(async (response) => {
        if (!active || !response.ok) return
        const nextRace = await response.json() as RaceStatus
        if (nextRace.status === 'finished' || nextRace.status === 'failed') {
          setRace(nextRace)
          window.clearInterval(interval)
          return
        }
        setRace(nextRace)
      })
    }, 2000)

    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [raceId, fetchRace])

  const ranking = useMemo(() => [...(race?.participants ?? [])].sort((left, right) => (left.initialRank ?? 99) - (right.initialRank ?? 99)), [race])
  const officialRanking = useMemo(() => ranking.filter((player) => !player.isGhost && !player.isClone), [ranking])
  const ghostDucks = useMemo(() => ranking.filter((player) => player.isGhost && !player.isClone), [ranking])
  const racePlayers = useMemo(() => {
    const configPlayers = new Map((race?.engine?.config?.players ?? []).map((player) => [player.playerId, player]))
    const loadouts = new Map((race?.engine?.loadouts ?? race?.engine?.config?.loadouts ?? []).map((loadout) => [loadout.playerId, loadout.itemIds]))
    return (race?.participants ?? []).filter((player) => !player.isClone).map((player) => {
      const playerId = String(player.userId)
      const configPlayer = configPlayers.get(playerId)
      return {
        playerId,
        name: configPlayer?.name ?? player.displayName ?? player.name,
        avatarUrl: player.avatarUrl,
        appearance: parseAppearance(configPlayer?.cosmeticKey) ?? null,
        itemIds: loadouts.get(playerId) ?? [],
        isGhost: player.isGhost ?? configPlayer?.isGhost ?? false,
      }
    })
  }, [race])

  const handleLiveInspect = useCallback((inspection: ReplayInspection) => {
    setLiveTick(inspection.tick)
    setLiveDucks(inspection.ducks)
    if (inspection.newEvents && inspection.newEvents.length > 0) {
      setLiveEvents((prev) => [...prev, ...inspection.newEvents])
    }
  }, [])

  const handleLiveFinished = useCallback(() => {
    void fetchRace()
  }, [fetchRace])

  if (loading) return <main className="flex min-h-screen items-center justify-center text-white"><div className="text-center"><div className="text-7xl">🦆</div><p className="mt-3 font-display text-2xl">Đang chuẩn bị race...</p></div></main>
  if (!race) return <main className="flex min-h-screen items-center justify-center text-white"><p>Không tìm thấy race.</p></main>

  const isLive = race.status === 'pending' || race.status === 'running'
  const victims = officialRanking.filter((player) => player.gotScar)
  const victimNames = victims.map((p) => p.displayName ?? p.name)

  return <main className="mx-auto min-h-screen max-w-5xl space-y-6 p-6 text-white">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <div className="text-xs font-black tracking-[0.25em] text-[var(--color-ggd-gold)]">ĐUA DZỊT · SEASON 3</div>
        <h1 className="mt-1 font-display text-4xl">🏁 Duck Duck Race #{raceId}</h1>
      </div>
      <Link href="/season-3" className="rounded-xl border-2 border-white/20 px-4 py-2 font-black hover:bg-white/10 transition">
        🏠 POND
      </Link>
    </header>

    {/* Personalized User Prediction Banner */}
    {race.seasonPrediction && (
      <section className="rounded-3xl border-4 border-[var(--color-ggd-gold)] bg-[linear-gradient(135deg,rgba(255,204,0,0.18),rgba(36,21,72,0.9))] p-5 shadow-[0_6px_0_var(--color-ggd-outline)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-3xl">🔮</span>
            <div>
              <div className="text-xs font-black tracking-[0.15em] text-[var(--color-ggd-gold)] uppercase">DỰ ĐOÁN TIÊN TRI CỦA BẠN</div>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-sm text-white/80">Bạn đã đặt cược chú vịt:</span>
                <span className="font-display text-2xl text-[var(--color-ggd-gold)]">{race.seasonPrediction.targetName}</span>
                <span className="text-xs text-white/60">sẽ bị làm Dzịt (top 2 cuối).</span>
              </div>
            </div>
          </div>
          {race.status === 'finished' && (
            <div className={`rounded-2xl border-2 px-4 py-2 font-black ${
              victimNames.includes(race.seasonPrediction.targetName)
                ? 'border-emerald-400 bg-emerald-500/20 text-emerald-300'
                : 'border-white/20 bg-black/30 text-white/60'
            }`}>
              {victimNames.includes(race.seasonPrediction.targetName)
                ? '🎉 ĐOÁN CHÍNH XÁC (+1 🔮)!'
                : '✕ Không chính xác'}
            </div>
          )}
        </div>
      </section>
    )}

    {/* LIVE RACING VIEW */}
    {isLive && <>
      <section className="rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] p-6 text-center shadow-[0_6px_0_var(--color-ggd-outline)]">
        <div className="font-display text-4xl text-[var(--color-ggd-neon-green)] animate-pulse">RACE ĐANG CHẠY 🏃💨</div>
        <p className="mt-2 text-white/65">BXH và Sự kiện tự động cập nhật trực tiếp theo diễn biến đường đua.</p>
      </section>

      {race.engine ? (
        <PhaserRaceCanvas
          raceId={raceId}
          players={racePlayers}
          chaosType={race.engine.chaosConfig?.type}
          liveConfig={race.engine.config}
          liveSyncTick={race.engine.liveTick ?? undefined}
          liveManualInputs={race.engine.liveManualInputs}
          onReplayInspect={handleLiveInspect}
          onLiveFinished={handleLiveFinished}
        />
      ) : (
        <RaceLiveView raceId={raceId} season3Mode />
      )}

      {/* Live Tabs: Standings & Live Events */}
      <div className="space-y-3">
        <div className="flex gap-2 border-b border-white/10 pb-2">
          <button
            type="button"
            onClick={() => setLiveTab('leaderboard')}
            className={`rounded-xl px-4 py-2 text-sm font-black transition ${
              liveTab === 'leaderboard'
                ? 'bg-[var(--color-ggd-neon-green)] text-[var(--color-ggd-outline)] shadow'
                : 'bg-black/30 text-white/60 hover:text-white'
            }`}
          >
            🏆 BXH Trực Tiếp ({liveDucks.length > 0 ? liveDucks.length : officialRanking.length})
          </button>
          <button
            type="button"
            onClick={() => setLiveTab('timeline')}
            className={`rounded-xl px-4 py-2 text-sm font-black transition ${
              liveTab === 'timeline'
                ? 'bg-[var(--color-ggd-gold)] text-[var(--color-ggd-outline)] shadow'
                : 'bg-black/30 text-white/60 hover:text-white'
            }`}
          >
            📜 Nhật Ký Diễn Biến ({liveEvents.length})
          </button>
        </div>

        {liveTab === 'leaderboard' ? (
          <LiveLeaderboardSnapshot players={racePlayers} ducks={liveDucks} isLive />
        ) : (
          <RaceEventTimeline events={liveEvents} players={racePlayers} currentTick={liveTick} />
        )}
      </div>
    </>}

    {/* FAILED VIEW */}
    {race.status === 'failed' && (
      <section className="rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] p-6 text-center">
        <div className="font-display text-3xl text-[var(--color-ggd-orange)]">Race lỗi</div>
        <p className="mt-2 text-white/65">Host có thể quay lại admin để chạy lại.</p>
      </section>
    )}

    {/* FINISHED VIEW */}
    {race.status === 'finished' && <>
      <RaceCelebration
        duration={5000}
        allPlayers={officialRanking.map((player) => ({
          name: player.displayName ?? player.name,
          avatarUrl: player.avatarUrl,
          gotScar: player.gotScar,
          usedShield: player.usedShield,
          initialRank: player.initialRank,
        }))}
        victims={officialRanking.filter((player) => player.gotScar).map((player) => ({
          name: player.displayName ?? player.name,
          avatarUrl: player.avatarUrl,
        }))}
        verdict={race.finalVerdict}
      />

      <section className="rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] p-6 text-center shadow-[0_6px_0_var(--color-ggd-outline)]">
        <div className="text-5xl">📰</div>
        <div className="mt-2 font-display text-3xl">RACE COMPLETE</div>
        <p className="mt-3 text-lg font-black text-[var(--color-ggd-gold)]">{race.finalVerdict}</p>
        <p className="mt-2 text-white/60">Chaos, Shield, King và Prediction đã được giải quyết hoàn tất.</p>
      </section>

      {/* Replay Player with synced Leaderboard & Event Log */}
      {race.engine?.config && (
        <Season3ReplayPlayer
          key={raceId}
          raceId={raceId}
          players={racePlayers}
          config={race.engine.config}
          events={race.engine.events}
          resultDigest={race.engine.resultDigest}
        />
      )}

      {/* Combat Encounters & Duel Log */}
      {race.engine?.events && race.engine.events.length > 0 && (
        <CombatEncountersPanel events={race.engine.events} players={racePlayers} />
      )}

      {/* Post Race Stats Analytics */}
      {race.engine?.config && race.engine.events.length > 0 && (
        <PostRaceStatsPanel config={race.engine.config} events={race.engine.events} players={racePlayers} />
      )}

      {/* Full Chronological Race Event Timeline */}
      {race.engine?.events && race.engine.events.length > 0 && (
        <RaceEventTimeline events={race.engine.events} players={racePlayers} />
      )}

      {/* Video Replay if available */}
      {race.videoUrl && (
        <section className="overflow-hidden rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-black">
          <div className="border-b-2 border-white/10 px-5 py-4 font-black text-white">🎬 RACE REPLAY VIDEO</div>
          <video src={race.videoUrl} controls playsInline className="w-full" />
        </section>
      )}

      {/* Official Final Rankings */}
      <section className="overflow-hidden rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] shadow-[0_6px_0_var(--color-ggd-outline)]">
        <div className="border-b-2 border-white/10 px-5 py-4 font-black flex items-center justify-between">
          <span>🏆 BẢNG XẾP HẠNG CHÍNH THỨC</span>
          <span className="text-xs text-white/50">{officialRanking.length} Tuyển thủ</span>
        </div>
        {officialRanking.map((player, index) => (
          <div
            key={`${player.userId}-${player.cloneIndex ?? 'main'}`}
            className="flex items-center gap-3 border-b border-white/10 px-5 py-4 last:border-0 hover:bg-white/5 transition"
          >
            <span className={`w-8 text-2xl font-black ${
              index === 0 ? 'text-[var(--color-ggd-gold)]' : index === 1 ? 'text-slate-300' : index === 2 ? 'text-amber-600' : 'text-white/45'
            }`}>
              {index + 1}
            </span>
            <Season3Avatar name={player.displayName ?? player.name} avatarUrl={player.avatarUrl} size={40} />
            <span className="flex-1 font-black">{player.displayName ?? player.name}</span>
            {player.usedShield && (
              <span className="rounded-full bg-[var(--color-ggd-sky)] px-2.5 py-1 text-xs font-black text-[var(--color-ggd-outline)]">
                🛡️ ĐÃ DÙNG KHIÊN
              </span>
            )}
            {player.gotScar && (
              <span className="rounded-full bg-[var(--color-ggd-orange)] px-2.5 py-1 text-xs font-black text-white">
                🩹 BỊ LÀM DZỊT
              </span>
            )}
          </div>
        ))}
      </section>

      {/* Ghost Ducks */}
      {ghostDucks.length > 0 && (
        <section className="overflow-hidden rounded-3xl border-4 border-dashed border-white/20 bg-black/20">
          <div className="border-b border-white/10 px-5 py-4 font-black text-white/70">
            👻 GHOST DUCK — GÂY NHIỄU (KHÔNG TÍNH BXH)
          </div>
          {ghostDucks.map((player) => (
            <div key={`ghost-${player.userId}`} className="flex items-center gap-3 border-b border-white/10 px-5 py-4 last:border-0">
              <span className="w-8 text-xl font-black text-white/30">👻</span>
              <Season3Avatar name={player.displayName ?? player.name} avatarUrl={player.avatarUrl} size={40} />
              <span className="flex-1 font-black text-white/75">{player.displayName ?? player.name}</span>
              <span className="rounded-full bg-white/10 px-2 py-1 text-xs font-black text-white/55">KHÔNG BỊ LÀM DZỊT</span>
              {player.initialRank && <span className="text-xs text-white/40">track #{player.initialRank}</span>}
            </div>
          ))}
        </section>
      )}

      {/* Revealed Predictions from all users */}
      {race.seasonPredictions && race.seasonPredictions.length > 0 && (
        <section className="overflow-hidden rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] shadow-[0_6px_0_var(--color-ggd-outline)]">
          <div className="border-b-2 border-white/10 px-5 py-4 font-black flex items-center justify-between">
            <span>🔮 KẾT QUẢ TIÊN TRI CỦA TOÀN BỘ TUYỂN THỦ</span>
            <span className="text-xs text-white/50">{race.seasonPredictions.length} Dự đoán</span>
          </div>
          <div className="divide-y divide-white/10">
            {race.seasonPredictions.map((pred) => {
              const isCorrect = victimNames.includes(pred.targetName)
              return (
                <div key={`${pred.predictorName}-${pred.targetName}`} className="flex items-center justify-between px-5 py-3.5 text-sm">
                  <div className="flex items-center gap-2 font-black">
                    <span>{pred.predictorName}</span>
                    <span className="text-white/45">→ đoán →</span>
                    <span className="text-[var(--color-ggd-gold)]">{pred.targetName}</span>
                  </div>
                  <span className={`rounded-lg px-2.5 py-1 text-xs font-black ${
                    isCorrect
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'bg-white/5 text-white/40'
                  }`}>
                    {isCorrect ? '✓ Trúng (+1 🔮)' : '✕ Trượt'}
                  </span>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* MC Commentary */}
      {race.commentaries.length > 0 && (
        <section className="rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] p-5">
          <h2 className="font-display text-2xl">🎤 MC Vịt</h2>
          <div className="mt-4 space-y-2">
            {race.commentaries.map((commentary) => (
              <p key={`${commentary.timestamp}-${commentary.content}`} className="rounded-xl bg-black/20 p-3 text-white/80">
                {commentary.content}
              </p>
            ))}
          </div>
        </section>
      )}
    </>}
  </main>
}
