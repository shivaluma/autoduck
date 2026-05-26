'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { DRAGON_STARS, DRAGON_SYSTEM_TITLE, getDragonOrbName } from '@/lib/dragon/naming'
import { DragonCompassCard, DragonOrbSlot, type DragonStateData } from '@/components/dragon/dragon-widgets'

type DragonTradeRow = {
  id: number
  proposerId: number
  requestedStar: number
  offeredOrbId: number
  message?: string | null
}

export default function DragonPage() {
  const [dragon, setDragon] = useState<DragonStateData | null>(null)
  const [actorUserId, setActorUserId] = useState('')
  const [offeredOrbId, setOfferedOrbId] = useState('')
  const [requestedStar, setRequestedStar] = useState('1')
  const [message, setMessage] = useState('')
  const [notice, setNotice] = useState('')

  const loadDragon = async () => {
    const response = await fetch('/api/dragon', { cache: 'no-store' })
    setDragon(await response.json())
  }

  useEffect(() => {
    let cancelled = false
    fetch('/api/dragon', { cache: 'no-store' })
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled) setDragon(data)
      })
      .catch(() => {
        if (!cancelled) setDragon(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const selectedActorId = actorUserId || (dragon?.users[0] ? String(dragon.users[0].id) : '')
  const actor = dragon?.users.find((user) => String(user.id) === selectedActorId) ?? null
  const actorOrbs = useMemo(() => {
    if (!actor) return []
    return DRAGON_STARS.flatMap((star) => actor.inventory.stars[String(star)]?.orbs.map((orb) => ({ ...orb, star })) ?? [])
  }, [actor])

  const postAction = async (payload: Record<string, unknown>) => {
    const response = await fetch('/api/dragon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await response.json()
    setNotice(response.ok ? '✅ Xong' : data.reason || data.error || 'Có lỗi')
    await loadDragon()
  }

  const createTrade = async () => {
    if (!actor || !offeredOrbId) return
    await postAction({
      action: 'createTrade',
      proposerId: actor.id,
      offeredOrbId: Number(offeredOrbId),
      requestedStar: Number(requestedStar),
      message,
    })
    setOfferedOrbId('')
    setMessage('')
  }

  const summon = async (userId: number) => {
    await postAction({ action: 'summon', userId, actorUserId: userId })
  }

  const acceptTrade = async (trade: DragonTradeRow) => {
    if (!actor) return
    const acceptedOrb = actorOrbs.find((orb) => orb.star === trade.requestedStar)
    if (!acceptedOrb) return
    if (!window.confirm('Khớp Kèo Đổi Châu 1 đổi 1?')) return
    await postAction({ action: 'acceptTrade', tradeId: trade.id, accepterId: actor.id, acceptedOrbId: acceptedOrb.id })
  }

  return (
    <div className="min-h-screen bg-transparent bubble-bg text-white">
      <div className="neon-divider" />
      <header className="border-b-4 border-[var(--color-ggd-outline)]">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <Link href="/" className="font-data text-sm text-[var(--color-ggd-muted)] hover:text-white">← Về Chuồng</Link>
          <h1 className="font-display text-4xl text-[var(--color-ggd-gold)] text-outlined">{DRAGON_SYSTEM_TITLE}</h1>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <DragonCompassCard dragon={dragon} />

        <section className="grid gap-6 lg:grid-cols-[1fr_0.95fr]">
          <div className="ggd-card p-5">
            <div className="font-display text-3xl text-white text-outlined">Tàng Châu Các</div>
            <div className="mt-4 space-y-4">
              {(dragon?.users ?? []).map((user) => (
                <article key={user.id} className="rounded-xl border-3 border-[var(--color-ggd-outline)] bg-black/22 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-body text-lg font-black">{user.name}</div>
                      <div className="font-data text-xs text-white/55">Progress {user.inventory.progress}/7</div>
                    </div>
                    {user.inventory.summonReady && (
                      <button
                        onClick={() => summon(user.id)}
                        className="ggd-btn bg-[var(--color-ggd-gold)] px-4 py-2 text-xs text-[var(--color-ggd-outline)]"
                      >
                        Khai Môn Triệu Long
                      </button>
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {DRAGON_STARS.map((star) => (
                      <DragonOrbSlot key={star} star={star} count={user.inventory.stars[String(star)]?.count ?? 0} />
                    ))}
                  </div>
                  <div className="mt-3 grid gap-2 font-data text-xs text-white/65 sm:grid-cols-2">
                    <div>Thiếu: {user.inventory.missingStars.length ? user.inventory.missingStars.map(getDragonOrbName).join(', ') : 'Đủ bộ'}</div>
                    <div>Trade lock: {user.inventory.tradeLockedOrbs?.length ?? 0}</div>
                    <div>{user.inventory.activeScaleItem ? 'Đang giữ Long Lân Hộ Mệnh.' : 'Chưa có Long Lân.'}</div>
                    <div>{user.inventory.equippedScaleItem ? 'Long Lân đã nhập trận.' : 'Chưa equip Long Lân.'}</div>
                  </div>
                  {user.inventory.claimBlocked && (
                    <p className="mt-3 rounded-lg border-2 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-orange)]/22 p-3 font-readable text-sm text-white/82">
                      {user.inventory.blockedReason}
                    </p>
                  )}
                </article>
              ))}
            </div>
          </div>

          <div className="space-y-6">
            <section className="ggd-card-gold p-5">
              <div className="font-display text-3xl text-[var(--color-ggd-gold)] text-outlined">Sàn Đổi Châu</div>
              <div className="mt-4 space-y-3">
                <label className="block">
                  <span className="ggd-col-header">Người thao tác</span>
                  <select value={selectedActorId} onChange={(event) => setActorUserId(event.target.value)} className="mt-1 w-full rounded-xl border-3 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-surface)] px-3 py-2 font-bold text-white">
                    {(dragon?.users ?? []).map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
                  </select>
                </label>

                <div className="rounded-xl border-3 border-[var(--color-ggd-outline)] bg-black/20 p-4">
                  <div className="font-display text-xl text-white text-outlined">Kèo Đổi Châu của tôi</div>
                  <div className="mt-3 grid gap-3">
                    <select value={offeredOrbId} onChange={(event) => setOfferedOrbId(event.target.value)} className="rounded-xl border-3 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-surface)] px-3 py-2 text-white">
                      <option value="">Chọn viên đem đổi</option>
                      {actorOrbs.map((orb) => <option key={orb.id} value={orb.id}>#{orb.id} {getDragonOrbName(orb.star)}</option>)}
                    </select>
                    <select value={requestedStar} onChange={(event) => setRequestedStar(event.target.value)} className="rounded-xl border-3 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-surface)] px-3 py-2 text-white">
                      {DRAGON_STARS.map((star) => <option key={star} value={star}>Cần {getDragonOrbName(star)}</option>)}
                    </select>
                    <input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Lời nhắn optional" className="rounded-xl border-3 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-surface)] px-3 py-2 text-white placeholder:text-white/35" />
                    <button onClick={createTrade} disabled={!offeredOrbId} className="ggd-btn bg-[var(--color-ggd-neon-green)] px-4 py-2 text-sm text-[var(--color-ggd-outline)] disabled:opacity-40">
                      Tạo Kèo Đổi Châu
                    </button>
                  </div>
                </div>

                {((dragon?.trades ?? []) as DragonTradeRow[]).map((trade) => {
                  const canAccept = actorOrbs.some((orb) => orb.star === trade.requestedStar) && actor?.id !== trade.proposerId
                  return (
                    <div key={trade.id} className="rounded-xl border-3 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] p-4">
                      <div className="font-data text-xs text-white/55">Kèo #{trade.id}</div>
                      <div className="font-readable text-sm text-white/80">
                        Offer orb #{trade.offeredOrbId} · cần {getDragonOrbName(trade.requestedStar)}
                      </div>
                      {trade.message && <div className="mt-1 font-readable text-xs text-white/58">{trade.message}</div>}
                      <button
                        disabled={!canAccept}
                        onClick={() => acceptTrade(trade)}
                        className="mt-3 ggd-btn bg-[var(--color-ggd-gold)] px-3 py-2 text-xs text-[var(--color-ggd-outline)] disabled:opacity-35"
                      >
                        Accept
                      </button>
                    </div>
                  )
                })}
              </div>
            </section>

            <section className="ggd-card p-5">
              <div className="font-display text-2xl text-white text-outlined">Long Điện Vinh Danh</div>
              <div className="mt-3 space-y-2 font-readable text-sm text-white/72">
                {(dragon?.recentItemEvents ?? []).filter((event) => event.type === 'GRANTED').slice(0, 6).map((event) => (
                  <div key={event.id} className="rounded-lg bg-black/20 p-3">{event.message}</div>
                ))}
              </div>
            </section>
          </div>
        </section>

        <section className="ggd-card p-5">
          <div className="font-display text-2xl text-white text-outlined">Dragon Event History</div>
          <div className="mt-4 grid gap-2 md:grid-cols-2">
            {[...(dragon?.recentOrbEvents ?? []), ...(dragon?.recentItemEvents ?? [])].slice(0, 20).map((event) => (
              <div key={`${event.type}-${event.id}`} className="rounded-lg border-2 border-[var(--color-ggd-outline)]/35 bg-black/18 p-3 font-readable text-sm text-white/70">
                {event.message ?? event.type}
              </div>
            ))}
          </div>
        </section>

        <section className="ggd-card-green p-5">
          <div className="font-display text-2xl text-white text-outlined">Rules summary</div>
          <p className="mt-3 font-readable text-sm leading-relaxed text-white/75">
            Mỗi official race rơi đúng một Long Châu theo vòng 1 đến 7. Duplicate giữ lại để đổi 1-for-1. Đủ bảy viên thì Khai Môn Triệu Long nhận Long Lân Hộ Mệnh, item không decay và chỉ mất khi thật sự cứu chủ nhân.
          </p>
        </section>

        {notice && <div className="fixed bottom-4 right-4 ggd-card px-5 py-3 font-display">{notice}</div>}
      </main>
    </div>
  )
}
