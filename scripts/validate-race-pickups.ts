import fs from 'node:fs'
import path from 'node:path'
import { WILD_ITEM_CATALOG } from '../packages/race-core/src'

const root = path.join(process.cwd(), 'public', 'race-pickups')
const expected = [
  'box-idle.svg', 'box-collect.svg', 'box-disabled.svg', 'golden-box.svg', 'chaos-box.svg',
  'item-mini-nitro.svg', 'item-tailwind.svg', 'item-mini-bubble.svg', 'item-mini-rocket.svg',
  'item-banana.svg', 'item-quack-horn.svg', 'item-feather.svg', 'item-magnet.svg',
  'hazard-anchor.svg', 'hazard-whirlpool.svg', 'hazard-ice.svg', 'hazard-goo.svg',
  'effect-horn.svg', 'effect-spark.svg',
]

if (WILD_ITEM_CATALOG.length !== 8) throw new Error(`Expected exactly 8 launch Wild Items, found ${WILD_ITEM_CATALOG.length}`)
for (const file of expected) {
  const absolute = path.join(root, file)
  if (!fs.existsSync(absolute)) throw new Error(`Missing gameplay asset: ${file}`)
  const source = fs.readFileSync(absolute, 'utf8')
  if (!source.startsWith('<svg') || !source.includes('viewBox="0 0 64 64"')) throw new Error(`Invalid square-safe SVG: ${file}`)
  if (Buffer.byteLength(source) > 12_000) throw new Error(`Gameplay asset too large: ${file}`)
}
console.log(`✓ ${expected.length} original pickup assets validated · ${WILD_ITEM_CATALOG.length} Wild Items`)
