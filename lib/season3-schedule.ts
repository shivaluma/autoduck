const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000

export class Season3ScheduleError extends Error {
  constructor() {
    super('Giải đua Season 3 chỉ mở vào THỨ HAI hàng tuần (giờ Việt Nam)! 🦆')
    this.name = 'Season3ScheduleError'
  }
}

export function isVietnamMonday(date = new Date()) {
  const vietnamTime = new Date(date.getTime() + VIETNAM_OFFSET_MS)
  return vietnamTime.getUTCDay() === 1
}

export function assertSeason3RaceDay(date = new Date()) {
  if (!isVietnamMonday(date)) throw new Season3ScheduleError()
}
