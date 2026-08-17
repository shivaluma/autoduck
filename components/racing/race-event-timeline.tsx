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
  STICKY_GOO: 'Vũng Keo 🟢',
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
        description: 'Tất cả các chú vịt lao vào dòng nước tranh tài!',
        category: 'speed',
        tone: 'text-[var(--color-ggd-gold)] border-amber-500/30 bg-amber-500/10',
      }

    case 'ROCKET_FIRED':
    case 'MINI_ROCKET_FIRED': {
      const isMini = event.type === 'MINI_ROCKET_FIRED'
      return {
        icon: '🚀',
        title: `${sourceName} phóng ${isMini ? 'Mini Rocket' : 'Tên Lửa Tầm Nhiệt'} 🚀`,
        description: targetName
          ? `Khóa mục tiêu bắn thẳng vào ${targetName} phía trước!`
          : `Phóng ${isMini ? 'tên lửa mini' : 'tên lửa tầm nhiệt'} truy đuổi nhóm dẫn đầu!`,
        category: 'combat',
        tone: 'text-rose-400 border-rose-500/30 bg-rose-500/10',
      }
    }

    case 'ROCKET_HIT':
    case 'MINI_ROCKET_HIT': {
      const isMini = event.type === 'MINI_ROCKET_HIT'
      return {
        icon: '💥',
        title: `${sourceName} 🚀 bắn trúng ${targetName || 'mục tiêu'}! (Thành công ✅)`,
        description: isMini
          ? `${targetName || 'Mục tiêu'} trúng đòn Mini Rocket của ${sourceName}, bị phá tăng tốc và hãm tốc độ 50%!`
          : `${targetName || 'Mục tiêu'} trúng Tên Lửa của ${sourceName}, bị triệt tiêu tăng tốc và hãm tốc độ mạnh!`,
        category: 'combat',
        tone: 'text-rose-500 border-rose-500/40 bg-rose-500/20',
      }
    }

    case 'ROCKET_BLOCKED':
    case 'MINI_ROCKET_BLOCKED': {
      const defense = String(event.metadata.defense ?? 'BUBBLE_SHIELD')
      let reasonText = `dùng Khiên Bong Bóng (Bubble Shield 🫧) chặn đứng`
      if (defense === 'MINI_BUBBLE') reasonText = `dùng Mini Bubble 🫧 chặn đứng`
      else if (defense === 'IMMUNITY') reasonText = `đang trong thời gian Miễn Nhiễm (Immunity 🛡️), vô hiệu hóa`

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
        description: targetName ? `Tên lửa nhắm vào ${targetName} hết tầm bay hoặc mục tiêu đã về đích.` : 'Tên lửa không tìm thấy mục tiêu và tự hủy.',
        category: 'combat',
        tone: 'text-zinc-400 border-zinc-500/30 bg-zinc-500/10',
      }

    case 'BANANA_DROPPED':
    case 'WILD_BANANA_DROPPED': {
      const isWild = event.type === 'WILD_BANANA_DROPPED'
      return {
        icon: '🍌',
        title: `${sourceName} thả ${isWild ? 'Wild Banana' : 'Vỏ Chuối Bẫy'} 🍌`,
        description: 'Đặt bẫy chuối trơn trượt trên làn bơi ngáng đường đối thủ phía sau.',
        category: 'combat',
        tone: 'text-yellow-400 border-yellow-500/30 bg-yellow-500/10',
      }
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
      else if (defense === 'IMMUNITY') reasonText = `đang Miễn Nhiễm đòn đánh 🛡️, miễn nhiễm`

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
          ? `${sourceName} dùng Lông Vũ hộ thân nhảy né trọn vỏ chuối của ${targetName}!`
          : `${sourceName} dùng Lông Vũ lướt nhẹ né chướng ngại vật an toàn!`,
        category: 'combat',
        tone: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
      }

    case 'WILD_FEATHER_USED':
      return {
        icon: '🪽',
        title: `${sourceName} bật Feather Hop 🪽`,
        description: 'Kích hoạt trạng thái nhảy né trong 5 giây, sẵn sàng vượt qua bẫy chuối hoặc chướng ngại vật!',
        category: 'combat',
        tone: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10',
      }

    case 'HAZARD_DODGED':
      return {
        icon: '🪽',
        title: `${sourceName} nhảy né chướng ngại vật! 🪽`,
        description: 'Dùng Lông Vũ lướt nhẹ qua bẫy môi trường trên mặt nước an toàn!',
        category: 'combat',
        tone: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
      }

    case 'NITRO_STARTED':
      return {
        icon: '⚡',
        title: `${sourceName} bứt tốc Nitro! ⚡`,
        description: 'Kích hoạt Bình Tăng Tốc Nitro +25% tốc độ trong 2.0s xé gió vượt lên!',
        category: 'speed',
        tone: 'text-[var(--color-ggd-neon-green)] border-emerald-500/30 bg-emerald-500/10',
      }

    case 'PADDLE_BURST_STARTED':
      return {
        icon: '🛶',
        title: `${sourceName} quạt nước Paddle Burst! 🛶`,
        description: 'Quạt nước tăng tốc +18% trong 1.8s ở chặng cuối lội ngược dòng ngoạn mục!',
        category: 'speed',
        tone: 'text-lime-400 border-lime-500/30 bg-lime-500/10',
      }

    case 'DRAFT_FIN_STARTED':
      return {
        icon: '🦈',
        title: `${sourceName} bám đuôi Draft Fin! 🦈`,
        description: 'Bám sát đuôi đối thủ phía trước, đón luồng lướt gió tăng tốc +20% trong 1.6s!',
        category: 'speed',
        tone: 'text-cyan-400 border-cyan-500/30 bg-cyan-500/10',
      }

    case 'TAILWIND_STARTED':
      return {
        icon: '🌊',
        title: `${sourceName} đón gió Thuận Gió (Tailwind)! 🌊`,
        description: 'Gió xuôi trợ lực +20% tốc độ và bơi ổn định giữ làn trong 3.0s!',
        category: 'speed',
        tone: 'text-teal-300 border-teal-500/30 bg-teal-500/10',
      }

    case 'MAGNET_STARTED':
      return {
        icon: '🧲',
        title: `${sourceName} kích hoạt Nam Châm Hút Tốc! 🧲`,
        description: 'Nam châm hút vịt bám sát luồng bơi của đối thủ gần nhất phía trước (+18% tốc độ trong 1.6s)!',
        category: 'speed',
        tone: 'text-indigo-300 border-indigo-500/30 bg-indigo-500/10',
      }

    case 'PREDATOR_RUSH_STARTED':
      return {
        icon: '🔥',
        title: `${sourceName} kích hoạt Predator Rush! 🔥`,
        description: 'Nội tại Menace trỗi dậy! Tấn công trúng đích kích hoạt đợt tăng tốc +20% hung hãn!',
        category: 'combat',
        tone: 'text-orange-400 border-orange-500/30 bg-orange-500/10',
      }

    case 'BOOST_BROKEN': {
      const breakSource = String(event.metadata.source ?? 'ROCKET')
      let causeText = 'trúng đòn Tên Lửa'
      if (breakSource.includes('BANANA')) causeText = 'giẫm phải Vỏ Chuối'
      else if (breakSource.includes('HORN')) causeText = 'trúng sóng âm Quack Horn'

      return {
        icon: '💥',
        title: `${sourceName} bị bẻ gãy đợt tăng tốc!`,
        description: `${sourceName} bị ngắt ngay đợt bứt tốc do ${causeText}${targetName ? ` từ ${targetName}` : ''}!`,
        category: 'combat',
        tone: 'text-rose-400 border-rose-500/40 bg-rose-500/15',
      }
    }

    case 'HORN_USED':
    case 'WILD_HORN_USED':
      return {
        icon: '🔊',
        title: `${sourceName} thổi Còi Quack Horn! 🔊`,
        description: 'Sóng xung kích cực mạnh húc dạt các vịt bơi sát cạnh và khóa trang bị (Câm Lặng 2.5s)!',
        category: 'combat',
        tone: 'text-purple-400 border-purple-500/30 bg-purple-500/10',
      }

    case 'ITEM_SILENCED':
      return {
        icon: '🔇',
        title: `${sourceName} bị Câm Lặng (Silenced)! 🔇`,
        description: 'Bị sóng âm khóa trang bị, không thể sử dụng item trong 2.5 giây!',
        category: 'combat',
        tone: 'text-purple-300 border-purple-500/30 bg-purple-500/15',
      }

    case 'BUBBLE_SHIELD_ACTIVATED':
    case 'MINI_BUBBLE_ACTIVATED': {
      const isMini = event.type === 'MINI_BUBBLE_ACTIVATED'
      return {
        icon: '🫧',
        title: `${sourceName} bật ${isMini ? 'Mini Bubble' : 'Khiên Bong Bóng'} 🫧`,
        description: isMini
          ? 'Lớp màng bảo vệ cầm tay kích hoạt, chặn 1 đòn tấn công hoặc bẫy trong 6 giây.'
          : 'Lớp màng phòng hộ kích hoạt, chặn đứng hoàn toàn 1 đòn tấn công hoặc bẫy.',
        category: 'combat',
        tone: 'text-sky-300 border-sky-500/30 bg-sky-500/10',
      }
    }

    case 'BUBBLE_POPPED':
      return {
        icon: '💥',
        title: `Khiên của ${sourceName} vỡ nổ đẩy tốc! 🫧`,
        description: 'Khiên bảo vệ đã hoàn thành nhiệm vụ đỡ đòn và tạo luồng đẩy bứt tốc +8%!',
        category: 'combat',
        tone: 'text-sky-200 border-sky-500/20 bg-sky-500/10',
      }

    case 'SHOCK_ABSORBER_PROC':
      return {
        icon: '🦺',
        title: `${sourceName} kích hoạt Áo Chống Sốc! 🦺`,
        description: 'Áo giáp giảm chấn hấp thụ lực va chạm, giảm 50% thời gian hãm tốc và 60% lực húc!',
        category: 'combat',
        tone: 'text-indigo-400 border-indigo-500/30 bg-indigo-500/10',
      }

    case 'GOLDEN_BOX_COLLECTED':
      return {
        icon: '🪙',
        title: `${sourceName} nhặt được Hộp Vàng! 🪙`,
        description: 'Nhanh tay chạm vào Hộp Vàng bí ẩn trên dòng nước, nhận ngay +1 Quack Point (QP)!',
        category: 'pickup',
        tone: 'text-[var(--color-ggd-gold)] border-amber-500/40 bg-amber-500/20 font-black',
      }

    case 'PICKUP_COLLECTED':
    case 'WILD_ITEM_GRANTED':
      return {
        icon: '🎁',
        title: `${sourceName} mở Hộp Quà 🎁`,
        description: itemName ? `Nhận được ${itemName} vào túi đồ Wild Item!` : 'Mở hộp nhận thêm một vật phẩm đường đua!',
        category: 'pickup',
        tone: 'text-teal-400 border-teal-500/30 bg-teal-500/10',
      }

    case 'INSTANT_PICKUP_TRIGGERED':
      return {
        icon: '⚡',
        title: `${sourceName} kích hoạt ${itemName} ⚡`,
        description: `Nhặt được vật phẩm Kích Hoạt Ngay (${itemName}) và phát huy tác dụng tức thì!`,
        category: 'speed',
        tone: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
      }

    case 'WILD_ITEM_MANUAL_INPUT':
      return {
        icon: '🎯',
        title: `${sourceName} chủ động dùng ${itemName} 🎯`,
        description: `${sourceName} canh thời điểm chuẩn xác và tự tay bấm nút kích hoạt vật phẩm!`,
        category: 'combat',
        tone: 'text-violet-400 border-violet-500/30 bg-violet-500/10',
      }

    case 'WILD_ITEM_USED':
    case 'WILD_ITEM_AUTO_USED':
      return {
        icon: '🎒',
        title: `${sourceName} sử dụng ${itemName}`,
        description: `${sourceName} kích hoạt vật phẩm Wild Item mang theo!`,
        category: 'combat',
        tone: 'text-cyan-400 border-cyan-500/30 bg-cyan-500/10',
      }

    case 'PICKUP_SKIPPED_SLOT_FULL':
      return {
        icon: '🎒',
        title: `${sourceName} bỏ qua Hộp Quà`,
        description: 'Túi đồ Wild Item đã đầy (đang giữ item khác), nhường hộp cho đối thủ.',
        category: 'pickup',
        tone: 'text-zinc-400 border-zinc-500/20 bg-zinc-500/10',
      }

    case 'HAZARD_HIT': {
      const hazardType = String(event.metadata.hazardType ?? '')
      const hazardName = HAZARD_NAME_MAP[hazardType] || 'Chướng ngại vật'
      return {
        icon: '⚠️',
        title: `${sourceName} va phải ${hazardName}!`,
        description: `Bị cản trở và giảm tốc độ trên dòng nước bởi ${hazardName}!`,
        category: 'pickup',
        tone: 'text-rose-400 border-rose-500/30 bg-rose-500/10',
      }
    }

    case 'DUCK_FINISHED': {
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
    }

    case 'CHAOS_RESOLVED':
      return {
        icon: '🃏',
        title: 'Phán quyết lá bài Chaos!',
        description: String(event.metadata.summary ?? 'Đã xác định người chịu phạt sẹo và người an toàn theo luật Chaos tuần này.'),
        category: 'finish',
        tone: 'text-[var(--color-ggd-orange)] border-[var(--color-ggd-orange)]/40 bg-[var(--color-ggd-orange)]/15 font-black',
      }

    default:
      return {
        icon: '📌',
        title: `${sourceName}: ${event.type.replaceAll('_', ' ')}`,
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
