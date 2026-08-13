import fs from 'node:fs'
import path from 'node:path'
import { COSMETIC_CATALOG } from '../lib/cosmetics/catalog'

const root = path.join(process.cwd(), 'public', 'cosmetics', 'v1')
const uiRoot = path.join(process.cwd(), 'public', 'cosmetics', 'ui')

function frame(content: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" fill="none">${content}</svg>\n`
}

const palette = ['#FF5B67', '#61C9FF', '#58E6B0', '#B99AFF', '#FFD84D', '#FF78A8', '#8EE3F5', '#F08A5D']

function hash(value: string) {
  return [...value].reduce((total, char) => ((total * 31) + char.charCodeAt(0)) >>> 0, 7)
}

function body(color = '#FFD84D') {
  return `<path d="M48 158c0-34 31-60 74-60 7-32 28-51 51-42 22 8 31 38 14 57 21 13 28 37 17 57-13 24-46 34-88 29-43-5-68-17-68-41Z" fill="${color}" stroke="#241A38" stroke-width="8" stroke-linejoin="round"/><path d="M77 144c16-15 43-16 58-2-8 22-32 34-55 23" fill="#fff" opacity=".2"/><path d="m188 105 35 12-35 15c-7-8-7-19 0-27Z" fill="#FF9B42" stroke="#241A38" stroke-width="7" stroke-linejoin="round"/><circle cx="172" cy="86" r="6" fill="#241A38"/><path d="M101 194c0 12-7 21-18 21m48-17c1 12-5 20-16 23" stroke="#FF9B42" stroke-width="8" stroke-linecap="round"/>`
}

