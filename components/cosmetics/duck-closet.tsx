'use client'

import { useMemo, useState } from 'react'
import { CosmeticDuck } from './cosmetic-duck'
import { GameButton, ResourcePill } from '@/components/game-ui'

/* eslint-disable @next/next/no-img-element -- decorative lily pad SVG */
import { COSMETIC_RARITIES, SLOT_FRAMES, type CosmeticDefinition, type CosmeticRarity, type CosmeticSlot, type DuckAppearance } from '@/lib/cosmetics/types'

export const RARITY_STYLE: Record<CosmeticRarity, { label: string; color: string; glow: string }> = {
  common: { label: 'Thường', color: '#94A3B8', glow: 'rgba(148,163,184,0)' },
  uncommon: { label: 'Khá', color: '#4ADE80', glow: 'rgba(74,222,128,0.18)' },
  rare: { label: 'Hiếm', color: '#38BDF8', glow: 'rgba(56,189,248,0.25)' },
  epic: { label: 'Sử thi', color: '#C084FC', glow: 'rgba(192,132,252,0.32)' },
  legendary: { label: 'Huyền thoại', color: '#FBBF24', glow: 'rgba(251,191,36,0.42)' },
}

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
  const choices = catalog
    .filter((item) => item.slot === slot && owned.has(item.id))
    .sort((left, right) => COSMETIC_RARITIES.indexOf(right.rarity) - COSMETIC_RARITIES.indexOf(left.rarity))
  const slotKey = `${slot}Id` as keyof DuckAppearance
  // Tiles try the item on the player's own duck, minus anything that would hide it or clutter the crop:
  // ambient extras (aura, pet, trail) always, and the outfit when picking a color or skin it would cover.
  const tileBase = useMemo(() => {
    const base: Record<string, string> = {}
    const keys = slot === 'bodyColor' ? ['bodyColorId', 'faceId'] as const
      : slot === 'bodySkin' ? ['bodyColorId', 'bodySkinId', 'faceId'] as const
        : ['bodyColorId', 'bodySkinId', 'faceId', 'headId', 'outfitId'] as const
    for (const key of keys) {
      const value = appearance[key]
      if (value) base[key] = value
    }
    return base as DuckAppearance
  }, [appearance, slot])
  const equippedItem = catalog.find((item) => item.id === appearance[slotKey])

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

  return <section className="gx-panel overflow-hidden" data-tone="violet">
    <div className="relative grid md:grid-cols-[300px_1fr]">
      <div className="flex flex-col items-center justify-center border-b-[3px] border-[var(--gx-ink)] bg-[radial-gradient(circle_at_50%_40%,rgba(125,211,252,.25),transparent_65%),rgba(10,6,24,.3)] p-5 md:sticky md:top-24 md:self-start md:border-b-0 md:border-r-[3px]">
        <div className="gx-kicker text-[#a5f3fc]">{onboarded ? 'TỦ ĐỒ' : 'TẠO DZỊT CỦA BẠN'}</div>
        <div className="relative">
          <img src="/race-fx/decor/lilypad.svg" alt="" aria-hidden className="absolute bottom-2 left-1/2 w-[80%] -translate-x-1/2" />
          <div key={JSON.stringify(appearance)} className="closet-equip-pop relative"><CosmeticDuck appearance={appearance} size={240} label={`Dzịt của ${name}`} /></div>
        </div>
        <div className="gx-title text-3xl">{name}</div>
        <ResourcePill icon="coin" value={quackPoints} label="Quack Points" className="mt-2" />
      </div>
      <div className="p-5">
        <div className="flex flex-wrap gap-2">
          {INTERACTIVE_SLOTS.map((option) => {
            const total = catalog.filter((item) => item.slot === option.id).length
            const mine = catalog.filter((item) => item.slot === option.id && owned.has(item.id)).length
            return <button key={option.id} type="button" role="tab" aria-selected={slot === option.id} onClick={() => setSlot(option.id)} className="gx-tab py-1.5 pl-3 text-base">{option.label} <span className="font-data text-xs opacity-60">{mine}/{total}</span></button>
          })}
        </div>
        <div className="mt-3 min-h-5 text-xs font-bold text-white/60">
          {equippedItem ? <>Đang mặc: <span style={{ color: RARITY_STYLE[equippedItem.rarity].color }}>{equippedItem.name}</span> · {RARITY_STYLE[equippedItem.rarity].label} · {equippedItem.collection}</> : 'Chưa mặc gì ở ô này.'}
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {slot !== 'bodyColor' && <button onClick={() => equip(null)} className={`aspect-square rounded-xl border-2 text-xs font-black ${!appearance[slotKey] ? 'border-white bg-white/10' : 'border-white/10 bg-black/20'}`}>Không</button>}
          {choices.map((item) => {
            const rarity = RARITY_STYLE[item.rarity]
            const selected = appearance[slotKey] === item.id
            return <button
              key={item.id}
              title={`${item.name} · ${rarity.label}`}
              onClick={() => equip(item.id)}
              className={`closet-tile closet-tile--${item.rarity} group relative aspect-square overflow-hidden rounded-xl border-2 active:scale-95`}
              style={{
                borderColor: selected ? 'var(--color-ggd-gold)' : `${rarity.color}66`,
                background: `radial-gradient(circle at 50% 40%, ${rarity.glow}, rgba(0,0,0,0.25) 70%)`,
                boxShadow: selected ? '0 0 14px rgba(255,216,77,0.45)' : undefined,
              }}
            >
              <span className="absolute inset-0">
                <CosmeticDuck appearance={{ ...tileBase, [slotKey]: item.id }} size="100%" frame={SLOT_FRAMES[slot]} animate={false} label={item.name} />
              </span>
              <span className="absolute left-1.5 top-1.5 h-2.5 w-2.5 rotate-45 rounded-[2px] border border-black/60" style={{ background: rarity.color }} />
              <span className="absolute inset-x-1 bottom-1 truncate rounded bg-black/75 px-1 text-[9px] font-black" style={{ color: item.rarity === 'common' ? undefined : rarity.color }}>{item.name}</span>
            </button>
          })}
          {choices.length === 0 && <div className="col-span-full rounded-xl border border-dashed border-white/15 p-4 text-sm text-white/50">Chưa có món nào.</div>}
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <GameButton variant="ghost" onClick={randomize}>🎲 NGẪU NHIÊN</GameButton>
          <GameButton variant="mint" disabled={saving} onClick={() => void save()} icon="duck">{saving ? 'ĐANG LƯU…' : 'LƯU DZỊT'}</GameButton>
          {message && <span className="self-center text-sm font-bold text-[var(--color-ggd-neon-green)]">{message}</span>}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t-2 border-black/30 pt-4"><input value={presetName} onChange={(event) => setPresetName(event.target.value)} placeholder="Tên preset" maxLength={30} className="gx-well min-w-32 flex-1 px-3 py-2 text-sm focus:border-[var(--gx-mint)] focus:outline-none" />{[1, 2, 3].map((index) => <div key={index} className="flex overflow-hidden rounded-xl border-[3px] border-[var(--gx-ink)] shadow-[0_3px_0_var(--gx-ink)]"><button type="button" onClick={() => void preset('load-preset', index)} className="bg-[#3b2c78] px-3 py-1.5 text-xs font-black hover:bg-[#4c3a96]">MẶC {index}</button><button type="button" onClick={() => void preset('save-preset', index)} className="border-l-2 border-[var(--gx-ink)] bg-[#261a52] px-2 py-1.5 text-xs font-black text-white/70 hover:text-white">LƯU</button></div>)}</div>
      </div>
    </div>
  </section>
}
