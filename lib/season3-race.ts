import { prisma } from '@/lib/db'
import { mapSeason3RaceRanking } from '@/lib/season3-race-mapping'
import { assertSeason3RaceDay } from '@/lib/season3-schedule'
import { canStartSeason3TestRace, getSeason3RaceMode } from '@/lib/season3-test-mode'
import { createRaceCommit, createRaceSeed } from '@/lib/racing/audit'
import { parseRaceConfig, persistRaceEvents, persistedRaceResult, serializeRaceConfig } from '@/lib/racing/persistence'
import { buildGoldenTrackReward } from '@/lib/racing/golden-reward'
import { parseItemIds, selectAutoLoadout, serializeItemIds } from '@/lib/racing/loadout'
import { runAuthoritativeRace } from '@/lib/racing/runtime'
import { buildRaceItemTelemetry, persistRaceItemTelemetry } from '@/lib/racing/telemetry'
import { buildRacePickupTelemetry, persistRacePickupTelemetry } from '@/lib/racing/pickup-telemetry'
import { assertRaceStateTransition, transitionPersistedRaceState } from '@/lib/racing/state-machine'
import {
  DEFAULT_TRACK_VERSION,
  HAZARD_BALANCE_VERSION,
  PICKUP_SPAWN_VERSION,
  RACE_BALANCE_VERSION,
  RACE_ENGINE_VERSION,
  RACE_PROTOCOL_VERSION,
  RACE_TICK_RATE,
  WILD_ITEM_BALANCE_VERSION,
  raceConfigSchema,
  type RaceItemId,
} from '@/packages/race-protocol/src'
import { queueWildItemInput } from '@/packages/race-core/src'
import {
  applyScarEconomy,
  generateDuckNews,
  resolvePredictions,
  resolveSeason3Race,
  type ChaosCard,
  type ChaosType,
} from '@/lib/season3'
import { applyQuackTransaction, calculateOfficialRaceQuackRewards } from '@/lib/cosmetics/economy'

type Season3RacePlayer = {
  id: number
  userId: number
  scars: number
  shields: number
  shieldConfirmed?: boolean
  isKing: boolean
  kingStreak: number
  user: { name: string; avatarUrl?: string | null }
  appearance?: Record<string, string | null> | null
}

function parseChaosGroups(payload: string | null | undefined) {
  if (!payload) return undefined
  try {
    const parsed = JSON.parse(payload)
    return Array.isArray(parsed) ? parsed as number[][] : undefined
  } catch {
    return undefined
  }
}

function parseSkippedPlayerIds(payload: string | null | undefined) {
  if (!payload) return new Set<number>()
  try {
    const parsed = JSON.parse(payload)
    return new Set(Array.isArray(parsed) ? parsed.filter((value): value is number => Number.isInteger(value)) : [])
  } catch {
    return new Set<number>()
  }
}

function chaosFromWeek(week: {
  chaosType: string
  chaosTargetUserId: number | null
  chaosTargetUserId2: number | null
  chaosPayload: string | null
}): ChaosCard {
  return {
    type: week.chaosType as ChaosType,
    targetUserId: week.chaosTargetUserId,
    targetUserId2: week.chaosTargetUserId2,
    groups: parseChaosGroups(week.chaosPayload),
  }
}

