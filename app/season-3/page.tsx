'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Season3ChaosCard } from '@/components/season3-chaos-card'

type SeasonData = {
  season: { name: string; year: number; weeks: number } | null
  viewer: { userId: number; name: string; predictionPoints: number; scars: number; shields: number; isKing: boolean; kingStreak: number } | null
  personalLink: string | null
  players: Array<{ id: number; name: string; predictionPoints: number; scars: number; shields: number; isKing: boolean; kingStreak: number }>
  currentWeek: { id: number; weekNumber: number; status: string; chaosType: string; chaosTargetName: string | null; chaosGroups?: number[][]; predictionCount: number; predictionSubmitted: boolean; shieldConfirmed: boolean; raceId: number | null; raceStatus: string | null } | null
  history: Array<{ id: number; weekNumber: number; chaosType: string; recap: string | null }>
  latestReveal: { weekNumber: number; recap: string | null; predictions: Array<{ predictorName: string; targetName: string; pointsAwarded: number }> } | null
  rewards: Array<{ key: string; name: string; cost: number; stock: number | null }>
}

const chaosNames: Record<string, string> = {
  NORMAL: 'NORMAL',
  REVERSE: 'REVERSE',
  DUO: 'DUO',
  TRIPLE_ELIMINATION: 'TRIPLE ELIMINATION',
  CUT_LINE: 'CUT LINE',
  CONSTRUCTORS: 'CONSTRUCTORS',
  BOUNTY_HUNT: 'BOUNTY HUNT',
}

function initials(name: string) {
  return name.replace('Zịt ', '').split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()
}

function StatTile({ icon, label, value, tone }: { icon: string; label: string; value: string | number; tone: string }) {
  return <div className="rounded-2xl border-2 border-white/10 bg-black/20 p-3"><div className={`text-2xl ${tone}`}>{icon}</div><div className="mt-2 font-display text-2xl text-white">{value}</div><div className="text-[10px] font-black uppercase tracking-widest text-white/45">{label}</div></div>
}

