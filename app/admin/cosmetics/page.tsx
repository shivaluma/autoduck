'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { CosmeticDefinition } from '@/lib/cosmetics/types'

type AdminData = {
  players: Array<{ id: number; name: string; quackPoints: number; collectionCount: number }>
  catalog: CosmeticDefinition[]
  transactions: Array<{ id: string; reason: string; amount: number; balanceAfter: number }>
  pulls: unknown[]
  error?: string
}

export default function CosmeticsAdminPage() {
  const [secret, setSecret] = useState('')
  const [data, setData] = useState<AdminData | null>(null)
  const [playerId, setPlayerId] = useState('')
  const [cosmeticId, setCosmeticId] = useState('')
  const [amount, setAmount] = useState('')
  const [price, setPrice] = useState('')
  const [limitedLabel, setLimitedLabel] = useState('')
  const [message, setMessage] = useState('')

  async function load(value = secret) {
    const response = await fetch('/api/admin/cosmetics', { headers: { 'x-race-secret': value } })
    const next = await response.json()
    setData(next)
    setMessage(response.ok ? '' : next.error)
  }

  async function act(body: Record<string, unknown>) {
    const response = await fetch('/api/admin/cosmetics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-race-secret': secret },
      body: JSON.stringify(body),
    })
    const result = await response.json()
    setMessage(response.ok ? 'Đã cập nhật thành công.' : result.error)
    if (response.ok) await load()
  }

  useEffect(() => {
    const saved = window.localStorage.getItem('autoduck-season3-secret') ?? ''
    if (saved) {
      setSecret(saved)
      void load(saved)
    }
  }, [])

  const selectedPlayer = data?.players.find((p) => String(p.id) === playerId)

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6 text-white">
      <header className="rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] p-6 shadow-[0_8px_0_var(--color-ggd-outline)]">
        <div className="text-sm font-black tracking-[0.25em] text-[var(--color-ggd-gold)]">BAN TỔ CHỨC · HOST CONTROL</div>
        <h1 className="mt-2 font-display text-4xl">🪙 Quản Lý Quack Points & Tủ Đồ</h1>
        <p className="mt-3 text-white/70">Điều chỉnh Quack Points (QP), cấp phát vật phẩm, điều chỉnh giá shop và cấu hình quay Gacha.</p>
        <div className="mt-5 flex flex-wrap gap-2">
          <input
            type="password"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            placeholder="Nhập RACE_SECRET_KEY..."
            className="rounded-xl border-2 border-white/20 bg-black/30 px-4 py-3 text-sm focus:border-[var(--color-ggd-gold)] focus:outline-none"
          />
          <button
            onClick={() => {
              window.localStorage.setItem('autoduck-season3-secret', secret)
              void load()
            }}
            className="rounded-xl bg-[var(--color-ggd-neon-green)] px-5 py-3 font-black text-[var(--color-ggd-outline)] transition-transform hover:scale-105"
          >
            TẢI DỮ LIỆU
          </button>
          <Link href="/admin/season-3" className="rounded-xl border-2 border-white/20 bg-white/5 px-4 py-3 font-black text-white hover:bg-white/10">
            🦆 QUẢN LÝ SEASON 3
          </Link>
          <Link href="/season-3" className="rounded-xl border-2 border-white/20 bg-white/5 px-4 py-3 font-black text-white hover:bg-white/10">
            🏠 TRANG CHỦ S3
          </Link>
        </div>
        {message && <p className="mt-3 text-sm font-bold text-[var(--color-ggd-gold)]">{message}</p>}
      </header>

      {data && (
        <>
          <section className="rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-surface-2)] p-5">
            <h2 className="font-display text-2xl">Danh Sách Tuyển Thủ ({data.players.length})</h2>
            <p className="mt-1 text-sm text-white/60">Nhấp vào một tuyển thủ để thao tác điểm QP hoặc tặng/thu hồi item.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.players.map((player) => (
                <button
                  type="button"
                  onClick={() => setPlayerId(String(player.id))}
                  key={player.id}
                  className={`rounded-2xl border-2 p-4 text-left transition-all ${
                    playerId === String(player.id)
                      ? 'border-[var(--color-ggd-gold)] bg-[var(--color-ggd-gold)]/10 shadow-[0_0_15px_rgba(255,215,0,0.2)]'
                      : 'border-white/10 bg-[var(--color-ggd-surface-2)] hover:border-white/30'
                  }`}
                >
                  <div className="font-black text-base">{player.name}</div>
                  <div className="mt-1 text-sm text-white/60">🪙 {player.quackPoints} QP · 🎒 {player.collectionCount} món đã sở hữu</div>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-2xl">⚙️ Công Cụ Điều Chỉnh</h2>
              {selectedPlayer && (
                <span className="rounded-full bg-[var(--color-ggd-gold)] px-3 py-1 text-xs font-black text-[var(--color-ggd-outline)]">
                  Đang chọn: {selectedPlayer.name} (🪙 {selectedPlayer.quackPoints} QP)
                </span>
              )}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <input
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                type="number"
                placeholder="QP (+/-)"
                className="w-32 rounded-xl border border-white/20 bg-black/30 px-3 py-2 text-sm focus:outline-none"
              />
              <button
                disabled={!playerId || !amount}
                onClick={() => void act({ action: 'adjust-qp', playerId: Number(playerId), amount: Number(amount) })}
                className="rounded-xl bg-[var(--color-ggd-gold)] px-4 py-2 text-sm font-black text-[var(--color-ggd-outline)] disabled:opacity-40"
              >
                CẬP NHẬT QP
              </button>

              <select
                value={cosmeticId}
                onChange={(event) => setCosmeticId(event.target.value)}
                className="max-w-xs rounded-xl border border-white/20 bg-[#17102c] px-3 py-2 text-sm focus:outline-none"
              >
                <option value="">-- Chọn Skin / Vật Phẩm --</option>
                {data.catalog.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({item.rarity})
                  </option>
                ))}
              </select>
              <button
                disabled={!playerId || !cosmeticId}
                onClick={() => void act({ action: 'grant', playerId: Number(playerId), cosmeticId })}
                className="rounded-xl bg-[var(--color-ggd-neon-green)] px-4 py-2 text-sm font-black text-[var(--color-ggd-outline)] disabled:opacity-40"
              >
                TẶNG ITEM
              </button>
              <button
                disabled={!playerId || !cosmeticId}
                onClick={() => void act({ action: 'revoke', playerId: Number(playerId), cosmeticId })}
                className="rounded-xl border border-white/20 px-4 py-2 text-sm font-black hover:bg-white/10 disabled:opacity-40"
              >
                THU HỒI
              </button>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-white/10 pt-4">
              <span className="text-xs font-bold text-white/50">CẤU HÌNH VẬT PHẨM ĐANG CHỌN:</span>
              <button
                disabled={!cosmeticId}
                onClick={() => void act({ action: 'configure', cosmeticId, enabled: false })}
                className="rounded-xl border border-white/20 px-3 py-2 text-xs font-black hover:bg-white/10 disabled:opacity-40"
              >
                TẠM ẨN (DISABLE)
              </button>
              <button
                disabled={!cosmeticId}
                onClick={() => void act({ action: 'configure', cosmeticId, enabled: true, shopEligible: true, gachaEligible: true })}
                className="rounded-xl border border-white/20 px-3 py-2 text-xs font-black hover:bg-white/10 disabled:opacity-40"
              >
                BẬT TẤT CẢ (SHOP & GACHA)
              </button>
              <input
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                type="number"
                placeholder="Giá QP..."
                className="w-28 rounded-xl border border-white/20 bg-black/30 px-3 py-2 text-xs focus:outline-none"
              />
              <input
                value={limitedLabel}
                onChange={(event) => setLimitedLabel(event.target.value)}
                placeholder="Nhãn Limited..."
                className="rounded-xl border border-white/20 bg-black/30 px-3 py-2 text-xs focus:outline-none"
              />
              <button
                disabled={!cosmeticId}
                onClick={() => void act({ action: 'configure', cosmeticId, priceOverride: price ? Number(price) : null, limitedLabel: limitedLabel || null })}
                className="rounded-xl bg-[var(--color-ggd-lavender)] px-4 py-2 text-xs font-black text-[var(--color-ggd-outline)] disabled:opacity-40"
              >
                LƯU CẤU HÌNH
              </button>
            </div>
          </section>

          <section className="rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-surface-2)] p-5">
            <h2 className="font-display text-2xl">📜 Nhật Ký Giao Dịch & Biến Động Điểm</h2>
            <div className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-2">
              {data.transactions.map((item) => (
                <div key={item.id} className="flex items-center justify-between rounded-xl bg-black/20 px-4 py-2.5 text-sm">
                  <span>{item.reason}</span>
                  <b className={item.amount > 0 ? 'text-[var(--color-ggd-neon-green)]' : 'text-[var(--color-ggd-orange)]'}>
                    {item.amount > 0 ? '+' : ''}
                    {item.amount} QP → Số dư: {item.balanceAfter} QP
                  </b>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  )
}
