/**
 * OpenRouter Gemini Integration for Race Commentary
 * Endpoint: https://openrouter.ai/api/v1/chat/completions
 * Model: google/gemini-2.5-flash
 */

import { CommentaryHistory } from './ai-zai'

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ''
const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'
const MODEL = 'google/gemini-3-flash-preview'

const SYSTEM_PROMPT = `Bạn là BLV Đua Vịt hệ "Chiến Thần Mỏ Hỗn Đa Vũ Trụ".
Phong cách: Trịch thượng, xéo xắt, cực đoan, nhưng lại nói những câu triết lý xàm xí, ví von dài dòng và đầy tính drama.
Mục tiêu: Biến một cuộc đua vịt vô tri thành một vở bi kịch múa lân, một khóa học đầu tư tài chính, hoặc một bộ phim tình cảm đẫm nước mắt.

CÁCH THỨC BÌNH LUẬN (QUAN TRỌNG):
Thay vì chỉ mô tả "Zịt A chạy nhanh", hãy dùng các phép ẩn dụ/ví von dông dài (3-4 câu) thuộc các Chủ Đề sau để sỉ nhục hoặc tâng bốc:
1. Đầu tư/Tài chính: "Đầu tư vào momentum từ đầu đua, giờ lỗ vỡ mặt cả vốn lẫn lãi", "Cổ phiếu blue-chip", "Margin call", "Catfish", "Fomo".
2. Tình yêu bế tắc: "Hứa hẹn lần đầu yêu", "Bỏ rơi như công dân không chính thức", "Học cách người yêu cũ chạy", "Nhanh như cách người yêu cũ lật mặt".
3. Triết lý sống giả trân: "Lắng nghe nhịp tim cuộc sống", "Tìm kiếm sự bình yên", "Học cách sống với thất bại cực kỳ trưởng thành", "Sắc dục là xiềng xích", "Ngồi đợi Bụt hiện lên".
4. Dân IT đáy xã hội: "Fix bug server", "Deadline dí mông chiều thứ 7", "Dính breakpoint", "Out trình cả server".

QUY TẮC VÀNG:
- KHÔNG BAO GIỜ dùng từ đệm nhạt nhẽo ("ơi", "à", "nhé").
- Hãy viết dài hơn một chút (khoảng 3-4 câu, ~60-90 từ), lồng ghép thật mượt các phép ví von. Chữi Kẻ Bết Bát bằng giọng điệu thương hại mỉa mai, tâng bốc Kẻ Dẫn Đầu bằng sự ghen tị hoặc bợ đỡ lố lăng.
- Mỗi câu bình luận phải là một "văn mẫu" do chính bạn tự chế tác ngay lúc đó, lấy cảm hứng từ các Chủ Đề trên. KHÔNG CẦN CỐ ĐỊNH 100% CÂU CHỮ, HÃY PHÓNG TÁC!

QUY TẮC CHỐNG LẶP (QUAN TRỌNG NHẤT):
- CẤM lặp lại idea của câu bình luận trước. Nếu câu trước nói về "Đầu tư", câu này PHẢI chuyển sang "Tình yêu" hoặc "IT". 
- Tuyệt đối né các cụm từ đã xuất hiện trong LỊCH SỬ BÌNH LUẬN! Hãy liên tục vắt óc nghĩ ra trò mới!`

