import type { RaceEvent } from '@/packages/race-protocol/src'

export type AttackWeapon =
  | 'HOMING_ROCKET'
  | 'MINI_ROCKET'
  | 'BANANA'
  | 'WILD_BANANA'
  | 'QUACK_HORN'
  | 'WILD_HORN'

export type DefenseType =
  | 'BUBBLE_SHIELD'
  | 'MINI_BUBBLE'
  | 'FEATHER'
  | 'WILD_FEATHER'
  | 'IMMUNITY'
  | 'SHOCK_ABSORBER'
  | 'EXPIRED'
  | 'NONE'

export interface CombatPlayerRef {
  playerId: string
  name: string
  avatarUrl?: string | null
}

export interface CombatEncounter {
  id: string
  tick: number
  timestampMs: number
  timeFormatted: string
  attackerId: string
  attackerName: string
  attackerAvatarUrl?: string | null
  targetId: string
  targetName: string
  targetAvatarUrl?: string | null
  weapon: AttackWeapon
  weaponName: string
  weaponIcon: string
  success: boolean
  defense: DefenseType
  defenseName?: string
  defenseIcon?: string
  resultTitle: string
  resultDetail: string
  mitigatedByShockAbsorber?: boolean
}

export interface PlayerCombatSummary {
  playerId: string
  name: string
  avatarUrl?: string | null
  attacksDealt: number
  attacksHit: number
  attacksBlockedByTarget: number
  attacksReceived: number
  attacksDefended: number
  attacksSuffered: number
  hitRate: number
  defenseRate: number
  favoriteTarget?: { playerId: string; name: string; count: number } | null
  nemesisAttacker?: { playerId: string; name: string; count: number } | null
}

export interface CombatAnalytics {
  encounters: CombatEncounter[]
  totalAttacks: number
  successfulHits: number
  defendedAttacks: number
  overallHitRate: number
  playerSummaries: PlayerCombatSummary[]
  topAttacker: { playerId: string; name: string; hits: number } | null
  bestDefender: { playerId: string; name: string; defenses: number } | null
  mostTargeted: { playerId: string; name: string; incoming: number } | null
}

