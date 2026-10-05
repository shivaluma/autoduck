import fs from 'node:fs'
import path from 'node:path'
import { chromium, type Browser } from 'playwright'
import { AVATAR_VIEWBOX } from '../../lib/cosmetics/avatar-rig'
import { MOTION_SPRITE, type CosmeticDefinition } from '../../lib/cosmetics/types'

/**
 * Bakes an SVG's SMIL animation into a sprite sheet: every frame is a separate inline copy paused at
 * its own timestamp. IDs are namespaced per frame, otherwise url(#…) would resolve to frame 0's
 * gradients/masks and animated gradients would freeze.
 */
function frameMarkup(content: string, frame: number) {
  const prefix = `f${frame}-`
  return content
    .replace(/\bid="([^"]+)"/g, `id="${prefix}$1"`)
    .replace(/url\(#([^)]+)\)/g, `url(#${prefix}$1)`)
    .replace(/href="#([^"]+)"/g, `href="#${prefix}$1"`)
}

async function launch(): Promise<Browser> {
  return chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }))
}

export async function renderSpriteSheets(items: Array<{ item: CosmeticDefinition; content: string }>) {
  const { frames, columns, frameSize, fps } = MOTION_SPRITE
  const rows = Math.ceil(frames / columns)
  const browser = await launch()
  const page = await browser.newPage({ viewport: { width: columns * frameSize, height: rows * frameSize }, deviceScaleFactor: 1 })
  try {
    for (const { item, content } of items) {
      const cells = Array.from({ length: frames }, (_, frame) =>
        `<svg data-t="${(frame / fps).toFixed(3)}" xmlns="http://www.w3.org/2000/svg" viewBox="${AVATAR_VIEWBOX}" width="${frameSize}" height="${frameSize}">${frameMarkup(content, frame)}</svg>`).join('')
      await page.setContent(`<style>html,body{margin:0;background:transparent}main{display:grid;grid-template-columns:repeat(${columns},${frameSize}px);line-height:0}</style><main>${cells}</main>`)
      await page.evaluate(() => document.querySelectorAll('svg[data-t]').forEach((node) => {
        const svg = node as SVGSVGElement
        svg.pauseAnimations()
        svg.setCurrentTime(Number(svg.dataset.t))
      }))
      await page.waitForTimeout(50)
      const output = path.join(process.cwd(), 'public', item.spriteAsset!)
      fs.mkdirSync(path.dirname(output), { recursive: true })
      await page.locator('main').screenshot({ path: output, omitBackground: true })
    }
  } finally {
    await browser.close()
  }
}
