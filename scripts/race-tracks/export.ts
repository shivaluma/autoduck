/**
 * Writes public/race-tracks/<trackVersion>@<sha8>.json from HEAD `createRiverTrack` (plan D10, step 0.5).
 * The file is content-addressed: rerunning without a geometry change writes the same name and bytes.
 *
 *   pnpm race:tracks            # export the current track version
 *   pnpm race:tracks --check    # exit 1 if the committed file for HEAD is missing or differs
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { DEFAULT_TRACK_VERSION } from '../../packages/race-protocol/src'
import { exportTrackGeometry, serializeTrackGeometry, trackGeometryPath } from '../../lib/racing/track-geometry'

const check = process.argv.includes('--check')
const versions = [DEFAULT_TRACK_VERSION]
let failed = false
for (const trackVersion of versions) {
  const { json, id, sha256 } = serializeTrackGeometry(exportTrackGeometry(trackVersion))
  const file = trackGeometryPath(id)
  if (check) {
    const ok = existsSync(file) && readFileSync(file, 'utf8') === json
    console.log(`${ok ? 'ok     ' : 'MISSING'} ${path.relative(process.cwd(), file)}`)
    if (!ok) failed = true
    continue
  }
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, json)
  console.log(`wrote ${path.relative(process.cwd(), file)} (${json.length} B, sha256 ${sha256})`)
}
if (failed) {
  console.error('HEAD track geometry changed: run `pnpm race:tracks` and commit the new file (keep the old one; stored tracks reference it).')
  process.exit(1)
}
