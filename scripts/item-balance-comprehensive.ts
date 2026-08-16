import { simulateRace } from '../packages/race-core/src'
import {
  DEFAULT_TRACK_VERSION,
  RACE_BALANCE_VERSION,
  RACE_ENGINE_VERSION,
  RACE_PROTOCOL_VERSION,
  RACE_TICK_RATE,
  type RaceConfig,
  type RaceEvent,
  type RaceItemId,
  type RaceLoadout,
} from '../packages/race-protocol/src'
import {
  FULL_LOADOUTS,
  PURE_LOADOUTS_BY_CLASS,
  ITEM_CLASSES,
  loadoutKey,
  loadoutArchetype,
  type FullLoadout,
} from './lib/balance-sim-core'

function seedFromIndex(index: number) {
  return index.toString(16).padStart(64, '0')
}

function createConfig(raceIndex: number, playerCount: number, loadouts: RaceLoadout[] = []): RaceConfig {
  return {
    raceId: `balance-eval-${raceIndex}`,
    seed: seedFromIndex(raceIndex),
    protocolVersion: RACE_PROTOCOL_VERSION,
    engineVersion: RACE_ENGINE_VERSION,
    balanceVersion: RACE_BALANCE_VERSION,
    trackVersion: DEFAULT_TRACK_VERSION,
    tickRate: RACE_TICK_RATE,
    players: Array.from({ length: playerCount }, (_, index) => ({
      playerId: `duck-${index + 1}`,
      name: `Duck ${index + 1}`,
    })),
    loadouts,
  }
}

interface LoadoutStats {
  samples: number
  wins: number
  top3: number
  bottom2: number
  rankSum: number
  positionsImprovedSum: number
}

function emptyStats(): LoadoutStats {
  return { samples: 0, wins: 0, top3: 0, bottom2: 0, rankSum: 0, positionsImprovedSum: 0 }
}

