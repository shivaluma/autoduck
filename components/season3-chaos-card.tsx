import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type ChaosCardProps = {
  type: string
  weekNumber: number
  targetName?: string | null
  groups?: string[][]
  predictionCount?: number
  playerCount?: number
  compact?: boolean
}

const specs: Record<string, {
  icon: string
  label: string
  rule: string
  tone: string
  accent: string
}> = {
  NORMAL: { icon: '🏁', label: 'NORMAL', rule: 'Bottom 2 raw thua', tone: 'from-emerald-400/30 via-emerald-950/50 to-black/20', accent: 'text-[var(--color-ggd-neon-green)]', },
  REVERSE: { icon: '🔄', label: 'REVERSE', rule: 'Raw Top 2 bị đảo thành loser', tone: 'from-sky-400/30 via-sky-950/50 to-black/20', accent: 'text-[var(--color-ggd-sky)]', },
  DUO: { icon: '🤝', label: 'DUO', rule: 'Duo có tổng rank tệ nhất thua cả cặp', tone: 'from-violet-400/35 via-violet-950/50 to-black/20', accent: 'text-[var(--color-ggd-lavender)]', },
  TRIPLE_ELIMINATION: { icon: '💀', label: 'TRIPLE ELIMINATION', rule: 'Bottom 3 raw cùng ăn Sẹo', tone: 'from-rose-500/35 via-rose-950/55 to-black/20', accent: 'text-[var(--color-ggd-hot-pink)]', },
  CUT_LINE: { icon: '🚧', label: 'CUT LINE', rule: 'Chỉ Top 50% qualify — phần còn lại thua', tone: 'from-orange-400/35 via-orange-950/55 to-black/20', accent: 'text-[var(--color-ggd-orange)]', },
  CONSTRUCTORS: { icon: '🏎️', label: 'CONSTRUCTORS', rule: 'Team có tổng rank tệ hơn thua cả team', tone: 'from-yellow-400/35 via-yellow-950/55 to-black/20', accent: 'text-[var(--color-ggd-gold)]', },
  BOUNTY_HUNT: { icon: '🎯', label: 'BOUNTY HUNT', rule: 'Wanted phải thoát vào Top 50%', tone: 'from-fuchsia-500/35 via-fuchsia-950/55 to-black/20', accent: 'text-[var(--color-ggd-hot-pink)]', },
}

function RankChip({ children, danger = false }: { children: ReactNode; danger?: boolean }) {
  return <span className={cn('inline-flex min-w-9 items-center justify-center rounded-lg border-2 px-2 py-1 text-xs font-black', danger ? 'border-[var(--color-ggd-orange)] bg-[var(--color-ggd-orange)]/20 text-[var(--color-ggd-orange)]' : 'border-white/15 bg-white/10 text-white/80')}>{children}</span>
}

