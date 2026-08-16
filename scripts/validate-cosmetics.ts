import fs from 'node:fs'
import path from 'node:path'
import { COSMETIC_CATALOG } from '../lib/cosmetics/catalog'
import { COSMETIC_RARITIES, COSMETIC_SLOTS } from '../lib/cosmetics/types'

const ids = new Set<string>()
const errors: string[] = []

for (const item of COSMETIC_CATALOG) {
  if (ids.has(item.id)) errors.push(`Duplicate id: ${item.id}`)
  ids.add(item.id)
  if (!COSMETIC_SLOTS.includes(item.slot)) errors.push(`Invalid slot: ${item.id}`)
  if (!COSMETIC_RARITIES.includes(item.rarity)) errors.push(`Invalid rarity: ${item.id}`)
  if (!item.collection?.trim()) errors.push(`Missing collection: ${item.id}`)
  const file = path.join(process.cwd(), 'public', item.asset)
  if (!fs.existsSync(file)) {
    errors.push(`Missing asset: ${item.asset}`)
    continue
  }
  const svg = fs.readFileSync(file, 'utf8')
  if (!svg.includes('<svg') || !svg.includes('viewBox="0 0 512 512"') || !svg.includes('</svg>')) errors.push(`Invalid 512x512 SVG: ${item.asset}`)
  if (!item.previewAsset || !fs.existsSync(path.join(process.cwd(), 'public', item.previewAsset))) errors.push(`Missing preview: ${item.id}`)
}

if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}

console.log(`✓ ${COSMETIC_CATALOG.length} cosmetics validated`)
