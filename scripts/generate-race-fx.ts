import fs from 'node:fs'
import path from 'node:path'
import { RACE_FX_COLUMNS, RACE_FX_DECOR, RACE_FX_ICONS, RACE_FX_SHEETS, UI_ICONS, raceFxDecorPath, raceFxIconPath, raceFxSheetPath, uiIconPath } from '../lib/race-fx/manifest'
import { renderSpriteJobs } from './cosmetics/sprites'
import { RACE_DECOR_ART, RACE_FX_ART, RACE_ICON_ART } from './race-fx/art'
import { UI_ICON_ART } from './race-fx/ui-icons'

// Generates the race FX asset set: animated sprite sheets (baked from SVG/SMIL), item icons and bank
// decor. Run with `pnpm race:fx`; output lives in public/race-fx.

const svg = (content: string, viewBox: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="100%" height="100%" fill="none">\n${content}\n</svg>\n`
const publicPath = (asset: string) => path.join(process.cwd(), 'public', asset)

function assertUniqueIds(name: string, content: string) {
  const ids = [...content.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]!)
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index)
  if (duplicate) throw new Error(`${name}: duplicate element id "${duplicate}"`)
  if (/\b(attribute-name|repeat-count|calc-mode|key-splines|key-times)=/.test(content)) throw new Error(`${name}: kebab-case SMIL attribute`)
}

async function main() {
  fs.rmSync(publicPath('/race-fx'), { recursive: true, force: true })

  for (const key of RACE_FX_ICONS) {
    const content = RACE_ICON_ART[key]?.()
    if (!content) throw new Error(`Missing icon art: ${key}`)
    assertUniqueIds(`icon ${key}`, content)
    fs.mkdirSync(path.dirname(publicPath(raceFxIconPath(key))), { recursive: true })
    fs.writeFileSync(publicPath(raceFxIconPath(key)), svg(content, '-8 -8 144 144'))
  }
  for (const key of RACE_FX_DECOR) {
    const content = RACE_DECOR_ART[key]?.()
    if (!content) throw new Error(`Missing decor art: ${key}`)
    assertUniqueIds(`decor ${key}`, content)
    fs.mkdirSync(path.dirname(publicPath(raceFxDecorPath(key))), { recursive: true })
    fs.writeFileSync(publicPath(raceFxDecorPath(key)), svg(content, '0 0 128 128'))
  }

  for (const key of UI_ICONS) {
    const content = UI_ICON_ART[key]?.()
    if (!content) throw new Error(`Missing UI icon art: ${key}`)
    assertUniqueIds(`ui ${key}`, content)
    fs.mkdirSync(path.dirname(publicPath(uiIconPath(key))), { recursive: true })
    fs.writeFileSync(publicPath(uiIconPath(key)), svg(content, '-6 -6 140 140'))
  }

  const jobs = RACE_FX_SHEETS.map((sheet) => {
    const content = RACE_FX_ART[sheet.key]?.()
    if (!content) throw new Error(`Missing FX art: ${sheet.key}`)
    assertUniqueIds(`fx ${sheet.key}`, content)
    return {
      content,
      output: publicPath(raceFxSheetPath(sheet.key)),
      viewBox: '0 0 256 256',
      frames: sheet.frames,
      columns: Math.min(RACE_FX_COLUMNS, sheet.frames),
      frameSize: sheet.size,
      fps: sheet.fps,
    }
  })
  await renderSpriteJobs(jobs)
  console.log(`✓ Race FX: ${RACE_FX_SHEETS.length} sprite sheets, ${RACE_FX_ICONS.length} icons, ${RACE_FX_DECOR.length} decor, ${UI_ICONS.length} UI icons in public/race-fx`)
}

void main()
