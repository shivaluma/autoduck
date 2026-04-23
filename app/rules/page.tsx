import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'AutoDuck V2 Rules',
  description: 'Reward Chest, Boss Duck và item rules của AutoDuck V2.',
}

const tierRates = [
  { streak: '3', common: 70, rare: 30 },
  { streak: '4', common: 60, rare: 40 },
  { streak: '5', common: 50, rare: 50 },
  { streak: '6', common: 40, rare: 60 },
  { streak: '7+', common: 30, rare: 70 },
]

const commonItems = [
  { icon: '🤕', name: 'Bonus Scar', rate: '28%', effect: '+1 sẹo ngay lập tức', tone: 'from-orange-500/35 to-red-900/25' },
  { icon: '🛡️', name: 'Fragile Shield', rate: '24%', effect: '+1 khiên tạm 1 charge, tuần sau không dùng sẽ vỡ', tone: 'from-sky-400/35 to-cyan-950/25' },
  { icon: '🐣', name: 'Clone Chaos', rate: '18%', effect: 'Race sau toàn lobby +1 clone', tone: 'from-lime-400/30 to-emerald-950/25' },
  { icon: '🌿', name: 'Safe Week', rate: '15%', effect: 'Race sau shield không decay', tone: 'from-green-400/30 to-teal-950/25' },
  { icon: '🌀', name: 'Reverse Results', rate: '15%', effect: 'Race sau đảo ngược bảng kết quả', tone: 'from-indigo-400/30 to-violet-950/25' },
]

const rareItems = [
  { icon: '🐥', name: 'Lucky Clone', rate: '28%', effect: 'Race sau chỉ người nhận +1 clone', tone: 'from-yellow-300/35 to-orange-950/25' },
  { icon: '🚫', name: 'Anti Shield', rate: '22%', effect: 'Race sau toàn lobby cấm dùng shield', tone: 'from-red-500/35 to-rose-950/25' },
  { icon: '👑', name: "Can't Pass Thomas", rate: '18%', effect: 'Race sau ai vượt Thomas tính thua', tone: 'from-amber-300/35 to-stone-950/25' },
  { icon: '✨', name: 'Golden Shield', rate: '17%', effect: 'Nhận 1 shield full 3 charge', tone: 'from-yellow-300/45 to-yellow-900/20' },
  { icon: '🎪', name: 'More People More Fun', rate: '15%', effect: 'Race sau số người thua tăng thành 3 hoặc 4', tone: 'from-pink-400/35 to-fuchsia-950/25' },
]

const flowSteps = [
  { step: '01', title: 'Boss Duck bị hạ', text: 'Nếu Boss hoặc clone Boss dính nhóm thua, Boss mất ngôi và nhận 1 Reward Chest.' },
  { step: '02', title: 'Roll rarity theo streak', text: 'Boss sống càng lâu thì Rare rate càng cao. 7+ streak lên tới 70% Rare.' },
  { step: '03', title: 'Apply item', text: 'Inventory item ăn ngay. Modifier item nằm pending cho race kế tiếp.' },
  { step: '04', title: 'Race kế tiếp kích hoạt', text: 'Pending modifier tự apply trước race, resolve xong sẽ auto clear.' },
]

function RateBar({ common, rare }: { common: number; rare: number }) {
  return (
    <div className="h-5 overflow-hidden rounded-full border-3 border-[var(--color-ggd-outline)] bg-black/35 shadow-[inset_0_2px_0_rgba(255,255,255,0.12)]">
      <div className="flex h-full">
        <div
          className="bg-[var(--color-ggd-neon-green)]"
          style={{ width: `${common}%` }}
          title={`Common ${common}%`}
        />
        <div
          className="bg-[var(--color-ggd-gold)]"
          style={{ width: `${rare}%` }}
          title={`Rare ${rare}%`}
        />
      </div>
    </div>
  )
}

