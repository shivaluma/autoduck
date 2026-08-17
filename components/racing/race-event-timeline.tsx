'use client'

import { useMemo, useState } from 'react'
import type { RaceEvent, RaceItemId, WildItemId } from '@/packages/race-protocol/src'
import { Season3Avatar } from '@/components/season3-avatar'

export type TimelinePlayer = {
  playerId: string
  name: string
  avatarUrl?: string | null
  itemIds?: RaceItemId[]
  isGhost?: boolean
}

type EventCategory = 'all' | 'combat' | 'speed' | 'pickup' | 'finish'

const ITEM_NAME_MAP: Record<string, string> = {
  BUBBLE_SHIELD: 'Khiên Bong Bóng 🫧',
  HOMING_ROCKET: 'Tên Lửa Tầm Nhiệt 🚀',
  NITRO: 'Bình Tăng Tốc Nitro ⚡',
  BANANA: 'Vỏ Chuối Bẫy 🍌',
  FEATHER: 'Lông Vũ Né Đòn 🪽',
  QUACK_HORN: 'Còi Quack Horn EMP 🔊',
  DRAFT_FIN: 'Vây Cá Bám Đuôi 🦈',
  PADDLE_BURST: 'Quạt Nước Bứt Tốc 🛶',
  SHOCK_ABSORBER: 'Áo Chống Sốc 🦺',
  MINI_NITRO: 'Mini Nitro ⚡',
  TAILWIND: 'Gió Xuôi Tailwind 🌊',
  MINI_BUBBLE: 'Mini Bubble 🫧',
  MINI_ROCKET: 'Mini Rocket 🚀',
  SLIPSTREAM_MAGNET: 'Nam Châm Hút Tốc 🧲',
}

const HAZARD_NAME_MAP: Record<string, string> = {
  ANCHOR: 'Mỏ Neo ⚓',
  WHIRLPOOL: 'Xoáy Nước 🌀',
  ICE_PATCH: 'Băng Trơn 🧊',
  STICKY_GOO: 'Chất Nhầy 🧪',
}

