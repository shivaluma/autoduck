#!/usr/bin/env node
// `pnpm dev`: the API on :3000 and the SPA on :5173, side by side.
//
//   API  `pnpm dev:api`  the Rust server (`autoduck serve`, AUTODUCK_ENV=dev, prisma/dev.db; the DB must exist)
//   SPA  `pnpm dev:web`  Vite; proxies /api to API_URL (default http://127.0.0.1:3000).
//
// Open http://localhost:5173. Ctrl-C stops both.
import { spawn } from 'node:child_process'

// Re-use the pnpm that runs this script (`npm_execpath`), so a corepack-pinned pnpm isn't swapped for
// whatever `pnpm` is first on PATH.
const pnpm = process.env.npm_execpath
  ? [process.execPath, [process.env.npm_execpath]]
  : ['pnpm', []]

const children = [
  ['api', ['dev:api']],
  ['web', ['dev:web']],
].map(([name, args]) => {
  const child = spawn(pnpm[0], [...pnpm[1], ...args], { stdio: ['ignore', 'pipe', 'pipe'], env: process.env })
  const prefix = `[${name}] `
  for (const stream of [child.stdout, child.stderr]) {
    let pending = ''
    stream.on('data', (chunk) => {
      pending += chunk
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) process.stdout.write(prefix + line + '\n')
    })
  }
  child.on('exit', (code, signal) => {
    process.stdout.write(`${prefix}exited (${signal ?? code})\n`)
    shutdown(code ?? 1)
  })
  return child
})

let stopping = false
function shutdown(code) {
  if (stopping) return
  stopping = true
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM')
  process.exitCode = code
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
