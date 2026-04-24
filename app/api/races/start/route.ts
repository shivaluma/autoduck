import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { runRaceWorker } from '@/lib/race-worker'
import { buildPenaltyVerdict, calculatePenalties, dedupeVictimUserIds } from '@/lib/shield-logic'
import { raceEventBus, RACE_EVENTS } from '@/lib/event-bus'
import { expandBossParticipants, evaluateBossStatus, resolveBossOutcome } from '@/lib/boss-logic'
import { applyChestPreRace, getActiveChestsForUsers, issueBossRewardChests, resolveChestPostRace, validateChestConfig } from '@/lib/mystery-chest'
import { consumeShield, craftShieldIfEligible, normalizeLegacyShieldState, syncShieldCounters, tickShieldDecay } from '@/lib/shield-decay'
import type { BossRewardInput, ItemRaceModifiers } from '@/lib/mystery-chest'
import type { ChestEffect, RaceMetaContext } from '@/lib/types'
import { isImmortalDuck } from '@/lib/immortal-duck'
import { MYSTERY_CHESTS_ENABLED } from '@/lib/feature-flags'

interface ParticipantInput {
  userId: number
  useShield: boolean
  shieldId?: number
}

interface ChestConfigInput {
  chestId: number
  targetUserId?: number
}

interface WorkerPlayerInput {
  name: string
  displayName: string
  useShield: boolean
  shieldId?: number
  userId: number
  isImmortal?: boolean
  isClone?: boolean
  cloneOfUserId?: number | null
  cloneIndex?: number | null
  chestEffect?: ChestEffect | null
  chestTargetUserId?: number | null
  borrowedShieldFromUserId?: number | null
}

interface UserWithActiveShields {
  id: number
  name: string
  shields: number
  ownedShields: Array<{ id: number; charges: number }>
  cleanStreak: number
  isBoss: boolean
  bossSince?: Date | null
}

interface RaceEventUser {
  id: number
  name: string
  avatarUrl?: string | null
}

