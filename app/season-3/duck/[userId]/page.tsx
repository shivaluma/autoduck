'use client'

/* eslint-disable @next/next/no-img-element -- exact SVG collection assets are intentionally unoptimized */

import Link from 'next/link'
import { use, useEffect, useState } from 'react'
import { CosmeticDuck } from '@/components/cosmetics/cosmetic-duck'
import { COSMETIC_BY_ID } from '@/lib/cosmetics/catalog'
import type { DuckAppearance } from '@/lib/cosmetics/types'

type Profile = { name: string; season: string; appearance: DuckAppearance; favoriteId: string | null; collectionCount: number; recentCosmetics: Array<{ cosmeticId: string; source: string }>; stats: { raceWins: number; raceCount: number; kingStreak: number; scars: number; shields: number }; error?: string }

export default function DuckProfilePage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = use(params)
  const [profile, setProfile] = useState<Profile | null>(null)
  useEffect(() => { void fetch(`/api/cosmetics/profile/${userId}`).then((response) => response.json()).then(setProfile) }, [userId])
  if (!profile) return <main className="p-8 text-center text-white">Đang gọi dzịt...</main>
  if (profile.error) return <main className="p-8 text-center text-white">{profile.error}</main>
  const favorite = profile.favoriteId ? COSMETIC_BY_ID.get(profile.favoriteId) : null
  return <main className="mx-auto min-h-screen max-w-3xl p-5 text-white">
    <Link href="/season-3" className="text-sm font-black text-white/55">← VỀ POND</Link>
    <section className="mt-4 overflow-hidden rounded-[2rem] border-4 border-[var(--color-ggd-outline)] bg-[radial-gradient(circle_at_50%_20%,rgba(61,255,143,.2),transparent_35%),#241548] text-center shadow-[0_8px_0_var(--color-ggd-outline)]">
      <div className="flex justify-center p-5"><CosmeticDuck appearance={profile.appearance} size={300} label={`Dzịt của ${profile.name}`} /></div>
      <div className="bg-black/20 p-6"><div className="text-xs font-black tracking-[0.2em] text-[var(--color-ggd-neon-green)]">{profile.season}</div><h1 className="font-display text-5xl">{profile.name}</h1>{favorite && <p className="mt-2 text-[var(--color-ggd-gold)]">⭐ {favorite.name}</p>}<div className="mt-5 grid grid-cols-3 gap-2 sm:grid-cols-5">{[['Thắng', profile.stats.raceWins], ['Race', profile.stats.raceCount], ['King', profile.stats.kingStreak], ['Sẹo', profile.stats.scars], ['Collection', profile.collectionCount]].map(([label, value]) => <div key={label} className="rounded-xl bg-black/25 p-3"><div className="font-display text-2xl">{value}</div><div className="text-[9px] font-black uppercase text-white/45">{label}</div></div>)}</div></div>
    </section>
    <section className="mt-5 rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] p-5"><h2 className="font-display text-2xl">Mới mở khóa</h2><div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-8">{profile.recentCosmetics.map((entry) => { const item = COSMETIC_BY_ID.get(entry.cosmeticId); return item ? <div key={item.id} title={`${item.name} · ${entry.source}`} className="rounded-xl bg-black/20"><img src={item.asset} alt={item.name} className="aspect-square w-full object-contain" /></div> : null })}</div></section>
  </main>
}
