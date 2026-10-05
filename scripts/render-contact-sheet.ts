import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { COSMETIC_BY_ID, COSMETIC_CATALOG } from '../lib/cosmetics/catalog'
import { COSMETIC_LAYER_ORDER, COSMETIC_RARITIES, SLOT_FRAMES, type CosmeticSlot, type DuckAppearance } from '../lib/cosmetics/types'

// Renders public/cosmetics/contact-sheet.{html,png}: every closet tab grouped by rarity on a real duck,
// plus full themed builds. Run after `pnpm cosmetics:generate`.

const TABS: Array<[CosmeticSlot, string]> = [
  ['bodyColor', 'Màu'], ['bodySkin', 'Skin'], ['face', 'Mặt'], ['head', 'Nón'],
  ['outfit', 'Áo'], ['pet', 'Pet'], ['aura', 'Aura'], ['trail', 'Trail'],
]
const RARITY_COLOR = { common: '#94A3B8', uncommon: '#4ADE80', rare: '#38BDF8', epic: '#C084FC', legendary: '#FBBF24' } as const

const BUILDS: Array<[string, DuckAppearance]> = [
  ['Pond Royalty', { bodyColorId: 'body-golden', headId: 'head-dragon-emperor-crown', outfitId: 'outfit-dragon-robe', faceId: 'face-monocle', petId: 'pet-baby-dragon', auraId: 'aura-dragon-flame', trailId: 'trail-golden-water' }],
  ['Viet Duck', { bodyColorId: 'body-mint', headId: 'head-bamboo-hat', outfitId: 'outfit-lucky-ao-dai', bodySkinId: 'bodySkin-koi-patches', faceId: 'face-happy', petId: 'pet-coffee-slime', auraId: 'aura-lotus-breeze', trailId: 'trail-lotus-petals' }],
  ['Cyber Quack', { bodyColorId: 'body-chrome', headId: 'head-cyber-mohawk', faceId: 'face-laser-visor', outfitId: 'outfit-cyber-samurai', bodySkinId: 'bodySkin-circuit-feathers', petId: 'pet-neon-jellyfish', auraId: 'aura-neon-glitch', trailId: 'trail-neon-wake' }],
  ['Cosmic Pond', { bodyColorId: 'body-midnight', headId: 'head-space-dome', faceId: 'face-cosmic-eyes', outfitId: 'outfit-space-suit', bodySkinId: 'bodySkin-galaxy-dust', petId: 'pet-moon-rabbit', auraId: 'aura-fireflies', trailId: 'trail-bubble-wake' }],
  ['Office Survivor', { bodyColorId: 'body-sky', headId: 'head-office-headset', faceId: 'face-monday-face', outfitId: 'outfit-office-tie', bodySkinId: 'bodySkin-band-aid-hero', petId: 'pet-office-mouse', auraId: 'aura-coffee-steam', trailId: 'trail-coffee-spill' }],
  ['Spirit Lotus', { bodyColorId: 'body-pearl', headId: 'head-wizard-hat', faceId: 'face-kitsune-mask', outfitId: 'outfit-spirit-haori', bodySkinId: 'bodySkin-gold-veins', petId: 'pet-lucky-black-cat', auraId: 'aura-ghost-fog', trailId: 'trail-lotus-petals' }],
]

const root = path.join(process.cwd(), 'public')
const inline = (asset: string) => `data:image/svg+xml;base64,${fs.readFileSync(path.join(root, asset)).toString('base64')}`

function duck(appearance: DuckAppearance, size: number, frame = SLOT_FRAMES.bodyColor) {
  const [x, y, s] = frame
  const scale = 560 / s
  const layers = COSMETIC_LAYER_ORDER.flatMap((slot) => {
    const item = COSMETIC_BY_ID.get(appearance[`${slot}Id` as keyof DuckAppearance] ?? '')
    return item ? [`<img src="${inline(item.asset)}" style="position:absolute;inset:0;width:100%;height:100%">`] : []
  }).join('')
  return `<div style="position:relative;width:${size}px;height:${size}px;overflow:hidden"><div style="position:absolute;width:${scale * 100}%;height:${scale * 100}%;left:${-((x + 24) / s) * 100}%;top:${-((y + 56) / s) * 100}%">${layers}</div></div>`
}

const base: DuckAppearance = { bodyColorId: 'body-sunshine' }
const sections = TABS.map(([slot, label]) => {
  const rows = COSMETIC_RARITIES.map((rarity) => {
    const items = COSMETIC_CATALOG.filter((item) => item.slot === slot && item.rarity === rarity)
    const cells = items.map((item) => {
      const appearance = slot === 'bodyColor' ? { bodyColorId: item.id } : { ...base, [`${slot}Id`]: item.id }
      return `<figure style="border-color:${RARITY_COLOR[rarity]}66">${duck(appearance as DuckAppearance, 132, SLOT_FRAMES[slot])}<figcaption style="color:${rarity === 'common' ? '#E2E8F0' : RARITY_COLOR[rarity]}">${item.name}</figcaption></figure>`
    }).join('')
    return `<div class="row"><div class="rarity" style="color:${RARITY_COLOR[rarity]}">${rarity}</div><div class="cells">${cells}</div></div>`
  }).join('')
  return `<section><h2>${label} <small>${COSMETIC_CATALOG.filter((item) => item.slot === slot).length} items</small></h2>${rows}</section>`
}).join('')

const builds = BUILDS.map(([name, appearance]) => `<figure class="build">${duck(appearance, 260)}<figcaption>${name}</figcaption></figure>`).join('')

const html = `<!doctype html><meta charset="utf-8"><title>Duck Closet v2</title><style>
body{margin:0;padding:32px;background:#140f24;color:#fff;font:600 13px/1.3 system-ui,sans-serif}
h1{margin:0 0 4px;font-size:30px;color:#58E6B0}p.sub{margin:0 0 24px;color:#a59cc4}
section{background:#1d1636;border:1px solid #2d2450;border-radius:16px;padding:16px 20px;margin-bottom:18px}
h2{margin:0 0 10px;font-size:18px;color:#FFD84D}h2 small{color:#8a80ad;font-size:12px}
.row{display:flex;gap:12px;align-items:center;margin:6px 0}.rarity{width:86px;text-transform:uppercase;font-size:11px;letter-spacing:.08em}
.cells{display:flex;flex-wrap:wrap;gap:8px}figure{margin:0;border:2px solid;border-radius:12px;background:#261d45;padding:4px;text-align:center}
figcaption{font-size:11px;padding:2px 0 4px;max-width:132px}.builds{display:flex;flex-wrap:wrap;gap:14px}.build{border-color:#FFD84D55}.build figcaption{font-size:14px;color:#FFD84D}
</style><h1>Duck Closet v2</h1><p class="sub">${COSMETIC_CATALOG.length} hand-designed items · rarity = art budget · every item shown on a real duck</p>
<section><h2>Full builds</h2><div class="builds">${builds}</div></section>${sections}`

async function main() {
  const outHtml = path.join(root, 'cosmetics', 'contact-sheet.html')
  fs.writeFileSync(outHtml, html, 'utf8')
  const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }))
  const page = await browser.newPage({ viewport: { width: 1560, height: 1000 } })
  await page.setContent(html, { waitUntil: 'load' })
  await page.waitForTimeout(400)
  await page.screenshot({ path: path.join(root, 'cosmetics', 'contact-sheet.png'), fullPage: true })
  await browser.close()
  console.log(`✓ Contact sheet written to ${outHtml}`)
}

void main()
