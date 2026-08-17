import { performance } from 'node:perf_hooks'
import { simulateRace } from '../packages/race-core/src'
import {
  DEFAULT_TRACK_VERSION,
  RACE_BALANCE_VERSION,
  RACE_ENGINE_VERSION,
  RACE_PROTOCOL_VERSION,
  RACE_TICK_RATE,
  type RaceConfig,
  type RaceItemId,
  type RaceLoadout,
} from '../packages/race-protocol/src'

const MAJORS = ['NITRO', 'BUBBLE_SHIELD', 'HOMING_ROCKET'] as const satisfies readonly RaceItemId[]
const MINORS = ['DRAFT_FIN', 'PADDLE_BURST', 'FEATHER', 'SHOCK_ABSORBER', 'BANANA', 'QUACK_HORN'] as const satisfies readonly RaceItemId[]
const FULL_LOADOUTS = MAJORS.flatMap((major) => MINORS.map((minor) => [major, minor] as const))

function seedFromIndex(index: number) {
  return index.toString(16).padStart(64, '0')
}

interface PlayerStats {
  playerId: string
  name: string
  slot: number
  races: number
  wins: number
  top3: number
  bottom2: number
  positionTotal: number
}

function emptyPlayerStats(slot: number): PlayerStats {
  return {
    playerId: `duck-${slot}`,
    name: `Duck ${slot}`,
    slot,
    races: 0,
    wins: 0,
    top3: 0,
    bottom2: 0,
    positionTotal: 0,
  }
}

interface ItemStats {
  name: string
  picks: number
  wins: number
  top3: number
  bottom2: number
  positionTotal: number
}

function percentage(n: number, d: number) {
  return d === 0 ? '0.00%' : `${((n / d) * 100).toFixed(2)}%`
}