function formatRaceTime(ms: number): string {
  const totalSeconds = ms / 1000
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${seconds.toFixed(1).padStart(4, '0')}`
}

export function formatEventDetails(
  event: RaceEvent,
  nameById: Map<string, string>
): {
  icon: string
  title: string
  description: string
  category: EventCategory
  tone: string
} {
  const sourceName = event.sourcePlayerId ? (nameById.get(event.sourcePlayerId) ?? event.sourcePlayerId) : 'Đường đua'
  const targetName = event.targetPlayerId ? (nameById.get(event.targetPlayerId) ?? event.targetPlayerId) : ''
  const itemKey = String(event.metadata.itemId ?? event.metadata.wildItemId ?? '')
  const itemName = ITEM_NAME_MAP[itemKey] || itemKey

  switch (event.type) {
    case 'RACE_STARTED':
      return {
        icon: '🚩',
        title: 'Xuất phát!',
        description: 'Tất cả các chú vịt lao vào dòng nước!',
        category: 'speed',
        tone: 'text-[var(--color-ggd-gold)] border-amber-500/30 bg-amber-500/10',
      }

    case 'ROCKET_FIRED':
    case 'MINI_ROCKET_FIRED':
      return {
        icon: '🚀',
        title: `${sourceName} phóng Tên Lửa 🚀`,
        description: targetName ? `Khóa mục tiêu bắn thẳng vào ${targetName}!` : 'Phóng tên lửa tầm nhiệt về phía trước!',
        category: 'combat',
        tone: 'text-rose-400 border-rose-500/30 bg-rose-500/10',
      }

    case 'ROCKET_HIT':
    case 'MINI_ROCKET_HIT':
      return {
        icon: '💥',
        title: `${sourceName} 🚀 bắn trúng ${targetName || 'mục tiêu'}! (Thành công ✅)`,
        description: `${targetName || 'Mục tiêu'} trúng đòn tên lửa của ${sourceName}, tốc độ bị hãm mạnh!`,
        category: 'combat',
        tone: 'text-rose-500 border-rose-500/40 bg-rose-500/20',
      }

    case 'ROCKET_BLOCKED':
    case 'MINI_ROCKET_BLOCKED': {
      const defense = String(event.metadata.defense ?? 'BUBBLE_SHIELD')
      let reasonText = `dùng Khiên Bong Bóng (Bubble Shield 🫧) chặn đứng`
      if (defense === 'MINI_BUBBLE') reasonText = `dùng Mini Bubble 🫧 chặn đứng`
      else if (defense === 'IMMUNITY') reasonText = `đang Miễn nhiễm đòn đánh (Immunity 🛡️), vô hiệu hóa`

      return {
        icon: '🛡️',
        title: `${sourceName} ❌ bắn ${targetName || 'mục tiêu'} thất bại! (Bị chặn)`,
        description: `${targetName || 'Mục tiêu'} ${reasonText} tên lửa từ ${sourceName}!`,
        category: 'combat',
        tone: 'text-sky-400 border-sky-500/30 bg-sky-500/10',
      }
    }

    case 'ROCKET_EXPIRED':
    case 'MINI_ROCKET_EXPIRED':
      return {
        icon: '⏱️',
        title: `Tên lửa của ${sourceName} hết tầm ⏱️`,
        description: targetName ? `Tên lửa nhắm vào ${targetName} hết thời gian hoặc mục tiêu đã về đích.` : 'Tên lửa không tìm thấy mục tiêu và tự hủy.',
        category: 'combat',
        tone: 'text-zinc-400 border-zinc-500/30 bg-zinc-500/10',
      }

    case 'BANANA_DROPPED':
    case 'WILD_BANANA_DROPPED':
      return {
        icon: '🍌',
        title: `${sourceName} thả Vỏ Chuối 🍌`,
        description: 'Để lại bẫy chuối trơn trượt ngáng đường đối thủ phía sau.',
        category: 'combat',
        tone: 'text-yellow-400 border-yellow-500/30 bg-yellow-500/10',
      }

    case 'BANANA_HIT':
    case 'WILD_BANANA_HIT':
      return {
        icon: '💫',
        title: `${targetName || 'Vịt'} đạp trúng Chuối của ${sourceName}! (Thành công ✅)`,
        description: `${targetName || 'Vịt'} giẫm phải bẫy của ${sourceName}, bị trượt xoay vòng và giật lùi quãng đường!`,
        category: 'combat',
        tone: 'text-amber-400 border-amber-500/40 bg-amber-500/15',
      }

    case 'BANANA_BLOCKED':
    case 'WILD_BANANA_BLOCKED': {
      const defense = String(event.metadata.defense ?? 'FEATHER')
      let reasonText = `dùng Lông Vũ (Feather 🪽) lướt né trọn vẹn`
      if (defense === 'WILD_FEATHER') reasonText = `dùng Wild Feather 🪽 lướt né trọn vẹn`
      else if (defense === 'BUBBLE_SHIELD') reasonText = `có Khiên Bong Bóng (Bubble Shield 🫧) đỡ văng`
      else if (defense === 'MINI_BUBBLE') reasonText = `có Mini Bubble 🫧 đỡ văng`
      else if (defense === 'IMMUNITY') reasonText = `đang Miễn nhiễm đòn đánh 🛡️, miễn nhiễm`

      return {
        icon: '🪽',
        title: `${targetName || 'Vịt'} hóa giải bẫy Chuối của ${sourceName}! 🛡️`,
        description: `${targetName || 'Vịt'} ${reasonText} bẫy chuối của ${sourceName}!`,
        category: 'combat',
        tone: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
      }
    }

    case 'FEATHER_DODGED':
    case 'WILD_FEATHER_DODGED':
      return {
        icon: '🪽',
        title: `${sourceName} né đòn bằng Lông Vũ! 🪽`,
        description: targetName
          ? `${sourceName} lướt nhẹ Lông Vũ né cú trượt vỏ chuối của ${targetName} ngoạn mục!`
          : `${sourceName} lướt nhẹ Lông Vũ né trọn chướng ngại vật trên đường đua!`,
        category: 'combat',
        tone: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
      }

    case 'NITRO_STARTED':
    case 'PADDLE_BURST_STARTED':
    case 'TAILWIND_STARTED':
      return {
        icon: '⚡',
        title: `${sourceName} bứt tốc cực mạnh!`,
        description: `Kích hoạt ${itemName || 'Nitro boost'} xé gió vượt lên phía trước!`,
        category: 'speed',
        tone: 'text-[var(--color-ggd-neon-green)] border-emerald-500/30 bg-emerald-500/10',
      }

    case 'DRAFT_FIN_STARTED':
      return {
        icon: '🦈',
        title: `${sourceName} bám đuôi Draft Fin!`,
        description: 'Lướt sóng bám sát đuôi đối thủ phía trước để tăng tốc!',
        category: 'speed',
        tone: 'text-cyan-400 border-cyan-500/30 bg-cyan-500/10',
      }

    case 'PREDATOR_RUSH_STARTED':
      return {
        icon: '🔥',
        title: `${sourceName} kích hoạt Predator Rush!`,
        description: 'Tấn công trúng đích kích hoạt đòn bứt tốc hung hãn!',
        category: 'combat',
        tone: 'text-orange-400 border-orange-500/30 bg-orange-500/10',
      }

    case 'HORN_USED':
    case 'WILD_HORN_USED':
      return {
        icon: '🔊',
        title: `${sourceName} thổi Còi Quack Horn!`,
        description: 'Sóng âm EMP cực lớn phát ra làm câm lặng (Silence) đối thủ xung quanh!',
        category: 'combat',
        tone: 'text-purple-400 border-purple-500/30 bg-purple-500/10',
      }

    case 'ITEM_SILENCED':
      return {
        icon: '🔇',
        title: `${sourceName} bị Câm Lặng (Silenced)!`,
        description: 'Bị sóng âm khóa trang bị, không thể dùng item trong giây lát!',
        category: 'combat',
        tone: 'text-purple-300 border-purple-500/30 bg-purple-500/15',
      }

    case 'BUBBLE_SHIELD_ACTIVATED':
    case 'MINI_BUBBLE_ACTIVATED':
      return {
        icon: '🫧',
        title: `${sourceName} bật Khiên Bong Bóng`,
        description: 'Lớp màng bảo vệ kích hoạt, miễn nhiễm đòn tấn công tiếp theo.',
        category: 'combat',
        tone: 'text-sky-300 border-sky-500/30 bg-sky-500/10',
      }

    case 'BUBBLE_POPPED':
      return {
        icon: '💥',
        title: `Khiên của ${sourceName} vỡ tan!`,
        description: 'Khiên bảo vệ đã hoàn thành nhiệm vụ và biến mất.',
        category: 'combat',
        tone: 'text-sky-200 border-sky-500/20 bg-sky-500/10',
      }

    case 'SHOCK_ABSORBER_PROC':
      return {
        icon: '🦺',
        title: `${sourceName} hấp thụ lực va chạm!`,
        description: 'Áo chống sốc giảm thiểu độ giật lùi sau va chạm.',
        category: 'combat',
        tone: 'text-indigo-400 border-indigo-500/30 bg-indigo-500/10',
      }

    case 'GOLDEN_BOX_COLLECTED':
      return {
        icon: '👑',
        title: `${sourceName} nhặt Hộp Quà Vàng!`,
        description: 'Nhận được vật phẩm tối thượng từ Hộp Vàng!',
        category: 'pickup',
        tone: 'text-[var(--color-ggd-gold)] border-amber-500/40 bg-amber-500/20',
      }

    case 'PICKUP_COLLECTED':
    case 'WILD_ITEM_GRANTED':
      return {
        icon: '🎁',
        title: `${sourceName} nhặt Hộp Quà`,
        description: itemName ? `Nhận được ${itemName}!` : 'Nhận thêm một vật phẩm đường đua!',
        category: 'pickup',
        tone: 'text-teal-400 border-teal-500/30 bg-teal-500/10',
      }

    case 'HAZARD_HIT':
      const hazardType = String(event.metadata.hazardType ?? '')
      const hazardName = HAZARD_NAME_MAP[hazardType] || 'Chướng ngại vật'
      return {
        icon: '⚠️',
        title: `${sourceName} va phải ${hazardName}!`,
        description: `Bị cản trở trên dòng nước bởi ${hazardName}!`,
        category: 'pickup',
        tone: 'text-rose-400 border-rose-500/30 bg-rose-500/10',
      }

    case 'DUCK_FINISHED':
      const rank = Number(event.metadata.rank ?? 1)
      const finishTime = typeof event.metadata.finishTimeMs === 'number' ? (event.metadata.finishTimeMs / 1000).toFixed(2) : ''
      return {
        icon: rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '🏁',
        title: `${sourceName} CÁN ĐÍCH HẠNG #${rank}!`,
        description: finishTime ? `Thời gian về đích: ${finishTime}s` : `Về đích an toàn ở vị trí #${rank}`,
        category: 'finish',
        tone: rank === 1
          ? 'text-[var(--color-ggd-gold)] border-amber-500/50 bg-amber-500/25 font-black'
          : 'text-white border-white/20 bg-black/30',
      }

    case 'CHAOS_RESOLVED':
      return {
        icon: '🎴',
        title: 'Hiệu ứng Chaos phân định kết quả!',
        description: String(event.metadata.summary ?? 'Đã xác định người chịu phạt và người chiến thắng.'),
        category: 'finish',
        tone: 'text-[var(--color-ggd-orange)] border-[var(--color-ggd-orange)]/40 bg-[var(--color-ggd-orange)]/15',
      }

    default:
      return {
        icon: '📌',
        title: `${sourceName}: ${event.type}`,
        description: Object.keys(event.metadata).length > 0 ? JSON.stringify(event.metadata) : '',
        category: 'all',
        tone: 'text-white/70 border-white/10 bg-black/20',
      }
  }
}

