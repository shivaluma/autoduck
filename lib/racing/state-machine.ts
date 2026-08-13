import type { RaceLifecycleState } from '@/packages/race-protocol/src'

const transitions: Record<RaceLifecycleState, readonly RaceLifecycleState[]> = {
  CREATED: ['CHAOS_REVEALED'],
  CHAOS_REVEALED: ['PREPARING'],
  PREPARING: ['LOCKED'],
  LOCKED: ['COUNTDOWN', 'PREPARING'],
  COUNTDOWN: ['RACING', 'LOCKED'],
  RACING: ['FINISHED'],
  FINISHED: ['RESOLVED'],
  RESOLVED: ['ARCHIVED'],
  ARCHIVED: [],
}

export function canTransitionRaceState(from: RaceLifecycleState, to: RaceLifecycleState) {
  return transitions[from].includes(to)
}

export function assertRaceStateTransition(from: RaceLifecycleState, to: RaceLifecycleState) {
  if (!canTransitionRaceState(from, to)) throw new Error(`Invalid race transition: ${from} → ${to}`)
}

export async function transitionPersistedRaceState(
  prisma: { race: { updateMany(args: unknown): Promise<{ count: number }> } },
  raceId: number,
  from: RaceLifecycleState,
  to: RaceLifecycleState,
) {
  assertRaceStateTransition(from, to)
  const changed = await prisma.race.updateMany({ where: { id: raceId, engineState: from }, data: { engineState: to } })
  if (changed.count !== 1) throw new Error(`Race ${raceId} is no longer in ${from}`)
}
