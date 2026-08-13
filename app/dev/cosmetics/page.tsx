'use client'

import { useState } from 'react'
import { CosmeticDuck } from '@/components/cosmetics/cosmetic-duck'
import { COSMETIC_CATALOG, DEFAULT_APPEARANCE } from '@/lib/cosmetics/catalog'
import { COSMETIC_RARITIES, COSMETIC_SLOTS, type DuckAppearance } from '@/lib/cosmetics/types'

const backgrounds = {
  dark: 'bg-[#100b20]',
  light: 'bg-[#f5efe2]',
  river: 'bg-[linear-gradient(145deg,#69d4ef,#167eae)]',
}

export default function CosmeticsGalleryPage() {
  const [query, setQuery] = useState('')
  const [slot, setSlot] = useState('all')
  const [rarity, setRarity] = useState('all')
  const [collection, setCollection] = useState('all')
  const [background, setBackground] = useState<keyof typeof backgrounds>('dark')
  const collections = [...new Set(COSMETIC_CATALOG.flatMap((item) => item.collection ? [item.collection] : []))].sort()
  const filtered = COSMETIC_CATALOG.filter((item) =>
    (slot === 'all' || item.slot === slot)
    && (rarity === 'all' || item.rarity === rarity)
    && (collection === 'all' || item.collection === collection)
    && `${item.name} ${item.id} ${item.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase()),
  )

  return <main className="mx-auto min-h-screen max-w-7xl p-5 text-white">
    <header className="rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] p-6">
      <div className="text-xs font-black tracking-[0.2em] text-[var(--color-ggd-neon-green)]">VISUAL QA</div>
      <h1 className="font-display text-4xl">Cosmetic Gallery</h1>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <input aria-label="Tìm cosmetic" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm..." className="rounded-xl border border-white/15 bg-black/25 px-3 py-2" />
        <select aria-label="Slot" value={slot} onChange={(event) => setSlot(event.target.value)} className="rounded-xl border border-white/15 bg-[#17102c] px-3 py-2"><option value="all">Tất cả slot</option>{COSMETIC_SLOTS.map((value) => <option key={value}>{value}</option>)}</select>
        <select aria-label="Rarity" value={rarity} onChange={(event) => setRarity(event.target.value)} className="rounded-xl border border-white/15 bg-[#17102c] px-3 py-2"><option value="all">Tất cả rarity</option>{COSMETIC_RARITIES.map((value) => <option key={value}>{value}</option>)}</select>
        <select aria-label="Collection" value={collection} onChange={(event) => setCollection(event.target.value)} className="rounded-xl border border-white/15 bg-[#17102c] px-3 py-2"><option value="all">Tất cả collection</option>{collections.map((value) => <option key={value}>{value}</option>)}</select>
        <select aria-label="Background" value={background} onChange={(event) => setBackground(event.target.value as keyof typeof backgrounds)} className="rounded-xl border border-white/15 bg-[#17102c] px-3 py-2">{Object.keys(backgrounds).map((value) => <option key={value}>{value}</option>)}</select>
      </div>
    </header>
    <div className="my-4 text-sm font-black text-white/60">{filtered.length}/{COSMETIC_CATALOG.length} items</div>
    <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
      {filtered.map((item) => {
        const appearance = { ...DEFAULT_APPEARANCE, [`${item.slot}Id`]: item.id } as DuckAppearance
        return <article key={item.id} className="overflow-hidden rounded-2xl border-2 border-white/10 bg-[var(--color-ggd-panel)]">
          <div className={`flex aspect-square items-center justify-center ${backgrounds[background]}`}><CosmeticDuck appearance={appearance} size={190} label={item.name} /></div>
          <div className="p-3"><div className="truncate font-black">{item.name}</div><div className="mt-1 flex justify-between text-[10px] font-bold uppercase text-white/45"><span>{item.slot}</span><span>{item.rarity}</span></div><div className="mt-1 truncate text-[10px] text-white/35">{item.id}</div></div>
        </article>
      })}
    </section>
  </main>
}
