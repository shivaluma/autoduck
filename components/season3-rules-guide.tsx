import Link from 'next/link'
import type { ReactNode } from 'react'
import {
  CHAOS_CARDS,
  FAQ_ITEMS,
  HAZARDS_LIST,
  LOADOUT_CONFIG,
  QUICK_START_STEPS,
  RACE_ACTION_TIPS,
  RULES_NAV,
  SCAR_SHIELD_RULES,
  SCORING_SYSTEM,
  SEASON3_RULES_META,
  TRACK_BOXES,
  WILD_ITEMS_LIST,
} from '@/lib/season3-rules-content'
import { loadoutComboBadge, loadoutComboLabel } from '@/packages/race-core/src/items/classes'
import { AUTO_LOADOUT_PRESETS } from '@/packages/race-core/src/items/catalog'

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
      <div className="mt-5 space-y-5 text-[15px] leading-relaxed text-white/80">{children}</div>
    </section>
  )
}

function ItemClassTag({ itemClass }: { itemClass: 'SPEED' | 'DEFENSE' | 'ATTACK' }) {
  const meta = {
    SPEED: { label: 'Tốc độ', icon: '⚡', color: 'border-amber-400/40 bg-amber-400/10 text-amber-300' },
    DEFENSE: { label: 'Phòng thủ', icon: '🛡️', color: 'border-blue-400/40 bg-blue-400/10 text-blue-300' },
    ATTACK: { label: 'Tấn công', icon: '💥', color: 'border-rose-400/40 bg-rose-400/10 text-rose-300' },
  }[itemClass]

  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-bold ${meta.color}`}>
      <span>{meta.icon}</span>
      <span>{meta.label}</span>
    </span>
  )
}

export function Season3RulesGuide() {
  const majorItems = LOADOUT_CONFIG.items.filter((item) => item.category === 'major')
  const minorItems = LOADOUT_CONFIG.items.filter((item) => item.category === 'minor')

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 pb-20 text-white sm:p-6 lg:p-8">
      {/* Header Banner */}
      <header className="relative overflow-hidden rounded-[2rem] border-4 border-[var(--color-ggd-outline)] bg-[radial-gradient(circle_at_90%_10%,rgba(255,204,0,.22),transparent_40%),linear-gradient(135deg,#241548,#110b24)] p-6 shadow-[0_8px_0_var(--color-ggd-outline)] sm:p-8">
        <div className="pointer-events-none absolute -right-6 -top-10 text-[9rem] opacity-10">📜</div>
        <div className="relative z-[1] flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--color-ggd-gold)]/50 bg-[var(--color-ggd-gold)]/10 px-3.5 py-1 text-xs font-black tracking-[0.2em] text-[var(--color-ggd-gold)]">
              CẨM NANG THI ĐẤU CHÍNH THỨC
            </div>
            <h1 className="mt-3 font-display text-4xl leading-tight sm:text-5xl lg:text-6xl">{SEASON3_RULES_META.title}</h1>
            <p className="mt-3 max-w-2xl text-base font-medium text-white/75 sm:text-lg">{SEASON3_RULES_META.subtitle}</p>
          </div>
          <div className="flex flex-col gap-2">
            <Link
              href="/season-3"
              className="rounded-xl border-2 border-white/20 bg-black/30 px-4 py-2.5 text-center text-sm font-black text-white/90 transition hover:border-[var(--color-ggd-neon-green)] hover:text-[var(--color-ggd-neon-green)]"
            >
              ← Về Season 3
            </Link>
            <div className="rounded-2xl border-2 border-white/15 bg-black/30 px-4 py-3 text-center">
              <div className="text-[10px] font-black tracking-widest text-white/45">MÙA GIẢI KÉO DÀI</div>
              <div className="font-display text-3xl text-[var(--color-ggd-gold)]">{SEASON3_RULES_META.weeks} TUẦN</div>
            </div>
          </div>
        </div>
      </header>

      {/* Sticky Table of Contents */}
      <nav aria-label="Mục lục hướng dẫn" className="sticky top-3 z-20 rounded-2xl border-2 border-white/10 bg-[#110b24ee] p-3 backdrop-blur-md shadow-lg">
        <div className="mb-2 text-[10px] font-black tracking-[0.2em] text-white/45">MỤC LỤC NHANH</div>
        <div className="flex flex-wrap gap-2">
          {RULES_NAV.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-black text-white/80 transition hover:border-[var(--color-ggd-neon-green)]/60 hover:text-[var(--color-ggd-neon-green)]"
            >
              {item.label}
            </a>
          ))}
        </div>
      </nav>

      {/* Section 1: Quick Start Loop */}
      <Section id="quick-start" eyebrow="BẮT ĐẦU NHANH" title="30 Giây Hiểu Luật Season 3">
        <p className="text-base text-white/90">
          Season 3 là giải đua vịt hàng tuần với <b>lá bài Chaos biến hóa</b> và <b>hệ thống item chiến thuật</b>. Mục tiêu tối thượng của bạn là <b>né tránh việc &quot;bị làm dzịt&quot; (thua cuộc)</b> và tích lũy điểm để nâng cao cúp Vô Địch <b>Golden Duck</b>!
        </p>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {QUICK_START_STEPS.map((step) => (
            <article key={step.step} className="flex flex-col justify-between rounded-2xl border-2 border-white/10 bg-black/25 p-4 transition hover:border-[var(--color-ggd-lavender)]/40">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-3xl">{step.icon}</span>
                  <span className="text-xs font-black tracking-widest text-[var(--color-ggd-lavender)]">BƯỚC {step.step}</span>
                </div>
                <h3 className="mt-3 font-display text-xl text-white">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/70">{step.body}</p>
              </div>
            </article>
          ))}
        </div>

        <div className="rounded-2xl border-2 border-[var(--color-ggd-neon-green)]/35 bg-[var(--color-ggd-neon-green)]/10 p-4 text-sm font-bold text-white/90">
          💡 <b>Sân chơi độc lập:</b> Season 3 vận hành hoàn toàn trên hệ thống đường đua mới, không còn phụ thuộc vào các hiệu ứng Rương quái, Boss hay Rồng của mùa cũ.
        </div>
      </Section>

      {/* Section 2: Chaos Cards */}
      <Section id="chaos-cards" eyebrow="BIẾN SỐ HÀNG TUẦN" title="7 Lá Bài Chaos & Quy Tắc Thua">
        <p>
          Mỗi tuần, giải đấu sẽ lật mở <b>đúng 1 lá bài Chaos</b>. Lá bài này sẽ quyết định ai là người bị xử thua (&quot;làm dzịt&quot;) dựa trên kết quả về đích của đường đua.
        </p>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CHAOS_CARDS.map((chaos) => (
            <article
              key={chaos.id}
              className="flex flex-col justify-between rounded-2xl border-2 border-white/10 bg-black/25 p-5 transition hover:border-[var(--color-ggd-gold)]/40"
            >
              <div>
                <div className="flex items-center gap-3">
                  <span className="text-4xl">{chaos.icon}</span>
                  <div>
                    <span className="text-[10px] font-black tracking-widest text-white/45">CHAOS CARD</span>
                    <h3 className="font-display text-2xl text-white">{chaos.name}</h3>
                  </div>
                </div>
                <div className="mt-3 rounded-lg border border-[var(--color-ggd-gold)]/30 bg-[var(--color-ggd-gold)]/10 px-3 py-1.5 text-xs font-black text-[var(--color-ggd-gold)]">
                  {chaos.headline}
                </div>
                <p className="mt-3 text-sm leading-relaxed text-white/75">{chaos.summary}</p>
              </div>
              <div className="mt-4 rounded-xl border border-white/5 bg-white/5 p-3 text-xs text-white/70">
                <span className="font-black text-[var(--color-ggd-lavender)]">💡 Mẹo: </span>
                {chaos.tip}
              </div>
            </article>
          ))}
        </div>
      </Section>

      {/* Section 3: Scar and Shield */}
      <Section id="scar-shield" eyebrow="CƠ CHẾ SINH TỒN" title="Sẹo (Scar) & Khiên (Shield)">
        <p>
          Khi rơi vào nhóm thua của lá Chaos tuần đó, bạn sẽ bị phạt. Tuy nhiên, hệ thống sinh tồn luôn cho bạn cơ hội lội ngược dòng bảo vệ bản thân!
        </p>

        <div className="grid gap-4 lg:grid-cols-2">
          {SCAR_SHIELD_RULES.map((rule) => (
            <article key={rule.title} className="rounded-2xl border-2 border-white/10 bg-black/25 p-5">
              <div className="flex items-center gap-3 border-b border-white/10 pb-3">
                <span className="text-3xl">{rule.icon}</span>
                <h3 className="font-display text-2xl text-white">{rule.title}</h3>
              </div>
              <ul className="mt-4 space-y-3">
                {rule.points.map((point) => (
                  <li key={point} className="flex gap-2.5 text-sm text-white/75">
                    <span className="mt-0.5 text-[var(--color-ggd-gold)]">▸</span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>

        <div className="rounded-2xl border-2 border-[var(--color-ggd-gold)]/40 bg-[var(--color-ggd-gold)]/10 p-4 text-sm font-medium text-white/90">
          🛡️ <b>Tóm tắt Khiên trong 1 câu:</b> Khi bạn tick chọn dùng Khiên ở bước Chuẩn Bị, Khiên sẽ luôn bị tiêu hao sau race đó; nếu bạn rơi vào nhóm thua của Chaos tuần đó, Khiên sẽ đỡ trọn vẹn và bạn <b>không bị nhận Sẹo</b>.
        </div>
      </Section>

      {/* Section 4: Loadout & 3 Prep Credits */}
      <Section id="loadout" eyebrow="CHIẾN THUẬT RA TRẬN" title="Chọn Đồ Loadout (3 Prep Credits)">
        <div className="rounded-2xl border-2 border-[var(--color-ggd-neon-green)]/35 bg-[var(--color-ggd-neon-green)]/10 p-4">
          <div className="font-black text-[var(--color-ggd-neon-green)]">
            Quy tắc: Đúng 2 Slot đồ · Tổng chi phí = 3 Prep Credits
          </div>
          <p className="mt-1 text-sm text-white/80">
            Công thức bắt buộc: <b>1 Major Item (2 Credits)</b> + <b>1 Minor Item (1 Credit)</b>.
          </p>
        </div>

        {/* Triangle Counter */}
        <div>
          <h3 className="text-lg font-black text-white">Tam giác tương khắc 3 Hệ</h3>
          <p className="mt-1 text-sm text-white/70">
            Không có món đồ nào là vô đối. Mỗi hệ đều có khắc tinh và lợi thế riêng:
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {LOADOUT_CONFIG.triangle.map((tri) => (
              <div key={tri.type} className="rounded-2xl border-2 border-white/10 bg-black/25 p-4">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{tri.icon}</span>
                  <span className="font-display text-xl text-white">{tri.name}</span>
                </div>
                <div className="mt-2 text-xs font-bold text-[var(--color-ggd-gold)]">{tri.counters}</div>
                <div className="mt-2 text-xs text-white/50">Gồm: {tri.items}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Major Items */}
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-purple-500/20 px-2 py-0.5 text-xs font-black text-purple-300">MAJOR ITEMS</span>
            <span className="text-xs text-white/50">Chi phí: 2 Prep Credits (Chọn đúng 1 món)</span>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {majorItems.map((item) => (
              <article key={item.id} className="flex flex-col justify-between rounded-2xl border-2 border-white/10 bg-black/25 p-4">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-3xl">{item.icon}</span>
                    <ItemClassTag itemClass={item.itemClass} />
                  </div>
                  <h4 className="mt-3 font-display text-xl text-white">{item.name}</h4>
                  <p className="mt-2 text-sm text-white/75">{item.description}</p>
                </div>
                <div className="mt-4 text-[11px] font-black text-purple-300">2 Credits · Major</div>
              </article>
            ))}
          </div>
        </div>

        {/* Minor Items */}
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-blue-500/20 px-2 py-0.5 text-xs font-black text-blue-300">MINOR ITEMS</span>
            <span className="text-xs text-white/50">Chi phí: 1 Prep Credit (Chọn đúng 1 món)</span>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {minorItems.map((item) => (
              <article key={item.id} className="flex flex-col justify-between rounded-2xl border-2 border-white/10 bg-black/25 p-4">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-3xl">{item.icon}</span>
                    <ItemClassTag itemClass={item.itemClass} />
                  </div>
                  <h4 className="mt-3 font-display text-xl text-white">{item.name}</h4>
                  <p className="mt-2 text-sm text-white/75">{item.description}</p>
                </div>
                <div className="mt-4 text-[11px] font-black text-blue-300">1 Credit · Minor</div>
              </article>
            ))}
          </div>
        </div>

        {/* Preset Combos */}
        <div className="rounded-2xl border-2 border-white/10 bg-black/20 p-4">
          <h4 className="font-display text-lg text-white">4 Phong cách phối đồ (Combo Badges)</h4>
          <p className="mt-1 text-xs text-white/60">
            Bạn có thể phối tự do giữa 3 Major và 6 Minor. Khi vào trận, hệ thống sẽ gán danh hiệu phong cách tương ứng:
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {AUTO_LOADOUT_PRESETS.map((preset) => (
              <div key={preset.join('-')} className="rounded-xl border border-white/10 bg-black/30 p-3 text-xs">
                <div className="font-black text-[var(--color-ggd-gold)]">{loadoutComboBadge(preset)}</div>
                <div className="mt-1 text-white/60">{loadoutComboLabel(preset)} ({preset.join(' + ')})</div>
              </div>
            ))}
            <div className="rounded-xl border border-white/10 bg-black/30 p-3 text-xs">
              <div className="font-black text-emerald-300">🧪 HYBRID COMBO</div>
              <div className="mt-1 text-white/60">Mad Duck (Phối 2 hệ khác nhau, cân bằng công thủ)</div>
            </div>
          </div>
        </div>
      </Section>

      {/* Section 5: Track, Boxes, Wild Items & Hazards */}
      <Section id="track-wild" eyebrow="TRÊN ĐƯỜNG ĐUA" title="Hộp Quà, Wild Items & Bẫy Môi Trường">
        <p>
          Ngoài 2 item Loadout mang theo từ nhà, dọc theo dòng nước có các hộp bí ẩn mở ra <b>Wild Items</b> giúp tạo đột biến nghẹt thở.
        </p>

        {/* Track Boxes */}
        <div className="grid gap-3 sm:grid-cols-2">
          {TRACK_BOXES.map((box) => (
            <article key={box.name} className="rounded-2xl border-2 border-white/10 bg-black/25 p-4">
              <div className="flex items-center justify-between">
                <span className="text-4xl">{box.icon}</span>
                <span className={`rounded-full border px-2.5 py-0.5 text-xs font-black ${box.color}`}>{box.tag}</span>
              </div>
              <h3 className="mt-3 font-display text-xl text-white">{box.name}</h3>
              <p className="mt-2 text-sm text-white/75">{box.description}</p>
            </article>
          ))}
        </div>

        {/* Live Race Interaction */}
        <div className="grid gap-3 sm:grid-cols-2">
          {RACE_ACTION_TIPS.map((tip) => (
            <div key={tip.title} className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="flex items-center gap-2.5">
                <span className="text-2xl">{tip.icon}</span>
                <h4 className="font-black text-white">{tip.title}</h4>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-white/70">{tip.detail}</p>
            </div>
          ))}
        </div>

        {/* Wild Items List */}
        <div>
          <h3 className="font-display text-xl text-white">8 Loại Wild Items nhặt trên track</h3>
          <p className="mt-1 text-xs text-white/60">
            Gồm 2 nhóm: <b>Tức thì (Instant)</b> kích hoạt ngay khi chạm hộp và <b>Giữ slot (Held)</b> cất vào túi để bấm dùng hoặc để vịt tự xài.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {WILD_ITEMS_LIST.map((item) => (
              <article key={item.id} className="flex flex-col justify-between rounded-xl border border-white/10 bg-black/25 p-3.5">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-3xl">{item.icon}</span>
                    <span className="rounded bg-white/10 px-2 py-0.5 text-[10px] font-black text-white/60">
                      {item.behavior === 'INSTANT' ? '⚡ Tức thì' : '🎒 Giữ túi'}
                    </span>
                  </div>
                  <h4 className="mt-2 font-black text-sm text-white">{item.displayName}</h4>
                  <p className="mt-1 text-xs text-white/70">{item.description}</p>
                </div>
              </article>
            ))}
          </div>
        </div>

        {/* Hazards */}
        <div>
          <h3 className="font-display text-xl text-white">4 Loại bẫy chướng ngại vật (Hazards)</h3>
          <p className="mt-1 text-xs text-white/60">
            Mỗi race xuất hiện 0–2 chướng ngại vật ngẫu nhiên trên mặt nước. Đường đua luôn chừa làn an toàn để vịt có thể né tránh:
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {HAZARDS_LIST.map((hazard) => (
              <div key={hazard.id} className="rounded-xl border border-white/10 bg-black/25 p-3">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{hazard.icon}</span>
                  <span className="font-black text-sm text-white">{hazard.name}</span>
                </div>
                <p className="mt-1.5 text-xs text-white/65">{hazard.effect}</p>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* Section 6: Standings, King & Quack Points */}
      <Section id="standings-qp" eyebrow="VINH QUANG & PHẦN THƯỞNG" title="Điểm Xếp Hạng, Vua Ao & Tiệm Quack Points">
        <div className="grid gap-4 sm:grid-cols-2">
          {SCORING_SYSTEM.map((system) => (
            <article key={system.title} className="flex flex-col justify-between rounded-2xl border-2 border-white/10 bg-black/25 p-5">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-3xl">{system.icon}</span>
                  <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5 text-[11px] font-black text-white/60">
                    {system.badge}
                  </span>
                </div>
                <h3 className="mt-3 font-display text-xl text-white">{system.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/75">{system.detail}</p>
              </div>
            </article>
          ))}
        </div>
      </Section>

      {/* Section 7: FAQ */}
      <Section id="faq" eyebrow="HỎI ĐÁP" title="Câu Hỏi Thường Gặp & Mẹo Sinh Tồn">
        <div className="space-y-3">
          {FAQ_ITEMS.map((item, index) => (
            <div key={item.q} className="rounded-2xl border border-white/10 bg-black/25 p-4">
              <h4 className="flex items-start gap-2.5 font-black text-sm text-[var(--color-ggd-lavender)] sm:text-base">
                <span className="rounded-md bg-[var(--color-ggd-lavender)]/20 px-1.5 py-0.5 text-xs text-[var(--color-ggd-lavender)]">Q{index + 1}</span>
                <span>{item.q}</span>
              </h4>
              <p className="mt-2 pl-7 text-xs leading-relaxed text-white/75 sm:text-sm">{item.a}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Footer CTA */}
      <footer className="rounded-[2rem] border-4 border-dashed border-white/15 bg-black/20 p-6 text-center sm:p-8">
        <div className="text-4xl">🦆🏁</div>
        <h3 className="mt-2 font-display text-2xl text-white sm:text-3xl">Đã sẵn sàng xuống nước?</h3>
        <p className="mt-2 text-sm text-white/65">
          Vào ngay sảnh Season 3 để khóa Loadout, kích hoạt Khiên và gửi Dự đoán cho tuần thi đấu này!
        </p>
        <Link
          href="/season-3"
          className="mt-5 inline-block rounded-xl bg-[var(--color-ggd-gold)] px-8 py-3.5 font-display text-lg font-black text-[var(--color-ggd-outline)] shadow-[0_4px_0_#997300] transition hover:brightness-110 active:translate-y-0.5"
        >
          Vào Sảnh Thi Đấu Season 3
        </Link>
      </footer>
    </main>
  )
}
