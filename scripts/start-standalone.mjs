#!/usr/bin/env node
// `pnpm start`: runs the production build locally the way the Docker image does (one Next process serving
// the API route handlers and the Vite SPA). Needs `pnpm build && pnpm build:api:next` first.
//
// Next's standalone output doesn't include public/ or .next/static, and the SPA build (dist/) goes into
// public/ (minus dist/.vite, the build manifests), so this assembles them next to .next/standalone/server.js.
import { spawn } from 'node:child_process'
import { cpSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const standalone = join(root, '.next/standalone')
for (const required of [join(standalone, 'server.js'), join(root, 'dist/index.html')]) {
  if (!existsSync(required)) {
    console.error(`start-standalone: ${required} is missing; run \`pnpm build && pnpm build:api:next\` first`)
    process.exit(1)
  }
}

rmSync(join(standalone, 'public'), { recursive: true, force: true })
cpSync(join(root, 'public'), join(standalone, 'public'), { recursive: true })
cpSync(join(root, 'dist'), join(standalone, 'public'), { recursive: true, filter: (source) => !source.includes('/dist/.vite') })
cpSync(join(root, '.next/static'), join(standalone, '.next/static'), { recursive: true })

const server = spawn(process.execPath, [join(standalone, 'server.js')], { stdio: 'inherit', env: { PORT: '3000', ...process.env } })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal))
server.on('exit', (code) => process.exit(code ?? 0))
