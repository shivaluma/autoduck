'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface User {
  id: number
  name: string
  avatarUrl?: string
  scars: number
  shields: number
  shieldsUsed: number
  totalKhaos: number
}

interface Race {
  id: number
  status: string
  createdAt: string
  finalVerdict?: string
}

interface AdminDashboardContentProps {
  secret?: string
}

export function AdminDashboardContent({ secret }: AdminDashboardContentProps) {
  const router = useRouter()

  const [users, setUsers] = useState<User[]>([])
  const [races, setRaces] = useState<Race[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'users' | 'races' | 'tools'>('users')
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (!secret) return

    fetch(`/api/admin?secret=${secret}`)
      .then(r => {
        if (!r.ok) throw new Error('Unauthorized')
        return r.json()
      })
      .then(data => {
        setUsers(data.users)
        setRaces(data.races)
        setLoading(false)
      })
      .catch(() => {
        setMsg('Unauthorized or Error')
        setLoading(false)
      })
  }, [secret])

  if (!secret) {
    return (
      <div className="min-h-screen bg-[var(--color-ggd-deep)] text-[var(--color-ggd-orange)] font-display flex items-center justify-center text-2xl">
        🔒 CẤM VÀO! KHÔNG CÓ QUYỀN 🦆
      </div>
    )
  }

  const handleUpdateUser = async (user: User) => {
    try {
      const res = await fetch(`/api/admin?secret=${secret}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'user', data: user })
      })
      if (res.ok) {
        setMsg(`Đã cập nhật ${user.name} ✅`)
        setTimeout(() => setMsg(''), 2000)
      }
    } catch (e) {
      setMsg('Cập nhật thất bại 😢')
    }
  }

  const handleRecalc = async () => {
    setMsg('Đang tính toán... 🧮')
    try {
      const res = await fetch(`/api/admin?secret=${secret}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'recalc_khaos' })
      })
      const data = await res.json()
      setMsg(data.message)
      const r = await fetch(`/api/admin?secret=${secret}`)
      const d = await r.json()
      setUsers(d.users)
    } catch (e) {
      setMsg('Tính toán thất bại 😢')
    }
  }

  const handleChange = (id: number, field: keyof User, value: string) => {
    setUsers(users.map(u => u.id === id ? { ...u, [field]: value } : u))
  }

  return (
    <div className="min-h-screen bg-[var(--color-ggd-deep)] bubble-bg text-[var(--color-ggd-cream)] font-body p-8">
      <header className="flex justify-between items-center mb-8 border-b-2 border-[var(--color-ggd-mint)]/20 pb-4">
        <h1 className="font-display text-3xl text-[var(--color-ggd-gold)]">🦆 QUẢN LÝ BẦY VỊT ⚡</h1>
        <div className="flex gap-3">
          {(['users', 'races', 'tools'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`puffy-btn text-sm px-5 py-2 ${activeTab === tab
                ? 'bg-[var(--color-ggd-mint)] text-[var(--color-ggd-deep)]'
                : 'bg-[var(--color-ggd-surface)] text-[var(--color-ggd-lavender)] hover:bg-[var(--color-ggd-surface-2)]'
                }`}
            >
              {tab === 'users' ? '🦆 VỊT' : tab === 'races' ? '🏁 TRẬN' : '🔧 TOOLS'}
            </button>
          ))}
          <Link href="/" className="puffy-btn bg-[var(--color-ggd-surface)] text-[var(--color-ggd-lavender)] hover:text-[var(--color-ggd-cream)] text-sm px-5 py-2">
            🚪 THOÁT
          </Link>
        </div>
      </header>

      {msg && (
        <div className="fixed top-4 right-4 cartoon-card px-5 py-3 shadow-xl animate-bounce-in z-50">
          <span className="font-display text-base">{msg}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="text-5xl animate-bob">🦆</div>
        </div>
      ) : (
        <main>
          {activeTab === 'users' && (
            <div className="overflow-x-auto cartoon-card p-1">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b-2 border-[var(--color-ggd-mint)]/10">
                    <th className="p-3 font-data text-xs text-[var(--color-ggd-lavender)]">ID</th>
                    <th className="p-3 font-data text-xs text-[var(--color-ggd-lavender)]">Tên Vịt</th>
                    <th className="p-3 font-data text-xs text-[var(--color-ggd-lavender)]">Avatar</th>
                    <th className="p-3 font-data text-xs text-[var(--color-ggd-lavender)]">Sẹo</th>
                    <th className="p-3 font-data text-xs text-[var(--color-ggd-lavender)]">Khiên</th>
                    <th className="p-3 font-data text-xs text-[var(--color-ggd-lavender)]">Đã Dùng</th>
                    <th className="p-3 font-data text-xs text-[var(--color-ggd-lavender)]">Tổng Dzịt</th>
                    <th className="p-3 font-data text-xs text-[var(--color-ggd-lavender)]">Hành Động</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-ggd-mint)]/8">
                  {users.map(u => (
                    <tr key={u.id} className="hover:bg-[var(--color-ggd-mint)]/5 transition-colors">
                      <td className="p-3 text-[var(--color-ggd-lavender)]">{u.id}</td>
                      <td className="p-3 font-bold text-[var(--color-ggd-cream)] flex items-center gap-2">
                        {u.avatarUrl && <img src={u.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover border-2 border-[var(--color-ggd-mint)]/30" />}
                        {u.name}
                      </td>
                      <td className="p-3">
                        <div className="flex flex-col gap-1">
                          <input
                            className="bg-transparent w-full min-w-[150px] border-b-2 border-[var(--color-ggd-lavender)]/20 focus:border-[var(--color-ggd-mint)] text-xs text-[var(--color-ggd-cream)]/70 rounded-none outline-none"
                            placeholder="https://..."
                            value={u.avatarUrl || ''}
                            onChange={e => handleChange(u.id, 'avatarUrl', e.target.value)}
                          />
                          <input
                            type="file"
                            className="text-[10px] text-[var(--color-ggd-lavender)] file:mr-2 file:py-0 file:px-2 file:rounded-full file:border-0 file:text-[10px] file:bg-[var(--color-ggd-surface-2)] file:text-[var(--color-ggd-cream)] hover:file:bg-[var(--color-ggd-mint)]/20 cursor-pointer"
                            accept="image/*"
                            onChange={async (e) => {
                              const file = e.target.files?.[0]
                              if (!file) return

                              const formData = new FormData()
                              formData.append('file', file)

                              setMsg(`Đang upload avatar cho ${u.name}... 📸`)
                              try {
                                const res = await fetch(`/api/upload?secret=${secret}`, {
                                  method: 'POST',
                                  body: formData
                                })
                                const data = await res.json()
                                if (data.url) {
                                  handleChange(u.id, 'avatarUrl', data.url)
                                  setMsg('Upload thành công! ✅')
                                } else {
                                  setMsg('Upload thất bại: ' + data.error)
                                }
                              } catch (err) {
                                setMsg('Lỗi upload 😢')
                              }
                            }}
                          />
                        </div>
                      </td>
                      <td className="p-3"><input className="bg-transparent w-16 border-b-2 border-[var(--color-ggd-lavender)]/20 focus:border-[var(--color-ggd-orange)] text-center rounded-none outline-none" value={u.scars} onChange={e => handleChange(u.id, 'scars', e.target.value)} /></td>
                      <td className="p-3"><input className="bg-transparent w-16 border-b-2 border-[var(--color-ggd-lavender)]/20 focus:border-[var(--color-ggd-mint)] text-center rounded-none outline-none" value={u.shields} onChange={e => handleChange(u.id, 'shields', e.target.value)} /></td>
                      <td className="p-3"><input className="bg-transparent w-16 border-b-2 border-[var(--color-ggd-lavender)]/20 focus:border-[var(--color-ggd-lavender)] text-center rounded-none outline-none" value={u.shieldsUsed} onChange={e => handleChange(u.id, 'shieldsUsed', e.target.value)} /></td>
                      <td className="p-3 text-[var(--color-ggd-gold)] font-display text-lg">{u.totalKhaos}</td>
                      <td className="p-3">
                        <button onClick={() => handleUpdateUser(u)} className="puffy-btn text-xs bg-[var(--color-ggd-mint)] text-[var(--color-ggd-deep)] px-3 py-1.5">
                          LƯU ✅
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'races' && (
            <div className="space-y-3">
              {races.map(r => (
                <div key={r.id} className="soft-card p-4 flex justify-between items-center">
                  <div className="flex items-center gap-4">
                    <span className="font-display text-lg text-[var(--color-ggd-lavender)]">#{r.id}</span>
                    <span className={`cute-tag ${r.status === 'finished' ? 'bg-[var(--color-ggd-mint)]/15 text-[var(--color-ggd-mint)]' : r.status === 'running' ? 'bg-[var(--color-ggd-gold)]/15 text-[var(--color-ggd-gold)]' : 'bg-[var(--color-ggd-orange)]/15 text-[var(--color-ggd-orange)]'}`}>
                      {r.status.toUpperCase()}
                    </span>
                    <span className="text-xs text-[var(--color-ggd-lavender)]/50 font-data">{new Date(r.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="text-sm text-[var(--color-ggd-cream)]/60 font-readable italic">{r.finalVerdict || '—'}</div>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'tools' && (
            <div className="cartoon-card-gold p-8">
              <h2 className="font-display text-2xl text-[var(--color-ggd-gold)] mb-4">🔧 Công Cụ</h2>
              <div className="flex flex-col gap-4">
                <div className="soft-card p-5">
                  <h3 className="font-display text-lg text-[var(--color-ggd-gold)] mb-2">🧮 Tính Lại Tổng Dzịt</h3>
                  <p className="text-sm text-[var(--color-ggd-lavender)] mb-4 font-data">
                    Công thức: <code className="bg-[var(--color-ggd-surface-2)] px-2 py-0.5 rounded text-[var(--color-ggd-mint)]">scars + (shields * 2) + (shieldsUsed * 2)</code>
                  </p>
                  <button
                    onClick={handleRecalc}
                    className="puffy-btn bg-[var(--color-ggd-gold)] text-[var(--color-ggd-deep)] text-base px-6 py-3"
                  >
                    TÍNH TOÁN 🧮
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      )}
    </div>
  )
}
