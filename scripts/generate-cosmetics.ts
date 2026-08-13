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
  return `<path d="M47 161c-9-8-15-18-17-29 14 4 26 10 35 17" fill="${color}" stroke="#241A38" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/><path d="M40 164c0-36 35-57 82-55 46 1 78 22 83 51 7 34-26 51-83 49-54-1-82-17-82-45Z" fill="${color}" stroke="#241A38" stroke-width="8" stroke-linejoin="round"/><path d="M106 108c-5-31 7-63 33-79 27-17 59-8 75 15 18 25 10 59-10 78-22 22-59 27-83 9-8-6-13-14-15-23Z" fill="${color}" stroke="#241A38" stroke-width="8" stroke-linejoin="round"/><path d="M68 158c16-20 45-25 69-12-7 25-38 39-66 29" fill="#FFFDF4" opacity=".24"/><ellipse cx="191" cy="72" rx="16" ry="21" fill="#FFFDF4" stroke="#241A38" stroke-width="6"/><ellipse cx="160" cy="69" rx="21" ry="25" fill="#FFFDF4" stroke="#241A38" stroke-width="6"/><ellipse cx="165" cy="76" rx="5.5" ry="9" fill="#241A38"/><ellipse cx="195" cy="78" rx="4.5" ry="8" fill="#241A38"/><circle cx="163" cy="72" r="2.5" fill="#FFFDF4"/><circle cx="194" cy="75" r="2" fill="#FFFDF4"/><path d="M177 93c17-1 34 4 55 11 9 3 9 11 0 16-20 10-42 12-59 5-10-4-12-14-5-23 3-4 6-7 9-9Z" fill="#FF9B42" stroke="#241A38" stroke-width="7" stroke-linejoin="round"/><path d="M171 115c19 5 39 3 60-5" stroke="#C95E24" stroke-width="4" stroke-linecap="round"/><path d="M89 201c1 9-4 15-15 20 12 3 24 0 32-9m30-8c1 9-4 15-15 20 12 2 23 0 31-8" fill="none" stroke="#FF9B42" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`
}