function assetFor(id: string, slot: string, color?: string) {
  if (slot === 'bodyColor') return frame(body(color))
  if (id === 'head-cap-red') return frame(`<path d="M116 66c4-22 24-35 45-30 14 3 24 12 30 25-22-8-51-7-75 5Z" fill="#FF5B67" stroke="#241A38" stroke-width="7"/><path d="M158 61c19-3 38 1 53 12-19 6-39 5-57-2" fill="#D93E55" stroke="#241A38" stroke-width="7" stroke-linejoin="round"/>`)
  if (id === 'head-bucket-blue') return frame(`<path d="M117 64c3-25 19-38 42-35 23 2 35 18 37 42" fill="#61C9FF" stroke="#241A38" stroke-width="7"/><path d="M105 70c23-8 67-8 98 5-17 13-73 14-98-5Z" fill="#329CD6" stroke="#241A38" stroke-width="7"/>`)
  if (id === 'head-tiny-crown') return frame(`<path d="m132 58 6-30 18 19 14-25 10 29 22-14-8 34h-58Z" fill="#FFD84D" stroke="#241A38" stroke-width="7" stroke-linejoin="round"/><circle cx="166" cy="55" r="5" fill="#FF5BAE"/>`)
  if (id === 'outfit-tee-white') return frame(`<path d="M77 128 104 111c15 8 31 8 47 0l31 17-16 27-15-9-2 45c-22 8-48 7-70-2l4-43-14 7-12-25Z" fill="#FFFDF4" stroke="#241A38" stroke-width="7" stroke-linejoin="round"/>`)
  if (id === 'outfit-office-tie') return frame(`<path d="M81 124c24-16 61-16 88 2l-7 67c-24 9-56 8-83-3Z" fill="#EDF1FF" stroke="#241A38" stroke-width="7"/><path d="m124 119 15 1-4 21 10 35-18 15-11-16 12-34Z" fill="#FF5B67" stroke="#241A38" stroke-width="5"/>`)
  if (id === 'outfit-raincoat') return frame(`<path d="M85 118c22-12 58-11 79 2l19 68c-31 13-69 13-106-1Z" fill="#FFD84D" stroke="#241A38" stroke-width="7"/><path d="M126 119v72m-8-44h17" stroke="#C58B11" stroke-width="6"/><circle cx="137" cy="137" r="4" fill="#241A38"/><circle cx="139" cy="158" r="4" fill="#241A38"/>`)
  if (id === 'face-happy') return frame(`<path d="M157 100c7 8 17 8 25 0" stroke="#241A38" stroke-width="6" stroke-linecap="round"/>`)
  if (id === 'face-shades') return frame(`<path d="M145 84h21c2 14-3 22-13 22-9 0-13-8-8-22Zm24 0h23c4 13 0 22-11 22-10 0-14-8-12-22Z" fill="#241A38" stroke="#A7F3D0" stroke-width="4"/><path d="M164 88h8" stroke="#241A38" stroke-width="5"/><path d="m151 90 8-3" stroke="white" stroke-width="3" stroke-linecap="round"/>`)
  if (id === 'trail-ripples') return frame(`<path d="M25 198c24-14 58-11 73 4m-82 15c36-17 83-12 104 7" stroke="#61C9FF" stroke-width="8" stroke-linecap="round" opacity=".8"/>`)
  if (id === 'skin-dots') return frame(`<g fill="#FF5BAE" stroke="#241A38" stroke-width="2"><circle cx="93" cy="129" r="7"/><circle cx="119" cy="116" r="5"/><circle cx="143" cy="139" r="8"/><circle cx="104" cy="164" r="6"/><circle cx="161" cy="164" r="5"/></g>`)
  if (id === 'pet-origami-frog') return frame(`<path d="m191 173 16-12 17 12 14-5-8 17 6 18-21-4-20 5 3-20-13-14Z" fill="#58E6B0" stroke="#241A38" stroke-width="6" stroke-linejoin="round"/><circle cx="205" cy="177" r="3" fill="#241A38"/><circle cx="222" cy="177" r="3" fill="#241A38"/><path d="m204 190 10 4 10-5" stroke="#241A38" stroke-width="4"/>`)
  if (id === 'aura-fireflies') return frame(`<g fill="#FFF3A6"><circle cx="47" cy="98" r="5"/><circle cx="73" cy="59" r="4"/><circle cx="202" cy="72" r="5"/><circle cx="218" cy="151" r="4"/><circle cx="55" cy="181" r="4"/></g><g stroke="#FFD84D" stroke-width="3" opacity=".7"><path d="m47 86v-8m-9 20h-8m181-26 7-8m-5 88h9M67 61l-8-8"/></g>`)
  const value = hash(id)
  const primary = palette[value % palette.length]!
  const secondary = palette[(value + 3) % palette.length]!
  const tilt = (value % 17) - 8
  if (slot === 'bodySkin') return frame(`<g opacity=".9" transform="rotate(${tilt} 128 145)" fill="${primary}">${[0, 1, 2, 3, 4, 5].map((index) => `<rect x="${82 + (index % 3) * 28}" y="${119 + Math.floor(index / 3) * 34}" width="${8 + value % 8}" height="22" rx="6"/>`).join('')}</g>`)
  if (slot === 'face') return frame(`<path d="M143 84h22c1 15-4 22-13 22s-13-8-9-22Zm27 0h22c4 14 0 22-10 22s-14-8-12-22Z" fill="${primary}" stroke="#241A38" stroke-width="5"/><path d="M164 89h8" stroke="#241A38" stroke-width="5"/><path d="M155 112q12 ${8 + value % 8} 25 0" stroke="#241A38" stroke-width="4" stroke-linecap="round"/>`)
  if (slot === 'head') return frame(`<g transform="rotate(${tilt} 155 61)"><path d="M116 68q5-42 40-40 34 1 40 43Z" fill="${primary}" stroke="#241A38" stroke-width="7"/><path d="M106 70q50-14 101 5-23 17-101-5Z" fill="${secondary}" stroke="#241A38" stroke-width="7"/><circle cx="157" cy="51" r="${7 + value % 7}" fill="#FFF4C2" stroke="#241A38" stroke-width="4"/></g>`)
  if (slot === 'neck') return frame(`<path d="M105 116q25 15 52 0l9 18q-35 20-70 0Z" fill="${primary}" stroke="#241A38" stroke-width="6"/><path d="m132 133 18 37-22 17-9-49" fill="${secondary}" stroke="#241A38" stroke-width="5"/>`)
  if (slot === 'outfit') return frame(`<path d="M78 126q45-27 91 0l10 65q-51 17-101-2Z" fill="${primary}" stroke="#241A38" stroke-width="7"/><path d="M126 118v75" stroke="${secondary}" stroke-width="7"/><path d="m104 151 23 16 24-17" stroke="#FFF4C2" stroke-width="5" fill="none"/>`)
  if (slot === 'back') return frame(`<path d="M82 113q-46 8-45 52 25-17 51-8m9-38q-31 35-13 69 13-21 30-32" fill="${primary}" stroke="#241A38" stroke-width="7" stroke-linejoin="round"/>`)
  if (slot === 'pet') return frame(`<g transform="rotate(${tilt} 215 184)"><ellipse cx="214" cy="190" rx="25" ry="19" fill="${primary}" stroke="#241A38" stroke-width="6"/><circle cx="204" cy="184" r="4" fill="#241A38"/><circle cx="222" cy="184" r="4" fill="#241A38"/><path d="m199 171-7-13 17 8m18 5 8-13-19 8" fill="${secondary}" stroke="#241A38" stroke-width="5"/></g>`)
  if (slot === 'aura') return frame(`<g fill="${primary}" stroke="${secondary}" stroke-width="3" opacity=".8">${[0, 1, 2, 3, 4, 5, 6, 7].map((index) => { const angle = index * Math.PI / 4; return `<circle cx="${128 + Math.cos(angle) * (82 + value % 10)}" cy="${137 + Math.sin(angle) * 72}" r="${4 + (index + value) % 5}"/>` }).join('')}</g>`)
  if (slot === 'trail') return frame(`<path d="M18 194q31-${15 + value % 12} 68 3m-70 23q45-${14 + value % 8} 91 5m-63 15q31-10 61 0" stroke="${primary}" stroke-width="8" stroke-linecap="round" opacity=".85"/>`)
  if (slot === 'finish') return frame(`<g stroke="${primary}" stroke-width="8" stroke-linecap="round">${[0, 1, 2, 3, 4, 5, 6, 7].map((index) => { const angle = index * Math.PI / 4; return `<path d="M${128 + Math.cos(angle) * 72} ${132 + Math.sin(angle) * 72} 128 132"/>` }).join('')}</g><circle cx="128" cy="132" r="25" fill="${secondary}" opacity=".55"/>`)
  if (slot === 'nameplate') return frame(`<path d="M56 213q72 17 144 0l-9 31H66Z" fill="${primary}" stroke="#241A38" stroke-width="6"/><circle cx="77" cy="226" r="5" fill="${secondary}"/><circle cx="180" cy="226" r="5" fill="${secondary}"/>`)
  throw new Error(`No SVG generator for ${id} (${slot})`)
}

