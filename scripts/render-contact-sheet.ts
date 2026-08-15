import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { COSMETIC_BY_ID, DEFAULT_APPEARANCE } from '../lib/cosmetics/catalog'
import { COSMETIC_LAYER_ORDER, type DuckAppearance } from '../lib/cosmetics/types'

async function renderContactSheet() {
  function renderDuck(appearance: DuckAppearance, size = 180) {
    const layers = COSMETIC_LAYER_ORDER.flatMap((slot) => {
      const id = appearance[`${slot}Id` as keyof DuckAppearance]
      const item = id ? COSMETIC_BY_ID.get(id) : undefined
      if (!item) return []
      const svgPath = path.join(process.cwd(), 'public', item.asset)
      if (!fs.existsSync(svgPath)) return []
      const svgContent = fs.readFileSync(svgPath, 'utf8')
      return [{ slot, id, svgContent }]
    })

    return `<div style="position: relative; width: ${size}px; height: ${size}px; background: #16102a; border-radius: 16px; border: 2px solid #2e214d; overflow: hidden; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 16px rgba(0,0,0,0.4);">
      <svg viewBox="0 0 512 512" style="position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none;">
        <ellipse cx="252" cy="436" rx="170" ry="30" fill="#100A20" opacity=".28" />
      </svg>
      ${layers.map((l) => `<div style="position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; display: flex; align-items: center; justify-content: center;">${l.svgContent.replace(/width="[^"]*"/, 'width="100%"').replace(/height="[^"]*"/, 'height="100%"')}</div>`).join('\n')}
    </div>`
  }

  // 1. Color variants
  const colors = [
    { name: 'Sunshine', id: 'body-sunshine' },
    { name: 'Tangerine', id: 'body-tangerine' },
    { name: 'Mint Splash', id: 'body-mint' },
    { name: 'Sky Puddle', id: 'body-sky' },
    { name: 'Lavender Quack', id: 'body-lavender' },
    { name: 'Rose Pop', id: 'body-rose' },
    { name: 'Midnight', id: 'body-midnight' },
    { name: 'Cyber Cyan', id: 'body-cyber-cyan' },
    { name: 'Ruby', id: 'body-ruby' },
  ]

  // 2. Skin variants
  const skins = [
    { name: 'Tiger Quack', id: 'bodySkin-tiger-quack' },
    { name: 'Dragon Scale', id: 'bodySkin-dragon-scale' },
    { name: 'Neon Scales', id: 'bodySkin-neon-scales' },
    { name: 'Galaxy Dust', id: 'bodySkin-galaxy-dust' },
    { name: 'Gold Veins', id: 'bodySkin-gold-veins' },
    { name: 'Lotus Speckles', id: 'bodySkin-lotus-speckles' },
  ]

  // 3. Hats
  const hats = [
    { name: 'Red Cap', id: 'head-cap-red' },
    { name: 'Bucket Blue', id: 'head-bucket-blue' },
    { name: 'Tiny Crown', id: 'head-tiny-crown' },
    { name: 'Wizard Hat', id: 'head-wizard-hat' },
    { name: 'Cyber Mohawk', id: 'head-cyber-mohawk' },
    { name: 'Bamboo Hat', id: 'head-bamboo-hat' },
    { name: 'Cat Ears', id: 'head-cat-ears' },
    { name: 'Space Dome', id: 'head-space-dome' },
  ]

  // 4. Faces
  const faces = [
    { name: 'Happy Beak', id: 'face-happy' },
    { name: 'Pond Shades', id: 'face-shades' },
    { name: 'Laser Visor', id: 'face-laser-visor' },
    { name: 'Office Burnout', id: 'face-office-burnout' },
    { name: 'Pixel Eyes', id: 'face-pixel-eyes' },
    { name: 'Victory Wink', id: 'face-victory-wink' },
  ]

  // 5. Outfits
  const outfits = [
    { name: 'White Tee', id: 'outfit-tee-white' },
    { name: 'Monday Tie', id: 'outfit-office-tie' },
    { name: 'Dev Hoodie', id: 'outfit-dev-hoodie' },
    { name: 'Racing Suit', id: 'outfit-racing-suit' },
    { name: 'Lucky Ao Dai', id: 'outfit-lucky-ao-dai' },
    { name: 'Space Suit', id: 'outfit-space-suit' },
    { name: 'Knight Armor', id: 'outfit-quack-knight' },
  ]

  // 6. Pets
  const pets = [
    { name: 'Shiba Inu', id: 'pet-shiba-inu' },
    { name: 'Corgi Pup', id: 'pet-corgi-pup' },
    { name: 'Calico Cat', id: 'pet-calico-cat' },
    { name: 'Mini Capybara', id: 'pet-mini-capybara' },
    { name: 'Baby Dragon', id: 'pet-baby-dragon' },
  ]

  // 7. Auras
  const auras = [
    { name: 'Thần Long Bao Thân', id: 'aura-dragon-flame' },
    { name: 'Phật Quang Vạn Trượng', id: 'aura-golden-rays' },
    { name: 'Lôi Thần Sấm Sét', id: 'aura-storm-cloud' },
    { name: 'Hàn Băng Cực Quang', id: 'aura-moon-glow' },
    { name: 'Hỏa Diệm Sơn (Saiyan)', id: 'aura-chilli-heat' },
    { name: 'U Hồn Vạn Quỷ', id: 'aura-ghost-fog' },
    { name: 'Cyber Matrix HUD', id: 'aura-neon-glitch' },
    { name: 'Hoa Khai Phú Quý', id: 'aura-lotus-breeze' },
    { name: 'Cosmic Singularity', id: 'aura-space-dust' },
    { name: 'Neon Disco Party', id: 'aura-disco-lights' },
    { name: 'Thủy Cung Thần Châu', id: 'aura-bubble-halo' },
    { name: 'Kim Tiền Cát Tường', id: 'aura-lucky-leaves' },
  ]

  // 8. Fully mixed avatars
  const mixedAvatars = [
    {
      title: 'Urban Street Runner',
      appearance: {
        bodyColorId: 'body-tangerine',
        headId: 'head-cap-red',
        faceId: 'face-shades',
        outfitId: 'outfit-tee-white',
        bodySkinId: 'bodySkin-tiger-quack',
        trailId: 'trail-ripples',
        petId: 'pet-shiba-inu',
        auraId: 'aura-fireflies',
      },
    },
    {
      title: 'Overtime Office Hacker',
      appearance: {
        bodyColorId: 'body-sky',
        headId: 'head-office-headset',
        faceId: 'face-office-burnout',
        outfitId: 'outfit-office-tie',
        bodySkinId: 'bodySkin-coffee-stains',
        petId: 'pet-office-mouse',
        auraId: 'aura-coffee-steam',
      },
    },
    {
      title: 'Neo-Tokyo Cyber Ronin',
      appearance: {
        bodyColorId: 'body-cyber-cyan',
        headId: 'head-cyber-mohawk',
        faceId: 'face-laser-visor',
        outfitId: 'outfit-cyber-samurai',
        bodySkinId: 'bodySkin-neon-scales',
        petId: 'pet-tiny-drone',
        auraId: 'aura-pixel-orbit',
        trailId: 'trail-neon-wake',
      },
    },
    {
      title: 'Imperial Dragon Sovereign',
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
      title: 'Royal Emperor & Loyal Corgi',
      appearance: {
        bodyColorId: 'body-sunshine',
        headId: 'head-tiny-crown',
        faceId: 'face-happy',
        outfitId: 'outfit-royal-mantle',
        bodySkinId: 'bodySkin-gold-veins',
        petId: 'pet-corgi-pup',
        auraId: 'aura-golden-rays',
      },
    },
    {
      title: 'Viet Duc Heritage',
      appearance: {
        bodyColorId: 'body-mint',
        headId: 'head-bamboo-hat',
        outfitId: 'outfit-lucky-ao-dai',
        bodySkinId: 'bodySkin-lotus-speckles',
        petId: 'pet-calico-cat',
        auraId: 'aura-fireflies',
        trailId: 'trail-lotus-petals',
      },
    },
  ]

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Dzịt Season 3 - Contact Sheet</title>
  <style>
    body { background: #0c0818; color: #fff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 36px; margin: 0; }
    h1 { font-size: 32px; margin: 0 0 6px 0; color: #38ef7d; letter-spacing: 0.05em; font-weight: 900; }
    .subtitle { font-size: 14px; color: #a1a1aa; margin-bottom: 30px; }
    .section { margin-bottom: 36px; background: #130d24; border: 2px solid #251a44; border-radius: 20px; padding: 24px; }
    .section-title { font-size: 18px; font-weight: 800; color: #ffd84d; margin-bottom: 16px; text-transform: uppercase; letter-spacing: 0.05em; }
    .grid { display: grid; gap: 16px; }
    .grid-9 { grid-template-columns: repeat(9, 1fr); gap: 12px; }
    .grid-8 { grid-template-columns: repeat(8, 1fr); gap: 12px; }
    .grid-7 { grid-template-columns: repeat(7, 1fr); gap: 14px; }
    .grid-6 { grid-template-columns: repeat(6, 1fr); gap: 14px; }
    .grid-5 { grid-template-columns: repeat(5, 1fr); gap: 16px; }
    .grid-4 { grid-template-columns: repeat(4, 1fr); gap: 18px; }
    .grid-3 { grid-template-columns: repeat(3, 1fr); gap: 20px; }
    .item-card { display: flex; flex-direction: column; align-items: center; background: #19122e; border-radius: 14px; padding: 10px; border: 1px solid #32235e; }
    .item-name { font-size: 11px; font-weight: 700; margin-top: 8px; text-align: center; color: #f4f4f5; }
    .hero-card { display: flex; flex-direction: column; align-items: center; background: #1b1333; border: 2px solid #4a338c; border-radius: 20px; padding: 16px; }
    .hero-title { font-size: 14px; font-weight: 800; color: #38ef7d; margin-top: 12px; }
  </style>
</head>
<body>
  <h1>Dzịt Season 3 — Avatar System Contact Sheet</h1>
  <div class="subtitle">Canonical 512×512 Modular Rig — 3-Value Shading, Semantic Anchors, Contoured Clothes & Multi-tier Auras</div>

  <!-- 1. Color Palette Tokens -->
  <div class="section">
    <div class="section-title">1. Semantic Color Palette Variants (Base Duck Silhouette)</div>
    <div class="grid grid-9">
      ${colors.map((c) => `<div class="item-card">${renderDuck({ bodyColorId: c.id }, 120)}<div class="item-name">${c.name}</div></div>`).join('\n')}
    </div>
  </div>

  <!-- 2. Skin Variants -->
  <div class="section">
    <div class="section-title">2. Thematic Skins (Head, Cheek, Torso & Tail Coverage)</div>
    <div class="grid grid-6">
      ${skins.map((s) => `<div class="item-card">${renderDuck({ bodyColorId: 'body-sunshine', bodySkinId: s.id }, 140)}<div class="item-name">${s.name}</div></div>`).join('\n')}
    </div>
  </div>

  <!-- 3. Hats -->
  <div class="section">
    <div class="section-title">3. Headwear (Snug Skull Line Y:88..96, Forward Visors & Crowns)</div>
    <div class="grid grid-8">
      ${hats.map((h) => `<div class="item-card">${renderDuck({ bodyColorId: 'body-sunshine', headId: h.id, faceId: 'face-happy' }, 120)}<div class="item-name">${h.name}</div></div>`).join('\n')}
    </div>
  </div>

  <!-- 4. Faces -->
  <div class="section">
    <div class="section-title">4. Face Accessories (Dual-Eye Alignment & Clear Expressions)</div>
    <div class="grid grid-6">
      ${faces.map((f) => `<div class="item-card">${renderDuck({ bodyColorId: 'body-sunshine', faceId: f.id }, 140)}<div class="item-name">${f.name}</div></div>`).join('\n')}
    </div>
  </div>

  <!-- 5. Outfits -->
  <div class="section">
    <div class="section-title">5. Contoured Clothing (Torso Hugging + Wing Sleeves)</div>
    <div class="grid grid-7">
      ${outfits.map((o) => `<div class="item-card">${renderDuck({ bodyColorId: 'body-sunshine', outfitId: o.id, faceId: 'face-happy' }, 130)}<div class="item-name">${o.name}</div></div>`).join('\n')}
    </div>
  </div>

  <!-- 6. Pets -->
  <div class="section">
    <div class="section-title">6. Companion Pets (Subordinate Proportions & Ground Baseline)</div>
    <div class="grid grid-5">
      ${pets.map((p) => `<div class="item-card">${renderDuck({ bodyColorId: 'body-mint', petId: p.id, faceId: 'face-happy' }, 170)}<div class="item-name">${p.name}</div></div>`).join('\n')}
    </div>
  </div>

  <!-- 7. Auras -->
  <div class="section">
    <div class="section-title">7. 12 Game-Inspired Dynamic Aura Concepts (Dragon, Buddha Rays, Lightning, Frost, Inferno, Ghosts & More)</div>
    <div class="grid grid-6">
      ${auras.map((a) => `<div class="item-card">${renderDuck({ bodyColorId: 'body-midnight', auraId: a.id, headId: 'head-tiny-crown', faceId: 'face-happy' }, 180)}<div class="item-name">${a.name}</div></div>`).join('\n')}
    </div>
  </div>

  <!-- 8. Fully Mixed Avatars -->
  <div class="section">
    <div class="section-title">8. Fully Mixed Modular Avatars (Production Quality Verification)</div>
    <div class="grid grid-3">
      ${mixedAvatars.map((m) => `<div class="hero-card">${renderDuck(m.appearance as DuckAppearance, 240)}<div class="hero-title">${m.title}</div></div>`).join('\n')}
    </div>
  </div>
</body>
</html>`

  const outHtml = path.join(process.cwd(), 'public', 'cosmetics', 'contact-sheet.html')
  fs.writeFileSync(outHtml, html, 'utf8')

  const browser = await chromium.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  })
  const page = await browser.newPage({ viewport: { width: 1600, height: 3400 } })
  await page.goto(`file://${outHtml}`)
  const outPng = path.join(process.cwd(), 'public', 'cosmetics', 'contact-sheet.png')
  await page.screenshot({ path: outPng, fullPage: true })
  await browser.close()

  console.log(`✓ Saved contact sheet to ${outPng}`)
}

renderContactSheet().catch(console.error)
