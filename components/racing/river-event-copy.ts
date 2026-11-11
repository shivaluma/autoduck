import type { RaceEvent } from '@/src/engine/protocol'

/** Names and copy of the river events (engine S3.17), shared by the race canvas and the timeline. */
export type RiverEventKind = 'FLASH_FLOOD' | 'WHIRLPOOL' | 'GUST' | 'BREAD_RAIN'

export const RIVER_EVENT_COPY: Record<RiverEventKind, { icon: string; name: string; warning: string; active: string; tint: number; accent: string }> = {
  FLASH_FLOOD: { icon: '🌊', name: 'LŨ QUÉT', warning: 'Lũ sắp đổ về: vịt càng tụt xa càng được cuốn lên!', active: 'Càng tụt xa, càng trôi nhanh!', tint: 0x38bdf8, accent: '#7dd3fc' },
  WHIRLPOOL: { icon: '🌀', name: 'VỰC XOÁY', warning: 'Top 3 sắp bị hút ngược lại!', active: 'Top 3 đang bị vực xoáy giữ chân!', tint: 0xa78bfa, accent: '#c4b5fd' },
  GUST: { icon: '🌬️', name: 'GIÓ LỐC', warning: 'Mỗi vịt một luồng gió: hên xui!', active: 'Gió đẩy vịt này, cản vịt kia!', tint: 0xe2e8f0, accent: '#f1f5f9' },
  BREAD_RAIN: { icon: '🍞', name: 'MƯA BÁNH MÌ', warning: 'Nửa sau đoàn đua sắp được tiếp sức!', active: 'Nửa sau đoàn đua lao vào ăn!', tint: 0xfbbf24, accent: '#fde68a' },
}

export function isRiverEventKind(value: unknown): value is RiverEventKind {
  return typeof value === 'string' && value in RIVER_EVENT_COPY
}

/** The one-line feed message of a river event, or null for other events. */
export function riverEventFeedLine(raceEvent: RaceEvent): string | null {
  const kind = raceEvent.metadata.kind
  if (!isRiverEventKind(kind)) return null
  const copy = RIVER_EVENT_COPY[kind]
  if (raceEvent.type === 'RIVER_EVENT_WARNING') return `⚠️ ${copy.icon} ${copy.name} sắp đến!`
  if (raceEvent.type === 'RIVER_EVENT_STARTED') return `${copy.icon} ${copy.name}! ${copy.active}`
  return null
}
