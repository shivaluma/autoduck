'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { RaceLiveView } from '@/app/race/[id]/race-live-view'
import { RaceCelebration } from '@/components/race-celebration'
import { Season3Avatar } from '@/components/season3-avatar'
import { PhaserRaceCanvas } from '@/components/racing/phaser-race-canvas'
import { Season3ReplayPlayer } from '@/components/racing/season3-replay-player'
import type { RaceStatus } from '@/lib/types'
import type { DuckAppearance } from '@/lib/cosmetics/types'

function parseAppearance(value?: string) {
  if (!value?.startsWith('{')) return null
  try { return JSON.parse(value) as DuckAppearance } catch { return null }
}

export function Season3RaceView({ raceId }: { raceId: number }) {
  const [race, setRace] = useState<RaceStatus | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    const fetchRace = async () => {
      const response = await fetch(`/api/races/${raceId}`)
      if (!active || !response.ok) return
      const nextRace = await response.json() as RaceStatus
      setRace(nextRace)
      setLoading(false)
    }
    void fetchRace()
    const interval = window.setInterval(() => {
      if (race?.status !== 'finished' && race?.status !== 'failed') void fetchRace()
    }, 2500)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [raceId, race?.status])

  const ranking = useMemo(() => [...(race?.participants ?? [])].sort((left, right) => (left.initialRank ?? 99) - (right.initialRank ?? 99)), [race])
  const racePlayers = useMemo(() => {
    const loadouts = new Map((race?.engine?.loadouts ?? []).map((loadout) => [loadout.playerId, loadout.itemIds]))
    const cosmetics = new Map((race?.engine?.config?.players ?? []).map((player) => [player.playerId, parseAppearance(player.cosmeticKey)]))
    return (race?.participants ?? []).filter((player) => !player.isClone).map((player) => ({
      playerId: String(player.userId),
      name: player.displayName ?? player.name,
      avatarUrl: player.avatarUrl,
      appearance: cosmetics.get(String(player.userId)) ?? null,
      itemIds: loadouts.get(String(player.userId)) ?? [],
    }))
  }, [race])

  if (loading) return <main className="flex min-h-screen items-center justify-center text-white"><div className="text-center"><div className="text-7xl">🦆</div><p className="mt-3 font-display text-2xl">Đang chuẩn bị race...</p></div></main>
  if (!race) return <main className="flex min-h-screen items-center justify-center text-white"><p>Không tìm thấy race.</p></main>

  const isLive = race.status === 'pending' || race.status === 'running'
  return <main className="mx-auto min-h-screen max-w-5xl space-y-6 p-6 text-white">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-xs font-black tracking-[0.25em] text-[var(--color-ggd-gold)]">ĐUA DZỊT · SEASON 3</div><h1 className="mt-1 font-display text-4xl">🏁 Duck Duck Race</h1></div><Link href="/season-3" className="rounded-xl border-2 border-white/20 px-4 py-2 font-black">POND</Link></header>
    {isLive && <><section className="rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] p-6 text-center"><div className="font-display text-4xl text-[var(--color-ggd-neon-green)]">RACE ĐANG CHẠY 🏃💨</div><p className="mt-2 text-white/65">BXH tự cập nhật khi race kết thúc.</p></section>{race.engine ? <PhaserRaceCanvas raceId={raceId} players={racePlayers} chaosType={race.engine.chaosConfig?.type} /> : <RaceLiveView raceId={raceId} season3Mode />}</>}
    {race.status === 'failed' && <section className="rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] p-6 text-center"><div className="font-display text-3xl text-[var(--color-ggd-orange)]">Race lỗi</div><p className="mt-2 text-white/65">Host có thể quay lại admin để chạy lại.</p></section>}
    {race.status === 'finished' && <><RaceCelebration duration={5000} allPlayers={ranking.map((player) => ({ name: player.displayName ?? player.name, avatarUrl: player.avatarUrl, gotScar: player.gotScar, usedShield: player.usedShield, initialRank: player.initialRank }))} victims={ranking.filter((player) => player.gotScar).map((player) => ({ name: player.displayName ?? player.name, avatarUrl: player.avatarUrl }))} verdict={race.finalVerdict} /><section className="rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] p-6 text-center"><div className="text-5xl">📰</div><div className="mt-2 font-display text-3xl">RACE COMPLETE</div><p className="mt-3 text-lg font-black text-[var(--color-ggd-gold)]">{race.finalVerdict}</p><p className="mt-2 text-white/60">Chaos, Shield, King và Prediction đã được resolve.</p></section>{race.engine?.config && <Season3ReplayPlayer raceId={raceId} players={racePlayers} config={race.engine.config} />}{race.videoUrl && <section className="overflow-hidden rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-black"><div className="border-b-2 border-white/10 px-5 py-4 font-black text-white">🎬 RACE REPLAY</div><video src={race.videoUrl} controls playsInline className="w-full" /></section>}<section className="overflow-hidden rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)]"><div className="border-b-2 border-white/10 px-5 py-4 font-black">FINAL RANKING</div>{ranking.map((player, index) => <div key={`${player.userId}-${player.cloneIndex ?? 'main'}`} className="flex items-center gap-3 border-b border-white/10 px-5 py-4 last:border-0"><span className="w-8 text-2xl font-black text-white/45">{index + 1}</span><Season3Avatar name={player.displayName ?? player.name} avatarUrl={player.avatarUrl} size={40} /><span className="flex-1 font-black">{player.displayName ?? player.name}</span>{player.usedShield && <span className="rounded-full bg-[var(--color-ggd-sky)] px-2 py-1 text-xs font-black text-[var(--color-ggd-outline)]">🛡️ ĐÃ DÙNG</span>}{player.gotScar && <span className="rounded-full bg-[var(--color-ggd-orange)] px-2 py-1 text-xs font-black">BỊ LÀM DZỊT</span>}</div>)}</section>{race.commentaries.length > 0 && <section className="rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] p-5"><h2 className="font-display text-2xl">🎤 MC Vịt</h2><div className="mt-4 space-y-2">{race.commentaries.map((commentary) => <p key={`${commentary.timestamp}-${commentary.content}`} className="rounded-xl bg-black/20 p-3 text-white/80">{commentary.content}</p>)}</div></section>}</>}
  </main>
}