async function runEvaluation() {
  const SAMPLES_PER_LOADOUT = 300
  const PLAYER_COUNT = 8

  console.log('='.repeat(80))
  console.log('BẮT ĐẦU KIỂM TRA TOÀN DIỆN 18 BỘ LOADOUT & HOẠT ĐỘNG TỪNG ITEM')
  console.log('='.repeat(80))

  // -------------------------------------------------------------------------
  // 1. EVALUATE ALL 18 LOADOUTS
  // -------------------------------------------------------------------------
  console.log(`\n[1/3] Đang khảo sát 18 Loadout (${SAMPLES_PER_LOADOUT} trận/loadout trong sảnh 8 người)...`)

  const loadoutMap = new Map<string, LoadoutStats>()
  for (const lo of FULL_LOADOUTS) {
    loadoutMap.set(loadoutKey(lo), emptyStats())
  }

  // Telemetry counters
  const itemTelemetry = {
    NITRO: { equipped: 0, activated: 0, brokenByRocket: 0, brokenByBanana: 0, boostSecondsGranted: 0 },
    DRAFT_FIN: { equipped: 0, activated: 0, hornInterrupted: 0 },
    PADDLE_BURST: { equipped: 0, activated: 0 },
    HOMING_ROCKET: { equipped: 0, fired: 0, hit: 0, blocked: 0, mitigated: 0, boostDestroyed: 0 },
    BANANA: { equipped: 0, dropped: 0, hit: 0, boostBroken: 0 },
    QUACK_HORN: { equipped: 0, used: 0, ducksHit: 0, slipstreamDestroyed: 0 },
    BUBBLE_SHIELD: { equipped: 0, blocked: 0, unused: 0 },
    FEATHER: { equipped: 0, dodged: 0, unused: 0 },
    SHOCK_ABSORBER: { equipped: 0, mitigated: 0, unused: 0 },
  }

  let totalRacesRun = 0

  for (let lIdx = 0; lIdx < FULL_LOADOUTS.length; lIdx++) {
    const focusLoadout = FULL_LOADOUTS[lIdx]
    const key = loadoutKey(focusLoadout)
    const stats = loadoutMap.get(key)!
    console.log(`  -> [${lIdx + 1}/18] Đang chạy Loadout: ${key}...`)

    for (let seed = 1; seed <= SAMPLES_PER_LOADOUT; seed++) {
      totalRacesRun++
      const seedIndex = lIdx * 10_000 + seed

      // Baseline race (no items) to calculate positions improved
      const baselineRes = simulateRace(createConfig(seedIndex, PLAYER_COUNT, []), { recordEvents: false })
      const baselineRankDuck1 = baselineRes.standings.find((s) => s.playerId === 'duck-1')!.rank

      // Race with Duck 1 having focusLoadout, other 7 having neutral loadouts
      const loadouts: RaceLoadout[] = [
        { playerId: 'duck-1', itemIds: [...focusLoadout], source: 'PLAYER' },
      ]
      for (let p = 2; p <= PLAYER_COUNT; p++) {
        const dummyLo = FULL_LOADOUTS[(seed + p) % FULL_LOADOUTS.length]
        loadouts.push({ playerId: `duck-${p}`, itemIds: [...dummyLo], source: 'AUTO' })
      }

      for (const item of focusLoadout) {
        if (itemTelemetry[item]) itemTelemetry[item].equipped++
      }

      let usedItemsDuck1 = new Set<string>()

      const res = simulateRace(createConfig(seedIndex, PLAYER_COUNT, loadouts), {
        recordEvents: false,
        onEvent(ev: RaceEvent) {
          if (ev.sourcePlayerId === 'duck-1') {
            if (ev.type === 'NITRO_STARTED') {
              itemTelemetry.NITRO.activated++
              usedItemsDuck1.add('NITRO')
              itemTelemetry.NITRO.boostSecondsGranted += Number(ev.metadata.durationSeconds ?? 1.5)
            } else if (ev.type === 'DRAFT_FIN_STARTED') {
              itemTelemetry.DRAFT_FIN.activated++
              usedItemsDuck1.add('DRAFT_FIN')
            } else if (ev.type === 'PADDLE_BURST_STARTED') {
              itemTelemetry.PADDLE_BURST.activated++
              usedItemsDuck1.add('PADDLE_BURST')
            } else if (ev.type === 'ROCKET_FIRED') {
              itemTelemetry.HOMING_ROCKET.fired++
              usedItemsDuck1.add('HOMING_ROCKET')
            } else if (ev.type === 'BANANA_DROPPED') {
              itemTelemetry.BANANA.dropped++
              usedItemsDuck1.add('BANANA')
            } else if (ev.type === 'HORN_USED') {
              itemTelemetry.QUACK_HORN.used++
              usedItemsDuck1.add('QUACK_HORN')
              itemTelemetry.QUACK_HORN.ducksHit += Number(ev.metadata.ducksHit ?? 1)
              itemTelemetry.QUACK_HORN.slipstreamDestroyed += Number(ev.metadata.slipstreamChargeDestroyedSeconds ?? 0)
            }
          }

          if (ev.type === 'ROCKET_HIT' && ev.sourcePlayerId === 'duck-1') {
            itemTelemetry.HOMING_ROCKET.hit++
            if (ev.metadata.boostBroken) itemTelemetry.HOMING_ROCKET.boostDestroyed++
          } else if (ev.type === 'ROCKET_BLOCKED' && ev.sourcePlayerId === 'duck-1') {
            itemTelemetry.HOMING_ROCKET.blocked++
          } else if (ev.type === 'BANANA_HIT' && ev.sourcePlayerId === 'duck-1') {
            itemTelemetry.BANANA.hit++
            if (ev.metadata.boostBroken) itemTelemetry.BANANA.boostBroken++
          }

          if (ev.targetPlayerId === 'duck-1') {
            if (ev.type === 'BUBBLE_POPPED' && ev.metadata.blocked) {
              itemTelemetry.BUBBLE_SHIELD.blocked++
              usedItemsDuck1.add('BUBBLE_SHIELD')
            } else if (ev.type === 'FEATHER_DODGED') {
              itemTelemetry.FEATHER.dodged++
              usedItemsDuck1.add('FEATHER')
            } else if (ev.type === 'SHOCK_ABSORBER_PROC') {
              itemTelemetry.SHOCK_ABSORBER.mitigated++
              usedItemsDuck1.add('SHOCK_ABSORBER')
            }
          }
        },
      })

      if (focusLoadout.includes('BUBBLE_SHIELD') && !usedItemsDuck1.has('BUBBLE_SHIELD')) itemTelemetry.BUBBLE_SHIELD.unused++
      if (focusLoadout.includes('FEATHER') && !usedItemsDuck1.has('FEATHER')) itemTelemetry.FEATHER.unused++
      if (focusLoadout.includes('SHOCK_ABSORBER') && !usedItemsDuck1.has('SHOCK_ABSORBER')) itemTelemetry.SHOCK_ABSORBER.unused++

      const rankDuck1 = res.standings.find((s) => s.playerId === 'duck-1')!.rank
      stats.samples++
      stats.rankSum += rankDuck1
      stats.positionsImprovedSum += (baselineRankDuck1 - rankDuck1)
      if (rankDuck1 === 1) stats.wins++
      if (rankDuck1 <= 3) stats.top3++
      if (rankDuck1 >= PLAYER_COUNT - 1) stats.bottom2++
    }
  }

  // -------------------------------------------------------------------------
  // 2. HEAD-TO-HEAD ARCHETYPE MATRIX (SPEED vs ATTACK vs DEFENSE)
  // -------------------------------------------------------------------------
  console.log('\n[2/3] Đo lường Tam giác Khắc chế Đối đầu Trực tiếp (1v1 Matchups trong sảnh 8 vịt)...')

  const H2H_SAMPLES = 250
  const archetypeMatrix: Record<string, Record<string, { winsA: number; total: number }>> = {
    SPEED: { SPEED: { winsA: 0, total: 0 }, ATTACK: { winsA: 0, total: 0 }, DEFENSE: { winsA: 0, total: 0 } },
    ATTACK: { SPEED: { winsA: 0, total: 0 }, ATTACK: { winsA: 0, total: 0 }, DEFENSE: { winsA: 0, total: 0 } },
    DEFENSE: { SPEED: { winsA: 0, total: 0 }, ATTACK: { winsA: 0, total: 0 }, DEFENSE: { winsA: 0, total: 0 } },
  }

  for (const archA of ITEM_CLASSES) {
    for (const archB of ITEM_CLASSES) {
      console.log(`  -> Đối đầu: ${archA} vs ${archB}...`)
      const loadoutsA = PURE_LOADOUTS_BY_CLASS[archA]
      const loadoutsB = PURE_LOADOUTS_BY_CLASS[archB]

      for (const loA of loadoutsA) {
        for (const loB of loadoutsB) {
          for (let seed = 1; seed <= H2H_SAMPLES; seed++) {
            // Swap slots to eliminate slot bias
            for (const [slotA, slotB] of [[1, 2], [2, 1]]) {
              const loadouts: RaceLoadout[] = [
                { playerId: `duck-${slotA}`, itemIds: [...loA], source: 'PLAYER' },
                { playerId: `duck-${slotB}`, itemIds: [...loB], source: 'PLAYER' },
              ]
              for (let p = 1; p <= PLAYER_COUNT; p++) {
                if (p !== slotA && p !== slotB) {
                  const dummyLo = FULL_LOADOUTS[(seed + p) % FULL_LOADOUTS.length]
                  loadouts.push({ playerId: `duck-${p}`, itemIds: [...dummyLo], source: 'AUTO' })
                }
              }

              const res = simulateRace(createConfig(seed * 100 + slotA, PLAYER_COUNT, loadouts), { recordEvents: false })
              const rankA = res.standings.find((s) => s.playerId === `duck-${slotA}`)!.rank
              const rankB = res.standings.find((s) => s.playerId === `duck-${slotB}`)!.rank

              archetypeMatrix[archA][archB].total++
              if (rankA < rankB) {
                archetypeMatrix[archA][archB].winsA++
              }
            }
          }
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // 3. PRINT FORMATTED REPORT
  // -------------------------------------------------------------------------
  console.log('\n' + '='.repeat(80))
  console.log('BÁO CÁO CÂN BẰNG LOADOUT & HOẠT ĐỘNG CỦA TOÀN BỘ ITEM')
  console.log('='.repeat(80))

  console.log('\n### 1. BẢNG XẾP HẠNG HIỆU QUẢ 18 BỘ TRANG BỊ (LOADOUT RANKING)')
  console.log('Mỗi bộ trang bị được thử nghiệm trong sảnh 8 người chơi (Chuẩn trung tính: Win Rate = 12.5%, Top 3 = 37.5%, Hạng TB = 4.50):')
  console.log('┌────┬──────────────────────────────────────┬──────────┬─────────────┬─────────────┬─────────────┬─────────────┬─────────────┐')
  console.log('│ TT │ Bộ Trang Bị (Loadout)                │ Hệ (Arc) │ Tỷ lệ Thắng │ Top 3       │ Bottom 2    │ Hạng TB     │ Cải Thiện ⁺ │')
  console.log('├────┼──────────────────────────────────────┼──────────┼─────────────┼─────────────┼─────────────┼─────────────┼─────────────┤')

  const rows = Array.from(loadoutMap.entries()).map(([key, st]) => {
    const items = key.split(' + ') as RaceItemId[]
    const arch = loadoutArchetype(items)
    const winPct = (st.wins / st.samples) * 100
    const top3Pct = (st.top3 / st.samples) * 100
    const bot2Pct = (st.bottom2 / st.samples) * 100
    const avgRank = st.rankSum / st.samples
    const delta = st.positionsImprovedSum / st.samples
    return { key, arch, winPct, top3Pct, bot2Pct, avgRank, delta }
  })

  rows.sort((a, b) => b.winPct - a.winPct)

  rows.forEach((r, idx) => {
    const rankStr = String(idx + 1).padStart(2)
    const nameStr = r.key.padEnd(36)
    const archStr = r.arch.padEnd(8)
    const winStr = (r.winPct.toFixed(1) + '%').padStart(6)
    const top3Str = (r.top3Pct.toFixed(1) + '%').padStart(6)
    const bot2Str = (r.bot2Pct.toFixed(1) + '%').padStart(6)
    const avgStr = r.avgRank.toFixed(3).padStart(6)
    const dStr = (r.delta > 0 ? '+' : '') + r.delta.toFixed(2)
    console.log(`│ ${rankStr} │ ${nameStr} │ ${archStr} │   ${winStr}    │   ${top3Str}    │   ${bot2Str}    │   ${avgStr}    │    ${dStr.padStart(5)}    │`)
  })
  console.log('└────┴──────────────────────────────────────┴──────────┴─────────────┴─────────────┴─────────────┴─────────────┴─────────────┘')
  console.log('(* Cải thiện: Số bậc thứ hạng tăng thêm so với khi không trang bị item trên cùng một seed ngẫu nhiên)')

  console.log('\n### 2. MA TRẬN ĐỐI ĐẦU 3 HỆ KHẮC CHẾ (ARCHETYPE WIN MATRIX)')
  console.log('Tỷ lệ thắng trực tiếp (Hàng đối đầu Cột) khi 2 vịt mang trang bị thuần hệ chạm trán nhau:')
  console.log('┌──────────────┬──────────────────┬──────────────────┬──────────────────┐')
  console.log('│              │ vs SPEED         │ vs ATTACK        │ vs DEFENSE       │')
  console.log('├──────────────┼──────────────────┼──────────────────┼──────────────────┤')
  for (const rowArch of ITEM_CLASSES) {
    let line = `│ ${rowArch.padEnd(12)} │`
    for (const colArch of ITEM_CLASSES) {
      const cell = archetypeMatrix[rowArch][colArch]
      const winRate = ((cell.winsA / cell.total) * 100).toFixed(1)
      let note = ''
      if (rowArch === 'SPEED' && colArch === 'DEFENSE') note = ' (Mục tiêu: 52-54%)'
      if (rowArch === 'DEFENSE' && colArch === 'ATTACK') note = ' (Mục tiêu: 52-54%)'
      if (rowArch === 'ATTACK' && colArch === 'SPEED') note = ' (Mục tiêu: 52-54%)'
      line += `  ${(winRate + '%').padStart(6)} ${(winRate >= '50.0' ? '▲' : '▼')}         │`
    }
    console.log(line)
  }
  console.log('└──────────────┴──────────────────┴──────────────────┴──────────────────┘')

  console.log('\n### 3. KIỂM ĐỊNH HOẠT ĐỘNG VÀ TELEMETRY TỪNG ITEM (DIAGNOSTIC TELEMETRY)')
  console.log('┌────────────────┬───────────────────────────────────────────────────────────────────────────────┐')
  console.log('│ Item           │ Thống kê hoạt động thực tế & Tương tác vật lý                                 │')
  console.log('├────────────────┼───────────────────────────────────────────────────────────────────────────────┤')

  const n = itemTelemetry.NITRO
  console.log(`│ NITRO          │ Kích hoạt: ${n.activated}/${n.equipped} (${((n.activated / n.equipped) * 100).toFixed(1)}%) · Boost cấp: ${(n.boostSecondsGranted / n.activated).toFixed(2)}s/lần                            │`)
  console.log(`│                │ Bị ngắt bởi Tên lửa: ${n.brokenByRocket} lần · Bị ngắt bởi Chuối: ${n.brokenByBanana} lần                             │`)

  const df = itemTelemetry.DRAFT_FIN
  console.log(`│ DRAFT_FIN      │ Kích hoạt Slipstream: ${df.activated}/${df.equipped} (${((df.activated / df.equipped) * 100).toFixed(1)}%) · Bị Còi Quack Horn phá charge: ${df.hornInterrupted} lần            │`)

  const pb = itemTelemetry.PADDLE_BURST
  console.log(`│ PADDLE_BURST   │ Kích hoạt Nước Rút Cuối: ${pb.activated}/${pb.equipped} (${((pb.activated / pb.equipped) * 100).toFixed(1)}%)                                           │`)

  const rk = itemTelemetry.HOMING_ROCKET
  const rkHitRate = ((rk.hit / rk.fired) * 100).toFixed(1)
  console.log(`│ HOMING_ROCKET  │ Bắn: ${rk.fired} quả · Trúng đích: ${rk.hit} (${rkHitRate}%) · Bị Khiên đỡ: ${rk.blocked} · Giảm sốc: ${rk.mitigated}              │`)
  console.log(`│                │ Số lần phá hủy Speed Boost của đối thủ: ${rk.boostDestroyed} lần                                │`)

  const bn = itemTelemetry.BANANA
  const bnHits = ((bn.hit / bn.dropped) * 100).toFixed(1)
  console.log(`│ BANANA         │ Thả bẫy: ${bn.dropped} vỏ · Nạn nhân giẫm phải: ${bn.hit} (${bnHits}%) · Ngắt Nitro nạn nhân: ${bn.boostBroken} lần     │`)

  const qh = itemTelemetry.QUACK_HORN
  console.log(`│ QUACK_HORN     │ Thổi còi: ${qh.used} lần · Số vịt bị húc dạt ngang: ${qh.ducksHit} vịt · Phá Slipstream: ${qh.slipstreamDestroyed.toFixed(2)}s      │`)

  const bb = itemTelemetry.BUBBLE_SHIELD
  const bbBlockRate = ((bb.blocked / bb.equipped) * 100).toFixed(1)
  console.log(`│ BUBBLE_SHIELD  │ Đỡ đòn thành công: ${bb.blocked}/${bb.equipped} (${bbBlockRate}%) · Nhàn rỗi (không bị bắn): ${bb.unused} trận            │`)

  const ft = itemTelemetry.FEATHER
  const ftDodgeRate = ((ft.dodged / ft.equipped) * 100).toFixed(1)
  console.log(`│ FEATHER        │ Né bẫy Chuối thành công: ${ft.dodged}/${ft.equipped} (${ftDodgeRate}%) · Nhàn rỗi (không gặp bẫy): ${ft.unused} trận        │`)

  const sa = itemTelemetry.SHOCK_ABSORBER
  const saMitRate = ((sa.mitigated / sa.equipped) * 100).toFixed(1)
  console.log(`│ SHOCK_ABSORBER │ Giảm chấn Tên lửa & Còi: ${sa.mitigated}/${sa.equipped} (${saMitRate}%) · Nhàn rỗi: ${sa.unused} trận                     │`)
  console.log('└────────────────┴───────────────────────────────────────────────────────────────────────────────┘')
}

runEvaluation().catch(console.error)
