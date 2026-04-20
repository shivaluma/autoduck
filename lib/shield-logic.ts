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
  isClone?: boolean
  cloneOfUserId?: number | null
  cloneIndex?: number | null
}

export interface PenaltyResult {
  victims: { name: string; userId: number; initialRank: number; isClone?: boolean; cloneOfUserId?: number | null; cloneIndex?: number | null }[]
  safeByShield: { name: string; userId: number; initialRank: number; isClone?: boolean; cloneOfUserId?: number | null; cloneIndex?: number | null }[]
  finalVerdict: string
}

export function calculatePenalties(results: RaceResultInput[]): PenaltyResult {
  // Sắp xếp theo thứ hạng từ thấp đến cao (người về bét lên đầu)
  const sortedResults = [...results].sort((a, b) => b.initialRank - a.initialRank)
  
  const totalPlayers = sortedResults.length
  const victims: PenaltyResult['victims'] = []
  const safeByShield: PenaltyResult['safeByShield'] = []
  const penaltiesNeeded = 2

  // Phase 1: Duyệt từ dưới lên, tìm 2 người không dùng khiên
  for (let i = 0; i < totalPlayers && victims.length < penaltiesNeeded; i++) {
    const player = sortedResults[i]

    if (player.usedShield) {
      // Người này dùng khiên → An toàn, ghi nhận
      safeByShield.push({
        name: player.name,
        userId: player.userId,
        initialRank: player.initialRank,
        isClone: player.isClone,
        cloneOfUserId: player.cloneOfUserId,
        cloneIndex: player.cloneIndex,
      })
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
  }

  // Phase 2: Nếu không tìm đủ 2 người (gần như cả team dùng khiên)
  // → Phạt cả người dùng khiên từ dưới lên cho đủ
  if (victims.length < penaltiesNeeded) {
    for (let i = 0; i < totalPlayers && victims.length < penaltiesNeeded; i++) {
      const player = sortedResults[i]
      const alreadyVictim = victims.some(
        (v) => v.userId === player.userId && (v.cloneIndex ?? null) === (player.cloneIndex ?? null)
      )
      if (!alreadyVictim) {
        // Remove from safe list if they were there
        const safeIdx = safeByShield.findIndex(
          (s) => s.userId === player.userId && (s.cloneIndex ?? null) === (player.cloneIndex ?? null)
        )
        if (safeIdx !== -1) safeByShield.splice(safeIdx, 1)
        
        victims.push({
          name: player.name,
          userId: player.userId,
          initialRank: player.initialRank,
          isClone: player.isClone,
          cloneOfUserId: player.cloneOfUserId,
          cloneIndex: player.cloneIndex,
        })
      }
    }
  }

  // Tạo câu chốt hạ
  const victimNames = victims.map(v => v.name)
  const finalVerdict = victimNames.length === 2
    ? `${victimNames[0]} và ${victimNames[1]} là 2 con dzịt tuần này! 🦆`
    : victimNames.length === 1
    ? `${victimNames[0]} là con dzịt tuần này! 🦆`
    : 'Không ai bị phạt hôm nay!'

  return {
    victims,
    safeByShield,
    finalVerdict,
  }
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
