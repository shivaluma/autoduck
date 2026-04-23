'use client'

import Image from 'next/image'
import { useEffect, useState } from 'react'
import { ChestReveal } from '@/components/chest-reveal'
import type { ChestEffect } from '@/lib/types'

interface PlayerInfo {
  name: string
  avatarUrl?: string | null
  gotScar?: boolean
  usedShield?: boolean
  initialRank?: number | null
}

interface Props {
  raceId?: number
  allPlayers: PlayerInfo[]
  victims: PlayerInfo[]
  verdict: string | null
  bossFalls?: string[]
  consumedChests?: {
    id: number
    ownerName: string
    effect: string
    targetName?: string | null
    outcome: 'success' | 'fizzled'
  }[]
  awardedChests?: {
    id: number
    ownerName: string
    effect: ChestEffect
  }[]
  duration?: number
}

export function RaceCelebration({
  raceId,
  allPlayers,
  victims,
  verdict,
  bossFalls = [],
  consumedChests = [],
  awardedChests = [],
  duration = 6000,
}: Props) {
  // duration > 0  ⇒ lần đầu xem: ẩn rồi stagger reveal + auto-fade
  // duration === 0 ⇒ replay/reload race detail: không render overlay nữa
  const isFirstView = duration > 0
  const [visible, setVisible] = useState(isFirstView)
  const [fading, setFading] = useState(false)
  const [showText, setShowText] = useState(!isFirstView)
  const [showVictims, setShowVictims] = useState(!isFirstView)
  const [showPlayers, setShowPlayers] = useState(!isFirstView)
  const [showChestReport, setShowChestReport] = useState(!isFirstView)
  const [showBossFall, setShowBossFall] = useState(!isFirstView)

  useEffect(() => {
    if (raceId && typeof window !== 'undefined') {
      window.sessionStorage.setItem(`race-celebration:${raceId}`, 'done')
    }

    if (duration <= 0) {
      return
    }

    const timers: ReturnType<typeof setTimeout>[] = []
    timers.push(setTimeout(() => setShowPlayers(true), 300))
    timers.push(setTimeout(() => setShowText(true), 800))
    timers.push(setTimeout(() => setShowVictims(true), 1500))
    timers.push(setTimeout(() => setShowBossFall(true), 2000))
    timers.push(setTimeout(() => setShowChestReport(true), 2400))

    const fadeTimer = setTimeout(() => {
      setFading(true)
      const hideTimer = setTimeout(() => setVisible(false), 800)
      timers.push(hideTimer)
    }, duration)
    timers.push(fadeTimer)

    return () => timers.forEach((timer) => clearTimeout(timer))
  }, [duration, raceId])

  const handleSkip = () => {
    setFading(true)
    setTimeout(() => setVisible(false), 300)
  }

  if (!visible) return null

  const victimNames = new Set(victims.map(v => v.name))

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-between overflow-hidden transition-opacity duration-800 ${fading ? 'opacity-0' : 'opacity-100'}`}
      style={{ pointerEvents: 'none', height: '100dvh' }}
    >
      <button
        onClick={handleSkip}
        className="absolute top-5 right-5 z-50 ggd-btn bg-[var(--color-ggd-panel)] text-white text-sm px-4 py-2 border-2 border-white/40 hover:bg-white/10"
        style={{ pointerEvents: 'auto' }}
      >
        ✕ Bỏ qua
      </button>
      {/* Background — dark with red/orange atmospheric glow like GGD */}
      <div className="absolute inset-0 bg-black">
        {/* Top red glow */}
        <div className="absolute top-0 left-0 right-0 h-1/3"
          style={{
            background: 'radial-gradient(ellipse at 50% 0%, rgba(255, 50, 20, 0.5) 0%, rgba(200, 30, 10, 0.3) 30%, transparent 70%)',
          }}
        />
        {/* Bottom red glow */}
        <div className="absolute bottom-0 left-0 right-0 h-1/2"
          style={{
            background: 'radial-gradient(ellipse at 50% 100%, rgba(255, 50, 20, 0.4) 0%, rgba(180, 20, 10, 0.2) 30%, transparent 65%)',
          }}
        />
        {/* Center dark gradient */}
        <div className="absolute inset-0"
          style={{
            background: 'radial-gradient(ellipse at 50% 45%, rgba(30, 0, 0, 0.3) 0%, transparent 60%)',
          }}
        />
      </div>

      {/* ===== TOP ROW: All Players ===== */}
      <div className={`relative z-10 pt-8 px-8 transition-all duration-700 ${showPlayers ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-8'}`}>
        <div className="flex items-start justify-center gap-3 flex-wrap">
          {allPlayers.map((p, i) => {
            const isVictim = victimNames.has(p.name)
            return (
              <div
                key={i}
                className="flex flex-col items-center gap-1 w-16"
                style={{ animationDelay: `${i * 0.06}s` }}
              >
                {/* Avatar */}
                <div className={`relative ${isVictim ? 'ring-3 ring-[#ff3333] ring-offset-2 ring-offset-black' : ''} rounded-full`}>
                  <Image
                    src={p.avatarUrl || '/placeholder-avatar.png'}
                    alt={p.name}
                    width={48}
                    height={48}
                    unoptimized
                    className={`w-12 h-12 rounded-full object-cover border-2 ${isVictim ? 'border-[#ff3333]' : 'border-white/30'}`}
                  />
                  {isVictim && (
                    <div className="absolute -top-1 -right-1 text-xs">💀</div>
                  )}
                </div>

                {/* Name */}
                <span className={`text-[10px] font-bold uppercase tracking-wider text-center leading-tight ${isVictim ? 'text-white' : 'text-white/60'}`}
                  style={{ fontFamily: 'var(--font-boogaloo), cursive', textShadow: '1px 1px 2px #000' }}>
                  {p.name.replace('Zịt ', '')}
                </span>

                {/* Role label */}
                {isVictim ? (
                  <span className="text-[9px] font-bold uppercase text-[#ff3333] tracking-widest"
                    style={{ fontFamily: 'var(--font-quicksand), sans-serif' }}>
                    CON DZỊT
                  </span>
                ) : p.usedShield ? (
                  <span className="text-[9px] font-bold uppercase text-[#3dc8ff] tracking-widest"
                    style={{ fontFamily: 'var(--font-quicksand), sans-serif' }}>
                    CÓ KHIÊN
                  </span>
                ) : (
                  <span className="text-[9px] font-bold uppercase text-white/25 tracking-widest"
                    style={{ fontFamily: 'var(--font-quicksand), sans-serif' }}>
                    AN TOÀN
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ===== CENTER: BIG TEXT ===== */}
      <div className={`relative z-10 flex flex-col items-center transition-all duration-700 ${showText ? 'opacity-100 scale-100' : 'opacity-0 scale-75'}`}>
        <h1
          className="font-display leading-none select-none"
          style={{
            fontSize: 'clamp(60px, 12vw, 140px)',
            color: '#ffffff',
            textShadow: `
              4px 4px 0 #000,
              -2px -2px 0 #000,
              2px -2px 0 #000,
              -2px 2px 0 #000,
              0 0 40px rgba(255, 50, 20, 0.6),
              0 0 80px rgba(255, 50, 20, 0.3)
            `,
            letterSpacing: '0.08em',
          }}
        >
          DUCK LOSER
        </h1>

        {verdict && (
          <p className="font-readable text-lg text-white/70 mt-4 text-center max-w-xl italic"
            style={{ textShadow: '1px 1px 4px #000' }}>
            &ldquo;{verdict}&rdquo;
          </p>
        )}
      </div>

      {bossFalls.length > 0 && (
        <div className={`absolute top-[20%] left-1/2 -translate-x-1/2 z-20 transition-all duration-700 ${showBossFall ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-8'}`}>
          <div className="rounded-2xl border-4 border-[#4d0000] bg-[rgba(120,0,0,0.78)] px-8 py-5 shadow-[0_8px_0_#250000,0_22px_36px_rgba(0,0,0,0.55)]">
            <div className="font-display text-2xl md:text-3xl text-white text-outlined text-center">
              👑💔 MỚI GẶP TÝ ÁP LỰC ĐÃ VỤN VỠ
            </div>
            <div className="font-data text-sm md:text-base text-white/85 text-center mt-2">
              {bossFalls.join(' • ')} mất danh hiệu Boss!
            </div>
          </div>
        </div>
      )}

      {(consumedChests.length > 0 || awardedChests.length > 0) && (
        <div className={`absolute right-6 top-24 z-20 w-[320px] transition-all duration-700 ${showChestReport ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-10'}`}>
          <div className="rounded-2xl border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] shadow-[0_6px_0_var(--color-ggd-outline),0_20px_30px_rgba(0,0,0,0.5)]">
            <div className="px-4 py-3 border-b-2 border-[var(--color-ggd-outline)]/30">
              <div className="font-display text-lg text-white text-outlined">🎁 EFFECT REPORT</div>
            </div>
            <div className="p-4 space-y-3">
              {consumedChests.map((chest) => (
                <div key={`consumed-${chest.id}`} className="rounded-xl bg-black/20 p-3 border-2 border-[var(--color-ggd-outline)]/30">
                  <div className="font-body text-sm font-black text-white">{chest.ownerName}</div>
                  <div className="font-data text-xs text-[var(--color-ggd-gold)] mt-1">
                    {chest.effect}
                    {chest.targetName ? ` → ${chest.targetName}` : ''}
                    {chest.outcome === 'success' ? ' ✅' : ' ❌'}
                  </div>
                </div>
              ))}
              {awardedChests.slice(0, 2).map((chest) => (
                <div key={`awarded-${chest.id}`} className="rounded-xl bg-[var(--color-ggd-orange)]/15 p-3 border-2 border-[var(--color-ggd-orange)]/40 overflow-hidden">
                  <div className="font-body text-sm font-black text-white mb-2">{chest.ownerName} nhận rương mới</div>
                  <ChestReveal chestId={chest.id} effect={chest.effect} animated={duration > 0} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ===== BOTTOM: Victim Ducks (Big) ===== */}
      <div className={`relative z-10 pb-10 transition-all duration-700 ${showVictims ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-12'}`}>
        {/* Victim names above their avatars */}
        <div className="flex items-end justify-center gap-16 mb-4">
          {victims.map((v, i) => (
            <div key={i} className="flex flex-col items-center gap-1">
              <span
                className="text-base font-bold uppercase tracking-widest text-white"
                style={{
                  fontFamily: 'var(--font-boogaloo), cursive',
                  textShadow: '2px 2px 0 #000, 0 0 10px rgba(255, 50, 20, 0.5)',
                  letterSpacing: '0.15em',
                }}
              >
                {v.name}
              </span>
              <span
                className="text-sm font-bold uppercase text-[#ff3333] tracking-[0.2em]"
                style={{
                  fontFamily: 'var(--font-quicksand), sans-serif',
                  textShadow: '0 0 8px rgba(255, 50, 20, 0.8)',
                }}
              >
                CON DZỊT
              </span>
            </div>
          ))}
        </div>

        {/* Big victim avatars */}
        <div className="flex items-end justify-center gap-8">
          {victims.map((v, i) => (
            <div
              key={i}
              className="relative animate-slide-up"
              style={{ animationDelay: `${1.5 + i * 0.2}s` }}
            >
              {/* Red glow behind */}
              <div className="absolute -inset-4 bg-[#ff3333] rounded-full blur-2xl opacity-25 animate-pulse" />

              <Image
                src={v.avatarUrl || '/placeholder-avatar.png'}
                alt={v.name}
                width={144}
                height={144}
                unoptimized
                className="w-28 h-28 md:w-36 md:h-36 rounded-full object-cover border-4 border-black relative z-10"
                style={{
                  boxShadow: '0 0 30px rgba(255, 50, 20, 0.4), 0 8px 0 #000',
                  filter: 'saturate(0.7) brightness(0.9)',
                }}
              />

              {/* Crying emoji */}
              <div className="absolute -top-3 -right-2 text-3xl z-20 animate-bob"
                style={{ animationDelay: `${i * 0.3}s` }}>
                😭
              </div>

              {/* Skull at bottom */}
              <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 z-20">
                <span className="bg-[#ff3333] text-white text-xs font-bold px-3 py-1 rounded-full border-2 border-black"
                  style={{ fontFamily: 'var(--font-quicksand), sans-serif', boxShadow: '0 3px 0 #000' }}>
                  💀 LOSER
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
