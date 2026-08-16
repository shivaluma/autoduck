'use client'

import { useState } from 'react'
import Link from 'next/link'
import { CosmeticDuck } from '@/components/cosmetics/cosmetic-duck'
import { COSMETIC_CATALOG, DEFAULT_APPEARANCE } from '@/lib/cosmetics/catalog'
import type { DuckAppearance } from '@/lib/cosmetics/types'

const HATS = COSMETIC_CATALOG.filter((i) => i.slot === 'head').slice(0, 10)
const FACES = COSMETIC_CATALOG.filter((i) => i.slot === 'face').slice(0, 10)
const OUTFITS = COSMETIC_CATALOG.filter((i) => i.slot === 'outfit').slice(0, 10)
const SKINS = COSMETIC_CATALOG.filter((i) => i.slot === 'bodySkin').slice(0, 6)
const AURAS = COSMETIC_CATALOG.filter((i) => i.slot === 'aura').slice(0, 6)
const NECKS = COSMETIC_CATALOG.filter((i) => i.slot === 'neck').slice(0, 6)

export default function AvatarCompatibilityPage() {
  const [matrixType, setMatrixType] = useState<
    'single-hat' | 'single-face' | 'single-outfit' | 'hat-plus-face' | 'outfit-plus-neck' | 'hat-plus-aura' | 'skin-plus-hat'
  >('single-hat')

  return (
    <main className="mx-auto min-h-screen max-w-7xl p-6 text-white">
      <header className="rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] p-6 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-xs font-black tracking-[0.2em] text-[var(--color-ggd-gold)]">
              DZỊT SEASON 3 — SYSTEM COMPATIBILITY MATRIX
            </div>
            <h1 className="font-display text-4xl">Rig Swap &amp; Occlusion Matrix</h1>
            <p className="mt-2 text-sm text-white/70">
              Systematic Unit Testing for 2D Sprite-Swap Layers, Face Safe Zone, and Attachment Points
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/dev/avatar-showcase"
              className="rounded-xl border-2 border-[var(--color-ggd-neon-green)] bg-[var(--color-ggd-neon-green)]/20 px-4 py-2 text-xs font-black text-[var(--color-ggd-neon-green)] transition hover:bg-[var(--color-ggd-neon-green)] hover:text-black"
            >
              ← Back to Fantasy Showcase
            </Link>
          </div>
        </div>

        {/* Matrix Selector Tabs */}
        <div className="mt-6 flex flex-wrap gap-2">
          {[
            { id: 'single-hat', label: '1. Base + Single Hat' },
            { id: 'single-face', label: '2. Base + Single Face' },
            { id: 'single-outfit', label: '3. Base + Single Outfit' },
            { id: 'hat-plus-face', label: '4. Hat + Face Combo' },
            { id: 'outfit-plus-neck', label: '5. Outfit + Neck Combo' },
            { id: 'hat-plus-aura', label: '6. Hat + Aura Clearance' },
            { id: 'skin-plus-hat', label: '7. Skin + Hat Matrix' },
          ].map((m) => (
            <button
              key={m.id}
              onClick={() => setMatrixType(m.id as typeof matrixType)}
              className={`rounded-full px-4 py-2 text-xs font-black uppercase transition-colors ${
                matrixType === m.id
                  ? 'bg-[var(--color-ggd-gold)] text-black'
                  : 'bg-black/30 text-white/70 hover:bg-black/50'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </header>

      {/* 1. Base + Single Hat */}
      {matrixType === 'single-hat' && (
        <section className="mt-8 rounded-2xl border-2 border-white/10 bg-[var(--color-ggd-panel)] p-6">
          <h2 className="font-display text-xl text-[var(--color-ggd-gold)]">
            Base Duck + Single Hat (Anchor: HEAD_CENTER 336, 144 / Baseline Clearance Y &le; 116)
          </h2>
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
            {HATS.map((hat) => {
              const appearance: DuckAppearance = {
                ...DEFAULT_APPEARANCE,
                headId: hat.id,
              }
              return (
                <div key={hat.id} className="flex flex-col items-center rounded-xl bg-black/30 p-3">
                  <CosmeticDuck appearance={appearance} size={150} />
                  <span className="mt-2 text-center text-xs font-black">{hat.name}</span>
                  <span className="text-[10px] text-white/40">{hat.id}</span>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* 2. Base + Single Face */}
      {matrixType === 'single-face' && (
        <section className="mt-8 rounded-2xl border-2 border-white/10 bg-[var(--color-ggd-panel)] p-6">
          <h2 className="font-display text-xl text-[var(--color-ggd-gold)]">
            Base Duck + Single Face (Face Safe Zone Check: Eye &amp; Beak Readability)
          </h2>
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
            {FACES.map((face) => {
              const appearance: DuckAppearance = {
                ...DEFAULT_APPEARANCE,
                faceId: face.id,
              }
              return (
                <div key={face.id} className="flex flex-col items-center rounded-xl bg-black/30 p-3">
                  <CosmeticDuck appearance={appearance} size={150} />
                  <span className="mt-2 text-center text-xs font-black">{face.name}</span>
                  <span className="text-[10px] text-white/40">{face.id}</span>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* 3. Base + Single Outfit */}
      {matrixType === 'single-outfit' && (
        <section className="mt-8 rounded-2xl border-2 border-white/10 bg-[var(--color-ggd-panel)] p-6">
          <h2 className="font-display text-xl text-[var(--color-ggd-gold)]">
            Base Duck + Single Outfit (Torso Hugging + Wing Sleeve Alignment)
          </h2>
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
            {OUTFITS.map((outfit) => {
              const appearance: DuckAppearance = {
                ...DEFAULT_APPEARANCE,
                outfitId: outfit.id,
              }
              return (
                <div key={outfit.id} className="flex flex-col items-center rounded-xl bg-black/30 p-3">
                  <CosmeticDuck appearance={appearance} size={150} />
                  <span className="mt-2 text-center text-xs font-black">{outfit.name}</span>
                  <span className="text-[10px] text-white/40">{outfit.id}</span>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* 4. Hat + Face Combinations */}
      {matrixType === 'hat-plus-face' && (
        <section className="mt-8 rounded-2xl border-2 border-white/10 bg-[var(--color-ggd-panel)] p-6">
          <h2 className="font-display text-xl text-[var(--color-ggd-gold)]">
            Hat + Face Combinations (Brim vs Eyewear Collision Check)
          </h2>
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {HATS.slice(0, 4).flatMap((hat) =>
              FACES.slice(0, 3).map((face) => {
                const appearance: DuckAppearance = {
                  ...DEFAULT_APPEARANCE,
                  headId: hat.id,
                  faceId: face.id,
                }
                return (
                  <div key={`${hat.id}-${face.id}`} className="flex flex-col items-center rounded-xl bg-black/30 p-3">
                    <CosmeticDuck appearance={appearance} size={150} />
                    <span className="mt-2 text-center text-xs font-black text-[var(--color-ggd-neon-green)]">
                      {hat.name} + {face.name}
                    </span>
                  </div>
                )
              }),
            )}
          </div>
        </section>
      )}

      {/* 5. Outfit + Neck Combinations */}
      {matrixType === 'outfit-plus-neck' && (
        <section className="mt-8 rounded-2xl border-2 border-white/10 bg-[var(--color-ggd-panel)] p-6">
          <h2 className="font-display text-xl text-[var(--color-ggd-gold)]">
            Outfit + Neck Items (Collar &amp; Tie Layering Check)
          </h2>
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {OUTFITS.slice(0, 4).flatMap((outfit) =>
              NECKS.slice(0, 3).map((neck) => {
                const appearance: DuckAppearance = {
                  ...DEFAULT_APPEARANCE,
                  outfitId: outfit.id,
                  neckId: neck.id,
                }
                return (
                  <div key={`${outfit.id}-${neck.id}`} className="flex flex-col items-center rounded-xl bg-black/30 p-3">
                    <CosmeticDuck appearance={appearance} size={150} />
                    <span className="mt-2 text-center text-xs font-black text-[var(--color-ggd-gold)]">
                      {outfit.name} + {neck.name}
                    </span>
                  </div>
                )
              }),
            )}
          </div>
        </section>
      )}

      {/* 6. Hat + Aura Clearance */}
      {matrixType === 'hat-plus-aura' && (
        <section className="mt-8 rounded-2xl border-2 border-white/10 bg-[var(--color-ggd-panel)] p-6">
          <h2 className="font-display text-xl text-[var(--color-ggd-gold)]">
            Large Headwear + Full Aura (Silhouette Clearance Gap Check)
          </h2>
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {HATS.slice(0, 4).flatMap((hat) =>
              AURAS.slice(0, 3).map((aura) => {
                const appearance: DuckAppearance = {
                  ...DEFAULT_APPEARANCE,
                  headId: hat.id,
                  auraId: aura.id,
                }
                return (
                  <div key={`${hat.id}-${aura.id}`} className="flex flex-col items-center rounded-xl bg-black/30 p-3">
                    <CosmeticDuck appearance={appearance} size={150} />
                    <span className="mt-2 text-center text-xs font-black text-[var(--color-ggd-neon-green)]">
                      {hat.name} + {aura.name}
                    </span>
                  </div>
                )
              }),
            )}
          </div>
        </section>
      )}

      {/* 7. Skin + Hat Matrix */}
      {matrixType === 'skin-plus-hat' && (
        <section className="mt-8 rounded-2xl border-2 border-white/10 bg-[var(--color-ggd-panel)] p-6">
          <h2 className="font-display text-xl text-[var(--color-ggd-gold)]">
            Body Skins + Headwear (Tattoo vs Headwear Boundary Check)
          </h2>
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {SKINS.slice(0, 4).flatMap((skin) =>
              HATS.slice(0, 3).map((hat) => {
                const appearance: DuckAppearance = {
                  ...DEFAULT_APPEARANCE,
                  bodySkinId: skin.id,
                  headId: hat.id,
                }
                return (
                  <div key={`${skin.id}-${hat.id}`} className="flex flex-col items-center rounded-xl bg-black/30 p-3">
                    <CosmeticDuck appearance={appearance} size={150} />
                    <span className="mt-2 text-center text-xs font-black text-[var(--color-ggd-gold)]">
                      {skin.name} + {hat.name}
                    </span>
                  </div>
                )
              }),
            )}
          </div>
        </section>
      )}
    </main>
  )
}
