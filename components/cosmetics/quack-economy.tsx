'use client'

/* eslint-disable @next/next/no-img-element -- exact SVG cosmetic previews are intentionally unoptimized */

import { useEffect, useRef, useState } from 'react'
import { CosmeticDuck } from './cosmetic-duck'
import type { CosmeticDefinition, DuckAppearance } from '@/lib/cosmetics/types'

type ShopItem = CosmeticDefinition & { price: number; limitedLabel?: string | null }
type ShopData = { balance: number; endsAt: string; items: ShopItem[]; error?: string }
type PullData = { pull: { finalCosmeticId: string; rolledRarity: string; refundAmount: number; wasRerolled: boolean }; balance: number; error?: string }

export function QuackEconomy({ token, catalog, appearance, onChanged }: { token: string; catalog: CosmeticDefinition[]; appearance: DuckAppearance; onChanged: () => Promise<void> }) {
  const [shop, setShop] = useState<ShopData | null>(null)
  const [preview, setPreview] = useState<CosmeticDefinition | null>(null)
  const [reveal, setReveal] = useState<PullData | null>(null)
  const [pulling, setPulling] = useState(false)
  const [hasSeenReveal, setHasSeenReveal] = useState(false)
  const [message, setMessage] = useState('')
  const skipRevealRef = useRef<(() => void) | null>(null)

  async function loadShop() {
    const response = await fetch(`/api/cosmetics/shop?token=${encodeURIComponent(token)}`, { cache: 'no-store' })
    setShop(await response.json())
  }
  useEffect(() => {
    let active = true
    void fetch(`/api/cosmetics/shop?token=${encodeURIComponent(token)}`, { cache: 'no-store' })
      .then((response) => response.json())
      .then((next: ShopData) => { if (active) setShop(next) })
    return () => { active = false }
  }, [token])

  const previewAppearance = preview ? { ...appearance, [`${preview.slot}Id`]: preview.id } as DuckAppearance : appearance

  async function buy(item: ShopItem) {
    const response = await fetch('/api/cosmetics/shop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, cosmeticId: item.id, idempotencyKey: crypto.randomUUID() }) })
    const result = await response.json() as { error?: string }
    setMessage(response.ok ? `Đã mua ${item.name}.` : result.error ?? 'Không mua được.')
    if (response.ok) { await loadShop(); await onChanged() }
  }

  async function pull() {
    setPulling(true)
    setReveal(null)
    setMessage('🥚 Mystery Egg đang rung...')
    const response = await fetch('/api/gacha/pull', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, idempotencyKey: crypto.randomUUID() }) })
    const result = await response.json() as PullData
    if (response.ok) playRevealSound(result.pull.rolledRarity)
    await new Promise<void>((resolve) => {
      let settled = false
      const finish = () => { if (!settled) { settled = true; resolve() } }
      skipRevealRef.current = finish
      window.setTimeout(finish, 2800)
    })
    skipRevealRef.current = null
    setReveal(response.ok ? result : null)
    setMessage(response.ok ? '' : result.error ?? 'Không mở được.')
    if (response.ok) { await loadShop(); await onChanged() }
    if (response.ok) setHasSeenReveal(true)
    setPulling(false)
  }

  const revealedItem = reveal ? catalog.find((item) => item.id === reveal.pull.finalCosmeticId) : null
  const refreshLabel = shop?.endsAt ? new Intl.DateTimeFormat('vi-VN', { weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(shop.endsAt)) : '—'
  return <section className="grid gap-5 lg:grid-cols-[1.25fr_.75fr]">
    <div className="rounded-[2rem] border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] p-5 shadow-[0_6px_0_var(--color-ggd-outline)]">
      <div className="flex items-end justify-between gap-3"><div><div className="text-xs font-black tracking-[0.2em] text-[var(--color-ggd-neon-green)]">ĐỔI ROTATION {refreshLabel}</div><h2 className="font-display text-3xl">🛒 Quack Shop</h2></div><div className="font-display text-2xl text-[var(--color-ggd-gold)]">🪙 {shop?.balance ?? '—'} QP</div></div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        {(shop?.items ?? []).map((item) => <article key={item.id} className="rounded-2xl border-2 border-white/10 bg-black/20 p-3"><button onClick={() => setPreview(item)} className="w-full"><img src={item.asset} alt={item.name} className="aspect-square w-full object-contain" /></button><div className="truncate text-sm font-black">{item.name}</div><div className="text-[10px] font-bold uppercase text-white/45">{item.rarity}{item.limitedLabel ? ` · ${item.limitedLabel}` : ''}</div><button onClick={() => void buy(item)} className="mt-2 w-full rounded-lg bg-[var(--color-ggd-gold)] px-2 py-2 text-xs font-black text-[var(--color-ggd-outline)]">{item.price} QP</button></article>)}
        {shop && shop.items.length === 0 && <div className="col-span-full rounded-xl border border-dashed border-white/15 p-5 text-white/50">Bạn đã có hết rotation tuần này.</div>}
      </div>
      {preview && <div className="mt-4 flex items-center gap-3 rounded-2xl bg-black/20 p-3"><CosmeticDuck appearance={previewAppearance} size={110} label={`Preview ${preview.name}`} /><div><div className="font-display text-2xl">{preview.name}</div><div className="text-sm text-white/55">{preview.collection} · {preview.rarity}</div></div></div>}
    </div>
    <div className="rounded-[2rem] border-4 border-[var(--color-ggd-gold)] bg-[radial-gradient(circle_at_50%_20%,rgba(255,216,77,.25),transparent_38%),#241548] p-5 text-center shadow-[0_6px_0_var(--color-ggd-outline)]">
      <div className="text-xs font-black tracking-[0.2em] text-[var(--color-ggd-gold)]">3 QP / PULL</div><h2 className="font-display text-3xl">🥚 Mystery Egg</h2>
      <div className={`my-4 text-7xl ${pulling ? 'animate-bounce motion-reduce:animate-none' : ''}`}>{revealedItem ? <CosmeticDuck appearance={{ ...appearance, [`${revealedItem.slot}Id`]: revealedItem.id } as DuckAppearance} size={170} label={revealedItem.name} /> : '🥚'}</div>
      {revealedItem && <div><div className="font-display text-2xl text-[var(--color-ggd-gold)]">{revealedItem.name}</div><div className="text-xs font-black uppercase text-white/55">{reveal?.pull.rolledRarity}{reveal?.pull.wasRerolled ? ' · duplicate rerolled' : ''}{reveal?.pull.refundAmount ? ` · +${reveal.pull.refundAmount} QP refund` : ''}</div></div>}
      <button disabled={pulling || (shop?.balance ?? 0) < 3} onClick={() => void pull()} className="mt-4 w-full rounded-xl bg-[var(--color-ggd-gold)] px-5 py-3 font-black text-[var(--color-ggd-outline)] disabled:opacity-35">{pulling ? 'ĐANG MỞ...' : 'MỞ EGG · 3 QP'}</button>
      {pulling && hasSeenReveal && <button onClick={() => skipRevealRef.current?.()} className="mt-2 text-xs font-black text-white/55 underline">SKIP</button>}
      <div className="mt-4 text-[10px] font-bold text-white/45">Common 40% · Uncommon 30% · Rare 18% · Epic 9% · Legendary 3%</div>
      {message && <p className="mt-3 text-sm font-bold text-[var(--color-ggd-neon-green)]">{message}</p>}
    </div>
  </section>
}

function playRevealSound(rarity: string) {
  try {
    const AudioContextClass = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextClass) return
    const context = new AudioContextClass()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.frequency.value = rarity === 'legendary' ? 880 : rarity === 'epic' ? 660 : 440
    gain.gain.setValueAtTime(0.08, context.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.45)
    oscillator.connect(gain).connect(context.destination)
    oscillator.start()
    oscillator.stop(context.currentTime + 0.45)
  } catch { /* sound is optional */ }
}
