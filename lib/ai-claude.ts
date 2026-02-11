/**
 * Anthropic Claude 4.5 Haiku Integration for Race Commentary
 * V10: "Gen Z Meme Lord" + "Văn Mẫu" (Massive Example Bank)
 * Endpoint: https://api.anthropic.com/v1/messages
 */

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || ''
const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-haiku-4-5'

export const COMMENTARY_TIMESTAMPS = [0, 5, 10, 15, 20, 25, 30, 33]

const RACE_DURATION = 36

export interface CommentaryHistory {
  timestamp: number
  text: string
}

const SYSTEM_PROMPT = `Bạn là BLV đua vịt realtime, quan sát toàn bộ đường đua như camera bay.

NHIỆM VỤ:
- Mỗi timestamp phải quét toàn frame, sau đó chọn góc thú vị nhất.
- Luân phiên spotlight: Nhóm dẫn đầu -> Nhóm giữa -> Kẻ tụt lại.
- KHÔNG LẶP LẠI nhân vật chính quá 2 lần liên tiếp.

ƯU TIÊN DRAMA:
- Chọn con có thay đổi vị trí lớn nhất (vượt nhiều, tụt mạnh, tách nhóm).
- Nếu 2 câu trước đã nói về Top, câu này PHẢI nói về Mid hoặc Bottom.

ĐỘ DÀI & CẤU TRÚC:
- 1 câu là chuẩn (Tối đa 2 câu). 10–26 từ.
- [Chuyển động đáng chú ý nhất] → [Punchline].

NGUYÊN TẮC CAMERA:
- 0–10s: Giới thiệu nhiều vịt, ai ngủ quên? ai bứt tốc?
- 10–25s: Cạnh tranh gay gắt, focus vào các cuộc lật đổ (Quay xe).
- 25s+: Tập trung vào Top + Kẻ tuyệt vọng (Phùng Canh Mộ).
- Thomas là Sếp: Chỉ nhắc khi Nhất hoặc Bét.`

function buildPrompt(
  timestampSeconds: number,
  isRaceEnd: boolean,
  participantNames?: string,
  history?: CommentaryHistory[],
  raceResults?: string
): string {
  // Analyze interactions to find "Cold" ducks (rarely mentioned)
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

  // Sort ducks by mentions (Ascending)
  const sortedDucks = [...participants].sort((a, b) => mentions[a] - mentions[b])
  const coldDucks = sortedDucks.filter(p => mentions[p] === 0)
  const coolDucks = sortedDucks.filter(p => mentions[p] > 0 && mentions[p] <= 2)
  const hotDucks = sortedDucks.filter(p => mentions[p] > 2)

  let spotlightInstruction = ""
  if (coldDucks.length > 0) {
    spotlightInstruction = `\n🔦 ƯU TIÊN SPOTLIGHT (CHƯA ĐƯỢC NHẮC): ${coldDucks.join(', ')} (Hãy tìm xem chúng đang làm gì).`
  } else if (coolDucks.length > 0) {
    spotlightInstruction = `\n🔦 ƯU TIÊN SPOTLIGHT (ÍT ĐƯỢC NHẮC): ${coolDucks.slice(0, 3).join(', ')}.`
  } else {
    spotlightInstruction = `\n🔦 SPOTLIGHT: Tự do chọn vịt có drama nhất, tránh ${hotDucks.slice(0, 2).join(', ')} nếu vừa nhắc.`
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

        // Count mentions for final recap logic
        const winnerMentions = mentions[winner] || 0
        const darkHorse = winnerMentions === 0 ? " (Kẻ im lặng đáng sợ)" : ""

        resultsInfo = `\nKQ: 👑 VÔ ĐỊCH: ${winner}${darkHorse}`

        if (shieldUsers.length > 0 && noShieldLosers.length > 0) {
          const savedDuck = shieldUsers[0].name
          const unluckyDuck = noShieldLosers[0].name
          resultsInfo += ` | 🛡️ ${savedDuck} (DÙNG KHIÊN) | 💀 ${unluckyDuck} (BỊ SẸO)`
          shieldContext = `\nTWIST KHIÊN: ${savedDuck} khôn (thoát), ${unluckyDuck} xui (dính sẹo). Cà khịa mạnh!`
        } else if (shieldUsers.length === 0) {
          resultsInfo += ` | 💀 2 VỊT: ${bottom2.map(r => r.name).join(' & ')}`
          shieldContext = `\nTWIST KHIÊN: Cả 2 đều "quên não" ở nhà, không dùng khiên nên dính sẹo!`
        } else {
          resultsInfo += ` | 💀 KHIÊN VÔ DỤNG: ${bottom2.map(r => r.name).join(' & ')}`
          shieldContext = `\nTWIST KHIÊN: Dùng khiên mà vẫn thua, đúng là "có làm mà không có ăn"!`
        }
      } catch { /* ignore */ }
    }

    // Include history to check for context in final verdict
    const historyContext = history && history.length > 0
      ? `\n🚫 TRÁNH LẶP LẠI (TỪ KHÓA ĐÃ DÙNG):\n${history.map(h => `- ${h.text}`).join('\n')}`
      : ''

    return `${SYSTEM_PROMPT}

TÌNH HUỐNG: VỀ ĐÍCH!${namesInfo}${resultsInfo}${shieldContext}${historyContext}

NHIỆM VỤ: Viết 1 câu chốt hạ (MAX 25 từ).
- Tuyên bố nhà vô địch bằng từ "đắt".
- Cà khịa cực gắt kẻ thua cuộc (đặc biệt vụ dùng khiên).
- Nếu Thomas thắng/thua đặc biệt: "Sếp thị uy" hoặc "Sếp nhường".

Ví dụ: "Zịt A về nhất quá đỉnh, còn Zịt B dùng khiên thoát nạn trong gang tấc để Zịt C ôm sẹo ngậm ngùi!"`
  }

  // Define historyInfo for in-race prompt
  const historyInfo = history && history.length > 0
    ? `\n🚫 TRÁNH LẶP LẠI (TỪ KHÓA ĐÃ DÙNG):\n${history.map(h => `- ${h.text}`).join('\n')}`
    : '\n(Chưa có kịch bản)'

  // Dynamic context based on race phase
  let focusStrategy = ""
  if (timestampSeconds <= 5) {
    focusStrategy = "KHỞI ĐỘNG: Ai bứt tốc? Ai ngủ quên? (Hài hước)"
  } else if (timestampSeconds <= 20) {
    focusStrategy = "DIỄN BIẾN: Ai đang lật kèo (Quay xe)? Ai đang hít khói? (Kịch tính)"
  } else {
    focusStrategy = "VỀ ĐÍCH: Ai sắp Win? Ai tuyệt vọng Phùng Canh Mộ? (Gấp gáp)"
  }

  return `${SYSTEM_PROMPT}

THỜI GIAN: Giây ${timestampSeconds}/36.
TRẠNG THÁI: ${focusStrategy}${spotlightInstruction}${namesInfo}${historyInfo}
HÌNH ẢNH: Quan sát ảnh.

NHIỆM VỤ: Viết 1 bình luận "sắc lẹm" (MAX 20-30 từ).
- Quan sát ảnh -> Mô tả nhanh (Ai lên/xuống?) -> Thêm Twist hài hước.
- KHÔNG dùng từ điển cố định (Thanh Nộ...). Hãy tự do sáng tạo.
- HẠN CHẾ NHẮC LẠI: ${hotDucks.slice(0, 3).join(', ')} (Trừ khi có biến cực căng).
- ƯU TIÊN NHẮC: ${coldDucks.join(', ') || coolDucks.join(', ')}.

VIẾT NGAY:`
}

