'use client'

/* eslint-disable @next/next/no-img-element -- Duckdex shows exact SVG source assets */

import { useMemo, useState } from 'react'
import type { CosmeticDefinition } from '@/lib/cosmetics/types'
import { RARITY_STYLE } from './duck-closet'
import { GameButton, GamePanel, Progress, UiIcon } from '@/components/game-ui'

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

  const percent = catalog.length ? Math.round((owned.size / catalog.length) * 100) : 0
  return <GamePanel tone="sky" icon="book" kicker="BỘ SƯU TẬP" title="Duckdex"
    actions={<div className="flex gap-2"><input aria-label="Tìm Duckdex" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm…" className="gx-well w-32 px-3 py-2 text-sm focus:border-[var(--gx-mint)] focus:outline-none sm:w-40" /><GameButton size="sm" variant={ownedOnly ? 'mint' : 'ghost'} onClick={() => setOwnedOnly(!ownedOnly)}>ĐÃ CÓ</GameButton></div>}>
    <div className="flex flex-wrap items-center gap-3 text-sm font-black">
      <span>{owned.size}/{catalog.length} món</span>
      <Progress value={owned.size} max={catalog.length} className="min-w-40 flex-1" />
      <span className="text-[#7dd3fc]">{percent}%</span>
      <span className="gx-chip pl-2">🏅 {completed}/{collections.size} bộ</span>
    </div>
    <div className="mt-4 grid max-h-[34rem] grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-5 lg:grid-cols-8">
      {filtered.map((item) => {
        const entry = owned.get(item.id)
        const rarity = RARITY_STYLE[item.rarity]
        return <button key={item.id} type="button" disabled={!entry} onClick={() => void favorite(item.id)} title={entry ? `${item.name} · ${rarity.label}` : 'Chưa mở khóa'}
          className={`gx-well relative aspect-square overflow-hidden transition enabled:hover:-translate-y-0.5 ${favoriteId === item.id ? 'border-[var(--gx-gold)] shadow-[0_0_14px_rgba(255,216,77,.45)]' : ''}`}
          style={entry ? { borderColor: favoriteId === item.id ? undefined : `${rarity.color}77`, background: `radial-gradient(circle at 50% 35%, ${rarity.glow}, rgba(10,6,24,.35) 70%)` } : undefined}>
          <img src={item.previewAsset || item.asset} alt={entry ? item.name : 'Chưa mở khóa'} className={`h-full w-full object-contain ${entry ? '' : 'opacity-25 brightness-0 invert-[.15]'}`} />
          {!entry && <span className="absolute inset-0 grid place-items-center"><UiIcon name="lock" size={26} className="opacity-70" /></span>}
          {entry?.isNew && <span className="absolute right-1 top-1 rounded-md border-2 border-[var(--gx-ink)] bg-[var(--gx-rose)] px-1 text-[9px] font-black">MỚI</span>}
          {favoriteId === item.id && <span className="absolute left-1 top-1">⭐</span>}
          <span className="absolute inset-x-1 bottom-1 truncate rounded bg-black/70 px-1 text-[8px] font-black" style={{ color: entry && item.rarity !== 'common' ? rarity.color : undefined }}>{entry ? item.name : '???'}</span>
        </button>
      })}
    </div>
    {message && <p className="mt-3 text-sm font-bold text-[#bbf7d0]">{message}</p>}
  </GamePanel>
}
