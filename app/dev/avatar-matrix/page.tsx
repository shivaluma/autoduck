'use client'

import { useState } from 'react'
import Link from 'next/link'
import { CosmeticDuck } from '@/components/cosmetics/cosmetic-duck'
import type { DuckAppearance } from '@/lib/cosmetics/types'

const MATRIX_COLORS = [
  'body-sunshine',
  'body-tangerine',
  'body-mint',
  'body-sky',
  'body-lavender',
  'body-rose',
  'body-cream',
  'body-midnight',
  'body-cyber-cyan',
  'body-ruby',
  'body-emerald',
]

const MATRIX_HATS = [
  'head-cap-red',
  'head-bucket-blue',
  'head-tiny-crown',
  'head-wizard-hat',
  'head-cyber-mohawk',
  'head-bamboo-hat',
  'head-cat-ears',
  'head-space-dome',
]

const MATRIX_FACES = [
  'face-happy',
  'face-shades',
  'face-laser-visor',
  'face-office-burnout',
  'face-pixel-eyes',
  'face-victory-wink',
]

const MATRIX_OUTFITS = [
  'outfit-tee-white',
  'outfit-office-tie',
  'outfit-dev-hoodie',
  'outfit-racing-suit',
  'outfit-lucky-ao-dai',
  'outfit-space-suit',
  'outfit-quack-knight',
]

const MATRIX_SKINS = [
  'bodySkin-tiger-quack',
  'bodySkin-dragon-scale',
  'bodySkin-neon-scales',
  'bodySkin-galaxy-dust',
  'bodySkin-gold-veins',
  'bodySkin-lotus-speckles',
]

const MATRIX_PETS = [
  'pet-shiba-inu',
  'pet-corgi-pup',
  'pet-calico-cat',
  'pet-mini-capybara',
  'pet-baby-dragon',
]

const MATRIX_AURAS = [
  { id: 'aura-dragon-flame', name: 'Thần Long Bao Thân / Dragon Flame' },
  { id: 'aura-golden-rays', name: 'Phật Quang Vạn Trượng / Golden Mandala' },
  { id: 'aura-storm-cloud', name: 'Lôi Thần Sấm Sét / Lightning Arc Tempest' },
  { id: 'aura-moon-glow', name: 'Hàn Băng Cực Quang / Glacial Blizzard' },
  { id: 'aura-chilli-heat', name: 'Hỏa Diệm Sơn / Super Saiyan Inferno' },
  { id: 'aura-ghost-fog', name: 'U Hồn Vạn Quỷ / Spectral Souls' },
  { id: 'aura-neon-glitch', name: 'Cyber Matrix / Hologram HUD' },
  { id: 'aura-lotus-breeze', name: 'Hoa Khai Phú Quý / Lotus Cyclone' },
  { id: 'aura-space-dust', name: 'Cosmic Singularity / Galaxy Nebula' },
  { id: 'aura-disco-lights', name: 'Neon Disco / Stage Equalizer' },
  { id: 'aura-bubble-halo', name: 'Thủy Cung Thần Châu / Tidal Vortex' },
  { id: 'aura-lucky-leaves', name: 'Kim Tiền Cát Tường / Lucky Coins' },
]

