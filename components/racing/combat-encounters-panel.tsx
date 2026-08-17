'use client'

import { useMemo, useState } from 'react'
import type { RaceEvent } from '@/packages/race-protocol/src'
import { Season3Avatar } from '@/components/season3-avatar'
import {
  extractCombatEncounters,
  type CombatPlayerRef,
  type CombatEncounter,
  type PlayerCombatSummary,
} from '@/lib/racing/combat-encounters'

export function CombatEncountersPanel({
  events,
  players,
}: {
  events: RaceEvent[]
  players: CombatPlayerRef[]
}) {
  const [filterAttacker, setFilterAttacker] = useState<string>('all')
  const [filterTarget, setFilterTarget] = useState<string>('all')
  const [filterOutcome, setFilterOutcome] = useState<'all' | 'hit' | 'blocked'>('all')
  const [filterWeapon, setFilterWeapon] = useState<string>('all')
  const [viewTab, setViewTab] = useState<'feed' | 'matrix' | 'leaderboard'>('feed')

  const analytics = useMemo(() => extractCombatEncounters(events, players), [events, players])
  const nameById = useMemo(() => new Map(players.map((p) => [p.playerId, p.name])), [players])

  const filteredEncounters = useMemo(() => {
    return analytics.encounters.filter((enc) => {
      if (filterAttacker !== 'all' && enc.attackerId !== filterAttacker) return false
      if (filterTarget !== 'all' && enc.targetId !== filterTarget) return false
      if (filterOutcome === 'hit' && !enc.success) return false
      if (filterOutcome === 'blocked' && enc.success) return false
      if (filterWeapon !== 'all' && !enc.weapon.includes(filterWeapon)) return false
      return true
    })
  }, [analytics.encounters, filterAttacker, filterTarget, filterOutcome, filterWeapon])

  if (analytics.totalAttacks === 0) {
    return (
      <section className="rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] p-6 text-center shadow-[0_6px_0_var(--color-ggd-outline)]">
        <div className="text-4xl">🕊️</div>
        <div className="mt-2 font-display text-2xl text-[var(--color-ggd-gold)]">NHẬT KÝ ĐỐI ĐẦU & TẤN CÔNG</div>
        <p className="mt-2 text-sm text-white/60">
          Chặng đua này không có đòn tấn công nào được tung ra — một cuộc đua tốc độ thuần túy trong hòa bình!
        </p>
      </section>
    )
  }

  return (
    <section className="rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] p-5 text-white shadow-[0_6px_0_var(--color-ggd-outline)] sm:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-white/10 pb-4">
        <div className="flex items-center gap-3">
          <span className="text-3xl">⚔️</span>
          <div>
            <h2 className="font-display text-2xl tracking-wide text-[var(--color-ggd-gold)] sm:text-3xl">
              NHẬT KÝ TẤN CÔNG & ĐỐI ĐẦU
            </h2>
            <p className="text-xs text-white/65 sm:text-sm">
              Chi tiết ai tấn công ai, vũ khí sử dụng, kết quả trúng đích hay bị chặn bởi Khiên / Lông Vũ.
            </p>
          </div>
        </div>

        {/* View Tabs */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setViewTab('feed')}
            className={`rounded-xl px-3 py-1.5 text-xs font-black transition sm:text-sm ${
              viewTab === 'feed'
                ? 'bg-[var(--color-ggd-gold)] text-[var(--color-ggd-outline)] shadow'
                : 'bg-black/30 text-white/60 hover:text-white'
            }`}
          >
            📜 Diễn Biến ({analytics.encounters.length})
          </button>
          <button
            type="button"
            onClick={() => setViewTab('leaderboard')}
            className={`rounded-xl px-3 py-1.5 text-xs font-black transition sm:text-sm ${
              viewTab === 'leaderboard'
                ? 'bg-[var(--color-ggd-neon-green)] text-[var(--color-ggd-outline)] shadow'
                : 'bg-black/30 text-white/60 hover:text-white'
            }`}
          >
            📊 Thống Kê Tay Đua
          </button>
        </div>
      </div>

      {/* Highlights Bar */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border-2 border-white/10 bg-black/25 p-3 sm:p-4">
          <div className="text-2xl">🎯</div>
          <div className="mt-1 text-[10px] font-black uppercase tracking-wider text-white/40">Tổng Đòn Đánh</div>
          <div className="font-display text-xl text-[var(--color-ggd-gold)] sm:text-2xl">
            {analytics.totalAttacks} đòn
          </div>
          <div className="text-xs text-white/60">Tỷ lệ trúng: {analytics.overallHitRate}%</div>
        </div>

        <div className="rounded-2xl border-2 border-emerald-500/20 bg-emerald-500/10 p-3 sm:p-4">
          <div className="text-2xl">💥</div>
          <div className="mt-1 text-[10px] font-black uppercase tracking-wider text-emerald-300/60">Trúng Đích</div>
          <div className="font-display text-xl text-emerald-400 sm:text-2xl">
            {analytics.successfulHits} đòn
          </div>
          <div className="text-xs text-emerald-200/60">Gây choáng / giảm tốc</div>
        </div>

        <div className="rounded-2xl border-2 border-sky-500/20 bg-sky-500/10 p-3 sm:p-4">
          <div className="text-2xl">🛡️</div>
          <div className="mt-1 text-[10px] font-black uppercase tracking-wider text-sky-300/60">Phòng Thủ / Né</div>
          <div className="font-display text-xl text-sky-400 sm:text-2xl">
            {analytics.defendedAttacks} đòn
          </div>
          <div className="text-xs text-sky-200/60">Khiên 🫧 hoặc Lông Vũ 🪽</div>
        </div>

        <div className="rounded-2xl border-2 border-amber-500/20 bg-amber-500/10 p-3 sm:p-4">
          <div className="text-2xl">👑</div>
          <div className="mt-1 text-[10px] font-black uppercase tracking-wider text-amber-300/60">Sát Thủ Đường Đua</div>
          <div className="truncate font-display text-base text-amber-300 sm:text-lg">
            {analytics.topAttacker ? analytics.topAttacker.name : '—'}
          </div>
          <div className="text-xs text-amber-200/60">
            {analytics.topAttacker ? `${analytics.topAttacker.hits} đòn trúng đích` : 'Chưa có'}
          </div>
        </div>
      </div>

      {/* FEED VIEW */}
      {viewTab === 'feed' && (
        <div className="mt-5 space-y-4">
          {/* Filter Controls */}
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border-2 border-white/10 bg-black/30 p-3 text-xs sm:text-sm">
            <span className="font-bold text-white/50">Bộ lọc:</span>

            {/* Attacker Filter */}
            <select
              value={filterAttacker}
              onChange={(e) => setFilterAttacker(e.target.value)}
              className="rounded-xl border border-white/20 bg-black/60 px-2.5 py-1.5 font-bold text-white focus:border-[var(--color-ggd-gold)] focus:outline-none"
            >
              <option value="all">🥊 Mọi kẻ tấn công</option>
              {players.map((p) => (
                <option key={p.playerId} value={p.playerId}>
                  {p.name}
                </option>
              ))}
            </select>

            {/* Target Filter */}
            <select
              value={filterTarget}
              onChange={(e) => setFilterTarget(e.target.value)}
              className="rounded-xl border border-white/20 bg-black/60 px-2.5 py-1.5 font-bold text-white focus:border-[var(--color-ggd-gold)] focus:outline-none"
            >
              <option value="all">🎯 Mọi mục tiêu</option>
              {players.map((p) => (
                <option key={p.playerId} value={p.playerId}>
                  {p.name}
                </option>
              ))}
            </select>

            {/* Outcome Filter */}
            <select
              value={filterOutcome}
              onChange={(e) => setFilterOutcome(e.target.value as 'all' | 'hit' | 'blocked')}
              className="rounded-xl border border-white/20 bg-black/60 px-2.5 py-1.5 font-bold text-white focus:border-[var(--color-ggd-gold)] focus:outline-none"
            >
              <option value="all">✨ Tất cả kết quả</option>
              <option value="hit">💥 Chỉ Trúng Đích (Thành công)</option>
              <option value="blocked">🛡️ Chỉ Bị Chặn / Né (Thất bại)</option>
            </select>

            {/* Weapon Filter */}
            <select
              value={filterWeapon}
              onChange={(e) => setFilterWeapon(e.target.value)}
              className="rounded-xl border border-white/20 bg-black/60 px-2.5 py-1.5 font-bold text-white focus:border-[var(--color-ggd-gold)] focus:outline-none"
            >
              <option value="all">📦 Mọi vũ khí</option>
              <option value="ROCKET">🚀 Tên Lửa (Rocket)</option>
              <option value="BANANA">🍌 Vỏ Chuối (Banana)</option>
              <option value="HORN">🔊 Còi Quack Horn</option>
            </select>

            {(filterAttacker !== 'all' || filterTarget !== 'all' || filterOutcome !== 'all' || filterWeapon !== 'all') && (
              <button
                type="button"
                onClick={() => {
                  setFilterAttacker('all')
                  setFilterTarget('all')
                  setFilterOutcome('all')
                  setFilterWeapon('all')
                }}
                className="ml-auto rounded-lg bg-white/10 px-2.5 py-1 text-xs font-bold text-white/70 hover:bg-white/20 hover:text-white"
              >
                Đặt lại ↺
              </button>
            )}
          </div>

          {/* Encounters List */}
          {filteredEncounters.length === 0 ? (
            <div className="rounded-2xl border-2 border-white/10 bg-black/20 p-8 text-center text-white/50">
              Không tìm thấy pha đối đầu nào phù hợp bộ lọc.
            </div>
          ) : (
            <div className="space-y-3">
              {filteredEncounters.map((enc) => (
                <div
                  key={enc.id}
                  className={`relative overflow-hidden rounded-2xl border-2 p-4 transition ${
                    enc.success
                      ? 'border-emerald-500/30 bg-[linear-gradient(135deg,rgba(16,185,129,0.12),rgba(0,0,0,0.4))] hover:border-emerald-500/50'
                      : 'border-sky-500/30 bg-[linear-gradient(135deg,rgba(14,165,233,0.12),rgba(0,0,0,0.4))] hover:border-sky-500/50'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-2.5">
                    {/* Time Stamp */}
                    <span className="rounded-lg bg-black/50 px-2.5 py-0.5 font-mono text-xs font-black text-white/70">
                      ⏱️ {enc.timeFormatted} (tick {enc.tick})
                    </span>

                    {/* Result Badge */}
                    <div className="flex items-center gap-2">
                      {enc.success ? (
                        <span className="inline-flex items-center gap-1 rounded-xl bg-emerald-500/20 px-3 py-1 text-xs font-black text-emerald-300 border border-emerald-500/40">
                          ✅ THÀNH CÔNG (TRÚNG ĐÍCH)
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-xl bg-sky-500/20 px-3 py-1 text-xs font-black text-sky-300 border border-sky-500/40">
                          ❌ THẤT BẠI ({enc.defenseName || 'BỊ HÓA GIẢI'})
                        </span>
                      )}

                      {enc.mitigatedByShockAbsorber && (
                        <span className="inline-flex items-center gap-1 rounded-xl bg-indigo-500/20 px-2.5 py-1 text-xs font-black text-indigo-300 border border-indigo-500/30">
                          🦺 Giảm sát thương
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Combat Matchup Row */}
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3 sm:flex-nowrap">
                    {/* Attacker */}
                    <div className="flex min-w-[140px] items-center gap-2.5">
                      <Season3Avatar name={enc.attackerName} avatarUrl={enc.attackerAvatarUrl} size={36} />
                      <div>
                        <div className="text-[10px] font-black uppercase tracking-wider text-rose-300/70">Tấn công</div>
                        <div className="font-display text-base text-white">{enc.attackerName}</div>
                      </div>
                    </div>

                    {/* Weapon Action Arrow */}
                    <div className="flex flex-1 items-center justify-center gap-2 px-2">
                      <div className="flex items-center gap-1.5 rounded-xl border border-white/15 bg-black/50 px-3 py-1.5">
                        <span className="text-xl">{enc.weaponIcon}</span>
                        <span className="text-xs font-black text-[var(--color-ggd-gold)]">{enc.weaponName}</span>
                      </div>
                      <span className="font-display text-xl text-white/40">➔</span>
                    </div>

                    {/* Target */}
                    <div className="flex min-w-[140px] items-center justify-end gap-2.5 text-right sm:text-left">
                      <div className="order-2 sm:order-1">
                        <div className="text-[10px] font-black uppercase tracking-wider text-cyan-300/70">Mục tiêu</div>
                        <div className="font-display text-base text-white">{enc.targetName}</div>
                      </div>
                      <div className="order-1 sm:order-2">
                        <Season3Avatar name={enc.targetName} avatarUrl={enc.targetAvatarUrl} size={36} />
                      </div>
                    </div>
                  </div>

                  {/* Detail Outcome Description */}
                  <div className="mt-3 rounded-xl bg-black/40 px-3.5 py-2 text-xs sm:text-sm">
                    <span className="font-bold text-white/90">{enc.resultDetail}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* PLAYER COMBAT LEADERBOARD */}
      {viewTab === 'leaderboard' && (
        <div className="mt-5 space-y-3">
          <div className="rounded-2xl border-2 border-white/10 bg-black/30 p-4">
            <h3 className="font-display text-lg text-[var(--color-ggd-gold)]">
              BẢNG TỔNG HỢP HIỆU SUẤT TÁC CHIẾN CỦA TỪNG VỊT
            </h3>
            <p className="mt-1 text-xs text-white/60">
              Thống kê số lần tung đòn, độ chính xác, khả năng phòng thủ và đối thủ chạm trán nhiều nhất.
            </p>
          </div>

          <div className="overflow-hidden rounded-2xl border-2 border-white/10 bg-black/20">
            <div className="grid grid-cols-12 border-b border-white/10 bg-black/40 px-4 py-2.5 text-[11px] font-black uppercase tracking-wider text-white/40">
              <div className="col-span-4">Vịt Tay Đua</div>
              <div className="col-span-3 text-center">Tấn Công (Trúng / Tung)</div>
              <div className="col-span-3 text-center">Phòng Thủ (Né / Nhận)</div>
              <div className="col-span-2 text-right">Mục Tiêu Ưa Thích</div>
            </div>

            {analytics.playerSummaries.map((summary) => (
              <div
                key={summary.playerId}
                className="grid grid-cols-12 items-center border-b border-white/5 px-4 py-3 text-sm last:border-0 hover:bg-white/5"
              >
                {/* Player Name & Avatar */}
                <div className="col-span-4 flex items-center gap-2.5">
                  <Season3Avatar name={summary.name} avatarUrl={summary.avatarUrl} size={32} />
                  <span className="truncate font-black text-white">{summary.name}</span>
                </div>

                {/* Attack Stats */}
                <div className="col-span-3 text-center">
                  <div className="font-black text-emerald-300">
                    {summary.attacksHit}/{summary.attacksDealt} ({summary.hitRate}%)
                  </div>
                  <div className="text-[10px] text-white/40">
                    {summary.attacksBlockedByTarget} đòn bị hóa giải
                  </div>
                </div>

                {/* Defense Stats */}
                <div className="col-span-3 text-center">
                  <div className="font-black text-sky-300">
                    {summary.attacksDefended}/{summary.attacksReceived} ({summary.defenseRate}%)
                  </div>
                  <div className="text-[10px] text-white/40">
                    {summary.attacksSuffered} lần dính đòn
                  </div>
                </div>

                {/* Favorite Target / Nemesis */}
                <div className="col-span-2 text-right">
                  {summary.favoriteTarget ? (
                    <div className="truncate text-xs font-bold text-[var(--color-ggd-gold)]">
                      🎯 {summary.favoriteTarget.name} ({summary.favoriteTarget.count}x)
                    </div>
                  ) : (
                    <span className="text-xs text-white/30">—</span>
                  )}
                  {summary.nemesisAttacker && (
                    <div className="truncate text-[10px] text-rose-300/70">
                      Bị {summary.nemesisAttacker.name} nhắm ({summary.nemesisAttacker.count}x)
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
