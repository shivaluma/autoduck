'use client'

import { useEffect, useId } from 'react'
import type PhaserType from 'phaser'
import { RACE_FX_DECOR, RACE_FX_ICONS, RACE_FX_SHEETS, type RaceFxSheetKey } from '@/lib/race-fx/manifest'
import { callout, createParticleTextures, createRaceFxAnims, decorKey, iconKey, loopSprite, playFx, preloadRaceFx } from '@/components/racing/race-fx'

/** Visual QA for the race FX set: every loop playing, every one-shot re-fired on a timer, icons and decor. */
export default function RaceFxGalleryPage() {
  const parentId = `race-fx-${useId().replace(/:/g, '')}`

  useEffect(() => {
    let game: PhaserType.Game | null = null
    void import('phaser').then((module) => {
      const Phaser = module.default ?? module
      class Gallery extends Phaser.Scene {
        constructor() { super('race-fx-gallery') }
        preload() { preloadRaceFx(this) }
        create() {
          createParticleTextures(this)
          createRaceFxAnims(this)
          const cell = 150
          const label = (x: number, y: number, text: string) => this.add.text(x, y, text, { fontFamily: 'monospace', fontSize: '11px', color: '#dbeafe' }).setOrigin(0.5, 0)
          RACE_FX_SHEETS.forEach((sheet, index) => {
            const x = 80 + (index % 9) * cell
            const y = 90 + Math.floor(index / 9) * (cell + 10)
            this.add.rectangle(x, y, cell - 10, cell - 10, 0x1a78ab).setStrokeStyle(2, 0x34a8da)
            label(x, y + cell / 2 - 18, `${sheet.key}${sheet.loop ? '' : ' ↻'}`)
            if (sheet.loop) {
              loopSprite(this, sheet.key, x, y - 6, cell - 30)
            } else {
              const fire = () => playFx(this, sheet.key as RaceFxSheetKey, x, y - 6, { size: cell - 20, depth: 10 })
              fire()
              this.time.addEvent({ delay: 1600, loop: true, callback: fire })
            }
          })
          const iconY = 600
          RACE_FX_ICONS.forEach((icon, index) => {
            const x = 70 + index * 72
            this.add.circle(x, iconY, 22, 0x100b20, 0.85).setStrokeStyle(2, 0xffffff, 0.7)
            this.add.image(x, iconY, iconKey(icon)).setDisplaySize(34, 34)
            label(x, iconY + 28, icon)
          })
          RACE_FX_DECOR.forEach((decor, index) => {
            const x = 70 + (index % 10) * 130
            const y = 780 + Math.floor(index / 10) * 120
            this.add.image(x, y, decorKey(decor)).setDisplaySize(80, 80)
            label(x, y + 46, decor)
          })
          const tones = ['fire', 'nitro', 'gold', 'ice', 'green', 'pink', 'gray'] as const
          const words = ['BOOM!', 'NITRO!', '+1 QP', 'BLOCKED!', 'DODGE!', 'SLIP!', 'MUTED']
          this.time.addEvent({ delay: 1400, loop: true, callback: () => tones.forEach((tone, index) => callout(this, 120 + index * 170, 680, words[index]!, tone, false)) })
        }
      }
      game = new Phaser.Game({
        type: Phaser.AUTO, parent: parentId, backgroundColor: '#0f2233', width: 1400, height: 1000, scene: Gallery,
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      })
    })
    return () => game?.destroy(true)
  }, [parentId])

  return (
    <main className="min-h-screen bg-[#0b1a28] p-6 text-white">
      <h1 className="font-display text-3xl">Race FX gallery</h1>
      <p className="mb-4 text-sm text-white/60">Loops play continuously; ↻ one-shots re-fire every 1.6s. Regenerate assets with <code>pnpm race:fx</code>.</p>
      <div id={parentId} className="aspect-[1400/1000] w-full overflow-hidden rounded-2xl border-2 border-white/10" />
    </main>
  )
}
