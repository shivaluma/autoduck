import Link from 'next/link'
import type { ReactNode } from 'react'
import {
  AUTO_USE_NOTES,
  CHAOS_RULES,
  COSMETICS_NOTES,
  GLOSSARY,
  HAZARDS,
  LOADOUT_RULES,
  MANUAL_WILD_USE,
  RACE_PHYSICS_NOTES,
  RULES_NAV,
  SEASON3_OVERVIEW,
  SEASON3_RULES_META,
  STANDING_SYSTEM,
  TRACK_PICKUPS,
  WEEK_FLOW,
  WILD_ITEMS,
} from '@/lib/season3-rules-content'

function Section({
  id,
  eyebrow,
  title,
  children,
}: {
  id: string
  eyebrow?: string
  title: string
  children: ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-24 rounded-[2rem] border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-surface-2)] p-5 shadow-[0_6px_0_var(--color-ggd-outline)] sm:p-7">
      {eyebrow && <div className="text-xs font-black tracking-[0.25em] text-[var(--color-ggd-gold)]">{eyebrow}</div>}
      <h2 className="mt-1 font-display text-3xl text-white sm:text-4xl">{title}</h2>
      <div className="mt-5 space-y-4 text-[15px] leading-relaxed text-white/78">{children}</div>
    </section>
  )
}