function ItemCard({ item, rarity }: { item: typeof commonItems[number]; rarity: 'common' | 'rare' }) {
  return (
    <div className={`rounded-2xl border-4 border-[var(--color-ggd-outline)] bg-gradient-to-br ${item.tone} p-4 shadow-[0_5px_0_var(--color-ggd-outline),0_18px_28px_rgba(0,0,0,0.45)]`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border-3 border-[var(--color-ggd-outline)] bg-black/35 text-2xl shadow-[inset_0_2px_0_rgba(255,255,255,0.12)]">
            {item.icon}
          </div>
          <div className="min-w-0">
            <div className="font-display text-lg text-white text-outlined leading-tight">{item.name}</div>
            <div className={`font-data text-[10px] uppercase tracking-widest font-black ${rarity === 'rare' ? 'text-[var(--color-ggd-gold)]' : 'text-[var(--color-ggd-neon-green)]'}`}>
              {rarity} item
            </div>
          </div>
        </div>
        <div className={`rounded-full border-3 border-[var(--color-ggd-outline)] px-3 py-1 font-display text-base ${rarity === 'rare' ? 'bg-[var(--color-ggd-gold)] text-[var(--color-ggd-outline)]' : 'bg-[var(--color-ggd-neon-green)] text-[var(--color-ggd-outline)]'}`}>
          {item.rate}
        </div>
      </div>
      <p className="mt-4 font-readable text-sm leading-relaxed text-white/82">{item.effect}</p>
    </div>
  )
}

export default function RulesPage() {
  return (
    <div className="min-h-screen bg-transparent bubble-bg text-white">
      <div className="neon-divider" />

      <header className="border-b-4 border-[var(--color-ggd-outline)]">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-5">
          <Link href="/" className="font-data text-sm text-[var(--color-ggd-muted)] transition-colors hover:text-white">
            ← Về Chuồng
          </Link>
          <Link
            href="/race/new"
            className="ggd-btn bg-[var(--color-ggd-neon-green)] px-5 py-2 text-sm text-[var(--color-ggd-outline)]"
          >
            🦆 Setup Race
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8 space-y-8">
        <section className="relative overflow-hidden rounded-[28px] border-5 border-[var(--color-ggd-outline)] bg-[radial-gradient(circle_at_12%_18%,rgba(255,204,0,0.22),transparent_30%),radial-gradient(circle_at_84%_24%,rgba(61,255,143,0.18),transparent_28%),linear-gradient(135deg,rgba(33,24,76,0.94),rgba(17,13,38,0.98))] p-7 shadow-[0_10px_0_var(--color-ggd-outline),0_26px_50px_rgba(0,0,0,0.55)]">
          <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
            <div>
              <div className="ggd-tag inline-flex bg-[var(--color-ggd-gold)] text-[var(--color-ggd-outline)]">🎁 Reward Chest System</div>
              <h1 className="mt-5 font-display text-5xl leading-none text-white text-outlined md:text-7xl">
                Duck Race <span className="text-[var(--color-ggd-neon-green)]">V2.0</span>
              </h1>
              <p className="mt-5 max-w-2xl font-readable text-lg leading-relaxed text-white/78">
                Item system mới tập trung vào moment vui, tác động nhẹ tới race, không toxic target cá nhân. Common hữu ích nhưng không OP, Rare tạo khoảnh khắc cả team hú.
              </p>
            </div>
            <div className="rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-black/25 p-5 shadow-[inset_0_2px_0_rgba(255,255,255,0.12)]">
              <div className="font-display text-2xl text-[var(--color-ggd-gold)] text-outlined">Core Loop</div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                {[
                  ['👑', 'Hạ Boss'],
                  ['🎲', 'Roll Chest'],
                  ['⚡', 'Race sau kích hoạt'],
                  ['🧹', 'Auto clear'],
                ].map(([icon, label]) => (
                  <div key={label} className="rounded-2xl border-3 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] p-4 text-center">
                    <div className="text-3xl">{icon}</div>
                    <div className="mt-2 font-data text-xs font-black uppercase text-white/72">{label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="ggd-card-gold ggd-stripe p-6">
            <div className="font-display text-3xl text-[var(--color-ggd-gold)] text-outlined">👑 Boss Streak Rate</div>
            <p className="mt-2 font-readable text-sm text-white/70">Boss càng sống lâu, reward càng dễ nổ Rare.</p>
            <div className="mt-5 space-y-4">
              {tierRates.map((tier) => (
                <div key={tier.streak} className="rounded-2xl border-3 border-[var(--color-ggd-outline)] bg-black/20 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="font-display text-xl text-white text-outlined">{tier.streak}/3 streak</div>
                    <div className="font-data text-xs font-black text-white/70">
                      <span className="text-[var(--color-ggd-neon-green)]">{tier.common}% Common</span>
                      <span className="px-2">/</span>
                      <span className="text-[var(--color-ggd-gold)]">{tier.rare}% Rare</span>
                    </div>
                  </div>
                  <RateBar common={tier.common} rare={tier.rare} />
                </div>
              ))}
            </div>
          </div>

          <div className="ggd-card-green p-6">
            <div className="font-display text-3xl text-[var(--color-ggd-neon-green)] text-outlined">🧭 Weekly Flow</div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {flowSteps.map((step) => (
                <div key={step.step} className="rounded-2xl border-3 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] p-4 shadow-[0_4px_0_var(--color-ggd-outline)]">
                  <div className="font-data text-xs font-black text-[var(--color-ggd-muted)]">STEP {step.step}</div>
                  <div className="mt-2 font-display text-xl text-white text-outlined">{step.title}</div>
                  <p className="mt-2 font-readable text-sm leading-relaxed text-white/70">{step.text}</p>
                </div>
              ))}
            </div>
            <div className="mt-5 rounded-2xl border-3 border-[var(--color-ggd-outline)] bg-black/25 p-4">
              <div className="font-display text-xl text-[var(--color-ggd-gold)] text-outlined">Rare Rule</div>
              <p className="mt-2 font-readable text-sm leading-relaxed text-white/75">
                Nếu nhiều Rare Chest được mở cùng một race/week, Rare item không được trùng. Item đã roll ra sẽ bị remove khỏi pool batch đó, sau race reset pool.
              </p>
            </div>
          </div>
        </section>

        <section className="ggd-card p-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="font-display text-3xl text-[var(--color-ggd-neon-green)] text-outlined">🎁 Common Pool</div>
              <p className="mt-2 font-readable text-sm text-white/70">Utility nhẹ, cá nhân hoặc global vừa đủ vui.</p>
            </div>
            <div className="ggd-tag bg-[var(--color-ggd-neon-green)] text-[var(--color-ggd-outline)]">Total 100%</div>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            {commonItems.map((item) => <ItemCard key={item.name} item={item} rarity="common" />)}
          </div>
        </section>

        <section className="ggd-card-gold p-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="font-display text-3xl text-[var(--color-ggd-gold)] text-outlined">✨ Rare Pool</div>
              <p className="mt-2 font-readable text-sm text-white/70">Global modifier, meme round, impact cao hơn nhưng chỉ kéo dài 1 race.</p>
            </div>
            <div className="ggd-tag bg-[var(--color-ggd-gold)] text-[var(--color-ggd-outline)]">No duplicate Rare</div>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            {rareItems.map((item) => <ItemCard key={item.name} item={item} rarity="rare" />)}
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-3">
          <div className="ggd-card-orange p-5">
            <div className="font-display text-2xl text-white text-outlined">⏱️ Duration</div>
            <p className="mt-3 font-readable text-sm leading-relaxed text-white/75">
              Modifier chỉ kéo dài 1 race kế tiếp. Sau race sẽ auto clear bằng trạng thái consumed.
            </p>
          </div>
          <div className="ggd-card-green p-5">
            <div className="font-display text-2xl text-white text-outlined">🎒 Inventory Items</div>
            <p className="mt-3 font-readable text-sm leading-relaxed text-white/75">
              Bonus Scar, Fragile Shield và Golden Shield apply ngay khi chest roll, không chờ race sau.
            </p>
          </div>
          <div className="ggd-card p-5">
            <div className="font-display text-2xl text-white text-outlined">🧯 Safety</div>
            <p className="mt-3 font-readable text-sm leading-relaxed text-white/75">
              Item V2 không cần target cá nhân, giảm toxic. Thomas vẫn bất tử, nhưng Rare có thể biến Thomas thành mốc áp lực cho cả lobby.
            </p>
          </div>
        </section>
      </main>
    </div>
  )
}
