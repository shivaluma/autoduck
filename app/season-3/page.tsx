'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Season3ChaosCard } from '@/components/season3-chaos-card'
import { Season3Avatar } from '@/components/season3-avatar'
import type { RaceItemId } from '@/packages/race-protocol/src'
import { DuckCloset } from '@/components/cosmetics/duck-closet'
import type { CosmeticDefinition, DuckAppearance } from '@/lib/cosmetics/types'
import { QuackEconomy } from '@/components/cosmetics/quack-economy'
import { Duckdex } from '@/components/cosmetics/duckdex'
import { evaluateLoadoutPairing } from '@/lib/racing/loadout-guide'
import { GoogleAuthButton } from '@/components/auth/google-auth-button'
import { RaceItemIcon } from '@/components/racing/race-item-icon'
import { CosmeticDuck } from '@/components/cosmetics/cosmetic-duck'
import { GameButton, GameLink, GamePanel, Progress, QuestRow, ResourcePill, UiIcon } from '@/components/game-ui'
import type { UiIconName } from '@/lib/race-fx/manifest'

/* eslint-disable @next/next/no-img-element -- decorative lily pad SVG */

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
  players: Array<{ id: number; name: string; avatarUrl?: string | null; appearance?: DuckAppearance | null; predictionPoints: number; scars: number; shields: number; isKing: boolean; kingStreak: number }>
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
    predictionTargetUserId?: number | null
    predictionTargetName?: string | null
    predictionTargetAvatarUrl?: string | null
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
  const [menuOpen, setMenuOpen] = useState(false)
  const [tab, setTab] = useState<LobbyTab>('race')

  function selectTab(next: LobbyTab) {
    setTab(next)
    setMenuOpen(false)
    if (typeof window !== 'undefined' && window.location.hash !== `#${next}`) window.history.pushState(null, '', `${window.location.pathname}${window.location.search}#${next}`)
  }

  async function loadSeasonData(authToken: string, syncLoadout = true) {
    setLoading(true)
    try {
      const response = await fetch(`/api/season3${authToken ? `?token=${encodeURIComponent(authToken)}` : ''}`, { cache: 'no-store' })
      const next = (await response.json()) as SeasonData
      setData(next)
      if (syncLoadout) {
        setSelectedItems(next.currentWeek?.loadout.itemIds ?? [])
      }
      if (next.currentWeek?.predictionTargetUserId) {
        setSelectedTarget(next.currentWeek.predictionTargetUserId)
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
      if (next.currentWeek?.predictionTargetUserId && !selectedTarget) {
        setSelectedTarget(next.currentWeek.predictionTargetUserId)
      }
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
      const fromHash = tabFromHash(window.location.hash)
      if (fromHash) setTab(fromHash)
    }
    void loadSeasonData(activeToken, true)
  }, [])

  useEffect(() => {
    // Keep the open tab in sync with the URL (links to #closet, browser back/forward).
    const onHashChange = () => {
      const next = tabFromHash(window.location.hash)
      if (next) setTab(next)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
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
      <main className="grid min-h-screen place-items-center p-6 text-white">
        <div className="flex flex-col items-center gap-4">
          <UiIcon name="duck" size={96} className="gx-float drop-shadow-[0_6px_0_var(--gx-ink)]" />
          <div className="gx-title text-3xl">Đang gọi bầy vịt…</div>
        </div>
      </main>
    )
  }

  if (!data?.season) {
    return (
      <main className="mx-auto grid min-h-screen max-w-xl place-items-center p-6 text-white">
        <GamePanel tone="dark" icon="duck" kicker="DUCK POND OFFLINE" title="Season 3 chưa mở">
          <p className="text-white/70">Host chưa bật season. Quay lại sau nhé.</p>
        </GamePanel>
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
  const viewer = data.viewer
  const playerById = new Map(data.players.map((player) => [player.id, player]))
  const raceWeekOpen = Boolean(viewer && week?.status === 'open' && !week.viewerSkipped)
  const loadoutDone = week?.loadout.status === 'ready' || week?.loadout.status === 'auto'
  const questsDone = [loadoutDone, Boolean(week?.predictionSubmitted)].filter(Boolean).length
  const tabs = LOBBY_TABS.filter((entry) => viewer || entry.public)
  const activeTab = tabs.some((entry) => entry.id === tab) ? tab : 'race'

  const heroAction = !viewer ? null
    : week?.status === 'racing' && week.raceId ? <GameLink href={`/season-3/race/${week.raceId}`} variant="mint" size="lg" icon="flag">XEM ĐUA LIVE</GameLink>
      : raceWeekOpen && questsDone < 2 ? <GameButton size="lg" icon="flag" onClick={() => selectTab('race')}>CHUẨN BỊ RA TRẬN · {questsDone}/2</GameButton>
        : raceWeekOpen ? <GameButton variant="mint" size="lg" onClick={() => selectTab('race')}>✓ ĐÃ SẴN SÀNG</GameButton>
          : week?.raceId ? <GameLink href={`/season-3/race/${week.raceId}`} variant="sky" size="lg" icon="flag">XEM LẠI CUỘC ĐUA</GameLink>
            : <GameButton variant="violet" size="lg" icon="closet" onClick={() => selectTab('closet')}>VÀO TỦ ĐỒ</GameButton>

  return (
    <main className="mx-auto max-w-6xl px-3 pb-32 pt-3 text-white sm:px-6 sm:pb-16">
      {/* HUD */}
      <header className="sticky top-2 z-30 flex items-center gap-3 rounded-[22px] border-[3px] border-[var(--gx-ink)] bg-[linear-gradient(180deg,rgba(43,31,92,.96),rgba(27,19,58,.96))] px-3 py-2 shadow-[0_6px_0_var(--gx-ink)] backdrop-blur sm:px-4">
        <Link href={`/season-3${tokenQuery}`} className="flex items-center gap-2">
          <UiIcon name="duck" size={38} className="gx-float drop-shadow-[0_3px_0_var(--gx-ink)]" />
          <span className="gx-title text-2xl leading-none sm:text-3xl">ĐUA DZỊT <span className="text-[var(--gx-gold)]">S3</span></span>
        </Link>
        {week && <span className="gx-chip hidden pl-2 sm:inline-flex">TUẦN {week.weekNumber}/{data.season.weeks}</span>}
        <div className="ml-auto flex items-center gap-2">
          {viewer && (
            <>
              <ResourcePill icon="coin" value={viewer.quackPoints} label="Quack Points" />
              <ResourcePill icon="crystal" value={viewer.predictionPoints} label="Điểm Tiên Tri" className="hidden sm:inline-flex" />
              <ResourcePill icon="shield" value={viewer.shields} label="Khiên" className="hidden md:inline-flex" />
              <ResourcePill icon="scar" value={viewer.scars} label="Sẹo" className="hidden md:inline-flex" />
            </>
          )}
          <Link href={`/season-3/rules${tokenQuery}`} className="hidden rounded-xl px-2 py-1 text-sm font-black text-white/70 hover:text-white lg:block">📖 Luật</Link>
          {viewer && (
            <div className="relative">
              <button type="button" onClick={() => setMenuOpen(!menuOpen)} aria-expanded={menuOpen} aria-label="Tài khoản" className="rounded-full transition hover:scale-105">
                <Season3Avatar name={viewer.name} avatarUrl={viewer.avatarUrl} appearance={viewer.appearance} size={44} ring={viewer.isKing ? 'var(--gx-gold)' : undefined} />
              </button>
              {menuOpen && (
                <div className="gx-panel gx-pop-in absolute right-0 top-14 z-40 w-64 p-2" data-tone="dark" onMouseLeave={() => setMenuOpen(false)}>
                  <div className="px-3 py-2"><div className="gx-kicker text-white/50">ĐANG CHƠI</div><div className="gx-title truncate text-2xl">{viewer.isKing ? '👑 ' : ''}{viewer.name}</div></div>
                  <Link href={`/season-3/duck/${viewer.userId}${tokenQuery}`} className="block rounded-xl px-3 py-2 font-black hover:bg-white/10">🦆 Trang cá nhân</Link>
                  <button type="button" onClick={copyPersonalLink} className="block w-full rounded-xl px-3 py-2 text-left font-black hover:bg-white/10">{copiedLink ? '✓ Đã copy Secret Link' : '🔗 Sao chép Secret Link'}</button>
                  {viewer.isGoogleLinked
                    ? <div className="truncate px-3 py-2 text-xs font-bold text-emerald-300">✓ Google: {viewer.email || 'Đã liên kết'}</div>
                    : <button type="button" onClick={() => { setShowGoogleBindModal(true); setMenuOpen(false) }} className="block w-full rounded-xl px-3 py-2 text-left font-black text-sky-300 hover:bg-white/10">🔗 Liên kết Google</button>}
                  <Link href={`/season-3/rules${tokenQuery}`} className="block rounded-xl px-3 py-2 font-black hover:bg-white/10 lg:hidden">📖 Luật chơi</Link>
                  <button type="button" onClick={handleLogout} className="block w-full rounded-xl px-3 py-2 text-left text-sm font-bold text-rose-300 hover:bg-white/10">Đăng xuất / Đổi token</button>
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      {message && (
        <div role="status" className="gx-pop-in fixed bottom-24 left-1/2 z-50 -translate-x-1/2 sm:bottom-8">
          <button type="button" onClick={() => setMessage('')} className="gx-chip px-4 py-2 text-base shadow-[0_5px_0_var(--gx-ink)]">🦆 {message}</button>
        </div>
      )}

      {/* HERO — this week */}
      <div className={`mt-6 gap-5 lg:grid-cols-[1.45fr_1fr] ${activeTab === 'race' ? 'grid' : 'hidden sm:grid'}`}>
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
          <GamePanel tone="gold" icon="trophy" kicker="MÙA GIẢI KẾT THÚC" title="Vinh danh Golden Duck">
            <p className="text-white/75">Đang chờ vinh danh Quán Quân Vô Địch Golden Duck.</p>
          </GamePanel>
        )}
        {viewer ? (
          <section className="gx-panel flex flex-col items-center overflow-hidden px-5 pb-6 pt-4 text-center" data-tone="dark">
            <div className="gx-kicker text-[#a5f3fc]">{viewer.isKing ? `👑 KING OF THE POND · x${viewer.kingStreak}` : 'DZỊT CỦA BẠN'}</div>
            <div className="relative mt-1">
              <img src="/race-fx/decor/lilypad.svg" alt="" aria-hidden className="absolute bottom-1 left-1/2 w-[78%] -translate-x-1/2 opacity-90" />
              <div className="relative"><CosmeticDuck appearance={viewer.appearance} size={210} label={`Dzịt của ${viewer.name}`} /></div>
            </div>
            <div className="gx-title -mt-2 text-3xl">{viewer.name}</div>
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              <ResourcePill icon="crystal" value={viewer.predictionPoints} label="Tiên Tri" />
              <ResourcePill icon="shield" value={viewer.shields} label="Khiên" />
              <ResourcePill icon="scar" value={viewer.scars} label="Sẹo" />
            </div>
            <div className="mt-4">{heroAction}</div>
          </section>
        ) : (
          <LoginPanel
            loginTab={loginTab} setLoginTab={setLoginTab} loginInput={loginInput} setLoginInput={setLoginInput}
            onSubmit={handleLoginSubmit} guestName={guestName} setGuestName={setGuestName}
            submittedGuestName={submittedGuestName} setSubmittedGuestName={setSubmittedGuestName}
            onGoogle={(nextToken, nextMessage) => { localStorage.setItem('autoduck_season3_token', nextToken); setToken(nextToken); setMessage(nextMessage); void loadSeasonData(nextToken, true) }}
            onError={setMessage}
          />
        )}
      </div>

      {/* TABS (desktop) */}
      <nav aria-label="Sảnh đua" role="tablist" className="sticky top-[84px] z-20 mt-6 hidden flex-wrap gap-1 rounded-[20px] border-[3px] border-[var(--gx-ink)] bg-[rgba(20,14,44,.92)] p-1.5 shadow-[0_5px_0_var(--gx-ink)] backdrop-blur sm:flex">
        {tabs.map((entry) => (
          <button key={entry.id} type="button" role="tab" aria-selected={activeTab === entry.id} onClick={() => selectTab(entry.id)} className="gx-tab">
            <UiIcon name={entry.icon} size={26} />{entry.label}
            {entry.id === 'race' && raceWeekOpen && questsDone < 2 && <span className="grid h-5 min-w-5 place-items-center rounded-full border-2 border-[var(--gx-ink)] bg-[var(--gx-rose)] px-1 text-[11px] font-black text-white">{2 - questsDone}</span>}
          </button>
        ))}
      </nav>

      {/* TAB CONTENT */}
      <div key={activeTab} className="gx-pop-in mt-5 space-y-6">
        {activeTab === 'race' && (
          <>
            {viewer && week && !week.viewerSkipped && (
              <GamePanel tone="violet" icon="flag" kicker={`NHIỆM VỤ TUẦN ${week.weekNumber}`} title="Chuẩn bị ra trận"
                actions={<span className="gx-chip pl-2">{questsDone}/2 hoàn thành</span>}>
                <Progress value={questsDone} max={2} />
                <div className="mt-4 grid gap-2 md:grid-cols-3">
                  <QuestRow done={loadoutDone} label="Chọn trang bị" detail={loadoutDone ? `${week.loadout.itemIds.map((id) => data.raceItems.find((item) => item.id === id)?.name).filter(Boolean).join(' + ') || 'Tự động'}` : '1 Món Chính + 1 Món Phụ'} />
                  <QuestRow done={week.predictionSubmitted} label="Dự đoán ai bị làm dzịt" detail={week.predictionTargetName ? `Đã chọn ${week.predictionTargetName}` : '+1 Tiên Tri nếu trúng'} />
                  <QuestRow done={week.shieldConfirmed} label="Bật Khiên (tuỳ chọn)" detail={viewer.shields > 0 ? `${viewer.shields} Khiên sẵn sàng` : 'Chưa có Khiên'} />
                </div>
                {week.status === 'racing' && week.raceId && (
                  <div className="mt-4 flex justify-center"><GameLink href={`/season-3/race/${week.raceId}`} variant="mint" size="lg" icon="flag">VÀO XEM ĐUA LIVE</GameLink></div>
                )}
              </GamePanel>
            )}

            {viewer && week?.viewerSkipped && (
              <GamePanel tone="sky" icon="duck" kicker="TUẦN NGHỈ" title="Tuần này được nghỉ ngơi">
                <p className="text-white/75">Bạn không tham gia đua tuần này nên không cần chọn đồ hay dự đoán. Thả lỏng trong ao nhé 🛟</p>
              </GamePanel>
            )}

            {raceWeekOpen && week && (
              <GamePanel tone="mint" icon="bag" kicker="BƯỚC 1 · TRANG BỊ" title="Chọn Loadout"
                actions={<div className="flex items-center gap-1" aria-label={`${selectedCost}/3 điểm`}>{[0, 1, 2].map((slot) => <span key={slot} className={`h-5 w-7 rounded-md border-2 border-[var(--gx-ink)] ${slot < selectedCost ? 'bg-[var(--gx-gold)] shadow-[inset_0_2px_0_#fff6c9]' : 'bg-black/30'}`} />)}<span className="ml-2 font-data text-sm">{selectedCost}/3</span></div>}>
                <p className="text-sm text-white/70">Chọn đúng <b className="text-[var(--gx-gold)]">1 Món Chính</b> (2 điểm) và <b className="text-[var(--gx-gold)]">1 Món Phụ</b> (1 điểm).</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {data.raceItems.map((item) => {
                    const selected = selectedItems.includes(item.id)
                    const disabled = !selected && (selectedItems.length >= 2 || selectedCost + item.cost > 3 || (item.category === 'major' && selectedMajor))
                    return (
                      <button key={item.id} type="button" disabled={disabled} onClick={() => toggleItem(item.id)} aria-pressed={selected}
                        className={`gx-well group relative p-4 text-left transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:translate-y-0 ${selected ? 'border-[var(--gx-mint)] bg-[#14532d]/45 shadow-[0_0_0_3px_var(--gx-ink),0_0_22px_rgba(74,222,128,.35)]' : 'hover:border-white/25'}`}>
                        {selected && <span className="absolute -right-2 -top-2 grid h-8 w-8 place-items-center rounded-full border-[3px] border-[var(--gx-ink)] bg-[var(--gx-mint)] font-black text-[var(--gx-ink)] shadow-[0_3px_0_var(--gx-ink)]">✓</span>}
                        <div className="flex items-center gap-3">
                          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border-[3px] border-[var(--gx-ink)] bg-[radial-gradient(circle_at_40%_30%,#3b2c78,#1d1540)] shadow-[0_3px_0_var(--gx-ink)] transition group-hover:rotate-[-6deg]">
                            <RaceItemIcon id={item.id} fallback={item.icon} size={42} />
                          </span>
                          <div className="min-w-0">
                            <div className="gx-title text-xl">{item.name}</div>
                            <div className="mt-1 flex items-center gap-1.5">
                              {Array.from({ length: item.cost }, (_, index) => <UiIcon key={index} name="coin" size={16} />)}
                              <span className={`rounded-md px-1.5 text-[10px] font-black ${item.category === 'major' ? 'bg-violet-500/30 text-violet-200' : 'bg-sky-500/25 text-sky-200'}`}>{item.category === 'major' ? 'MÓN CHÍNH' : 'MÓN PHỤ'}</span>
                            </div>
                          </div>
                        </div>
                        <p className="mt-3 text-xs leading-relaxed text-white/65">{item.description}</p>
                      </button>
                    )
                  })}
                </div>
                {loadoutHint && (
                  <div className={`gx-well mt-4 px-4 py-3 text-sm font-bold ${loadoutHint.tier === 'recommended' ? 'border-[var(--gx-mint)]/60 text-[#bbf7d0]' : 'border-[var(--gx-violet)]/60 text-[#ddd6fe]'}`}>
                    {loadoutHint.badge && <div className="text-base">{loadoutHint.badge}{loadoutHint.label ? ` · ${loadoutHint.label}` : ''}</div>}
                    <div className="mt-1 font-normal text-white/80">{loadoutHint.message}</div>
                  </div>
                )}
                <GameButton variant="mint" size="lg" className="mt-5 w-full" disabled={selectedCost !== 3 || selectedItems.length !== 2} onClick={() => void saveLoadout()}>
                  {week.loadout.status === 'ready' ? '✓ CẬP NHẬT TRANG BỊ' : 'XÁC NHẬN TRANG BỊ'}
                </GameButton>
              </GamePanel>
            )}

            {raceWeekOpen && week && (
              <GamePanel tone="gold" icon="crystal" kicker="BƯỚC 2 · DỰ ĐOÁN BÍ MẬT" title="Ai sẽ bị làm dzịt?">
                <p className="text-sm text-white/75">Chọn 1 chú vịt bạn nghĩ sẽ về 2 vị trí cuối. Trúng: <b className="text-[var(--gx-gold)]">+1 Tiên Tri</b>, thêm QP nếu người đó bị Chaos xử thua.</p>
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {eligiblePlayers.map((player) => {
                    const chosen = selectedTarget === player.id
                    return (
                      <button key={player.id} type="button" onClick={() => setSelectedTarget(player.id)} aria-pressed={chosen}
                        className={`gx-well relative flex flex-col items-center gap-2 p-3 transition hover:-translate-y-0.5 ${chosen ? 'border-[var(--gx-gold)] bg-[#713f12]/40 shadow-[0_0_0_3px_var(--gx-ink),0_0_24px_rgba(255,216,77,.35)]' : 'hover:border-white/25'}`}>
                        {chosen && <span className="absolute -right-2 -top-2 rounded-full border-[3px] border-[var(--gx-ink)] bg-[var(--gx-gold)] px-2 text-xs font-black text-[var(--gx-ink)] shadow-[0_3px_0_var(--gx-ink)]">🎯</span>}
                        <Season3Avatar name={player.name} avatarUrl={player.avatarUrl} appearance={player.appearance} size={64} ring={chosen ? 'var(--gx-gold)' : undefined} />
                        <span className="w-full truncate text-center font-black">{player.name}</span>
                      </button>
                    )
                  })}
                </div>
                <GameButton size="lg" className="mt-5 w-full" disabled={!selectedTarget} onClick={() => void submitPrediction()} icon="crystal">
                  {week.predictionSubmitted ? 'CẬP NHẬT DỰ ĐOÁN' : 'KHÓA DỰ ĐOÁN'}
                </GameButton>
              </GamePanel>
            )}

            {raceWeekOpen && week && viewer && (
              <GamePanel tone="sky" icon="shield" kicker="TUỲ CHỌN" title="Khiên cứu mạng"
                actions={week.shieldConfirmed
                  ? <GameButton variant="ghost" size="sm" onClick={() => void confirmShield(false)}>✓ ĐÃ BẬT · HUỶ</GameButton>
                  : <GameButton variant="sky" size="sm" icon="shield" disabled={viewer.shields < 1} onClick={() => void confirmShield(true)}>BẬT KHIÊN</GameButton>}>
                <p className="text-sm text-white/75">{viewer.shields > 0
                  ? 'Nếu bạn rơi vào nhóm thua của Chaos tuần này, Khiên sẽ cứu bạn khỏi nhận Sẹo. Khiên tiêu hao sau race.'
                  : 'Bạn chưa có Khiên — tích lũy 2 Sẹo để tự động rèn thành 1 Khiên.'}</p>
              </GamePanel>
            )}

            {viewer && week && !week.viewerSkipped && (week.status === 'locked' || week.status === 'racing') && (
              <GamePanel tone="gold" icon="crystal" kicker={week.status === 'racing' ? 'CUỘC ĐUA ĐANG DIỄN RA' : 'ĐÃ KHÓA CHUẨN BỊ'} title="Dự đoán tiên tri">
                {week.predictionSubmitted && week.predictionTargetName ? (
                  <div className="flex items-center gap-4">
                    <Season3Avatar name={week.predictionTargetName} avatarUrl={week.predictionTargetAvatarUrl} appearance={week.predictionTargetUserId ? playerById.get(week.predictionTargetUserId)?.appearance : null} size={72} ring="var(--gx-gold)" />
                    <div><div className="text-xs text-white/60">Bạn đoán sẽ bị làm dzịt:</div><div className="gx-title text-3xl text-[var(--gx-gold)]">{week.predictionTargetName}</div></div>
                  </div>
                ) : <p className="text-white/70">Bạn chưa kịp gửi dự đoán tuần này trước khi khóa.</p>}
              </GamePanel>
            )}

            {!week && (
              <GamePanel tone="dark" icon="news" kicker="TỔNG KẾT" title="Mùa giải đã khép lại">
                <p className="text-white/70">Mỗi tuần một cú twist, mỗi tuần một bản tin Duck News.</p>
              </GamePanel>
            )}
          </>
        )}

        {activeTab === 'rank' && (
          <>
            <GamePanel tone="gold" icon="trophy" kicker="BẢNG XẾP HẠNG MÙA GIẢI" title="Danh hiệu Ao Dzịt" actions={<span className="gx-chip pl-2">{data.players.length} đấu thủ</span>}>
              <div className="grid grid-cols-3 items-end gap-2 sm:gap-4">
                {[1, 0, 2].map((place) => {
                  const player = data.players[place]
                  if (!player) return <div key={place} />
                  const heights = ['h-28', 'h-20', 'h-14']
                  const medal = ['bg-[linear-gradient(180deg,#fff3a6,#f2b627)]', 'bg-[linear-gradient(180deg,#f1f5f9,#94a3b8)]', 'bg-[linear-gradient(180deg,#fed7aa,#ea580c)]'][place]
                  return (
                    <Link key={player.id} href={`/season-3/duck/${player.id}${tokenQuery}`} className="group flex flex-col items-center">
                      <div className="transition group-hover:-translate-y-1"><Season3Avatar name={player.name} avatarUrl={player.avatarUrl} appearance={player.appearance} size={place === 0 ? 96 : 76} ring={place === 0 ? 'var(--gx-gold)' : undefined} /></div>
                      <div className="mt-1 w-full truncate text-center font-black">{player.isKing ? '👑 ' : ''}{player.name}</div>
                      <div className={`mt-2 grid w-full place-items-center rounded-t-2xl border-[3px] border-b-0 border-[var(--gx-ink)] ${medal} ${heights[place]} shadow-[inset_0_3px_0_rgba(255,255,255,.5)]`}>
                        <span className="gx-title text-4xl text-[var(--gx-ink)] [text-shadow:none]">{place + 1}</span>
                      </div>
                    </Link>
                  )
                })}
              </div>
              <div className="mt-0 space-y-2 border-t-[3px] border-[var(--gx-ink)] pt-4">
                {data.players.map((player, index) => {
                  const isMe = viewer && player.id === viewer.userId
                  return (
                    <Link key={player.id} href={`/season-3/duck/${player.id}${tokenQuery}`}
                      className={`gx-well flex items-center gap-3 p-2.5 transition hover:-translate-y-0.5 ${isMe ? 'border-[var(--gx-mint)]/70' : player.isKing ? 'border-[var(--gx-gold)]/70' : ''}`}>
                      <span className="gx-title w-8 text-center text-2xl text-white/50">{index + 1}</span>
                      <Season3Avatar name={player.name} avatarUrl={player.avatarUrl} appearance={player.appearance} size={44} />
                      <span className="min-w-0 flex-1 truncate font-black">
                        {player.name}
                        {isMe && <span className="ml-2 rounded-md border-2 border-[var(--gx-ink)] bg-[var(--gx-mint)] px-1.5 text-[10px] font-black text-[var(--gx-ink)]">BẠN</span>}
                        {player.isKing && <span className="ml-2 rounded-md border-2 border-[var(--gx-ink)] bg-[var(--gx-gold)] px-1.5 text-[10px] font-black text-[var(--gx-ink)]">KING x{player.kingStreak}</span>}
                      </span>
                      <span className="flex items-center gap-2 text-sm font-black">
                        <span className="flex items-center gap-1"><UiIcon name="crystal" size={20} />{player.predictionPoints}</span>
                        <span className="hidden items-center gap-1 sm:flex"><UiIcon name="scar" size={20} />{player.scars}</span>
                        <span className="hidden items-center gap-1 sm:flex"><UiIcon name="shield" size={20} />{player.shields}</span>
                      </span>
                    </Link>
                  )
                })}
              </div>
            </GamePanel>
            {data.latestReveal && (
              <GamePanel tone="violet" icon="crystal" kicker="KẾT QUẢ TIÊN TRI" title={`Đối chiếu tuần ${data.latestReveal.weekNumber}`}>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {data.latestReveal.predictions.length === 0 ? <p className="text-sm text-white/60">Không có dự đoán nào.</p> : data.latestReveal.predictions.map((prediction) => (
                    <div key={`${prediction.predictorName}-${prediction.targetName}`} className={`gx-well flex items-center gap-2 p-3 text-sm ${prediction.pointsAwarded > 0 ? 'border-[var(--gx-mint)]/60' : ''}`}>
                      <span className="font-black">{prediction.predictorName}</span><span className="text-white/40">→</span><span className="truncate">{prediction.targetName}</span>
                      <span className={`ml-auto font-black ${prediction.pointsAwarded > 0 ? 'text-[#86efac]' : 'text-white/35'}`}>{prediction.pointsAwarded > 0 ? '+1 🔮' : '✕'}</span>
                    </div>
                  ))}
                </div>
              </GamePanel>
            )}
          </>
        )}

        {activeTab === 'closet' && viewer?.appearance && (
          <DuckCloset token={token} name={viewer.name} quackPoints={viewer.quackPoints} onboarded={viewer.cosmeticsOnboarded}
            catalog={data.cosmeticCatalog} ownedIds={viewer.inventory.map((item) => item.cosmeticId)} initialAppearance={viewer.appearance} onSaved={() => refresh(true)} />
        )}

        {activeTab === 'shop' && viewer?.appearance && (
          <QuackEconomy token={token} catalog={data.cosmeticCatalog} appearance={viewer.appearance} onChanged={() => refresh(true)} />
        )}

        {activeTab === 'dex' && viewer?.appearance && (
          <Duckdex token={token} catalog={data.cosmeticCatalog} inventory={viewer.inventory} favoriteId={viewer.appearance.favoriteId} onChanged={() => refresh(true)} />
        )}

        {activeTab === 'news' && (
          <GamePanel tone="rose" icon="news" kicker="BẢNG TIN MÙA GIẢI" title="Duck News" actions={<span className="text-xs font-bold text-white/55">Lịch sử không bao giờ quên</span>}>
            <div className="grid gap-4 lg:grid-cols-2">
              {data.history.length === 0 ? (
                <div className="gx-well p-6 text-center text-white/60">📰 Chưa có tuần đua nào hoàn thành.</div>
              ) : data.history.map((item, index) => (
                <article key={item.id} className="relative rounded-2xl border-[3px] border-[var(--gx-ink)] bg-[#f8f1e1] p-4 text-[#2a1d12] shadow-[0_5px_0_var(--gx-ink)]" style={{ transform: `rotate(${index % 2 ? 0.6 : -0.6}deg)` }}>
                  <div className="flex items-center justify-between gap-3 border-b-2 border-dashed border-[#2a1d12]/30 pb-2">
                    <span className="gx-title text-2xl text-[#2a1d12] [text-shadow:none]">TUẦN {item.weekNumber}</span>
                    <span className="rounded-md border-2 border-[#2a1d12] px-2 text-[10px] font-black tracking-widest">{chaosNames[item.chaosType] ?? item.chaosType}</span>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap font-[family-name:var(--font-readable)] text-sm leading-relaxed">{item.recap}</p>
                </article>
              ))}
            </div>
          </GamePanel>
        )}
      </div>

      {/* MOBILE DOCK */}
      <nav aria-label="Sảnh đua" role="tablist" className="fixed inset-x-2 bottom-2 z-40 grid rounded-[22px] border-[3px] border-[var(--gx-ink)] bg-[linear-gradient(180deg,#2f2463,#1b1440)] px-1 pb-[max(4px,env(safe-area-inset-bottom))] shadow-[0_-2px_0_rgba(255,255,255,.08),0_6px_0_var(--gx-ink)] sm:hidden" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
        {tabs.map((entry) => (
          <button key={entry.id} type="button" role="tab" aria-selected={activeTab === entry.id} onClick={() => selectTab(entry.id)} className="gx-dock-item">
            <span className="gx-dock-icon relative"><UiIcon name={entry.icon} size={30} />
              {entry.id === 'race' && raceWeekOpen && questsDone < 2 && <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-[var(--gx-ink)] bg-[var(--gx-rose)]" />}
            </span>
            {entry.short}
          </button>
        ))}
      </nav>

      {showGoogleBindModal && viewer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <GamePanel tone="dark" icon="lock" title="Liên kết Google" className="gx-pop-in w-full max-w-md"
            actions={<GameButton variant="ghost" size="sm" onClick={() => setShowGoogleBindModal(false)}>✕</GameButton>}>
            <p className="text-sm text-white/75">Liên kết Google với <b>{viewer.name}</b> để đăng nhập 1-chạm!</p>
            <div className="mt-4">
              <GoogleAuthButton mode="bind" token={token} boundEmail={viewer.email}
                onSuccess={(res) => { setMessage(res.message || 'Đã liên kết tài khoản Google!'); setShowGoogleBindModal(false); void refresh(true) }} />
            </div>
          </GamePanel>
        </div>
      )}
    </main>
  )
}

const LOBBY_TABS = [
  { id: 'race', label: 'Đường Đua', short: 'Đua', icon: 'flag', public: false },
  { id: 'closet', label: 'Tủ Đồ', short: 'Tủ đồ', icon: 'closet', public: false },
  { id: 'shop', label: 'Cửa Hàng', short: 'Shop', icon: 'bag', public: false },
  { id: 'rank', label: 'Xếp Hạng', short: 'Hạng', icon: 'trophy', public: true },
  { id: 'dex', label: 'Duckdex', short: 'Dex', icon: 'book', public: false },
  { id: 'news', label: 'Duck News', short: 'Tin', icon: 'news', public: true },
] as const satisfies ReadonlyArray<{ id: string; label: string; short: string; icon: UiIconName; public: boolean }>

type LobbyTab = typeof LOBBY_TABS[number]['id']
const LEGACY_HASHES: Record<string, LobbyTab> = { standings: 'rank', closet: 'closet', shop: 'shop', news: 'news' }

function tabFromHash(hash: string): LobbyTab | undefined {
  const key = hash.replace('#', '')
  return LOBBY_TABS.find((entry) => entry.id === key)?.id ?? LEGACY_HASHES[key]
}

function LoginPanel(props: {
  loginTab: 'google' | 'token' | 'request'
  setLoginTab: (tab: 'google' | 'token' | 'request') => void
  loginInput: string
  setLoginInput: (value: string) => void
  onSubmit: (event: React.FormEvent) => void
  guestName: string
  setGuestName: (value: string) => void
  submittedGuestName: string
  setSubmittedGuestName: (value: string) => void
  onGoogle: (token: string, message: string) => void
  onError: (message: string) => void
}) {
  const { loginTab, setLoginTab } = props
  const tabs = [['google', 'Google'], ['token', 'Secret Link'], ['request', 'Chưa có link?']] as const
  return (
    <GamePanel tone="dark" icon="lock" kicker="SẢNH ĐUA" title="Vào ao chơi nào!">
      <div role="tablist" className="flex flex-wrap gap-1 rounded-2xl border-2 border-black/30 bg-black/25 p-1">
        {tabs.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={loginTab === id} onClick={() => setLoginTab(id)} className="gx-tab text-base">{label}</button>)}
      </div>
      {loginTab === 'google' ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-white/70">Dành cho các chú Dzịt đã liên kết Google — 1 chạm là vào sảnh.</p>
          <GoogleAuthButton mode="login" onSuccess={(res) => { if (res.token) props.onGoogle(res.token, res.message || 'Đăng nhập thành công!') }} onError={props.onError} />
        </div>
      ) : loginTab === 'token' ? (
        <form onSubmit={props.onSubmit} className="mt-4 space-y-3">
          <input type="text" placeholder="Dán token hoặc full link…" value={props.loginInput} onChange={(e) => props.setLoginInput(e.target.value)}
            className="gx-well w-full px-4 py-3 text-sm font-bold text-white placeholder:text-white/35 focus:border-[var(--gx-mint)] focus:outline-none" />
          <GameButton type="submit" variant="mint" size="lg" className="w-full" disabled={!props.loginInput.trim()} icon="duck">VÀO AO DZỊT</GameButton>
        </form>
      ) : props.submittedGuestName ? (
        <div className="gx-well mt-4 p-4 font-bold">Mời dzịt <span className="text-[#86efac]">{props.submittedGuestName}</span> kiếm Admin Thanh để nhận Secret Link nhé 🦆</div>
      ) : (
        <form className="mt-4 flex gap-2" onSubmit={(event) => { event.preventDefault(); const name = props.guestName.trim(); if (name) props.setSubmittedGuestName(name) }}>
          <label htmlFor="guest-duck-name" className="sr-only">Tên của bạn</label>
          <input id="guest-duck-name" value={props.guestName} onChange={(event) => props.setGuestName(event.target.value)} maxLength={80} autoComplete="name" placeholder="Nhập tên của bạn"
            className="gx-well min-w-0 flex-1 px-4 py-3 font-bold text-white placeholder:text-white/35 focus:border-[var(--gx-mint)] focus:outline-none" />
          <GameButton type="submit" variant="mint" disabled={!props.guestName.trim()}>GỬI</GameButton>
        </form>
      )}
    </GamePanel>
  )
}
