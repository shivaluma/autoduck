/** Vietnamese copy for Duck Brain temperaments and intents (timeline, canvas callouts). */

export const TEMPERAMENT_COPY: Record<string, { label: string; icon: string; blurb: string }> = {
  AGGRESSIVE: { label: 'Hổ Báo', icon: '🔥', blurb: 'Ra đòn sớm, thù dai, thích săn kẻ dẫn đầu.' },
  TACTICIAN: { label: 'Quân Sư', icon: '🧠', blurb: 'Ôm đồ chờ đúng thời điểm theo kế hoạch.' },
  OPPORTUNIST: { label: 'Cáo Già', icon: '🦊', blurb: 'Phản xạ nhanh, chuyên trừng phạt vịt đang bứt tốc.' },
  SHOWMAN: { label: 'Ngôi Sao', icon: '🎭', blurb: 'Để dành bài tẩy cho pha kết thúc nghẹt thở.' },
}

export function temperamentLabel(temperament: unknown) {
  const copy = TEMPERAMENT_COPY[String(temperament)]
  return copy ? `${copy.icon} ${copy.label}` : ''
}

export function intentCopy(intent: unknown, sourceName: string, targetName: string, itemName: string): { icon: string; title: string; description: string } {
  switch (String(intent)) {
    case 'HOLDING':
      return { icon: '⏳', title: `${sourceName} ôm ${itemName || 'đồ'} chờ thời`, description: 'Cố tình giữ lại để tung ra đúng khoảnh khắc theo kế hoạch.' }
    case 'HUNTING':
      return { icon: '🎯', title: `${sourceName} săn kẻ bỏ chạy ${targetName}`, description: `${targetName} đang bỏ xa cả đoàn — phải kéo lại ngay!` }
    case 'RETALIATING':
      return { icon: '😤', title: `${sourceName} trả đũa ${targetName}!`, description: `Ăn đòn từ ${targetName} lúc nãy, giờ là lúc đáp lễ.` }
    case 'RIVALRY':
      return { icon: '⚔️', title: `${sourceName} so kè kình địch ${targetName}`, description: 'Hai chú vịt bám nhau cả trận, không ai chịu nhường ai.' }
    case 'TEAM_PLAY':
      return { icon: '🤝', title: `${sourceName} ra đòn vì đồng đội`, description: targetName ? `Hạ ${targetName} để kéo điểm trung bình của đội lên.` : 'Tính toán cho thứ hạng cả đội.' }
    case 'BOUNTY':
      return { icon: '🤠', title: `${sourceName} nhắm vào kẻ bị truy nã ${targetName}`, description: 'Kết cục của Kẻ Bị Truy Nã quyết định ai phải nhận sẹo.' }
    case 'DESPERATE':
      return { icon: '🆘', title: `${sourceName} liều ăn nhiều!`, description: 'Đang kẹt trong vùng thua ở cuối trận — tung hết bài tẩy.' }
    case 'CLUTCH':
      return { icon: '🎭', title: `${sourceName} tung đòn quyết định!`, description: 'Song đấu sát nút cho ngôi đầu ở chặng cuối.' }
    case 'BREAKAWAY':
      return { icon: '💨', title: `${sourceName} bứt phá thoát đoàn`, description: 'Đang dẫn đầu và muốn nới rộng khoảng cách.' }
    default:
      return { icon: '🧠', title: `${sourceName} đổi chiến thuật`, description: '' }
  }
}