function RuleVisual({ type, targetName, groups }: { type: string; targetName?: string | null; groups?: string[][] }) {
  if (type === 'REVERSE') return <div className="flex items-center gap-2"><div className="flex gap-2"><RankChip danger>RAW #1</RankChip><RankChip danger>RAW #2</RankChip></div><span className="text-2xl text-white/50">→</span><span className="rounded-lg bg-[var(--color-ggd-orange)]/20 px-3 py-2 text-xs font-black text-[var(--color-ggd-orange)]">LOSERS</span></div>
  if (type === 'TRIPLE_ELIMINATION') return <div className="flex items-center gap-2"><span className="text-xs font-black text-white/60">BOTTOM</span><div className="flex gap-2"><RankChip danger>#N</RankChip><RankChip danger>#N−1</RankChip><RankChip danger>#N−2</RankChip></div></div>
  if (type === 'CUT_LINE') return <div className="flex items-center gap-2"><div className="rounded-lg border-2 border-[var(--color-ggd-neon-green)]/50 bg-[var(--color-ggd-neon-green)]/10 px-3 py-2 text-xs font-black text-[var(--color-ggd-neon-green)]">TOP 50%<br /><span className="text-[10px] text-white/60">QUALIFY</span></div><span className="text-2xl text-white/50">|</span><div className="rounded-lg border-2 border-[var(--color-ggd-orange)]/50 bg-[var(--color-ggd-orange)]/10 px-3 py-2 text-xs font-black text-[var(--color-ggd-orange)]">BOTTOM 50%<br /><span className="text-[10px] text-white/60">LOSERS</span></div></div>
  if (type === 'BOUNTY_HUNT') return <div className="flex flex-wrap items-center gap-2"><span className="rounded-lg border-2 border-[var(--color-ggd-hot-pink)]/50 bg-[var(--color-ggd-hot-pink)]/10 px-3 py-2 text-xs font-black text-[var(--color-ggd-hot-pink)]">🎯 WANTED: {targetName ?? 'RANDOM DUCK'}</span><span className="text-xl text-white/50">→</span><span className="text-xs font-black text-white/70">TOP 50% = ESCAPED</span></div>
  if (type === 'DUO' || type === 'CONSTRUCTORS') return <div className="flex flex-wrap items-center gap-2">{(groups ?? []).map((group, index) => <div key={`${index}-${group.join('-')}`} className="flex items-center gap-1 rounded-lg border-2 border-white/15 bg-white/10 px-2 py-1"><span className="text-[10px] font-black text-white/50">{type === 'DUO' ? `DUO ${index + 1}` : `TEAM ${String.fromCharCode(65 + index)}`}</span>{group.map((name) => <span key={name} className="rounded bg-black/25 px-2 py-1 text-xs font-black text-white">{name}</span>)}</div>)}<span className="text-xs font-black text-white/60">→ WORST TOTAL LOSES</span></div>
  return <div className="flex items-center gap-2"><RankChip danger>RAW #N−1</RankChip><RankChip danger>RAW #N</RankChip><span className="text-xs font-black text-[var(--color-ggd-orange)]">→ SẸO</span></div>
}

export function Season3ChaosCard({ type, weekNumber, targetName, groups, predictionCount, playerCount, compact = false }: ChaosCardProps) {
  const spec = specs[type] ?? specs.NORMAL
  return <section className={cn('relative overflow-hidden rounded-[2rem] border-4 border-[var(--color-ggd-outline)] bg-gradient-to-br p-5 shadow-[0_8px_0_var(--color-ggd-outline)]', spec.tone, compact ? 'p-4' : 'p-6')}>
    <div className="pointer-events-none absolute -right-8 -top-12 text-[9rem] opacity-10 grayscale">{spec.icon}</div>
    <div className="relative z-[1] flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-start gap-4">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border-2 border-white/20 bg-black/25 text-4xl shadow-inner">{spec.icon}</div>
        <div>
          <div className={cn('text-xs font-black tracking-[0.25em]', spec.accent)}>WEEK {weekNumber} • THIS WEEK&apos;S CHAOS</div>
          <h2 className="mt-1 font-display text-4xl leading-none text-white">{spec.label}</h2>
          <p className="mt-2 max-w-xl text-base font-bold text-white/85">{spec.rule}</p>
        </div>
      </div>
      <span className="rounded-full border border-white/20 bg-black/25 px-3 py-1 text-[10px] font-black tracking-widest text-white/70">ONE TWIST ONLY</span>
    </div>
    <div className="relative z-[1] mt-6 rounded-2xl border-2 border-white/10 bg-black/25 p-4">
      <div className="mb-3 text-[10px] font-black tracking-[0.2em] text-white/45">HOW THIS WEEK WORKS</div>
      <RuleVisual type={type} targetName={targetName} groups={groups} />
    </div>
    {typeof predictionCount === 'number' && typeof playerCount === 'number' && <div className="relative z-[1] mt-4 flex flex-wrap items-center justify-between gap-3 text-sm"><span className="text-white/65">🔮 Secret predictions</span><span className="font-black text-white">{predictionCount}/{playerCount} locked</span><div className="h-2 min-w-32 flex-1 overflow-hidden rounded-full bg-black/30"><div className={cn('h-full rounded-full transition-all', spec.accent.replace('text-', 'bg-'))} style={{ width: `${playerCount ? Math.min(100, (predictionCount / playerCount) * 100) : 0}%` }} /></div></div>}
  </section>
}