function runSimulations(raceCount = 500, playerCount = 8) {
  console.log(`\n🏁 Đang chạy mô phỏng ${raceCount} trận đua (8 người chơi / trận)...`)
  const startedAt = performance.now()

  // 1. Stats per duck/slot when playing WITH items (Full Loadouts rotated/randomized)
  const playerItemStats = Array.from({ length: playerCount }, (_, i) => emptyPlayerStats(i + 1))
  
  // 2. Stats per duck/slot when playing WITHOUT items (Baseline)
  const playerBaselineStats = Array.from({ length: playerCount }, (_, i) => emptyPlayerStats(i + 1))

  // 3. Stats per Loadout
  const loadoutMap = new Map<string, ItemStats>()
  for (const l of FULL_LOADOUTS) {
    loadoutMap.set(l.join(' + '), { name: l.join(' + '), picks: 0, wins: 0, top3: 0, bottom2: 0, positionTotal: 0 })
  }

  // 4. Stats per Individual Item
  const itemMap = new Map<string, ItemStats>()
  for (const item of [...MAJORS, ...MINORS]) {
    itemMap.set(item, { name: item, picks: 0, wins: 0, top3: 0, bottom2: 0, positionTotal: 0 })
  }

  for (let raceIndex = 1; raceIndex <= raceCount; raceIndex++) {
    const seed = seedFromIndex(raceIndex)
    
    // A. Baseline simulation (No items)
    const baselineConfig: RaceConfig = {
      raceId: `base-${raceIndex}`,
      seed,
      protocolVersion: RACE_PROTOCOL_VERSION,
      engineVersion: RACE_ENGINE_VERSION,
      balanceVersion: RACE_BALANCE_VERSION,
      trackVersion: DEFAULT_TRACK_VERSION,
      tickRate: RACE_TICK_RATE,
      players: Array.from({ length: playerCount }, (_, i) => ({ playerId: `duck-${i + 1}`, name: `Duck ${i + 1}` })),
      loadouts: [],
    }
    const baseResult = simulateRace(baselineConfig, { recordEvents: false })
    for (const entry of baseResult.standings) {
      const slotIndex = Number(entry.playerId.replace('duck-', '')) - 1
      const p = playerBaselineStats[slotIndex]
      p.races++
      p.positionTotal += entry.rank
      if (entry.rank === 1) p.wins++
      if (entry.rank <= 3) p.top3++
      if (entry.rank >= playerCount - 1) p.bottom2++ // Rank 7 & 8 in 8-player lobby
    }

    // B. Match with Items (Balanced round-robin loadouts across ducks)
    const assignedLoadouts = Array.from({ length: playerCount }, (_, i) => FULL_LOADOUTS[(raceIndex - 1 + i) % FULL_LOADOUTS.length])
    const loadouts: RaceLoadout[] = assignedLoadouts.map((itemIds, i) => ({
      playerId: `duck-${i + 1}`,
      itemIds: [...itemIds],
      source: 'AUTO',
    }))

    const matchConfig: RaceConfig = {
      raceId: `match-${raceIndex}`,
      seed,
      protocolVersion: RACE_PROTOCOL_VERSION,
      engineVersion: RACE_ENGINE_VERSION,
      balanceVersion: RACE_BALANCE_VERSION,
      trackVersion: DEFAULT_TRACK_VERSION,
      tickRate: RACE_TICK_RATE,
      players: Array.from({ length: playerCount }, (_, i) => ({ playerId: `duck-${i + 1}`, name: `Duck ${i + 1}` })),
      loadouts,
    }

    const matchResult = simulateRace(matchConfig, { recordEvents: false })
    for (const entry of matchResult.standings) {
      const slotIndex = Number(entry.playerId.replace('duck-', '')) - 1
      const p = playerItemStats[slotIndex]
      p.races++
      p.positionTotal += entry.rank
      if (entry.rank === 1) p.wins++
      if (entry.rank <= 3) p.top3++
      if (entry.rank >= playerCount - 1) p.bottom2++ // Rank 7 & 8

      const items = assignedLoadouts[slotIndex]
      const lKey = items.join(' + ')
      const lStat = loadoutMap.get(lKey)!
      lStat.picks++
      lStat.positionTotal += entry.rank
      if (entry.rank === 1) lStat.wins++
      if (entry.rank <= 3) lStat.top3++
      if (entry.rank >= playerCount - 1) lStat.bottom2++

      for (const it of items) {
        const itStat = itemMap.get(it)!
        itStat.picks++
        itStat.positionTotal += entry.rank
        if (entry.rank === 1) itStat.wins++
        if (entry.rank <= 3) itStat.top3++
        if (entry.rank >= playerCount - 1) itStat.bottom2++
      }
    }
  }

  const durationSec = ((performance.now() - startedAt) / 1000).toFixed(2)
  console.log(`⏱ Hoàn thành ${raceCount} trận trong ${durationSec}s (${(raceCount / Number(durationSec)).toFixed(1)} races/s)\n`)

  console.log(`📊 BẢNG TỈ LỆ BOTTOM 2 CỦA TỪNG VỊT (8 NGƯỜI CHƠI - 500 TRẬN CÓ ITEM + BOOST ZONES):`)
  const playerRows = playerItemStats.map((p) => ({
    'Vịt / Người chơi': p.name,
    'Số trận': p.races,
    'Tỉ lệ Thắng (Top 1)': percentage(p.wins, p.races),
    'Tỉ lệ Top 3': percentage(p.top3, p.races),
    'Tỉ lệ Bottom 2 (Hạng 7-8)': percentage(p.bottom2, p.races),
    'Số lần Bottom 2': `${p.bottom2} / ${p.races}`,
    'Hạng trung bình': (p.positionTotal / p.races).toFixed(2),
  }))
  console.table(playerRows)

  console.log(`\n📊 BẢNG TỈ LỆ BOTTOM 2 THEO VỊ TRÍ XUẤT PHÁT BASELINE (KHÔNG ITEM):`)
  const baselineRows = playerBaselineStats.map((p) => ({
    'Vị trí xuất phát': `Slot ${p.slot} (${p.name})`,
    'Tỉ lệ Thắng': percentage(p.wins, p.races),
    'Tỉ lệ Top 3': percentage(p.top3, p.races),
    'Tỉ lệ Bottom 2': percentage(p.bottom2, p.races),
    'Số lần Bottom 2': `${p.bottom2} / ${p.races}`,
    'Hạng trung bình': (p.positionTotal / p.races).toFixed(2),
  }))
  console.table(baselineRows)

  console.log(`\n🎒 BẢNG TỈ LỆ BOTTOM 2 THEO TỪNG ITEM:`)
  const itemRows = [...itemMap.values()].map((it) => ({
    'Item': it.name,
    'Số trận xuất hiện': it.picks,
    'Tỉ lệ Thắng': percentage(it.wins, it.picks),
    'Tỉ lệ Top 3': percentage(it.top3, it.picks),
    'Tỉ lệ Bottom 2': percentage(it.bottom2, it.picks),
    'Hạng trung bình': (it.positionTotal / it.picks).toFixed(2),
  }))
  console.table(itemRows)

  console.log(`\n📦 BẢNG TỈ LỆ BOTTOM 2 THEO TỪNG BỘ LOADOUT:`)
  const loadoutRows = [...loadoutMap.values()].map((l) => ({
    'Bộ Loadout': l.name,
    'Số trận': l.picks,
    'Tỉ lệ Thắng': percentage(l.wins, l.picks),
    'Tỉ lệ Top 3': percentage(l.top3, l.picks),
    'Tỉ lệ Bottom 2': percentage(l.bottom2, l.picks),
    'Hạng trung bình': (l.positionTotal / l.picks).toFixed(2),
  }))
  console.table(loadoutRows)
}

runSimulations(500, 8)
