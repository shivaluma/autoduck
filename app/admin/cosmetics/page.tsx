'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { CosmeticDefinition, CosmeticRarity, CosmeticSlot } from '@/lib/cosmetics/types'

/* eslint-disable @next/next/no-img-element -- SVG preview assets are intentionally unoptimized for instant rendering */

type AdminPlayer = {
  id: number
  name: string
  quackPoints: number
  collectionCount: number
  ownedCosmeticIds?: string[]
}

type AdminData = {
  players: AdminPlayer[]
  catalog: CosmeticDefinition[]
  transactions: Array<{ id: string; reason: string; amount: number; balanceAfter: number }>
  pulls: unknown[]
  configs?: Array<{
    cosmeticId: string
    enabled: boolean
    shopEligible: boolean
    gachaEligible: boolean
    priceOverride?: number | null
    limitedLabel?: string | null
  }>
  error?: string
}

const SLOT_MAP: Record<CosmeticSlot, { label: string; icon: string }> = {
  bodyColor: { label: 'Màu Lông', icon: '🎨' },
  bodySkin: { label: 'Skin Họa Tiết', icon: '🧬' },
  head: { label: 'Nón / Mũ', icon: '🧢' },
  outfit: { label: 'Trang Phục', icon: '👕' },
  face: { label: 'Mặt & Kính', icon: '🕶️' },
  neck: { label: 'Phụ Kiện Cổ', icon: '🧣' },
  back: { label: 'Lưng & Cánh', icon: '🎒' },
  pet: { label: 'Thú Cưng', icon: '🐾' },
  aura: { label: 'Hào Quang', icon: '✨' },
  trail: { label: 'Vệt Nước', icon: '🌊' },
  finish: { label: 'Về Đích', icon: '🎆' },
  nameplate: { label: 'Bảng Tên', icon: '🏷️' },
}

const RARITY_MAP: Record<CosmeticRarity, { label: string; border: string; bg: string; text: string; badge: string }> = {
  common: { label: 'Common', border: 'border-white/15', bg: 'bg-white/5', text: 'text-white/70', badge: 'bg-white/20 text-white' },
  uncommon: { label: 'Uncommon', border: 'border-emerald-500/40', bg: 'bg-emerald-500/10', text: 'text-emerald-300', badge: 'bg-emerald-500/25 text-emerald-300' },
  rare: { label: 'Rare', border: 'border-blue-500/40', bg: 'bg-blue-500/10', text: 'text-blue-300', badge: 'bg-blue-500/25 text-blue-300' },
  epic: { label: 'Epic', border: 'border-purple-500/40', bg: 'bg-purple-500/10', text: 'text-purple-300', badge: 'bg-purple-500/25 text-purple-300' },
  legendary: { label: 'Legendary', border: 'border-amber-400/60 shadow-[0_0_12px_rgba(251,191,36,0.15)]', bg: 'bg-amber-500/10', text: 'text-amber-300', badge: 'bg-amber-500/30 text-amber-300 font-black' },
}