export default function Season3Page() {
  const [token, setToken] = useState('')
  const [data, setData] = useState<SeasonData | null>(null)
  const [selectedTarget, setSelectedTarget] = useState<number | null>(null)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const response = await fetch(`/api/season3${token ? `?token=${encodeURIComponent(token)}` : ''}`, { cache: 'no-store' })
    const next = await response.json() as SeasonData
    setData(next)
    setLoading(false)
  }

  useEffect(() => {
    const queryToken = new URLSearchParams(window.location.search).get('token') ?? ''
    void fetch(`/api/season3${queryToken ? `?token=${encodeURIComponent(queryToken)}` : ''}`, { cache: 'no-store' })
      .then((response) => response.json())
      .then((next: SeasonData) => { setToken(queryToken); setData(next); setLoading(false) })
      .catch(() => { setMessage('Không tải được Season 3.'); setLoading(false) })
  }, [])

  async function submitPrediction() {
    if (!selectedTarget || !token) return
    const response = await fetch('/api/season3', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, targetUserId: selectedTarget }) })
    const result = await response.json() as { error?: string; message?: string }
    setMessage(result.message ?? result.error ?? '')
    if (response.ok) await load()
  }

  async function confirmShield(useShield: boolean) {
    if (!token) return
    const response = await fetch('/api/season3', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, action: 'shield', useShield }) })
    const result = await response.json() as { error?: string; message?: string }
    setMessage(result.message ?? result.error ?? '')
    if (response.ok) await load()
  }

  async function redeem(rewardKey: string) {
    if (!token) return
    const response = await fetch('/api/season3/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, rewardKey }) })
    const result = await response.json() as { error?: string; reward?: string }
    setMessage(result.reward ? `Đã redeem ${result.reward}.` : result.error ?? '')
    if (response.ok) await load()
  }

  if (loading) return <main className="mx-auto max-w-6xl p-6 text-white"><div className="animate-pulse rounded-3xl bg-white/10 p-8 font-display text-3xl">Đang gọi bầy vịt...</div></main>
  if (!data?.season) return <main className="mx-auto max-w-6xl p-6 text-white"><div className="rounded-[2rem] border-4 border-black bg-[var(--color-ggd-panel)] p-8 shadow-[0_8px_0_black]"><div className="text-sm font-black tracking-[0.25em] text-[var(--color-ggd-gold)]">DUCK POND OFFLINE</div><h1 className="mt-2 font-display text-5xl">Season 3 chưa mở 🦆</h1><p className="mt-3 text-white/65">Host chưa bật season. Quay lại sau nhé.</p></div></main>

  const week = data.currentWeek
  const eligiblePlayers = data.players.filter((player) => player.id !== data.viewer?.userId)
  const groupNames = week?.chaosGroups?.map((group) => group.map((id) => data.players.find((player) => player.id === id)?.name ?? String(id)))

  return <main className="mx-auto max-w-6xl space-y-6 p-4 pb-12 text-white sm:p-6 lg:p-8">
    <header className="relative overflow-hidden rounded-[2rem] border-4 border-[var(--color-ggd-outline)] bg-[radial-gradient(circle_at_85%_15%,rgba(61,255,143,.22),transparent_34%),linear-gradient(135deg,#241548,#110b24)] p-6 shadow-[0_8px_0_var(--color-ggd-outline)] sm:p-8">
      <div className="pointer-events-none absolute -right-5 -top-12 rotate-12 text-[10rem] opacity-10">🦆</div>
      <div className="relative z-[1] flex flex-wrap items-start justify-between gap-5">
        <div><div className="inline-flex items-center gap-2 rounded-full border border-[var(--color-ggd-neon-green)]/40 bg-[var(--color-ggd-neon-green)]/10 px-3 py-1 text-xs font-black tracking-[0.2em] text-[var(--color-ggd-neon-green)]"><span className="h-2 w-2 animate-pulse rounded-full bg-[var(--color-ggd-neon-green)]" /> SEASON {data.season.year}</div><h1 className="mt-3 font-display text-5xl leading-none sm:text-6xl">ĐUA DZỊT <span className="text-[var(--color-ggd-gold)]">S3</span></h1></div>
        <div className="rounded-2xl border-2 border-white/15 bg-black/25 p-4 text-right"><div className="text-[10px] font-black tracking-widest text-white/45">THỂ LỆ</div><div className="mt-1 font-display text-3xl">{data.season.weeks} TUẦN</div><div className="mt-1 text-xs text-white/55">1 Chaos / tuần</div></div>
      </div>
    </header>

    {week ? <Season3ChaosCard type={week.chaosType} weekNumber={week.weekNumber} targetName={week.chaosTargetName} groups={groupNames} predictionCount={week.predictionCount} playerCount={data.players.length} /> : <section className="rounded-[2rem] border-4 border-[var(--color-ggd-gold)] bg-[var(--color-ggd-gold)]/10 p-6 text-center"><div className="text-5xl">🏆</div><h2 className="mt-2 font-display text-4xl">Season complete</h2><p className="mt-2 text-white/65">Golden Duck đang chờ host chốt champion.</p></section>}

    <div className="grid gap-6 lg:grid-cols-[1.1fr_.9fr]">
      {data.viewer ? <section className="overflow-hidden rounded-[2rem] border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-surface-2)] shadow-[0_6px_0_var(--color-ggd-outline)]"><div className="flex items-center gap-4 border-b-2 border-white/10 bg-black/15 p-5"><div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--color-ggd-gold)] text-xl font-black text-[var(--color-ggd-outline)]">{initials(data.viewer.name)}</div><div><div className="text-xs font-black tracking-widest text-white/45">YOUR POND STATUS</div><h2 className="font-display text-3xl">{data.viewer.isKing ? '👑 ' : ''}{data.viewer.name}</h2></div><div className="ml-auto rounded-xl bg-black/25 px-3 py-2 text-center"><div className="font-display text-2xl text-[var(--color-ggd-gold)]">{data.viewer.isKing ? `x${data.viewer.kingStreak}` : '—'}</div><div className="text-[9px] font-black text-white/45">KING STREAK</div></div></div><div className="grid grid-cols-3 gap-3 p-5"><StatTile icon="🔮" label="Points" value={data.viewer.predictionPoints} tone="text-[var(--color-ggd-lavender)]" /><StatTile icon="🩹" label="Scars" value={data.viewer.scars} tone="text-[var(--color-ggd-orange)]" /><StatTile icon="🛡️" label="Shields" value={data.viewer.shields} tone="text-[var(--color-ggd-sky)]" /></div>{week?.status === 'open' && <div className="border-t-2 border-white/10 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="font-black">🛡️ Dùng Shield tuần này?</div><p className="text-sm text-white/55">Chỉ mất khi bạn bị làm dzịt.</p></div>{week.shieldConfirmed ? <button onClick={() => void confirmShield(false)} className="rounded-xl border-2 border-[var(--color-ggd-sky)] px-4 py-2 font-black text-[var(--color-ggd-sky)]">✓ ĐÃ XÁC NHẬN</button> : <button disabled={data.viewer.shields < 1} onClick={() => void confirmShield(true)} className="rounded-xl bg-[var(--color-ggd-sky)] px-4 py-2 font-black text-[var(--color-ggd-outline)] disabled:cursor-not-allowed disabled:opacity-35">XÁC NHẬN DÙNG</button>}</div></div>}</section> : <section className="rounded-[2rem] border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-surface-2)] p-6"><div className="text-4xl">🔐</div><h2 className="mt-2 font-display text-3xl">Your secret duck link</h2><p className="mt-2 text-white/65">Mở personal link host gửi để pick bí mật. Không cần account, không ai thấy target của bạn.</p></section>}

      {data.viewer && week?.status === 'open' ? <section className="rounded-[2rem] border-4 border-[var(--color-ggd-gold)] bg-[linear-gradient(135deg,rgba(255,204,0,.18),rgba(36,21,72,.9))] p-5 shadow-[0_6px_0_var(--color-ggd-outline)]"><div className="flex items-center justify-between gap-3"><div><div className="text-xs font-black tracking-[0.2em] text-[var(--color-ggd-gold)]">STEP 02 • SECRET PREDICTION</div><h2 className="mt-1 font-display text-3xl">WHO GETS DUCKED?</h2></div><div className="text-4xl">🔮</div></div><p className="mt-2 text-sm text-white/70">Pick 1 duck bạn nghĩ sẽ raw Bottom 2. Chỉ bạn thấy lựa chọn này.</p><div className="mt-4 grid max-h-48 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">{eligiblePlayers.map((player) => <button key={player.id} onClick={() => setSelectedTarget(player.id)} className={`flex items-center gap-3 rounded-xl border-2 p-3 text-left font-black transition ${selectedTarget === player.id ? 'border-[var(--color-ggd-gold)] bg-[var(--color-ggd-gold)]/25 text-[var(--color-ggd-gold)] shadow-[0_0_20px_rgba(255,204,0,.18)]' : 'border-white/10 bg-black/20 text-white/80 hover:border-white/35'}`}><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-xs">{initials(player.name)}</span>{player.name}{selectedTarget === player.id && <span className="ml-auto">✓</span>}</button>)}</div><button onClick={() => void submitPrediction()} disabled={!selectedTarget} className="mt-4 w-full rounded-xl bg-[var(--color-ggd-gold)] px-5 py-3 font-black text-[var(--color-ggd-outline)] shadow-[0_4px_0_rgba(0,0,0,.4)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-35">🔒 LOCK MY PREDICTION</button>{message && <p className="mt-3 text-center text-sm font-bold text-[var(--color-ggd-neon-green)]">{message}</p>}</section> : week?.status === 'racing' && week.raceId ? <section className="rounded-[2rem] border-4 border-[var(--color-ggd-neon-green)] bg-[var(--color-ggd-neon-green)]/10 p-5 shadow-[0_6px_0_var(--color-ggd-outline)]"><div className="text-xs font-black tracking-[0.2em] text-[var(--color-ggd-neon-green)]">RACE LIVE</div><h2 className="mt-1 font-display text-3xl">🏁 Duck Duck Race đang chạy</h2><p className="mt-2 text-sm text-white/70">BXH raw sẽ được lấy tự động, sau đó hệ thống tự resolve.</p><Link href={`/season-3/race/${week.raceId}`} className="mt-4 inline-block rounded-xl bg-[var(--color-ggd-neon-green)] px-5 py-3 font-black text-[var(--color-ggd-outline)]">XEM RACE</Link></section> : <section className="rounded-[2rem] border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-surface-2)] p-5"><div className="text-xs font-black tracking-[0.2em] text-white/45">STEP 02 • SECRET PREDICTION</div><h2 className="mt-1 font-display text-3xl">{week ? '🔒 PREDICTIONS LOCKED' : '🎬 SEASON RECAP'}</h2><p className="mt-2 text-sm text-white/65">{week ? 'Đang chờ host bắt đầu Duck Duck Race.' : 'Mỗi tuần một cú twist, mỗi tuần một Duck News.'}</p></section>}
    </div>

    <div className="grid gap-6 lg:grid-cols-[1.1fr_.9fr]">
      <section className="rounded-[2rem] border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-surface-2)] p-5"><div className="flex items-end justify-between gap-3"><div><div className="text-xs font-black tracking-[0.2em] text-white/45">LIVE POND BOARD</div><h2 className="font-display text-3xl">🏅 Current standings</h2></div><span className="rounded-full bg-black/25 px-3 py-1 text-xs font-black text-white/55">{data.players.length} DUCKS</span></div><div className="mt-4 space-y-2">{data.players.map((player, index) => <div key={player.id} className={`flex items-center gap-3 rounded-2xl border-2 p-3 ${player.isKing ? 'border-[var(--color-ggd-gold)]/60 bg-[var(--color-ggd-gold)]/10' : 'border-white/10 bg-black/15'}`}><span className="w-6 text-center font-display text-2xl text-white/40">{index + 1}</span><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-xs font-black">{player.isKing ? '👑' : initials(player.name)}</span><span className="min-w-0 flex-1 truncate font-black">{player.name}{player.isKing && <span className="ml-2 rounded-full bg-[var(--color-ggd-gold)] px-2 py-0.5 text-[9px] text-[var(--color-ggd-outline)]">KING x{player.kingStreak}</span>}</span><span className="text-xs font-bold text-white/55">🔮 {player.predictionPoints} · 🩹 {player.scars} · 🛡️ {player.shields}</span></div>)}</div></section>
      <section className="rounded-[2rem] border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] p-5"><div className="text-xs font-black tracking-[0.2em] text-[var(--color-ggd-gold)]">REWARD TRACK</div><h2 className="font-display text-3xl">🎁 Points → merch</h2><p className="mt-2 text-sm text-white/60">Không power, không buff. Chỉ là đồ vịt thật.</p><div className="mt-4 space-y-2">{data.rewards.map((reward) => <div key={reward.key} className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 p-3"><div className="min-w-0 flex-1"><div className="truncate text-sm font-black">{reward.name}</div><div className="text-[10px] font-bold text-white/45">{reward.stock !== null ? `${reward.stock} limited stock` : 'Unlimited'}</div></div><span className="whitespace-nowrap font-black text-[var(--color-ggd-gold)]">🔮 {reward.cost}</span>{data.viewer && <button disabled={data.viewer.predictionPoints < reward.cost} onClick={() => void redeem(reward.key)} className="rounded-lg bg-[var(--color-ggd-gold)] px-2 py-1 text-[10px] font-black text-[var(--color-ggd-outline)] disabled:opacity-25">REDEEM</button>}</div>)}</div></section>
    </div>

    <section className="rounded-[2rem] border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] p-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><div className="text-xs font-black tracking-[0.2em] text-[var(--color-ggd-hot-pink)]">THE RECEIPTS</div><h2 className="font-display text-3xl">📰 Duck News</h2></div><span className="text-xs font-bold text-white/45">History never forgets</span></div><div className="mt-4 grid gap-3 lg:grid-cols-2">{data.history.length === 0 ? <div className="rounded-2xl border border-dashed border-white/15 p-5 text-sm text-white/50">Chưa có tuần nào resolve.</div> : data.history.map((item) => <article key={item.id} className="rounded-2xl border border-white/10 bg-black/20 p-4"><div className="flex items-center justify-between gap-3"><span className="rounded-full bg-[var(--color-ggd-orange)]/15 px-2 py-1 text-[10px] font-black text-[var(--color-ggd-orange)]">WEEK {item.weekNumber}</span><span className="text-[10px] font-black tracking-widest text-white/35">{chaosNames[item.chaosType] ?? item.chaosType}</span></div><p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-white/80">{item.recap}</p></article>)}</div></section>

    {data.latestReveal && <section className="rounded-[2rem] border-4 border-[var(--color-ggd-lavender)]/70 bg-[linear-gradient(135deg,rgba(167,139,250,.18),rgba(36,21,72,.8))] p-5"><div className="flex items-center gap-3"><span className="text-3xl">🔮</span><div><div className="text-xs font-black tracking-[0.2em] text-[var(--color-ggd-lavender)]">REVEAL AFTER RACE</div><h2 className="font-display text-3xl">Prediction receipts • Week {data.latestReveal.weekNumber}</h2></div></div><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{data.latestReveal.predictions.length === 0 ? <p className="text-sm text-white/55">Không có prediction.</p> : data.latestReveal.predictions.map((prediction) => <div key={`${prediction.predictorName}-${prediction.targetName}`} className="rounded-xl border border-white/10 bg-black/20 p-3 text-sm"><span className="font-black">{prediction.predictorName}</span><span className="mx-2 text-white/40">→</span><span>{prediction.targetName}</span><span className={`ml-2 font-black ${prediction.pointsAwarded > 0 ? 'text-[var(--color-ggd-neon-green)]' : 'text-white/35'}`}>{prediction.pointsAwarded > 0 ? '✓ +1' : '✕'}</span></div>)}</div></section>}
  </main>
}
