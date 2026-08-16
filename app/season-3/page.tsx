'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Season3ChaosCard } from '@/components/season3-chaos-card'
import { Season3Avatar } from '@/components/season3-avatar'
import { Season3PointTooltip } from '@/components/season3-point-tooltip'
import type { RaceItemId } from '@/packages/race-protocol/src'
import { DuckCloset } from '@/components/cosmetics/duck-closet'
import type { CosmeticDefinition, DuckAppearance } from '@/lib/cosmetics/types'
import { QuackEconomy } from '@/components/cosmetics/quack-economy'
import { Duckdex } from '@/components/cosmetics/duckdex'
import { evaluateLoadoutPairing } from '@/lib/racing/loadout-guide'
import { GoogleAuthButton } from '@/components/auth/google-auth-button'

type SeasonData = {
  season: { name: string; year: number; weeks: number } | null
  viewer: {
    userId: number
    name: string
    avatarUrl?: string | null
    email?: string | null
    isGoogleLinked?: boolean
    predictionPoints: number
    quackPoints: number
    scars: number
    shields: number
    isKing: boolean
    kingStreak: number
    cosmeticsOnboarded: boolean
    appearance: DuckAppearance & { favoriteId?: string | null }
    inventory: Array<{ cosmeticId: string; isNew?: boolean; source?: string; obtainedAt?: string }>
  } | null
  personalLink: string | null
  liveRace: { id: number; status: string; isTest: boolean } | null
  raceItems: Array<{ id: RaceItemId; name: string; icon: string; cost: 1 | 2; category: 'major' | 'minor'; description: string }>
  cosmeticCatalog: CosmeticDefinition[]
  players: Array<{ id: number; name: string; avatarUrl?: string | null; predictionPoints: number; scars: number; shields: number; isKing: boolean; kingStreak: number }>
  currentWeek: {
    id: number
    weekNumber: number
    status: string
    chaosType: string
    chaosTargetName: string | null
    chaosGroups?: number[][]
    skippedPlayerIds: number[]
    viewerSkipped: boolean
    predictionCount: number
    predictionSubmitted: boolean
    shieldConfirmed: boolean
    loadoutReadyCount: number
    loadout: { itemIds: RaceItemId[]; status: string }
    raceId: number | null
    raceStatus: string | null
  } | null
  history: Array<{ id: number; weekNumber: number; chaosType: string; recap: string | null }>
  latestReveal: { weekNumber: number; recap: string | null; predictions: Array<{ predictorName: string; targetName: string; pointsAwarded: number }> } | null
}

const chaosNames: Record<string, string> = {
  NORMAL: 'NORMAL',
  REVERSE: 'REVERSE',
  DUO: 'DUO',
  TRIPLE_ELIMINATION: 'TRIPLE ELIMINATION',
  CUT_LINE: 'CUT LINE',
  CONSTRUCTORS: 'CONSTRUCTORS',
  BOUNTY_HUNT: 'BOUNTY HUNT',
}

function StatTile({
  icon,
  label,
  value,
  tone,
  tooltip,
}: {
  icon: string
  label: string
  value: string | number
  tone: string
  tooltip?: boolean
}) {
  return (
    <div className="rounded-2xl border-2 border-white/10 bg-black/20 p-3">
      <div className={`text-2xl ${tone}`}>{icon}</div>
      <div className="mt-2 font-display text-2xl text-white">{value}</div>
      <div className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-white/45">
        <span>{label}</span>
        {tooltip && <Season3PointTooltip />}
      </div>
    </div>
  )
}

