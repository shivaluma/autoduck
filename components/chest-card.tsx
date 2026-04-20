'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import type { ChestEffect } from '@/lib/types'

const effectMeta: Record<ChestEffect, { label: string; svg: string; rarity: 'trash' | 'common' | 'rare' | 'epic'; tagline: string }> = {
  NOTHING: { label: 'Trống Trơn', svg: '/assets/v2/effect-nothing.svg', rarity: 'trash', tagline: 'Không có gì xảy ra' },
  CURSE_SWAP: { label: 'Curse Swap', svg: '/assets/v2/effect-curse-swap.svg', rarity: 'common', tagline: 'Đổi tên với target' },
  INSURANCE_FRAUD: { label: 'Insurance Fraud', svg: '/assets/v2/effect-insurance-fraud.svg', rarity: 'rare', tagline: 'Kéo target xuống nếu cùng làm dzịt' },
  IDENTITY_THEFT: { label: 'Identity Theft', svg: '/assets/v2/effect-identity-theft.svg', rarity: 'rare', tagline: 'Spawn shadow clone, lấy rank tốt nhất' },
  PUBLIC_SHIELD: { label: 'Public Shield', svg: '/assets/v2/effect-public-shield.svg', rarity: 'common', tagline: 'Mượn khiên của target' },
  I_CHOOSE_YOU: { label: 'I Choose You', svg: '/assets/v2/effect-i-choose-you.svg', rarity: 'epic', tagline: 'Target P1 → tặng owner 1 khiên' },
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
      setRevealed(opened)
      return
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