export async function startSeason3Race(weekId: number, options: { allowOffSchedule?: boolean; testMode?: boolean } = {}) {
  const testMode = options.testMode === true
  if (!testMode && !options.allowOffSchedule) assertSeason3RaceDay()

  const week = await prisma.seasonWeek.findUnique({
    where: { id: weekId },
    include: {
      race: true,
      loadouts: true,
      season: { include: { players: { include: { user: true, appearance: true } } } },
    },
  })

  if (!week || week.season.status !== 'active') throw new Error('Season không active')
  if (testMode ? !canStartSeason3TestRace(week.status) : week.status !== 'locked') {
    throw new Error(testMode ? 'Test Race chỉ chạy khi prep đang mở hoặc đã lock' : 'Phải lock prep trước khi đua')
  }
  const raceMode = getSeason3RaceMode(testMode)
  if (!testMode && week.race && week.race.status !== 'failed') return week.race

  const claimedRaceId = week.race?.id ?? null
  const raceSeed = testMode ? createRaceSeed() : (week.raceSeed ?? createRaceSeed())
  const skippedPlayerIds = parseSkippedPlayerIds(week.skippedPlayerIdsJson)
  const activePlayers = (week.season.players as Season3RacePlayer[]).filter((player) => !skippedPlayerIds.has(player.userId))
  if (activePlayers.length < 2 || activePlayers.length > 16) throw new Error('Race cần 2–16 dzịt active')
  const loadoutByPlayer = new Map<number, { seasonPlayerId: number; itemIdsJson: string; status: string }>(week.loadouts.map((loadout: { seasonPlayerId: number; itemIdsJson: string; status: string }) => [loadout.seasonPlayerId, loadout] as const))
  const immutableLoadouts: Array<{ player: Season3RacePlayer; itemIds: RaceItemId[]; source: 'PLAYER' | 'AUTO' }> = activePlayers.map((player) => {
    const selected = loadoutByPlayer.get(player.id)
    return {
      player,
      itemIds: selected ? parseItemIds(selected.itemIdsJson) : selectAutoLoadout(raceSeed, String(player.userId)),
      source: selected?.status === 'ready' ? 'PLAYER' as const : 'AUTO' as const,
    }
  })
  const claim = await prisma.$transaction(async (tx: typeof prisma) => {
    if (raceMode.mutatesSeason) {
      for (const loadout of immutableLoadouts) {
        if (loadoutByPlayer.has(loadout.player.id)) continue
        await tx.seasonLoadout.create({
          data: { weekId: week.id, seasonPlayerId: loadout.player.id, userId: loadout.player.userId, itemIdsJson: serializeItemIds(loadout.itemIds), status: 'auto', lockedAt: new Date() },
        })
      }
    }
    const created = await tx.race.create({
      data: {
        status: 'pending',
        isTest: testMode,
        engineState: 'LOCKED',
        protocolVersion: RACE_PROTOCOL_VERSION,
        engineVersion: RACE_ENGINE_VERSION,
        balanceVersion: RACE_BALANCE_VERSION,
        trackVersion: DEFAULT_TRACK_VERSION,
        raceSeed,
        participants: {
          create: activePlayers.map((player) => ({
            userId: player.userId,
            displayName: player.user.name,
            initialRank: null,
            gotScar: false,
            usedShield: false,
          })),
        },
      },
    })

    if (raceMode.claimsOfficialWeek) {
      const claimed = await tx.seasonWeek.updateMany({
        where: { id: week.id, status: 'locked', raceId: claimedRaceId },
        data: { status: 'racing', raceId: created.id },
      })

      if (claimed.count !== 1) {
        await tx.race.delete({ where: { id: created.id } })
        const current = await tx.seasonWeek.findUnique({ where: { id: week.id }, include: { race: true } })
        if (!current?.race) throw new Error('Không thể claim Season 3 week để start race')
        return { race: current.race, claimed: false }
      }
    }

    const config = raceConfigSchema.parse({
      raceId: String(created.id),
      seed: raceSeed,
      protocolVersion: RACE_PROTOCOL_VERSION,
      engineVersion: RACE_ENGINE_VERSION,
      balanceVersion: RACE_BALANCE_VERSION,
      trackVersion: DEFAULT_TRACK_VERSION,
      pickupSpawnVersion: PICKUP_SPAWN_VERSION,
      wildItemBalanceVersion: WILD_ITEM_BALANCE_VERSION,
      hazardBalanceVersion: HAZARD_BALANCE_VERSION,
      tickRate: RACE_TICK_RATE,
      players: activePlayers.map((player) => ({
        playerId: String(player.userId),
        name: player.user.name,
        cosmeticKey: player.appearance ? JSON.stringify(player.appearance) : undefined,
      })),
      loadouts: immutableLoadouts.map((loadout) => ({ playerId: String(loadout.player.userId), itemIds: loadout.itemIds, source: loadout.source })),
      chaosConfig: {
        type: week.chaosType,
        targetPlayerId: week.chaosTargetUserId === null ? null : String(week.chaosTargetUserId),
        groups: parseChaosGroups(week.chaosPayload)?.map((group) => group.map(String)),
      },
      pickupConfig: {
        enabled: true,
        goldenBoxEnabled: true,
        goldenBoxProbability: 0.12,
        hazardsEnabled: true,
        positionAwareLoot: true,
        spawnMultiplier: 1,
        regularPickupCap: 2,
        manualItemsEnabled: true,
        autoItemsEnabled: true,
        chaosBoxEnabled: false,
        forceGoldenBox: false,
        disabledItems: [],
        idealManualPlayerIds: [],
      },
    })
    const race = await tx.race.update({
      where: { id: created.id },
      data: {
        engineState: 'COUNTDOWN',
        engineConfigJson: serializeRaceConfig(config),
        seedCommit: createRaceCommit(config),
      },
    })

    return { race, claimed: true }
  })

  if (claim.claimed) {
    void executeSeason3Race(claim.race.id, week.id, { testMode }).catch((error: unknown) => {
      console.error(`Season 3 race ${claim.race.id} failed:`, error)
    })
  }

  return claim.race
}