export default function CosmeticsAdminPage() {
  const [secret, setSecret] = useState('')
  const [data, setData] = useState<AdminData | null>(null)
  const [loading, setLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [playerId, setPlayerId] = useState('')
  const [playerSearch, setPlayerSearch] = useState('')
  const [selectedSlot, setSelectedSlot] = useState<string>('all')
  const [selectedRarity, setSelectedRarity] = useState<string>('all')
  const [selectedCollection, setSelectedCollection] = useState<string>('all')
  const [ownershipFilter, setOwnershipFilter] = useState<'all' | 'owned' | 'unowned'>('all')
  const [itemQuery, setItemQuery] = useState('')
  const [selectedCosmeticId, setSelectedCosmeticId] = useState('')
  const [amount, setAmount] = useState('')
  const [price, setPrice] = useState('')
  const [limitedLabel, setLimitedLabel] = useState('')
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'info' | 'success' | 'error'>('info')

  async function load(value = secret) {
    setLoading(true)
    try {
      const response = await fetch('/api/admin/cosmetics', { headers: { 'x-race-secret': value } })
      const next = await response.json()
      setData(next)
      if (!response.ok) {
        setMessage(next.error || 'Lỗi tải dữ liệu')
        setMessageType('error')
      }
    } catch {
      setMessage('Không thể kết nối máy chủ')
      setMessageType('error')
    } finally {
      setLoading(false)
    }
  }

  async function act(body: Record<string, unknown>, successMsg = 'Đã cập nhật thành công.') {
    setActionLoading(true)
    try {
      const response = await fetch('/api/admin/cosmetics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-race-secret': secret },
        body: JSON.stringify(body),
      })
      const result = await response.json()
      if (response.ok) {
        setMessage(successMsg)
        setMessageType('success')
        await load()
      } else {
        setMessage(result.error || 'Thao tác thất bại')
        setMessageType('error')
      }
    } catch {
      setMessage('Lỗi mạng khi thực hiện thao tác')
      setMessageType('error')
    } finally {
      setActionLoading(false)
    }
  }

  useEffect(() => {
    const saved = window.localStorage.getItem('autoduck-season3-secret') ?? ''
    if (saved) {
      setSecret(saved)
      void load(saved)
    }
  }, [])

  const selectedPlayer = data?.players.find((p) => String(p.id) === playerId)
  const ownedSet = useMemo(() => new Set(selectedPlayer?.ownedCosmeticIds ?? []), [selectedPlayer])

  const collections = useMemo(() => {
    if (!data?.catalog) return []
    return [...new Set(data.catalog.flatMap((item) => (item.collection ? [item.collection] : [])))].sort()
  }, [data?.catalog])

  const slotCounts = useMemo(() => {
    const map = new Map<string, { total: number; owned: number }>()
    if (!data?.catalog) return map
    for (const item of data.catalog) {
      const current = map.get(item.slot) ?? { total: 0, owned: 0 }
      current.total += 1
      if (ownedSet.has(item.id)) current.owned += 1
      map.set(item.slot, current)
    }
    return map
  }, [data?.catalog, ownedSet])

  const filteredCatalog = useMemo(() => {
    if (!data?.catalog) return []
    const q = itemQuery.trim().toLowerCase()
    return data.catalog.filter((item) => {
      if (selectedSlot !== 'all' && item.slot !== selectedSlot) return false
      if (selectedRarity !== 'all' && item.rarity !== selectedRarity) return false
      if (selectedCollection !== 'all' && item.collection !== selectedCollection) return false
      if (ownershipFilter === 'owned' && !ownedSet.has(item.id)) return false
      if (ownershipFilter === 'unowned' && ownedSet.has(item.id)) return false
      if (q) {
        const matchText = `${item.name} ${item.id} ${item.collection ?? ''} ${item.tags.join(' ')}`.toLowerCase()
        if (!matchText.includes(q)) return false
      }
      return true
    })
  }, [data?.catalog, selectedSlot, selectedRarity, selectedCollection, ownershipFilter, ownedSet, itemQuery])

  const filteredPlayers = useMemo(() => {
    if (!data?.players) return []
    const q = playerSearch.trim().toLowerCase()
    if (!q) return data.players
    return data.players.filter((p) => p.name.toLowerCase().includes(q) || String(p.id).includes(q))
  }, [data?.players, playerSearch])

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 text-white">
      {/* HEADER */}
      <header className="rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] p-6 shadow-[0_8px_0_var(--color-ggd-outline)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-black tracking-[0.25em] text-[var(--color-ggd-gold)] uppercase">Ban Tổ Chức · Host Control</div>
            <h1 className="mt-1 font-display text-3xl sm:text-4xl">🪙 Quản Lý Quack Points & Tủ Đồ</h1>
            <p className="mt-1 text-sm text-white/70">Cấp phát & thu hồi vật phẩm toàn diện, mở khóa trọn bộ theo type hoặc full tủ đồ, điều chỉnh QP và cấu hình Shop.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/season-3" className="rounded-xl border-2 border-white/20 bg-white/5 px-4 py-2.5 text-xs font-black text-white hover:bg-white/10 transition">
              🦆 QUẢN LÝ SEASON 3
            </Link>
            <Link href="/season-3" className="rounded-xl border-2 border-white/20 bg-white/5 px-4 py-2.5 text-xs font-black text-white hover:bg-white/10 transition">
              🏠 TRANG CHỦ S3
            </Link>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-white/10 pt-4">
          <input
            type="password"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            placeholder="Nhập RACE_SECRET_KEY..."
            className="w-64 rounded-xl border-2 border-white/20 bg-black/30 px-4 py-2.5 text-sm focus:border-[var(--color-ggd-gold)] focus:outline-none"
          />
          <button
            onClick={() => {
              window.localStorage.setItem('autoduck-season3-secret', secret)
              void load()
            }}
            disabled={loading}
            className="rounded-xl bg-[var(--color-ggd-neon-green)] px-5 py-2.5 font-black text-xs sm:text-sm text-[var(--color-ggd-outline)] transition-transform hover:scale-105 disabled:opacity-50"
          >
            {loading ? 'ĐANG TẢI...' : '🔄 TẢI DỮ LIỆU'}
          </button>
        </div>

        {message && (
          <div
            className={`mt-4 rounded-xl p-3 text-sm font-bold flex items-center justify-between ${
              messageType === 'success'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                : messageType === 'error'
                ? 'bg-red-500/20 text-red-300 border border-red-500/40'
                : 'bg-[var(--color-ggd-gold)]/20 text-[var(--color-ggd-gold)] border border-[var(--color-ggd-gold)]/40'
            }`}
          >
            <span>{message}</span>
            <button onClick={() => setMessage('')} className="text-xs opacity-60 hover:opacity-100">✕</button>
          </div>
        )}
      </header>

      {data && (
        <>
          {/* PLAYER SELECTION & ACTION PANEL */}
          <section className="rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] p-5 shadow-[0_6px_0_var(--color-ggd-outline)] space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-2xl flex items-center gap-2">
                  <span>👥 Danh Sách Tuyển Thủ</span>
                  <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-black">{data.players.length}</span>
                </h2>
                <p className="text-xs text-white/60">Chọn tuyển thủ để mở khóa item, cộng/trừ QP hoặc mở khóa full tủ đồ 1-click.</p>
              </div>
              <input
                type="text"
                value={playerSearch}
                onChange={(e) => setPlayerSearch(e.target.value)}
                placeholder="🔍 Tìm tên tuyển thủ..."
                className="rounded-xl border border-white/20 bg-black/30 px-3 py-1.5 text-xs focus:border-[var(--color-ggd-gold)] focus:outline-none w-48"
              />
            </div>

            {/* Players Grid */}
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4 max-h-56 overflow-y-auto pr-1">
              {filteredPlayers.map((player) => {
                const isSelected = playerId === String(player.id)
                const totalCatalog = data.catalog.length || 1
                const owned = player.ownedCosmeticIds?.length ?? player.collectionCount
                const percent = Math.round((owned / totalCatalog) * 100)

                return (
                  <button
                    type="button"
                    onClick={() => {
                      setPlayerId(String(player.id))
                      setMessage('')
                    }}
                    key={player.id}
                    className={`rounded-2xl border-2 p-3 text-left transition-all ${
                      isSelected
                        ? 'border-[var(--color-ggd-gold)] bg-[var(--color-ggd-gold)]/15 shadow-[0_0_15px_rgba(255,215,0,0.25)] scale-[1.02]'
                        : 'border-white/10 bg-black/20 hover:border-white/30 hover:bg-black/30'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-black text-sm truncate">{player.name}</span>
                      <span className="text-xs font-bold text-[var(--color-ggd-gold)]">🪙 {player.quackPoints}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[11px] text-white/60">
                      <span>🎒 {owned} / {totalCatalog} món</span>
                      <span className="font-bold">{percent}%</span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                      <div
                        className={`h-full rounded-full ${percent === 100 ? 'bg-[var(--color-ggd-gold)]' : 'bg-[var(--color-ggd-neon-green)]'}`}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </button>
                )
              })}
            </div>

            {/* Selected Player Power Controls */}
            {selectedPlayer && (
              <div className="rounded-2xl border-2 border-[var(--color-ggd-gold)]/40 bg-[var(--color-ggd-gold)]/5 p-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">👑</span>
                    <div>
                      <div className="font-black text-lg text-[var(--color-ggd-gold)]">
                        {selectedPlayer.name} (ID: {selectedPlayer.id})
                      </div>
                      <div className="text-xs text-white/70">
                        Số dư: <b className="text-[var(--color-ggd-gold)]">🪙 {selectedPlayer.quackPoints} QP</b> · Đã sở hữu:{' '}
                        <b className="text-emerald-400">
                          {selectedPlayer.ownedCosmeticIds?.length ?? selectedPlayer.collectionCount} / {data.catalog.length} món
                        </b>
                      </div>
                    </div>
                  </div>

                  {/* HIGH-IMPACT BUTTONS: ENABLE ALL & BULK ACTIONS */}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      disabled={actionLoading}
                      onClick={() => {
                        if (window.confirm(`Xác nhận MỞ KHÓA TOÀN BỘ ${data.catalog.length} VẬT PHẨM cho ${selectedPlayer.name}?`)) {
                          void act({ action: 'grant-all', playerId: selectedPlayer.id }, `Đã mở khóa FULL ${data.catalog.length} món cho ${selectedPlayer.name}!`)
                        }
                      }}
                      className="rounded-xl bg-gradient-to-r from-amber-400 to-amber-600 px-4 py-2.5 text-xs font-black text-black shadow-lg shadow-amber-500/25 transition-transform hover:scale-105 active:scale-95 disabled:opacity-50 flex items-center gap-1.5"
                    >
                      <span>🌟</span>
                      <span>MỞ KHÓA TẤT CẢ (ENABLE ALL - {data.catalog.length} ITEMS)</span>
                    </button>

                    {selectedSlot !== 'all' && (
                      <button
                        disabled={actionLoading}
                        onClick={() => {
                          const count = data.catalog.filter((i) => i.slot === selectedSlot).length
                          const slotLabel = SLOT_MAP[selectedSlot as CosmeticSlot]?.label ?? selectedSlot
                          if (window.confirm(`Mở khóa toàn bộ ${count} món thuộc loại "${slotLabel}" cho ${selectedPlayer.name}?`)) {
                            void act({ action: 'grant-all', playerId: selectedPlayer.id, slot: selectedSlot }, `Đã mở khóa toàn bộ ${count} món nhóm ${slotLabel}!`)
                          }
                        }}
                        className="rounded-xl bg-[var(--color-ggd-neon-green)] px-3 py-2 text-xs font-black text-black transition-transform hover:scale-105 active:scale-95 disabled:opacity-50"
                      >
                        ⚡ Mở khóa nhóm {SLOT_MAP[selectedSlot as CosmeticSlot]?.label ?? selectedSlot}
                      </button>
                    )}

                    <button
                      disabled={actionLoading}
                      onClick={() => {
                        if (window.confirm(`CẢNH BÁO: Bạn có chắc muốn THU HỒI TẤT CẢ vật phẩm của ${selectedPlayer.name}?`)) {
                          void act({ action: 'revoke-all', playerId: selectedPlayer.id }, `Đã thu hồi toàn bộ đồ của ${selectedPlayer.name}.`)
                        }
                      }}
                      className="rounded-xl border border-red-500/40 bg-red-500/15 px-3 py-2 text-xs font-black text-red-300 hover:bg-red-500/30 transition disabled:opacity-50"
                    >
                      🗑️ Thu hồi tất cả
                    </button>
                  </div>
                </div>

                {/* Adjust Quack Points */}
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-bold text-white/60">ĐIỀU CHỈNH QP:</span>
                  <div className="flex items-center gap-1">
                    <input
                      value={amount}
                      onChange={(event) => setAmount(event.target.value)}
                      type="number"
                      placeholder="Số lượng (+/-)"
                      className="w-28 rounded-xl border border-white/20 bg-black/40 px-3 py-1.5 text-xs focus:border-[var(--color-ggd-gold)] focus:outline-none"
                    />
                    <button
                      disabled={!amount || actionLoading}
                      onClick={() => void act({ action: 'adjust-qp', playerId: selectedPlayer.id, amount: Number(amount) })}
                      className="rounded-xl bg-[var(--color-ggd-gold)] px-3 py-1.5 font-black text-black disabled:opacity-40 hover:scale-105 transition"
                    >
                      LƯU QP
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {[100, 500, 1000, 5000].map((val) => (
                      <button
                        key={val}
                        disabled={actionLoading}
                        onClick={() => void act({ action: 'adjust-qp', playerId: selectedPlayer.id, amount: val }, `Đã cộng +${val} QP!`)}
                        className="rounded-lg bg-white/10 px-2.5 py-1 font-bold text-emerald-300 hover:bg-white/20 transition"
                      >
                        +{val}
                      </button>
                    ))}
                    {[-500, -1000].map((val) => (
                      <button
                        key={val}
                        disabled={actionLoading}
                        onClick={() => void act({ action: 'adjust-qp', playerId: selectedPlayer.id, amount: val }, `Đã trừ ${val} QP!`)}
                        className="rounded-lg bg-white/10 px-2.5 py-1 font-bold text-red-300 hover:bg-white/20 transition"
                      >
                        {val}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* COSMETICS BROWSER & GIFTING (CHIA THEO TYPE) */}
          <section className="rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-surface-2)] p-5 shadow-[0_6px_0_var(--color-ggd-outline)] space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-2xl flex items-center gap-2">
                  <span>🎒 Kho Vật Phẩm Tủ Đồ</span>
                  <span className="rounded-full bg-[var(--color-ggd-gold)] px-2.5 py-0.5 text-xs font-black text-black">
                    {filteredCatalog.length} / {data.catalog.length} món
                  </span>
                </h2>
                <p className="text-xs text-white/60">Phân loại theo từng Type/Slot rõ ràng, nhấp tặng trực tiếp từng món hoặc mở khóa hàng loạt.</p>
              </div>

              {/* Quick Search & Filters */}
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={itemQuery}
                  onChange={(e) => setItemQuery(e.target.value)}
                  placeholder="🔍 Tìm tên hoặc ID item..."
                  className="rounded-xl border border-white/20 bg-black/40 px-3 py-1.5 text-xs focus:border-[var(--color-ggd-gold)] focus:outline-none w-48"
                />

                <select
                  value={selectedRarity}
                  onChange={(e) => setSelectedRarity(e.target.value)}
                  className="rounded-xl border border-white/20 bg-[#17102c] px-3 py-1.5 text-xs focus:outline-none"
                >
                  <option value="all">⭐ Tất cả phẩm cấp</option>
                  {Object.entries(RARITY_MAP).map(([r, info]) => (
                    <option key={r} value={r}>{info.label}</option>
                  ))}
                </select>

                <select
                  value={selectedCollection}
                  onChange={(e) => setSelectedCollection(e.target.value)}
                  className="rounded-xl border border-white/20 bg-[#17102c] px-3 py-1.5 text-xs focus:outline-none"
                >
                  <option value="all">📦 Tất cả bộ sưu tập</option>
                  {collections.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>

                {selectedPlayer && (
                  <select
                    value={ownershipFilter}
                    onChange={(e) => setOwnershipFilter(e.target.value as 'all' | 'owned' | 'unowned')}
                    className="rounded-xl border border-white/20 bg-[#17102c] px-3 py-1.5 text-xs focus:outline-none font-bold text-[var(--color-ggd-gold)]"
                  >
                    <option value="all">Tất cả trạng thái</option>
                    <option value="owned">✅ Đã có ({ownedSet.size})</option>
                    <option value="unowned">🔒 Chưa có ({data.catalog.length - ownedSet.size})</option>
                  </select>
                )}
              </div>
            </div>

            {/* TYPE / SLOT TABS */}
            <div className="flex flex-wrap gap-1.5 border-b border-white/10 pb-3">
              <button
                onClick={() => setSelectedSlot('all')}
                className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-black transition ${
                  selectedSlot === 'all'
                    ? 'bg-[var(--color-ggd-gold)] text-black shadow-md'
                    : 'bg-white/5 text-white/70 hover:bg-white/10 hover:text-white'
                }`}
              >
                <span>🌈</span>
                <span>Tất cả</span>
                <span className="rounded-full bg-black/20 px-1.5 py-0.2 text-[10px]">{data.catalog.length}</span>
              </button>

              {Object.entries(SLOT_MAP).map(([slotKey, info]) => {
                const isCurrent = selectedSlot === slotKey
                const counts = slotCounts.get(slotKey) ?? { total: 0, owned: 0 }

                return (
                  <button
                    key={slotKey}
                    onClick={() => setSelectedSlot(slotKey)}
                    className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-black transition ${
                      isCurrent
                        ? 'bg-[var(--color-ggd-neon-green)] text-black shadow-md'
                        : 'bg-white/5 text-white/70 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    <span>{info.icon}</span>
                    <span>{info.label}</span>
                    <span className="rounded-full bg-black/20 px-1.5 py-0.2 text-[10px]">
                      {selectedPlayer ? `${counts.owned}/${counts.total}` : counts.total}
                    </span>
                  </button>
                )
              })}
            </div>

            {/* ITEMS GRID */}
            {filteredCatalog.length === 0 ? (
              <div className="py-12 text-center text-sm text-white/40">
                Không tìm thấy vật phẩm nào phù hợp với bộ lọc hiện tại.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 max-h-[38rem] overflow-y-auto pr-1">
                {filteredCatalog.map((item) => {
                  const isOwned = ownedSet.has(item.id)
                  const slotInfo = SLOT_MAP[item.slot] ?? { label: item.slot, icon: '📦' }
                  const rarityInfo = RARITY_MAP[item.rarity] ?? RARITY_MAP.common
                  const isSelectedForConfig = selectedCosmeticId === item.id

                  return (
                    <div
                      key={item.id}
                      className={`group relative flex flex-col justify-between overflow-hidden rounded-2xl border-2 transition-all ${rarityInfo.border} ${
                        isSelectedForConfig ? 'ring-2 ring-[var(--color-ggd-gold)]' : ''
                      } ${isOwned ? 'bg-emerald-950/20' : 'bg-black/30'}`}
                    >
                      {/* Top Badges */}
                      <div className="flex items-center justify-between p-2 pb-0 text-[10px] z-10">
                        <span className={`rounded px-1.5 py-0.5 font-bold uppercase ${rarityInfo.badge}`}>
                          {item.rarity}
                        </span>
                        <span className="rounded bg-black/40 px-1.5 py-0.5 font-bold text-white/70" title={slotInfo.label}>
                          {slotInfo.icon}
                        </span>
                      </div>

                      {/* Image Preview */}
                      <div className="relative my-2 flex aspect-square items-center justify-center p-3">
                        <img
                          src={item.previewAsset || item.asset}
                          alt={item.name}
                          className="max-h-full max-w-full object-contain drop-shadow-[0_4px_8px_rgba(0,0,0,0.5)] transition-transform group-hover:scale-110"
                          loading="lazy"
                        />
                        {selectedPlayer && isOwned && (
                          <div className="absolute top-1 right-1 rounded-full bg-emerald-500 p-0.5 shadow-md">
                            <span className="text-[10px] leading-none block">✓</span>
                          </div>
                        )}
                      </div>

                      {/* Item Info */}
                      <div className="p-2.5 pt-0">
                        <div className="truncate font-black text-xs" title={item.name}>{item.name}</div>
                        <div className="truncate text-[10px] text-white/40">{item.collection ?? item.id}</div>

                        {/* Action Buttons */}
                        <div className="mt-2 flex flex-col gap-1">
                          {selectedPlayer ? (
                            isOwned ? (
                              <button
                                disabled={actionLoading}
                                onClick={() => void act({ action: 'revoke', playerId: selectedPlayer.id, cosmeticId: item.id }, `Đã thu hồi ${item.name}`)}
                                className="w-full rounded-lg border border-red-500/40 bg-red-500/20 py-1 text-[11px] font-black text-red-200 hover:bg-red-500/40 transition disabled:opacity-40"
                              >
                                ✕ Thu Hồi
                              </button>
                            ) : (
                              <button
                                disabled={actionLoading}
                                onClick={() => void act({ action: 'grant', playerId: selectedPlayer.id, cosmeticId: item.id }, `Đã tặng ${item.name} cho ${selectedPlayer.name}!`)}
                                className="w-full rounded-lg bg-[var(--color-ggd-neon-green)] py-1 text-[11px] font-black text-black hover:scale-102 active:scale-98 transition disabled:opacity-40"
                              >
                                🎁 Tặng Item
                              </button>
                            )
                          ) : (
                            <button
                              onClick={() => {
                                setSelectedCosmeticId(item.id)
                                setMessage(`Đã chọn "${item.name}" để cấu hình Shop/Gacha`)
                                setMessageType('info')
                              }}
                              className="w-full rounded-lg bg-white/10 py-1 text-[10px] font-bold text-white/70 hover:bg-white/20 transition"
                            >
                              ⚙️ Cấu hình
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* ITEM CONFIGURATION FOR SHOP/GACHA */}
            <div className="mt-6 rounded-2xl border-2 border-white/10 bg-black/40 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-black uppercase tracking-wider text-[var(--color-ggd-lavender)]">
                  ⚙️ Cấu hình Shop & Gacha cho Item
                </span>
                {selectedCosmeticId && (
                  <span className="text-xs font-bold text-[var(--color-ggd-gold)]">
                    Đang chọn: {data.catalog.find((i) => i.id === selectedCosmeticId)?.name ?? selectedCosmeticId}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={selectedCosmeticId}
                  onChange={(e) => setSelectedCosmeticId(e.target.value)}
                  className="max-w-xs rounded-xl border border-white/20 bg-[#17102c] px-3 py-2 text-xs focus:outline-none"
                >
                  <option value="">-- Chọn item cần chỉnh Shop/Gacha --</option>
                  {Object.entries(SLOT_MAP).map(([slotKey, info]) => (
                    <optgroup key={slotKey} label={`${info.icon} ${info.label}`}>
                      {data.catalog
                        .filter((item) => item.slot === slotKey)
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name} ({item.rarity})
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </select>

                <button
                  disabled={!selectedCosmeticId || actionLoading}
                  onClick={() => void act({ action: 'configure', cosmeticId: selectedCosmeticId, enabled: false }, 'Đã tạm ẩn item')}
                  className="rounded-xl border border-white/20 px-3 py-2 text-xs font-bold hover:bg-white/10 disabled:opacity-40"
                >
                  Tạm Ẩn
                </button>
                <button
                  disabled={!selectedCosmeticId || actionLoading}
                  onClick={() => void act({ action: 'configure', cosmeticId: selectedCosmeticId, enabled: true, shopEligible: true, gachaEligible: true }, 'Đã bật Shop & Gacha')}
                  className="rounded-xl border border-white/20 px-3 py-2 text-xs font-bold hover:bg-white/10 disabled:opacity-40"
                >
                  Bật Shop & Gacha
                </button>
                <input
                  value={price}
                  onChange={(event) => setPrice(event.target.value)}
                  type="number"
                  placeholder="Giá QP..."
                  className="w-24 rounded-xl border border-white/20 bg-black/40 px-3 py-2 text-xs focus:outline-none"
                />
                <input
                  value={limitedLabel}
                  onChange={(event) => setLimitedLabel(event.target.value)}
                  placeholder="Nhãn Limited..."
                  className="w-32 rounded-xl border border-white/20 bg-black/40 px-3 py-2 text-xs focus:outline-none"
                />
                <button
                  disabled={!selectedCosmeticId || actionLoading}
                  onClick={() => void act({ action: 'configure', cosmeticId: selectedCosmeticId, priceOverride: price ? Number(price) : null, limitedLabel: limitedLabel || null }, 'Đã lưu cấu hình giá!')}
                  className="rounded-xl bg-[var(--color-ggd-lavender)] px-4 py-2 text-xs font-black text-black disabled:opacity-40 hover:scale-105 transition"
                >
                  Lưu Cấu Hình
                </button>
              </div>
            </div>
          </section>

          {/* AUDIT LOG & TRANSACTION LOG */}
          <section className="rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] p-5 shadow-[0_6px_0_var(--color-ggd-outline)]">
            <h2 className="font-display text-2xl flex items-center gap-2">
              <span>📜 Nhật Ký Giao Dịch & Biến Động Điểm</span>
              <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-black">{data.transactions.length}</span>
            </h2>
            <div className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-2">
              {data.transactions.map((item) => (
                <div key={item.id} className="flex items-center justify-between rounded-xl bg-black/20 px-4 py-2.5 text-xs">
                  <span className="text-white/80">{item.reason}</span>
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
