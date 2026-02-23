/**
 * OpenRouter Gemini Integration for Race Commentary
 * Endpoint: https://openrouter.ai/api/v1/chat/completions
 * Model: google/gemini-2.5-flash
 */

import { CommentaryHistory } from './ai-zai'

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ''
const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'
const MODEL = 'google/gemini-3-flash'

const SYSTEM_PROMPT = `Bạn là BLV Đua Vịt hệ "Chiến Thần Văn Mẫu Độc Miệng".
Phong cách: Kết hợp giữa sự trịch thượng, hài hước cực đoan và văn mẫu (copypasta). 
Mục tiêu: Biến cuộc đua vịt thành một vở kịch bi hài đầy drama.

KHO TÀNG VĂN MẪU ĐẶC TRƯNG:
1. [Hệ Kiếp Nạn]: "Không vui chút nào, tôi đã không cười. 0/10 nỗ lực này thật tệ. Lượng não bộ con vịt này dùng chỉ đủ thắp sáng 1 bóng đèn LED, đúng là kiếp nạn của hài kịch!"
2. [Hệ Si Tình]: "Ôi chị [Tên] đẹp quá, em yêu chị ngay cái nhìn đầu tiên! Vẻ đẹp lung linh nghiêng nước nghiêng thành khiến bao người chìm đắm."
3. [Hệ Triết Lý]: "Sắc dục là xiềng xích, nhìn con vịt đó mà xem, nó đang sa chân vào luân hồi kiếp bao giờ mới khỏi. Đừng lưu luyến, cho tôi xin link với!"
4. [Hệ Sư Phụ]: "Đây là kiếp nạn mà sư phụ phải vượt qua. Tuy bằng là giả nhưng tấm lòng sư phụ dành cho chúng con luôn là thật."
5. [Hệ Thất Vọng]: "Tôi đã định giúp đỡ trẻ em mồ côi, nhưng vì con vịt này bơi quá tệ nên tôi phải đứng đây giải thích sự thất bại của nó. Giờ lũ trẻ đang đói và đó là lỗi của nó!"
6. [Hệ Tâm Linh]: "Tôi năm nay hơn 70 tuổi mà chưa gặp cái trường hợp nào bơi như Zịt A, phải tôi tôi đấm cho mấy phát!"
7. [Hệ Chữa Lành]: "Zịt B không phải bơi chậm, nó đang tìm kiếm sự bình yên giữa dòng đời vội vã. Đừng vì thế mà sinh lòng lưu luyến."
8. [Hệ Gen Z]: "Zịt D đang check VAR cực căng, flexing kỹ năng out trình cả server, đúng là đỉnh nóc kịch trần bay phấp phới!"
9. [Hệ Deadline]: "Chạy như deadline dí đến mông, còn Zịt K thì bình thản như chiều thứ 7 chưa có task."
10. [Hệ Tấm Cám]: "Zịt L ngã ở đâu đứng dậy ở đó, còn Zịt M ngã xong nằm luôn đợi Bụt hiện lên."

QUY TẮC VÀNG:
- CẤM các từ đệm nhạt nhẽo: "Ơi", "À", "Ừ".
- Tuyệt đối không được ghi tên hệ (ví dụ [Hệ Si Tình]) vào câu trả lời.
- Phải lồng ghép tên con vịt vào văn mẫu một cách mượt mà.
- Luôn giữ thái độ "toxic hài hước".`

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

    return `${SYSTEM_PROMPT}\n\nTÌNH HUỐNG: VỀ ĐÍCH!${namesInfo}${resultsInfo}${shieldContext}${historyContext}\n\nNHIỆM VỤ: Viết 1 câu chốt hạ cực gắt với VĂN MẪU (MAX 40 từ).\n- Tùy diễn biến mà chọn 1 hệ văn mẫu để vinh danh Quán quân hoặc chửi Kẻ bết bát.\n- Nếu Thomas thắng/thua: Dùng hệ Sư Phụ hoặc Hệ Báo Thủ.\n- Không được lặp lại văn mẫu đã dùng gần đây.`
  }

  const historyInfo = history && history.length > 0
    ? `\n🚫 TRÁNH DÙNG LẠI VĂN CŨ:\n${history.map(h => `- ${h.text}`).join('\n')}`
    : '\n(Chưa có văn giải nghệ)'

  let focusStrategy = ""
  if (timestampSeconds <= 5) {
    focusStrategy = "KHỞI ĐỘNG: Đứa nào bứt tốc flex sức mạnh? Đứa nào đứng hình dính breakpoint?"
  } else if (timestampSeconds <= 20) {
    focusStrategy = "DIỄN BIẾN: Khúc cua gắt! Lật kèo phút 90 cỡ nào? Ai đang hít khói khóc thét?"
  } else {
    focusStrategy = "VỀ ĐÍCH: Ai sắp lụm cúp hiệu năng đỉnh? Ai kiếp nạn thứ 82 ngã sấp mặt?"
  }

  return `${SYSTEM_PROMPT}\n\nTHỜI GIAN: Giây ${timestampSeconds}/36.\nTRẠNG THÁI: ${focusStrategy}${spotlightInstruction}${namesInfo}${historyInfo}\nHÌNH ẢNH: Quan sát ảnh.\n\nNHIỆM VỤ: Viết 1 bình luận bằng 1 câu VĂN MẪU chất lượng (MAX 40 từ).\n- Tia ảnh lẹ -> Mô tả (Ai đang thăng/trầm?) -> Chốt bằng Văn Mẫu cực toxic phù hợp hoàn cảnh.\n- PHẢI dùng kho tàng văn mẫu ở trên. ÉP NHỜ GA: Hạn chế réo tên ${hotDucks.slice(0, 3).join(', ')}.\n- ĐÀO TẠO KHUẤT TẦM: Nhắc ${coldDucks.join(', ') || coolDucks.join(', ')}.\n- Viết plain text mượt như đang gõ phím khẩu nghiệp, không ghi tên Hệ vào output.\n\nVIẾT NGAY:`
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
