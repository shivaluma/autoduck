'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Season3ChaosCard } from '@/components/season3-chaos-card'
import { Season3Avatar } from '@/components/season3-avatar'
import { Season3PointTooltip } from '@/components/season3-point-tooltip'
import { canStartSeason3TestRace } from '@/lib/season3-test-mode'

const CHAOS_OPTIONS = [
  {
    type: 'NORMAL',
    name: 'NORMAL',
    icon: '🏁',
    desc: '2 vịt về chậm nhất (Bottom 2) bị làm dzịt.',
  },
  {
    type: 'REVERSE',
    name: 'REVERSE',
    icon: '🔄',
    desc: 'Đảo ngược: 2 vịt về ĐẦU TIÊN (Top 2) bị làm dzịt.',
  },
  {
    type: 'DUO',
    name: 'DUO',
    icon: '🤝',
    desc: 'Cặp đôi/Nhóm có thứ hạng trung bình tệ nhất cùng bị làm dzịt.',
  },
  {
    type: 'TRIPLE_ELIMINATION',
    name: 'TRIPLE ELIMINATION',
    icon: '💀',
    desc: '3 vịt về chậm nhất (Bottom 3) bị làm dzịt.',
  },
  {
    type: 'CUT_LINE',
    name: 'CUT LINE',
    icon: '🚧',
    desc: 'Top 50% an toàn. Toàn bộ nửa sau đoàn đua cùng bị làm dzịt.',
  },
  {
    type: 'CONSTRUCTORS',
    name: 'CONSTRUCTORS',
    icon: '🏎️',
    desc: 'Chia 2 đội: Đội có thứ hạng trung bình tệ hơn cùng bị làm dzịt.',
  },
  {
    type: 'BOUNTY_HUNT',
    name: 'BOUNTY HUNT',
    icon: '🎯',
    desc: 'Truy nã 1 Vịt: Vịt đó không vào Top 50% thì Vịt đó và tất cả vịt xếp sau cùng bị làm dzịt.',
  },
] as const

type AdminState = {
  season: { id: number; name: string; year: number; weeks: number; status: string } | null
  players: Array<{ id: number; name: string; avatarUrl?: string | null; personalLink: string; scars: number; shields: number; predictionPoints: number; isKing: boolean; kingStreak: number }>
  weeks: Array<{
    id: number
    weekNumber: number
    status: string
    chaosType: string
    chaosTargetUserId: number | null
    chaosTargetUserId2: number | null
    chaosGroups?: number[][]
    skippedPlayerIds: number[]
    predictionCount: number
    loadoutReadyCount: number
    loadoutReadyUserIds?: number[]
    predictionUserIds?: number[]
    missingLoadoutUserIds?: number[]
    missingPredictionUserIds?: number[]
    missingLoadoutNames?: string[]
    missingPredictionNames?: string[]
    fullyReadyUserIds?: number[]
    shieldConfirmations: string[]
    recap: string | null
    raceId: number | null
    raceStatus: string | null
  }>
  balance?: {
    items: Array<{ name: string; picks: number; winRate: number; bottom2Rate: number; averageFinish: number; averageRankDelta: number; activationRate: number; successRate: number }>
    loadouts: Array<{ name: string; picks: number; winRate: number; bottom2Rate: number; averageFinish: number; averageRankDelta: number; activationRate: number; successRate: number }>
    pickups: Array<{ name: string; picks: number; activationRate: number; hitRate: number; manualRate: number; autoRate: number; averageRankDelta: number }>
  }
}

