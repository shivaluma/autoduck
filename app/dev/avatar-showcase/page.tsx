'use client'

import { useState } from 'react'
import Link from 'next/link'
import { CosmeticDuck } from '@/components/cosmetics/cosmetic-duck'
import type { DuckAppearance } from '@/lib/cosmetics/types'

const CURATED_SHOWCASE = [
  {
    title: 'Royal Emperor',
    paletteName: 'Sunshine Gold + Slate Navy + Ruby Gem',
    desc: 'Grand coronation regalia with diamond crown, quack knight armor, gold veins, and sacred golden mandala.',
    appearance: {
      bodyColorId: 'body-sunshine',
      headId: 'head-tiny-crown',
      faceId: 'face-happy',
      outfitId: 'outfit-quack-knight',
      bodySkinId: 'bodySkin-gold-veins',
      petId: 'pet-corgi-pup',
      auraId: 'aura-golden-rays',
      trailId: 'trail-golden-water',
    },
  },
  {
    title: 'Viet Duck',
    paletteName: 'Jade Mint + Bamboo Straw + Lotus Rose',
    desc: 'Traditional Vietnamese ensemble with authentic Nón Lá, emerald Áo Dài, lotus speckles, and Calico cat companion.',
    appearance: {
      bodyColorId: 'body-mint',
      headId: 'head-bamboo-hat',
      faceId: 'face-happy',
      outfitId: 'outfit-lucky-ao-dai',
      bodySkinId: 'bodySkin-lotus-speckles',
      petId: 'pet-calico-cat',
      auraId: 'aura-lotus-breeze',
      trailId: 'trail-lotus-petals',
    },
  },
  {
    title: 'Cyber Duck',
    paletteName: 'Cyber Cyan + Midnight Navy + Neon Magenta',
    desc: 'Disciplined cyber aesthetic: slim laser visor, magenta mohawk, cyber samurai armor, and tactical hologram HUD.',
    appearance: {
      bodyColorId: 'body-cyber-cyan',
      headId: 'head-cyber-mohawk',
      faceId: 'face-laser-visor',
      outfitId: 'outfit-cyber-samurai',
      bodySkinId: 'bodySkin-neon-scales',
      petId: 'pet-tiny-drone',
      auraId: 'aura-neon-glitch',
      trailId: 'trail-neon-wake',
    },
  },
  {
    title: 'Dragon King',
    paletteName: 'Ruby Crimson + Charcoal Red + Emperor Gold',
    desc: 'Mythic draconian lord with scaled horns, crimson racing robe, baby dragon pet, and astral dragon spirit aura.',
    appearance: {
      bodyColorId: 'body-ruby',
      headId: 'head-dragon-horns',
      faceId: 'face-happy',
      outfitId: 'outfit-racing-suit',
      bodySkinId: 'bodySkin-dragon-scale',
      petId: 'pet-baby-dragon',
      auraId: 'aura-dragon-flame',
      trailId: 'trail-dragon-sparks',
    },
  },
  {
    title: 'Space Voyager',
    paletteName: 'Cosmic Slate + Spacecraft White + Starlight Cyan',
    desc: 'Deep space explorer with clean space helmet dome, full life-support suit, stardust freckles, and moon rabbit.',
    appearance: {
      bodyColorId: 'body-midnight',
      headId: 'head-space-dome',
      faceId: 'face-happy',
      outfitId: 'outfit-space-suit',
      bodySkinId: 'bodySkin-galaxy-dust',
      petId: 'pet-moon-rabbit',
      auraId: 'aura-space-dust',
      trailId: 'trail-moon-dust',
    },
  },
  {
    title: 'Office Worker',
    paletteName: 'Sky Blue + Slate Navy + Monday Crimson',
    desc: 'Relatable workplace survivor with clean headset, monday tie, subtle burnout eyebags, and office mouse.',
    appearance: {
      bodyColorId: 'body-sky',
      headId: 'head-office-headset',
      faceId: 'face-office-burnout',
      outfitId: 'outfit-office-tie',
      bodySkinId: 'bodySkin-coffee-stains',
      petId: 'pet-office-mouse',
      auraId: 'aura-coffee-steam',
      trailId: 'trail-coffee-spill',
    },
  },
  {
    title: 'Street Runner',
    paletteName: 'Tangerine Orange + Race Red + Clean White',
    desc: 'Arcade river athlete with red race cap, pond shades, white tee, tiger skin, and Shiba Inu.',
    appearance: {
      bodyColorId: 'body-tangerine',
      headId: 'head-cap-red',
      faceId: 'face-shades',
      outfitId: 'outfit-tee-white',
      bodySkinId: 'bodySkin-tiger-quack',
      petId: 'pet-shiba-inu',
      auraId: 'aura-fireflies',
      trailId: 'trail-ripples',
    },
  },
  {
    title: 'Wizard Apprentice',
    paletteName: 'Lavender Violet + Arcane Purple + Stardust Gold',
    desc: 'Mystical spellcaster with star-crested curved wizard hat, galaxy dust, capybara, and arcade pixel orbit.',
    appearance: {
      bodyColorId: 'body-lavender',
      headId: 'head-wizard-hat',
      faceId: 'face-happy',
      outfitId: 'outfit-dev-hoodie',
      bodySkinId: 'bodySkin-galaxy-dust',
      petId: 'pet-mini-capybara',
      auraId: 'aura-pixel-orbit',
      trailId: 'trail-pixel-stream',
    },
  },
]