for (const item of COSMETIC_CATALOG) {
  const output = path.join(process.cwd(), 'public', item.asset)
  fs.mkdirSync(path.dirname(output), { recursive: true })
  const asset = assetFor(item.id, item.slot, item.color)
  fs.writeFileSync(output, asset, 'utf8')
  const preview = item.slot === 'bodyColor'
    ? asset
    : frame(`<rect width="256" height="256" rx="28" fill="#EAF8FF"/>${body()}${asset.slice(asset.indexOf('>') + 1).replace('</svg>', '')}`)
  const previewOutput = path.join(process.cwd(), 'public', item.previewAsset!)
  fs.mkdirSync(path.dirname(previewOutput), { recursive: true })
  fs.writeFileSync(previewOutput, preview, 'utf8')
}

const cards = COSMETIC_CATALOG.map((item) => `<article><img src="${item.previewAsset}"/><b>${item.name}</b><small>${item.slot} · ${item.rarity}</small></article>`).join('')
fs.writeFileSync(path.join(process.cwd(), 'public', 'cosmetics', 'contact-sheet.html'), `<!doctype html><meta charset="utf-8"><title>Đua Dzịt Cosmetic Contact Sheet</title><style>body{background:#100b20;color:white;font:14px system-ui;margin:24px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}article{background:#241548;border-radius:16px;padding:10px}img{width:100%;border-radius:10px}b,small{display:block;margin-top:5px}small{opacity:.55}</style><h1>Đua Dzịt Cosmetics · ${COSMETIC_CATALOG.length}</h1><div class="grid">${cards}</div>`, 'utf8')

const uiIcons: Record<string, string> = {
  qp: '<circle cx="128" cy="128" r="88" fill="#FFD84D" stroke="#241A38" stroke-width="14"/><path d="M86 96q42-38 84 0v60q-42 38-84 0Z" fill="#FFF3A6" stroke="#241A38" stroke-width="10"/><circle cx="144" cy="116" r="8" fill="#241A38"/><path d="m170 132 31 13-31 14" fill="#FF9B42" stroke="#241A38" stroke-width="8"/>',
  shop: '<path d="M48 87h160l-14 112H66Z" fill="#61C9FF" stroke="#241A38" stroke-width="14"/><path d="M79 96V74q0-38 49-38t49 38v22" stroke="#FFD84D" stroke-width="14"/><path d="M91 139h74" stroke="#241A38" stroke-width="12"/>',
  wardrobe: '<path d="M55 65h146v151H55Z" fill="#B99AFF" stroke="#241A38" stroke-width="14"/><path d="M128 67v148" stroke="#241A38" stroke-width="10"/><circle cx="111" cy="143" r="7" fill="#FFD84D"/><circle cx="146" cy="143" r="7" fill="#FFD84D"/>',
  collection: '<path d="M48 44h73v166H48q-14 0-14-14V58q0-14 14-14Zm87 0h73q14 0 14 14v138q0 14-14 14h-73Z" fill="#58E6B0" stroke="#241A38" stroke-width="12"/><path d="M128 48v160" stroke="#241A38" stroke-width="10"/>',
  gacha: '<path d="M63 92q0-55 65-55t65 55v89H63Z" fill="#FF78A8" stroke="#241A38" stroke-width="14"/><circle cx="128" cy="112" r="48" fill="#EAF8FF" stroke="#241A38" stroke-width="10"/><path d="M103 112q25-27 50 0-2 36-25 36t-25-36Z" fill="#FFD84D"/>',
  rare: '<path d="m128 26 25 63 68 5-52 44 17 66-58-36-58 36 17-66-52-44 68-5Z" fill="#61C9FF" stroke="#241A38" stroke-width="12"/>',
  legendary: '<path d="m45 76 43 31 40-67 40 67 43-31-18 130H63Z" fill="#FFD84D" stroke="#241A38" stroke-width="13"/><circle cx="128" cy="145" r="24" fill="#FF78A8"/>',
}
fs.mkdirSync(uiRoot, { recursive: true })
for (const [name, content] of Object.entries(uiIcons)) fs.writeFileSync(path.join(uiRoot, `${name}.svg`), frame(content), 'utf8')

console.log(`Generated ${COSMETIC_CATALOG.length} cosmetic SVGs, previews, and contact sheet in ${root}`)
