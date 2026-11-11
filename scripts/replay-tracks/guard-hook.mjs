/**
 * Isolation guard for resolver workers (plan §4.4 step 3). Loaded with
 * `node --import tsx --import <abs>/guard-hook.mjs resolve-worker.mts`: on the main thread it registers itself as
 * a module resolve hook; on the hooks thread it checks every resolved file. A file outside node_modules must lie
 * under one of the roots in REPLAY_GUARD_ROOTS (JSON array of absolute paths: the commit's extraction directory,
 * the HEAD DTRK bundle and the worker itself). Anything else, for example a historical file importing
 * `@/lib/...` that tsx resolved into HEAD's tree, throws, so a candidate commit can never silently run HEAD code.
 */
import { register } from 'node:module'
import { isMainThread } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

if (isMainThread) {
  register(import.meta.url)
}

let roots = null
function allowedRoots() {
  if (!roots) {
    roots = JSON.parse(process.env.REPLAY_GUARD_ROOTS || '[]').map((root) => path.resolve(root))
    if (roots.length === 0) throw new Error('guard-hook: REPLAY_GUARD_ROOTS is empty')
  }
  return roots
}

export async function resolve(specifier, context, nextResolve) {
  const result = await nextResolve(specifier, context)
  const url = result.url
  if (!url.startsWith('file:')) return result
  const file = fileURLToPath(url.split('?')[0])
  if (file.split(path.sep).includes('node_modules')) return result
  for (const root of allowedRoots()) {
    if (file === root || file.startsWith(root + path.sep)) return result
  }
  throw new Error(`guard-hook: ${specifier} resolved outside the candidate tree: ${file}`)
}
