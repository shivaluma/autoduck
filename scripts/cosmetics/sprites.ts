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

export interface SpriteJob {
  content: string
  /** Absolute output path of the PNG sheet. */
  output: string
  viewBox: string
  frames: number
  columns: number
  frameSize: number
  fps: number
}

/** Renders each job's animation into a grid sprite sheet (frame i sampled at i / fps seconds). */
export async function renderSpriteJobs(jobs: SpriteJob[]) {
  const browser = await launch()
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 })
  try {
    for (const job of jobs) {
      const cells = Array.from({ length: job.frames }, (_, frame) =>
        `<svg data-t="${(frame / job.fps).toFixed(3)}" xmlns="http://www.w3.org/2000/svg" viewBox="${job.viewBox}" width="${job.frameSize}" height="${job.frameSize}">${frameMarkup(job.content, frame)}</svg>`).join('')
      await page.setViewportSize({ width: job.columns * job.frameSize, height: Math.ceil(job.frames / job.columns) * job.frameSize })
      await page.setContent(`<style>html,body{margin:0;background:transparent}main{display:grid;grid-template-columns:repeat(${job.columns},${job.frameSize}px);line-height:0}</style><main>${cells}</main>`)
      await page.evaluate(() => document.querySelectorAll('svg[data-t]').forEach((node) => {
        const svg = node as SVGSVGElement
        svg.pauseAnimations()
        svg.setCurrentTime(Number(svg.dataset.t))
      }))
      await page.waitForTimeout(50)
      fs.mkdirSync(path.dirname(job.output), { recursive: true })
      await page.locator('main').screenshot({ path: job.output, omitBackground: true })
    }
  } finally {
    await browser.close()
  }
}

export async function renderSpriteSheets(items: Array<{ item: CosmeticDefinition; content: string }>) {
  const { frames, columns, frameSize, fps } = MOTION_SPRITE
  await renderSpriteJobs(items.map(({ item, content }) => ({
    content, frames, columns, frameSize, fps, viewBox: AVATAR_VIEWBOX,
    output: path.join(process.cwd(), 'public', item.spriteAsset!),
  })))
}