export function RaceEventTimeline({
  events,
  players,
  currentTick,
  maxHeight = 'max-h-[480px]',
  showCategoryFilter = true,
}: {
  events: RaceEvent[]
  players: TimelinePlayer[]
  currentTick?: number
  maxHeight?: string
  showCategoryFilter?: boolean
}) {
  const [category, setCategory] = useState<EventCategory>('all')
  const [selectedPlayerId, setSelectedPlayerId] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')

  const nameById = useMemo(() => new Map(players.map((p) => [p.playerId, p.name])), [players])
  const avatarById = useMemo(() => new Map(players.map((p) => [p.playerId, p.avatarUrl])), [players])

  // Filter and format all events
  const parsedEvents = useMemo(() => {
    return events
      .filter((event) => {
        // Exclude internal noise events from public timeline
        if (
          event.type === 'DUCK_COLLISION' ||
          event.type === 'PICKUP_SPAWNED' ||
          event.type === 'HAZARD_SPAWNED' ||
          event.type === 'GOLDEN_BOX_SPAWNED' ||
          event.type === 'PICKUP_ZONE_ACTIVATED' ||
          event.type === 'SPEED_BOOST_QUEUED' ||
          event.type === 'NITRO_ENDED' ||
          event.type === 'DRAFT_FIN_ENDED' ||
          event.type === 'PADDLE_BURST_ENDED' ||
          event.type === 'TAILWIND_ENDED' ||
          event.type === 'MAGNET_ENDED' ||
          event.type === 'PREDATOR_RUSH_ENDED' ||
          event.type === 'BUBBLE_SHIELD_EXPIRED' ||
          event.type === 'MINI_BUBBLE_EXPIRED' ||
          event.type === 'ROCKET_EXPIRED' ||
          event.type === 'MINI_ROCKET_EXPIRED' ||
          event.type === 'BANANA_EXPIRED' ||
          event.type === 'WILD_BANANA_EXPIRED' ||
          event.type === 'QP_TRACK_REWARD_GRANTED'
        ) {
          return false
        }
        return true
      })
      .map((event) => {
        const details = formatEventDetails(event, nameById)
        return {
          event,
          ...details,
        }
      })
  }, [events, nameById])

  const filteredEvents = useMemo(() => {
    return parsedEvents.filter((item) => {
      if (category !== 'all' && item.category !== category) return false
      if (selectedPlayerId !== 'all') {
        if (item.event.sourcePlayerId !== selectedPlayerId && item.event.targetPlayerId !== selectedPlayerId) {
          return false
        }
      }
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase()
        const matchTitle = item.title.toLowerCase().includes(query)
        const matchDesc = item.description.toLowerCase().includes(query)
        if (!matchTitle && !matchDesc) return false
      }
      return true
    })
  }, [parsedEvents, category, selectedPlayerId, searchQuery])

  // Count categories
  const counts = useMemo(() => {
    const res = { all: parsedEvents.length, combat: 0, speed: 0, pickup: 0, finish: 0 }
    for (const e of parsedEvents) {
      if (e.category === 'combat') res.combat++
      else if (e.category === 'speed') res.speed++
      else if (e.category === 'pickup') res.pickup++
      else if (e.category === 'finish') res.finish++
    }
    return res
  }, [parsedEvents])

  return (
    <section className="rounded-3xl border-4 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-panel)] p-5 shadow-[0_6px_0_var(--color-ggd-outline)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
        <div>
          <div className="text-xs font-black tracking-[0.2em] text-[var(--color-ggd-gold)]">NHẬT KÝ ĐƯỜNG ĐUA</div>
          <h2 className="mt-1 font-display text-2xl">📜 Diễn Biến Sự Kiện ({parsedEvents.length})</h2>
        </div>

        {/* Player Selector Filter */}
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="player-timeline-filter" className="sr-only">Lọc theo vịt</label>
          <select
            id="player-timeline-filter"
            value={selectedPlayerId}
            onChange={(e) => setSelectedPlayerId(e.target.value)}
            className="rounded-xl border-2 border-white/20 bg-black/40 px-3 py-1.5 text-xs font-bold text-white focus:border-[var(--color-ggd-gold)] focus:outline-none"
          >
            <option value="all">🦆 Tất cả tuyển thủ</option>
            {players.map((p) => (
              <option key={p.playerId} value={p.playerId}>
                {p.name} {p.isGhost ? '(Ghost)' : ''}
              </option>
            ))}
          </select>

          <input
            type="text"
            placeholder="Tìm kiếm sự kiện..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="rounded-xl border-2 border-white/20 bg-black/40 px-3 py-1.5 text-xs font-bold text-white placeholder:text-white/35 focus:border-[var(--color-ggd-gold)] focus:outline-none"
          />
        </div>
      </div>

      {/* Category Pills */}
      {showCategoryFilter && (
        <div className="mt-3 flex flex-wrap gap-1.5 border-b border-white/10 pb-3 text-xs">
          <button
            type="button"
            onClick={() => setCategory('all')}
            className={`rounded-lg px-3 py-1 font-black transition ${
              category === 'all' ? 'bg-[var(--color-ggd-gold)] text-[var(--color-ggd-outline)]' : 'bg-black/30 text-white/60 hover:text-white'
            }`}
          >
            Tất cả ({counts.all})
          </button>
          <button
            type="button"
            onClick={() => setCategory('combat')}
            className={`rounded-lg px-3 py-1 font-black transition ${
              category === 'combat' ? 'bg-rose-500 text-white' : 'bg-black/30 text-white/60 hover:text-white'
            }`}
          >
            💥 Giao tranh ({counts.combat})
          </button>
          <button
            type="button"
            onClick={() => setCategory('speed')}
            className={`rounded-lg px-3 py-1 font-black transition ${
              category === 'speed' ? 'bg-[var(--color-ggd-neon-green)] text-[var(--color-ggd-outline)]' : 'bg-black/30 text-white/60 hover:text-white'
            }`}
          >
            ⚡ Tốc độ ({counts.speed})
          </button>
          <button
            type="button"
            onClick={() => setCategory('pickup')}
            className={`rounded-lg px-3 py-1 font-black transition ${
              category === 'pickup' ? 'bg-teal-400 text-[var(--color-ggd-outline)]' : 'bg-black/30 text-white/60 hover:text-white'
            }`}
          >
            🎁 Hộp quà & Bẫy ({counts.pickup})
          </button>
          <button
            type="button"
            onClick={() => setCategory('finish')}
            className={`rounded-lg px-3 py-1 font-black transition ${
              category === 'finish' ? 'bg-amber-400 text-[var(--color-ggd-outline)]' : 'bg-black/30 text-white/60 hover:text-white'
            }`}
          >
            🏁 Cán đích ({counts.finish})
          </button>
        </div>
      )}

      {/* Events List */}
      <div className={`mt-3 space-y-2 overflow-y-auto pr-1 ${maxHeight}`}>
        {filteredEvents.length === 0 ? (
          <div className="py-8 text-center text-sm text-white/45">
            Không có sự kiện nào phù hợp bộ lọc.
          </div>
        ) : (
          filteredEvents.map((item, idx) => {
            const isCurrent = typeof currentTick === 'number' && Math.abs(item.event.tick - currentTick) <= 30
            const sourceAvatar = item.event.sourcePlayerId ? avatarById.get(item.event.sourcePlayerId) : null
            const sourceName = item.event.sourcePlayerId ? (nameById.get(item.event.sourcePlayerId) ?? item.event.sourcePlayerId) : ''

            return (
              <div
                key={`${item.event.tick}-${item.event.type}-${item.event.sourcePlayerId}-${idx}`}
                className={`flex items-start gap-3 rounded-2xl border-2 p-3 transition ${item.tone} ${
                  isCurrent ? 'ring-2 ring-[var(--color-ggd-gold)] ring-offset-2 ring-offset-[#112b3b]' : ''
                }`}
              >
                <div className="flex flex-col items-center">
                  <span className="text-2xl">{item.icon}</span>
                  <span className="mt-1 font-mono text-[10px] font-black opacity-60">
                    {formatRaceTime(item.event.timestampWithinRaceMs)}
                  </span>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {sourceName && (
                      <div className="flex items-center gap-1.5 font-black text-white">
                        <Season3Avatar name={sourceName} avatarUrl={sourceAvatar} size={20} />
                      </div>
                    )}
                    <span className="font-black">{item.title}</span>
                  </div>
                  {item.description && (
                    <p className="mt-0.5 text-xs opacity-85 leading-relaxed">{item.description}</p>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
    </section>
  )
}
