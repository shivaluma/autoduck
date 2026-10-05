'use client'

/* eslint-disable @next/next/no-img-element -- exact SVG cosmetic previews are intentionally unoptimized */

import { useEffect, useRef, useState } from 'react'
import { CosmeticDuck } from './cosmetic-duck'
import { RARITY_STYLE } from './duck-closet'
import { GameButton, GamePanel, ResourcePill, UiIcon } from '@/components/game-ui'
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
    <GamePanel tone="violet" icon="bag" kicker={`ĐỔI ROTATION · ${refreshLabel}`} title="Quack Shop" actions={<ResourcePill icon="coin" value={shop?.balance ?? '—'} label="Quack Points" />}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        {(shop?.items ?? []).map((item) => {
          const rarity = RARITY_STYLE[item.rarity]
          const affordable = (shop?.balance ?? 0) >= item.price
          return <article key={item.id} className={`closet-tile closet-tile--${item.rarity} gx-well relative flex flex-col p-2`} style={{ borderColor: `${rarity.color}88`, background: `radial-gradient(circle at 50% 35%, ${rarity.glow}, rgba(10,6,24,.35) 70%)` }}>
            <button type="button" onClick={() => setPreview(item)} className="block w-full" aria-label={`Thử ${item.name}`}><img src={item.previewAsset || item.asset} alt={item.name} className="aspect-square w-full object-contain transition hover:scale-105" /></button>
            <div className="truncate px-1 text-sm font-black">{item.name}</div>
            <div className="px-1 text-[10px] font-black uppercase" style={{ color: rarity.color }}>{rarity.label}{item.limitedLabel ? ` · ${item.limitedLabel}` : ''}</div>
            <GameButton size="sm" className="mt-2 w-full" disabled={!affordable} onClick={() => void buy(item)}><UiIcon name="coin" size={18} />{item.price}</GameButton>
          </article>
        })}
        {shop && shop.items.length === 0 && <div className="gx-well col-span-full p-6 text-center text-white/60">🛍️ Bạn đã có hết rotation tuần này — quay lại tuần sau nhé!</div>}
      </div>
      {preview && <div className="gx-well gx-pop-in mt-4 flex items-center gap-4 p-3"><CosmeticDuck appearance={previewAppearance} size={120} label={`Preview ${preview.name}`} /><div><div className="gx-title text-2xl">{preview.name}</div><div className="text-sm font-black" style={{ color: RARITY_STYLE[preview.rarity].color }}>{RARITY_STYLE[preview.rarity].label} · <span className="text-white/60">{preview.collection}</span></div></div></div>}
    </GamePanel>
    <GamePanel tone="gold" icon="egg" kicker="3 QP / LƯỢT" title="Mystery Egg" bodyClassName="text-center">
      <div className="relative mx-auto grid h-52 place-items-center">
        <div aria-hidden className="absolute h-40 w-40 rounded-full bg-[radial-gradient(circle,rgba(255,243,166,.55),transparent_70%)]" />
        {revealedItem
          ? <div className="gx-pop-in relative"><CosmeticDuck appearance={{ ...appearance, [`${revealedItem.slot}Id`]: revealedItem.id } as DuckAppearance} size={190} label={revealedItem.name} /></div>
          : <UiIcon name="egg" size={140} className={`relative drop-shadow-[0_6px_0_var(--gx-ink)] ${pulling ? 'animate-[wiggle-duck_.35s_ease-in-out_infinite] motion-reduce:animate-none' : 'gx-float'}`} />}
      </div>
      {revealedItem && <div className="gx-pop-in"><div className="gx-title text-3xl" style={{ color: RARITY_STYLE[revealedItem.rarity].color }}>{revealedItem.name}</div><div className="text-xs font-black uppercase text-white/65">{RARITY_STYLE[revealedItem.rarity].label}{reveal?.pull.wasRerolled ? ' · trùng → đổi món' : ''}{reveal?.pull.refundAmount ? ` · +${reveal.pull.refundAmount} QP hoàn` : ''}</div></div>}
      <GameButton size="lg" className="mt-4 w-full" disabled={pulling || (shop?.balance ?? 0) < 3} onClick={() => void pull()} icon="egg">{pulling ? 'ĐANG NỞ…' : 'MỞ TRỨNG · 3 QP'}</GameButton>
      {pulling && hasSeenReveal && <button type="button" onClick={() => skipRevealRef.current?.()} className="mt-2 text-xs font-black text-white/60 underline">BỎ QUA</button>}
      <div className="mt-4 flex flex-wrap justify-center gap-1.5">
        {(['common', 'uncommon', 'rare', 'epic', 'legendary'] as const).map((rarity) => <span key={rarity} className="rounded-md border-2 border-[var(--gx-ink)] bg-black/30 px-1.5 text-[10px] font-black" style={{ color: RARITY_STYLE[rarity].color }}>{RARITY_STYLE[rarity].label} {ODDS[rarity]}%</span>)}
      </div>
      {message && <p className="mt-3 text-sm font-bold text-[#bbf7d0]">{message}</p>}
    </GamePanel>
  </section>
}

const ODDS = { common: 40, uncommon: 30, rare: 18, epic: 9, legendary: 3 } as const

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