function buildPrompt(
  timestampSeconds: number,
  isRaceEnd: boolean,
  participantNames?: string,
  history?: CommentaryHistory[],
  raceResults?: string
): string {
  const participants = participantNames ? participantNames.split(',').map(n => n.trim()) : []
  const mentions: Record<string, number> = {}
  participants.forEach(p => mentions[p] = 0)

  if (history) {
    history.forEach(h => {
      participants.forEach(p => {
        if (h.text.includes(p)) mentions[p]++
      })
    })
  }

  const sortedDucks = [...participants].sort((a, b) => mentions[a] - mentions[b])
  const coldDucks = sortedDucks.filter(p => mentions[p] === 0)
  const coolDucks = sortedDucks.filter(p => mentions[p] > 0 && mentions[p] <= 2)
  const hotDucks = sortedDucks.filter(p => mentions[p] > 2)

  let spotlightInstruction = ""
  if (coldDucks.length > 0) {
    spotlightInstruction = `\n🔦 ƯU TIÊN SPOTLIGHT (ĐANG TÀNG HÌNH): ${coldDucks.join(', ')} (Đào tụi này lên xem đang tấu hài gì).`
  } else if (coolDucks.length > 0) {
    spotlightInstruction = `\n🔦 ƯU TIÊN SPOTLIGHT (ÍT LÊN SÓNG): ${coolDucks.slice(0, 3).join(', ')}.`
  } else {
    spotlightInstruction = `\n🔦 SPOTLIGHT: Tự do tia drama cháy nhất, tém tém vụ nhắc lặp ${hotDucks.slice(0, 2).join(', ')}.`
  }

  const namesInfo = participantNames ? `\nCASTING: ${participantNames}.` : ''

  if (isRaceEnd) {
    let resultsInfo = ''
    let shieldContext = ''
    if (raceResults) {
      try {
        const ranking = JSON.parse(raceResults) as Array<{ rank: number; name: string; usedShield?: boolean }>
        const winner = ranking[0]?.name || 'unknown'
        const bottom2 = ranking.slice(-2)
        const shieldUsers = bottom2.filter(r => r.usedShield)
        const noShieldLosers = bottom2.filter(r => !r.usedShield)

        const winnerMentions = mentions[winner] || 0
        const darkHorse = winnerMentions === 0 ? " (Kẻ im lặng đáng sợ)" : ""

        resultsInfo = `\nKQ: 👑 VÔ ĐỊCH: ${winner}${darkHorse}`

        if (shieldUsers.length > 0 && noShieldLosers.length > 0) {
          const savedDuck = shieldUsers[0].name
          const unluckyDuck = noShieldLosers[0].name
          resultsInfo += ` | 🛡️ ${savedDuck} (DÙNG KHIÊN) | 💀 ${unluckyDuck} (BỊ SẸO)`
          shieldContext = `\nTWIST KHIÊN: ${savedDuck} buff khiên thoát kiếp bết bát ảo ma, đẩy ${unluckyDuck} ra chuồng gà ôm sẹo. Khịa căng đét vô!`
        } else if (shieldUsers.length === 0) {
          resultsInfo += ` | 💀 2 VỊT: ${bottom2.map(r => r.name).join(' & ')}`
          shieldContext = `\nTWIST KHIÊN: Hai báo thủ dắt tay nhau quên bật khiên, ôm sẹo chung cho có bạn có bè!`
        } else {
          resultsInfo += ` | 💀 KHIÊN VÔ DỤNG: ${bottom2.map(r => r.name).join(' & ')}`
          shieldContext = `\nTWIST KHIÊN: Nổ khiên sáng rực rỡ mà vẫn cút về chót, xui đỉnh nóc bay phấp phới luôn!`
        }
      } catch { /* ignore */ }
    }

    const historyContext = history && history.length > 0
      ? `\n🚫 TRÁNH DÙNG LẠI VĂN NÀY:\n${history.map(h => `- ${h.text}`).join('\n')}`
      : ''

    return `${SYSTEM_PROMPT}\n\nTÌNH HUỐNG: VỀ ĐÍCH!${namesInfo}${resultsInfo}${shieldContext}${historyContext}\n\nNHIỆM VỤ: Viết 1 đoạn chốt hạ cực gắt, dài khoảng 3-4 câu (~60-90 từ).\n- Tùy diễn biến mà phóng tác ra 1 đoạn văn lố lăng để vinh danh Quán quân HOẶC chửi rủa sự ngu ngốc của Kẻ bết bát.\n- Nếu Thomas thắng/thua: Khịa cực mạnh tay.\n- TRÁNH XA các idea đã dùng trong LỊCH SỬ BÌNH LUẬN.`
  }

  const historyInfo = history && history.length > 0
    ? `\n🚫 LỊCH SỬ BÌNH LUẬN (TUYỆT ĐỐI KHÔNG DÙNG LẠI CHẤT VĂN Ở DƯỚI):\n${history.map(h => `- ${h.timestamp}s: ${h.text}`).join('\n')}`
    : '\n(Chưa bình luận gì, tự do xõa ngôn từ)'

  let focusStrategy = ""
  if (timestampSeconds <= 5) {
    focusStrategy = "KHỞI ĐỘNG: Đứa nào bứt tốc flex sức mạnh? Đứa nào đứng hình dính breakpoint?"
  } else if (timestampSeconds <= 20) {
    focusStrategy = "DIỄN BIẾN: Khúc cua gắt! Lật kèo phút 90 cỡ nào? Ai đang hít khói khóc thét?"
  } else {
    focusStrategy = "VỀ ĐÍCH: Ai sắp lụm cúp hiệu năng đỉnh? Ai kiếp nạn thứ 82 ngã sấp mặt?"
  }

  return `${SYSTEM_PROMPT}\n\nTHỜI GIAN: Giây ${timestampSeconds}/36.\nTRẠNG THÁI: ${focusStrategy}${spotlightInstruction}${namesInfo}${historyInfo}\nHÌNH ẢNH: Quan sát ảnh.\n\nNHIỆM VỤ: Viết 1 bình luận lố lăng, xéo xắt, độ dài khoảng 3-4 câu (~60-90 từ).\n- Phân tích tấm ảnh -> Bịa ra một câu chuyện/phép ẩn dụ (Đầu tư, Tình yêu, Triết lý rởm...) để châm biếm tụi vịt.\n- CHỌN CHỦ ĐỀ MỚI TINH CHƯA XUẤT HIỆN TRONG \`LỊCH SỬ BÌNH LUẬN\`.\n- ÉP NHỜ GA: Hạn chế réo tên ${hotDucks.slice(0, 3).join(', ')}.\n- ĐÀO TẠO KHUẤT TẦM: Chửi rủa/Thương hại lố lăng ${coldDucks.join(', ') || coolDucks.join(', ')}.\n- Viết plain text mượt như đang nói trên sóng livestream.\n\nVIẾT NGAY:`
}

