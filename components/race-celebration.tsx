'use client'

import { useEffect, useState } from 'react'
import { Fireworks } from '@/components/fireworks'

interface RaceCelebrationProps {
  winner: { name: string; avatarUrl?: string | null } | null
  victims: { name: string; avatarUrl?: string | null }[]
  verdict: string | null
  duration?: number // ms to show, 0 for infinite (until user dismisses?) - User asked for ~3s
}

export function RaceCelebration({ winner, victims, verdict, duration = 4000 }: RaceCelebrationProps) {
  const [visible, setVisible] = useState(true)
  const [fading, setFading] = useState(false)

  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => {
        setFading(true)
        setTimeout(() => setVisible(false), 500) // Wait for fade out transition
      }, duration)
      return () => clearTimeout(timer)
    }
  }, [duration])

  if (!visible) return null

  return (
    <div className={`fixed inset-0 z-50 flex flex-col items-center justify-center pointer-events-none transition-opacity duration-500 ${fading ? 'opacity-0' : 'opacity-100'}`}>
      <Fireworks />

      {/* Winner Avatar (Centered) */}
      {winner && (
        <div className="relative animate-zoom-in mb-8">
          <div className="absolute -inset-4 bg-yellow-500 rounded-full blur-xl opacity-50 animate-pulse" />
          <img
            src={winner.avatarUrl || '/placeholder-avatar.png'}
            alt="Winner"
            className="w-48 h-48 rounded-full border-4 border-yellow-400 shadow-[0_0_50px_rgba(255,215,0,0.6)] object-cover relative z-10"
          />
          <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 bg-yellow-500 text-black font-black uppercase px-4 py-1 rounded shadow-lg whitespace-nowrap z-20">
            🏆 CHAMPION: {winner.name} 🏆
          </div>
        </div>
      )}

      {/* Verdict */}
      {verdict && (
        <div className="bg-black/80 backdrop-blur text-white px-8 py-4 rounded-xl border border-white/20 shadow-2xl animate-slide-up">
          <h2 className="text-3xl font-display font-bold text-[var(--color-f1-red)] uppercase text-center glow-text">
            RACE FINISHED
          </h2>
          <p className="text-xl mt-2 text-center text-zinc-300 italic">"{verdict}"</p>
        </div>
      )}

      {/* Losers (Bottom) */}
      {victims && victims.length > 0 && (
        <div className="absolute bottom-10 flex gap-12 animate-slide-up delay-500">
          {victims.map((v, idx) => (
            <div key={idx} className="flex flex-col items-center group relative">
              {/* Glitch/Cursed Effect */}
              <div className="relative">
                <div className="absolute inset-0 bg-red-600 mix-blend-overlay opacity-0 group-hover:opacity-100 animate-pulse rounded-full" />
                <img
                  src={v.avatarUrl || '/placeholder-avatar.png'}
                  alt="Victim"
                  className="w-24 h-24 rounded-full border-2 border-red-900 grayscale contrast-150 brightness-75 object-cover"
                  style={{ filter: 'grayscale(100%) contrast(1.2) brightness(0.8)' }}
                />
                {/* Glitch overlay */}
                <div className="absolute inset-0 bg-noise opacity-30 mix-blend-overlay rounded-full" />
              </div>
              <div className="mt-2 text-red-700 font-creepster font-bold uppercase tracking-widest text-sm bg-black px-2 rounded">
                💀 VICTIM: {v.name}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
