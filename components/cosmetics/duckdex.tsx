'use client'

/* eslint-disable @next/next/no-img-element -- Duckdex shows exact SVG source assets */

import { useMemo, useState } from 'react'
import type { CosmeticDefinition } from '@/lib/cosmetics/types'

export function Duckdex({ token, catalog, inventory, favoriteId, onChanged }: {
  token: string
  catalog: CosmeticDefinition[]
  inventory: Array<{ cosmeticId: string; isNew?: boolean; source?: string; obtainedAt?: string }>
  favoriteId?: string | null
  onChanged: () => Promise<void>
}) {
  const [ownedOnly, setOwnedOnly] = useState(false)
  const [query, setQuery] = useState('')
  const [message, setMessage] = useState('')
  const owned = useMemo(() => new Map(inventory.map((item) => [item.cosmeticId, item])), [inventory])
  const filtered = catalog.filter((item) => (!ownedOnly || owned.has(item.id)) && `${item.name} ${item.collection ?? ''} ${item.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase()))
  const collections = new Set(catalog.flatMap((item) => item.collection ? [item.collection] : []))
  const completed = [...collections].filter((collection) => {
    const set = catalog.filter((item) => item.collection === collection)
    return set.length > 0 && set.every((item) => owned.has(item.id))
  }).length

  async function favorite(cosmeticId: string) {
    const response = await fetch('/api/season3', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, action: 'favorite', cosmeticId }) })
    setMessage(response.ok ? 'Đã chọn favorite.' : 'Không chọn được favorite.')
    if (response.ok) await onChanged()
  }

  return <section className="rounded-[2rem] border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-surface-2)] p-5">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><div className="text-xs font-black tracking-[0.2em] text-[var(--color-ggd-lavender)]">COLLECTION</div><h2 className="font-display text-3xl">📚 Duckdex</h2><p className="text-sm text-white/55">{owned.size}/{catalog.length} món · {completed}/{collections.size} bộ hoàn thành</p></div><div className="flex gap-2"><input aria-label="Tìm Duckdex" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm..." className="w-36 rounded-xl border border-white/15 bg-black/25 px-3 py-2 text-sm" /><button onClick={() => setOwnedOnly(!ownedOnly)} className={`rounded-xl px-3 py-2 text-xs font-black ${ownedOnly ? 'bg-[var(--color-ggd-lavender)] text-[var(--color-ggd-outline)]' : 'border border-white/15'}`}>ĐÃ CÓ</button></div></div>
    <div className="mt-4 grid max-h-[32rem] grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-5 lg:grid-cols-8">
      {filtered.map((item) => { const entry = owned.get(item.id); return <button key={item.id} disabled={!entry} onClick={() => void favorite(item.id)} title={entry ? `${item.name} · ${entry.source ?? ''}` : 'Chưa mở khóa'} className={`relative aspect-square overflow-hidden rounded-xl border-2 bg-black/20 ${favoriteId === item.id ? 'border-[var(--color-ggd-gold)]' : entry ? 'border-white/15' : 'border-white/5 grayscale'}`}><img src={item.asset} alt={entry ? item.name : 'Cosmetic chưa mở khóa'} className={`h-full w-full object-contain ${entry ? '' : 'opacity-20'}`} />{entry?.isNew && <span className="absolute right-1 top-1 rounded bg-[var(--color-ggd-hot-pink)] px-1 text-[9px] font-black">NEW</span>}{favoriteId === item.id && <span className="absolute left-1 top-1">⭐</span>}<span className="absolute inset-x-1 bottom-1 truncate rounded bg-black/65 px-1 text-[8px] font-black">{entry ? item.name : '???'}</span></button> })}
    </div>
    {message && <p className="mt-3 text-sm font-bold text-[var(--color-ggd-neon-green)]">{message}</p>}
  </section>
}
