'use client'

/* eslint-disable @next/next/no-img-element -- exact SVG collection assets are intentionally unoptimized */

import Link from 'next/link'
import { use, useEffect, useState } from 'react'
import { CosmeticDuck } from '@/components/cosmetics/cosmetic-duck'
import { COSMETIC_BY_ID } from '@/lib/cosmetics/catalog'
import type { DuckAppearance } from '@/lib/cosmetics/types'

type ProfileData = {
  userId: number
  name: string
  avatarUrl?: string | null
  season: string
  appearance: DuckAppearance
  favoriteId: string | null
  collectionCount: number
  recentCosmetics: Array<{ cosmeticId: string; source: string; obtainedAt?: string }>
  stats: {
    raceWins: number
    raceCount: number
    kingStreak: number
    scars: number
    shields: number
    championshipPoints?: number
    predictionPoints?: number
    quackPoints?: number
    isKing?: boolean
  }
  isOwner?: boolean
  personalLink?: string | null
  error?: string
}

const RARITY_COLORS: Record<string, { label: string; badge: string; border: string }> = {
  common: { label: 'Thường', badge: 'bg-zinc-700/60 text-zinc-300', border: 'border-zinc-600/40' },
  uncommon: { label: 'Hiếm', badge: 'bg-emerald-800/60 text-emerald-300', border: 'border-emerald-500/40' },
  rare: { label: 'Hiếm có', badge: 'bg-blue-800/60 text-blue-300', border: 'border-blue-500/40' },
  epic: { label: 'Sử thi', badge: 'bg-purple-800/60 text-purple-300', border: 'border-purple-500/40' },
  legendary: { label: 'Huyền thoại', badge: 'bg-amber-800/60 text-amber-300', border: 'border-amber-400/50' },
}

