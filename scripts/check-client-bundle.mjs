#!/usr/bin/env node
// Checks the Vite build in dist/ (plan Phase 4 gate, D18/D19). Run after `pnpm build`:
//
//   1. No emitted JS or HTML mentions server-only things: `node:` builtins (the verify code's node:crypto),
//      Vite's `__vite-browser-external` shim (a Node builtin imported from browser code), `process.env`
//      (Vite replaces only NODE_ENV; anything else is undefined in the browser), Prisma or better-sqlite3.
//   2. No chunk bundles a server module: Prisma, better-sqlite3, lib/db.ts or any lib/racing/ server adapter.
//   3. The home, rules and race routes load no engine up front: walking the static imports of their route
//      chunks (plus the entry and the Season 3 layout they render in) finds no module from Phaser,
//      packages/race-*, the WASM engine client (src/engine/index.ts, its worker), Zod or any .wasm file. Lazy imports are not followed: they load
//      only when a page asks for them (the race canvas loads Phaser, and the engine only for a race without
//      a recorded track).
//
// Reads dist/.vite/manifest.json and dist/.vite/chunk-modules.json (written by vite.config.mts).
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

const dist = new URL('../dist/', import.meta.url).pathname
const manifest = JSON.parse(readFileSync(join(dist, '.vite/manifest.json'), 'utf8'))
const chunkModules = JSON.parse(readFileSync(join(dist, '.vite/chunk-modules.json'), 'utf8'))
let failed = false

function fail(message) {
  failed = true
  console.error(`check-client-bundle: ${message}`)
}

// 1. Server-only strings anywhere in the emitted JS and HTML.
const FORBIDDEN_TEXT = [/["'`]node:[a-z_/]+["'`]/, /__vite-browser-external/, /\bprocess\.env\b/, /@prisma\//, /better-sqlite3/]
function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(path)
    else yield path
  }
}
for (const file of walk(dist)) {
  if (!/\.(m?js|html)$/.test(file)) continue
  const text = readFileSync(file, 'utf8')
  for (const pattern of FORBIDDEN_TEXT) {
    const match = text.match(pattern)
    if (match) fail(`${relative(dist, file)} contains '${match[0]}'`)
  }
}

// 2. Server modules in any chunk.
const SERVER_MODULES = [/(^|\/)node_modules\/(\.pnpm\/[^/]+\/node_modules\/)?(@prisma\/|better-sqlite3\/)/, /^lib\/db\.ts$/, /^lib\/racing\//, /^prisma\//]
for (const [file, ids] of Object.entries(chunkModules)) {
  for (const id of ids) if (SERVER_MODULES.some((pattern) => pattern.test(id))) fail(`${file} bundles server module ${id}`)
}

// 2b. Phase 5: the browser engine is race-core as WASM; no chunk may bundle the TS engine.
for (const [file, ids] of Object.entries(chunkModules)) {
  for (const id of ids) if (/^packages\/race-core\//.test(id)) fail(`${file} bundles the TS engine (${id}); use src/engine (WASM)`)
}

// 3. Static import closure of the routes that must not load the engine up front.
const LIGHT_ROUTES = {
  home: ['index.html', 'src/pages/home.tsx'],
  rules: ['index.html', 'src/pages/season-3/layout.tsx', 'src/pages/season-3/rules.tsx'],
  race: ['index.html', 'src/pages/season-3/layout.tsx', 'src/pages/season-3/race.tsx'],
}
const HEAVY = [
  /(^|\/)node_modules\/(\.pnpm\/[^/]+\/node_modules\/)?phaser\//,
  /(^|\/)node_modules\/(\.pnpm\/[^/]+\/node_modules\/)?zod\//,
  /^packages\/race-/,
  /^src\/engine\/(index|sim-worker)\.ts$/,
  /\.wasm(\?|$)/,
]

for (const [route, keys] of Object.entries(LIGHT_ROUTES)) {
  const seen = new Set()
  const stack = [...keys]
  while (stack.length > 0) {
    const key = stack.pop()
    if (seen.has(key)) continue
    const chunk = manifest[key]
    if (!chunk) {
      fail(`${route}: manifest has no entry '${key}'`)
      continue
    }
    seen.add(key)
    stack.push(...(chunk.imports ?? []))
  }
  const files = [...seen].map((key) => manifest[key].file)
  for (const file of files) {
    if (file.endsWith('.wasm')) fail(`${route}: loads ${file}`)
    for (const id of chunkModules[file] ?? []) {
      if (HEAVY.some((pattern) => pattern.test(id))) fail(`${route}: ${file} bundles ${id}`)
    }
  }
  console.log(`check-client-bundle: ${route} loads ${files.length} chunks: ${files.sort().join(', ')}`)
}

if (failed) process.exit(1)
console.log('check-client-bundle: ok (no server code; home, rules and race load no engine, Phaser, Zod or WASM up front)')
