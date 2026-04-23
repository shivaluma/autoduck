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
  { icon: '🤕', name: 'Bonus Scar', rate: '28%', effect: 'Nhận ngay +1 Sẹo.', tone: 'from-orange-500/35 to-red-900/25' },
  { icon: '🛡️', name: 'Fragile Shield', rate: '24%', effect: 'Nhận ngay 1 Khiên tạm (1 charge). Không dùng ở Race kế tiếp sẽ vỡ.', tone: 'from-sky-400/35 to-cyan-950/25' },
  { icon: '🐣', name: 'Clone Chaos', rate: '18%', effect: 'Race kế tiếp toàn lobby có thêm 1 Clone.', tone: 'from-lime-400/30 to-emerald-950/25' },
  { icon: '🌿', name: 'Safe Week', rate: '15%', effect: 'Race kế tiếp Khiên không bị decay.', tone: 'from-green-400/30 to-teal-950/25' },
  { icon: '🌀', name: 'Reverse Results', rate: '15%', effect: 'Race kế tiếp đảo ngược bảng xếp hạng cuối cùng.', tone: 'from-indigo-400/30 to-violet-950/25' },
]

const rareItems = [
  { icon: '🐥', name: 'Lucky Clone', rate: '28%', effect: 'Race kế tiếp chỉ người nhận có thêm 1 Clone.', tone: 'from-yellow-300/35 to-orange-950/25' },
  { icon: '🚫', name: 'Anti Shield', rate: '22%', effect: 'Race kế tiếp toàn lobby không ai được dùng Khiên.', tone: 'from-red-500/35 to-rose-950/25' },
  { icon: '👑', name: "Can't Pass Thomas", rate: '18%', effect: 'Race kế tiếp ai về trước Thomas sẽ bị tính thua.', tone: 'from-amber-300/35 to-stone-950/25' },
  { icon: '✨', name: 'Golden Shield', rate: '17%', effect: 'Nhận ngay 1 Khiên full 3 charge.', tone: 'from-yellow-300/45 to-yellow-900/20' },
  { icon: '🎪', name: 'More People More Fun', rate: '15%', effect: 'Race kế tiếp sẽ có 3 hoặc 4 người cùng thua thay vì 2.', tone: 'from-pink-400/35 to-fuchsia-950/25' },
]

const flowSteps = [
  { step: '01', title: 'Boss bị hạ', text: 'Boss hoặc Clone Boss bị tính thua thì Boss mất ngôi.' },
  { step: '02', title: 'Roll chest theo streak', text: 'Streak càng cao thì Rare rate càng lớn.' },
  { step: '03', title: 'Nhận item / lưu modifier', text: 'Item inventory nhận ngay. Modifier được lưu cho Race kế tiếp.' },
  { step: '04', title: 'Race kế tiếp kích hoạt effect', text: 'Modifier tự kích hoạt khi Race kế tiếp bắt đầu.' },
  { step: '05', title: 'Effect tự clear sau race', text: 'Resolve xong Race kế tiếp thì modifier tự clear.' },
]