export default function DuckProfilePage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = use(params)
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [token, setToken] = useState('')
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(true)
  const [manualToken, setManualToken] = useState('')
  const [showTokenInput, setShowTokenInput] = useState(false)

  useEffect(() => {
    let activeToken = ''
    if (typeof window !== 'undefined') {
      const queryToken = new URLSearchParams(window.location.search).get('token')
      const storedToken = localStorage.getItem('autoduck_season3_token')
      activeToken = queryToken || storedToken || ''
      if (queryToken) {
        localStorage.setItem('autoduck_season3_token', queryToken)
      }
      setToken(activeToken)
    }

    void fetchProfile(activeToken)
  }, [userId])

  async function fetchProfile(authToken: string) {
    setLoading(true)
    try {
      const query = authToken ? `?token=${encodeURIComponent(authToken)}` : ''
      const res = await fetch(`/api/cosmetics/profile/${userId}${query}`, { cache: 'no-store' })
      const data = await res.json() as ProfileData
      setProfile(data)
    } catch {
      setProfile({ error: 'Không thể tải thông tin dzịt.' } as ProfileData)
    } finally {
      setLoading(false)
    }
  }

  function handleTokenSubmit(e: React.FormEvent) {
    e.preventDefault()
    let cleanToken = manualToken.trim()
    if (cleanToken.includes('token=')) {
      try {
        const url = new URL(cleanToken, window.location.origin)
        cleanToken = url.searchParams.get('token') || cleanToken
      } catch {
        const match = cleanToken.match(/token=([a-zA-Z0-9_-]+)/)
        if (match) cleanToken = match[1]
      }
    }
    if (!cleanToken) return
    localStorage.setItem('autoduck_season3_token', cleanToken)
    setToken(cleanToken)
    setShowTokenInput(false)
    void fetchProfile(cleanToken)
  }

  function copyPersonalLink() {
    if (!profile?.personalLink && !token) return
    const fullUrl = `${window.location.origin}/season-3?token=${encodeURIComponent(token)}`
    void navigator.clipboard.writeText(fullUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  if (loading) {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-4xl items-center justify-center p-6 text-white">
        <div className="animate-pulse text-center">
          <div className="text-6xl">🦆</div>
          <p className="mt-3 font-display text-2xl text-white/70">Đang gọi dzịt lên bờ...</p>
        </div>
      </main>
    )
  }

  if (profile?.error || !profile) {
    return (
      <main className="mx-auto max-w-2xl p-6 text-center text-white">
        <div className="rounded-[2rem] border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] p-8 shadow-[0_8px_0_var(--color-ggd-outline)]">
          <div className="text-5xl">⚠️</div>
          <h1 className="mt-3 font-display text-3xl">{profile?.error || 'Không tìm thấy chú dzịt này'}</h1>
          <Link
            href={`/season-3${token ? `?token=${encodeURIComponent(token)}` : ''}`}
            className="mt-5 inline-block rounded-xl bg-[var(--color-ggd-gold)] px-6 py-3 font-black text-[var(--color-ggd-outline)]"
          >
            ← Về Sảnh Đua
          </Link>
        </div>
      </main>
    )
  }

  const favorite = profile.favoriteId ? COSMETIC_BY_ID.get(profile.favoriteId) : null
  const homeUrl = `/season-3${token ? `?token=${encodeURIComponent(token)}` : ''}`

  return (
    <main className="mx-auto min-h-screen max-w-4xl space-y-6 p-4 pb-20 text-white sm:p-6 lg:p-8">
      {/* Top Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={homeUrl}
          className="inline-flex items-center gap-2 rounded-xl border-2 border-white/20 bg-black/30 px-4 py-2 text-sm font-black text-white/80 transition hover:border-[var(--color-ggd-neon-green)] hover:text-[var(--color-ggd-neon-green)]"
        >
          <span>← VỀ SẢNH ĐUA</span>
        </Link>

        {!profile.isOwner && (
          <div className="flex items-center gap-2">
            {!showTokenInput ? (
              <button
                type="button"
                onClick={() => setShowTokenInput(true)}
                className="rounded-xl border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-bold text-white/60 transition hover:bg-white/10 hover:text-white"
              >
                🔑 {token ? 'Đổi token' : 'Bạn là chủ dzịt này?'}
              </button>
            ) : (
              <form onSubmit={handleTokenSubmit} className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Dán token / secret link"
                  value={manualToken}
                  onChange={(e) => setManualToken(e.target.value)}
                  className="rounded-lg border border-white/20 bg-black/40 px-3 py-1.5 text-xs text-white placeholder:text-white/30 focus:border-[var(--color-ggd-neon-green)] focus:outline-none"
                />
                <button
                  type="submit"
                  className="rounded-lg bg-[var(--color-ggd-neon-green)] px-3 py-1.5 text-xs font-black text-[var(--color-ggd-outline)]"
                >
                  OK
                </button>
                <button
                  type="button"
                  onClick={() => setShowTokenInput(false)}
                  className="rounded-lg border border-white/15 px-2 py-1.5 text-xs text-white/50"
                >
                  ✕
                </button>
              </form>
            )}
          </div>
        )}
      </div>

      {/* Owner Welcome Banner */}
      {profile.isOwner && (
        <section className="relative overflow-hidden rounded-[2rem] border-4 border-[var(--color-ggd-neon-green)] bg-[linear-gradient(135deg,rgba(61,255,143,.18),rgba(36,21,72,.9))] p-5 shadow-[0_6px_0_var(--color-ggd-outline)]">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-3xl">👑</span>
              <div>
                <div className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-ggd-neon-green)]/20 px-2.5 py-0.5 text-[10px] font-black tracking-widest text-[var(--color-ggd-neon-green)]">
                  BẠN ĐANG ĐĂNG NHẬP VỚI TƯ CÁCH CHỦ DZỊT
                </div>
                <h2 className="mt-1 font-display text-2xl text-white">Xin chào, {profile.name}!</h2>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={copyPersonalLink}
                className={`rounded-xl border-2 px-4 py-2 text-xs font-black transition ${
                  copied
                    ? 'border-[var(--color-ggd-neon-green)] bg-[var(--color-ggd-neon-green)] text-[var(--color-ggd-outline)]'
                    : 'border-[var(--color-ggd-gold)] bg-[var(--color-ggd-gold)]/10 text-[var(--color-ggd-gold)] hover:bg-[var(--color-ggd-gold)] hover:text-[var(--color-ggd-outline)]'
                }`}
              >
                {copied ? '✓ ĐÃ SAO CHÉP LINK!' : '🔗 SAO CHÉP SECRET LINK'}
              </button>
              <Link
                href={`${homeUrl}#closet`}
                className="rounded-xl border-2 border-white/20 bg-black/30 px-4 py-2 text-xs font-black text-white transition hover:border-[var(--color-ggd-neon-green)]"
              >
                🎒 ĐỔI ĐỒ (TỦ ĐỒ)
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* Hero Showcase Card */}
      <section className="relative overflow-hidden rounded-[2rem] border-4 border-[var(--color-ggd-outline)] bg-[radial-gradient(circle_at_50%_15%,rgba(61,255,143,.25),transparent_40%),linear-gradient(135deg,#241548,#120b24)] text-center shadow-[0_8px_0_var(--color-ggd-outline)]">
        <div className="flex justify-center p-6 sm:p-8">
          <div className="relative">
            <CosmeticDuck appearance={profile.appearance} size={280} label={`Dzịt của ${profile.name}`} />
            {profile.stats.isKing && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full border-2 border-[var(--color-ggd-gold)] bg-black/80 px-3 py-1 font-display text-xs font-bold text-[var(--color-ggd-gold)] shadow-lg backdrop-blur-sm">
                👑 KING OF THE POND (Streak x{profile.stats.kingStreak})
              </div>
            )}
          </div>
        </div>

        <div className="border-t-2 border-white/10 bg-black/30 p-6">
          <div className="inline-block rounded-full bg-white/10 px-3 py-1 text-xs font-black tracking-[0.2em] text-[var(--color-ggd-neon-green)]">
            {profile.season}
          </div>
          <h1 className="mt-2 font-display text-4xl text-white sm:text-5xl">{profile.name}</h1>
          {favorite && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-[var(--color-ggd-gold)]/30 bg-[var(--color-ggd-gold)]/10 px-3 py-1 text-xs font-black text-[var(--color-ggd-gold)]">
              <span>⭐ Món yêu thích:</span>
              <span>{favorite.name}</span>
            </p>
          )}

          {/* Stats Grid */}
          <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
              <div className="font-display text-2xl text-[var(--color-ggd-gold)]">{profile.stats.championshipPoints ?? '—'}</div>
              <div className="text-[10px] font-black uppercase tracking-wider text-white/50">🏅 BXH Vô Địch</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
              <div className="font-display text-2xl text-[var(--color-ggd-neon-green)]">{profile.stats.raceWins}</div>
              <div className="text-[10px] font-black uppercase tracking-wider text-white/50">🏆 Race Thắng</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
              <div className="font-display text-2xl text-white">{profile.stats.raceCount}</div>
              <div className="text-[10px] font-black uppercase tracking-wider text-white/50">🏁 Tổng Đua</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
              <div className="font-display text-2xl text-[var(--color-ggd-orange)]">{profile.stats.scars}</div>
              <div className="text-[10px] font-black uppercase tracking-wider text-white/50">🩹 Sẹo (Scars)</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
              <div className="font-display text-2xl text-[var(--color-ggd-sky)]">{profile.stats.shields}</div>
              <div className="text-[10px] font-black uppercase tracking-wider text-white/50">🛡️ Khiên (Shield)</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
              <div className="font-display text-2xl text-[var(--color-ggd-lavender)]">{profile.stats.predictionPoints ?? 0}</div>
              <div className="text-[10px] font-black uppercase tracking-wider text-white/50">🔮 Tiên Tri</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
              <div className="font-display text-2xl text-amber-300">{profile.collectionCount}</div>
              <div className="text-[10px] font-black uppercase tracking-wider text-white/50">🎒 Bộ sưu tập</div>
            </div>
          </div>
        </div>
      </section>

      {/* Unlocked Cosmetics Gallery */}
      <section className="rounded-[2rem] border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-surface-2)] p-6 shadow-[0_6px_0_var(--color-ggd-outline)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
          <div>
            <div className="text-xs font-black tracking-widest text-[var(--color-ggd-gold)]">WARDROBE & COSMETICS</div>
            <h2 className="font-display text-2xl text-white sm:text-3xl">Bộ Sưu Tập Thời Trang</h2>
          </div>
          <div className="rounded-full bg-black/30 px-3.5 py-1 text-xs font-black text-white/70">
            {profile.collectionCount} MÓN ĐÃ MỞ KHÓA
          </div>
        </div>

        {profile.recentCosmetics.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-sm text-white/50">
            Chú dzịt này chưa mở khóa trang phục nào.
          </div>
        ) : (
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
            {profile.recentCosmetics.map((entry) => {
              const item = COSMETIC_BY_ID.get(entry.cosmeticId)
              if (!item) return null
              const meta = RARITY_COLORS[item.rarity] || RARITY_COLORS.common

              return (
                <div
                  key={`${item.id}-${entry.obtainedAt || ''}`}
                  className={`group relative flex flex-col items-center justify-between rounded-2xl border-2 ${meta.border} bg-black/30 p-2.5 transition hover:scale-105 hover:bg-black/50`}
                >
                  <div className="relative aspect-square w-full">
                    <img
                      src={item.asset}
                      alt={item.name}
                      className="h-full w-full object-contain drop-shadow-md"
                      loading="lazy"
                    />
                  </div>
                  <div className="mt-2 w-full text-center">
                    <div className="truncate text-xs font-bold text-white/90" title={item.name}>
                      {item.name}
                    </div>
                    <span className={`mt-1 inline-block rounded px-1.5 py-0.2 text-[9px] font-black ${meta.badge}`}>
                      {meta.label}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {profile.isOwner && (
          <div className="mt-6 flex flex-wrap justify-center gap-3 border-t border-white/10 pt-4">
            <Link
              href={`${homeUrl}#shop`}
              className="rounded-xl bg-[var(--color-ggd-gold)] px-6 py-2.5 font-display text-sm font-black text-[var(--color-ggd-outline)] transition hover:brightness-110"
            >
              🪙 VÀO TIỆM THỜI TRANG (SHOP)
            </Link>
            <Link
              href={`${homeUrl}#closet`}
              className="rounded-xl border-2 border-white/20 bg-black/30 px-6 py-2.5 font-display text-sm font-black text-white transition hover:border-[var(--color-ggd-neon-green)]"
            >
              🎒 MỞ TỦ ĐỒ (CLOSET)
            </Link>
          </div>
        )}
      </section>
    </main>
  )
}
