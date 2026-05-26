export const DRAGON_SYSTEM_TITLE = 'Thất Tinh Dzịt Châu'
export const DRAGON_COMPASS_TITLE = 'Thất Tinh La Bàn'
export const DRAGON_COLLECTION_TITLE = 'Tàng Châu Các'
export const DRAGON_TRADE_BOARD_TITLE = 'Sàn Đổi Châu'
export const DRAGON_TRADE_OFFER_TITLE = 'Kèo Đổi Châu'
export const DRAGON_SUMMON_ACTION = 'Khai Môn Triệu Long'
export const DRAGON_TITLE = 'Thần Long AutoDuck'
export const DRAGON_ITEM_LABEL = 'Long Lân Hộ Mệnh'
export const DRAGON_ITEM_SUBTITLE = 'Vảy Rồng'
export const DRAGON_HALL_TITLE = 'Long Điện Vinh Danh'
export const DRAGON_LOOT_TITLE = 'Chiến Lợi Phẩm Long Châu'

export const DRAGON_STARS = [1, 2, 3, 4, 5, 6, 7] as const
export type DragonStar = typeof DRAGON_STARS[number]

export const DRAGON_ORB_NAMES: Record<DragonStar, string> = {
  1: 'Nhất Tinh Châu',
  2: 'Nhị Tinh Châu',
  3: 'Tam Tinh Châu',
  4: 'Tứ Tinh Châu',
  5: 'Ngũ Tinh Châu',
  6: 'Lục Tinh Châu',
  7: 'Thất Tinh Châu',
}

export const DRAGON_TRADE_STATUS_COPY: Record<string, string> = {
  PENDING: 'Kèo đang treo',
  ACCEPTED: 'Kèo đã khớp',
  CANCELLED: 'Kèo đã hủy',
  EXPIRED: 'Kèo đã hết hạn',
  VOIDED: 'Kèo bị void',
}

export function isDragonStar(value: unknown): value is DragonStar {
  return typeof value === 'number' && DRAGON_STARS.includes(value as DragonStar)
}

export function assertDragonStar(value: unknown): asserts value is DragonStar {
  if (!isDragonStar(value)) {
    throw new Error(`Invalid Dragon Orb star: ${String(value)}`)
  }
}

export function getDragonOrbName(star: number) {
  assertDragonStar(star)
  return DRAGON_ORB_NAMES[star]
}
