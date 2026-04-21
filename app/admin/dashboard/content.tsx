'use client'

import Image from 'next/image'
import { startTransition, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { MYSTERY_CHESTS_ENABLED } from '@/lib/feature-flags'

interface UserRow {
  id: number
  name: string
  avatarUrl?: string
  scars: number
  shields: number
  legacyShields?: number
  activeShieldCount?: number
  shieldsUsed: number
  totalKhaos: number
  cleanStreak?: number
  isBoss?: boolean
}

interface RaceRow {
  id: number
  status: string
  createdAt: string
  finalVerdict?: string
}

interface BossRow {
  id: number
  name: string
  cleanStreak: number
  bossSince?: string | null
}

interface ShieldSeasonRow {
  id: number
  ownerId: number
  ownerName: string
  earnedAt: string
  earnedRaceId?: number | null
  weeksUnused: number
  status: string
}

interface ChestSeasonRow {
  id: number
  ownerId: number
  ownerName: string
  earnedFromRaceId: number
  effect: string
  status: string
  targetUserId?: number | null
  createdAt: string
  consumedRaceId?: number | null
  consumedAt?: string | null
  rngSeed?: string
}

interface WeeklyTickRow {
  id: number
  weekKey: string
  runAt: string
  brokenShields: number
  lostShields: number
  newBosses: number
  chestsIssued: number
  details?: string | null
}

interface SeasonData {
  bosses: BossRow[]
  activeShields: ShieldSeasonRow[]
  activeChests: ChestSeasonRow[]
  chestHistory: ChestSeasonRow[]
  weeklyTicks: WeeklyTickRow[]
}

interface Props {
  secret?: string
}

function formatAuditJson(value?: string | null) {
  if (!value) {
    return null
  }

  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}

export function AdminDashboardContent({ secret }: Props) {
  const [users, setUsers] = useState<UserRow[]>([])
  const [races, setRaces] = useState<RaceRow[]>([])
  const [season, setSeason] = useState<SeasonData | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'users' | 'races' | 'tools' | 'season'>('users')
  const [seasonTab, setSeasonTab] = useState<'boss' | 'shield' | 'active_chests' | 'chest_history' | 'weekly_tick'>('boss')
  const [shieldOwnerId, setShieldOwnerId] = useState('')
  const [shieldGrantCount, setShieldGrantCount] = useState('1')
  const [shieldWeeksUnused, setShieldWeeksUnused] = useState('0')
  const [msg, setMsg] = useState('')

  const fetchAdminData = useCallback(async () => {
    if (!secret) {
      return
    }

    const [adminResponse, seasonResponse] = await Promise.all([
      fetch(`/api/admin?secret=${secret}`),
      fetch(`/api/admin/season?secret=${secret}`),
    ])

    if (!adminResponse.ok || !seasonResponse.ok) {
      throw new Error('Unauthorized')
    }

    const adminData = await adminResponse.json()
    const seasonData = await seasonResponse.json()
    startTransition(() => {
      setUsers(adminData.users)
      setRaces(adminData.races)
      setSeason(seasonData)
    })
  }, [secret])

  useEffect(() => {
    if (!secret) {
      return
    }

    Promise.resolve(fetchAdminData())
      .then(() => {
        startTransition(() => setLoading(false))
      })
      .catch(() => {
        startTransition(() => {
          setMsg('Unauthorized')
          setLoading(false)
        })
      })
  }, [fetchAdminData, secret])

  if (!secret) {
    return (
      <div className="min-h-screen bg-transparent text-[var(--color-ggd-orange)] font-display flex items-center justify-center text-3xl text-outlined">
        🔒 CẤM VÀO!
      </div>
    )
  }

  const handleUpdateUser = async (user: UserRow) => {
    const response = await fetch(`/api/admin?secret=${secret}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'user', data: user }),
    })

    if (response.ok) {
      setMsg(`✅ ${user.name}`)
      setTimeout(() => setMsg(''), 2000)
      await fetchAdminData()
    }
  }

  const handleRecalc = async () => {
    setMsg('🧮...')
    const response = await fetch(`/api/admin?secret=${secret}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'recalc_khaos' }),
    })
    const data = await response.json()
    setMsg(data.message)
    await fetchAdminData()
  }

  const handleRunWeeklyTick = async () => {
    setMsg('🌀 Running weekly tick...')
    const response = await fetch(`/api/admin/tick?secret=${secret}`, {
      method: 'POST',
    })
    const data = await response.json()
    if (!response.ok) {
      setMsg(data.error || 'Tick failed')
      return
    }

    setMsg(`✅ Tick ${data.weekKey}: ${data.broken.length} vỡ, ${data.lost.length} mất`)
    await fetchAdminData()
  }

  const handleRerollChest = async (chestId: number) => {
    setMsg(`🎲 Reroll chest #${chestId}...`)
    const response = await fetch(`/api/admin/chests/${chestId}/reroll?secret=${secret}`, {
      method: 'POST',
    })
    const data = await response.json()
    setMsg(response.ok ? `✅ Reroll chest #${chestId}` : data.error || 'Reroll failed')
    if (response.ok) {
      await fetchAdminData()
    }
  }

  const handleCancelChest = async (chestId: number) => {
    setMsg(`🧹 Void chest #${chestId}...`)
    const response = await fetch(`/api/admin/chests/${chestId}/cancel?secret=${secret}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Cancelled from Season tab' }),
    })
    const data = await response.json()
    setMsg(response.ok ? `✅ Voided chest #${chestId}` : data.error || 'Cancel failed')
    if (response.ok) {
      await fetchAdminData()
    }
  }

  const handleDemoteBoss = async (userId: number, name: string) => {
    setMsg(`👑💔 Demoting ${name}...`)
    const response = await fetch(`/api/admin/users/${userId}/demote?secret=${secret}`, {
      method: 'POST',
    })
    const data = await response.json()
    setMsg(response.ok ? `✅ ${name} mất danh hiệu Boss` : data.error || 'Demote failed')
    if (response.ok) {
      await fetchAdminData()
    }
  }

  const handleShieldAction = async (
    shieldId: number,
    ownerName: string,
    action: 'break' | 'lose' | 'reset_age'
  ) => {
    const label = action === 'break' ? 'Force Break' : action === 'lose' ? 'Force Lose' : 'Reset Age'
    setMsg(`🛡️ ${label} #${shieldId}...`)
    const response = await fetch(`/api/admin/shields/${shieldId}?secret=${secret}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    const data = await response.json()
    setMsg(response.ok ? `✅ ${label} #${shieldId} của ${ownerName}` : data.error || `${label} failed`)
    if (response.ok) {
      await fetchAdminData()
    }
  }

  const handleGrantShield = async () => {
    if (!shieldOwnerId) {
      setMsg('Chọn vịt trước đã')
      return
    }

    setMsg('🛡️ Grant shield...')
    const response = await fetch(`/api/admin/shields?secret=${secret}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ownerId: Number(shieldOwnerId),
        count: Number(shieldGrantCount),
        weeksUnused: Number(shieldWeeksUnused),
      }),
    })
    const data = await response.json()
    setMsg(response.ok ? `✅ Added ${data.created} shield(s), active=${data.activeCount}` : data.error || 'Grant shield failed')
    if (response.ok) {
      await fetchAdminData()
    }
  }

  const handleChange = (id: number, field: keyof UserRow, value: string) => {
    setUsers(users.map((user) => (user.id === id ? { ...user, [field]: value } : user)))
  }

  return (
    <div className="min-h-screen bg-transparent bubble-bg text-white font-body p-8">
      <header className="flex justify-between items-center mb-8 border-b-[5px] border-[var(--color-ggd-outline)] pb-5">
        <h1 className="font-display text-4xl text-[var(--color-ggd-gold)] text-outlined">🦆 QUẢN LÝ BẦY VỊT ⚡</h1>
        <div className="flex gap-3">
          {(['users', 'races', 'tools', 'season'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`ggd-btn text-base px-6 py-2.5 ${
                activeTab === tab
                  ? 'bg-[var(--color-ggd-neon-green)] text-[var(--color-ggd-outline)]'
                  : 'bg-[var(--color-ggd-surface)] text-[var(--color-ggd-muted)]'
              }`}
            >
              {tab === 'users' ? '🦆 VỊT' : tab === 'races' ? '🏁 TRẬN' : tab === 'tools' ? '🔧 TOOLS' : '⚙️ SEASON'}
            </button>
          ))}
          <Link href="/" className="ggd-btn bg-[var(--color-ggd-surface)] text-[var(--color-ggd-muted)] text-base px-6 py-2.5">🚰 THOÁT</Link>
        </div>
      </header>

      {msg && (
        <div className="fixed top-4 right-4 ggd-card px-5 py-3 z-50 animate-bounce-in">
          <span className="font-display text-base">{msg}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="text-6xl animate-bob">🦆</div>
        </div>
      ) : (
        <main>
          {activeTab === 'users' && (
            <div className="overflow-x-auto ggd-card ggd-stripe">
              <div className="ggd-panel-header bg-[var(--color-ggd-neon-green)] rounded-t-[7px]">
                <span className="text-[var(--color-ggd-outline)] text-xl">🦆 Danh Sách Bầy Vịt</span>
              </div>
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b-[3px] border-black bg-[var(--color-ggd-panel)]">
                    {['ID', 'Tên', 'Avatar', 'Sẹo', 'Khiên mới', 'Đã Dùng', 'Dzịt', 'Streak', 'Boss', ''].map((header) => (
                      <th key={header} className="px-4 py-3 ggd-col-header">{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y-2 divide-black/20">
                  {users.map((user) => {
                    const activeShieldCount = user.activeShieldCount ?? 0
                    const legacyShieldCount = user.legacyShields ?? user.shields
                    const isImmortal = user.name === 'Thomas' || legacyShieldCount >= 9999
                    const hasLegacyMismatch = !isImmortal && legacyShieldCount !== activeShieldCount

                    return (
                      <tr key={user.id} className="hover:bg-[var(--color-ggd-neon-green)]/7 transition-colors">
                        <td className="px-4 py-3.5 font-data text-base text-[var(--color-ggd-muted)] font-bold">{user.id}</td>
                        <td className="px-4 py-3.5 font-black text-lg text-white flex items-center gap-2">
                          {user.avatarUrl && <Image src={user.avatarUrl} alt="" width={36} height={36} unoptimized className="w-9 h-9 rounded-full object-cover border-2 border-[var(--color-ggd-outline)]" />}
                          {user.name}
                        </td>
                        <td className="px-4 py-3.5">
                          <input
                            className="bg-transparent w-full min-w-[150px] border-b-2 border-[var(--color-ggd-outline)]/40 focus:border-[var(--color-ggd-neon-green)] text-sm text-white/70 outline-none"
                            placeholder="https://..."
                            value={user.avatarUrl || ''}
                            onChange={(event) => handleChange(user.id, 'avatarUrl', event.target.value)}
                          />
                        </td>
                        <td className="px-4 py-3.5"><input className="bg-transparent w-16 border-b-2 border-[var(--color-ggd-outline)]/40 focus:border-[var(--color-ggd-orange)] text-center outline-none font-bold text-base" value={user.scars} onChange={(event) => handleChange(user.id, 'scars', event.target.value)} /></td>
                        <td className="px-4 py-3.5 min-w-[150px]">
                          <div className="flex items-center gap-2">
                            <span className="ggd-tag bg-[var(--color-ggd-neon-green)] text-[var(--color-ggd-outline)]">
                              {isImmortal ? '∞ immortal' : `${activeShieldCount} active`}
                            </span>
                            <button
                              onClick={() => {
                                setActiveTab('season')
                                setSeasonTab('shield')
                                setShieldOwnerId(String(user.id))
                              }}
                              className="ggd-btn bg-[var(--color-ggd-surface)] text-[var(--color-ggd-muted)] text-[10px] px-2 py-1"
                            >
                              Manage
                            </button>
                          </div>
                          {hasLegacyMismatch && (
                            <div className="font-data text-[10px] text-[var(--color-ggd-orange)] mt-1">
                              legacy={legacyShieldCount}, migrate/sync needed
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3.5"><input className="bg-transparent w-16 border-b-2 border-[var(--color-ggd-outline)]/40 text-center outline-none font-bold text-base" value={user.shieldsUsed} onChange={(event) => handleChange(user.id, 'shieldsUsed', event.target.value)} /></td>
                        <td className="px-4 py-3.5 text-[var(--color-ggd-gold)] font-display text-2xl">{user.totalKhaos}</td>
                        <td className="px-4 py-3.5 text-center font-data">{user.cleanStreak ?? 0}</td>
                        <td className="px-4 py-3.5 text-center">{user.isBoss ? '👑' : '—'}</td>
                        <td className="px-4 py-3.5"><button onClick={() => handleUpdateUser(user)} className="ggd-btn text-sm bg-[var(--color-ggd-neon-green)] text-[var(--color-ggd-outline)] px-4 py-2">LƯU</button></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'races' && (
            <div className="space-y-3">
              {races.map((race) => (
                <div key={race.id} className="ggd-card p-5 flex justify-between items-center">
                  <div className="flex items-center gap-4">
                    <span className="font-display text-2xl text-[var(--color-ggd-muted)]">#{race.id}</span>
                    <span className={`ggd-tag text-sm font-black ${race.status === 'finished' ? 'bg-[var(--color-ggd-neon-green)] text-[var(--color-ggd-outline)]' : 'bg-[var(--color-ggd-orange)] text-white'}`}>{race.status.toUpperCase()}</span>
                    <span className="text-sm text-[var(--color-ggd-muted)] font-data font-bold">{new Date(race.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="text-base text-white/70 font-readable italic">{race.finalVerdict || '—'}</div>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'tools' && (
            <div className="ggd-card-gold ggd-stripe p-8">
              <h2 className="font-display text-3xl text-[var(--color-ggd-gold)] text-outlined mb-5">🔧 Công Cụ</h2>
              <div className="ggd-card p-5">
                <h3 className="font-display text-lg text-[var(--color-ggd-gold)] mb-2">🧮 Tính Lại Tổng Dzịt</h3>
                <p className="text-base text-[var(--color-ggd-muted)] mb-5 font-data font-bold">
                  Công thức: <code className="bg-[var(--color-ggd-panel)] px-2 py-0.5 rounded text-[var(--color-ggd-neon-green)]">scars + (shields * 2) + (shieldsUsed * 2)</code>
                </p>
                <button onClick={handleRecalc} className="ggd-btn bg-[var(--color-ggd-gold)] text-[var(--color-ggd-outline)] text-base px-6 py-3">TÍNH 🧮</button>
              </div>
            </div>
          )}

          {activeTab === 'season' && season && (
            <div className="space-y-6">
              <div className="ggd-card-gold ggd-stripe p-6 flex items-center justify-between">
                <div>
                  <div className="font-display text-3xl text-[var(--color-ggd-gold)] text-outlined">⚙️ Season Control</div>
                  <div className="font-data text-sm text-[var(--color-ggd-muted)] mt-1">Theo dõi Boss, shield aging và weekly tick.</div>
                </div>
                <button onClick={handleRunWeeklyTick} className="ggd-btn bg-[var(--color-ggd-neon-green)] text-[var(--color-ggd-outline)] text-base px-6 py-3">
                  🌀 Run Weekly Tick Now
                </button>
              </div>

              <div className="flex flex-wrap gap-3">
                {([
                  ['boss', '👑 Boss'],
                  ['shield', '⏳ Shield'],
                  ...(MYSTERY_CHESTS_ENABLED ? [
                    ['active_chests', '🎁 Active'],
                    ['chest_history', '📚 History'],
                  ] as const : []),
                  ['weekly_tick', '🌀 Tick'],
                ] as const).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setSeasonTab(key)}
                    className={`ggd-btn px-4 py-2 text-sm ${seasonTab === key ? 'bg-[var(--color-ggd-neon-green)] text-[var(--color-ggd-outline)]' : 'bg-[var(--color-ggd-surface)] text-[var(--color-ggd-muted)]'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {seasonTab === 'boss' && (
                <div className="ggd-card p-6">
                  <div className="font-display text-2xl text-white text-outlined mb-4">👑 Boss List</div>
                  <div className="space-y-3">
                    {season.bosses.length > 0 ? season.bosses.map((boss) => (
                      <div key={boss.id} className="rounded-xl border-3 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] p-4">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-body text-white font-black">{boss.name}</span>
                          <span className="ggd-tag bg-[var(--color-ggd-gold)] text-[var(--color-ggd-outline)]">👑 {boss.cleanStreak}/3</span>
                        </div>
                        <div className="font-data text-xs text-[var(--color-ggd-muted)] mt-2">
                          Boss since: {boss.bossSince ? new Date(boss.bossSince).toLocaleString() : '—'}
                        </div>
                        <div className="mt-3">
                          <button
                            onClick={() => handleDemoteBoss(boss.id, boss.name)}
                            className="ggd-btn bg-[var(--color-ggd-orange)] text-white text-xs px-3 py-2"
                          >
                            👑💔 Force Demote
                          </button>
                        </div>
                      </div>
                    )) : (
                      <div className="font-data text-sm text-[var(--color-ggd-muted)]">Không có Boss active.</div>
                    )}
                  </div>
                </div>
              )}

              {seasonTab === 'shield' && (
                <div className="ggd-card p-6 space-y-5">
                  <div>
                    <div className="font-display text-2xl text-white text-outlined">⏳ Shield Aging</div>
                    <div className="font-data text-xs text-[var(--color-ggd-muted)] mt-1">
                      Manage bằng bảng Shield mới. Ô legacy User.shields chỉ còn là counter cache để UI cũ không lệch.
                    </div>
                  </div>

                  <div className="rounded-xl border-3 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] p-4">
                    <div className="font-display text-lg text-[var(--color-ggd-neon-green)] mb-3">Grant Shield Mới</div>
                    <div className="flex flex-wrap items-end gap-3">
                      <label className="flex flex-col gap-1">
                        <span className="ggd-col-header">Vịt</span>
                        <select
                          value={shieldOwnerId}
                          onChange={(event) => setShieldOwnerId(event.target.value)}
                          className="bg-[var(--color-ggd-surface)] border-3 border-[var(--color-ggd-outline)] rounded-xl px-3 py-2 font-bold text-white outline-none"
                        >
                          <option value="">Chọn vịt</option>
                          {users.map((user) => (
                            <option key={user.id} value={user.id}>
                              #{user.id} {user.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="ggd-col-header">Số lượng</span>
                        <input
                          type="number"
                          min="1"
                          max="20"
                          value={shieldGrantCount}
                          onChange={(event) => setShieldGrantCount(event.target.value)}
                          className="bg-[var(--color-ggd-surface)] border-3 border-[var(--color-ggd-outline)] rounded-xl px-3 py-2 w-28 font-bold text-white outline-none"
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="ggd-col-header">Age</span>
                        <select
                          value={shieldWeeksUnused}
                          onChange={(event) => setShieldWeeksUnused(event.target.value)}
                          className="bg-[var(--color-ggd-surface)] border-3 border-[var(--color-ggd-outline)] rounded-xl px-3 py-2 font-bold text-white outline-none"
                        >
                          <option value="0">0w fresh</option>
                          <option value="1">1w fresh</option>
                          <option value="2">2w cracked</option>
                          <option value="3">3w breaking</option>
                        </select>
                      </label>
                      <button
                        onClick={handleGrantShield}
                        className="ggd-btn bg-[var(--color-ggd-neon-green)] text-[var(--color-ggd-outline)] text-sm px-5 py-2.5"
                      >
                        Grant Shield
                      </button>
                    </div>
                  </div>

                  <div className="space-y-3 max-h-[420px] overflow-y-auto pr-2">
                    {season.activeShields.length > 0 ? season.activeShields.map((shield) => (
                      <div key={shield.id} className="rounded-xl border-3 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] p-4">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-body text-white font-black">🛡️ #{shield.id} - {shield.ownerName}</span>
                          <span className={`ggd-tag ${shield.weeksUnused >= 3 ? 'bg-[var(--color-ggd-orange)] text-white' : shield.weeksUnused >= 2 ? 'bg-[var(--color-ggd-gold)] text-[var(--color-ggd-outline)]' : 'bg-[var(--color-ggd-neon-green)] text-[var(--color-ggd-outline)]'}`}>
                            {shield.weeksUnused}w
                          </span>
                        </div>
                        <div className="font-data text-xs text-[var(--color-ggd-muted)] mt-2">
                          Earned: {new Date(shield.earnedAt).toLocaleString()} • status={shield.status}
                        </div>
                        <div className="flex gap-2 mt-3">
                          <button
                            onClick={() => handleShieldAction(shield.id, shield.ownerName, 'break')}
                            className="ggd-btn bg-[var(--color-ggd-orange)] text-white text-xs px-3 py-2"
                          >
                            Force Break
                          </button>
                          <button
                            onClick={() => handleShieldAction(shield.id, shield.ownerName, 'lose')}
                            className="ggd-btn bg-[var(--color-ggd-muted)] text-white text-xs px-3 py-2"
                          >
                            Remove / Lose
                          </button>
                          <button
                            onClick={() => handleShieldAction(shield.id, shield.ownerName, 'reset_age')}
                            className="ggd-btn bg-[var(--color-ggd-neon-green)] text-[var(--color-ggd-outline)] text-xs px-3 py-2"
                          >
                            Reset Age
                          </button>
                        </div>
                      </div>
                    )) : (
                      <div className="font-data text-sm text-[var(--color-ggd-muted)]">Không có shield active.</div>
                    )}
                  </div>
                </div>
              )}

              {MYSTERY_CHESTS_ENABLED && seasonTab === 'active_chests' && (
                <div className="ggd-card-orange p-6">
                  <div className="font-display text-2xl text-white text-outlined mb-4">🎁 Rương Đang Cầm</div>
                  <div className="space-y-3 max-h-[420px] overflow-y-auto pr-2">
                    {season.activeChests.length > 0 ? season.activeChests.map((chest) => (
                      <div key={chest.id} className="rounded-xl border-3 border-[var(--color-ggd-outline)] bg-black/20 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-body text-white font-black">{chest.ownerName}</span>
                          <span className="ggd-tag bg-[var(--color-ggd-orange)] text-white">{chest.effect}</span>
                        </div>
                        <div className="font-data text-xs text-white/70 mt-2">
                          Earned from race #{chest.earnedFromRaceId} • created {new Date(chest.createdAt).toLocaleString()}
                        </div>
                        <div className="flex gap-2 mt-3">
                          <button
                            onClick={() => handleRerollChest(chest.id)}
                            className="ggd-btn bg-[var(--color-ggd-gold)] text-[var(--color-ggd-outline)] text-xs px-3 py-2"
                          >
                            🎲 Re-roll
                          </button>
                          <button
                            onClick={() => handleCancelChest(chest.id)}
                            className="ggd-btn bg-[var(--color-ggd-muted)] text-white text-xs px-3 py-2"
                          >
                            🧹 Void
                          </button>
                        </div>
                      </div>
                    )) : (
                      <div className="font-data text-sm text-white/75">Không có chest active.</div>
                    )}
                  </div>
                </div>
              )}

              {seasonTab === 'weekly_tick' && (
                <div className="ggd-card p-6">
                  <div className="font-display text-2xl text-white text-outlined mb-4">📜 Weekly Tick Log</div>
                  <div className="space-y-3 max-h-[420px] overflow-y-auto pr-2">
                    {season.weeklyTicks.length > 0 ? season.weeklyTicks.map((tick) => (
                      <div key={tick.id} className="rounded-xl border-3 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] p-4">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-body text-white font-black">{tick.weekKey}</span>
                          <span className="ggd-tag bg-[var(--color-ggd-neon-green)] text-[var(--color-ggd-outline)]">
                            {tick.brokenShields} vỡ / {tick.lostShields} mất
                          </span>
                        </div>
                        <div className="font-data text-xs text-[var(--color-ggd-muted)] mt-2">
                          {new Date(tick.runAt).toLocaleString()}
                        </div>
                        {tick.details && (
                          <pre className="mt-3 text-[10px] text-white/65 whitespace-pre-wrap break-all bg-black/20 rounded-xl p-3">{formatAuditJson(tick.details)}</pre>
                        )}
                      </div>
                    )) : (
                      <div className="font-data text-sm text-[var(--color-ggd-muted)]">Chưa có weekly tick nào.</div>
                    )}
                  </div>
                </div>
              )}

              {MYSTERY_CHESTS_ENABLED && seasonTab === 'chest_history' && (
                <div className="ggd-card p-6">
                  <div className="font-display text-2xl text-white text-outlined mb-4">📚 Chest History</div>
                  <div className="space-y-3 max-h-[520px] overflow-y-auto pr-2">
                    {season.chestHistory.length > 0 ? season.chestHistory.map((chest) => (
                      <div key={chest.id} className="rounded-xl border-3 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] p-4">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-body text-white font-black">#{chest.id} - {chest.ownerName}</span>
                          <span className={`ggd-tag ${chest.status === 'consumed' ? 'bg-[var(--color-ggd-neon-green)] text-[var(--color-ggd-outline)]' : 'bg-[var(--color-ggd-muted)] text-white'}`}>
                            {chest.status}
                          </span>
                        </div>
                        <div className="font-data text-xs text-[var(--color-ggd-muted)] mt-2">
                          effect={chest.effect} • from race #{chest.earnedFromRaceId} • consumedRace={chest.consumedRaceId ?? '—'}
                        </div>
                        {chest.consumedAt && (
                          <div className="font-data text-xs text-[var(--color-ggd-muted)] mt-1">
                            consumedAt={new Date(chest.consumedAt).toLocaleString()}
                          </div>
                        )}
                        {chest.rngSeed && (
                          <pre className="mt-3 text-[10px] text-white/65 whitespace-pre-wrap break-all bg-black/20 rounded-xl p-3">{formatAuditJson(chest.rngSeed)}</pre>
                        )}
                      </div>
                    )) : (
                      <div className="font-data text-sm text-[var(--color-ggd-muted)]">Chưa có chest history.</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
      )}
    </div>
  )
}
