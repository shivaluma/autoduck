'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface User { id: number; name: string; avatarUrl?: string; scars: number; shields: number; shieldsUsed: number; totalKhaos: number }
interface Race { id: number; status: string; createdAt: string; finalVerdict?: string }
interface Props { secret?: string }

export function AdminDashboardContent({ secret }: Props) {
  const [users, setUsers] = useState<User[]>([])
  const [races, setRaces] = useState<Race[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'users' | 'races' | 'tools'>('users')
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (!secret) return
    fetch(`/api/admin?secret=${secret}`)
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then(data => { setUsers(data.users); setRaces(data.races); setLoading(false) })
      .catch(() => { setMsg('Unauthorized'); setLoading(false) })
  }, [secret])

  if (!secret) return <div className="min-h-screen bg-transparent text-[var(--color-ggd-orange)] font-display flex items-center justify-center text-3xl text-outlined">🔒 CẤM VÀO!</div>

  const handleUpdateUser = async (user: User) => {
    const res = await fetch(`/api/admin?secret=${secret}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'user', data: user }) })
    if (res.ok) { setMsg(`✅ ${user.name}`); setTimeout(() => setMsg(''), 2000) }
  }

  const handleRecalc = async () => {
    setMsg('🧮...')
    const res = await fetch(`/api/admin?secret=${secret}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'recalc_khaos' }) })
    const d = await res.json(); setMsg(d.message)
    const r = await fetch(`/api/admin?secret=${secret}`); const data = await r.json(); setUsers(data.users)
  }

  const handleChange = (id: number, field: keyof User, value: string) => setUsers(users.map(u => u.id === id ? { ...u, [field]: value } : u))

  return (
    <div className="min-h-screen bg-transparent bubble-bg text-white font-body p-8">
      <header className="flex justify-between items-center mb-8 border-b-[5px] border-[var(--color-ggd-outline)] pb-5">
        <h1 className="font-display text-4xl text-[var(--color-ggd-gold)] text-outlined">🦆 QUẢN LÝ BẦY VỊT ⚡</h1>
        <div className="flex gap-3">
          {(['users', 'races', 'tools'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`ggd-btn text-base px-6 py-2.5 ${activeTab === tab
                ? 'bg-[var(--color-ggd-neon-green)] text-[var(--color-ggd-outline)]'
                : 'bg-[var(--color-ggd-surface)] text-[var(--color-ggd-muted)]'
                }`}>
              {tab === 'users' ? '🦆 VỊT' : tab === 'races' ? '🏁 TRẬN' : '🔧 TOOLS'}
            </button>
          ))}
          <Link href="/" className="ggd-btn bg-[var(--color-ggd-surface)] text-[var(--color-ggd-muted)] text-base px-6 py-2.5">🚰 THOÁT</Link>
        </div>
      </header>

      {msg && <div className="fixed top-4 right-4 ggd-card px-5 py-3 z-50 animate-bounce-in"><span className="font-display text-base">{msg}</span></div>}

      {loading ? <div className="flex items-center justify-center py-20"><div className="text-6xl animate-bob">🦆</div></div> : (
        <main>
          {activeTab === 'users' && (
            <div className="overflow-x-auto ggd-card ggd-stripe">
              <div className="ggd-panel-header bg-[var(--color-ggd-neon-green)] rounded-t-[7px]">
                <span className="text-[var(--color-ggd-outline)] text-xl">🦆 Danh Sách Bầy Vịt</span>
              </div>
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b-[3px] border-black bg-[var(--color-ggd-panel)]">
                    {['ID', 'Tên', 'Avatar', 'Sẹo', 'Khiên', 'Đã Dùng', 'Dzịt', ''].map(h => (
                      <th key={h} className="px-4 py-3 ggd-col-header">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y-2 divide-black/20">
                  {users.map(u => (
                    <tr key={u.id} className="hover:bg-[var(--color-ggd-neon-green)]/7 transition-colors">
                      <td className="px-4 py-3.5 font-data text-base text-[var(--color-ggd-muted)] font-bold">{u.id}</td>
                      <td className="px-4 py-3.5 font-black text-lg text-white flex items-center gap-2">
                        {u.avatarUrl && <img src={u.avatarUrl} alt="" className="w-9 h-9 rounded-full object-cover border-2 border-[var(--color-ggd-outline)]" />}
                        {u.name}
                      </td>
                      <td className="px-4 py-3.5">
                        <input className="bg-transparent w-full min-w-[150px] border-b-2 border-[var(--color-ggd-outline)]/40 focus:border-[var(--color-ggd-neon-green)] text-sm text-white/70 outline-none" placeholder="https://..." value={u.avatarUrl || ''} onChange={e => handleChange(u.id, 'avatarUrl', e.target.value)} />
                        <input type="file" className="text-[10px] text-[var(--color-ggd-muted)] mt-1 file:mr-2 file:py-0 file:px-2 file:rounded-full file:border-0 file:text-[10px] file:bg-[var(--color-ggd-surface-2)] file:text-white cursor-pointer" accept="image/*"
                          onChange={async (e) => {
                            const file = e.target.files?.[0]; if (!file) return
                            const fd = new FormData(); fd.append('file', file)
                            setMsg(`📸 ${u.name}...`)
                            try { const r = await fetch(`/api/upload?secret=${secret}`, { method: 'POST', body: fd }); const d = await r.json(); if (d.url) { handleChange(u.id, 'avatarUrl', d.url); setMsg('✅') } else setMsg('❌ ' + d.error) } catch { setMsg('❌') }
                          }} />
                      </td>
                      <td className="px-4 py-3.5"><input className="bg-transparent w-16 border-b-2 border-[var(--color-ggd-outline)]/40 focus:border-[var(--color-ggd-orange)] text-center outline-none font-bold text-base" value={u.scars} onChange={e => handleChange(u.id, 'scars', e.target.value)} /></td>
                      <td className="px-4 py-3.5"><input className="bg-transparent w-16 border-b-2 border-[var(--color-ggd-outline)]/40 focus:border-[var(--color-ggd-neon-green)] text-center outline-none font-bold text-base" value={u.shields} onChange={e => handleChange(u.id, 'shields', e.target.value)} /></td>
                      <td className="px-4 py-3.5"><input className="bg-transparent w-16 border-b-2 border-[var(--color-ggd-outline)]/40 text-center outline-none font-bold text-base" value={u.shieldsUsed} onChange={e => handleChange(u.id, 'shieldsUsed', e.target.value)} /></td>
                      <td className="px-4 py-3.5 text-[var(--color-ggd-gold)] font-display text-2xl">{u.totalKhaos}</td>
                      <td className="px-4 py-3.5"><button onClick={() => handleUpdateUser(u)} className="ggd-btn text-sm bg-[var(--color-ggd-neon-green)] text-[var(--color-ggd-outline)] px-4 py-2">LƯU</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {activeTab === 'races' && (
            <div className="space-y-3">{races.map(r => (
              <div key={r.id} className="ggd-card p-5 flex justify-between items-center">
                <div className="flex items-center gap-4">
                  <span className="font-display text-2xl text-[var(--color-ggd-muted)]">#{r.id}</span>
                  <span className={`ggd-tag text-sm font-black ${r.status === 'finished' ? 'bg-[var(--color-ggd-neon-green)] text-[var(--color-ggd-outline)]' : 'bg-[var(--color-ggd-orange)] text-white'}`}>{r.status.toUpperCase()}</span>
                  <span className="text-sm text-[var(--color-ggd-muted)] font-data font-bold">{new Date(r.createdAt).toLocaleString()}</span>
                </div>
                <div className="text-base text-white/70 font-readable italic">{r.finalVerdict || '—'}</div>
              </div>
            ))}</div>
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
        </main>
      )}
    </div>
  )
}
