import type { ButtonHTMLAttributes, ReactNode } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { uiIconPath, type UiIconName } from '@/lib/race-fx/manifest'

/* eslint-disable @next/next/no-img-element -- tiny static SVG icons */

/**
 * Pond UI — the game-lobby kit. Same ink outline (#1B132B), hard drop shadows and top-right light
 * as the race canvas and cosmetics art. Styles live in app/globals.css (`gx-*`).
 */

export type Tone = 'pond' | 'gold' | 'mint' | 'sky' | 'rose' | 'violet' | 'dark'
export type ButtonVariant = 'gold' | 'mint' | 'sky' | 'rose' | 'violet' | 'ghost'

export function UiIcon({ name, size = 28, className }: { name: UiIconName; size?: number; className?: string }) {
  return <img src={uiIconPath(name)} alt="" aria-hidden width={size} height={size} draggable={false} className={cn('shrink-0 select-none', className)} />
}

const KICKER_COLOR: Record<Tone, string> = {
  pond: 'text-[#a5f3fc]', gold: 'text-[#ffe58a]', mint: 'text-[#86efac]', sky: 'text-[#7dd3fc]', rose: 'text-[#fda4af]', violet: 'text-[#c4b5fd]', dark: 'text-white/55',
}

export function GamePanel({ tone = 'pond', icon, kicker, title, actions, children, className, bodyClassName, id }: {
  tone?: Tone
  icon?: UiIconName
  kicker?: ReactNode
  title?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  className?: string
  bodyClassName?: string
  id?: string
}) {
  return (
    <section id={id} data-tone={tone === 'pond' ? undefined : tone} className={cn('gx-panel', className)}>
      {(title || kicker || actions) && (
        <header className="relative flex flex-wrap items-center justify-between gap-3 px-5 pt-5 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            {icon && (
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border-[3px] border-[var(--gx-ink)] bg-[linear-gradient(180deg,#fff7d6,#ffe58a)] shadow-[0_4px_0_var(--gx-ink),inset_0_2px_0_#fff]">
                <UiIcon name={icon} size={32} />
              </span>
            )}
            <div className="min-w-0">
              {kicker && <div className={cn('gx-kicker', KICKER_COLOR[tone])}>{kicker}</div>}
              {title && <h2 className="gx-title mt-0.5 text-2xl sm:text-3xl">{title}</h2>}
            </div>
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn('relative p-5 sm:p-6', (title || kicker) && 'pt-4', bodyClassName)}>{children}</div>
    </section>
  )
}

export function GameButton({ variant = 'gold', size = 'md', icon, className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: 'sm' | 'md' | 'lg'
  icon?: UiIconName
}) {
  return (
    <button data-variant={variant === 'gold' ? undefined : variant} data-size={size} className={cn('gx-btn', className)} {...props}>
      {icon && <UiIcon name={icon} size={size === 'lg' ? 30 : size === 'sm' ? 20 : 24} />}
      {children}
    </button>
  )
}

export function GameLink({ variant = 'gold', size = 'md', icon, className, children, href }: {
  variant?: ButtonVariant
  size?: 'sm' | 'md' | 'lg'
  icon?: UiIconName
  className?: string
  children: ReactNode
  href: string
}) {
  return (
    <Link href={href} data-variant={variant === 'gold' ? undefined : variant} data-size={size} className={cn('gx-btn', className)}>
      {icon && <UiIcon name={icon} size={size === 'lg' ? 30 : size === 'sm' ? 20 : 24} />}
      {children}
    </Link>
  )
}

export function ResourcePill({ icon, value, label, className }: { icon: UiIconName; value: ReactNode; label?: string; className?: string }) {
  return (
    <span className={cn('gx-chip', className)} title={label}>
      <UiIcon name={icon} size={24} />
      <span className="font-data tabular-nums">{value}</span>
      {label && <span className="sr-only">{label}</span>}
    </span>
  )
}

export function StatTile({ icon, label, value, accent = 'text-white' }: { icon: UiIconName; label: ReactNode; value: ReactNode; accent?: string }) {
  return (
    <div className="gx-well flex items-center gap-3 p-3">
      <UiIcon name={icon} size={38} className="drop-shadow-[0_3px_0_var(--gx-ink)]" />
      <div className="min-w-0">
        <div className={cn('gx-title text-3xl', accent)}>{value}</div>
        <div className="mt-1 flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-white/55">{label}</div>
      </div>
    </div>
  )
}

export function Progress({ value, max = 100, className, barClassName }: { value: number; max?: number; className?: string; barClassName?: string }) {
  const percent = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0
  return (
    <div className={cn('gx-progress', className)} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <span className={barClassName} style={{ width: `${percent}%` }} />
    </div>
  )
}

/** A quest-log style checklist row. */
export function QuestRow({ done, label, detail, action }: { done: boolean; label: ReactNode; detail?: ReactNode; action?: ReactNode }) {
  return (
    <div className={cn('gx-well flex items-center gap-3 p-3', done && 'border-[#15803d]/60 bg-[#14532d]/30')}>
      <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-full border-[3px] border-[var(--gx-ink)] text-lg font-black shadow-[0_3px_0_var(--gx-ink)]', done ? 'bg-[var(--gx-mint)] text-[var(--gx-ink)]' : 'bg-[#2f2463] text-white/40')}>
        {done ? '✓' : '•'}
      </span>
      <div className="min-w-0 flex-1">
        <div className={cn('font-black', done ? 'text-[#bbf7d0]' : 'text-white')}>{label}</div>
        {detail && <div className="text-xs text-white/60">{detail}</div>}
      </div>
      {action}
    </div>
  )
}

/** Fixed pond scene behind Season 3 pages — same world as the race canvas. */
export function PondBackground() {
  const wave = (color: string, opacity: number) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='480' height='160' viewBox='0 0 480 160'><path d='M0 40 C80 10 160 70 240 40 C320 10 400 70 480 40 V160 H0 Z' fill='${color}' fill-opacity='${opacity}'/></svg>`)}")`
  const pads = [[6, 70, 48, 9], [84, 62, 40, 12], [16, 88, 36, 11], [70, 84, 56, 14], [46, 92, 30, 10], [92, 90, 34, 13]]
  const bubbles = [[12, 10, 14], [28, 6, 18], [44, 12, 11], [63, 8, 20], [78, 14, 13], [90, 9, 16]]
  return (
    <div aria-hidden className="gx-pond">
      <div className="gx-pond-rays" />
      <div className="gx-pond-wave" style={{ bottom: '24%', backgroundImage: wave('#2493c7', 0.35), animationDuration: '18s' }} />
      <div className="gx-pond-wave" style={{ bottom: '12%', backgroundImage: wave('#1a78ab', 0.55), animationDuration: '13s' }} />
      <div className="gx-pond-wave" style={{ bottom: '-2%', backgroundImage: wave('#135d87', 0.8), animationDuration: '9s' }} />
      {pads.map(([left, top, size, duration], index) => (
        <img key={index} src="/race-fx/decor/lilypad.svg" alt="" className="gx-pond-pad" style={{ left: `${left}%`, top: `${top}%`, width: size, animationDuration: `${duration}s`, animationDelay: `${-index * 2}s` }} />
      ))}
      {bubbles.map(([left, duration, size], index) => (
        <span key={index} className="gx-pond-bubble" style={{ left: `${left}%`, width: size, height: size, animationDuration: `${duration}s`, animationDelay: `${-index * 1.7}s` }} />
      ))}
    </div>
  )
}