export async function executeSeason3Race(raceId: number, weekId: number, options: { testMode?: boolean } = {}) {
  let testRace = options.testMode === true
  try {
    const week = await prisma.seasonWeek.findUnique({
      where: { id: weekId },
      include: {
      predictions: true,
        shieldChoices: true,
        season: { include: { players: { include: { user: true, appearance: true } } } },
      },
    })
    const race = await prisma.race.findUnique({ where: { id: raceId } })

    if (!week || !race) {
      throw new Error('Season 3 race không còn hợp lệ')
    }
    testRace = race.isTest
    if (!testRace && (week.status !== 'racing' || week.raceId !== raceId)) throw new Error('Season 3 official race không còn hợp lệ')

    if (!race.engineConfigJson) throw new Error('Race thiếu immutable engine config')
    const config = parseRaceConfig(race.engineConfigJson)
    await new Promise((resolve) => setTimeout(resolve, 3000))
    await transitionPersistedRaceState(prisma, raceId, 'COUNTDOWN', 'RACING')
    await prisma.race.update({ where: { id: raceId }, data: { status: 'running' } })

    const shieldConfirmedIds = new Set(week.shieldChoices.map((choice: { seasonPlayerId: number }) => choice.seasonPlayerId))
    const configuredPlayerIds = new Set(config.players.map((player) => Number(player.playerId)))
    const players = (week.season.players as Season3RacePlayer[]).filter((player) => configuredPlayerIds.has(player.userId)).map((player) => ({
      ...player,
      shieldConfirmed: shieldConfirmedIds.has(player.id),
    }))
    let lastControlPollTick = -Infinity
    const result = await runAuthoritativeRace(config, {
      persistenceRate: 2,
      onSnapshot: (snapshot) => prisma.race.update({ where: { id: raceId }, data: { liveSnapshotJson: JSON.stringify(snapshot) } }),
      beforeTick: async (state) => {
        if (state.tick - lastControlPollTick < Math.max(1, Math.round(config.tickRate / 10))) return
        lastControlPollTick = state.tick
        const pending = await prisma.raceWildAction.findMany({ where: { raceId, status: 'PENDING' }, orderBy: { requestedAt: 'asc' }, take: 20 })
        for (const action of pending) {
          const authoritativeTick = state.tick + 1
          const claimed = await prisma.raceWildAction.updateMany({
            where: { id: action.id, status: 'PENDING' },
            data: { status: 'QUEUED', authoritativeTick },
          })
          if (claimed.count !== 1) continue
          queueWildItemInput(state, {
            raceId: String(raceId),
            playerId: action.playerId,
            wildItemInstanceId: action.wildItemInstanceId,
            action: 'USE',
            clientActionId: action.clientActionId,
          }, authoritativeTick)
        }
      },
      onEvents: async (events) => {
        await persistRaceEvents(prisma, raceId, events)
        for (const raceEvent of events.filter((entry) => entry.type === 'WILD_ITEM_MANUAL_INPUT')) {
          const clientActionId = typeof raceEvent.metadata.clientActionId === 'string' ? raceEvent.metadata.clientActionId : null
          if (!clientActionId || !raceEvent.sourcePlayerId) continue
          const applied = raceEvent.metadata.applied === true
          await prisma.raceWildAction.updateMany({
            where: { raceId, playerId: raceEvent.sourcePlayerId, clientActionId, status: 'QUEUED' },
            data: {
              status: applied ? 'APPLIED' : 'REJECTED',
              authoritativeTick: raceEvent.tick,
              resultJson: JSON.stringify({ applied, reason: raceEvent.metadata.reason ?? null, targetPlayerId: raceEvent.targetPlayerId ?? null }),
              resolvedAt: new Date(),
            },
          })
        }
      },
    })
    await prisma.raceWildAction.updateMany({
      where: { raceId, status: { in: ['PENDING', 'QUEUED'] } },
      data: { status: 'REJECTED', resultJson: JSON.stringify({ applied: false, reason: 'RACE_FINISHED' }), resolvedAt: new Date() },
    })
    await transitionPersistedRaceState(prisma, raceId, 'RACING', 'FINISHED')
    if (!race.isTest) {
      await Promise.all([
        persistRaceItemTelemetry(prisma, buildRaceItemTelemetry(raceId, config, result)),
        persistRacePickupTelemetry(prisma, buildRacePickupTelemetry(raceId, config, result)),
      ])
    }

    const ranking = mapSeason3RaceRanking(result.standings.map((entry) => ({ rank: entry.rank, name: entry.name })), players)

    const previousKing = players.find((player) => player.isKing)
    const chaos = chaosFromWeek(week)
    const resolved = resolveSeason3Race(
      ranking,
      chaos,
      previousKing ? { userId: previousKing.userId, streak: previousKing.kingStreak } : null,
    )
    await persistRaceEvents(prisma, raceId, [{
      raceId: String(raceId),
      type: 'CHAOS_RESOLVED',
      tick: Math.ceil(result.durationMs / (1000 / config.tickRate)),
      timestampWithinRaceMs: result.durationMs,
      metadata: {
        chaosType: chaos.type,
        loserPlayerIds: resolved.scarOutcomes.map((outcome) => String(outcome.userId)),
      },
    }])
    const activeUserIds = new Set(players.map((player) => player.userId))
    const activePredictions = week.predictions.filter((prediction: { predictorUserId: number; targetUserId: number }) => activeUserIds.has(prediction.predictorUserId) && activeUserIds.has(prediction.targetUserId))
    const predictionOutcomes = resolvePredictions(activePredictions, resolved.bottomTwo)
    const quackRewards = calculateOfficialRaceQuackRewards({
      winnerUserId: resolved.ranking[0]!.userId,
      finalLoserUserIds: resolved.scarOutcomes.map((outcome) => outcome.userId),
      predictions: activePredictions,
    })
    const goldenCollection = result.events.find((raceEvent) => raceEvent.type === 'GOLDEN_BOX_COLLECTED' && raceEvent.sourcePlayerId)
    const goldenPlayer = goldenCollection ? players.find((player) => String(player.userId) === goldenCollection.sourcePlayerId) : null
    const goldenPickupId = typeof goldenCollection?.metadata.pickupId === 'string' ? goldenCollection.metadata.pickupId : null
    const playerName = (userId: number | null) => players.find((player) => player.userId === userId)?.user.name ?? null
    const predictionWinners = predictionOutcomes
      .filter((outcome) => outcome.correct)
      .map((outcome) => ({ name: playerName(outcome.predictorUserId) ?? `User ${outcome.predictorUserId}` }))
    const duckNews = generateDuckNews({
      weekNumber: week.weekNumber,
      scarVictims: resolved.scarVictims,
      protectedPlayers: resolved.protectedPlayers,
      chaos,
      chaosTargetName: playerName(chaos.targetUserId),
      kingName: playerName(resolved.kingUserId),
      predictionWinners,
    })
    const qpLines = quackRewards.map((reward) => {
      const label = reward.reason === 'RACE_WIN' ? '🏆 Race Winner' : reward.reason === 'PREDICTION_WIN' ? '🔮 Correct Prediction' : '🎰 PERFECT WEEK'
      return `${label} — ${playerName(reward.playerId) ?? `User ${reward.playerId}`} +${reward.amount} QP`
    })
    if (goldenPlayer) qpLines.push(`🪙 Golden Quack Box — ${goldenPlayer.user.name}${race.isTest ? ' (test)' : ' +1 QP'}`)
    const recap = `${duckNews}\n\n${qpLines.join('\n')}`

    assertRaceStateTransition('FINISHED', 'RESOLVED')
    await prisma.$transaction(async (tx: typeof prisma) => {
      for (const entry of resolved.ranking) {
        const player = players.find((candidate) => candidate.userId === entry.userId)
        const shieldWasUsed = player?.shieldConfirmed === true && player.shields > 0
        await tx.raceParticipant.updateMany({
          where: { raceId, userId: entry.userId, cloneIndex: null },
          data: {
            initialRank: entry.rank,
            gotScar: resolved.scarVictims.some((victim) => victim.userId === entry.userId),
            usedShield: shieldWasUsed,
          },
        })
      }

      if (!race.isTest) {
        await tx.seasonPlayer.updateMany({ where: { seasonId: week.seasonId, isKing: true }, data: { isKing: false, kingStreak: 0 } })
        for (const player of players) {
          const outcome = resolved.scarOutcomes.find((candidate) => candidate.userId === player.userId)
          const entry = resolved.ranking.find((candidate) => candidate.userId === player.userId)!
          const shieldWasUsed = player.shieldConfirmed === true && player.shields > 0
          const economy = applyScarEconomy(player.scars, player.shields, outcome?.scarPoints ?? 0, shieldWasUsed)
          const predictionPoints = predictionOutcomes
            .filter((prediction) => prediction.predictorUserId === player.userId && prediction.correct)
            .length

          await tx.seasonPlayer.update({
            where: { id: player.id },
            data: {
              scars: economy.scars,
              shields: economy.shields,
              shieldsUsed: shieldWasUsed ? { increment: 1 } : undefined,
              predictionPoints: predictionPoints ? { increment: predictionPoints } : undefined,
              raceCount: { increment: 1 },
              raceWins: entry.rank === 1 ? { increment: 1 } : undefined,
              championshipPoints: { increment: resolved.ranking.length - entry.rank + 1 },
              isKing: player.userId === resolved.kingUserId,
              kingStreak: player.userId === resolved.kingUserId ? resolved.kingStreak : 0,
            },
          })
        }

        for (const outcome of predictionOutcomes) {
          const prediction = week.predictions.find((candidate: { predictorUserId: number }) => candidate.predictorUserId === outcome.predictorUserId)
          if (prediction) await tx.seasonPrediction.update({ where: { id: prediction.id }, data: { pointsAwarded: outcome.pointsAwarded } })
        }
        for (const reward of quackRewards) {
          const seasonPlayer = players.find((player) => player.userId === reward.playerId)
          if (!seasonPlayer) continue
          await applyQuackTransaction(tx, {
            seasonPlayerId: seasonPlayer.id,
            amount: reward.amount,
            reason: reward.reason,
            raceId,
            idempotencyKey: `race:${raceId}:player:${seasonPlayer.id}:${reward.reason}`,
            metadata: { weekId: week.id, weekNumber: week.weekNumber },
          })
        }
        if (goldenPlayer && goldenPickupId) {
          const goldenReward = buildGoldenTrackReward({
            official: !race.isTest,
            raceId,
            pickupId: goldenPickupId,
            seasonPlayerId: goldenPlayer.id,
            weekId: week.id,
            weekNumber: week.weekNumber,
          })
          if (!goldenReward) throw new Error('Golden reward cannot be granted for an unofficial race')
          await applyQuackTransaction(tx, goldenReward)
          await tx.raceEngineEvent.create({
            data: {
              raceId,
              type: 'QP_TRACK_REWARD_GRANTED',
              tick: goldenCollection!.tick,
              timestampWithinRaceMs: goldenCollection!.timestampWithinRaceMs,
              sourcePlayerId: String(goldenPlayer.userId),
              targetPlayerId: null,
              metadataJson: JSON.stringify({ pickupId: goldenPickupId, amount: 1, reason: 'TRACK_GOLDEN_BOX' }),
            },
          })
        }
      }

      const transitionedRace = await tx.race.updateMany({
        where: { id: raceId, engineState: 'FINISHED' },
        data: {
          status: 'finished',
          engineState: 'RESOLVED',
          videoUrl: null,
          liveSnapshotJson: null,
          ...persistedRaceResult(result),
          finalVerdict: resolved.scarVictims.map((entry) => `${entry.name} bị làm dzịt`).join(' & ') || 'Khiên đã cứu hết người bị phạt.',
          finishedAt: new Date(),
        },
      })
      if (transitionedRace.count !== 1) throw new Error(`Race ${raceId} is no longer in FINISHED`)
      if (!race.isTest) {
        await tx.seasonWeek.update({
          where: { id: week.id },
          data: { status: 'resolved', recap, resolvedAt: new Date() },
        })
      }
    })
    if (race.isTest) await transitionPersistedRaceState(prisma, raceId, 'RESOLVED', 'ARCHIVED')

    return { raceId, recap, resolution: resolved, predictions: predictionOutcomes, quackRewards: race.isTest ? [] : quackRewards }
  } catch (error) {
    await prisma.race.update({ where: { id: raceId }, data: { status: 'failed' } }).catch(() => undefined)
    if (!testRace) await prisma.seasonWeek.update({ where: { id: weekId }, data: { status: 'locked', raceId: null } }).catch(() => undefined)
    throw error
  }
}
