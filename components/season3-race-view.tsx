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
import { GameLink, GamePanel, UiIcon } from '@/components/game-ui'
import type { UiIconName } from '@/lib/race-fx/manifest'

const RESULT_TABS = [
  { id: 'result', label: 'Kết quả', icon: 'trophy' },
  { id: 'combat', label: 'Đối đầu', icon: 'cards' },
  { id: 'stats', label: 'Thống kê', icon: 'crystal' },
  { id: 'timeline', label: 'Diễn biến', icon: 'news' },
] as const satisfies ReadonlyArray<{ id: string; label: string; icon: UiIconName }>

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
  const [resultTab, setResultTab] = useState<typeof RESULT_TABS[number]['id']>('result')

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

  if (loading) return <main className="flex min-h-screen items-center justify-center text-white"><div className="flex flex-col items-center gap-3"><UiIcon name="duck" size={96} className="gx-float drop-shadow-[0_6px_0_var(--gx-ink)]" /><p className="gx-title text-3xl">Đang chuẩn bị race…</p></div></main>
  if (!race) return <main className="flex min-h-screen items-center justify-center p-6 text-white"><GamePanel tone="dark" icon="flag" title="Không tìm thấy race"><GameLink href="/season-3" variant="ghost" icon="duck">Về ao</GameLink></GamePanel></main>

  const isLive = race.status === 'pending' || race.status === 'running'
  const victims = officialRanking.filter((player) => player.gotScar)
  const victimNames = victims.map((p) => p.displayName ?? p.name)

  const appearanceById = new Map(racePlayers.map((player) => [player.playerId, player.appearance]))
  const podium = officialRanking.slice(0, 3)

  return <main className="mx-auto min-h-screen max-w-5xl space-y-6 px-3 pb-16 pt-3 text-white sm:px-6">
    <header className="sticky top-2 z-30 flex items-center gap-3 rounded-[22px] border-[3px] border-[var(--gx-ink)] bg-[linear-gradient(180deg,rgba(43,31,92,.96),rgba(27,19,58,.96))] px-3 py-2 shadow-[0_6px_0_var(--gx-ink)] backdrop-blur sm:px-4">
      <UiIcon name="flag" size={36} className="drop-shadow-[0_3px_0_var(--gx-ink)]" />
      <div className="min-w-0">
        <div className="gx-kicker text-[var(--gx-gold)]">ĐUA DZỊT · SEASON 3</div>
        <h1 className="gx-title truncate text-2xl sm:text-3xl">Race #{raceId}</h1>
      </div>
      {isLive && <span className="gx-chip ml-2 pl-2 text-[#86efac]"><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[var(--gx-mint)]" />LIVE</span>}
      <Link href="/season-3" className="gx-btn ml-auto" data-variant="ghost" data-size="sm"><UiIcon name="duck" size={20} />Về ao</Link>
    </header>

    {/* Personalized User Prediction Banner */}
    {race.seasonPrediction && (
      <section className="gx-panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-3xl">🔮</span>
            <div>
              <div className="text-xs font-black tracking-[0.15em] text-[var(--color-ggd-gold)] uppercase">DỰ ĐOÁN TIÊN TRI CỦA BẠN</div>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-sm text-white/80">Bạn đã đặt cược chú vịt:</span>
                <span className="gx-title text-2xl text-[var(--color-ggd-gold)]">{race.seasonPrediction.targetName}</span>
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
      <div className="gx-panel flex items-center gap-4 px-5 py-4" data-tone="mint">
        <UiIcon name="flag" size={44} className="gx-float" />
        <div><div className="gx-title text-3xl">Cuộc đua đang diễn ra!</div><p className="text-sm text-white/75">Bảng xếp hạng và diễn biến cập nhật trực tiếp.</p></div>
      </div>

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
        <div role="tablist" className="flex flex-wrap gap-1 rounded-[20px] border-[3px] border-[var(--gx-ink)] bg-[rgba(20,14,44,.92)] p-1.5 shadow-[0_5px_0_var(--gx-ink)]">
          <button type="button" role="tab" aria-selected={liveTab === 'leaderboard'} onClick={() => setLiveTab('leaderboard')} className="gx-tab"><UiIcon name="trophy" size={24} />BXH trực tiếp <span className="font-data text-xs opacity-70">{liveDucks.length > 0 ? liveDucks.length : officialRanking.length}</span></button>
          <button type="button" role="tab" aria-selected={liveTab === 'timeline'} onClick={() => setLiveTab('timeline')} className="gx-tab"><UiIcon name="news" size={24} />Diễn biến <span className="font-data text-xs opacity-70">{liveEvents.length}</span></button>
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
      <section className="gx-panel p-6 text-center">
        <div className="gx-title text-3xl text-[var(--color-ggd-orange)]">Race lỗi</div>
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

      <section className="gx-panel overflow-hidden px-5 pb-0 pt-5 text-center" data-tone="gold">
        <div className="gx-kicker text-[#ffe58a]">VỀ ĐÍCH · KẾT QUẢ CHÍNH THỨC</div>
        <h2 className="gx-title mt-1 text-4xl sm:text-5xl">Cuộc đua kết thúc!</h2>
        <p className="mx-auto mt-2 max-w-2xl text-base font-black text-[#fff3a6]">{race.finalVerdict}</p>
        <div className="mx-auto mt-5 grid max-w-xl grid-cols-3 items-end gap-2 sm:gap-4">
          {[1, 0, 2].map((place) => {
            const player = podium[place]
            if (!player) return <div key={place} />
            const name = player.displayName ?? player.name
            return <div key={place} className="flex flex-col items-center">
              <Season3Avatar name={name} avatarUrl={player.avatarUrl} appearance={appearanceById.get(String(player.userId))} size={place === 0 ? 92 : 72} ring={place === 0 ? 'var(--gx-gold)' : undefined} />
              <div className="mt-1 w-full truncate text-sm font-black">{name}</div>
              <div className={`mt-2 grid w-full place-items-center rounded-t-2xl border-[3px] border-b-0 border-[var(--gx-ink)] shadow-[inset_0_3px_0_rgba(255,255,255,.5)] ${['h-24 bg-[linear-gradient(180deg,#fff3a6,#f2b627)]', 'h-16 bg-[linear-gradient(180deg,#f1f5f9,#94a3b8)]', 'h-12 bg-[linear-gradient(180deg,#fed7aa,#ea580c)]'][place]}`}>
                <span className="gx-title text-3xl text-[var(--gx-ink)] [text-shadow:none]">{place + 1}</span>
              </div>
            </div>
          })}
        </div>
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

      <div role="tablist" className="sticky top-[78px] z-20 flex flex-wrap gap-1 rounded-[20px] border-[3px] border-[var(--gx-ink)] bg-[rgba(20,14,44,.92)] p-1.5 shadow-[0_5px_0_var(--gx-ink)] backdrop-blur">
        {RESULT_TABS.map((entry) => <button key={entry.id} type="button" role="tab" aria-selected={resultTab === entry.id} onClick={() => setResultTab(entry.id)} className="gx-tab"><UiIcon name={entry.icon} size={24} />{entry.label}</button>)}
      </div>

      <div key={resultTab} className="gx-pop-in space-y-6">
      {resultTab === 'combat' && race.engine?.events && race.engine.events.length > 0 && (
        <CombatEncountersPanel events={race.engine.events} players={racePlayers} />
      )}
      {resultTab === 'stats' && race.engine?.config && race.engine.events.length > 0 && (
        <PostRaceStatsPanel config={race.engine.config} events={race.engine.events} players={racePlayers} />
      )}
      {resultTab === 'timeline' && race.engine?.events && race.engine.events.length > 0 && (
        <RaceEventTimeline events={race.engine.events} players={racePlayers} />
      )}
      {resultTab === 'result' && <>
      {/* Video Replay if available */}
      {race.videoUrl && (
        <section className="overflow-hidden rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-black">
          <div className="border-b-2 border-white/10 px-5 py-4 font-black text-white">🎬 RACE REPLAY VIDEO</div>
          <video src={race.videoUrl} controls playsInline className="w-full" />
        </section>
      )}

      {/* Official Final Rankings */}
      <section className="gx-panel overflow-hidden">
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
            <Season3Avatar name={player.displayName ?? player.name} avatarUrl={player.avatarUrl} appearance={appearanceById.get(String(player.userId))} size={44} />
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
              <Season3Avatar name={player.displayName ?? player.name} avatarUrl={player.avatarUrl} appearance={appearanceById.get(String(player.userId))} size={44} />
              <span className="flex-1 font-black text-white/75">{player.displayName ?? player.name}</span>
              <span className="rounded-full bg-white/10 px-2 py-1 text-xs font-black text-white/55">KHÔNG BỊ LÀM DZỊT</span>
              {player.initialRank && <span className="text-xs text-white/40">track #{player.initialRank}</span>}
            </div>
          ))}
        </section>
      )}

      {/* Revealed Predictions from all users */}
      {race.seasonPredictions && race.seasonPredictions.length > 0 && (
        <section className="gx-panel overflow-hidden">
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
        <section className="gx-panel p-5">
          <h2 className="gx-title text-2xl">🎤 MC Vịt</h2>
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
      </div>
    </>}
  </main>
}
