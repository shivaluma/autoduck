import { randomUUID } from 'node:crypto'
import type { RaceEvent, StateSnapshotMessage } from '@/packages/race-protocol/src'

export type WildActionStatus = 'PENDING' | 'QUEUED' | 'APPLIED' | 'REJECTED'

export interface WildActionRecord {
  id: string
  raceId: number
  seasonPlayerId: number
  playerId: string
  wildItemInstanceId: string
  clientActionId: string
  status: WildActionStatus
  authoritativeTick: number | null
  resultJson: string | null
  requestedAt: Date
  resolvedAt: Date | null
}

export interface AcceptWildActionInput {
  raceId: number
  seasonPlayerId: number
  playerId: string
  wildItemInstanceId: string
  clientActionId: string
}

class LiveRaceSession {
  latestSnapshot: StateSnapshotMessage | null = null
  private pendingQueue: WildActionRecord[] = []
  private records = new Map<string, WildActionRecord>()

  publishSnapshot(snapshot: StateSnapshotMessage) {
    this.latestSnapshot = snapshot
  }

  getDuck(playerId: string) {
    return this.latestSnapshot?.ducks.find((duck) => duck.playerId === playerId) ?? null
  }

  getWildItem(playerId: string) {
    return this.getDuck(playerId)?.wildItem ?? null
  }

  getWildAction(playerId: string, clientActionId: string) {
    return this.records.get(`${playerId}:${clientActionId}`) ?? null
  }

  getLatestAction(seasonPlayerId: number) {
    const matches = [...this.records.values()].filter((record) => record.seasonPlayerId === seasonPlayerId)
    return matches.sort((left, right) => right.requestedAt.getTime() - left.requestedAt.getTime())[0] ?? null
  }

  acceptWildAction(input: AcceptWildActionInput): WildActionRecord {
    const key = `${input.playerId}:${input.clientActionId}`
    const existing = this.records.get(key)
    if (existing) return existing

    const record: WildActionRecord = {
      id: randomUUID(),
      raceId: input.raceId,
      seasonPlayerId: input.seasonPlayerId,
      playerId: input.playerId,
      wildItemInstanceId: input.wildItemInstanceId,
      clientActionId: input.clientActionId,
      status: 'PENDING',
      authoritativeTick: null,
      resultJson: null,
      requestedAt: new Date(),
      resolvedAt: null,
    }
    this.records.set(key, record)
    this.pendingQueue.push(record)
    return record
  }

  recentRequestCount(seasonPlayerId: number, windowMs: number) {
    const since = Date.now() - windowMs
    return [...this.records.values()].filter(
      (record) => record.seasonPlayerId === seasonPlayerId && record.requestedAt.getTime() >= since,
    ).length
  }

  drainPendingWildActions(): WildActionRecord[] {
    const batch = this.pendingQueue.splice(0)
    for (const record of batch) {
      if (record.status === 'PENDING') record.status = 'QUEUED'
    }
    return batch
  }

  markQueued(record: WildActionRecord, authoritativeTick: number) {
    record.status = 'QUEUED'
    record.authoritativeTick = authoritativeTick
  }

  resolveFromEvent(event: RaceEvent) {
    const clientActionId = event.metadata.clientActionId
    if (typeof clientActionId !== 'string' || !event.sourcePlayerId) return
    const record = this.records.get(`${event.sourcePlayerId}:${clientActionId}`)
    if (!record) return

    const applied = event.metadata.applied === true
    record.status = applied ? 'APPLIED' : 'REJECTED'
    record.authoritativeTick = event.tick
    record.resolvedAt = new Date()
    record.resultJson = JSON.stringify({
      applied,
      reason: event.metadata.reason ?? null,
      targetPlayerId: event.targetPlayerId ?? null,
    })
  }

  finalizeUnresolved(reason: string) {
    const now = new Date()
    const resultJson = JSON.stringify({ applied: false, reason })
    for (const record of this.records.values()) {
      if (record.status !== 'PENDING' && record.status !== 'QUEUED') continue
      record.status = 'REJECTED'
      record.resultJson = resultJson
      record.resolvedAt = now
    }
  }

  getAllWildActions() {
    return [...this.records.values()]
  }
}

const sessions = new Map<number, LiveRaceSession>()

export function startLiveRaceSession(raceId: number) {
  const session = new LiveRaceSession()
  sessions.set(raceId, session)
  return session
}

export function getLiveRaceSession(raceId: number) {
  return sessions.get(raceId) ?? null
}

export function stopLiveRaceSession(raceId: number) {
  sessions.delete(raceId)
}

export function toWildActionApi(record: WildActionRecord) {
  return {
    clientActionId: record.clientActionId,
    wildItemInstanceId: record.wildItemInstanceId,
    status: record.status,
    authoritativeTick: record.authoritativeTick,
    resultJson: record.resultJson,
  }
}

export async function persistLiveRaceWildActions(
  prisma: { raceWildAction: { createMany(args: unknown): Promise<unknown> } },
  raceId: number,
  records: WildActionRecord[],
) {
  if (records.length === 0) return
  await prisma.raceWildAction.createMany({
    data: records.map((record) => ({
      id: record.id,
      raceId,
      seasonPlayerId: record.seasonPlayerId,
      playerId: record.playerId,
      wildItemInstanceId: record.wildItemInstanceId,
      clientActionId: record.clientActionId,
      action: 'USE',
      status: record.status,
      authoritativeTick: record.authoritativeTick,
      resultJson: record.resultJson,
      requestedAt: record.requestedAt,
      resolvedAt: record.resolvedAt,
    })),
    skipDuplicates: true,
  })
}
