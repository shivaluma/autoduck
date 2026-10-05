import fs from 'node:fs'
import path from 'node:path'
import { COSMETIC_CATALOG } from '../lib/cosmetics/catalog'
import { AVATAR_VIEWBOX, generateBaseDuckSvg, getDuckPalette } from '../lib/cosmetics/avatar-rig'
import { BEHIND_BODY_SLOTS, SLOT_FRAMES, type CosmeticSlot } from '../lib/cosmetics/types'
import { AURA_ART } from './cosmetics/art/aura'
import { BODY_COLOR_ART } from './cosmetics/art/bodyColor'
import { BODY_SKIN_ART } from './cosmetics/art/bodySkin'
import { FACE_ART } from './cosmetics/art/face'
import { HEAD_ART } from './cosmetics/art/head'
import { OUTFIT_ART } from './cosmetics/art/outfit'
import { PET_ART } from './cosmetics/art/pet'
import { TRAIL_ART } from './cosmetics/art/trail'

export const ART_BY_SLOT: Partial<Record<CosmeticSlot, Record<string, () => string>>> = {
  bodyColor: BODY_COLOR_ART,
  bodySkin: BODY_SKIN_ART,
  face: FACE_ART,
  head: HEAD_ART,
  outfit: OUTFIT_ART,
  pet: PET_ART,
  aura: AURA_ART,
  trail: TRAIL_ART,
}

export function svgFrame(content: string, viewBox = AVATAR_VIEWBOX) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="100%" height="100%" fill="none">\n${content}\n</svg>\n`
}

export function drawCosmetic(id: string, slot: CosmeticSlot) {
  const draw = ART_BY_SLOT[slot]?.[id]
  if (!draw) throw new Error(`No art for ${id} (${slot}) — add it to scripts/cosmetics/art/${slot}.ts`)
  return draw()
}

function main() {
  const outputRoot = path.join(process.cwd(), 'public', 'cosmetics', 'v2')
  fs.rmSync(outputRoot, { recursive: true, force: true })
  const baseDuck = generateBaseDuckSvg(getDuckPalette('body-sunshine'))
  const shadow = '<ellipse cx="252" cy="436" rx="170" ry="30" fill="#100A20" opacity="0.28"/>'

  for (const item of COSMETIC_CATALOG) {
    const content = drawCosmetic(item.id, item.slot)
    const assetPath = path.join(process.cwd(), 'public', item.asset)
    fs.mkdirSync(path.dirname(assetPath), { recursive: true })
    fs.writeFileSync(assetPath, svgFrame(content), 'utf8')

    const [x, y, size] = SLOT_FRAMES[item.slot]
    const body = item.slot === 'bodyColor' ? '' : baseDuck
    const stacked = BEHIND_BODY_SLOTS.includes(item.slot) ? `${content}${shadow}${body}` : `${shadow}${body}${content}`
    const previewPath = path.join(process.cwd(), 'public', item.previewAsset!)
    fs.mkdirSync(path.dirname(previewPath), { recursive: true })
    fs.writeFileSync(previewPath, svgFrame(stacked, `${x} ${y} ${size} ${size}`), 'utf8')
  }

  console.log(`✓ Generated ${COSMETIC_CATALOG.length} v2 cosmetics and previews in ${outputRoot}`)
}

if (require.main === module) main()
