/**
 * AUTODUCK - Shield Logic Algorithm
 * 
 * "Luật rừng" (The Jungle Law):
 * - 2 người đứng cuối bảng bị phạt (+1 Sẹo)
 * - Nếu người cuối dùng Khiên → an toàn, phạt chuyển lên người tiếp theo không dùng khiên
 * - Quy tắc: 2 Sẹo tự động quy đổi thành 1 Khiên
 */

export interface RaceResultInput {
  name: string
  userId: number
  initialRank: number // 1 là cao nhất (về đích đầu), N là thấp nhất (về bét)
  usedShield: boolean
  isImmortal?: boolean
  isClone?: boolean
  cloneOfUserId?: number | null
  cloneIndex?: number | null
  chestEffect?: string | null
}

export interface PenaltyResult {
  victims: { name: string; userId: number; initialRank: number; isClone?: boolean; cloneOfUserId?: number | null; cloneIndex?: number | null }[]
  safeByShield: { name: string; userId: number; initialRank: number; isClone?: boolean; cloneOfUserId?: number | null; cloneIndex?: number | null }[]
  finalVerdict: string
}

interface PenaltyOptions {
  penaltiesNeeded?: number
  forcedVictims?: RaceResultInput[]
}

/**
 * IDENTITY_THEFT: owner spawn thêm 1 clone (cloneIndex=99). Theo spec lấy
 * min(rank gốc, rank clone) làm kết quả → drop entry tệ hơn trước khi xét phạt.
 * Boss clones (cloneIndex 1..3) KHÔNG dedupe — mỗi clone vẫn là risk độc lập.
 */
function applyIdentityTheftDedupe(results: RaceResultInput[]): RaceResultInput[] {
  const identityOwners = new Set(
    results
      .filter((entry) => entry.chestEffect === 'IDENTITY_THEFT' && !entry.isClone)
      .map((entry) => entry.userId)
  )

  if (identityOwners.size === 0) {
    return results
  }

  const filtered: RaceResultInput[] = []
  for (const ownerId of identityOwners) {
    const original = results.find((entry) => entry.userId === ownerId && !entry.isClone)
    const shadow = results.find(
      (entry) => entry.cloneOfUserId === ownerId && entry.cloneIndex === 99 && entry.isClone
    )
    if (original && shadow) {
      const winner = original.initialRank <= shadow.initialRank ? original : shadow
      filtered.push({ ...winner, isClone: false, cloneIndex: null, cloneOfUserId: null })
    } else if (original) {
      filtered.push(original)
    } else if (shadow) {
      filtered.push({ ...shadow, isClone: false, cloneIndex: null, cloneOfUserId: null })
    }
  }

  return results
    .filter((entry) => {
      if (identityOwners.has(entry.userId) && !entry.isClone) return false
      if (entry.isClone && entry.cloneIndex === 99 && entry.cloneOfUserId && identityOwners.has(entry.cloneOfUserId)) return false
      return true
    })
    .concat(filtered)
}