function formatRaceTime(ms: number): string {
  const totalSeconds = ms / 1000
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${seconds.toFixed(1).padStart(4, '0')}`
}

export function extractCombatEncounters(
  events: RaceEvent[],
  players: CombatPlayerRef[]
): CombatAnalytics {
  const playerMap = new Map(players.map((p) => [p.playerId, p]))
  const encounters: CombatEncounter[] = []
  const seenEncounterKeys = new Set<string>()

  // Pre-index shock absorber mitigations by tick and player
  const shockAbsorberTicks = new Set<string>()
  for (const event of events) {
    if (event.type === 'SHOCK_ABSORBER_PROC') {
      const defenderId = event.sourcePlayerId ?? event.targetPlayerId
      if (defenderId) {
        shockAbsorberTicks.add(`${event.tick}:${defenderId}`)
      }
    }
  }

  for (const event of events) {
    const timestampMs = event.timestampWithinRaceMs ?? 0
    const timeFormatted = formatRaceTime(timestampMs)

    // 1. ROCKET & MINI ROCKET HIT
    if (event.type === 'ROCKET_HIT' || event.type === 'MINI_ROCKET_HIT') {
      const isMini = event.type === 'MINI_ROCKET_HIT'
      const attackerId = event.sourcePlayerId ?? 'unknown'
      const targetId = event.targetPlayerId ?? 'unknown'
      const key = `${event.tick}:${attackerId}:${targetId}:${isMini ? 'MINI_ROCKET' : 'HOMING_ROCKET'}`
      if (seenEncounterKeys.has(key)) continue
      seenEncounterKeys.add(key)

      const attacker = playerMap.get(attackerId)
      const target = playerMap.get(targetId)
      const attackerName = attacker?.name ?? attackerId
      const targetName = target?.name ?? targetId
      const isMitigated = shockAbsorberTicks.has(`${event.tick}:${targetId}`)

      encounters.push({
        id: `combat-${encounters.length + 1}-${event.tick}`,
        tick: event.tick,
        timestampMs,
        timeFormatted,
        attackerId,
        attackerName,
        attackerAvatarUrl: attacker?.avatarUrl,
        targetId,
        targetName,
        targetAvatarUrl: target?.avatarUrl,
        weapon: isMini ? 'MINI_ROCKET' : 'HOMING_ROCKET',
        weaponName: isMini ? 'Mini Rocket' : 'Tên Lửa Tầm Nhiệt',
        weaponIcon: '🚀',
        success: true,
        defense: isMitigated ? 'SHOCK_ABSORBER' : 'NONE',
        defenseName: isMitigated ? 'Áo Chống Sốc' : undefined,
        defenseIcon: isMitigated ? '🦺' : undefined,
        mitigatedByShockAbsorber: isMitigated,
        resultTitle: isMitigated ? 'Trúng đích (Giảm sát thương) 🦺' : 'Trúng đích! 💥',
        resultDetail: isMitigated
          ? `Bắn trúng ${targetName}! Áo Chống Sốc (Shock Absorber 🦺) của ${targetName} hấp thụ giảm 40% lực hãm.`
          : isMini
            ? `Bắn trúng ${targetName}! Hãm tốc độ còn 10% trong 3.6 giây.`
            : `Bắn trúng ${targetName}! Hãm 35% tốc độ trong 0.65 giây.`,
      })
    }

    // 2. ROCKET & MINI ROCKET BLOCKED
    if (event.type === 'ROCKET_BLOCKED' || event.type === 'MINI_ROCKET_BLOCKED') {
      const isMini = event.type === 'MINI_ROCKET_BLOCKED'
      const attackerId = event.sourcePlayerId ?? 'unknown'
      const targetId = event.targetPlayerId ?? 'unknown'
      const key = `${event.tick}:${attackerId}:${targetId}:${isMini ? 'MINI_ROCKET' : 'HOMING_ROCKET'}`
      if (seenEncounterKeys.has(key)) continue
      seenEncounterKeys.add(key)

      const attacker = playerMap.get(attackerId)
      const target = playerMap.get(targetId)
      const attackerName = attacker?.name ?? attackerId
      const targetName = target?.name ?? targetId
      const rawDefense = String(event.metadata.defense ?? 'BUBBLE_SHIELD')

      let defense: DefenseType = 'BUBBLE_SHIELD'
      let defenseName = 'Khiên Bong Bóng'
      let defenseIcon = '🫧'
      let resultDetail = `Thất bại — ${targetName} dùng Khiên Bong Bóng (Bubble Shield 🫧) chặn đứng tên lửa!`

      if (rawDefense === 'MINI_BUBBLE') {
        defense = 'MINI_BUBBLE'
        defenseName = 'Mini Bubble'
        defenseIcon = '🫧'
        resultDetail = `Thất bại — ${targetName} dùng Mini Bubble 🫧 chặn đứng tên lửa!`
      } else if (rawDefense === 'IMMUNITY') {
        defense = 'IMMUNITY'
        defenseName = 'Miễn Nhiễm Đòn'
        defenseIcon = '🛡️'
        resultDetail = `Thất bại — ${targetName} đang trong thời gian Miễn nhiễm đòn đánh (Immunity 🛡️)!`
      }

      encounters.push({
        id: `combat-${encounters.length + 1}-${event.tick}`,
        tick: event.tick,
        timestampMs,
        timeFormatted,
        attackerId,
        attackerName,
        attackerAvatarUrl: attacker?.avatarUrl,
        targetId,
        targetName,
        targetAvatarUrl: target?.avatarUrl,
        weapon: isMini ? 'MINI_ROCKET' : 'HOMING_ROCKET',
        weaponName: isMini ? 'Mini Rocket' : 'Tên Lửa Tầm Nhiệt',
        weaponIcon: '🚀',
        success: false,
        defense,
        defenseName,
        defenseIcon,
        resultTitle: 'Bị chặn đứng! 🫧',
        resultDetail,
      })
    }

    // 3. ROCKET EXPIRED
    if (event.type === 'ROCKET_EXPIRED' || event.type === 'MINI_ROCKET_EXPIRED') {
      const isMini = event.type === 'MINI_ROCKET_EXPIRED'
      const attackerId = event.sourcePlayerId ?? 'unknown'
      const targetId = event.targetPlayerId ?? 'unknown'
      if (targetId && targetId !== 'unknown') {
        const key = `${event.tick}:${attackerId}:${targetId}:${isMini ? 'MINI_ROCKET' : 'HOMING_ROCKET'}`
        if (!seenEncounterKeys.has(key)) {
          seenEncounterKeys.add(key)
          const attacker = playerMap.get(attackerId)
          const target = playerMap.get(targetId)
          const targetName = target?.name ?? targetId

          encounters.push({
            id: `combat-${encounters.length + 1}-${event.tick}`,
            tick: event.tick,
            timestampMs,
            timeFormatted,
            attackerId,
            attackerName: attacker?.name ?? attackerId,
            attackerAvatarUrl: attacker?.avatarUrl,
            targetId,
            targetName,
            targetAvatarUrl: target?.avatarUrl,
            weapon: isMini ? 'MINI_ROCKET' : 'HOMING_ROCKET',
            weaponName: isMini ? 'Mini Rocket' : 'Tên Lửa Tầm Nhiệt',
            weaponIcon: '🚀',
            success: false,
            defense: 'EXPIRED',
            defenseName: 'Hết Tầm / Cán Đích',
            defenseIcon: '⏱️',
            resultTitle: 'Hụt mục tiêu! ⏱️',
            resultDetail: `Thất bại — Tên lửa bay hết tầm hoặc mục tiêu ${targetName} đã cán đích an toàn.`,
          })
        }
      }
    }

    // 4. BANANA & WILD BANANA HIT
    if (event.type === 'BANANA_HIT' || event.type === 'WILD_BANANA_HIT') {
      const isWild = event.type === 'WILD_BANANA_HIT'
      const attackerId = event.sourcePlayerId ?? 'unknown'
      const targetId = event.targetPlayerId ?? 'unknown'
      const key = `${event.tick}:${attackerId}:${targetId}:${isWild ? 'WILD_BANANA' : 'BANANA'}`
      if (seenEncounterKeys.has(key)) continue
      seenEncounterKeys.add(key)

      const attacker = playerMap.get(attackerId)
      const target = playerMap.get(targetId)
      const attackerName = attacker?.name ?? attackerId
      const targetName = target?.name ?? targetId

      encounters.push({
        id: `combat-${encounters.length + 1}-${event.tick}`,
        tick: event.tick,
        timestampMs,
        timeFormatted,
        attackerId,
        attackerName,
        attackerAvatarUrl: attacker?.avatarUrl,
        targetId,
        targetName,
        targetAvatarUrl: target?.avatarUrl,
        weapon: isWild ? 'WILD_BANANA' : 'BANANA',
        weaponName: isWild ? 'Wild Banana' : 'Vỏ Chuối Bẫy',
        weaponIcon: '🍌',
        success: true,
        defense: 'NONE',
        resultTitle: 'Trúng bẫy chuối! 🍌',
        resultDetail: `${targetName} đạp phải vỏ chuối của ${attackerName}, bị trượt xoay mòng mòng và giật lùi quãng đường!`,
      })
    }

    // 5. BANANA & WILD BANANA BLOCKED / DODGED
    if (event.type === 'BANANA_BLOCKED' || event.type === 'WILD_BANANA_BLOCKED') {
      const isWild = event.type === 'WILD_BANANA_BLOCKED'
      const attackerId = event.sourcePlayerId ?? 'unknown'
      const targetId = event.targetPlayerId ?? 'unknown'
      const key = `${event.tick}:${attackerId}:${targetId}:${isWild ? 'WILD_BANANA' : 'BANANA'}`
      if (seenEncounterKeys.has(key)) continue
      seenEncounterKeys.add(key)

      const attacker = playerMap.get(attackerId)
      const target = playerMap.get(targetId)
      const targetName = target?.name ?? targetId
      const rawDefense = String(event.metadata.defense ?? 'FEATHER')

      let defense: DefenseType = 'FEATHER'
      let defenseName = 'Lông Vũ Né Đòn'
      let defenseIcon = '🪽'
      let resultTitle = 'Né đòn ngoạn mục! 🪽'
      let resultDetail = `Thất bại — ${targetName} dùng Lông Vũ (Feather 🪽) lướt né trọn vẹn bẫy chuối!`

      if (rawDefense === 'WILD_FEATHER') {
        defense = 'WILD_FEATHER'
        defenseName = 'Wild Feather'
        defenseIcon = '🪽'
        resultTitle = 'Né đòn ngoạn mục! 🪽'
        resultDetail = `Thất bại — ${targetName} dùng Wild Feather 🪽 lướt né trọn vẹn bẫy chuối!`
      } else if (rawDefense === 'BUBBLE_SHIELD') {
        defense = 'BUBBLE_SHIELD'
        defenseName = 'Khiên Bong Bóng'
        defenseIcon = '🫧'
        resultTitle = 'Bị chặn đứng! 🫧'
        resultDetail = `Thất bại — ${targetName} có Khiên Bong Bóng (Bubble Shield 🫧) đỡ văng vỏ chuối!`
      } else if (rawDefense === 'MINI_BUBBLE') {
        defense = 'MINI_BUBBLE'
        defenseName = 'Mini Bubble'
        defenseIcon = '🫧'
        resultTitle = 'Bị chặn đứng! 🫧'
        resultDetail = `Thất bại — ${targetName} có Mini Bubble 🫧 đỡ văng vỏ chuối!`
      } else if (rawDefense === 'IMMUNITY') {
        defense = 'IMMUNITY'
        defenseName = 'Miễn Nhiễm Đòn'
        defenseIcon = '🛡️'
        resultTitle = 'Bị vô hiệu! 🛡️'
        resultDetail = `Thất bại — ${targetName} đang có hiệu ứng Miễn nhiễm đòn đánh 🛡️!`
      }

      encounters.push({
        id: `combat-${encounters.length + 1}-${event.tick}`,
        tick: event.tick,
        timestampMs,
        timeFormatted,
        attackerId,
        attackerName: attacker?.name ?? attackerId,
        attackerAvatarUrl: attacker?.avatarUrl,
        targetId,
        targetName,
        targetAvatarUrl: target?.avatarUrl,
        weapon: isWild ? 'WILD_BANANA' : 'BANANA',
        weaponName: isWild ? 'Wild Banana' : 'Vỏ Chuối Bẫy',
        weaponIcon: '🍌',
        success: false,
        defense,
        defenseName,
        defenseIcon,
        resultTitle,
        resultDetail,
      })
    }

    // 6. QUACK HORN & WILD HORN EMP
    if (event.type === 'HORN_USED' || event.type === 'WILD_HORN_USED') {
      const isWild = event.type === 'WILD_HORN_USED'
      const attackerId = event.sourcePlayerId ?? 'unknown'
      const attacker = playerMap.get(attackerId)
      const attackerName = attacker?.name ?? attackerId
      const targets = Array.isArray(event.metadata.targets) ? event.metadata.targets.map(String) : []

      for (const targetId of targets) {
        if (!targetId || targetId === attackerId) continue
        const key = `${event.tick}:${attackerId}:${targetId}:${isWild ? 'WILD_HORN' : 'QUACK_HORN'}`
        if (seenEncounterKeys.has(key)) continue
        seenEncounterKeys.add(key)

        const target = playerMap.get(targetId)
        const targetName = target?.name ?? targetId

        encounters.push({
          id: `combat-${encounters.length + 1}-${event.tick}`,
          tick: event.tick,
          timestampMs,
          timeFormatted,
          attackerId,
          attackerName,
          attackerAvatarUrl: attacker?.avatarUrl,
          targetId,
          targetName,
          targetAvatarUrl: target?.avatarUrl,
          weapon: isWild ? 'WILD_HORN' : 'QUACK_HORN',
          weaponName: isWild ? 'Wild Horn' : 'Còi Quack Horn EMP',
          weaponIcon: '🔊',
          success: true,
          defense: 'NONE',
          resultTitle: 'Trúng sóng âm EMP! 🔊',
          resultDetail: `${attackerName} thổi còi Quack Horn làm Câm Lặng (Silenced 🔇) ${targetName}, khóa dùng item và đẩy dạt vị trí!`,
        })
      }
    }
  }

  // Sort encounters chronologically
  encounters.sort((a, b) => a.tick - b.tick)

  // Compute player-level combat summaries
  const summariesByPlayer = new Map<string, PlayerCombatSummary>()
  for (const player of players) {
    summariesByPlayer.set(player.playerId, {
      playerId: player.playerId,
      name: player.name,
      avatarUrl: player.avatarUrl,
      attacksDealt: 0,
      attacksHit: 0,
      attacksBlockedByTarget: 0,
      attacksReceived: 0,
      attacksDefended: 0,
      attacksSuffered: 0,
      hitRate: 0,
      defenseRate: 0,
      favoriteTarget: null,
      nemesisAttacker: null,
    })
  }

  const targetsCountByAttacker = new Map<string, Map<string, number>>()
  const attackersCountByTarget = new Map<string, Map<string, number>>()

  for (const enc of encounters) {
    // Attacker stats
    let attackerSum = summariesByPlayer.get(enc.attackerId)
    if (!attackerSum) {
      attackerSum = {
        playerId: enc.attackerId,
        name: enc.attackerName,
        avatarUrl: enc.attackerAvatarUrl,
        attacksDealt: 0,
        attacksHit: 0,
        attacksBlockedByTarget: 0,
        attacksReceived: 0,
        attacksDefended: 0,
        attacksSuffered: 0,
        hitRate: 0,
        defenseRate: 0,
        favoriteTarget: null,
        nemesisAttacker: null,
      }
      summariesByPlayer.set(enc.attackerId, attackerSum)
    }
    attackerSum.attacksDealt += 1
    if (enc.success) {
      attackerSum.attacksHit += 1
    } else {
      attackerSum.attacksBlockedByTarget += 1
    }

    if (!targetsCountByAttacker.has(enc.attackerId)) {
      targetsCountByAttacker.set(enc.attackerId, new Map())
    }
    const tMap = targetsCountByAttacker.get(enc.attackerId)!
    tMap.set(enc.targetId, (tMap.get(enc.targetId) ?? 0) + 1)

    // Target stats
    let targetSum = summariesByPlayer.get(enc.targetId)
    if (!targetSum) {
      targetSum = {
        playerId: enc.targetId,
        name: enc.targetName,
        avatarUrl: enc.targetAvatarUrl,
        attacksDealt: 0,
        attacksHit: 0,
        attacksBlockedByTarget: 0,
        attacksReceived: 0,
        attacksDefended: 0,
        attacksSuffered: 0,
        hitRate: 0,
        defenseRate: 0,
        favoriteTarget: null,
        nemesisAttacker: null,
      }
      summariesByPlayer.set(enc.targetId, targetSum)
    }
    targetSum.attacksReceived += 1
    if (enc.success) {
      targetSum.attacksSuffered += 1
    } else {
      targetSum.attacksDefended += 1
    }

    if (!attackersCountByTarget.has(enc.targetId)) {
      attackersCountByTarget.set(enc.targetId, new Map())
    }
    const aMap = attackersCountByTarget.get(enc.targetId)!
    aMap.set(enc.attackerId, (aMap.get(enc.attackerId) ?? 0) + 1)
  }

  // Finalize rates and favorites
  for (const [playerId, sum] of summariesByPlayer) {
    sum.hitRate = sum.attacksDealt > 0 ? Math.round((sum.attacksHit / sum.attacksDealt) * 100) : 0
    sum.defenseRate = sum.attacksReceived > 0 ? Math.round((sum.attacksDefended / sum.attacksReceived) * 100) : 0

    // Favorite target
    const tMap = targetsCountByAttacker.get(playerId)
    if (tMap && tMap.size > 0) {
      let maxCount = 0
      let favoriteId = ''
      for (const [tId, count] of tMap) {
        if (count > maxCount) {
          maxCount = count
          favoriteId = tId
        }
      }
      if (favoriteId) {
        sum.favoriteTarget = {
          playerId: favoriteId,
          name: playerMap.get(favoriteId)?.name ?? favoriteId,
          count: maxCount,
        }
      }
    }

    // Nemesis attacker
    const aMap = attackersCountByTarget.get(playerId)
    if (aMap && aMap.size > 0) {
      let maxCount = 0
      let nemesisId = ''
      for (const [aId, count] of aMap) {
        if (count > maxCount) {
          maxCount = count
          nemesisId = aId
        }
      }
      if (nemesisId) {
        sum.nemesisAttacker = {
          playerId: nemesisId,
          name: playerMap.get(nemesisId)?.name ?? nemesisId,
          count: maxCount,
        }
      }
    }
  }

  const playerSummaries = [...summariesByPlayer.values()].sort((a, b) => b.attacksDealt - a.attacksDealt)
  const totalAttacks = encounters.length
  const successfulHits = encounters.filter((e) => e.success).length
  const defendedAttacks = encounters.filter((e) => !e.success).length
  const overallHitRate = totalAttacks > 0 ? Math.round((successfulHits / totalAttacks) * 100) : 0

  const topAttackerPlayer = [...playerSummaries].sort((a, b) => b.attacksHit - a.attacksHit)[0]
  const bestDefenderPlayer = [...playerSummaries].sort((a, b) => b.attacksDefended - a.attacksDefended)[0]
  const mostTargetedPlayer = [...playerSummaries].sort((a, b) => b.attacksReceived - a.attacksReceived)[0]

  return {
    encounters,
    totalAttacks,
    successfulHits,
    defendedAttacks,
    overallHitRate,
    playerSummaries,
    topAttacker: topAttackerPlayer && topAttackerPlayer.attacksHit > 0
      ? { playerId: topAttackerPlayer.playerId, name: topAttackerPlayer.name, hits: topAttackerPlayer.attacksHit }
      : null,
    bestDefender: bestDefenderPlayer && bestDefenderPlayer.attacksDefended > 0
      ? { playerId: bestDefenderPlayer.playerId, name: bestDefenderPlayer.name, defenses: bestDefenderPlayer.attacksDefended }
      : null,
    mostTargeted: mostTargetedPlayer && mostTargetedPlayer.attacksReceived > 0
      ? { playerId: mostTargetedPlayer.playerId, name: mostTargetedPlayer.name, incoming: mostTargetedPlayer.attacksReceived }
      : null,
  }
}
