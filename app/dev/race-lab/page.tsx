'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PhaserRaceCanvas, type ReplayInspection } from '@/components/racing/phaser-race-canvas'
import { Switch } from '@/components/ui/switch'
import { WILD_ITEM_CATALOG } from '@/packages/race-core/src'
import {
  DEFAULT_TRACK_VERSION,
  HAZARD_BALANCE_VERSION,
  PICKUP_SPAWN_VERSION,
  RACE_BALANCE_VERSION,
  RACE_ENGINE_VERSION,
  RACE_PROTOCOL_VERSION,
  RACE_TICK_RATE,
  WILD_ITEM_BALANCE_VERSION,
  raceConfigSchema,
  type RaceConfig,
  type RaceEvent,
  type RaceItemId,
  type WildItemId,
} from '@/packages/race-protocol/src'

const CHAOS_TYPES = ['NORMAL', 'REVERSE', 'DUO', 'TRIPLE_ELIMINATION', 'CUT_LINE', 'CONSTRUCTORS', 'BOUNTY_HUNT'] as const
const MAJORS: Array<{ id: RaceItemId; label: string }> = [
  { id: 'BUBBLE_SHIELD', label: '🫧 Bubble Shield' },
  { id: 'HOMING_ROCKET', label: '🚀 Homing Rocket' },
  { id: 'NITRO', label: '⚡ Nitro' },
]
const MINORS: Array<{ id: RaceItemId; label: string }> = [
  { id: 'BANANA', label: '🍌 Banana' },
  { id: 'FEATHER', label: '🪶 Feather' },
  { id: 'QUACK_HORN', label: '🔊 Quack Horn' },
]

type Choice = { major: RaceItemId; minor: RaceItemId }

function randomSeed() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')
}

function chaosConfig(type: typeof CHAOS_TYPES[number], playerIds: string[]) {
  if (type === 'DUO') return { type, groups: Array.from({ length: Math.ceil(playerIds.length / 2) }, (_, index) => playerIds.slice(index * 2, index * 2 + 2)) }
  if (type === 'CONSTRUCTORS') {
    const split = Math.ceil(playerIds.length / 2)
    return { type, groups: [playerIds.slice(0, split), playerIds.slice(split)] }
  }
  if (type === 'BOUNTY_HUNT') return { type, targetPlayerId: playerIds[0] }
  return { type }
}

