import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { COSMETIC_BY_ID, COSMETIC_CATALOG, DEFAULT_APPEARANCE } from '../lib/cosmetics/catalog'
import { COSMETIC_LAYER_ORDER, type DuckAppearance } from '../lib/cosmetics/types'

async function render() {
  const showcaseSets: Array<{ title: string; appearance: DuckAppearance }> = [
    {
      title: 'Original Combo (Red Cap + Shades + Tiger + ripples + frog)',
      appearance: {
        bodyColorId: 'body-tangerine',
        headId: 'head-cap-red',
        faceId: 'face-shades',
        bodySkinId: 'bodySkin-tiger-quack',
        outfitId: 'outfit-tee-white',
        trailId: 'trail-ripples',
        petId: 'pet-shiba-inu',
        auraId: 'aura-fireflies',
      },
    },
    {
      title: 'Office Worker (Tie + Burnout + Coffee + Mouse)',
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
      title: 'Cyber Duck (Mohawk + Laser Visor + Cyber Samurai + Neon Scales + Drone)',
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
      title: 'Dragon King (Horns + Dragon Robe + Dragon Scales + Baby Dragon + Flame)',
      appearance: {
        bodyColorId: 'body-ruby',
        headId: 'head-dragon-horns',
        outfitId: 'outfit-dragon-robe',
        bodySkinId: 'bodySkin-dragon-scale',
        petId: 'pet-baby-dragon',
        auraId: 'aura-dragon-flame',
        trailId: 'trail-dragon-sparks',
      },
    },
    {
      title: 'Royal Emperor (Crown + Mantle + Gold Veins + Golden Rays + Corgi)',
      appearance: {
        bodyColorId: 'body-sunshine',
        headId: 'head-tiny-crown',
        faceId: 'face-happy',
        outfitId: 'outfit-royal-mantle',
        bodySkinId: 'bodySkin-gold-veins',
        petId: 'pet-corgi-pup',
        auraId: 'aura-golden-rays',
        trailId: 'trail-golden-water',
      },
    },
    {
      title: 'Viet Duck (Bamboo Hat + Lucky Ao Dai + Lotus Speckles + Calico Cat)',
      appearance: {
        bodyColorId: 'body-mint',
        headId: 'head-bamboo-hat',
        outfitId: 'outfit-lucky-ao-dai',
        bodySkinId: 'bodySkin-lotus-speckles',
        petId: 'pet-calico-cat',
        auraId: 'aura-lotus-breeze',
        trailId: 'trail-lotus-petals',
      },
    },
    {
      title: 'Space Voyager (Space Dome + Space Suit + Galaxy Dust + Moon Rabbit)',
      appearance: {
        bodyColorId: 'body-midnight',
        headId: 'head-space-dome',
        outfitId: 'outfit-space-suit',
        bodySkinId: 'bodySkin-galaxy-dust',
        petId: 'pet-moon-rabbit',
        auraId: 'aura-space-dust',
        trailId: 'trail-moon-dust',
      },
    },
    {
      title: 'Street Runner (Bucket Hat + Racing Suit + Pixel Pond + Capybara)',
      appearance: {
        bodyColorId: 'body-lavender',
        headId: 'head-bucket-blue',
        faceId: 'face-pixel-eyes',
        outfitId: 'outfit-racing-suit',
        bodySkinId: 'bodySkin-pixel-pond',
        petId: 'pet-mini-capybara',
        auraId: 'aura-disco-lights',
        trailId: 'trail-pixel-stream',
      },
    },
  ]

  // Render each duck combo to SVG layers HTML
  function duckHtml(appearance: DuckAppearance) {
    const layers = COSMETIC_LAYER_ORDER.flatMap((slot) => {
      const id = appearance[`${slot}Id` as keyof DuckAppearance]
      const item = id ? COSMETIC_BY_ID.get(id) : undefined
      if (!item) return []
      const svgPath = path.join(process.cwd(), 'public', item.asset)
      if (!fs.existsSync(svgPath)) return []
      const svgContent = fs.readFileSync(svgPath, 'utf8')
      return [{ slot, id, svgContent }]
    })

    return `<div style="position: relative; width: 260px; height: 260px; background: #18112c; border-radius: 20px; border: 2px solid #332658; overflow: visible; display: flex; align-items: center; justify-content: center;">
      <svg viewBox="0 0 256 256" style="position: absolute; inset: 0; width: 100%; height: 100%;">
        <ellipse cx="126" cy="218" rx="85" ry="15" fill="#100A20" opacity=".35" />
      </svg>
      ${layers.map((l) => `<div style="position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none;">${l.svgContent}</div>`).join('\n')}
    </div>`
  }

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { background: #0c0818; color: #fff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 30px; margin: 0; }
    h1 { font-size: 24px; margin-bottom: 20px; color: #38ef7d; }
    .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 24px; }
    .card { background: #16102a; border: 2px solid #2d214c; border-radius: 24px; padding: 16px; display: flex; flex-direction: column; align-items: center; }
    .title { font-size: 13px; font-weight: bold; margin-top: 12px; text-align: center; color: #ffd84d; }
  </style>
</head>
<body>
  <h1>AutoDuck Cosmetic Combination Showcase & Visual Inspection</h1>
  <div class="grid">
    ${showcaseSets.map((s) => `<div class="card">${duckHtml(s.appearance)}<div class="title">${s.title}</div></div>`).join('\n')}
  </div>
</body>
</html>`

  const outHtml = path.join(process.cwd(), 'public', 'cosmetics', 'visual-qa.html')
  fs.writeFileSync(outHtml, html, 'utf8')

  const browser = await chromium.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await page.goto(`file://${outHtml}`)
  const outPng = path.join(process.cwd(), 'public', 'cosmetics', 'visual-qa.png')
  await page.screenshot({ path: outPng, fullPage: true })
  await browser.close()

  console.log(`Saved screenshot to ${outPng}`)
}

render().catch(console.error)