function getVietnamDayWindow() {
  const now = new Date()
  const vnOffset = 7 * 60 * 60 * 1000
  const vnTime = new Date(now.getTime() + vnOffset)
  const day = vnTime.getUTCDay()
  const startOfVNDay = new Date(vnTime)
  startOfVNDay.setUTCHours(0, 0, 0, 0)
  const startOfVNDayUTC = new Date(startOfVNDay.getTime() - vnOffset)
  const endOfVNDayUTC = new Date(startOfVNDayUTC.getTime() + 24 * 60 * 60 * 1000 - 1)

  return { day, startOfVNDayUTC, endOfVNDayUTC }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const {
      participants,
      chestConfigs = [],
      test,
      secret,
    } = body as {
      participants: ParticipantInput[]
      chestConfigs?: ChestConfigInput[]
      test?: boolean
      secret?: string
    }

    const secretKey = process.env.RACE_SECRET_KEY
    const isTestMode = test === true && secret === secretKey

    if (!isTestMode) {
      const { day, startOfVNDayUTC, endOfVNDayUTC } = getVietnamDayWindow()

      if (day !== 1) {
        return NextResponse.json(
          { error: 'Giải đua chỉ mở cửa vào THỨ HAI hàng tuần (Giờ VN)! 🦆' },
          { status: 403 }
        )
      }

      const todayRaces = await prisma.race.count({
        where: {
          createdAt: {
            gte: startOfVNDayUTC,
            lte: endOfVNDayUTC,
          },
          status: { not: 'failed' },
        },
      })

      if (todayRaces > 0) {
        return NextResponse.json(
          { error: 'Mỗi tuần chỉ đua 1 lần thôi! Đợi tuần sau nhé. 🛑' },
          { status: 403 }
        )
      }
    }

    if (!participants || participants.length < 2) {
      return NextResponse.json({ error: 'Cần ít nhất 2 người chơi' }, { status: 400 })
    }

    const userIds = participants.map((participant) => participant.userId)
    await normalizeLegacyShieldState(prisma, userIds)

    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      include: {
        ownedShields: {
          where: { status: 'active' },
          orderBy: [{ charges: 'asc' }, { earnedAt: 'asc' }],
        },
      },
    })

    for (const user of users as UserWithActiveShields[]) {
      if (isImmortalDuck({ name: user.name, shields: user.shields }) && user.isBoss) {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            cleanStreak: 0,
            isBoss: false,
            bossSince: null,
          },
        })
        user.cleanStreak = 0
        user.isBoss = false
        user.bossSince = null
      }
    }

    if (users.length !== participants.length) {
      return NextResponse.json({ error: 'Một số người chơi không tồn tại' }, { status: 400 })
    }

    for (const participant of participants) {
      if (!participant.useShield) {
        continue
      }

      const user = (users as UserWithActiveShields[]).find((candidate) => candidate.id === participant.userId)
      if (user && isImmortalDuck({ name: user.name, shields: user.shields })) {
        continue
      }
      if (!user || user.ownedShields.length <= 0) {
        return NextResponse.json(
          { error: `${user?.name || 'Unknown'} không có khiên để sử dụng` },
          { status: 400 }
        )
      }
    }

    const activeChests = MYSTERY_CHESTS_ENABLED ? await getActiveChestsForUsers(prisma, userIds) : []
    const chestValidation = validateChestConfig(activeChests, participants, chestConfigs)
    if (!chestValidation.ok) {
      return NextResponse.json(
        { error: chestValidation.errors.join('\n') },
        { status: 400 }
      )
    }

    // INVARIANT: 1 user không thể đồng thời là Boss và sở hữu chest active.
    // Khi user thành Boss, mọi chest đang giữ phải void; khi user nhận chest mới,
    // họ chắc chắn không phải Boss (vì Boss = cleanStreak ≥ 3 không có scar).
    const bossChestOwners = (activeChests as Array<{ id: number; ownerId: number }>).filter((chest) => {
      const owner = (users as UserWithActiveShields[]).find((candidate) => candidate.id === chest.ownerId)
      return owner?.isBoss === true
    })
    if (bossChestOwners.length > 0) {
      const violators = bossChestOwners.map((chest) => `chest #${chest.id} (owner ${chest.ownerId})`).join(', ')
      console.error(`[INVARIANT VIOLATION] Boss đang giữ chest active: ${violators}`)
      return NextResponse.json(
        {
          error: `Vi phạm ràng buộc: Boss không được giữ chest active. ${violators}. Hãy void chest trước.`,
        },
        { status: 409 }
      )
    }

    const chestConfigMap = new Map(chestConfigs.map((config) => [config.chestId, config]))
    const configuredActiveChests = activeChests.map((chest: { id: number; ownerId: number; effect: ChestEffect; rngSeed?: string }) => ({
      ...chest,
      targetUserId: chestConfigMap.get(chest.id)?.targetUserId ?? null,
    }))

    const setupParticipants = participants.map((participant) => {
      const user = (users as UserWithActiveShields[]).find((candidate) => candidate.id === participant.userId)
      const immortal = user ? isImmortalDuck({ name: user.name, shields: user.shields }) : false
      return {
        ...participant,
        name: user?.name ?? `User ${participant.userId}`,
        useShield: immortal ? true : participant.useShield,
        availableShields: user?.ownedShields.length ?? 0,
        isImmortal: immortal,
      }
    })

    const bossExpanded = expandBossParticipants(setupParticipants, users)
    const preRace = await applyChestPreRace(prisma, bossExpanded, configuredActiveChests)

    // CURSE_SWAP / IDENTITY_THEFT có thể làm 2 entry cùng displayName → race-worker
    // map theo tên sẽ đụng nhau. Append " (2)", " (3)"... cho các duplicate.
    const displayNameCounts = new Map<string, number>()
    for (const participant of preRace.participants) {
      const baseName = participant.displayName ?? participant.name
      const seen = displayNameCounts.get(baseName) ?? 0
      if (seen > 0) {
        participant.displayName = `${baseName} (${seen + 1})`
      } else {
        participant.displayName = baseName
      }
      displayNameCounts.set(baseName, seen + 1)
    }

    const race = await prisma.race.create({
      data: {
        status: 'pending',
        isTest: isTestMode,
        participants: {
          create: preRace.participants.map((participant) => ({
            userId: participant.userId,
            usedShield: participant.useShield,
            isClone: participant.isClone ?? false,
            cloneOfUserId: participant.cloneOfUserId ?? null,
            cloneIndex: participant.cloneIndex ?? null,
            displayName: participant.displayName ?? participant.name,
            chestEffect: participant.chestEffect ?? null,
            chestTargetUserId: participant.chestTargetUserId ?? null,
          })),
        },
      },
      include: {
        participants: true,
      },
    })

    let playerInputs: WorkerPlayerInput[] = preRace.participants.map((participant) => ({
      name: participant.displayName ?? participant.name,
      displayName: participant.displayName ?? participant.name,
      useShield: participant.useShield,
      shieldId: participant.shieldId,
      userId: participant.userId,
      isImmortal: participant.isImmortal ?? false,
      isClone: participant.isClone ?? false,
      cloneOfUserId: participant.cloneOfUserId ?? null,
      cloneIndex: participant.cloneIndex ?? null,
      chestEffect: participant.chestEffect ?? null,
      chestTargetUserId: participant.chestTargetUserId ?? null,
      borrowedShieldFromUserId: participant.borrowedShieldFromUserId ?? null,
    }))

    playerInputs = playerInputs.sort(() => Math.random() - 0.5)

    executeRace(race.id, playerInputs, configuredActiveChests, preRace.borrowedShieldIds, preRace.modifiers).catch((error: unknown) => {
      console.error('Race execution failed:', error)
    })

    return NextResponse.json({
      raceId: race.id,
      status: 'pending',
      message: 'Cuộc đua đã được khởi tạo! Đang chuẩn bị...',
    })
  } catch (error) {
    console.error('Failed to start race:', error)
    return NextResponse.json({ error: 'Failed to start race' }, { status: 500 })
  }
}

