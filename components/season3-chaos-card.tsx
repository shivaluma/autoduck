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
  NORMAL: { icon: '🏁', label: 'NORMAL', rule: '2 vịt về chậm nhất (Bottom 2) bị làm dzịt.', tone: 'from-emerald-400/30 via-emerald-950/50 to-black/20', accent: 'text-[var(--color-ggd-neon-green)]', },
  REVERSE: { icon: '🔄', label: 'REVERSE', rule: 'Đảo ngược: 2 vịt về ĐẦU TIÊN (Top 2) bị làm dzịt.', tone: 'from-sky-400/30 via-sky-950/50 to-black/20', accent: 'text-[var(--color-ggd-sky)]', },
  DUO: { icon: '🤝', label: 'DUO', rule: 'Cặp/Nhóm có thứ hạng trung bình tệ nhất cùng bị làm dzịt.', tone: 'from-violet-400/35 via-violet-950/50 to-black/20', accent: 'text-[var(--color-ggd-lavender)]', },
  TRIPLE_ELIMINATION: { icon: '💀', label: 'TRIPLE ELIMINATION', rule: '3 vịt về chậm nhất (Bottom 3) bị làm dzịt.', tone: 'from-rose-500/35 via-rose-950/55 to-black/20', accent: 'text-[var(--color-ggd-hot-pink)]', },
  CUT_LINE: { icon: '🚧', label: 'CUT LINE', rule: 'Top 50% an toàn. Nửa sau đoàn đua cùng bị làm dzịt.', tone: 'from-orange-400/35 via-orange-950/55 to-black/20', accent: 'text-[var(--color-ggd-orange)]', },
  CONSTRUCTORS: { icon: '🏎️', label: 'CONSTRUCTORS', rule: 'Đội có thứ hạng trung bình tệ hơn cùng bị làm dzịt (nếu hòa cả 2 đội cùng thua).', tone: 'from-yellow-400/35 via-yellow-950/55 to-black/20', accent: 'text-[var(--color-ggd-gold)]', },
  BOUNTY_HUNT: { icon: '🎯', label: 'BOUNTY HUNT', rule: 'Wanted lọt Top 50% = An toàn (Bottom 2 thua). Không lọt Top 50% = Wanted và tất cả người xếp sau cùng bị làm dzịt.', tone: 'from-fuchsia-500/35 via-fuchsia-950/55 to-black/20', accent: 'text-[var(--color-ggd-hot-pink)]', },
}

function RankChip({ children, danger = false }: { children: ReactNode; danger?: boolean }) {
  return <span className={cn('inline-flex min-w-9 items-center justify-center rounded-lg border-2 px-2 py-1 text-xs font-black', danger ? 'border-[var(--color-ggd-orange)] bg-[var(--color-ggd-orange)]/20 text-[var(--color-ggd-orange)]' : 'border-white/15 bg-white/10 text-white/80')}>{children}</span>
}

function RuleVisual({ type, targetName, groups }: { type: string; targetName?: string | null; groups?: string[][] }) {
  if (type === 'REVERSE') return <div className="flex items-center gap-2"><div className="flex gap-2"><RankChip danger>#1 VỀ ĐẦU</RankChip><RankChip danger>#2 VỀ NHÌ</RankChip></div><span className="text-2xl text-white/50">→</span><span className="rounded-lg bg-[var(--color-ggd-orange)]/20 px-3 py-2 text-xs font-black text-[var(--color-ggd-orange)]">BỊ LÀM DZỊT</span></div>
  if (type === 'TRIPLE_ELIMINATION') return <div className="flex items-center gap-2"><span className="text-xs font-black text-white/60">3 VỊT BÉT</span><div className="flex gap-2"><RankChip danger>#N</RankChip><RankChip danger>#N−1</RankChip><RankChip danger>#N−2</RankChip></div><span className="text-xs font-black text-[var(--color-ggd-orange)]">BỊ LÀM DZỊT</span></div>
  if (type === 'CUT_LINE') return <div className="flex items-center gap-2"><div className="rounded-lg border-2 border-[var(--color-ggd-neon-green)]/50 bg-[var(--color-ggd-neon-green)]/10 px-3 py-2 text-xs font-black text-[var(--color-ggd-neon-green)]">TOP 50%<br /><span className="text-[10px] text-white/60">AN TOÀN</span></div><span className="text-2xl text-white/50">|</span><div className="rounded-lg border-2 border-[var(--color-ggd-orange)]/50 bg-[var(--color-ggd-orange)]/10 px-3 py-2 text-xs font-black text-[var(--color-ggd-orange)]">NỬA SAU 50%<br /><span className="text-[10px] text-white/60">BỊ LÀM DZỊT</span></div></div>
  if (type === 'BOUNTY_HUNT') return <div className="flex flex-wrap items-center gap-2"><span className="rounded-lg border-2 border-[var(--color-ggd-hot-pink)]/50 bg-[var(--color-ggd-hot-pink)]/10 px-3 py-2 text-xs font-black text-[var(--color-ggd-hot-pink)]">🎯 MỤC TIÊU: {targetName ?? 'VỊT BỊ TRUY NÃ'}</span><span className="text-xl text-white/50">→</span><span className="text-xs font-black text-white/70">TOP 50% = AN TOÀN</span></div>
  if (type === 'DUO' || type === 'CONSTRUCTORS') return <div className="flex flex-wrap items-center gap-2">{(groups ?? []).map((group, index) => <div key={`${index}-${group.join('-')}`} className="flex items-center gap-1 rounded-lg border-2 border-white/15 bg-white/10 px-2 py-1"><span className="text-[10px] font-black text-white/50">{type === 'DUO' ? `CẶP ${index + 1}` : `TEAM ${String.fromCharCode(65 + index)}`}</span>{group.map((name) => <span key={name} className="rounded bg-black/25 px-2 py-1 text-xs font-black text-white">{name}</span>)}</div>)}<span className="text-xs font-black text-white/60">→ THỨ HẠNG TRUNG BÌNH TỆ NHẤT BỊ LÀM DZỊT</span></div>
  return <div className="flex items-center gap-2"><RankChip danger>#N−1</RankChip><RankChip danger>#N (BÉT)</RankChip><span className="text-xs font-black text-[var(--color-ggd-orange)]">→ BỊ LÀM DZỊT</span></div>
}