export async function generateGeminiCommentary(
  screenshotBase64: string,
  timestampSeconds: number,
  isRaceEnd: boolean = false,
  participantNames?: string,
  history?: CommentaryHistory[],
  raceResults?: string
): Promise<string> {
  if (!OPENROUTER_API_KEY) {
    console.warn('OPENROUTER_API_KEY not set')
    return getFallbackCommentary(timestampSeconds, isRaceEnd)
  }

  try {
    const prompt = buildPrompt(timestampSeconds, isRaceEnd, participantNames, history, raceResults)
    const rawBase64 = screenshotBase64.replace(/^data:image\/w+;base64,/, '')
    const imageUrl = `data:image/jpeg;base64,${rawBase64}`

    const response = await fetch(OPENROUTER_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://autoduck.shivaluma.com', // Optional, for OpenRouter rankings
        'X-Title': 'AutoDuck', // Optional, for OpenRouter rankings
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 250,
        temperature: 0.85,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageUrl } },
            ],
          },
        ],
      }),
    })

    if (!response.ok) {
      throw new Error((await response.text()))
    }

    const data = await response.json()
    let text = data.choices?.[0]?.message?.content || ''

    // Clean up
    text = text
      .replace(/^["']|["']$/g, '')
      .replace(/^(Giây \d+|Phút \d+).*?:/i, '')
      .replace(/(\r\n|\n|\r)/gm, " ")
      .replace(/---\s*.*/, "")
      .replace(/\*?Giải thích:.*$/i, "")
      .trim()

    console.log(`[Gemini][${timestampSeconds}s] ${text.substring(0, 60)}...`)
    return text || getFallbackCommentary(timestampSeconds, isRaceEnd)
  } catch (error) {
    console.error('Gemini API Error:', error)
    return getFallbackCommentary(timestampSeconds, isRaceEnd)
  }
}

function getFallbackCommentary(timestampSeconds: number, isRaceEnd: boolean): string {
  if (isRaceEnd) return 'Chấn động luôn! Đường đua kết thúc với hiệu năng cực đỉnh, kẻ báo thủ chính thức cook và ôm sẹo!'
  if (timestampSeconds <= 5) return 'Súng nổ rồi! Vừa vô đã flex gắt quá, có ai dính breakpoint chưa kịp load data không?'
  if (timestampSeconds <= 20) return 'Anh em chạy nhìn như đang chờ Deployment thế, nhiệt lên! Pha bứt tốc kinh điển cút luôn cái nết!'
  return 'Úi giời ơi! Lật kèo kinh điển phút chót! Cục diện đang cực kỳ hỗn loạn!'
}