export default function RaceLabPage() {
  const [secret, setSecret] = useState('')
  const [authorized, setAuthorized] = useState(false)
  const [authMessage, setAuthMessage] = useState('')
  const [playerCount, setPlayerCount] = useState(8)
  const [seed, setSeed] = useState('11'.repeat(32))
  const [chaos, setChaos] = useState<typeof CHAOS_TYPES[number]>('NORMAL')
  const [choices, setChoices] = useState<Record<string, Choice>>({})
  const [nitro, setNitro] = useState(1.18)
  const [rocketSlow, setRocketSlow] = useState(0.8)
  const [bananaKnockback, setBananaKnockback] = useState(1)
  const [boxesEnabled, setBoxesEnabled] = useState(true)
  const [goldenEnabled, setGoldenEnabled] = useState(true)
  const [forceGolden, setForceGolden] = useState(false)
  const [hazardsEnabled, setHazardsEnabled] = useState(true)
  const [positionAware, setPositionAware] = useState(true)
  const [autoItems, setAutoItems] = useState(true)
  const [spawnMultiplier, setSpawnMultiplier] = useState(1)
  const [forceItem, setForceItem] = useState<WildItemId | ''>('')
  const [activeConfig, setActiveConfig] = useState<RaceConfig | null>(null)
  const [runKey, setRunKey] = useState(0)
  const [paused, setPaused] = useState(false)
  const [speed, setSpeed] = useState<1 | 2 | 4>(1)
  const [snapshot, setSnapshot] = useState<ReplayInspection | null>(null)
  const [events, setEvents] = useState<RaceEvent[]>([])
  const lastInspectionTick = useRef(0)

  const players = useMemo(() => Array.from({ length: playerCount }, (_, index) => ({
    playerId: `lab-duck-${index + 1}`,
    name: `Dzịt ${index + 1}`,
  })), [playerCount])

  const selectedChoices = useMemo(() => new Map(players.map((player, index) => [player.playerId, choices[player.playerId] ?? {
    major: MAJORS[index % MAJORS.length].id,
    minor: MINORS[index % MINORS.length].id,
  }])), [choices, players])

  const canvasPlayers = useMemo(() => players.map((player) => ({
    ...player,
    itemIds: [selectedChoices.get(player.playerId)!.major, selectedChoices.get(player.playerId)!.minor],
  })), [players, selectedChoices])

  async function verify(candidate: string) {
    const response = await fetch('/api/admin/season3', { headers: { 'x-race-secret': candidate } })
    if (!response.ok) {
      setAuthorized(false)
      setAuthMessage('Sai RACE_SECRET_KEY.')
      return
    }
    window.localStorage.setItem('autoduck-season3-secret', candidate)
    setAuthorized(true)
    setAuthMessage('')
  }

  useEffect(() => {
    const saved = window.localStorage.getItem('autoduck-season3-secret') ?? ''
    if (!saved) return
    const controller = new AbortController()
    void fetch('/api/admin/season3', { headers: { 'x-race-secret': saved }, signal: controller.signal }).then((response) => {
      if (response.ok) setAuthorized(true)
    }).catch(() => undefined)
    return () => controller.abort()
  }, [])

  const start = useCallback(() => {
    try {
      const playerIds = players.map((player) => player.playerId)
      const config = raceConfigSchema.parse({
        raceId: `race-lab-${runKey + 1}`,
        seed,
        protocolVersion: RACE_PROTOCOL_VERSION,
        engineVersion: RACE_ENGINE_VERSION,
        balanceVersion: `${RACE_BALANCE_VERSION}-LAB`,
        trackVersion: DEFAULT_TRACK_VERSION,
        pickupSpawnVersion: PICKUP_SPAWN_VERSION,
        wildItemBalanceVersion: WILD_ITEM_BALANCE_VERSION,
        hazardBalanceVersion: HAZARD_BALANCE_VERSION,
        tickRate: RACE_TICK_RATE,
        players,
        loadouts: players.map((player) => {
          const choice = selectedChoices.get(player.playerId)!
          return { playerId: player.playerId, itemIds: [choice.major, choice.minor], source: 'PLAYER' }
        }),
        chaosConfig: chaosConfig(chaos, playerIds),
        itemTuning: { nitroSpeedMultiplier: nitro, rocketSlowMultiplier: rocketSlow, bananaKnockbackMultiplier: bananaKnockback },
        pickupConfig: {
          enabled: boxesEnabled,
          goldenBoxEnabled: goldenEnabled,
          goldenBoxProbability: 0.12,
          hazardsEnabled,
          positionAwareLoot: positionAware,
          spawnMultiplier,
          regularPickupCap: spawnMultiplier >= 2 ? 3 : 2,
          manualItemsEnabled: true,
          autoItemsEnabled: autoItems,
          chaosBoxEnabled: false,
          forceItem: forceItem || undefined,
          forceGoldenBox: forceGolden,
          disabledItems: [],
          idealManualPlayerIds: [],
        },
      })
      setActiveConfig(config)
      setSnapshot(null)
      setEvents([])
      setPaused(false)
      lastInspectionTick.current = 0
      setRunKey((value) => value + 1)
    } catch {
      setAuthMessage('Seed phải là 64 ký tự hex và tuning phải nằm trong giới hạn.')
    }
  }, [autoItems, bananaKnockback, boxesEnabled, chaos, forceGolden, forceItem, goldenEnabled, hazardsEnabled, nitro, players, positionAware, rocketSlow, runKey, seed, selectedChoices, spawnMultiplier])

  const inspect = useCallback((inspection: ReplayInspection) => {
    if (inspection.newEvents.length > 0) setEvents((current) => [...current, ...inspection.newEvents].slice(-100))
    if (!inspection.finished && inspection.tick - lastInspectionTick.current < RACE_TICK_RATE / 5) return
    lastInspectionTick.current = inspection.tick
    setSnapshot(inspection)
  }, [])

  if (!authorized) return <main className="mx-auto flex min-h-screen max-w-xl items-center p-6 text-white">
    <section className="w-full rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] p-6 shadow-[0_8px_0_var(--color-ggd-outline)]">
      <div className="text-sm font-black tracking-[0.2em] text-[var(--color-ggd-gold)]">ADMIN TOOL</div>
      <h1 className="mt-2 font-display text-4xl">🧪 Race Lab</h1>
      <div className="mt-5 flex gap-2"><input type="password" value={secret} onChange={(event) => setSecret(event.target.value)} placeholder="RACE_SECRET_KEY" className="min-w-0 flex-1 rounded-xl border-2 border-white/20 bg-black/30 px-4 py-3" /><button onClick={() => void verify(secret)} className="rounded-xl bg-[var(--color-ggd-neon-green)] px-5 font-black text-[var(--color-ggd-outline)]">OPEN</button></div>
      {authMessage && <p className="mt-3 text-sm text-[var(--color-ggd-orange)]">{authMessage}</p>}
    </section>
  </main>

  return <main className="mx-auto min-h-screen max-w-7xl space-y-5 p-5 text-white">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-xs font-black tracking-[0.25em] text-[var(--color-ggd-gold)]">ADMIN · DETERMINISTIC</div><h1 className="font-display text-4xl">🧪 Race Lab</h1></div><Link href="/admin/season-3" className="rounded-xl border-2 border-white/20 px-4 py-2 font-black">RACE DESK</Link></header>

    <section className="grid gap-4 rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] p-5 lg:grid-cols-4">
      <label className="text-sm font-black">DUCKS<input type="number" min={2} max={16} value={playerCount} onChange={(event) => setPlayerCount(Math.max(2, Math.min(16, Number(event.target.value))))} className="mt-2 w-full rounded-xl bg-black/30 px-3 py-2" /></label>
      <label className="text-sm font-black">CHAOS<select value={chaos} onChange={(event) => setChaos(event.target.value as typeof chaos)} className="mt-2 w-full rounded-xl bg-black/30 px-3 py-2">{CHAOS_TYPES.map((type) => <option key={type}>{type}</option>)}</select></label>
      <label className="text-sm font-black lg:col-span-2">SEED<div className="mt-2 flex gap-2"><input value={seed} onChange={(event) => setSeed(event.target.value.trim())} className="min-w-0 flex-1 rounded-xl bg-black/30 px-3 py-2 font-mono text-xs" /><button onClick={() => setSeed(randomSeed())} className="rounded-xl border-2 border-white/20 px-3">RANDOM</button></div></label>
      <label className="text-sm font-black">⚡ NITRO {nitro.toFixed(2)}×<input type="range" min="1" max="1.2" step="0.01" value={nitro} onChange={(event) => setNitro(Number(event.target.value))} className="mt-3 w-full" /></label>
      <label className="text-sm font-black">🚀 ROCKET {rocketSlow.toFixed(2)}×<input type="range" min="0.75" max="1" step="0.01" value={rocketSlow} onChange={(event) => setRocketSlow(Number(event.target.value))} className="mt-3 w-full" /></label>
      <label className="text-sm font-black">🍌 BANANA {bananaKnockback.toFixed(2)}×<input type="range" min="0.5" max="2" step="0.05" value={bananaKnockback} onChange={(event) => setBananaKnockback(Number(event.target.value))} className="mt-3 w-full" /></label>
      <button onClick={start} className="rounded-xl bg-[var(--color-ggd-neon-green)] px-5 py-3 font-black text-[var(--color-ggd-outline)]">RUN RACE</button>
    </section>

    <section className="grid gap-4 rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-surface-2)] p-5 sm:grid-cols-2 lg:grid-cols-4">
      {[['Quack Boxes', boxesEnabled, setBoxesEnabled], ['Golden Box', goldenEnabled, setGoldenEnabled], ['Force Gold', forceGolden, setForceGolden], ['Hazards', hazardsEnabled, setHazardsEnabled], ['Position loot', positionAware, setPositionAware], ['Auto-use', autoItems, setAutoItems]].map(([label, checked, setter]) => <label key={String(label)} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 p-3 text-sm font-black"><span>{String(label)}</span><Switch checked={Boolean(checked)} onCheckedChange={setter as (value: boolean) => void} /></label>)}
      <label className="text-sm font-black">SPAWN {spawnMultiplier.toFixed(1)}×<input type="range" min="0" max="3" step="0.5" value={spawnMultiplier} onChange={(event) => setSpawnMultiplier(Number(event.target.value))} className="mt-3 w-full" /></label>
      <label className="text-sm font-black">FORCE WILD ITEM<select value={forceItem} onChange={(event) => setForceItem(event.target.value as WildItemId | '')} className="mt-2 w-full rounded-xl bg-black/30 px-3 py-2"><option value="">Position-aware RNG</option>{WILD_ITEM_CATALOG.map((item) => <option key={item.id} value={item.id}>{item.icon} {item.displayName}</option>)}</select></label>
    </section>

    <section className="overflow-x-auto rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-surface-2)] p-4"><div className="grid min-w-[720px] grid-cols-2 gap-2 md:grid-cols-4">{players.map((player, index) => {
      const choice = selectedChoices.get(player.playerId)!
      return <div key={player.playerId} className="rounded-xl bg-black/25 p-3"><div className="mb-2 font-black">{player.name}</div><select value={choice.major} onChange={(event) => setChoices((current) => ({ ...current, [player.playerId]: { ...choice, major: event.target.value as RaceItemId } }))} className="mb-2 w-full rounded-lg bg-black/40 p-2 text-sm">{MAJORS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select><select value={choice.minor} onChange={(event) => setChoices((current) => ({ ...current, [player.playerId]: { ...choice, minor: event.target.value as RaceItemId } }))} className="w-full rounded-lg bg-black/40 p-2 text-sm">{MINORS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select><div className="mt-2 text-xs text-white/45">Slot {index + 1} · 3/3 credits</div></div>
    })}</div></section>

    {activeConfig && <>
      <div className="flex flex-wrap items-center gap-2"><button onClick={() => setPaused((value) => !value)} className="rounded-xl border-2 border-white/20 px-4 py-2 font-black">{paused ? '▶ RESUME' : '⏸ PAUSE'}</button>{([1, 2, 4] as const).map((value) => <button key={value} onClick={() => setSpeed(value)} className={`rounded-xl px-4 py-2 font-black ${speed === value ? 'bg-[var(--color-ggd-gold)] text-[var(--color-ggd-outline)]' : 'border-2 border-white/20'}`}>{value}×</button>)}<button onClick={start} className="rounded-xl border-2 border-[var(--color-ggd-neon-green)] px-4 py-2 font-black text-[var(--color-ggd-neon-green)]">↻ REPLAY</button><span className="ml-auto text-sm text-white/60">Tick {snapshot?.tick ?? 0} · {snapshot?.finished ? 'FINISHED' : paused ? 'PAUSED' : 'RUNNING'}</span></div>
      <PhaserRaceCanvas key={runKey} raceId={-runKey} players={canvasPlayers} replayConfig={activeConfig} replaySpeed={speed} replayPaused={paused} onReplayInspect={inspect} debugPickups />
      <section className="grid gap-4 lg:grid-cols-2"><div className="rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] p-4"><h2 className="font-display text-2xl">State inspector</h2><div className="mt-3 space-y-2">{snapshot?.ducks.map((duck) => <div key={duck.playerId} className="flex items-center gap-3 rounded-xl bg-black/20 px-3 py-2 text-sm"><b className="w-6">#{duck.rank}</b><span className="flex-1">{players.find((player) => player.playerId === duck.playerId)?.name}</span><span>{(duck.progress * 100).toFixed(1)}%</span><span className="text-white/50">{duck.wildItem ? `🎒 ${WILD_ITEM_CATALOG.find((item) => item.id === duck.wildItem?.itemId)?.icon}` : duck.activeEffects.join(', ') || '—'} · 📦 {duck.regularPickupCount}</span></div>)}</div></div><div className="max-h-[420px] overflow-auto rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] p-4"><h2 className="font-display text-2xl">Event log · {events.length}</h2><div className="mt-3 space-y-1 font-mono text-xs">{[...events].reverse().map((event, index) => <div key={`${event.tick}-${event.type}-${index}`} className="rounded-lg bg-black/20 px-3 py-2"><span className="text-white/45">{event.tick}</span> · {event.type} · {event.sourcePlayerId ?? '—'}{event.targetPlayerId ? ` → ${event.targetPlayerId}` : ''}</div>)}</div></div></section>
    </>}
  </main>
}