const AURAS_SHOWCASE = [
  { id: 'aura-dragon-flame', name: 'Thần Long Bao Thân / Astral Dragon Spirit' },
  { id: 'aura-golden-rays', name: 'Phật Quang Vạn Trượng / Golden Mandala' },
  { id: 'aura-storm-cloud', name: 'Lôi Thần Sấm Sét / Lightning Arc Tempest' },
  { id: 'aura-moon-glow', name: 'Hàn Băng Cực Quang / Glacial Frost Aurora' },
  { id: 'aura-chilli-heat', name: 'Hỏa Diệm Sơn / Super Saiyan Inferno' },
  { id: 'aura-ghost-fog', name: 'U Hồn Vạn Quỷ / Spectral Soul Wisps' },
  { id: 'aura-neon-glitch', name: 'Cyber Matrix HUD / Hologram Ring' },
  { id: 'aura-lotus-breeze', name: 'Hoa Khai Phú Quý / Lotus Cyclone' },
  { id: 'aura-space-dust', name: 'Cosmic Singularity / Galaxy Nebula' },
  { id: 'aura-disco-lights', name: 'Neon Disco / Stage Lasers' },
  { id: 'aura-bubble-halo', name: 'Thủy Cung Thần Châu / Tidal Vortex' },
  { id: 'aura-lucky-leaves', name: 'Kim Tiền Cát Tường / Lucky Coins' },
]

