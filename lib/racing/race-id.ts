/**
 * The `[id]` segment of /api/races/[id] and /api/races/[id]/track.
 *
 * Only the canonical decimal form is accepted (/^[1-9][0-9]*$/): "41abc", "041", "+41", "4.1",
 * " 41" or "1e3" are 400, where parseInt used to read "41abc" as race 41. A canonical id above
 * Prisma's Int range (2^31 - 1) can't name a row, so it is a plain 404 instead of a query error.
 */
export type RaceIdParam = { ok: true; raceId: number } | { ok: false; status: 400 | 404 }

const CANONICAL_ID = /^[1-9][0-9]*$/
const MAX_RACE_ID = 2_147_483_647

export function parseRaceIdParam(raw: string): RaceIdParam {
  if (!CANONICAL_ID.test(raw)) return { ok: false, status: 400 }
  // Longer than 10 digits is certainly out of range (and may not be a safe integer).
  const raceId = raw.length > 10 ? Number.POSITIVE_INFINITY : Number(raw)
  if (raceId > MAX_RACE_ID) return { ok: false, status: 404 }
  return { ok: true, raceId }
}
