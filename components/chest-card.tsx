'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import type { ChestEffect } from '@/lib/types'

const effectMeta: Record<ChestEffect, { label: string; svg: string; rarity: 'trash' | 'common' | 'rare' | 'epic'; tagline: string }> = {
  BONUS_SCAR: { label: 'Bonus Scar', svg: '/assets/v2/chest-open.svg', rarity: 'common', tagline: '+1 sẹo ngay lập tức' },
  FRAGILE_SHIELD: { label: 'Fragile Shield', svg: '/assets/v2/shield-cracked.svg', rarity: 'common', tagline: '+1 khiên tạm 1 charge' },
  CLONE_CHAOS: { label: 'Clone Chaos', svg: '/assets/v2/chest-open.svg', rarity: 'common', tagline: 'Race sau toàn lobby +1 clone' },
  SAFE_WEEK: { label: 'Safe Week', svg: '/assets/v2/shield-fresh.svg', rarity: 'common', tagline: 'Race sau shield không decay' },
  REVERSE_RESULTS: { label: 'Reverse Results', svg: '/assets/v2/chest-open.svg', rarity: 'common', tagline: 'Race sau đảo ngược bảng kết quả' },
  LUCKY_CLONE: { label: 'Lucky Clone', svg: '/assets/v2/chest-open.svg', rarity: 'rare', tagline: 'Race sau chủ rương +1 clone' },
  ANTI_SHIELD: { label: 'Anti Shield', svg: '/assets/v2/shield-broken.svg', rarity: 'rare', tagline: 'Race sau toàn lobby cấm dùng shield' },
  CANT_PASS_THOMAS: { label: "Can't Pass Thomas", svg: '/assets/v2/chest-open.svg', rarity: 'rare', tagline: 'Race sau ai vượt Thomas tính thua' },
  GOLDEN_SHIELD: { label: 'Golden Shield', svg: '/assets/v2/shield-fresh.svg', rarity: 'rare', tagline: 'Nhận 1 shield full 3 charge' },
  MORE_PEOPLE_MORE_FUN: { label: 'More People More Fun', svg: '/assets/v2/chest-open.svg', rarity: 'rare', tagline: 'Race sau số người thua tăng thành 3 hoặc 4' },
  NOTHING: { label: 'Legacy Empty', svg: '/assets/v2/effect-nothing.svg', rarity: 'trash', tagline: 'Effect cũ đã ngưng dùng' },
  CURSE_SWAP: { label: 'Legacy Curse Swap', svg: '/assets/v2/effect-curse-swap.svg', rarity: 'trash', tagline: 'Effect cũ đã ngưng dùng' },
  INSURANCE_FRAUD: { label: 'Legacy Insurance', svg: '/assets/v2/effect-insurance-fraud.svg', rarity: 'trash', tagline: 'Effect cũ đã ngưng dùng' },
  IDENTITY_THEFT: { label: 'Legacy Identity', svg: '/assets/v2/effect-identity-theft.svg', rarity: 'trash', tagline: 'Effect cũ đã ngưng dùng' },
  PUBLIC_SHIELD: { label: 'Legacy Public Shield', svg: '/assets/v2/effect-public-shield.svg', rarity: 'trash', tagline: 'Effect cũ đã ngưng dùng' },
  I_CHOOSE_YOU: { label: 'Legacy I Choose You', svg: '/assets/v2/effect-i-choose-you.svg', rarity: 'trash', tagline: 'Effect cũ đã ngưng dùng' },
}

interface ChestCardProps {
  effect: ChestEffect
  chestId?: number
  size?: 'sm' | 'md' | 'lg'
  /** Hiển thị animation reveal: chest đóng → mở → effect bay ra */
  animated?: boolean
  /** Trạng thái "đã mở" - hiện effect SVG. Nếu false: hiện chest đóng */
  opened?: boolean
  /** Hiển thị mô tả effect */
  showTagline?: boolean
  /** Có hover effect không (cho chest đang ngồi tĩnh trong sidebar) */
  interactive?: boolean
}

export function ChestCard({
  effect,
  chestId,
  size = 'md',
  animated = false,
  opened = true,
  showTagline = false,
  interactive = false,
}: ChestCardProps) {
  const meta = effectMeta[effect]
  const [revealed, setRevealed] = useState(!animated || opened === false ? opened : false)

  useEffect(() => {
    if (!animated || !opened) {
      const timer = window.setTimeout(() => setRevealed(opened), 0)
      return () => window.clearTimeout(timer)
    }
    const timer = window.setTimeout(() => setRevealed(true), 700)
    return () => window.clearTimeout(timer)
  }, [animated, opened])

  const dims = size === 'sm'
    ? { box: 32, icon: 24, padding: 'px-2 py-1.5', title: 'text-[11px]', tag: 'text-[9px]', tagline: 'text-[10px]' }
    : size === 'lg'
      ? { box: 64, icon: 48, padding: 'px-4 py-3', title: 'text-base', tag: 'text-xs', tagline: 'text-xs' }
      : { box: 48, icon: 36, padding: 'px-3 py-2', title: 'text-sm', tag: 'text-[10px]', tagline: 'text-[11px]' }

  const showOpened = revealed && opened
  const iconSrc = showOpened ? meta.svg : '/assets/v2/chest-closed.svg'

  return (
    <div
      className={`chest-card chest-rarity-${meta.rarity} ${dims.padding} ${interactive ? 'is-interactive' : ''} ${revealed && opened ? 'is-revealed' : ''}`}
      title={`${meta.label} · ${meta.tagline}`}
    >
      <div
        className={`chest-icon-box ${animated && showOpened ? 'is-revealing' : !showOpened ? 'is-bobbing' : ''}`}
        style={{ width: dims.box, height: dims.box }}
        key={showOpened ? 'open' : 'closed'}
      >
        <Image
          src={iconSrc}
          alt={meta.label}
          width={dims.icon}
          height={dims.icon}
          unoptimized
        />
      </div>
      <div className="flex flex-col gap-0.5 min-w-0">
        <div className={`font-display ${dims.title} text-white leading-tight whitespace-nowrap text-outlined`}>
          {showOpened ? meta.label : 'Rương đóng'}
        </div>
        <div className="flex items-center gap-1.5">
          {chestId !== undefined && (
            <span className={`font-data ${dims.tag} font-black text-white/70`}>#{chestId}</span>
          )}
          <span className={`font-data ${dims.tag} font-black uppercase tracking-wider`}
            style={{
              color: meta.rarity === 'trash' ? 'rgba(255,255,255,0.4)'
                : meta.rarity === 'common' ? 'var(--color-ggd-neon-green)'
                  : meta.rarity === 'rare' ? 'var(--color-ggd-gold)'
                    : 'var(--color-ggd-hot-pink)',
            }}
          >
            {meta.rarity === 'trash' ? '· trash' : meta.rarity === 'common' ? '· common' : meta.rarity === 'rare' ? '· rare' : '· epic'}
          </span>
        </div>
        {showTagline && showOpened && (
          <div className={`font-readable ${dims.tagline} text-white/65 leading-snug mt-0.5`}>{meta.tagline}</div>
        )}
      </div>
    </div>
  )
}

export const chestEffectMeta = effectMeta