export default function AvatarShowcasePage() {
  const [activeTab, setActiveTab] = useState<'builds' | 'scales' | 'auras'>('builds')

  return (
    <main className="mx-auto min-h-screen max-w-7xl p-6 text-white">
      <header className="rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] p-6 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-xs font-black tracking-[0.2em] text-[var(--color-ggd-neon-green)]">
              DZỊT SEASON 3 — ART DIRECTION SHOWCASE
            </div>
            <h1 className="font-display text-4xl">Avatar Fantasy Showcase</h1>
            <p className="mt-2 text-sm text-white/70">
              Curated Theme Builds — Strict Visual Hierarchy: Face &gt; Hero Item &gt; Body &gt; Aura &gt; Pet &gt; Trail
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/dev/avatar-compatibility"
              className="rounded-xl border-2 border-[var(--color-ggd-gold)] bg-[var(--color-ggd-gold)]/20 px-4 py-2 text-xs font-black text-[var(--color-ggd-gold)] transition hover:bg-[var(--color-ggd-gold)] hover:text-black"
            >
              Go to Compatibility Matrix →
            </Link>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          {(['builds', 'scales', 'auras'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`rounded-full px-5 py-2 text-xs font-black uppercase transition-colors ${
                activeTab === tab
                  ? 'bg-[var(--color-ggd-neon-green)] text-[var(--color-ggd-outline)]'
                  : 'bg-black/30 text-white/70 hover:bg-black/50'
              }`}
            >
              {tab === 'builds' ? '8 Curated Builds' : tab === 'scales' ? 'Multi-Scale Test (72/140/280px)' : '12 Dynamic Auras'}
            </button>
          ))}
        </div>
      </header>

      {activeTab === 'builds' && (
        <section className="mt-8">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {CURATED_SHOWCASE.map((item, idx) => (
              <div
                key={idx}
                className="flex flex-col items-center rounded-2xl border-2 border-white/10 bg-[var(--color-ggd-panel)] p-5 shadow-lg transition hover:border-[var(--color-ggd-neon-green)]"
              >
                <div className="relative flex aspect-square w-full items-center justify-center rounded-xl bg-black/30 p-2">
                  <CosmeticDuck appearance={item.appearance as DuckAppearance} size={220} />
                </div>
                <div className="mt-4 w-full">
                  <h3 className="font-display text-xl text-[var(--color-ggd-gold)]">{item.title}</h3>
                  <div className="mt-1 text-[11px] font-bold text-[var(--color-ggd-neon-green)]">
                    {item.paletteName}
                  </div>
                  <p className="mt-2 text-xs text-white/70">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {activeTab === 'scales' && (
        <section className="mt-8 rounded-2xl border-2 border-white/10 bg-[var(--color-ggd-panel)] p-6">
          <h2 className="font-display text-2xl text-[var(--color-ggd-gold)]">
            Multi-Scale Readability Test (1-Second Eye Identification Rule)
          </h2>
          <p className="mt-1 text-sm text-white/70">
            At 72px Thumbnail, the face and eyes must be identifiable in under one second without background aura competition.
          </p>
          <div className="mt-6 space-y-6">
            {CURATED_SHOWCASE.slice(0, 4).map((combo, idx) => (
              <div key={idx} className="flex flex-wrap items-center gap-8 rounded-xl bg-black/30 p-5">
                <div className="w-64 font-black text-[var(--color-ggd-neon-green)]">{combo.title}</div>
                <div className="flex flex-col items-center">
                  <CosmeticDuck appearance={combo.appearance as DuckAppearance} size={72} />
                  <span className="mt-2 text-[11px] font-bold text-white/50">72px (Thumb)</span>
                </div>
                <div className="flex flex-col items-center">
                  <CosmeticDuck appearance={combo.appearance as DuckAppearance} size={140} />
                  <span className="mt-2 text-[11px] font-bold text-white/50">140px (Card)</span>
                </div>
                <div className="flex flex-col items-center">
                  <CosmeticDuck appearance={combo.appearance as DuckAppearance} size={260} />
                  <span className="mt-2 text-[11px] font-bold text-white/50">260px (Closet Hero)</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {activeTab === 'auras' && (
        <section className="mt-8 rounded-2xl border-2 border-white/10 bg-[var(--color-ggd-panel)] p-6">
          <h2 className="font-display text-2xl text-[var(--color-ggd-gold)]">
            12 Dynamic Game Auras (Silhouette Clearance & Visual Budget Applied)
          </h2>
          <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {AURAS_SHOWCASE.map((aura) => {
              const appearance: DuckAppearance = {
                bodyColorId: 'body-midnight',
                auraId: aura.id,
                headId: 'head-tiny-crown',
                faceId: 'face-happy',
                petId: 'pet-calico-cat',
              }
              return (
                <div key={aura.id} className="flex flex-col items-center rounded-xl bg-black/30 p-4">
                  <CosmeticDuck appearance={appearance} size={200} />
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
    </main>
  )
}