const shieldDecaySteps = [
  { charge: '3', label: 'Khiên mới', text: 'Vừa craft hoặc nhận Golden Shield.', color: 'bg-[var(--color-ggd-neon-green)] text-[var(--color-ggd-outline)]' },
  { charge: '2', label: 'Đã decay 1 lần', text: 'Không dùng sau race thì giảm còn 2 charge.', color: 'bg-[var(--color-ggd-gold)] text-[var(--color-ggd-outline)]' },
  { charge: '1', label: 'Sắp vỡ', text: 'Còn 1 charge, Race kế tiếp không dùng là rất căng.', color: 'bg-[var(--color-ggd-orange)] text-white' },
  { charge: '0', label: 'Vỡ', text: 'Về 0 charge thì Khiên mất luôn, không hoàn Sẹo.', color: 'bg-[#4d0000] text-white' },
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
          <div className="grid gap-8 lg:items-center">
            <div>
              <div className="ggd-tag inline-flex bg-[var(--color-ggd-gold)] text-[var(--color-ggd-outline)]">🎁 Reward Chest System</div>
              <h1 className="mt-5 font-display text-5xl leading-none text-white text-outlined md:text-7xl">
                Duck Race <span className="text-[var(--color-ggd-neon-green)]">V2.0</span>
              </h1>
              <p className="mt-5 max-w-2xl font-readable text-lg leading-relaxed text-white/78">
                Hệ item mới tập trung vào các khoảnh khắc vui, tác động vừa đủ lên cuộc đua. Common mang lợi ích ổn định, Rare tạo ra những round hỗn loạn cho cả lobby.
              </p>
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                {[
                  ['🔥', 'Boss Streak là gì?', 'Số Race liên tiếp một vịt không bị tính thua.'],
                  ['👑', 'Mở Boss Mode', 'Đạt Streak 3 thì thành Boss Duck.'],
                  ['🐣', 'Sống càng lâu càng căng', 'Streak càng cao Boss càng spawn nhiều Clone và chest càng dễ ra Rare.'],
                ].map(([icon, title, text]) => (
                  <div key={title} className="rounded-2xl border-3 border-[var(--color-ggd-outline)] bg-black/25 p-4 shadow-[inset_0_2px_0_rgba(255,255,255,0.1)]">
                    <div className="text-2xl">{icon}</div>
                    <div className="mt-2 font-display text-base text-white text-outlined leading-tight">{title}</div>
                    <p className="mt-2 font-readable text-xs leading-relaxed text-white/70">{text}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="ggd-card p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="font-display text-3xl text-[var(--color-ggd-sky)] text-outlined">🛡 Shield Decay</div>
              <p className="mt-2 max-w-2xl font-readable text-sm leading-relaxed text-white/72">
                Khiên không giữ vô hạn. Nếu không được dùng trong race, sau khi resolve xong Khiên sẽ mất 1 charge.
              </p>
            </div>
            <div className="ggd-tag bg-[var(--color-ggd-sky)] text-[var(--color-ggd-outline)]">2 Sẹo = 1 Khiên</div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-4">
            {shieldDecaySteps.map((step, index) => (
              <div key={step.charge} className="relative rounded-2xl border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] p-4 shadow-[0_5px_0_var(--color-ggd-outline),0_16px_24px_rgba(0,0,0,0.42)]">
                {index < shieldDecaySteps.length - 1 && (
                  <div className="absolute right-[-18px] top-1/2 z-10 hidden -translate-y-1/2 font-display text-2xl text-[var(--color-ggd-muted)] md:block">→</div>
                )}
                <div className={`grid h-14 w-14 place-items-center rounded-2xl border-3 border-[var(--color-ggd-outline)] font-display text-3xl shadow-[inset_0_2px_0_rgba(255,255,255,0.18)] ${step.color}`}>
                  {step.charge}
                </div>
                <div className="mt-4 font-display text-xl text-white text-outlined">{step.label}</div>
                <p className="mt-2 font-readable text-sm leading-relaxed text-white/70">{step.text}</p>
              </div>
            ))}
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {[
              ['🧩', 'Auto craft', 'Nếu có đủ 2 Sẹo và đang không có Khiên, hệ thống tự ghép thành 1 Khiên mới.'],
              ['🙋', 'Declare trước race', 'Muốn Khiên cứu mình thì phải bật dùng Khiên trước khi race bắt đầu.'],
              ['🌿', 'Safe Week', 'Nếu Safe Week kích hoạt, Race kế tiếp Khiên không bị decay.'],
            ].map(([icon, title, text]) => (
              <div key={title} className="rounded-2xl border-3 border-[var(--color-ggd-outline)] bg-black/20 p-4">
                <div className="font-display text-lg text-white text-outlined">{icon} {title}</div>
                <p className="mt-2 font-readable text-sm leading-relaxed text-white/70">{text}</p>
              </div>
            ))}
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
                    <div className="font-display text-xl text-white text-outlined">Streak {tier.streak}</div>
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
              <div className="mt-2 font-readable text-sm leading-relaxed text-white/75 space-y-1">
                <div>Nếu nhiều Rare Chest mở cùng tuần, mỗi Rare item chỉ xuất hiện 1 lần.</div>
                <div>Item đã rơi sẽ bị loại khỏi pool tới hết tuần.</div>
                <div>Can&apos;t Pass Thomas và More People More Fun không thể cùng xuất hiện trong một tuần.</div>
              </div>
            </div>
          </div>
        </section>

        <section className="ggd-card p-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="font-display text-3xl text-[var(--color-ggd-neon-green)] text-outlined">🎁 Common Chest</div>
              <p className="mt-2 font-readable text-sm text-white/70">Lợi ích cá nhân, impact nhẹ.</p>
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
              <div className="font-display text-3xl text-[var(--color-ggd-gold)] text-outlined">✨ Rare Chest</div>
              <p className="mt-2 font-readable text-sm text-white/70">Round modifier, chaos vui vẻ.</p>
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
            <div className="mt-3 font-readable text-sm leading-relaxed text-white/75 space-y-1">
              <div>Modifier chỉ có hiệu lực trong 1 Race kế tiếp.</div>
              <div>Sau race sẽ tự clear.</div>
              <div>Item inventory nhận ngay khi mở chest.</div>
            </div>
          </div>
          <div className="ggd-card-green p-5">
            <div className="font-display text-2xl text-white text-outlined">🎒 Inventory Items</div>
            <p className="mt-3 font-readable text-sm leading-relaxed text-white/75">
              Bonus Scar, Fragile Shield và Golden Shield nhận ngay khi mở chest.
            </p>
          </div>
          <div className="ggd-card p-5">
            <div className="font-display text-2xl text-white text-outlined">🧯 Safety</div>
            <p className="mt-3 font-readable text-sm leading-relaxed text-white/75">
              Item V2 không cần target cá nhân, giảm toxic. Thomas vẫn bất tử, nhưng Rare có thể biến Thomas thành mốc áp lực cho toàn lobby.
            </p>
          </div>
        </section>

        <footer className="border-t-4 border-[var(--color-ggd-outline)] pt-6 pb-4 text-center">
          <div className="font-display text-2xl text-[var(--color-ggd-gold)] text-outlined">Không ai an toàn vào sáng thứ 2.</div>
        </footer>
      </main>
    </div>
  )
}
