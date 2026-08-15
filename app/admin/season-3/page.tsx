'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Season3ChaosCard } from '@/components/season3-chaos-card'
import { Season3Avatar } from '@/components/season3-avatar'
import { Season3PointTooltip } from '@/components/season3-point-tooltip'
import { canStartSeason3TestRace } from '@/lib/season3-test-mode'

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

  const currentWeek = useMemo(() => (data?.weeks ?? []).find((week) => week.status !== 'resolved') ?? null, [data])
  const nameById = useMemo(() => new Map((data?.players ?? []).map((player) => [player.id, player.name])), [data])
  const activePlayerCount = (data?.players?.length ?? 0) - (currentWeek?.skippedPlayerIds.length ?? 0)

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
            <a className="mt-3 block truncate text-xs text-[var(--color-ggd-neon-green)] hover:underline" href={player.personalLink} target="_blank" rel="noreferrer">{player.personalLink}</a>
            {currentWeek?.status === 'open' && <button onClick={() => void act({ action: 'toggle-skip', weekId: currentWeek.id, userId: player.id })} className="mt-3 rounded-lg border border-white/20 px-2.5 py-1 text-[11px] font-black hover:bg-white/10">{currentWeek.skippedPlayerIds.includes(player.id) ? '↩ THAM GIA LẠI (ADD BACK)' : '🛟 TẠM NGHỈ TUẦN NÀY (SKIP)'}</button>}
          </div>)}
        </div>
      </section>

      {currentWeek && <Season3ChaosCard compact type={currentWeek.chaosType} weekNumber={currentWeek.weekNumber} targetName={nameById.get(currentWeek.chaosTargetUserId ?? -1)} groups={currentWeek.chaosGroups?.map((group) => group.map((id) => nameById.get(id) ?? String(id)))} predictionCount={currentWeek.predictionCount} playerCount={activePlayerCount} />}

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
        <h2 className="font-display text-2xl">Đã hoàn thành chặng tuần</h2>
        <p className="mt-1 text-sm text-white/60">Mở lá bài Chaos để bước vào tuần thi đấu kế tiếp.</p>
        {data.weeks.length < (data.season?.weeks ?? 12) && <button onClick={() => void act({ action: 'open-week' })} className="mt-4 rounded-xl bg-[var(--color-ggd-neon-green)] px-5 py-3 font-black text-[var(--color-ggd-outline)] transition-transform hover:scale-105">🎴 BỐC LÁ BÀI CHAOS TUẦN TIẾP THEO</button>}
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
