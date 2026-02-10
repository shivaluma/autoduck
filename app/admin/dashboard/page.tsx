'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'

interface User {
  id: number
  name: string
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

export default function AdminDashboardPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const secret = searchParams.get('secret')

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
      <div className="min-h-screen bg-black text-red-500 font-mono flex items-center justify-center">
        ACCESS DENIED: MISSING SECRET KEY
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
        setMsg(`Updated ${user.name}`)
        setTimeout(() => setMsg(''), 2000)
      }
    } catch (e) {
      setMsg('Update failed')
    }
  }

  const handleRecalc = async () => {
    setMsg('Recalculating...')
    try {
      const res = await fetch(`/api/admin?secret=${secret}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'recalc_khaos' })
      })
      const data = await res.json()
      setMsg(data.message)
      // Refresh data
      const r = await fetch(`/api/admin?secret=${secret}`)
      const d = await r.json()
      setUsers(d.users)
    } catch (e) {
      setMsg('Recalc failed')
    }
  }

  const handleChange = (id: number, field: keyof User, value: string) => {
    setUsers(users.map(u => u.id === id ? { ...u, [field]: value } : u))
  }

  return (
    <div className="min-h-screen bg-zinc-900 text-white font-mono p-8">
      <header className="flex justify-between items-center mb-8 border-b border-zinc-700 pb-4">
        <h1 className="text-2xl font-bold text-yellow-500">AUTODUCK GOD MODE ⚡</h1>
        <div className="flex gap-4">
          <button onClick={() => setActiveTab('users')} className={`px-4 py-2 ${activeTab === 'users' ? 'bg-zinc-700' : ''}`}>USERS</button>
          <button onClick={() => setActiveTab('races')} className={`px-4 py-2 ${activeTab === 'races' ? 'bg-zinc-700' : ''}`}>RACES</button>
          <button onClick={() => setActiveTab('tools')} className={`px-4 py-2 ${activeTab === 'tools' ? 'bg-zinc-700' : ''}`}>TOOLS</button>
          <Link href="/" className="px-4 py-2 hover:text-yellow-500">EXIT</Link>
        </div>
      </header>

      {msg && <div className="fixed top-4 right-4 bg-blue-600 px-4 py-2 rounded shadow-lg animate-pulse">{msg}</div>}

      {loading ? <div>Loading...</div> : (
        <main>
          {activeTab === 'users' && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-zinc-500 uppercase">
                  <tr>
                    <th className="p-2">ID</th>
                    <th className="p-2">Name</th>
                    <th className="p-2">Scars</th>
                    <th className="p-2">Shields (Avail)</th>
                    <th className="p-2">Shields (Used)</th>
                    <th className="p-2">Total Khaos</th>
                    <th className="p-2">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {users.map(u => (
                    <tr key={u.id} className="hover:bg-zinc-800/50">
                      <td className="p-2 text-zinc-500">{u.id}</td>
                      <td className="p-2 font-bold text-white">{u.name}</td>
                      <td className="p-2"><input className="bg-transparent w-16 border-b border-zinc-700 focus:border-yellow-500" value={u.scars} onChange={e => handleChange(u.id, 'scars', e.target.value)} /></td>
                      <td className="p-2"><input className="bg-transparent w-16 border-b border-zinc-700 focus:border-yellow-500" value={u.shields} onChange={e => handleChange(u.id, 'shields', e.target.value)} /></td>
                      <td className="p-2"><input className="bg-transparent w-16 border-b border-zinc-700 focus:border-yellow-500" value={u.shieldsUsed} onChange={e => handleChange(u.id, 'shieldsUsed', e.target.value)} /></td>
                      <td className="p-2 text-yellow-500">{u.totalKhaos}</td>
                      <td className="p-2">
                        <button onClick={() => handleUpdateUser(u)} className="text-xs bg-green-900 text-green-300 px-2 py-1 rounded hover:bg-green-800">SAVE</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'races' && (
            <div className="space-y-2">
              {races.map(r => (
                <div key={r.id} className="p-4 bg-zinc-800 rounded flex justify-between">
                  <div>
                    <span className="text-zinc-500">#{r.id}</span>
                    <span className={`ml-4 font-bold ${r.status === 'finished' ? 'text-green-500' : r.status === 'running' ? 'text-yellow-500' : 'text-red-500'}`}>{r.status.toUpperCase()}</span>
                    <span className="ml-4 text-xs text-zinc-400">{new Date(r.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="text-sm text-zinc-300 italic">{r.finalVerdict || '—'}</div>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'tools' && (
            <div className="p-8 border border-zinc-700 rounded bg-zinc-900/50">
              <h2 className="text-xl font-bold mb-4">Metric Utilities</h2>
              <div className="flex flex-col gap-4">
                <div className="p-4 bg-zinc-800 rounded">
                  <h3 className="font-bold text-yellow-500 mb-2">Auto-Calculate Total Khaos</h3>
                  <p className="text-sm text-zinc-400 mb-4">
                    Formula: <code>scars + (shields_avail * 2) + (shields_used * 2)</code>
                  </p>
                  <button
                    onClick={handleRecalc}
                    className="bg-yellow-600 hover:bg-yellow-500 text-black font-bold px-6 py-3 rounded transition-colors"
                  >
                    RUN CALCULATION 🧮
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
