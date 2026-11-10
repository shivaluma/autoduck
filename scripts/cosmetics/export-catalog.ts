/**
 * Exports the cosmetic catalog for the Rust server (rewrite plan D19, step 0.8).
 *
 *   pnpm cosmetics:export-catalog          # writes the files
 *   pnpm cosmetics:export-catalog --check  # exits 1 if the committed files are stale
 *
 * Writes crates/server/data/cosmetic-catalog.json and cosmetic-legacy.json. The TS modules
 * stay the source of truth; the server embeds these files with include_str!. Item objects are
 * written with JSON.stringify so their key order (and the omission of undefined keys) is exactly
 * what the TS routes put on the wire.
 */
import fs from 'node:fs'
import path from 'node:path'
import { COSMETIC_CATALOG, DEFAULT_APPEARANCE, STARTER_COSMETIC_IDS } from '../../lib/cosmetics/catalog'
import { LEGACY_REMAP } from '../../lib/cosmetics/legacy'
import { LEGACY_V1_COSMETICS } from '../../lib/cosmetics/legacy-v1'
import { COSMETIC_RARITIES, COSMETIC_SLOTS } from '../../lib/cosmetics/types'

const outDir = path.join(__dirname, '..', '..', 'crates', 'server', 'data')

const catalog = {
  format: 'autoduck-cosmetic-catalog/1',
  slots: COSMETIC_SLOTS,
  rarities: COSMETIC_RARITIES,
  starterIds: STARTER_COSMETIC_IDS,
  defaultAppearance: DEFAULT_APPEARANCE,
  items: COSMETIC_CATALOG,
}

const legacy = {
  format: 'autoduck-cosmetic-legacy/1',
  remap: LEGACY_REMAP,
  v1: LEGACY_V1_COSMETICS,
}

const outputs: Array<[string, unknown]> = [
  ['cosmetic-catalog.json', catalog],
  ['cosmetic-legacy.json', legacy],
]

const check = process.argv.includes('--check')
let stale = 0
for (const [name, value] of outputs) {
  const file = path.join(outDir, name)
  const text = `${JSON.stringify(value, null, 2)}\n`
  if (check) {
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null
    if (current !== text) {
      console.error(`stale: ${path.relative(process.cwd(), file)} (run pnpm cosmetics:export-catalog)`)
      stale += 1
    }
    continue
  }
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(file, text)
  console.log(`wrote ${path.relative(process.cwd(), file)}`)
}
if (stale > 0) process.exit(1)