async function executeRace(
  raceId: number,
  playerInputs: WorkerPlayerInput[],
  activeChests: Array<{ id: number; ownerId: number; effect: ChestEffect; targetUserId?: number | null; rngSeed?: string }>,
  borrowedShieldIds: number[],
  itemModifiers: ItemRaceModifiers
) {
  try {
    await prisma.race.update({
      where: { id: raceId },
      data: { status: 'running' },
    })

    const riskyShields = await prisma.shield.findMany({
      where: {
        ownerId: { in: Array.from(new Set(playerInputs.map((player) => player.userId))) },
        status: 'active',
        charges: { lte: 2 },
      },
      include: {
        owner: {
          select: {
            name: true,
          },
        },
      },
      orderBy: [{ charges: 'asc' }, { earnedAt: 'asc' }],
      take: 4,
    })

    const commentaryContext: RaceMetaContext = {
      boss: (() => {
        const bossOwner = playerInputs.find((player) => !player.isClone && player.cloneIndex == null && playerInputs.some((candidate) => candidate.cloneOfUserId === player.userId))
        if (!bossOwner) {
          return null
        }
        return {
          name: bossOwner.name,
          cloneCount: playerInputs.filter((player) => player.cloneOfUserId === bossOwner.userId).length,
        }
      })(),
      underdogs: activeChests.map((chest) => ({
        name: playerInputs.find((player) => player.userId === chest.ownerId && !player.isClone)?.name ?? `User ${chest.ownerId}`,
        chest: chest.effect,
        target: typeof chest.targetUserId === 'number'
          ? playerInputs.find((player) => player.userId === chest.targetUserId && !player.isClone)?.name ?? null
          : null,
      })),
      shieldsAtRisk: riskyShields.map((shield: { owner: { name: string }; charges: number }) => ({
        owner: shield.owner.name,
        charges: shield.charges,
      })),
      curseSwaps: playerInputs
        .filter((player) => !player.isClone && player.chestEffect === 'CURSE_SWAP' && player.displayName !== player.name)
        .map((player) => ({
          owner: player.name,
          displayName: player.displayName,
        })),
    }

    const result = await runRaceWorker(
      playerInputs.map((player) => ({
        name: player.displayName,
        useShield: player.useShield,
      })),
      raceId,
      commentaryContext
    )

    console.log(`Race ${raceId}: ${result.commentaryJobsQueued} commentary jobs queued`)

    const playersByName = new Map<string, WorkerPlayerInput[]>()
    for (const player of playerInputs) {
      const queue = playersByName.get(player.displayName) ?? []
      queue.push(player)
      playersByName.set(player.displayName, queue)
    }

    let raceResults = result.rawRanking.map((entry) => {
      const queue = playersByName.get(entry.name) ?? []
      const matched = queue.shift()
      return {
        name: entry.name,
        userId: matched?.userId ?? 0,
        initialRank: entry.rank,
        usedShield: matched?.useShield ?? false,
        isImmortal: matched?.isImmortal ?? false,
        isClone: matched?.isClone ?? false,
        cloneOfUserId: matched?.cloneOfUserId ?? null,
        cloneIndex: matched?.cloneIndex ?? null,
        chestEffect: matched?.chestEffect ?? null,
        chestTargetUserId: matched?.chestTargetUserId ?? null,
        borrowedShieldFromUserId: matched?.borrowedShieldFromUserId ?? null,
      }
    })

    if (itemModifiers.reverseResults) {
      const totalRankedEntries = raceResults.length
      raceResults = raceResults.map((entry) => ({
        ...entry,
        initialRank: totalRankedEntries + 1 - entry.initialRank,
      }))
    }

    const thomasEntry = itemModifiers.cantPassThomas
      ? raceResults.find((entry) => entry.isImmortal && !entry.isClone)
      : null
    const cantPassThomasVictims = thomasEntry
      ? raceResults.filter((entry) => entry.initialRank < thomasEntry.initialRank && !entry.isImmortal)
      : []

    const penalties = calculatePenalties(raceResults, {
      penaltiesNeeded: itemModifiers.morePeopleMoreFun ?? 2,
      forcedVictims: cantPassThomasVictims,
    })
    const shieldActivatedEntries = penalties.safeByShield
    const didActivateShield = (entry: { userId: number; cloneIndex?: number | null }) =>
      shieldActivatedEntries.some(
        (safe) => safe.userId === entry.userId && (safe.cloneIndex ?? null) === (entry.cloneIndex ?? null)
      )
    const activatedShieldUserIds = dedupeVictimUserIds(shieldActivatedEntries)
    const race = await prisma.race.findUnique({ where: { id: raceId } })
    const isTest = race?.isTest ?? false
    const bossUsers = await prisma.user.findMany({
      where: { isBoss: true, id: { in: Array.from(new Set(playerInputs.map((player) => player.userId))) } },
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const transactionSummary = await prisma.$transaction(async (tx: any) => {
      const bossRewardInputs: BossRewardInput[] = []
      let newChestsForThisRace: Array<{ ownerId: number; effect: ChestEffect }> = []
      const chestDisabledPostRace = {
        modifiedVictims: penalties.victims.map((victim) => ({
          name: victim.name,
          userId: victim.userId,
          initialRank: victim.initialRank,
          isClone: victim.isClone ?? false,
          cloneOfUserId: victim.cloneOfUserId ?? undefined,
        })),
        shieldsToGrant: [],
        outcomes: [],
        newChestsForThisRace: [],
      }

      // Test race: vẫn roll & display chest awarded để show preview, nhưng forceVoid=true
      // → chest tạo ra mang status='void', KHÔNG cộng asset thật, không thể consume race sau.
      // Đồng thời KHÔNG truyền activeChests vào (để không "consume" chest thật của user).
      const postRace = !MYSTERY_CHESTS_ENABLED
        ? chestDisabledPostRace
        : isTest
        ? await resolveChestPostRace(
            tx,
            raceId,
            raceResults.map((entry) => ({
              name: entry.name,
              userId: entry.userId,
              rank: entry.initialRank,
              isClone: entry.isClone,
              cloneOfUserId: entry.cloneOfUserId,
              cloneIndex: entry.cloneIndex,
              isImmortal: entry.isImmortal,
            })),
            penalties.victims.map((victim) => ({
              name: victim.name,
              userId: victim.userId,
              initialRank: victim.initialRank,
              isClone: victim.isClone ?? false,
              cloneOfUserId: victim.cloneOfUserId ?? undefined,
            })),
            [],
            { forceVoid: true }
          )
        : await resolveChestPostRace(
            tx,
            raceId,
            raceResults.map((entry) => ({
              name: entry.name,
              userId: entry.userId,
              rank: entry.initialRank,
              isClone: entry.isClone,
              cloneOfUserId: entry.cloneOfUserId,
              cloneIndex: entry.cloneIndex,
              isImmortal: entry.isImmortal,
            })),
            penalties.victims.map((victim) => ({
              name: victim.name,
              userId: victim.userId,
              initialRank: victim.initialRank,
              isClone: victim.isClone ?? false,
              cloneOfUserId: victim.cloneOfUserId ?? undefined,
            })),
            activeChests
          )

      const finalVictimUserIds = dedupeVictimUserIds(postRace.modifiedVictims)
      const finalVerdict = buildPenaltyVerdict(postRace.modifiedVictims.map((victim) => ({
        name: victim.name ?? raceResults.find((entry) => (entry.cloneOfUserId ?? entry.userId) === (victim.cloneOfUserId ?? victim.userId))?.name ?? `User ${victim.cloneOfUserId ?? victim.userId}`,
      })))

      for (const resultEntry of raceResults) {
        const effectiveUserId = resultEntry.cloneOfUserId ?? resultEntry.userId
        const isVictim = finalVictimUserIds.includes(effectiveUserId)
        const shieldActivated = didActivateShield(resultEntry)

        await tx.raceParticipant.updateMany({
          where: {
            raceId,
            userId: resultEntry.userId,
            cloneIndex: resultEntry.cloneIndex ?? null,
          },
          data: {
            initialRank: resultEntry.initialRank,
            gotScar: isVictim,
            usedShield: shieldActivated,
          },
        })
      }

      for (const participantUserId of Array.from(new Set(playerInputs.map((player) => player.userId)))) {
        const bossUser = bossUsers.find((boss: { id: number }) => boss.id === participantUserId)
        if (bossUser) {
          const bossOutcome = resolveBossOutcome({
            bossUserId: participantUserId,
            raceVictims: postRace.modifiedVictims.map((victim) => ({
              userId: victim.userId,
              isClone: victim.isClone ?? false,
              cloneOfUserId: victim.cloneOfUserId ?? null,
            })),
          })

          if (bossOutcome.bossLost) {
            bossRewardInputs.push({
              ownerId: participantUserId,
              bossStreak: Math.max(bossUser.cleanStreak, 3),
            })
          }
        }
      }

      if (!isTest) {
        for (const participantUserId of Array.from(new Set(playerInputs.map((player) => player.userId)))) {
          const user = await tx.user.findUnique({ where: { id: participantUserId } })
          if (!user) {
            continue
          }

          // PUBLIC_SHIELD: owner mượn khiên của target → KHÔNG tiêu khiên của owner
          // (khiên target đã được consume riêng ở borrowedShieldIds loop bên dưới).
          const ownerEntry = playerInputs.find(
            (player) => player.userId === participantUserId && !player.isClone
          )
          const borrowedFromOther = !!ownerEntry?.borrowedShieldFromUserId

          const ownConsumed = activatedShieldUserIds.includes(participantUserId) && !borrowedFromOther
          const gotScarThisRace = finalVictimUserIds.includes(participantUserId)

          const isImmortal = isImmortalDuck({ name: user.name, shields: user.shields })

          if (ownConsumed && !isImmortal) {
            const declaredShieldId = playerInputs.find((player) => player.userId === participantUserId && !player.isClone)?.shieldId
            await consumeShield(tx, participantUserId, declaredShieldId)
          }

          const bossOutcome = bossUsers.some((boss: { id: number }) => boss.id === participantUserId)
            ? resolveBossOutcome({
                bossUserId: participantUserId,
                raceVictims: postRace.modifiedVictims.map((victim) => ({
                  userId: victim.userId,
                  isClone: victim.isClone ?? false,
                  cloneOfUserId: victim.cloneOfUserId ?? null,
                })),
              })
            : { bossLost: false }

          const shouldCountScar = gotScarThisRace || bossOutcome.bossLost
          const bossStatus = evaluateBossStatus({
            name: user.name,
            shields: user.shields,
            userId: participantUserId,
            gotScarThisRace: shouldCountScar,
            currentCleanStreak: user.cleanStreak,
            currentIsBoss: user.isBoss,
          })

          await tx.user.update({
            where: { id: participantUserId },
            data: {
              scars: shouldCountScar ? { increment: 1 } : undefined,
              shieldsUsed: ownConsumed && !isImmortal ? { increment: 1 } : undefined,
              totalKhaos: shouldCountScar ? { increment: 1 } : undefined,
              cleanStreak: bossStatus.newCleanStreak,
              isBoss: bossStatus.newIsBoss,
              bossSince: bossStatus.newIsBoss && !user.isBoss ? new Date() : bossStatus.newIsBoss ? user.bossSince : null,
            },
          })

          // INVARIANT enforce: user vừa promote Boss → void mọi chest active họ đang giữ.
          if (bossStatus.newIsBoss && !user.isBoss) {
            const lingeringChests = await tx.mysteryChest.findMany({
              where: { ownerId: participantUserId, status: 'active' },
            })
            if (lingeringChests.length > 0) {
              console.error(
                `[INVARIANT VIOLATION] Promote Boss user ${participantUserId} đang giữ ${lingeringChests.length} chest active → auto-void.`
              )
              await tx.mysteryChest.updateMany({
                where: { ownerId: participantUserId, status: 'active' },
                data: { status: 'voided', consumedAt: new Date() },
              })
            }
          }
        }

        for (const shieldId of borrowedShieldIds) {
          const shield = await tx.shield.update({
            where: { id: shieldId },
            data: {
              charges: 0,
              weeksUnused: 3,
              status: 'used',
              consumedAt: new Date(),
            },
          })
          // PUBLIC_SHIELD: target mất khiên thật → tăng counter của target, không phải của owner.
          await tx.user.update({
            where: { id: shield.ownerId },
            data: { shieldsUsed: { increment: 1 } },
          })
        }

        if (itemModifiers.safeWeek) {
          await tickShieldDecay(tx, { skipDecayReason: 'SAFE_WEEK' })
        } else {
          await tickShieldDecay(tx)
        }

        newChestsForThisRace = await issueBossRewardChests(tx, raceId, bossRewardInputs)

        const usersAfterRace = await tx.user.findMany({
          where: {
            id: {
              in: Array.from(new Set(
                playerInputs
                  .map((player) => player.userId)
                  .concat(bossRewardInputs.map((reward) => reward.ownerId))
              )),
            },
          },
        })

        for (const user of usersAfterRace) {
          await craftShieldIfEligible(tx, user.id, raceId)
        }

        await tx.mysteryChest.updateMany({
          where: {
            id: { in: activeChests.map((chest) => chest.id) },
          },
          data: {
            status: 'consumed',
            consumedRaceId: raceId,
            consumedAt: new Date(),
          },
        })

        for (const chest of activeChests) {
          await tx.mysteryChest.update({
            where: { id: chest.id },
            data: {
              targetUserId: chest.targetUserId ?? null,
            },
          })
        }

        await syncShieldCounters(
          tx,
          playerInputs
            .map((player) => player.userId)
            .concat(
              activeChests
                .map((chest) => chest.targetUserId)
                .filter((userId): userId is number => typeof userId === 'number')
            )
            .concat(bossRewardInputs.map((reward) => reward.ownerId))
        )
      }

      if (isTest) {
        newChestsForThisRace = await issueBossRewardChests(tx, raceId, bossRewardInputs, { forceVoid: true })
      }

      await tx.race.update({
        where: { id: raceId },
        data: {
          status: 'finished',
          videoUrl: result.videoUrl,
          finalVerdict,
          finishedAt: new Date(),
        },
      })

      return {
        finalVictimUserIds,
        finalVerdict,
        newChestsForThisRace,
      }
    })

    const finalVictimUserIds = transactionSummary.finalVictimUserIds
    const finalVerdict = transactionSummary.finalVerdict
    const winner = raceResults.find((entry) => entry.initialRank === 1)
    const chestsAwarded = transactionSummary.newChestsForThisRace
    const chestAwardOwnerIds = Array.from(new Set(chestsAwarded.map((chest: { ownerId: number }) => chest.ownerId)))
    const [winnerDetails, victimDetails, chestOwnerDetails] = await Promise.all([
      winner ? prisma.user.findUnique({ where: { id: winner.userId } }) : Promise.resolve(null),
      prisma.user.findMany({ where: { id: { in: finalVictimUserIds } } }),
      chestAwardOwnerIds.length > 0 ? prisma.user.findMany({ where: { id: { in: chestAwardOwnerIds } } }) : Promise.resolve([]),
    ])

    raceEventBus.emit(RACE_EVENTS.FINISHED, {
      raceId,
      winner: winnerDetails ? { name: winnerDetails.name, avatarUrl: winnerDetails.avatarUrl } : null,
      victims: (victimDetails as RaceEventUser[]).map((victim) => ({ name: victim.name, avatarUrl: victim.avatarUrl })),
      verdict: finalVerdict,
      chestsConsumed: activeChests.map((chest) => ({
        ownerId: chest.ownerId,
        effect: chest.effect,
        targetUserId: chest.targetUserId ?? null,
      })),
      chestsAwarded: chestsAwarded.map((chest: { ownerId: number; effect: ChestEffect }) => ({
        ownerName: (chestOwnerDetails as RaceEventUser[]).find((owner) => owner.id === chest.ownerId)?.name ?? `User ${chest.ownerId}`,
        effect: chest.effect,
      })),
    })

    console.log(`Race ${raceId} completed! ${finalVerdict}`)
  } catch (error) {
    console.error(`Race ${raceId} failed:`, error)
    await prisma.race.update({
      where: { id: raceId },
      data: { status: 'failed' },
    })
  }
}