const CARD_TONE: Record<string, 'mint' | 'sky' | 'violet' | 'rose' | 'gold'> = {
  NORMAL: 'mint', REVERSE: 'sky', DUO: 'violet', TRIPLE_ELIMINATION: 'rose', CUT_LINE: 'gold', CONSTRUCTORS: 'gold', BOUNTY_HUNT: 'rose',
}

export function Season3ChaosCard({ type, weekNumber, targetName, groups, predictionCount, playerCount, compact = false }: ChaosCardProps) {
  const spec = specs[type] ?? specs.NORMAL
  const tone = CARD_TONE[type] ?? 'violet'
  return <section data-tone={tone} className={cn('gx-panel overflow-hidden p-5 sm:p-6', compact ? 'sm:p-4' : '')}>
    <div aria-hidden className="pointer-events-none absolute -right-6 -top-10 rotate-12 text-[10rem] opacity-[0.12]">{spec.icon}</div>
    <div className="relative z-[1] flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 flex-1 items-start gap-4">
        <div className="relative grid h-20 w-16 shrink-0 rotate-[-6deg] place-items-center rounded-2xl border-[3px] border-[var(--gx-ink)] bg-[linear-gradient(160deg,#fff7d6,#ffd84d)] text-4xl shadow-[0_5px_0_var(--gx-ink),inset_0_2px_0_#fff] sm:h-24 sm:w-[76px] sm:text-5xl">
          <span className="drop-shadow-[0_2px_0_rgba(27,19,43,.4)]">{spec.icon}</span>
          <span className="absolute -bottom-2 rounded-md border-2 border-[var(--gx-ink)] bg-[var(--gx-ink)] px-1.5 text-[9px] font-black tracking-widest text-[var(--gx-gold)]">CHAOS</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className={cn('gx-kicker', spec.accent)}>TUẦN {weekNumber} · CHAOS CARD</div>
          <h2 className="gx-title mt-1 break-words text-3xl text-white min-[430px]:text-4xl sm:text-5xl">{spec.label}</h2>
          <p className="mt-2 max-w-xl text-base font-bold text-white/85">{spec.rule}</p>
        </div>
      </div>
    </div>
    <div className="gx-well relative z-[1] mt-5 p-4">
      <div className="gx-kicker mb-3 text-white/50">LUẬT TUẦN NÀY</div>
      <RuleVisual type={type} targetName={targetName} groups={groups} />
    </div>
    {typeof predictionCount === 'number' && typeof playerCount === 'number' && <div className="relative z-[1] mt-4 flex flex-wrap items-center gap-3 text-sm">
      <span className="font-black text-white/75">🔮 Dự đoán đã khóa</span>
      <div className="gx-progress min-w-32 flex-1"><span style={{ width: `${playerCount ? Math.min(100, (predictionCount / playerCount) * 100) : 0}%`, background: 'linear-gradient(180deg,#f5d0fe,#a855f7)' }} /></div>
      <span className="font-data font-black text-white">{predictionCount}/{playerCount}</span>
    </div>}
  </section>
}
