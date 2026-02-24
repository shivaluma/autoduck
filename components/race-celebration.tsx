'use client'

import { useEffect, useState } from 'react'
import { Fireworks } from '@/components/fireworks'

interface RaceCelebrationProps {
  winner: { name: string; avatarUrl?: string | null } | null
  victims: { name: string; avatarUrl?: string | null }[]
  verdict: string | null
  duration?: number
}

export function RaceCelebration({ winner, victims, verdict, duration = 4000 }: RaceCelebrationProps) {
  const [visible, setVisible] = useState(true)
  const [fading, setFading] = useState(false)

  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => {
        setFading(true)
        setTimeout(() => setVisible(false), 500)
      }, duration)
      return () => clearTimeout(timer)
    }
  }, [duration])

  if (!visible) return null

  return (
    <div className={`fixed inset-0 z-50 flex flex-col items-center justify-center pointer-events-none transition-opacity duration-500 ${fading ? 'opacity-0' : 'opacity-100'}`}>
      <Fireworks />

      {/* Winner Avatar */}
      {winner && (
        <div className="relative animate-bounce-in mb-8">
          <div className="absolute -inset-6 bg-[var(--color-ggd-gold)] rounded-full blur-2xl opacity-40 animate-pulse" />
          <img
            src={winner.avatarUrl || '/placeholder-avatar.png'}
            alt="Winner"
            className="w-48 h-48 rounded-full border-4 border-[var(--color-ggd-gold)] shadow-[0_0_50px_rgba(255,200,87,0.5)] object-cover relative z-10"
          />
          <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 bg-[var(--color-ggd-gold)] text-[var(--color-ggd-deep)] font-display text-lg px-5 py-1.5 rounded-full shadow-lg whitespace-nowrap z-20">
            👑 VỊT NHẤT: {winner.name} 🏆
          </div>
        </div>
      )}

      {/* Verdict */}
      {verdict && (
        <div className="cartoon-card-gold p-6 animate-slide-up">
          <h2 className="font-display text-4xl text-[var(--color-ggd-gold)] text-center glow-gold">
            🎉 HẾT TRẬN RỒI!
          </h2>
          <p className="text-xl mt-2 text-center text-[var(--color-ggd-cream)]/80 font-readable italic">&ldquo;{verdict}&rdquo;</p>
        </div>
      )}

      {/* Losers - Cute shame style instead of horror */}
      {victims && victims.length > 0 && (
        <div className="absolute bottom-10 flex gap-12 animate-slide-up" style={{ animationDelay: '0.5s' }}>
          {victims.map((v, idx) => (
            <div key={idx} className="flex flex-col items-center group relative">
              <div className="relative">
                <div className="absolute -inset-2 bg-[var(--color-ggd-orange)] rounded-full blur-lg opacity-30 animate-pulse" />
                <img
                  src={v.avatarUrl || '/placeholder-avatar.png'}
                  alt="Victim"
                  className="w-24 h-24 rounded-full border-3 border-[var(--color-ggd-orange)] object-cover relative z-10 saturate-50"
                />
                {/* Silly crying emoji instead of glitch */}
                <div className="absolute -top-2 -right-2 text-2xl z-20 animate-bob">😢</div>
              </div>
              <div className="mt-2 font-display text-base text-[var(--color-ggd-orange)] bg-[var(--color-ggd-deep)]/80 px-3 py-1 rounded-full">
                🦆 VỊT XUI: {v.name}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