export default function AvatarMatrixPage() {
  const [activeTab, setActiveTab] = useState<'matrix' | 'scales' | 'auras' | 'rarities' | 'combos'>('rarities')

  return (
    <main className="mx-auto min-h-screen max-w-7xl p-6 text-white">
      <header className="rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] p-6 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-xs font-black tracking-[0.2em] text-[var(--color-ggd-neon-green)]">
              DZỊT SEASON 3 — MODULAR AVATAR RIG
            </div>
            <h1 className="font-display text-4xl">Avatar Matrix Hub</h1>
            <p className="mt-2 text-sm text-white/70">
              Canonical 512×512 Modular Rig Verification — Testing Layering, Occlusion, Palette Tokens, Anchors &amp; Rarity Balance
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/dev/avatar-showcase"
              className="rounded-xl border-2 border-[var(--color-ggd-neon-green)] bg-[var(--color-ggd-neon-green)]/20 px-3 py-2 text-xs font-black text-[var(--color-ggd-neon-green)] transition hover:bg-[var(--color-ggd-neon-green)] hover:text-black"
            >
              Fantasy Showcase →
            </Link>
            <Link
              href="/dev/avatar-compatibility"
              className="rounded-xl border-2 border-[var(--color-ggd-gold)] bg-[var(--color-ggd-gold)]/20 px-3 py-2 text-xs font-black text-[var(--color-ggd-gold)] transition hover:bg-[var(--color-ggd-gold)] hover:text-black"
            >
              Compatibility Matrix →
            </Link>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {(['rarities', 'matrix', 'scales', 'auras', 'combos'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`rounded-full px-4 py-2 text-xs font-black uppercase transition-colors ${
                activeTab === tab
                  ? 'bg-[var(--color-ggd-neon-green)] text-[var(--color-ggd-outline)]'
                  : 'bg-black/30 text-white/70 hover:bg-black/50'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </header>

      {activeTab === 'rarities' && (
        <div className="mt-8 space-y-10">
          <section className="rounded-2xl border-2 border-white/10 bg-[var(--color-ggd-panel)] p-6">
            <h2 className="font-display text-2xl text-[var(--color-ggd-gold)]">
              Rarity Tier Visual Hierarchy & Anti-Inflation Balance
            </h2>
            <p className="mt-1 text-sm text-white/70">
              Visual complexity, material shaders, particle effects, and multi-piece silhouettes strictly scale with item rarity.
            </p>

            {/* Rarity Rows */}
            <div className="mt-6 space-y-8">
              {[
                {
                  tier: 'Common (Xám / Xanh Lá - Basic)',
                  badge: 'bg-slate-700 text-slate-200 border-slate-500',
                  desc: 'Clean, charming, grounded 2-3 value shapes. Everyday relatable items (White Tee, Red Cap, Normal Beanie, Happy Face, Water Ripples). Zero glows or particle noise.',
                  items: [
                    { name: 'Red Cap', appearance: { bodyColorId: 'body-sunshine', headId: 'head-cap-red' } },
                    { name: 'Clean White Tee', appearance: { bodyColorId: 'body-sunshine', outfitId: 'outfit-tee-white' } },
                    { name: 'Paper Boat Hat', appearance: { bodyColorId: 'body-sky', headId: 'head-paper-boat' } },
                    { name: 'Happy Face', appearance: { bodyColorId: 'body-tangerine', faceId: 'face-happy' } },
                    { name: 'Traffic Cone', appearance: { bodyColorId: 'body-mint', headId: 'head-traffic-cone' } },
                  ],
                },
                {
                  tier: 'Uncommon (Xanh Dương - Themed Accent)',
                  badge: 'bg-blue-900/80 text-blue-200 border-blue-500',
                  desc: 'Identifiable occupational/street theme with 1 neat accent colorway, ribbons, or clean badges (Chef Hat, Bucket Hat, Raincoat, Pond Shades, Calico Cat).',
                  items: [
                    { name: 'Blue Bucket', appearance: { bodyColorId: 'body-cream', headId: 'head-bucket-blue' } },
                    { name: 'Monday Tie', appearance: { bodyColorId: 'body-rose', outfitId: 'outfit-office-tie' } },
                    { name: 'Chef Hat', appearance: { bodyColorId: 'body-sunshine', headId: 'head-chef-hat' } },
                    { name: 'Pond Shades', appearance: { bodyColorId: 'body-tangerine', faceId: 'face-shades' } },
                    { name: 'Calico Cat Pet', appearance: { bodyColorId: 'body-mint', petId: 'pet-calico-cat' } },
                  ],
                },
                {
                  tier: 'Rare (Tím - Stylized Culture & Props)',
                  badge: 'bg-purple-900/80 text-purple-200 border-purple-500',
                  desc: 'Distinct silhouette cuts, stylized cultural or tech gear (Cowboy Hat, Non La, Dev Hoodie, Lucky Ao Dai, Shiba Inu, Tiger Skin).',
                  items: [
                    { name: 'Cowboy Hat', appearance: { bodyColorId: 'body-cream', headId: 'head-cowboy-hat' } },
                    { name: 'Dev Hoodie', appearance: { bodyColorId: 'body-cyber-cyan', outfitId: 'outfit-dev-hoodie' } },
                    { name: 'Non La & Ao Dai', appearance: { bodyColorId: 'body-mint', headId: 'head-bamboo-hat', outfitId: 'outfit-lucky-ao-dai' } },
                    { name: 'Shiba Inu Pet', appearance: { bodyColorId: 'body-tangerine', petId: 'pet-shiba-inu' } },
                    { name: 'Tiger Quack Skin', appearance: { bodyColorId: 'body-sunshine', bodySkinId: 'bodySkin-tiger-quack' } },
                  ],
                },
                {
                  tier: 'Epic (Hồng - Fantasy & High-Tech)',
                  badge: 'bg-pink-900/80 text-pink-200 border-pink-500',
                  desc: 'Advanced materials, glowing neon energy, glass reflections, dynamic pets, and fantasy spells (Wizard Hat, Cyber Mohawk, Space Suit, Baby Dragon, Dragon Scales).',
                  items: [
                    { name: 'Wizard Hat', appearance: { bodyColorId: 'body-lavender', headId: 'head-wizard-hat' } },
                    { name: 'Cyber Mohawk', appearance: { bodyColorId: 'body-cyber-cyan', headId: 'head-cyber-mohawk', faceId: 'face-laser-visor' } },
                    { name: 'Space Suit', appearance: { bodyColorId: 'body-sky', headId: 'head-space-dome', outfitId: 'outfit-space-suit' } },
                    { name: 'Baby Dragon', appearance: { bodyColorId: 'body-ruby', petId: 'pet-baby-dragon' } },
                    { name: 'Dragon Scales', appearance: { bodyColorId: 'body-tangerine', bodySkinId: 'bodySkin-dragon-scale' } },
                  ],
                },
                {
                  tier: 'Legendary (Vàng Kim - Mythic & God-Tier Prestige)',
                  badge: 'bg-amber-900/80 text-amber-200 border-amber-400',
                  desc: 'Supreme multi-layer prestige, golden crowns, knight armor, kintsugi gold veins, celestial stardust, and animated mythical spirits.',
                  items: [
                    { name: 'Diamond Crown', appearance: { bodyColorId: 'body-midnight', headId: 'head-diamond-crown', outfitId: 'outfit-quack-knight' } },
                    { name: 'Kintsugi Gold Veins', appearance: { bodyColorId: 'body-ruby', bodySkinId: 'bodySkin-gold-veins' } },
                    { name: 'Galaxy Singularity', appearance: { bodyColorId: 'body-midnight', bodySkinId: 'bodySkin-galaxy-dust', auraId: 'aura-space-dust' } },
                    { name: 'Dragon Flame Emperor', appearance: { bodyColorId: 'body-sunshine', headId: 'head-dragon-horns', auraId: 'aura-dragon-flame' } },
                    { name: 'Phật Quang Vạn Trượng', appearance: { bodyColorId: 'body-cream', headId: 'head-tiny-crown', auraId: 'aura-golden-rays' } },
                  ],
                },
              ].map((tierGroup, idx) => (
                <div key={idx} className="rounded-xl border border-white/10 bg-black/30 p-5">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className={`rounded-lg border px-3 py-1 text-xs font-black uppercase ${tierGroup.badge}`}>
                      {tierGroup.tier}
                    </span>
                    <p className="text-xs text-white/70">{tierGroup.desc}</p>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
                    {tierGroup.items.map((item, itemIdx) => (
                      <div key={itemIdx} className="flex flex-col items-center rounded-lg bg-black/40 p-3">
                        <CosmeticDuck appearance={item.appearance as DuckAppearance} size={130} />
                        <span className="mt-2 text-center text-xs font-bold text-white/90">{item.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {activeTab === 'matrix' && (
        <div className="mt-8 space-y-10">
          {/* Colors x Hats Matrix */}
          <section className="rounded-2xl border-2 border-white/10 bg-[var(--color-ggd-panel)] p-6">
            <h2 className="font-display text-2xl text-[var(--color-ggd-gold)]">
              1. Duck Colors × Representative Headwear
            </h2>
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
              {MATRIX_COLORS.slice(0, 8).map((colorId, i) => {
                const hatId = MATRIX_HATS[i % MATRIX_HATS.length]!
                const appearance: DuckAppearance = {
                  bodyColorId: colorId,
                  headId: hatId,
                  faceId: 'face-happy',
                }
                return (
                  <div key={colorId} className="flex flex-col items-center rounded-xl bg-black/25 p-3">
                    <CosmeticDuck appearance={appearance} size={110} />
                    <span className="mt-2 text-center text-[10px] font-bold text-white/80">
                      {colorId.replace('body-', '')} + {hatId.replace('head-', '')}
                    </span>
                  </div>
                )
              })}
            </div>
          </section>

          {/* Clothing x Headwear Matrix */}
          <section className="rounded-2xl border-2 border-white/10 bg-[var(--color-ggd-panel)] p-6">
            <h2 className="font-display text-2xl text-[var(--color-ggd-gold)]">
              2. Clothing Contours × Hats × Wing Sleeves
            </h2>
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7">
              {MATRIX_OUTFITS.map((outfitId, i) => {
                const hatId = MATRIX_HATS[i % MATRIX_HATS.length]!
                const appearance: DuckAppearance = {
                  bodyColorId: 'body-sunshine',
                  outfitId,
                  headId: hatId,
                  faceId: 'face-shades',
                }
                return (
                  <div key={outfitId} className="flex flex-col items-center rounded-xl bg-black/25 p-3">
                    <CosmeticDuck appearance={appearance} size={130} />
                    <span className="mt-2 text-center text-[10px] font-bold text-white/80">
                      {outfitId.replace('outfit-', '')} + {hatId.replace('head-', '')}
                    </span>
                  </div>
                )
              })}
            </div>
          </section>

          {/* Skins x Glasses Matrix */}
          <section className="rounded-2xl border-2 border-white/10 bg-[var(--color-ggd-panel)] p-6">
            <h2 className="font-display text-2xl text-[var(--color-ggd-gold)]">
              3. Thematic Skins × Eyewear & Face Accessories
            </h2>
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-6">
              {MATRIX_SKINS.map((skinId, i) => {
                const faceId = MATRIX_FACES[i % MATRIX_FACES.length]!
                const appearance: DuckAppearance = {
                  bodyColorId: 'body-tangerine',
                  bodySkinId: skinId,
                  faceId,
                  headId: 'head-cap-red',
                }
                return (
                  <div key={skinId} className="flex flex-col items-center rounded-xl bg-black/25 p-3">
                    <CosmeticDuck appearance={appearance} size={140} />
                    <span className="mt-2 text-center text-[10px] font-bold text-white/80">
                      {skinId.replace('bodySkin-', '')} + {faceId.replace('face-', '')}
                    </span>
                  </div>
                )
              })}
            </div>
          </section>

          {/* Pets Baseline Showcase */}
          <section className="rounded-2xl border-2 border-white/10 bg-[var(--color-ggd-panel)] p-6">
            <h2 className="font-display text-2xl text-[var(--color-ggd-gold)]">
              4. Companion Pets (Subordinate Proportions & Baseline Anchor)
            </h2>
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
              {MATRIX_PETS.map((petId) => {
                const appearance: DuckAppearance = {
                  bodyColorId: 'body-mint',
                  petId,
                  headId: 'head-bucket-blue',
                  faceId: 'face-happy',
                }
                return (
                  <div key={petId} className="flex flex-col items-center rounded-xl bg-black/25 p-3">
                    <CosmeticDuck appearance={appearance} size={160} />
                    <span className="mt-2 text-center text-xs font-bold text-white/80">
                      {petId.replace('pet-', '')}
                    </span>
                  </div>
                )
              })}
            </div>
          </section>
        </div>
      )}

      {activeTab === 'scales' && (
        <section className="mt-8 rounded-2xl border-2 border-white/10 bg-[var(--color-ggd-panel)] p-6">
          <h2 className="font-display text-2xl text-[var(--color-ggd-gold)]">
            Multi-Scale Readability Test (72px Thumbnail, 140px Card, 280px Hero)
          </h2>
          <div className="mt-6 space-y-6">
            {[
              {
                title: 'Royal Emperor (Crown + Mantle + Gold Veins + Corgi)',
                appearance: {
                  bodyColorId: 'body-sunshine',
                  headId: 'head-tiny-crown',
                  outfitId: 'outfit-quack-knight',
                  bodySkinId: 'bodySkin-gold-veins',
                  faceId: 'face-happy',
                  petId: 'pet-corgi-pup',
                },
              },
              {
                title: 'Cyberpunk Ninja (Mohawk + Laser Visor + Cyber Suit + Drone)',
                appearance: {
                  bodyColorId: 'body-cyber-cyan',
                  headId: 'head-cyber-mohawk',
                  faceId: 'face-laser-visor',
                  bodySkinId: 'bodySkin-neon-scales',
                  petId: 'pet-shiba-inu',
                },
              },
              {
                title: 'Street Runner (Red Cap + Shades + White Tee + Ripples)',
                appearance: {
                  bodyColorId: 'body-tangerine',
                  headId: 'head-cap-red',
                  faceId: 'face-shades',
                  outfitId: 'outfit-tee-white',
                  trailId: 'trail-ripples',
                },
              },
            ].map((combo, idx) => (
              <div key={idx} className="flex flex-wrap items-center gap-8 rounded-xl bg-black/25 p-4">
                <div className="w-56 font-black text-[var(--color-ggd-neon-green)]">{combo.title}</div>
                <div className="flex flex-col items-center">
                  <CosmeticDuck appearance={combo.appearance} size={72} />
                  <span className="mt-1 text-[10px] text-white/50">72px (Thumb)</span>
                </div>
                <div className="flex flex-col items-center">
                  <CosmeticDuck appearance={combo.appearance} size={140} />
                  <span className="mt-1 text-[10px] text-white/50">140px (Card)</span>
                </div>
                <div className="flex flex-col items-center">
                  <CosmeticDuck appearance={combo.appearance} size={280} />
                  <span className="mt-1 text-[10px] text-white/50">280px (Closet Hero)</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {activeTab === 'auras' && (
        <section className="mt-8 rounded-2xl border-2 border-white/10 bg-[var(--color-ggd-panel)] p-6">
          <h2 className="font-display text-2xl text-[var(--color-ggd-gold)]">
            12 Game-Inspired Dynamic Aura Concepts (Dragon, Buddha Rays, Lightning, Frost, Inferno, Ghosts & More)
          </h2>
          <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {MATRIX_AURAS.map((aura) => {
              const appearance: DuckAppearance = {
                bodyColorId: 'body-midnight',
                auraId: aura.id,
                headId: 'head-tiny-crown',
                faceId: 'face-happy',
                petId: 'pet-calico-cat',
              }
              return (
                <div key={aura.id} className="flex flex-col items-center rounded-xl bg-black/30 p-4">
                  <CosmeticDuck appearance={appearance} size={220} />
                  <span className="mt-3 text-center text-sm font-black text-[var(--color-ggd-gold)]">
                    {aura.name}
                  </span>
                  <span className="text-xs text-white/50">{aura.id}</span>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {activeTab === 'combos' && (
        <section className="mt-8 rounded-2xl border-2 border-white/10 bg-[var(--color-ggd-panel)] p-6">
          <h2 className="font-display text-2xl text-[var(--color-ggd-gold)]">
            Full Modular Avatar Outfits Showcase
          </h2>
          <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                title: 'Viet Duc (Non La + Lucky Ao Dai + Lotus + Calico)',
                appearance: {
                  bodyColorId: 'body-mint',
                  headId: 'head-bamboo-hat',
                  outfitId: 'outfit-lucky-ao-dai',
                  bodySkinId: 'bodySkin-lotus-speckles',
                  petId: 'pet-calico-cat',
                  auraId: 'aura-fireflies',
                },
              },
              {
                title: 'Wizard Apprentice (Curled Hat + Robe + Stardust + Capybara)',
                appearance: {
                  bodyColorId: 'body-lavender',
                  headId: 'head-wizard-hat',
                  faceId: 'face-happy',
                  bodySkinId: 'bodySkin-galaxy-dust',
                  petId: 'pet-mini-capybara',
                  auraId: 'aura-pixel-orbit',
                },
              },
              {
                title: 'Dragon King (Horns + Dragon Robe + Dragon Scales + Baby Dragon)',
                appearance: {
                  bodyColorId: 'body-ruby',
                  headId: 'head-dragon-horns',
                  outfitId: 'outfit-racing-suit',
                  bodySkinId: 'bodySkin-dragon-scale',
                  petId: 'pet-baby-dragon',
                  auraId: 'aura-dragon-flame',
                },
              },
            ].map((combo, idx) => (
              <div key={idx} className="flex flex-col items-center rounded-2xl border-2 border-white/10 bg-black/25 p-5">
                <CosmeticDuck appearance={combo.appearance as DuckAppearance} size={240} />
                <div className="mt-3 text-center font-bold text-[var(--color-ggd-gold)]">{combo.title}</div>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  )
}
