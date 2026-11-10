// Shared state between the dumper and the stubs (set per case by the dumper).
export type Harness = {
  prisma: unknown
  runAuthoritativeRace: (...args: unknown[]) => Promise<unknown>
  parseRaceConfig: (json: string) => unknown
  record: (op: string, args: unknown) => unknown
}

export function harness(): Harness {
  const value = (globalThis as { __S3_META__?: Harness }).__S3_META__
  if (!value) throw new Error('season3-meta harness not installed')
  return value
}
