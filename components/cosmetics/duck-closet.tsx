'use client'

import { useMemo, useState } from 'react'
import { CosmeticDuck } from './cosmetic-duck'
import type { CosmeticDefinition, CosmeticSlot, DuckAppearance } from '@/lib/cosmetics/types'

/* eslint-disable @next/next/no-img-element -- exact SVG layer previews are intentionally unoptimized */

const INTERACTIVE_SLOTS: Array<{ id: CosmeticSlot; label: string }> = [
  { id: 'bodyColor', label: 'Màu' },
  { id: 'bodySkin', label: 'Skin' },
  { id: 'face', label: 'Mặt' },
  { id: 'head', label: 'Nón' },
  { id: 'outfit', label: 'Áo' },
  { id: 'pet', label: 'Pet' },
  { id: 'aura', label: 'Aura' },
  { id: 'trail', label: 'Trail' },
]

export function DuckCloset({
  token,
  name,
  quackPoints,
  onboarded,
  catalog,
  ownedIds,
  initialAppearance,
  onSaved,
}: {
  token: string
  name: string
  quackPoints: number
  onboarded: boolean
  catalog: CosmeticDefinition[]
  ownedIds: string[]
  initialAppearance: DuckAppearance
  onSaved: () => Promise<void>
}) {
  const [appearance, setAppearance] = useState<DuckAppearance>(initialAppearance)
  const [slot, setSlot] = useState<CosmeticSlot>('bodyColor')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [presetName, setPresetName] = useState('')
  const owned = useMemo(() => new Set(ownedIds), [ownedIds])
  const choices = catalog.filter((item) => item.slot === slot && owned.has(item.id))

  function equip(cosmeticId: string | null) {
    const key = `${slot}Id` as keyof DuckAppearance
    setAppearance((current) => {
      const next = { ...current }
      if (cosmeticId) next[key] = cosmeticId
      else delete next[key]
      return next
    })
  }

  function randomize() {
    const next: Record<string, string> = {}
    for (const option of INTERACTIVE_SLOTS) {
      const pool = catalog.filter((item) => item.slot === option.id && owned.has(item.id))
      if (pool.length) next[`${option.id}Id`] = pool[Math.floor(Math.random() * pool.length)]!.id
    }
    setAppearance(next as DuckAppearance)
  }

  async function save() {
    setSaving(true)
    const response = await fetch('/api/season3', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, action: 'appearance', appearance }),
    })
    const result = await response.json() as { error?: string }
    setMessage(response.ok ? 'Đã lưu.' : result.error ?? 'Không lưu được.')
    if (response.ok) await onSaved()
    setSaving(false)
  }

  async function preset(action: 'save-preset' | 'load-preset', presetIndex: number) {
    const response = await fetch('/api/season3', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, action, presetIndex, presetName, appearance }) })
    const result = await response.json() as { error?: string; appearance?: DuckAppearance }
    if (result.appearance) setAppearance(result.appearance)
    setMessage(response.ok ? (action === 'save-preset' ? `Đã lưu preset ${presetIndex}.` : `Đã mặc preset ${presetIndex}.`) : result.error ?? 'Preset lỗi.')
    if (response.ok) await onSaved()
  }

  return <section className="overflow-hidden rounded-[2rem] border-4 border-[var(--color-ggd-outline)] bg-[linear-gradient(135deg,#2f1760,#152c43)] shadow-[0_6px_0_var(--color-ggd-outline)]">
    <div className="grid md:grid-cols-[280px_1fr]">
      <div className="flex flex-col items-center justify-center border-b-2 border-white/10 bg-black/15 p-5 md:border-b-0 md:border-r-2">
        <div className="text-xs font-black tracking-[0.2em] text-[var(--color-ggd-neon-green)]">{onboarded ? 'DUCK CLOSET' : 'MAKE YOUR DUCK'}</div>
        <CosmeticDuck appearance={appearance} size={220} label={`Dzịt của ${name}`} />
        <div className="font-display text-2xl">{name}</div>
        <div className="mt-1 rounded-full bg-black/30 px-3 py-1 text-sm font-black text-[var(--color-ggd-gold)]">🪙 {quackPoints} QP</div>
      </div>
      <div className="p-5">
        <div className="flex flex-wrap gap-2">
          {INTERACTIVE_SLOTS.map((option) => <button key={option.id} onClick={() => setSlot(option.id)} className={`rounded-full px-3 py-2 text-xs font-black ${slot === option.id ? 'bg-[var(--color-ggd-neon-green)] text-[var(--color-ggd-outline)]' : 'bg-black/25 text-white/65'}`}>{option.label}</button>)}
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {slot !== 'bodyColor' && <button onClick={() => equip(null)} className={`aspect-square rounded-xl border-2 text-xs font-black ${!appearance[`${slot}Id` as keyof DuckAppearance] ? 'border-white bg-white/10' : 'border-white/10 bg-black/20'}`}>Không</button>}
          {choices.map((item) => <button key={item.id} title={item.name} onClick={() => equip(item.id)} className={`relative aspect-square overflow-hidden rounded-xl border-2 bg-black/20 transition-transform active:scale-95 ${appearance[`${slot}Id` as keyof DuckAppearance] === item.id ? 'border-[var(--color-ggd-gold)] shadow-[0_0_12px_rgba(255,216,77,0.35)]' : 'border-white/10 hover:border-white/30'}`}><img src={item.previewAsset || item.asset} alt={item.name} className="h-full w-full object-contain" /><span className="absolute inset-x-1 bottom-1 truncate rounded bg-black/75 px-1 text-[9px] font-black">{item.name}</span></button>)}
          {choices.length === 0 && <div className="col-span-full rounded-xl border border-dashed border-white/15 p-4 text-sm text-white/50">Chưa có món nào.</div>}
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <button onClick={randomize} className="rounded-xl border-2 border-white/20 px-4 py-2 font-black">🎲 RANDOM</button>
          <button disabled={saving} onClick={() => void save()} className="rounded-xl bg-[var(--color-ggd-gold)] px-5 py-2 font-black text-[var(--color-ggd-outline)] disabled:opacity-50">{saving ? 'ĐANG LƯU...' : 'LƯU DZỊT'}</button>
          {message && <span className="self-center text-sm font-bold text-[var(--color-ggd-neon-green)]">{message}</span>}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/10 pt-4"><input value={presetName} onChange={(event) => setPresetName(event.target.value)} placeholder="Tên preset" maxLength={30} className="min-w-32 flex-1 rounded-xl border border-white/15 bg-black/25 px-3 py-2 text-sm" />{[1, 2, 3].map((index) => <div key={index} className="flex overflow-hidden rounded-xl border border-white/15"><button onClick={() => void preset('load-preset', index)} className="px-3 py-2 text-xs font-black">MẶC {index}</button><button onClick={() => void preset('save-preset', index)} className="border-l border-white/15 bg-white/5 px-2 py-2 text-xs font-black">LƯU</button></div>)}</div>
      </div>
    </div>
  </section>
}