async function callAdmin(secret: string, body?: Record<string, unknown>) {
  const response = await fetch('/api/admin/season3', {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'x-race-secret': secret },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { response, data: await response.json() as AdminState & { error?: string; raceId?: number } }
}

export default function AdminSeason3Page() {
  const [secret, setSecret] = useState('')
  const [data, setData] = useState<AdminState | null>(null)
  const [message, setMessage] = useState('')
  const [testRaceId, setTestRaceId] = useState<number | null>(null)

  const [customChaosType, setCustomChaosType] = useState<string | null>(null)
  const [customTargetUserId, setCustomTargetUserId] = useState<number | '' | null>(null)
  const [showChaosPicker, setShowChaosPicker] = useState(false)

  const [openWeekMode, setOpenWeekMode] = useState<'random' | 'manual'>('random')
  const [openWeekChaosType, setOpenWeekChaosType] = useState<string>('NORMAL')
  const [openWeekTargetUserId, setOpenWeekTargetUserId] = useState<number | ''>('')

  const currentWeek = useMemo(() => (data?.weeks ?? []).find((week) => week.status !== 'resolved') ?? null, [data])
  const nameById = useMemo(() => new Map((data?.players ?? []).map((player) => [player.id, player.name])), [data])
  const activePlayers = useMemo(() => (data?.players ?? []).filter((p) => !currentWeek?.skippedPlayerIds.includes(p.id)), [data?.players, currentWeek?.skippedPlayerIds])
  const activePlayerCount = (data?.players?.length ?? 0) - (currentWeek?.skippedPlayerIds.length ?? 0)

  const selectedChaosType = customChaosType ?? currentWeek?.chaosType ?? 'NORMAL'
  const selectedTargetUserId = customTargetUserId !== null ? customTargetUserId : (currentWeek?.chaosTargetUserId ?? '')

  async function refresh() {
    if (!secret) return
    const result = await callAdmin(secret)
    if (!result.response.ok) {
      setMessage(result.data.error ?? 'Không tải được admin data')
      return
    }
    setData(result.data)
  }

  useEffect(() => {
    const saved = window.localStorage.getItem('autoduck-season3-secret') ?? ''
    if (saved) {
      void callAdmin(saved).then((result) => {
        setSecret(saved)
        if (result.response.ok) setData(result.data)
      })
    }
  }, [])

  useEffect(() => {
    if (!secret || currentWeek?.status !== 'racing') return
    const interval = window.setInterval(() => {
      void callAdmin(secret).then((result) => {
        if (result.response.ok) setData(result.data)
      })
    }, 3000)
    return () => window.clearInterval(interval)
  }, [currentWeek?.status, secret])

  async function act(body: Record<string, unknown>) {
    window.localStorage.setItem('autoduck-season3-secret', secret)
    const result = await callAdmin(secret, body)
    setMessage(result.data.error ?? (result.response.ok ? 'Đã cập nhật.' : 'Có lỗi.'))
    if (result.response.ok) await refresh()
  }

  async function startTestRace() {
    window.localStorage.setItem('autoduck-season3-secret', secret)
    if (!currentWeek) return
    const result = await callAdmin(secret, { action: 'start-race', weekId: currentWeek.id, test: true })
    setMessage(result.data.error ?? (result.response.ok ? 'Test Race đã bắt đầu. Prep official vẫn mở.' : 'Không chạy được Test Race.'))
    if (result.response.ok && result.data.raceId) setTestRaceId(result.data.raceId)
  }

  return <main className="mx-auto max-w-6xl space-y-6 p-6 text-white">
    <header className="rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] p-6 shadow-[0_8px_0_var(--color-ggd-outline)]">
      <div className="text-sm font-black tracking-[0.25em] text-[var(--color-ggd-gold)]">BAN TỔ CHỨC · HOST CONTROL</div>
      <h1 className="mt-2 font-display text-4xl">🦆 Bàn Điều Khiển Cuộc Đua Season 3</h1>
      <p className="mt-3 text-white/70">Quy trình tuần: Mở Chaos 🎴 → Vịt chuẩn bị Loadout & Dự đoán 🎒 → Khóa chuẩn bị 🔒 → Bắt đầu cuộc đua 🏁.</p>
      <div className="mt-5 flex flex-wrap gap-2">
        <input value={secret} onChange={(event) => setSecret(event.target.value)} placeholder="Nhập RACE_SECRET_KEY..." type="password" className="rounded-xl border-2 border-white/20 bg-black/30 px-4 py-3 text-sm focus:border-[var(--color-ggd-gold)] focus:outline-none" />
        <button onClick={() => void refresh()} className="rounded-xl bg-[var(--color-ggd-neon-green)] px-5 py-3 font-black text-[var(--color-ggd-outline)] transition-transform hover:scale-105">TẢI DỮ LIỆU</button>
        <Link href="/season-3" className="rounded-xl border-2 border-white/20 bg-white/5 px-4 py-3 font-black text-white hover:bg-white/10">🏠 TRANG CHỦ S3</Link>
        <Link href="/season-3/rules" className="rounded-xl border-2 border-white/20 bg-white/5 px-4 py-3 font-black text-white hover:bg-white/10">📖 CẨM NANG LUẬT</Link>
        <Link href="/dev/race-lab" className="rounded-xl border-2 border-white/20 px-4 py-3 font-black hover:bg-white/10">🧪 RACE LAB</Link>
        <Link href="/admin/cosmetics" className="rounded-xl border-2 border-white/20 px-4 py-3 font-black hover:bg-white/10">🪙 QUẢN LÝ SHOP</Link>
      </div>
      {message && <p className="mt-3 text-sm font-bold text-[var(--color-ggd-gold)]">{message}</p>}
    </header>

    {!data?.season ? <section className="rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-surface-2)] p-5">
      <h2 className="font-display text-2xl">Chưa có Mùa giải nào đang hoạt động</h2>
      <p className="mt-2 text-white/60">Khởi tạo Mùa giải Season 3 với toàn bộ danh sách tuyển thủ hiện có trong hệ thống.</p>
      <button onClick={() => void act({ action: 'create-season', key: 'S3', name: 'ĐUA DZỊT — SEASON 3', weeks: 12 })} className="mt-4 rounded-xl bg-[var(--color-ggd-gold)] px-5 py-3 font-black text-[var(--color-ggd-outline)] transition-transform hover:scale-105">KHỞI TẠO SEASON 3 (12 TUẦN)</button>
    </section> : <>
      <section className="rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-2xl">Danh Sách Tuyển Thủ Dzịt ({data.players.length})</h2>
          <span className="text-xs text-white/60">Vắng mặt tuần này sẽ không tham gia bốc thăm Chaos và cuộc đua</span>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {data.players.map((player) => <div key={player.id} className={`rounded-2xl border-2 p-4 ${currentWeek?.skippedPlayerIds.includes(player.id) ? 'border-white/10 bg-black/25 opacity-55' : 'border-white/15 bg-[var(--color-ggd-surface-2)]'}`}>
            <div className="flex items-center gap-3"><Season3Avatar name={player.name} avatarUrl={player.avatarUrl} size={40} /><div className="font-black">{player.isKing ? '👑 ' : ''}{player.name}</div></div>
            <div className="mt-1 flex items-center gap-1 text-sm text-white/60">🩹 {player.scars} · 🛡️ {player.shields} · 🔮 {player.predictionPoints} <Season3PointTooltip /></div>
            {currentWeek && !currentWeek.skippedPlayerIds.includes(player.id) && (
              <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-bold">
                {currentWeek.loadoutReadyUserIds?.includes(player.id) ? (
                  <span className="rounded-md border border-emerald-500/30 bg-emerald-500/20 px-2 py-0.5 text-emerald-300">🎒 Loadout ✓</span>
                ) : (
                  <span className="rounded-md border border-rose-500/30 bg-rose-500/20 px-2 py-0.5 text-rose-300">🎒 Chưa chọn đồ</span>
                )}
                {currentWeek.predictionUserIds?.includes(player.id) ? (
                  <span className="rounded-md border border-purple-500/30 bg-purple-500/20 px-2 py-0.5 text-purple-300">🔮 Dự đoán ✓</span>
                ) : (
                  <span className="rounded-md border border-amber-500/30 bg-amber-500/20 px-2 py-0.5 text-amber-300">🔮 Chưa dự đoán</span>
                )}
              </div>
            )}
            <a className="mt-3 block truncate text-xs text-[var(--color-ggd-neon-green)] hover:underline" href={player.personalLink} target="_blank" rel="noreferrer">{player.personalLink}</a>
            {currentWeek?.status === 'open' && <button onClick={() => void act({ action: 'toggle-skip', weekId: currentWeek.id, userId: player.id })} className="mt-3 rounded-lg border border-white/20 px-2.5 py-1 text-[11px] font-black hover:bg-white/10">{currentWeek.skippedPlayerIds.includes(player.id) ? '↩ THAM GIA LẠI (ADD BACK)' : '🛟 TẠM NGHỈ TUẦN NÀY (SKIP)'}</button>}
          </div>)}
        </div>
      </section>

      {currentWeek && <Season3ChaosCard compact type={currentWeek.chaosType} weekNumber={currentWeek.weekNumber} targetName={nameById.get(currentWeek.chaosTargetUserId ?? -1)} groups={currentWeek.chaosGroups?.map((group) => group.map((id) => nameById.get(id) ?? String(id)))} predictionCount={currentWeek.predictionCount} playerCount={activePlayerCount} />}

      {currentWeek && (
        <section className="rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-surface-2)] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs font-black tracking-[0.2em] text-[var(--color-ggd-gold)]">ADMIN CHAOS CONTROL · QUẢN LÝ LÁ BÀI</div>
              <h2 className="mt-1 font-display text-2xl">🃏 Điều Chỉnh / Đổi Lá Bài Chaos Tuần {currentWeek.weekNumber}</h2>
              <p className="mt-1 text-sm text-white/60">
                Lá bài hiện tại: <span className="font-bold text-[var(--color-ggd-gold)]">{currentWeek.chaosType}</span>
                {currentWeek.chaosTargetUserId ? ` (🎯 Mục tiêu: ${nameById.get(currentWeek.chaosTargetUserId) ?? currentWeek.chaosTargetUserId})` : ''}
                {currentWeek.chaosGroups ? ` (${currentWeek.chaosGroups.length} nhóm)` : ''}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setShowChaosPicker((prev) => !prev)}
                className="rounded-xl border-2 border-white/20 bg-white/10 px-4 py-2.5 text-sm font-black hover:bg-white/20"
              >
                {showChaosPicker ? '▲ ĐÓNG BẢNG CHỌN' : '⚙️ CHỌN LÁ BÀI THỦ CÔNG (MANUAL PICK)'}
              </button>
              {(currentWeek.chaosType === 'DUO' || currentWeek.chaosType === 'CONSTRUCTORS' || currentWeek.chaosType === 'BOUNTY_HUNT') && (
                <button
                  type="button"
                  onClick={() => void act({ action: 'set-chaos', weekId: currentWeek.id, chaosType: currentWeek.chaosType })}
                  className="rounded-xl border-2 border-[var(--color-ggd-lavender)]/60 bg-[var(--color-ggd-lavender)]/20 px-4 py-2.5 text-sm font-black text-[var(--color-ggd-lavender)] transition-transform hover:scale-105"
                  title="Xáo trộn lại cặp đôi/đội/mục tiêu của lá bài hiện tại"
                >
                  🔀 XÁO TRỘN LẠI {currentWeek.chaosType === 'BOUNTY_HUNT' ? 'MỤC TIÊU' : 'NHÓM/CẶP'}
                </button>
              )}
              {canStartSeason3TestRace(currentWeek.status) && (
                <button
                  type="button"
                  onClick={() => void act({ action: 'set-chaos', weekId: currentWeek.id, chaosType: 'RANDOM' })}
                  className="rounded-xl bg-[var(--color-ggd-orange)] px-4 py-2.5 text-sm font-black text-white transition-transform hover:scale-105"
                  title="Bốc ngẫu nhiên lá bài Chaos hoàn toàn mới"
                >
                  🎲 BỐC LẠI NGẪU NHIÊN (FORCE REROLL)
                </button>
              )}
            </div>
          </div>

          {showChaosPicker && (
            <div className="mt-5 space-y-4 rounded-2xl border-2 border-white/15 bg-black/30 p-4">
              <div className="text-xs font-black uppercase tracking-wider text-white/50">1. Chọn loại lá bài Chaos:</div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {CHAOS_OPTIONS.map((opt) => {
                  const isSelected = selectedChaosType === opt.type
                  return (
                    <button
                      key={opt.type}
                      type="button"
                      onClick={() => {
                        setCustomChaosType(opt.type)
                        if (opt.type !== 'BOUNTY_HUNT') setCustomTargetUserId('')
                      }}
                      className={`flex flex-col items-start rounded-xl border-2 p-3 text-left transition-all ${
                        isSelected
                          ? 'border-[var(--color-ggd-gold)] bg-[var(--color-ggd-gold)]/15 shadow-[0_0_12px_rgba(255,215,0,0.25)]'
                          : 'border-white/10 bg-white/5 hover:border-white/25 hover:bg-white/10'
                      }`}
                    >
                      <div className="flex w-full items-center justify-between">
                        <span className="text-xl">{opt.icon}</span>
                        {isSelected && <span className="rounded bg-[var(--color-ggd-gold)] px-2 py-0.5 text-[10px] font-black text-black">ĐANG CHỌN</span>}
                      </div>
                      <div className="mt-2 font-display text-base text-white">{opt.name}</div>
                      <div className="mt-1 text-xs text-white/70">{opt.desc}</div>
                    </button>
                  )
                })}
              </div>

              {selectedChaosType === 'BOUNTY_HUNT' && (
                <div className="rounded-xl border-2 border-fuchsia-500/40 bg-fuchsia-950/20 p-3.5">
                  <label className="block text-xs font-black text-fuchsia-300">
                    🎯 2. Chọn Vịt Mục Tiêu Bị Truy Nã (Wanted Duck):
                  </label>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <select
                      value={selectedTargetUserId}
                      onChange={(e) => setCustomTargetUserId(e.target.value ? Number(e.target.value) : '')}
                      className="rounded-lg border-2 border-white/20 bg-black/60 px-3 py-2 text-sm text-white focus:border-[var(--color-ggd-gold)] focus:outline-none"
                    >
                      <option value="">🎲 Ngẫu nhiên một vịt (Random target)</option>
                      {activePlayers.map((player) => (
                        <option key={player.id} value={player.id}>
                          🦆 {player.name} {player.isKing ? '(👑 Vua Ao)' : ''}
                        </option>
                      ))}
                    </select>
                    {selectedTargetUserId && (
                      <span className="text-xs font-bold text-fuchsia-200">
                        Đã chọn mục tiêu: {nameById.get(Number(selectedTargetUserId)) ?? selectedTargetUserId}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {(selectedChaosType === 'DUO' || selectedChaosType === 'CONSTRUCTORS') && (
                <div className="rounded-xl border-2 border-purple-500/40 bg-purple-950/20 p-3.5 text-xs text-purple-200">
                  ℹ️ Khi áp dụng <span className="font-black">{selectedChaosType}</span>, hệ thống sẽ tự động ghép nhóm/cặp ngẫu nhiên từ danh sách {activePlayerCount} tuyển thủ active.
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <span className="text-xs text-white/60">
                  Sau khi áp dụng, luật Chaos của Tuần {currentWeek.weekNumber} sẽ được cập nhật ngay lập tức cho toàn bộ tuyển thủ.
                </span>
                <button
                  type="button"
                  disabled={!canStartSeason3TestRace(currentWeek.status)}
                  onClick={() => {
                    void act({
                      action: 'set-chaos',
                      weekId: currentWeek.id,
                      chaosType: selectedChaosType,
                      targetUserId: selectedChaosType === 'BOUNTY_HUNT' && selectedTargetUserId ? Number(selectedTargetUserId) : undefined,
                    })
                    setShowChaosPicker(false)
                    setCustomChaosType(null)
                    setCustomTargetUserId(null)
                  }}
                  className="rounded-xl bg-[var(--color-ggd-neon-green)] px-6 py-3 font-black text-[var(--color-ggd-outline)] transition-transform hover:scale-105 disabled:opacity-50"
                >
                  ✓ LƯU & ÁP DỤNG LÁ BÀI CHAOS
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {currentWeek && canStartSeason3TestRace(currentWeek.status) && <section className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border-4 border-[var(--color-ggd-gold)] bg-[var(--color-ggd-surface-2)] p-5">
        <div>
          <div className="text-xs font-black tracking-[0.2em] text-[var(--color-ggd-gold)]">CHẾ ĐỘ ĐUA THỬ · TEST MODE</div>
          <h2 className="mt-1 font-display text-2xl">🧪 Cuộc Đua Thử Nghiệm (Test Race)</h2>
          <p className="mt-1 text-sm text-white/60">Chạy mô phỏng trước để kiểm tra đường đua. Tuyển thủ vẫn chuẩn bị Loadout & Dự đoán cho Cuộc đua Chính thức bình thường.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => void startTestRace()} className="rounded-xl bg-[var(--color-ggd-gold)] px-5 py-3 font-black text-[var(--color-ggd-outline)] transition-transform hover:scale-105">🏁 BẮT ĐẦU ĐUA THỬ</button>
          {testRaceId && <Link href={`/season-3/race/${testRaceId}`} className="rounded-xl border-2 border-white/20 px-5 py-3 font-black hover:bg-white/10">▶ XEM DIỄN BIẾN ĐUA THỬ</Link>}
        </div>
      </section>}

      {currentWeek && <section className="rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-2xl">TUẦN {currentWeek.weekNumber} · LÁ BÀI {currentWeek.chaosType}</h2>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full bg-[var(--color-ggd-neon-green)] px-4 py-2 font-black text-[var(--color-ggd-outline)]">🎒 Đã chọn Loadout {currentWeek.loadoutReadyCount}/{activePlayerCount}</span>
            <span className="rounded-full bg-[var(--color-ggd-orange)] px-4 py-2 font-black text-white">🔮 Đã dự đoán {currentWeek.predictionCount}/{activePlayerCount}</span>
            <span className="rounded-full bg-[var(--color-ggd-sky)] px-4 py-2 font-black text-[var(--color-ggd-outline)]">🛡️ Bật Khiên {currentWeek.shieldConfirmations.length}/{activePlayerCount}</span>
          </div>
        </div>
        <p className="mt-2 text-sm text-white/60">Mục tiêu / Nhóm Chaos: {nameById.get(currentWeek.chaosTargetUserId ?? -1) ?? '—'}{currentWeek.chaosGroups ? ` · ${currentWeek.chaosGroups.map((group) => group.map((id) => nameById.get(id) ?? id).join(' + ')).join(' / ')}` : ''}</p>
        <p className="mt-2 text-sm text-[var(--color-ggd-sky)]">🛡️ Đã xác nhận bật Khiên cứu mạng: {currentWeek.shieldConfirmations.length > 0 ? currentWeek.shieldConfirmations.join(', ') : 'Chưa có ai'}</p>
        {currentWeek.skippedPlayerIds.length > 0 && <p className="mt-2 text-sm text-white/50">🛟 Tạm nghỉ tuần này: {currentWeek.skippedPlayerIds.map((id) => nameById.get(id) ?? id).join(', ')}</p>}

        {/* Missing Prep Tracker for Admin */}
        {currentWeek.status === 'open' && (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className={`rounded-2xl border-2 p-4 ${
              (currentWeek.missingLoadoutNames?.length ?? 0) > 0 
                ? 'border-rose-500/40 bg-rose-500/10' 
                : 'border-emerald-500/40 bg-emerald-500/10'
            }`}>
              <div className="flex items-center justify-between">
                <span className="font-display text-lg text-white">🎒 Chưa chọn Loadout ({currentWeek.missingLoadoutNames?.length ?? 0})</span>
                {(currentWeek.missingLoadoutNames?.length ?? 0) === 0 && <span className="text-xs font-black text-emerald-400">✓ ĐỦ 100%</span>}
              </div>
              {(currentWeek.missingLoadoutNames?.length ?? 0) > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {currentWeek.missingLoadoutNames?.map((name) => (
                    <span key={name} className="rounded-lg bg-rose-500/25 px-2.5 py-1 text-xs font-black text-rose-200">
                      {name}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-1 text-xs text-emerald-300/80">Tất cả tuyển thủ đã hoàn tất chọn Loadout.</p>
              )}
            </div>

            <div className={`rounded-2xl border-2 p-4 ${
              (currentWeek.missingPredictionNames?.length ?? 0) > 0 
                ? 'border-amber-500/40 bg-amber-500/10' 
                : 'border-emerald-500/40 bg-emerald-500/10'
            }`}>
              <div className="flex items-center justify-between">
                <span className="font-display text-lg text-white">🔮 Chưa gửi Dự Đoán ({currentWeek.missingPredictionNames?.length ?? 0})</span>
                {(currentWeek.missingPredictionNames?.length ?? 0) === 0 && <span className="text-xs font-black text-emerald-400">✓ ĐỦ 100%</span>}
              </div>
              {(currentWeek.missingPredictionNames?.length ?? 0) > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {currentWeek.missingPredictionNames?.map((name) => (
                    <span key={name} className="rounded-lg bg-amber-500/25 px-2.5 py-1 text-xs font-black text-amber-200">
                      {name}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-1 text-xs text-emerald-300/80">Tất cả tuyển thủ đã hoàn tất dự đoán tiên tri.</p>
              )}
            </div>
          </div>
        )}
        {canStartSeason3TestRace(currentWeek.status) && <div className="mt-5 flex flex-wrap items-center gap-3">
          {currentWeek.status === 'open' && <button onClick={() => void act({ action: 'lock', weekId: currentWeek.id })} className="rounded-xl bg-[var(--color-ggd-gold)] px-5 py-3 font-black text-[var(--color-ggd-outline)] transition-transform hover:scale-105">🔒 KHÓA CHUẨN BỊ (LOCK PREP)</button>}
          {currentWeek.status === 'locked' && <><button onClick={() => void act({ action: 'start-race', weekId: currentWeek.id })} className="rounded-xl bg-[var(--color-ggd-neon-green)] px-5 py-3 font-black text-[var(--color-ggd-outline)] transition-transform hover:scale-105">🏁 BẮT ĐẦU CUỘC ĐUA CHÍNH THỨC</button><button onClick={() => void act({ action: 'unlock', weekId: currentWeek.id })} className="rounded-xl border-2 border-white/20 px-5 py-3 font-black hover:bg-white/10">↩ MỞ LẠI CHUẨN BỊ (UNLOCK)</button></>}
          <span className="text-sm text-white/60">Khóa chuẩn bị khi mọi người đã setup xong. Cuộc đua chính thức chỉ chạy vào thứ Hai.</span>
        </div>}
        {currentWeek.status === 'racing' && currentWeek.raceId && <div className="mt-5 flex flex-wrap items-center gap-3">
          <span className="font-black text-[var(--color-ggd-neon-green)]">🏃 CUỘC ĐUA CHÍNH THỨC ĐANG DIỄN RA</span>
          <Link href={`/season-3/race/${currentWeek.raceId}`} className="rounded-xl bg-[var(--color-ggd-gold)] px-5 py-3 font-black text-[var(--color-ggd-outline)] transition-transform hover:scale-105">▶ XEM TRỰC TIẾP CUỘC ĐUA</Link>
        </div>}
      </section>}

      {!currentWeek && <section className="rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] p-5">
        <div className="text-xs font-black tracking-[0.2em] text-[var(--color-ggd-gold)]">KẾT THÚC CHẶNG CŨ · CHUẨN BỊ CHẶNG MỚI</div>
        <h2 className="mt-1 font-display text-2xl">Mở Tuần Thi Đấu Kế Tiếp</h2>
        <p className="mt-1 text-sm text-white/60">Bốc ngẫu nhiên hoặc chọn thủ công lá bài Chaos cho tuần tiếp theo.</p>

        {data.weeks.length < (data.season?.weeks ?? 12) && (
          <div className="mt-5 space-y-4">
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setOpenWeekMode('random')}
                className={`rounded-xl border-2 px-4 py-2.5 text-sm font-black transition-all ${
                  openWeekMode === 'random'
                    ? 'border-[var(--color-ggd-neon-green)] bg-[var(--color-ggd-neon-green)]/20 text-[var(--color-ggd-neon-green)]'
                    : 'border-white/20 bg-white/5 text-white/70 hover:bg-white/10'
                }`}
              >
                🎲 Bốc Ngẫu Nhiên (Random)
              </button>
              <button
                type="button"
                onClick={() => setOpenWeekMode('manual')}
                className={`rounded-xl border-2 px-4 py-2.5 text-sm font-black transition-all ${
                  openWeekMode === 'manual'
                    ? 'border-[var(--color-ggd-gold)] bg-[var(--color-ggd-gold)]/20 text-[var(--color-ggd-gold)]'
                    : 'border-white/20 bg-white/5 text-white/70 hover:bg-white/10'
                }`}
              >
                🎯 Chọn Thủ Công (Manual Pick)
              </button>
            </div>

            {openWeekMode === 'manual' && (
              <div className="space-y-4 rounded-2xl border-2 border-white/15 bg-black/30 p-4">
                <div className="text-xs font-black uppercase tracking-wider text-white/50">Chọn loại lá bài Chaos:</div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {CHAOS_OPTIONS.map((opt) => {
                    const isSelected = openWeekChaosType === opt.type
                    return (
                      <button
                        key={opt.type}
                        type="button"
                        onClick={() => setOpenWeekChaosType(opt.type)}
                        className={`flex flex-col items-start rounded-xl border-2 p-3 text-left transition-all ${
                          isSelected
                            ? 'border-[var(--color-ggd-gold)] bg-[var(--color-ggd-gold)]/15 shadow-[0_0_12px_rgba(255,215,0,0.25)]'
                            : 'border-white/10 bg-white/5 hover:border-white/25 hover:bg-white/10'
                        }`}
                      >
                        <div className="flex w-full items-center justify-between">
                          <span className="text-xl">{opt.icon}</span>
                          {isSelected && <span className="rounded bg-[var(--color-ggd-gold)] px-2 py-0.5 text-[10px] font-black text-black">ĐANG CHỌN</span>}
                        </div>
                        <div className="mt-2 font-display text-base text-white">{opt.name}</div>
                        <div className="mt-1 text-xs text-white/70">{opt.desc}</div>
                      </button>
                    )
                  })}
                </div>

                {openWeekChaosType === 'BOUNTY_HUNT' && (
                  <div className="rounded-xl border-2 border-fuchsia-500/40 bg-fuchsia-950/20 p-3.5">
                    <label className="block text-xs font-black text-fuchsia-300">
                      🎯 Chọn Vịt Mục Tiêu Bị Truy Nã (Wanted Duck):
                    </label>
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <select
                        value={openWeekTargetUserId}
                        onChange={(e) => setOpenWeekTargetUserId(e.target.value ? Number(e.target.value) : '')}
                        className="rounded-lg border-2 border-white/20 bg-black/60 px-3 py-2 text-sm text-white focus:border-[var(--color-ggd-gold)] focus:outline-none"
                      >
                        <option value="">🎲 Ngẫu nhiên một vịt (Random target)</option>
                        {data.players.map((player) => (
                          <option key={player.id} value={player.id}>
                            🦆 {player.name} {player.isKing ? '(👑 Vua Ao)' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={() =>
                void act({
                  action: 'open-week',
                  chaosType: openWeekMode === 'manual' ? openWeekChaosType : undefined,
                  targetUserId:
                    openWeekMode === 'manual' && openWeekChaosType === 'BOUNTY_HUNT' && openWeekTargetUserId
                      ? Number(openWeekTargetUserId)
                      : undefined,
                })
              }
              className="mt-4 rounded-xl bg-[var(--color-ggd-neon-green)] px-6 py-3 font-black text-[var(--color-ggd-outline)] transition-transform hover:scale-105"
            >
              {openWeekMode === 'manual' ? '🎴 MỞ TUẦN MỚI VỚI LÁ BÀI ĐÃ CHỌN' : '🎴 BỐC LÁ BÀI CHAOS TUẦN TIẾP THEO'}
            </button>
          </div>
        )}
      </section>}

      <section className="rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-surface-2)] p-5">
        <h2 className="font-display text-2xl">📰 Lịch Sử & Tổng Kết Các Chặng Đã Đua</h2>
        <div className="mt-4 space-y-3">
          {data.weeks.filter((week) => week.status === 'resolved').map((week) => <div key={week.id} className="whitespace-pre-wrap rounded-xl bg-black/20 p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="font-black text-[var(--color-ggd-gold)]">TUẦN {week.weekNumber} · LÁ BÀI {week.chaosType}</div>
              {week.raceId && <Link href={`/season-3/race/${week.raceId}`} className="rounded-lg border border-white/20 px-3 py-1 text-xs font-black hover:bg-white/10">▶ XEM LẠI REPLAY</Link>}
            </div>
            {week.recap}
          </div>)}
        </div>
      </section>

      {(data.balance?.items.length ?? 0) > 0 && <section className="rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] p-5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <div className="text-xs font-black tracking-[0.2em] text-[var(--color-ggd-gold)]">OFFICIAL RACES ONLY</div>
            <h2 className="font-display text-2xl">📊 Thống Kê Hiệu Năng Trang Bị (Loadout Items)</h2>
          </div>
          <Link href="/dev/race-lab" className="rounded-xl border-2 border-white/20 px-4 py-2 font-black hover:bg-white/10">MỞ RACE LAB</Link>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-white/45">
              <tr>
                <th className="pb-2">TRANG BỊ</th>
                <th>LƯỢT CHỌN</th>
                <th>TỶ LỆ THẮNG</th>
                <th>BÉT BẢNG (B2)</th>
                <th>HẠNG TB</th>
                <th>KÍCH HOẠT</th>
                <th>HIỆU QUẢ</th>
                <th>Δ HẠNG</th>
              </tr>
            </thead>
            <tbody>
              {data.balance?.items.map((item) => <tr key={item.name} className="border-t border-white/10">
                <td className="py-3 font-black">{item.name}</td>
                <td>{item.picks}</td>
                <td>{(item.winRate * 100).toFixed(1)}%</td>
                <td>{(item.bottom2Rate * 100).toFixed(1)}%</td>
                <td>{item.averageFinish.toFixed(2)}</td>
                <td>{(item.activationRate * 100).toFixed(1)}%</td>
                <td>{(item.successRate * 100).toFixed(1)}%</td>
                <td className={Math.abs(item.averageRankDelta) > 1 ? 'text-[var(--color-ggd-orange)]' : ''}>{item.averageRankDelta > 0 ? '+' : ''}{item.averageRankDelta.toFixed(2)}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
        <div className="mt-5 grid gap-2 md:grid-cols-3">
          {data.balance?.loadouts.map((loadout) => <div key={loadout.name} className={`rounded-xl border-2 p-3 ${loadout.winRate > 0.144 ? 'border-[var(--color-ggd-orange)] bg-[var(--color-ggd-orange)]/10' : 'border-white/10 bg-black/20'}`}>
            <div className="font-black">{loadout.winRate > 0.144 ? '🚨 ' : ''}{loadout.name}</div>
            <div className="mt-1 text-sm text-white/60">{loadout.picks} lượt · thắng {(loadout.winRate * 100).toFixed(1)}% · hạng TB #{loadout.averageFinish.toFixed(2)}</div>
          </div>)}
        </div>
      </section>}

      {(data.balance?.pickups.length ?? 0) > 0 && <section className="rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-surface-2)] p-5">
        <div className="text-xs font-black tracking-[0.2em] text-[var(--color-ggd-neon-green)]">HỘP QUÀ ĐƯỜNG ĐUA · TELEMETRY</div>
        <h2 className="font-display text-2xl">📦 Thống Kê Vật Phẩm Hộp Quà (Pickups & Wild Items)</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[700px] text-left text-sm">
            <thead className="text-white/45">
              <tr>
                <th className="pb-2">VẬT PHẨM</th>
                <th>LƯỢT NHẶT</th>
                <th>KÍCH HOẠT</th>
                <th>TRÚNG ĐÍCH</th>
                <th>TỰ DÙNG (AI)</th>
                <th>Δ HẠNG</th>
              </tr>
            </thead>
            <tbody>
              {data.balance?.pickups.map((item) => <tr key={item.name} className="border-t border-white/10">
                <td className="py-3 font-black">{item.name.replaceAll('_', ' ')}</td>
                <td>{item.picks}</td>
                <td>{(item.activationRate * 100).toFixed(1)}%</td>
                <td>{(item.hitRate * 100).toFixed(1)}%</td>
                <td>{(item.autoRate * 100).toFixed(1)}%</td>
                <td className={Math.abs(item.averageRankDelta) > 1 ? 'text-[var(--color-ggd-orange)]' : ''}>{item.averageRankDelta > 0 ? '+' : ''}{item.averageRankDelta.toFixed(2)}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </section>}
    </>}
  </main>
}
