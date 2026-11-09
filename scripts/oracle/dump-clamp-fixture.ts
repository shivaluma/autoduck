/**
 * Dumps the `clamp` fixture for `race_core::math::js_clamp` (review 2 finding 1).
 *
 *   node --import tsx scripts/oracle/dump-clamp-fixture.ts [outFile]
 *
 * Every TS engine module defines `clamp(value, minimum, maximum)` as
 * `Math.max(minimum, Math.min(maximum, value))` (simulation.ts, track.ts,
 * evaluate.ts, pickups/engine.ts, aim.ts). This writes that expression's
 * output for every (x, lo, hi) triple over VALUES, including inverted bounds
 * and (0, -0) bounds, as f64 bit-hex with NaN canonicalised to
 * 7ff8000000000000 (payloads are not part of the contract). The triple order
 * is `for x, for lo, for hi`. `Math.max`/`Math.min` are host-independent in
 * V8, so one fixture serves every host.
 */
import { writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const outFile = resolve(process.argv[2] ?? join(repoRoot, 'crates/race-core/tests/fixtures/clamp-node24.json'))

const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value))

const VALUES = [
  2, -2, 1, -1, 0, -0, 0.5, -0.5, Infinity, -Infinity, NaN, 1e-300, 5e-324, -5e-324, 1.7976931348623157e308,
  0.1 + 0.2, 0.3, 2 ** 53, 0.95, -0.95, 0.85,
]

const view = new DataView(new ArrayBuffer(8))
const hex = (x: number) => {
  if (Number.isNaN(x)) return '7ff8000000000000'
  view.setFloat64(0, x)
  return view.getBigUint64(0).toString(16).padStart(16, '0')
}

const outputs: string[] = []
for (const x of VALUES) for (const lo of VALUES) for (const hi of VALUES) outputs.push(hex(clamp(x, lo, hi)))

const fixture = {
  version: 1,
  expression: 'Math.max(minimum, Math.min(maximum, value))',
  node: process.versions.node,
  v8: process.versions.v8,
  values: VALUES.map(hex),
  outputs,
}
writeFileSync(outFile, `${JSON.stringify(fixture)}\n`)
console.log(`clamp fixture: ${outputs.length} triples -> ${outFile}`)