interface AnthropicResponse {
  content: Array<{
    type: string
    text: string
  }>
}

export async function generateClaudeCommentary(
  screenshotBase64: string,
  timestampSeconds: number,
  isRaceEnd: boolean = false,
  participantNames?: string,
  history?: CommentaryHistory[],
  raceResults?: string
): Promise<string> {
  if (!ANTHROPIC_API_KEY) {
    console.warn('ANTHROPIC_API_KEY not set')
    return getFallbackCommentary(timestampSeconds, isRaceEnd)
  }

  try {
    const prompt = buildPrompt(timestampSeconds, isRaceEnd, participantNames, history, raceResults)
    const rawBase64 = screenshotBase64.replace(/^data:image\/\w+;base64,/, '')

    const response = await fetch(ANTHROPIC_ENDPOINT, {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 90,
        temperature: 0.8, // Adjusted for spotlight rotation
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: 'image/jpeg', data: rawBase64 },
              },
              { type: 'text', text: prompt },
            ],
          },
        ],
      }),
    })

    if (!response.ok) {
      // Error handling
      throw new Error((await response.text()))
    }

    const data: AnthropicResponse = await response.json()
    let text = data.content?.[0]?.text || ''

    // Clean up
    text = text
      .replace(/^["']|["']$/g, '')
      .replace(/^(Giây \d+|Phút \d+).*?:/i, '')
      .replace(/(\r\n|\n|\r)/gm, " ")
      .replace(/---[\s\S]*/, "")
      .replace(/\*?Giải thích:.*$/i, "")
      .trim()

    console.log(`[Claude][${timestampSeconds}s] ${text.substring(0, 60)}...`)
    return text || getFallbackCommentary(timestampSeconds, isRaceEnd)
  } catch (error) {
    console.error('Anthropic API Error:', error)
    return getFallbackCommentary(timestampSeconds, isRaceEnd)
  }
}

function getFallbackCommentary(timestampSeconds: number, isRaceEnd: boolean): string {
  if (isRaceEnd) return 'Cuộc tình dù đúng dù sai, người về nhất vẫn là chân ái!'
  if (timestampSeconds <= 5) return 'Bắt đầu rồi! Em đi xa quá, em đi xa anh quá!'
  return 'Cuộc đua này là của chúng mình!'
}

export function shouldCaptureAt(
  elapsedSeconds: number,
  timestamps: number[],
  capturedSet: Set<number>
): number | null {
  for (const target of timestamps) {
    if (Math.abs(elapsedSeconds - target) < 0.5 && !capturedSet.has(target)) {
      capturedSet.add(target)
      return target
    }
  }
  return null
}