export default function Season3Page() {
  const [token, setToken] = useState('')
  const [data, setData] = useState<SeasonData | null>(null)
  const [selectedTarget, setSelectedTarget] = useState<number | null>(null)
  const [message, setMessage] = useState('')
  const [selectedItems, setSelectedItems] = useState<RaceItemId[]>([])
  const [loginInput, setLoginInput] = useState('')
  const [guestName, setGuestName] = useState('')
  const [submittedGuestName, setSubmittedGuestName] = useState('')
  const [loginTab, setLoginTab] = useState<'google' | 'token' | 'request'>('google')
  const [loading, setLoading] = useState(true)
  const [copiedLink, setCopiedLink] = useState(false)
  const [showGoogleBindModal, setShowGoogleBindModal] = useState(false)

  async function loadSeasonData(authToken: string, syncLoadout = true) {
    setLoading(true)
    try {
      const response = await fetch(`/api/season3${authToken ? `?token=${encodeURIComponent(authToken)}` : ''}`, { cache: 'no-store' })
      const next = (await response.json()) as SeasonData
      setData(next)
      if (syncLoadout) {
        setSelectedItems(next.currentWeek?.loadout.itemIds ?? [])
      }
    } catch {
      setMessage('Không tải được dữ liệu Season 3.')
    } finally {
      setLoading(false)
    }
  }

  async function refresh(silent = false, syncLoadout = false) {
    if (!silent) setLoading(true)
    try {
      const response = await fetch(`/api/season3${token ? `?token=${encodeURIComponent(token)}` : ''}`, { cache: 'no-store' })
      const next = (await response.json()) as SeasonData
      setData(next)
      if (syncLoadout || !silent) setSelectedItems(next.currentWeek?.loadout.itemIds ?? [])
    } finally {
      if (!silent) setLoading(false)
    }
  }

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
    void loadSeasonData(activeToken, true)
  }, [])

  function handleLoginSubmit(e: React.FormEvent) {
    e.preventDefault()
    let clean = loginInput.trim()
    if (clean.includes('token=')) {
      try {
        const url = new URL(clean, window.location.origin)
        clean = url.searchParams.get('token') || clean
      } catch {
        const match = clean.match(/token=([a-zA-Z0-9_-]+)/)
        if (match) clean = match[1]
      }
    }
    if (!clean) return
    localStorage.setItem('autoduck_season3_token', clean)
    setToken(clean)
    setLoginInput('')
    void loadSeasonData(clean, true)
  }

  function handleLogout() {
    localStorage.removeItem('autoduck_season3_token')
    setToken('')
    if (window.location.search.includes('token=')) {
      const url = new URL(window.location.href)
      url.searchParams.delete('token')
      window.history.replaceState({}, '', url.pathname)
    }
    void loadSeasonData('', true)
  }

  function copyPersonalLink() {
    if (!token) return
    const fullUrl = `${window.location.origin}/season-3?token=${encodeURIComponent(token)}`
    void navigator.clipboard.writeText(fullUrl)
    setCopiedLink(true)
    setTimeout(() => setCopiedLink(false), 2500)
  }

  async function submitPrediction() {
    if (!selectedTarget || !token) return
    const response = await fetch('/api/season3', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, targetUserId: selectedTarget }),
    })
    const result = (await response.json()) as { error?: string; message?: string }
    setMessage(result.message ?? result.error ?? '')
    if (response.ok) await refresh(true)
  }

  async function confirmShield(useShield: boolean) {
    if (!token) return
    const response = await fetch('/api/season3', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, action: 'shield', useShield }),
    })
    const result = (await response.json()) as { error?: string; message?: string }
    setMessage(result.message ?? result.error ?? '')
    if (response.ok) await refresh(true)
  }

  async function saveLoadout() {
    if (!token) return
    const response = await fetch('/api/season3', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, action: 'loadout', itemIds: selectedItems, ready: true }),
    })
    const result = (await response.json()) as { error?: string; message?: string }
    setMessage(result.message ?? result.error ?? '')
    if (response.ok) await refresh(true, true)
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-6xl p-6 text-white">
        <div className="animate-pulse rounded-3xl bg-white/10 p-8 text-center font-display text-3xl">
          🦆 Đang gọi bầy vịt...
        </div>
      </main>
    )
  }

  if (!data?.season) {
    return (
      <main className="mx-auto max-w-6xl p-6 text-white">
        <div className="rounded-[2rem] border-4 border-black bg-[var(--color-ggd-panel)] p-8 shadow-[0_8px_0_black]">
          <div className="text-sm font-black tracking-[0.25em] text-[var(--color-ggd-gold)]">DUCK POND OFFLINE</div>
          <h1 className="mt-2 font-display text-5xl">Season 3 chưa mở 🦆</h1>
          <p className="mt-3 text-white/65">Host chưa bật season. Quay lại sau nhé.</p>
        </div>
      </main>
    )
  }

  const week = data.currentWeek
  const eligiblePlayers = data.players.filter(
    (player) => player.id !== data.viewer?.userId && !week?.skippedPlayerIds.includes(player.id),
  )
  const groupNames = week?.chaosGroups?.map((group) =>
    group.map((id) => data.players.find((player) => player.id === id)?.name ?? String(id)),
  )
  const selectedCost = selectedItems.reduce(
    (sum, itemId) => sum + (data.raceItems.find((item) => item.id === itemId)?.cost ?? 0),
    0,
  )
  const selectedMajor = selectedItems.some(
    (itemId) => data.raceItems.find((item) => item.id === itemId)?.category === 'major',
  )
  const loadoutHint = selectedItems.length === 2 ? evaluateLoadoutPairing(selectedItems) : null

  function toggleItem(itemId: RaceItemId) {
    if (selectedItems.includes(itemId)) {
      setSelectedItems(selectedItems.filter((selected) => selected !== itemId))
      return
    }
    const item = data!.raceItems.find((candidate) => candidate.id === itemId)!
    if (selectedItems.length >= 2 || selectedCost + item.cost > 3 || (item.category === 'major' && selectedMajor)) return
    setSelectedItems([...selectedItems, itemId])
  }

  const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : ''

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 pb-16 text-white sm:p-6 lg:p-8">
      {/* Header Banner */}
      <header className="relative overflow-hidden rounded-[2rem] border-4 border-[var(--color-ggd-outline)] bg-[radial-gradient(circle_at_85%_15%,rgba(61,255,143,.22),transparent_34%),linear-gradient(135deg,#241548,#110b24)] p-6 shadow-[0_8px_0_var(--color-ggd-outline)] sm:p-8">
        <div className="pointer-events-none absolute -right-5 -top-12 rotate-12 text-[10rem] opacity-10">🦆</div>
        <div className="relative z-[1] flex flex-wrap items-start justify-between gap-5">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--color-ggd-neon-green)]/40 bg-[var(--color-ggd-neon-green)]/10 px-3 py-1 text-xs font-black tracking-[0.2em] text-[var(--color-ggd-neon-green)]">
              <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--color-ggd-neon-green)]" /> SEASON {data.season.year}
            </div>
            <h1 className="mt-3 font-display text-5xl leading-none sm:text-6xl">
              ĐUA DZỊT <span className="text-[var(--color-ggd-gold)]">S3</span>
            </h1>
          </div>
          <div className="rounded-2xl border-2 border-white/15 bg-black/25 p-4 text-right">
            <div className="text-[10px] font-black tracking-widest text-white/45">CẨM NANG LUẬT</div>
            <Link
              href={`/season-3/rules${tokenQuery}`}
              className="mt-1 block font-display text-3xl text-[var(--color-ggd-gold)] transition hover:text-[var(--color-ggd-neon-green)]"
            >
              {data.season.weeks} TUẦN
            </Link>
            <div className="mt-1 text-xs text-white/55">
              1 Chaos / tuần ·{' '}
              <Link
                href={`/season-3/rules${tokenQuery}`}
                className="font-bold text-[var(--color-ggd-neon-green)] underline-offset-2 hover:underline"
              >
                xem chi tiết luật
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Chaos Card Section */}
      {week ? (
        <Season3ChaosCard
          type={week.chaosType}
          weekNumber={week.weekNumber}
          targetName={week.chaosTargetName}
          groups={groupNames}
          predictionCount={week.predictionCount}
          playerCount={data.players.length - week.skippedPlayerIds.length}
        />
      ) : (
        <section className="rounded-[2rem] border-4 border-[var(--color-ggd-gold)] bg-[var(--color-ggd-gold)]/10 p-6 text-center">
          <div className="text-5xl">🏆</div>
          <h2 className="mt-2 font-display text-4xl">Mùa Giải Kết Thúc</h2>
          <p className="mt-2 text-white/65">Đang chờ vinh danh Quán Quân Vô Địch Golden Duck.</p>
        </section>
      )}

      {/* Race Prep: Loadout Picker */}
      {data.viewer && week?.status === 'open' && !week.viewerSkipped && (
        <section className="rounded-[2rem] border-4 border-[var(--color-ggd-neon-green)]/70 bg-[var(--color-ggd-panel)] p-5 shadow-[0_6px_0_var(--color-ggd-outline)]">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-xs font-black tracking-[0.2em] text-[var(--color-ggd-neon-green)]">BƯỚC 1 · CHUẨN BỊ RA TRẬN</div>
              <h2 className="font-display text-3xl">🎒 Chọn Trang Bị (Loadout)</h2>
            </div>
            <div className="font-black text-[var(--color-ggd-gold)]">{selectedCost}/3 Điểm Trang Bị</div>
          </div>
          <p className="mt-3 text-sm text-white/60">
            ⚡ Tốc Độ · 🛡️ Phòng Thủ · 💥 Tấn Công — Hãy chọn đúng 1 Món Chính (2 Điểm) và 1 Món Phụ (1 Điểm).
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.raceItems.map((item) => {
              const selected = selectedItems.includes(item.id)
              const disabled =
                !selected &&
                (selectedItems.length >= 2 ||
                  selectedCost + item.cost > 3 ||
                  (item.category === 'major' && selectedMajor))
              return (
                <button
                  key={item.id}
                  disabled={disabled}
                  onClick={() => toggleItem(item.id)}
                  className={`rounded-2xl border-2 p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-30 ${
                    selected
                      ? 'border-[var(--color-ggd-neon-green)] bg-[var(--color-ggd-neon-green)]/15'
                      : 'border-white/10 bg-black/20 hover:border-white/35'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-3xl">{item.icon}</span>
                    <div>
                      <div className="font-black">{item.name}</div>
                      <div className="text-xs font-bold text-[var(--color-ggd-gold)]">
                        {item.cost} Điểm · {item.category === 'major' ? 'Món Chính' : 'Món Phụ'}
                      </div>
                    </div>
                    {selected && <span className="ml-auto font-bold text-[var(--color-ggd-neon-green)]">✓</span>}
                  </div>
                  <p className="mt-2 text-xs text-white/55">{item.description}</p>
                </button>
              )
            })}
          </div>
          {loadoutHint && (
            <div
              className={`mt-4 rounded-xl border-2 px-4 py-3 text-sm font-bold ${
                loadoutHint.tier === 'recommended'
                  ? 'border-[var(--color-ggd-neon-green)] bg-[var(--color-ggd-neon-green)]/10 text-[var(--color-ggd-neon-green)]'
                  : 'border-[var(--color-ggd-lavender)] bg-[var(--color-ggd-lavender)]/10 text-[var(--color-ggd-lavender)]'
              }`}
            >
              {loadoutHint.badge && (
                <div className="text-base">
                  {loadoutHint.badge}
                  {loadoutHint.label ? ` · ${loadoutHint.label}` : ''}
                </div>
              )}
              <div className="mt-1 font-normal text-white/80">{loadoutHint.message}</div>
            </div>
          )}
          <button
            disabled={selectedCost !== 3 || selectedItems.length !== 2}
            onClick={() => void saveLoadout()}
            className="mt-4 w-full rounded-xl bg-[var(--color-ggd-neon-green)] px-5 py-3 font-black text-[var(--color-ggd-outline)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-30"
          >
            {week.loadout.status === 'ready' ? '✓ CẬP NHẬT TRANG BỊ' : '🔒 XÁC NHẬN TRANG BỊ'}
          </button>
        </section>
      )}

      {/* Rest Week Banner */}
      {data.viewer && week?.viewerSkipped && (
        <section className="rounded-[2rem] border-4 border-white/20 bg-[var(--color-ggd-panel)] p-6 text-center">
          <div className="text-4xl">🛟</div>
          <h2 className="mt-2 font-display text-3xl">Tuần Này Được Nghỉ Ngơi</h2>
          <p className="mt-2 text-white/60">Bạn không tham gia đua tuần này nên không cần chọn đồ hay dự đoán.</p>
        </section>
      )}

      {/* User Status / Login Grid */}
      <div className="grid gap-6 lg:grid-cols-[1.1fr_.9fr]">
        {data.viewer ? (
          <section className="overflow-hidden rounded-[2rem] border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-surface-2)] shadow-[0_6px_0_var(--color-ggd-outline)]">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b-2 border-white/10 bg-black/15 p-5">
              <div className="flex items-center gap-3">
                <Season3Avatar name={data.viewer.name} avatarUrl={data.viewer.avatarUrl} size={64} />
                <div>
                  <div className="text-xs font-black tracking-widest text-white/45">TRẠNG THÁI AO DZỊT</div>
                  <h2 className="font-display text-3xl">
                    {data.viewer.isKing ? '👑 ' : ''}
                    {data.viewer.name}
                  </h2>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="rounded-xl bg-black/25 px-3 py-2 text-center">
                  <div className="font-display text-2xl text-[var(--color-ggd-gold)]">
                    {data.viewer.isKing ? `x${data.viewer.kingStreak}` : '—'}
                  </div>
                  <div className="text-[9px] font-black text-white/45">CHUỖI THỐNG TRỊ</div>
                </div>
              </div>
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-4">
              <StatTile
                icon="🔮"
                label="Tiên Tri"
                value={data.viewer.predictionPoints}
                tone="text-[var(--color-ggd-lavender)]"
                tooltip
              />
              <StatTile icon="🩹" label="Sẹo" value={data.viewer.scars} tone="text-[var(--color-ggd-orange)]" />
              <StatTile icon="🛡️" label="Khiên" value={data.viewer.shields} tone="text-[var(--color-ggd-sky)]" />
              <StatTile icon="🪙" label="Quack Points" value={data.viewer.quackPoints} tone="text-amber-300" />
            </div>

            {/* Shield Confirmation */}
            {week?.status === 'open' && !week.viewerSkipped && (
              <div className="border-t-2 border-white/10 bg-black/10 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-black text-white">🛡️ Dùng Khiên cứu mạng tuần này?</div>
                    <p className="text-xs text-white/55">
                      {data.viewer.shields > 0
                        ? 'Khiên sẽ tiêu hao sau race. Nếu bạn rơi vào nhóm thua của Chaos tuần này, Khiên sẽ cứu bạn khỏi nhận Sẹo!'
                        : 'Bạn hiện chưa có Khiên (tích lũy 2 Sẹo để tự động rèn thành 1 Khiên).'}
                    </p>
                  </div>
                  {week.shieldConfirmed ? (
                    <button
                      onClick={() => void confirmShield(false)}
                      className="rounded-xl border-2 border-[var(--color-ggd-sky)] bg-[var(--color-ggd-sky)]/10 px-4 py-2 text-xs font-black text-[var(--color-ggd-sky)] hover:bg-[var(--color-ggd-sky)]/20"
                    >
                      ✓ ĐÃ BẬT KHIÊN (HỦY?)
                    </button>
                  ) : (
                    <button
                      disabled={data.viewer.shields < 1}
                      onClick={() => void confirmShield(true)}
                      className="rounded-xl bg-[var(--color-ggd-sky)] px-4 py-2 text-xs font-black text-[var(--color-ggd-outline)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      BẬT KHIÊN CỨU MẠNG
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Secret Link Bar & Actions */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-white/10 bg-black/25 p-4 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={copyPersonalLink}
                  className={`rounded-lg border px-3 py-1.5 font-bold transition ${
                    copiedLink
                      ? 'border-[var(--color-ggd-neon-green)] bg-[var(--color-ggd-neon-green)] text-[var(--color-ggd-outline)]'
                      : 'border-[var(--color-ggd-gold)]/50 bg-[var(--color-ggd-gold)]/10 text-[var(--color-ggd-gold)] hover:bg-[var(--color-ggd-gold)] hover:text-[var(--color-ggd-outline)]'
                  }`}
                >
                  {copiedLink ? '✓ ĐÃ COPY LINK CÁ NHÂN!' : '🔗 SAO CHÉP SECRET LINK'}
                </button>
                <Link
                  href={`/season-3/duck/${data.viewer.userId}${tokenQuery}`}
                  className="rounded-lg border border-white/20 bg-white/5 px-3 py-1.5 font-bold text-white/80 transition hover:bg-white/15 hover:text-white"
                >
                  🦆 Trang cá nhân
                </Link>

                {/* Google Account Status Badge / Button */}
                {data.viewer.isGoogleLinked ? (
                  <span className="flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 font-bold text-emerald-400">
                    <span>✓ Google:</span>
                    <span className="max-w-[140px] truncate">{data.viewer.email || 'Đã liên kết'}</span>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowGoogleBindModal(true)}
                    className="flex items-center gap-1 rounded-lg border border-blue-400/40 bg-blue-500/15 px-2.5 py-1.5 font-bold text-blue-300 transition hover:bg-blue-500/25"
                  >
                    <span>🔗 Liên kết Google</span>
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={handleLogout}
                className="text-white/40 underline-offset-2 hover:text-rose-300 hover:underline"
              >
                Đăng xuất / Đổi token
              </button>
            </div>

            {/* Google Bind Modal */}
            {showGoogleBindModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
                <div className="w-full max-w-md rounded-[2rem] border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] p-6 shadow-2xl">
                  <div className="flex items-center justify-between border-b border-white/10 pb-3">
                    <h3 className="font-display text-2xl text-white">🔗 Liên Kết Google</h3>
                    <button
                      type="button"
                      onClick={() => setShowGoogleBindModal(false)}
                      className="rounded-lg border border-white/20 px-2.5 py-1 text-xs text-white/60 hover:bg-white/10"
                    >
                      ✕
                    </button>
                  </div>
                  <p className="mt-3 text-xs text-white/70">
                    Liên kết tài khoản Google với chú Dzịt <b>{data.viewer.name}</b> để đăng nhập 1-chạm cực nhanh!
                  </p>
                  <div className="mt-4">
                    <GoogleAuthButton
                      mode="bind"
                      token={token}
                      boundEmail={data.viewer.email}
                      onSuccess={(res) => {
                        setMessage(res.message || 'Đã liên kết tài khoản Google!')
                        setShowGoogleBindModal(false)
                        void refresh(true)
                      }}
                    />
                  </div>
                </div>
              </div>
            )}
          </section>
        ) : (
          <section className="rounded-[2rem] border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-surface-2)] p-6 shadow-[0_6px_0_var(--color-ggd-outline)]">
            <div className="flex items-center gap-3">
              <span className="text-4xl">🔐</span>
              <div>
                <h2 className="font-display text-3xl">Đăng Nhập Sảnh Đua</h2>
                <p className="text-xs text-white/60">Đăng nhập nhanh bằng Google hoặc dùng Secret Link cá nhân</p>
              </div>
            </div>

            <div className="mt-4 flex gap-2 border-b border-white/10 pb-2">
              <button
                type="button"
                onClick={() => setLoginTab('google')}
                className={`rounded-lg px-3 py-1 text-xs font-black transition ${
                  loginTab === 'google'
                    ? 'bg-[var(--color-ggd-gold)] text-[var(--color-ggd-outline)]'
                    : 'text-white/50 hover:text-white'
                }`}
              >
                🔴 Google Sign-In
              </button>
              <button
                type="button"
                onClick={() => setLoginTab('token')}
                className={`rounded-lg px-3 py-1 text-xs font-black transition ${
                  loginTab === 'token'
                    ? 'bg-[var(--color-ggd-gold)] text-[var(--color-ggd-outline)]'
                    : 'text-white/50 hover:text-white'
                }`}
              >
                🔑 Dán Token / Link
              </button>
              <button
                type="button"
                onClick={() => setLoginTab('request')}
                className={`rounded-lg px-3 py-1 text-xs font-black transition ${
                  loginTab === 'request'
                    ? 'bg-[var(--color-ggd-gold)] text-[var(--color-ggd-outline)]'
                    : 'text-white/50 hover:text-white'
                }`}
              >
                Chưa có link?
              </button>
            </div>

            {loginTab === 'google' ? (
              <div className="mt-4 space-y-3">
                <p className="text-xs text-white/70">
                  Dành cho những chú Dzịt đã liên kết tài khoản Google. Bấm nút dưới đây để vào sảnh ngay!
                </p>
                <GoogleAuthButton
                  mode="login"
                  onSuccess={(res) => {
                    if (res.token) {
                      localStorage.setItem('autoduck_season3_token', res.token)
                      setToken(res.token)
                      setMessage(res.message || 'Đăng nhập thành công!')
                      void loadSeasonData(res.token, true)
                    }
                  }}
                  onError={(err) => setMessage(err)}
                />
                <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-center text-xs text-white/50">
                  Chưa liên kết Google? Hãy chuyển sang tab <button type="button" onClick={() => setLoginTab('token')} className="font-bold text-[var(--color-ggd-gold)] underline">Dán Token / Link</button> để đăng nhập lần đầu rồi liên kết nhé!
                </div>
              </div>
            ) : loginTab === 'token' ? (
              <form onSubmit={handleLoginSubmit} className="mt-4 space-y-3">
                <input
                  type="text"
                  placeholder="Dán token hoặc full link (vd: https://duadzit.wtf/season-3?token=...)"
                  value={loginInput}
                  onChange={(e) => setLoginInput(e.target.value)}
                  className="w-full rounded-xl border-2 border-white/15 bg-black/25 px-4 py-3 text-sm font-bold text-white placeholder:text-white/35 focus:border-[var(--color-ggd-neon-green)] focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!loginInput.trim()}
                  className="w-full rounded-xl bg-[var(--color-ggd-neon-green)] px-5 py-3 font-black text-[var(--color-ggd-outline)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  VÀO AO DZỊT 🦆
                </button>
              </form>
            ) : (
              <div className="mt-4">
                {submittedGuestName ? (
                  <div className="rounded-2xl border-2 border-[var(--color-ggd-neon-green)]/50 bg-[var(--color-ggd-neon-green)]/10 p-4 font-bold text-white/85">
                    Mời dzịt <span className="text-[var(--color-ggd-neon-green)]">{submittedGuestName}</span> kiếm Admin
                    Thanh để nhận Secret Link nhé 🦆
                  </div>
                ) : (
                  <form
                    className="flex gap-2"
                    onSubmit={(event) => {
                      event.preventDefault()
                      const name = guestName.trim()
                      if (name) setSubmittedGuestName(name)
                    }}
                  >
                    <label htmlFor="guest-duck-name" className="sr-only">
                      Tên của bạn
                    </label>
                    <input
                      id="guest-duck-name"
                      value={guestName}
                      onChange={(event) => setGuestName(event.target.value)}
                      maxLength={80}
                      autoComplete="name"
                      placeholder="Nhập tên của bạn"
                      className="min-w-0 flex-1 rounded-xl border-2 border-white/15 bg-black/25 px-4 py-3 font-bold text-white placeholder:text-white/35 focus:border-[var(--color-ggd-neon-green)] focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={!guestName.trim()}
                      className="rounded-xl bg-[var(--color-ggd-neon-green)] px-5 py-3 font-black text-[var(--color-ggd-outline)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      GỬI
                    </button>
                  </form>
                )}
              </div>
            )}
          </section>
        )}

        {/* Prediction Card */}
        {data.viewer && week?.status === 'open' && !week.viewerSkipped ? (
          <section className="rounded-[2rem] border-4 border-[var(--color-ggd-gold)] bg-[linear-gradient(135deg,rgba(255,204,0,.18),rgba(36,21,72,.9))] p-5 shadow-[0_6px_0_var(--color-ggd-outline)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-black tracking-[0.2em] text-[var(--color-ggd-gold)]">
                  BƯỚC 2 · DỰ ĐOÁN BÍ MẬT
                </div>
                <h2 className="mt-1 font-display text-3xl">AI SẼ BỊ LÀM DZỊT?</h2>
              </div>
              <div className="text-4xl">🔮</div>
            </div>
            <p className="mt-2 text-sm text-white/70">
              Chọn 1 chú vịt bạn nghĩ sẽ về 2 vị trí cuối cùng trên đường đua (+1 🔮 nếu đoán trúng, nhận thêm 🪙 QP nếu người đó bị Chaos xử thua).
            </p>
            <div className="mt-4 grid max-h-48 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
              {eligiblePlayers.map((player) => (
                <button
                  key={player.id}
                  onClick={() => setSelectedTarget(player.id)}
                  className={`flex items-center gap-3 rounded-xl border-2 p-3 text-left font-black transition ${
                    selectedTarget === player.id
                      ? 'border-[var(--color-ggd-gold)] bg-[var(--color-ggd-gold)]/25 text-[var(--color-ggd-gold)] shadow-[0_0_20px_rgba(255,204,0,.18)]'
                      : 'border-white/10 bg-black/20 text-white/80 hover:border-white/35'
                  }`}
                >
                  <Season3Avatar name={player.name} avatarUrl={player.avatarUrl} size={32} />
                  <span className="truncate">{player.name}</span>
                  {selectedTarget === player.id && <span className="ml-auto font-bold">✓</span>}
                </button>
              ))}
            </div>
            <button
              onClick={() => void submitPrediction()}
              disabled={!selectedTarget}
              className="mt-4 w-full rounded-xl bg-[var(--color-ggd-gold)] px-5 py-3 font-black text-[var(--color-ggd-outline)] shadow-[0_4px_0_rgba(0,0,0,.4)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-35"
            >
              🔒 KHÓA DỰ ĐOÁN TIÊN TRI
            </button>
            {message && <p className="mt-3 text-center text-sm font-bold text-[var(--color-ggd-neon-green)]">{message}</p>}
          </section>
        ) : week?.status === 'racing' && week.raceId ? (
          <section className="rounded-[2rem] border-4 border-[var(--color-ggd-neon-green)] bg-[var(--color-ggd-neon-green)]/10 p-5 shadow-[0_6px_0_var(--color-ggd-outline)]">
            <div className="text-xs font-black tracking-[0.2em] text-[var(--color-ggd-neon-green)]">CUỘC ĐUA ĐANG DIỄN RA</div>
            <h2 className="mt-1 font-display text-3xl">🏁 Cuộc Đua Đang Tranh Tài!</h2>
            <p className="mt-2 text-sm text-white/70">Bảng xếp hạng sẽ tự động cập nhật ngay khi các chú vịt về đích.</p>
            <Link
              href={`/season-3/race/${week.raceId}`}
              className="mt-4 inline-block rounded-xl bg-[var(--color-ggd-neon-green)] px-5 py-3 font-black text-[var(--color-ggd-outline)] shadow-md transition hover:brightness-110"
            >
              VÀO XEM ĐUA LIVE
            </Link>
          </section>
        ) : (
          <section className="rounded-[2rem] border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-surface-2)] p-5">
            <div className="text-xs font-black tracking-[0.2em] text-white/45">BƯỚC 2 · DỰ ĐOÁN BÍ MẬT</div>
            <h2 className="mt-1 font-display text-3xl">
              {week?.viewerSkipped ? '🛟 TUẦN NGHỈ NGƠI' : week ? '🔒 ĐÃ ĐÓNG CHUẨN BỊ' : '🎬 TỔNG KẾT MÙA GIẢI'}
            </h2>
            <p className="mt-2 text-sm text-white/65">
              {week?.viewerSkipped
                ? 'Bạn không tham gia race tuần này.'
                : week
                  ? 'Đã khóa lựa chọn, đang chờ hiệu lệnh xuất phát!'
                  : 'Mỗi tuần một cú twist, mỗi tuần một bản tin Duck News.'}
            </p>
          </section>
        )}
      </div>

      {/* Live Standings Board */}
      <section
        id="standings"
        className="rounded-[2rem] border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-surface-2)] p-5 shadow-[0_6px_0_var(--color-ggd-outline)]"
      >
        <div className="flex items-end justify-between gap-3 border-b border-white/10 pb-4">
          <div>
            <div className="text-xs font-black tracking-[0.2em] text-white/45">BẢNG XẾP HẠNG MÙA GIẢI</div>
            <h2 className="font-display text-3xl">🏅 Bảng Điểm & Danh Hiệu Ao Dzịt</h2>
          </div>
          <span className="rounded-full bg-black/25 px-3 py-1 text-xs font-black text-white/55">
            {data.players.length} ĐẤU THỦ
          </span>
        </div>
        <div className="mt-4 space-y-2">
          {data.players.map((player, index) => {
            const isMe = data.viewer && player.id === data.viewer.userId
            return (
              <Link
                href={`/season-3/duck/${player.id}${tokenQuery}`}
                key={player.id}
                className={`flex items-center gap-3 rounded-2xl border-2 p-3 transition hover:scale-[1.01] ${
                  player.isKing
                    ? 'border-[var(--color-ggd-gold)]/60 bg-[var(--color-ggd-gold)]/10'
                    : isMe
                      ? 'border-[var(--color-ggd-neon-green)]/60 bg-[var(--color-ggd-neon-green)]/10'
                      : 'border-white/10 bg-black/15 hover:border-white/30'
                }`}
              >
                <span className="w-6 text-center font-display text-2xl text-white/40">{index + 1}</span>
                <Season3Avatar name={player.name} avatarUrl={player.avatarUrl} size={36} />
                <span className="min-w-0 flex-1 truncate font-black">
                  {player.name}
                  {isMe && (
                    <span className="ml-2 rounded bg-[var(--color-ggd-neon-green)] px-1.5 py-0.2 text-[9px] font-black text-[var(--color-ggd-outline)]">
                      BẠN
                    </span>
                  )}
                  {player.isKing && (
                    <span className="ml-2 rounded-full bg-[var(--color-ggd-gold)] px-2 py-0.5 text-[9px] font-black text-[var(--color-ggd-outline)]">
                      KING x{player.kingStreak}
                    </span>
                  )}
                </span>
                <span className="text-xs font-bold text-white/55">
                  🔮 {player.predictionPoints} · 🩹 {player.scars} · 🛡️ {player.shields}
                </span>
              </Link>
            )
          })}
        </div>
      </section>

      {/* Duck Closet */}
      <div id="closet">
        {data.viewer?.appearance && (
          <DuckCloset
            token={token}
            name={data.viewer.name}
            quackPoints={data.viewer.quackPoints}
            onboarded={data.viewer.cosmeticsOnboarded}
            catalog={data.cosmeticCatalog}
            ownedIds={data.viewer.inventory.map((item) => item.cosmeticId)}
            initialAppearance={data.viewer.appearance}
            onSaved={() => refresh(true)}
          />
        )}
      </div>

      {/* Quack Economy */}
      <div id="shop">
        {data.viewer?.appearance && (
          <QuackEconomy
            token={token}
            catalog={data.cosmeticCatalog}
            appearance={data.viewer.appearance}
            onChanged={() => refresh(true)}
          />
        )}
      </div>

      {/* Duckdex */}
      {data.viewer?.appearance && (
        <Duckdex
          token={token}
          catalog={data.cosmeticCatalog}
          inventory={data.viewer.inventory}
          favoriteId={data.viewer.appearance.favoriteId}
          onChanged={() => refresh(true)}
        />
      )}

      {/* Duck News History */}
      <section
        id="news"
        className="rounded-[2rem] border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] p-5 shadow-[0_6px_0_var(--color-ggd-outline)]"
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-xs font-black tracking-[0.2em] text-[var(--color-ggd-hot-pink)]">BẢNG TIN MÙA GIẢI</div>
            <h2 className="font-display text-3xl">📰 Nhật Ký Ao Dzịt (Duck News)</h2>
          </div>
          <span className="text-xs font-bold text-white/45">Lịch sử không bao giờ quên</span>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {data.history.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/15 p-5 text-sm text-white/50">
              Chưa có tuần đua nào hoàn thành.
            </div>
          ) : (
            data.history.map((item) => (
              <article key={item.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="rounded-full bg-[var(--color-ggd-orange)]/15 px-2 py-1 text-[10px] font-black text-[var(--color-ggd-orange)]">
                    TUẦN {item.weekNumber}
                  </span>
                  <span className="text-[10px] font-black tracking-widest text-white/35">
                    {chaosNames[item.chaosType] ?? item.chaosType}
                  </span>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-white/80">{item.recap}</p>
              </article>
            ))
          )}
        </div>
      </section>

      {/* Prediction Receipts */}
      {data.latestReveal && (
        <section className="rounded-[2rem] border-4 border-[var(--color-ggd-lavender)]/70 bg-[linear-gradient(135deg,rgba(167,139,250,.18),rgba(36,21,72,.8))] p-5 shadow-[0_6px_0_var(--color-ggd-outline)]">
          <div className="flex items-center gap-3">
            <span className="text-3xl">🔮</span>
            <div>
              <div className="text-xs font-black tracking-[0.2em] text-[var(--color-ggd-lavender)]">
                KẾT QUẢ TIÊN TRI
              </div>
              <h2 className="font-display text-3xl">Bảng Đối Chiếu Tiên Tri • Tuần {data.latestReveal.weekNumber}</h2>
            </div>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {data.latestReveal.predictions.length === 0 ? (
              <p className="text-sm text-white/55">Không có dự đoán nào.</p>
            ) : (
              data.latestReveal.predictions.map((prediction) => (
                <div
                  key={`${prediction.predictorName}-${prediction.targetName}`}
                  className="rounded-xl border border-white/10 bg-black/20 p-3 text-sm"
                >
                  <span className="font-black">{prediction.predictorName}</span>
                  <span className="mx-2 text-white/40">→</span>
                  <span>{prediction.targetName}</span>
                  <span
                    className={`ml-2 font-black ${
                      prediction.pointsAwarded > 0 ? 'text-[var(--color-ggd-neon-green)]' : 'text-white/35'
                    }`}
                  >
                    {prediction.pointsAwarded > 0 ? '✓ +1 🔮' : '✕'}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>
      )}
    </main>
  )
}