function BulletList({ items }: { items: readonly string[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item} className="flex gap-3">
          <span className="mt-1 text-[var(--color-ggd-neon-green)]">▸</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

export function Season3RulesGuide() {
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 pb-16 text-white sm:p-6 lg:p-8">
      <header className="relative overflow-hidden rounded-[2rem] border-4 border-[var(--color-ggd-outline)] bg-[radial-gradient(circle_at_90%_10%,rgba(255,204,0,.18),transparent_35%),linear-gradient(135deg,#241548,#110b24)] p-6 shadow-[0_8px_0_var(--color-ggd-outline)] sm:p-8">
        <div className="pointer-events-none absolute -right-6 -top-10 text-[9rem] opacity-10">📜</div>
        <div className="relative z-[1] flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--color-ggd-gold)]/40 bg-[var(--color-ggd-gold)]/10 px-3 py-1 text-xs font-black tracking-[0.2em] text-[var(--color-ggd-gold)]">
              OFFICIAL RULEBOOK
            </div>
            <h1 className="mt-3 font-display text-5xl leading-none sm:text-6xl">{SEASON3_RULES_META.title}</h1>
            <p className="mt-4 max-w-2xl text-base font-medium text-white/72 sm:text-lg">{SEASON3_RULES_META.subtitle}</p>
          </div>
          <div className="flex flex-col gap-2">
            <Link href="/season-3" className="rounded-xl border-2 border-white/20 bg-black/25 px-4 py-2 text-center text-sm font-black text-white/85 transition hover:border-[var(--color-ggd-neon-green)] hover:text-[var(--color-ggd-neon-green)]">
              ← Về Season 3
            </Link>
            <div className="rounded-2xl border-2 border-white/15 bg-black/25 px-4 py-3 text-center">
              <div className="text-[10px] font-black tracking-widest text-white/45">SEASON LENGTH</div>
              <div className="font-display text-3xl text-[var(--color-ggd-gold)]">{SEASON3_RULES_META.weeks} TUẦN</div>
            </div>
          </div>
        </div>
      </header>

      <nav className="sticky top-3 z-20 rounded-2xl border-2 border-white/10 bg-[#110b24ee] p-3 backdrop-blur-md">
        <div className="mb-2 text-[10px] font-black tracking-[0.2em] text-white/45">MỤC LỤC</div>
        <div className="flex flex-wrap gap-2">
          {RULES_NAV.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-black text-white/75 transition hover:border-[var(--color-ggd-neon-green)]/50 hover:text-[var(--color-ggd-neon-green)]"
            >
              {item.label}
            </a>
          ))}
        </div>
      </nav>

      <Section id="overview" eyebrow="BẮT ĐẦU TẠI ĐÂY" title={SEASON3_OVERVIEW.headline}>
        {SEASON3_OVERVIEW.paragraphs.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
        <div className="rounded-2xl border-2 border-[var(--color-ggd-neon-green)]/35 bg-[var(--color-ggd-neon-green)]/10 p-4 text-sm font-bold text-white/88">
          Season 3 tách khỏi modifier chest/boss/dragon của season cũ. Race chính thức chỉ dùng engine Season 3 + Chaos + loadout + pickup track.
        </div>
      </Section>

      <Section id="week-flow" eyebrow="TIMELINE" title="Vòng đời một tuần">
        <div className="grid gap-3 lg:grid-cols-2">
          {WEEK_FLOW.map((step) => (
            <article key={step.step} className="rounded-2xl border-2 border-white/10 bg-black/20 p-4">
              <div className="text-xs font-black tracking-widest text-[var(--color-ggd-lavender)]">BƯỚC {step.step}</div>
              <h3 className="mt-1 font-display text-2xl text-white">{step.title}</h3>
              <p className="mt-2 text-sm text-white/70">{step.body}</p>
            </article>
          ))}
        </div>
      </Section>

      <Section id="standings" eyebrow="META SEASON" title="Điểm, Scar, Shield & King">
        <div className="grid gap-3 sm:grid-cols-2">
          {STANDING_SYSTEM.map((entry) => (
            <article key={entry.label} className="rounded-2xl border-2 border-white/10 bg-black/20 p-4">
              <div className="text-3xl">{entry.icon}</div>
              <h3 className="mt-2 font-black text-white">{entry.label}</h3>
              <p className="mt-2 text-sm text-white/68">{entry.detail}</p>
            </article>
          ))}
        </div>
      </Section>

      <Section id="chaos" eyebrow="1 CHAOS / TUẦN" title="7 lá Chaos Cards">
        <p>Mỗi tuần host reveal đúng một Chaos trước race. Cặp Duo và team Constructors được random một lần và lưu cố định cho tuần đó.</p>
        <div className="grid gap-3">
          {CHAOS_RULES.map((chaos) => (
            <article key={chaos.id} className="rounded-2xl border-2 border-white/10 bg-black/20 p-4">
              <div className="flex flex-wrap items-start gap-3">
                <span className="text-4xl">{chaos.icon}</span>
                <div className="min-w-0 flex-1">
                  <h3 className="font-display text-2xl text-white">{chaos.label}</h3>
                  <p className="mt-1 font-bold text-[var(--color-ggd-gold)]">{chaos.rule}</p>
                  <p className="mt-2 text-sm text-white/65">{chaos.detail}</p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </Section>

      <Section id="loadout" eyebrow="RACE PREP" title="Loadout & Prep Credits">
        <div className="rounded-2xl border-2 border-[var(--color-ggd-neon-green)]/30 bg-[var(--color-ggd-neon-green)]/8 p-4">
          <div className="font-black text-[var(--color-ggd-neon-green)]">
            {LOADOUT_RULES.slots} slot · {LOADOUT_RULES.credits} Prep Credits · tối đa {LOADOUT_RULES.majorLimit} Major
          </div>
          <div className="mt-3">
            <BulletList items={LOADOUT_RULES.bullets} />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {LOADOUT_RULES.items.map((item) => (
            <article key={item.id} className="rounded-2xl border-2 border-white/10 bg-black/20 p-4">
              <div className="flex items-center gap-3">
                <span className="text-3xl">{item.icon}</span>
                <div>
                  <h3 className="font-black">{item.name}</h3>
                  <div className="text-xs font-bold text-[var(--color-ggd-gold)]">
                    {item.cost} Credit · {item.category === 'major' ? 'Major' : 'Minor'}
                  </div>
                </div>
              </div>
              <p className="mt-3 text-sm text-white/68">{item.description}</p>
              <p className="mt-2 text-[11px] font-black tracking-widest text-white/35">{item.id}</p>
            </article>
          ))}
        </div>
      </Section>

      <Section id="track" eyebrow="ON TRACK" title="Hộp nhặt & Wild Slot">
        <div className="grid gap-3 lg:grid-cols-3">
          {TRACK_PICKUPS.boxes.map((box) => (
            <article key={box.name} className="rounded-2xl border-2 border-white/10 bg-black/20 p-4">
              <div className="text-4xl">{box.icon}</div>
              <h3 className="mt-2 font-black">{box.name}</h3>
              <p className="mt-2 text-sm text-white/68">{box.detail}</p>
            </article>
          ))}
        </div>
        <p>{TRACK_PICKUPS.zones}</p>
        <p className="rounded-xl border border-white/10 bg-black/20 p-3 text-sm">{TRACK_PICKUPS.wildSlot}</p>
      </Section>

      <Section id="wild-items" eyebrow="QUACK BOX LOOT" title="8 Wild Items">
        <p>Loot từ Quack Box. Tỷ lệ category phụ thuộc vị trí BXH lúc nhặt — đuôi hơi thiên mobility/attack, đầu đàn thiên defense.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {WILD_ITEMS.map((item) => (
            <article key={item.id} className="rounded-2xl border-2 border-white/10 bg-black/20 p-4">
              <div className="flex items-center gap-3">
                <span className="text-3xl">{item.icon}</span>
                <div>
                  <h3 className="font-black">{item.displayName}</h3>
                  <div className="text-xs font-bold text-white/45">
                    {item.category} · {item.behavior === 'INSTANT' ? 'Tức thì' : 'Giữ slot'}
                  </div>
                </div>
              </div>
              <p className="mt-3 text-sm text-white/68">{item.description}</p>
            </article>
          ))}
        </div>
      </Section>

      <Section id="hazards" eyebrow="TRACK DANGER" title="Hazards">
        <p>Mỗi race Normal spawn 0–2 hazard, thường là 0 hoặc 1. Luôn để khoảng lane an toàn — không chặn hết đường.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {HAZARDS.map((hazard) => (
            <article key={hazard.id} className="rounded-2xl border-2 border-white/10 bg-black/20 p-4">
              <div className="flex items-center gap-3">
                <span className="text-3xl">{hazard.icon}</span>
                <h3 className="font-black">{hazard.name}</h3>
              </div>
              <p className="mt-2 text-sm text-white/68">{hazard.effect}</p>
            </article>
          ))}
        </div>
      </Section>

      <Section id="auto-use" eyebrow="AI ARBITER" title="Auto-use trong race">
        <BulletList items={AUTO_USE_NOTES} />
      </Section>

      <Section id="manual" eyebrow="LIVE RACE" title="Dùng Wild Item bằng tay">
        <BulletList items={MANUAL_WILD_USE} />
      </Section>

      <Section id="physics" eyebrow="ENGINE" title="Luật vật lý race">
        <BulletList items={RACE_PHYSICS_NOTES} />
      </Section>

      <Section id="cosmetics" eyebrow="SIDE PROGRESSION" title="Quack Points & Cosmetic">
        <BulletList items={COSMETICS_NOTES} />
        <p className="text-sm text-white/55">Cosmetic snapshot vào race config — chỉ để nhìn, không buff gameplay.</p>
      </Section>

      <Section id="glossary" eyebrow="TỪ ĐIỂN" title="Thuật ngữ">
        <dl className="space-y-3">
          {GLOSSARY.map((entry) => (
            <div key={entry.term} className="rounded-xl border border-white/10 bg-black/20 p-3">
              <dt className="font-black text-[var(--color-ggd-lavender)]">{entry.term}</dt>
              <dd className="mt-1 text-sm text-white/68">{entry.def}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <footer className="rounded-[2rem] border-4 border-dashed border-white/15 bg-black/15 p-6 text-center">
        <p className="text-sm text-white/55">Cân bằng có thể được tinh chỉnh qua balance version — replay và race đã chạy giữ nguyên config/seed đã commit.</p>
        <Link href="/season-3" className="mt-4 inline-block rounded-xl bg-[var(--color-ggd-gold)] px-6 py-3 font-black text-[var(--color-ggd-outline)]">
          Về trang Season 3
        </Link>
      </footer>
    </main>
  )
}