function assetFor(id: string, slot: string, color?: string) {
  if (slot === 'bodyColor') return frame(body(color))
  if (id === 'head-cap-red') return frame(`<path d="M108 43c7-23 28-35 52-30 16 3 29 13 36 28-25-8-59-7-88 2Z" fill="#FF5B67" stroke="#241A38" stroke-width="7"/><path d="M148 41c24-4 47 0 67 12-22 8-47 7-69-2" fill="#D93E55" stroke="#241A38" stroke-width="7" stroke-linejoin="round"/>`)
  if (id === 'head-bucket-blue') return frame(`<path d="M108 42c5-25 24-38 50-35 26 2 41 18 44 42" fill="#61C9FF" stroke="#241A38" stroke-width="7"/><path d="M96 49c28-9 78-9 114 5-20 14-85 15-114-5Z" fill="#329CD6" stroke="#241A38" stroke-width="7"/>`)
  if (id === 'head-tiny-crown') return frame(`<path d="m128 35 8-25 19 16 16-22 11 25 24-12-10 32h-64Z" fill="#FFD84D" stroke="#241A38" stroke-width="7" stroke-linejoin="round"/><circle cx="168" cy="35" r="5" fill="#FF5BAE"/>`)
  if (id === 'outfit-tee-white') return frame(`<path d="M42 163c0-27 22-46 57-52l12 15q19 17 43-1l17 3c19 8 30 19 34 33 7 33-26 50-83 48-53-1-80-18-80-46Z" fill="#FFFDF4" stroke="#241A38" stroke-width="8" stroke-linejoin="round"/><path d="M109 124q21 20 47 0" stroke="#D8D5CC" stroke-width="6" stroke-linecap="round" fill="none"/><path d="M64 142q20 7 28 24m84-29q-12 8-17 24M70 190q52 22 111 0" stroke="#D8D5CC" stroke-width="5" stroke-linecap="round" fill="none"/>`)
  if (id === 'outfit-office-tie') return frame(`<path d="M42 163c0-27 22-46 57-52l12 15q19 17 43-1l17 3c19 8 30 19 34 33 7 33-26 50-83 48-53-1-80-18-80-46Z" fill="#EDF1FF" stroke="#241A38" stroke-width="8" stroke-linejoin="round"/><path d="m113 124 20 3 6 13-9 9-11-9Z" fill="#FF5B67" stroke="#241A38" stroke-width="5"/><path d="m130 148 14 31-15 14-11-14 7-31Z" fill="#FF5B67" stroke="#241A38" stroke-width="5"/><path d="M67 158q20-17 42-8" stroke="#CDD6F5" stroke-width="5" stroke-linecap="round"/>`)
  if (id === 'outfit-raincoat') return frame(`<path d="M42 163c0-27 22-46 57-52l12 15q19 17 43-1l17 3c19 8 30 19 34 33 7 33-26 50-83 48-53-1-80-18-80-46Z" fill="#FFD84D" stroke="#241A38" stroke-width="8" stroke-linejoin="round"/><path d="M131 128v77" stroke="#C58B11" stroke-width="6"/><path d="M109 124q21 20 47 0" stroke="#FFF0A2" stroke-width="6" stroke-linecap="round"/><circle cx="143" cy="147" r="4" fill="#241A38"/><circle cx="143" cy="169" r="4" fill="#241A38"/>`)
  if (id === 'face-happy') return frame(`<path d="M157 91q11 7 22 0" stroke="#241A38" stroke-width="4" stroke-linecap="round" fill="none"/><circle cx="157" cy="99" r="4" fill="#FF78A8" opacity=".7"/>`)
  if (id === 'face-shades') return frame(`<path d="M146 61h39c2 19-5 29-18 29-14 0-21-10-21-29Zm39 2h23c1 17-4 25-13 25-10 0-13-9-10-25Z" fill="#241A38" stroke="#A7F3D0" stroke-width="4"/><path d="M183 68h6" stroke="#241A38" stroke-width="5"/><path d="m154 68 12-4" stroke="white" stroke-width="3" stroke-linecap="round"/>`)
  if (id === 'trail-ripples') return frame(`<path d="M25 198c24-14 58-11 73 4m-82 15c36-17 83-12 104 7" stroke="#61C9FF" stroke-width="8" stroke-linecap="round" opacity=".8"/>`)
  if (id === 'skin-dots') return frame(`<g fill="#FF5BAE" stroke="#241A38" stroke-width="2"><circle cx="93" cy="129" r="7"/><circle cx="119" cy="116" r="5"/><circle cx="143" cy="139" r="8"/><circle cx="104" cy="164" r="6"/><circle cx="161" cy="164" r="5"/></g>`)
  if (id === 'pet-origami-frog') return frame(`<path d="m191 173 16-12 17 12 14-5-8 17 6 18-21-4-20 5 3-20-13-14Z" fill="#58E6B0" stroke="#241A38" stroke-width="6" stroke-linejoin="round"/><circle cx="205" cy="177" r="3" fill="#241A38"/><circle cx="222" cy="177" r="3" fill="#241A38"/><path d="m204 190 10 4 10-5" stroke="#241A38" stroke-width="4"/>`)
  if (id === 'aura-fireflies') return frame(`<g fill="#FFF3A6"><circle cx="47" cy="98" r="5"/><circle cx="73" cy="59" r="4"/><circle cx="202" cy="72" r="5"/><circle cx="218" cy="151" r="4"/><circle cx="55" cy="181" r="4"/></g><g stroke="#FFD84D" stroke-width="3" opacity=".7"><path d="m47 86v-8m-9 20h-8m181-26 7-8m-5 88h9M67 61l-8-8"/></g>`)
  const value = hash(id)
  const primary = palette[value % palette.length]!
  const secondary = palette[(value + 3) % palette.length]!
  const tilt = (value % 17) - 8
  if (slot === 'bodySkin') return frame(`<g opacity=".9" transform="rotate(${tilt} 124 158)" fill="${primary}">${[0, 1, 2, 3, 4, 5].map((index) => `<rect x="${75 + (index % 3) * 31}" y="${135 + Math.floor(index / 3) * 34}" width="${8 + value % 8}" height="22" rx="6"/>`).join('')}</g>`)
  if (slot === 'face') return frame(`<path d="M145 61h39c2 19-5 29-18 29-14 0-21-10-21-29Zm40 2h22c2 17-3 25-13 25-9 0-12-9-9-25Z" fill="${primary}" stroke="#241A38" stroke-width="5"/><path d="M182 68h7" stroke="#241A38" stroke-width="5"/><path d="M157 94q12 ${7 + value % 7} 24 0" stroke="#241A38" stroke-width="4" stroke-linecap="round" fill="none"/>`)
  if (slot === 'head') return frame(`<g><path d="M107 44q8-39 50-39 42 1 48 43Z" fill="${primary}" stroke="#241A38" stroke-width="7"/><path d="M96 48q59-14 117 5-26 17-117-5Z" fill="${secondary}" stroke="#241A38" stroke-width="7"/><circle cx="159" cy="29" r="${7 + value % 7}" fill="#FFF4C2" stroke="#241A38" stroke-width="4"/></g>`)
  if (slot === 'neck') return frame(`<path d="M105 116q25 15 52 0l9 18q-35 20-70 0Z" fill="${primary}" stroke="#241A38" stroke-width="6"/><path d="m132 133 18 37-22 17-9-49" fill="${secondary}" stroke="#241A38" stroke-width="5"/>`)
  if (slot === 'outfit') return frame(`<path d="M42 163c0-27 22-46 57-52l12 15q19 17 43-1l17 3c19 8 30 19 34 33 7 33-26 50-83 48-53-1-80-18-80-46Z" fill="${primary}" stroke="#241A38" stroke-width="8" stroke-linejoin="round"/><path d="M131 128v77" stroke="${secondary}" stroke-width="7"/><path d="m86 151 44 18 42-20" stroke="#FFF4C2" stroke-width="5" stroke-linecap="round" fill="none"/>`)
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