export function calculatePenalties(results: RaceResultInput[], options: PenaltyOptions = {}): PenaltyResult {
  const dedupedResults = applyIdentityTheftDedupe(results)
  // Sắp xếp theo thứ hạng từ thấp đến cao (người về bét lên đầu)
  const sortedResults = [...dedupedResults].sort((a, b) => b.initialRank - a.initialRank)

  const totalPlayers = sortedResults.length
  const victims: PenaltyResult['victims'] = []
  const safeByShield: PenaltyResult['safeByShield'] = []
  const penaltiesNeeded = Math.max(1, options.penaltiesNeeded ?? 2)
  const effectiveVictimOwnerIds = new Set<number>()
  const effectiveSafeOwnerIds = new Set<number>()

  const effectiveOwnerId = (player: RaceResultInput) => player.cloneOfUserId ?? player.userId

  // Phase 1: Duyệt từ dưới lên, tìm 2 người không dùng khiên
  for (let i = 0; i < totalPlayers && victims.length < penaltiesNeeded; i++) {
    const player = sortedResults[i]
    const ownerId = effectiveOwnerId(player)

    if (player.isImmortal) {
      continue
    }

    if (effectiveVictimOwnerIds.has(ownerId)) {
      continue
    }

    if (player.usedShield) {
      // Người này dùng khiên → An toàn, ghi nhận
      if (!effectiveSafeOwnerIds.has(ownerId)) {
        safeByShield.push({
          name: player.name,
          userId: player.userId,
          initialRank: player.initialRank,
          isClone: player.isClone,
          cloneOfUserId: player.cloneOfUserId,
          cloneIndex: player.cloneIndex,
        })
        effectiveSafeOwnerIds.add(ownerId)
      }
      continue
    }

    // Người này không dùng khiên → Nhận phạt
    victims.push({
      name: player.name,
      userId: player.userId,
      initialRank: player.initialRank,
      isClone: player.isClone,
      cloneOfUserId: player.cloneOfUserId,
      cloneIndex: player.cloneIndex,
    })
    effectiveVictimOwnerIds.add(ownerId)
  }

  // Phase 2: Nếu không tìm đủ 2 người (gần như cả team dùng khiên)
  // → Phạt cả người dùng khiên từ dưới lên cho đủ
  if (victims.length < penaltiesNeeded) {
    for (let i = 0; i < totalPlayers && victims.length < penaltiesNeeded; i++) {
      const player = sortedResults[i]
      const ownerId = effectiveOwnerId(player)
      if (player.isImmortal) {
        continue
      }
      const alreadyVictim = effectiveVictimOwnerIds.has(ownerId)
      if (!alreadyVictim) {
        // Remove from safe list if this owner had already been marked safe
        const safeIdx = safeByShield.findIndex(
          (s) => (s.cloneOfUserId ?? s.userId) === ownerId
        )
        if (safeIdx !== -1) safeByShield.splice(safeIdx, 1)
        effectiveSafeOwnerIds.delete(ownerId)
        
        victims.push({
          name: player.name,
          userId: player.userId,
          initialRank: player.initialRank,
          isClone: player.isClone,
          cloneOfUserId: player.cloneOfUserId,
          cloneIndex: player.cloneIndex,
        })
        effectiveVictimOwnerIds.add(ownerId)
      }
    }
  }

  for (const player of options.forcedVictims ?? []) {
    if (player.isImmortal) {
      continue
    }

    const ownerId = effectiveOwnerId(player)
    if (effectiveVictimOwnerIds.has(ownerId)) {
      continue
    }

    victims.push({
      name: player.name,
      userId: player.userId,
      initialRank: player.initialRank,
      isClone: player.isClone,
      cloneOfUserId: player.cloneOfUserId,
      cloneIndex: player.cloneIndex,
    })
    effectiveVictimOwnerIds.add(ownerId)
  }

  return {
    victims,
    safeByShield,
    finalVerdict: buildPenaltyVerdict(victims),
  }
}

export function buildPenaltyVerdict(victims: Array<{ name: string }>) {
  const victimNames = victims.map((victim) => victim.name)
  return victimNames.length > 2
    ? `${victimNames.slice(0, -1).join(', ')} và ${victimNames.at(-1)} là ${victimNames.length} con dzịt tuần này! 🦆`
    : victimNames.length === 2
      ? `${victimNames[0]} và ${victimNames[1]} là 2 con dzịt tuần này! 🦆`
      : victimNames.length === 1
        ? `${victimNames[0]} là con dzịt tuần này! 🦆`
        : 'Không ai bị phạt hôm nay!'
}

export function dedupeVictimUserIds(victims: Array<{ userId: number; cloneOfUserId?: number | null }>) {
  return Array.from(new Set(victims.map((victim) => victim.cloneOfUserId ?? victim.userId)))
}

export function applyChestEffectsToVictims<T extends { userId: number }>(
  victims: T[],
  additions: T[]
) {
  const deduped = [...victims]
  for (const addition of additions) {
    if (!deduped.some((victim) => victim.userId === addition.userId)) {
      deduped.push(addition)
    }
  }
  return deduped
}

/**
 * Tính lại Scars/Shields sau trận đua
 * Rule: 2 Scars = 1 Shield (auto-convert)
 */
export function calculateNewStats(
  currentScars: number,
  currentShields: number,
  gotScar: boolean,
  usedShield: boolean
) {
  let newScars = currentScars
  let newShields = currentShields

  // Dùng khiên → trừ 1 khiên
  if (usedShield) {
    newShields = Math.max(0, newShields - 1)
  }

  // Bị sẹo → +1 sẹo
  if (gotScar) {
    newScars += 1
  }

  // Auto-convert: 2 sẹo = 1 khiên
  while (newScars >= 2) {
    newScars -= 2
    newShields += 1
  }

  return { newScars, newShields }
}
