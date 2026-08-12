'use client'

import { useEffect, useMemo, useState } from 'react'
import { Season3ChaosCard } from '@/components/season3-chaos-card'

type AdminState = {
  season: { id: number; name: string; year: number; weeks: number; status: string } | null
  players: Array<{ id: number; name: string; personalLink: string; scars: number; shields: number; predictionPoints: number; isKing: boolean; kingStreak: number }>
  weeks: Array<{ id: number; weekNumber: number; status: string; chaosType: string; chaosTargetUserId: number | null; chaosTargetUserId2: number | null; chaosGroups?: number[][]; predictionCount: number; recap: string | null }>
}

async function callAdmin(secret: string, body?: Record<string, unknown>) {
  const response = await fetch('/api/admin/season3', {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'x-race-secret': secret },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { response, data: await response.json() as AdminState & { error?: string } }
}

export default function AdminSeason3Page() {
  const [secret, setSecret] = useState('')
  const [data, setData] = useState<AdminState | null>(null)
  const [message, setMessage] = useState('')
  const [rankings, setRankings] = useState<Record<number, number>>({})
  const [shields, setShields] = useState<number[]>([])

  const currentWeek = useMemo(() => data?.weeks.find((week) => week.status !== 'resolved') ?? null, [data])
  const nameById = useMemo(() => new Map((data?.players ?? []).map((player) => [player.id, player.name])), [data])

  async function refresh() {
    if (!secret) return
    const result = await callAdmin(secret)
    if (!result.response.ok) { setMessage(result.data.error ?? 'Không tải được admin data'); return }
    setData(result.data)
    setRankings((previous) => Object.keys(previous).length > 0 ? previous : Object.fromEntries(result.data.players.map((player, index) => [player.id, index + 1])))
  }

  useEffect(() => {
    const saved = window.localStorage.getItem('autoduck-season3-secret') ?? ''
    if (saved) { void callAdmin(saved).then((result) => { setSecret(saved); if (result.response.ok) setData(result.data) }) }
  }, [])

  async function act(body: Record<string, unknown>) {
    window.localStorage.setItem('autoduck-season3-secret', secret)
    const result = await callAdmin(secret, body)
    setMessage(result.data.error ?? (result.response.ok ? 'Đã cập nhật.' : 'Có lỗi.'))
    if (result.response.ok) await refresh()
  }

  return <main className="mx-auto max-w-6xl space-y-6 p-6 text-white">
    <header className="rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] p-6 shadow-[0_8px_0_var(--color-ggd-outline)]"><div className="text-sm font-black tracking-[0.25em] text-[var(--color-ggd-gold)]">HOST CONTROL</div><h1 className="mt-2 font-display text-4xl">🦆 Season 3 Resolve Desk</h1><p className="mt-3 text-white/70">Chaos reveal → lock prediction → nhập ranking vanilla → auto resolve.</p><div className="mt-5 flex flex-wrap gap-2"><input value={secret} onChange={(event) => setSecret(event.target.value)} placeholder="RACE_SECRET_KEY" type="password" className="rounded-xl border-2 border-white/20 bg-black/30 px-4 py-3" /><button onClick={() => void refresh()} className="rounded-xl bg-[var(--color-ggd-neon-green)] px-5 py-3 font-black text-[var(--color-ggd-outline)]">LOAD</button></div>{message && <p className="mt-3 text-sm text-[var(--color-ggd-gold)]">{message}</p>}</header>

    {!data?.season ? <section className="rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-surface-2)] p-5"><h2 className="font-display text-2xl">Chưa có Season active</h2><p className="mt-2 text-white/60">Tạo Season 3 với toàn bộ User hiện có.</p><button onClick={() => void act({ action: 'create-season', key: 'S3', name: 'ĐUA DZỊT — SEASON 3', weeks: 12 })} className="mt-4 rounded-xl bg-[var(--color-ggd-gold)] px-5 py-3 font-black text-[var(--color-ggd-outline)]">CREATE S3</button></section> : <>
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{data.players.map((player) => <div key={player.id} className="rounded-2xl border-2 border-white/15 bg-[var(--color-ggd-surface-2)] p-4"><div className="font-black">{player.isKing ? '👑 ' : ''}{player.name}</div><div className="mt-1 text-sm text-white/60">🩹 {player.scars} · 🛡️ {player.shields} · 🔮 {player.predictionPoints}</div><a className="mt-3 block truncate text-xs text-[var(--color-ggd-neon-green)]" href={player.personalLink}>{player.personalLink}</a></div>)}</section>
      {currentWeek && <Season3ChaosCard compact type={currentWeek.chaosType} weekNumber={currentWeek.weekNumber} targetName={nameById.get(currentWeek.chaosTargetUserId ?? -1)} groups={currentWeek.chaosGroups?.map((group) => group.map((id) => nameById.get(id) ?? String(id)))} predictionCount={currentWeek.predictionCount} playerCount={data.players.length} />}
      {currentWeek && <section className="rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] p-5"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-display text-2xl">WEEK {currentWeek.weekNumber} · {currentWeek.chaosType}</h2><span className="rounded-full bg-[var(--color-ggd-orange)] px-4 py-2 font-black">Predictions {currentWeek.predictionCount}/{data.players.length}</span></div><p className="mt-2 text-sm text-white/60">Target: {nameById.get(currentWeek.chaosTargetUserId ?? -1) ?? '—'}{currentWeek.chaosGroups ? ` · Groups: ${currentWeek.chaosGroups.map((group) => group.map((id) => nameById.get(id) ?? id).join(' + ')).join(' / ')}` : ''}</p>{currentWeek.status === 'open' && <button onClick={() => void act({ action: 'lock', weekId: currentWeek.id })} className="mt-5 rounded-xl bg-[var(--color-ggd-gold)] px-5 py-3 font-black text-[var(--color-ggd-outline)]">🔒 LOCK PREDICTIONS</button>}{currentWeek.status === 'locked' && <div className="mt-5 space-y-4"><p className="text-[var(--color-ggd-neon-green)]">Race đã chạy vanilla. Nhập final ranking (1 = thắng).</p><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{data.players.map((player) => <div key={player.id} className="flex items-center gap-2 rounded-xl bg-black/20 p-3"><span className="min-w-0 flex-1 truncate">{player.name}</span><input type="number" min={1} max={data.players.length} value={rankings[player.id] ?? ''} onChange={(event) => setRankings((previous) => ({ ...previous, [player.id]: Number(event.target.value) }))} className="w-16 rounded-lg bg-black/30 px-2 py-2 text-center" /><label className="text-xs text-white/70"><input type="checkbox" checked={shields.includes(player.id)} disabled={player.shields < 1} onChange={(event) => setShields((previous) => event.target.checked ? [...previous, player.id] : previous.filter((id) => id !== player.id))} /> 🛡️</label></div>)}</div><button onClick={() => void act({ action: 'resolve', weekId: currentWeek.id, ranking: data.players.map((player) => ({ userId: player.id, rank: rankings[player.id] })), shieldUserIds: shields })} className="rounded-xl bg-[var(--color-ggd-neon-green)] px-5 py-3 font-black text-[var(--color-ggd-outline)]">💥 AUTO RESOLVE + DUCK NEWS</button></div>}</section>}
      {!currentWeek && <section className="rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] p-5"><h2 className="font-display text-2xl">Season week complete</h2>{data.weeks.length < (data.season?.weeks ?? 12) && <button onClick={() => void act({ action: 'open-week' })} className="mt-4 rounded-xl bg-[var(--color-ggd-neon-green)] px-5 py-3 font-black text-[var(--color-ggd-outline)]">🎴 OPEN NEXT CHAOS</button>}</section>}
      <section className="rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-surface-2)] p-5"><h2 className="font-display text-2xl">📰 Resolved History</h2><div className="mt-4 space-y-3">{data.weeks.filter((week) => week.status === 'resolved').map((week) => <div key={week.id} className="whitespace-pre-wrap rounded-xl bg-black/20 p-4"><div className="mb-2 font-black text-[var(--color-ggd-gold)]">WEEK {week.weekNumber} · {week.chaosType}</div>{week.recap}</div>)}</div></section>
    </>}
  </main>
}
