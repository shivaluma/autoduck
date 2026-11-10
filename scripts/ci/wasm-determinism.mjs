// D26 determinism probe through the shipped wasm-bindgen package (Phase 2
// review 2 MAJOR 2): runs every case of the pinned fixture with
// `runCaseDigest` and requires the `default` digests that native and
// wasm32-wasip1 produce (`crates/race-core/tests/determinism_pinned.rs`).
//
//   scripts/build-wasm.sh
//   node scripts/ci/wasm-determinism.mjs [--pkg crates/race-wasm/pkg]
//        [--fixture crates/race-core/tests/fixtures/determinism-pinned.json]
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const index = args.indexOf(name)
  return index >= 0 ? resolve(args[index + 1]) : fallback
}
const pkg = arg('--pkg', resolve(repo, 'crates/race-wasm/pkg'))
const fixturePath = arg('--fixture', resolve(repo, 'crates/race-core/tests/fixtures/determinism-pinned.json'))

const engine = await import(pathToFileURL(resolve(pkg, 'race_wasm.js')).href)
await engine.default({ module_or_path: readFileSync(resolve(pkg, 'race_wasm_bg.wasm')) })
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'))

let failures = 0
const started = performance.now()
for (const testCase of fixture.cases) {
  const digest = JSON.parse(engine.runCaseDigest(testCase.line))
  if (!isDeepStrictEqual(digest, testCase.default)) {
    failures += 1
    console.error(`case ${testCase.id}: expected ${JSON.stringify(testCase.default)}\n  got ${JSON.stringify(digest)}`)
  }
}
const seconds = ((performance.now() - started) / 1000).toFixed(1)
const total = fixture.cases.length
console.log(`wasm-determinism: ${total - failures}/${total} cases match the pinned default digests (engineBuildId ${engine.engineBuildId()}, ${seconds}s)`)
process.exit(failures === 0 && total > 0 ? 0 : 1)
