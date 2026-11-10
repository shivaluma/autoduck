// Module hooks for scripts/oracle/dump-season3-meta-fixtures.ts: redirect the I/O-bound imports
// of lib/season3-race.ts (Prisma, the engine runtime, live sessions, replay recorder, telemetry,
// the QP ledger write) to recording stubs, so `executeSeason3Race` runs its meta layer for real.
// `registerHooks` is synchronous and in-thread, so it covers tsx's CJS `require` path too.
import { registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

const STUBS: Record<string, string> = {
  '@/lib/db': 'db.ts',
  '@/lib/racing/runtime': 'runtime.ts',
  '@/lib/racing/persistence': 'persistence.ts',
  '@/lib/racing/live-race-session': 'live-race-session.ts',
  '@/lib/racing/replay-track/recorder': 'replay-recorder.ts',
  '@/lib/racing/replay-track/store': 'replay-store.ts',
  '@/lib/racing/post-race-stats': 'post-race-stats.ts',
  '@/lib/racing/telemetry': 'telemetry.ts',
  '@/lib/racing/pickup-telemetry': 'pickup-telemetry.ts',
  '@/lib/cosmetics/economy': 'economy.ts',
}

export function installSeason3MetaStubs(stubDir: string) {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const stub = STUBS[specifier]
      if (stub) return { url: pathToFileURL(join(stubDir, stub)).href, shortCircuit: true }
      return nextResolve(specifier, context)
    },
  })
}
