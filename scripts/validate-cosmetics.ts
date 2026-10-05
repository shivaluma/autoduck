import fs from 'node:fs'
import path from 'node:path'
import { AVATAR_VIEWBOX } from '../lib/cosmetics/avatar-rig'
import { COSMETIC_CATALOG, DEFAULT_APPEARANCE, STARTER_COSMETIC_IDS } from '../lib/cosmetics/catalog'
import { COSMETIC_RARITIES, COSMETIC_SLOTS, type CosmeticSlot } from '../lib/cosmetics/types'
import { ART_BY_SLOT } from './generate-cosmetics'

const CLOSET_SLOTS: CosmeticSlot[] = ['bodyColor', 'bodySkin', 'face', 'head', 'outfit', 'pet', 'aura', 'trail']
const SHOP_MINIMUMS = { common: 6, uncommon: 6, rare: 6, epic: 3, legendary: 2 } as const

const ids = new Set<string>()
const errors: string[] = []
const skeletons = new Map<string, string>()

/** Strip colors and gradient/id references: two items with the same skeleton are a recolor, i.e. filler. */
function skeleton(svg: string) {
  return svg
    .replace(/#[0-9a-fA-F]{3,8}\b/g, '#')
    .replace(/url\(#[^)]+\)/g, 'url()')
    .replace(/\bid="[^"]*"/g, '')
    .replace(/(stop-)?opacity="[^"]*"/g, '')
}

for (const item of COSMETIC_CATALOG) {
  if (ids.has(item.id)) errors.push(`Duplicate id: ${item.id}`)
  ids.add(item.id)
  if (!COSMETIC_SLOTS.includes(item.slot)) errors.push(`Invalid slot: ${item.id}`)
  if (!CLOSET_SLOTS.includes(item.slot)) errors.push(`${item.id}: slot ${item.slot} has no closet tab, so players could never wear it`)
  if (!COSMETIC_RARITIES.includes(item.rarity)) errors.push(`Invalid rarity: ${item.id}`)
  if (!item.collection?.trim()) errors.push(`Missing collection: ${item.id}`)
  if (!ART_BY_SLOT[item.slot]?.[item.id]) errors.push(`No art function for ${item.id}`)

  const file = path.join(process.cwd(), 'public', item.asset)
  if (!fs.existsSync(file)) {
    errors.push(`Missing asset: ${item.asset} (run pnpm cosmetics:generate)`)
    continue
  }
  const svg = fs.readFileSync(file, 'utf8')
  if (!svg.includes('<svg') || !svg.includes(`viewBox="${AVATAR_VIEWBOX}"`) || !svg.includes('</svg>')) errors.push(`Invalid v2 frame: ${item.asset}`)
  const svgIds = [...svg.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]!)
  const duplicateSvgId = svgIds.find((id, index) => svgIds.indexOf(id) !== index)
  if (duplicateSvgId) errors.push(`${item.id}: duplicate element id "${duplicateSvgId}" breaks url(#…) references`)
  const shape = `${item.slot}:${skeleton(svg)}`
  const twin = skeletons.get(shape)
  if (twin && item.slot !== 'bodyColor') errors.push(`${item.id} is a recolor of ${twin} — every item must be drawn on purpose`)
  skeletons.set(shape, item.id)
  if (!item.previewAsset || !fs.existsSync(path.join(process.cwd(), 'public', item.previewAsset))) errors.push(`Missing preview: ${item.id}`)
}

for (const [slot, art] of Object.entries(ART_BY_SLOT)) {
  for (const id of Object.keys(art ?? {})) if (!ids.has(id)) errors.push(`Art for ${id} (${slot}) has no catalog entry`)
}

for (const slot of CLOSET_SLOTS) {
  for (const rarity of COSMETIC_RARITIES) {
    if (!COSMETIC_CATALOG.some((item) => item.slot === slot && item.rarity === rarity)) errors.push(`Tab ${slot} has no ${rarity} item`)
  }
}

for (const [rarity, minimum] of Object.entries(SHOP_MINIMUMS)) {
  const count = COSMETIC_CATALOG.filter((item) => item.shopEligible && item.rarity === rarity).length
  if (count < minimum) errors.push(`Shop pool needs ${minimum} ${rarity} items, found ${count}`)
}

for (const id of [...STARTER_COSMETIC_IDS, ...Object.values(DEFAULT_APPEARANCE)]) {
  if (!ids.has(id)) errors.push(`Starter/default cosmetic missing from catalog: ${id}`)
}

if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}

console.log(`✓ ${COSMETIC_CATALOG.length} cosmetics validated across ${CLOSET_SLOTS.length} tabs`)
