/**
 * Z.AI GLM-4.6v Integration for Race Commentary
 * V10: "Gen Z Meme Lord" + "Văn Mẫu" (Massive Example Bank)
 * Endpoint: https://api.z.ai/api/coding/paas/v4/chat/completions
 */

const ZAI_API_KEY = process.env.Z_AI_API_KEY || ''
const ZAI_ENDPOINT = 'https://api.z.ai/api/coding/paas/v4/chat/completions'
const MODEL = 'glm-4.6v'

export const COMMENTARY_TIMESTAMPS = [0, 5, 10, 15, 20, 25, 30, 33]

const RACE_DURATION = 36

export interface CommentaryHistory {
  timestamp: number
  text: string
}

const SYSTEM_PROMPT = `Bạn là BLV đua vịt realtime, sắc bén và hài thông minh.

MỤC TIÊU:
- Tạo commentary khiến người xem muốn đọc tiếp toàn bộ trận.
- Nhanh, gọn, punchy, có giá trị giải trí cao.

ĐỘ DÀI:
- Tối đa 2 câu.
- Lý tưởng: 1 câu mạnh.
- 12–28 từ.

CẤU TRÚC BẮT BUỘC:
[Diễn biến thật trong race] → [Punchline bất ngờ]

NGUYÊN TẮC:
1. Ai vượt lên / tụt lại -> Phải báo ngay.
2. So sánh thông minh -> Dùng ẩn dụ đời sống/công sở/tình yêu.
3. Kết thúc gắt -> Không lửng lơ.
4. KHÔNG DÙNG TỪ ĐIỂN CỐ ĐỊNH -> Hãy sáng tạo từ ngữ mới mẻ.
5. Thomas là Sếp -> Chỉ nhắc khi nhất hoặc bét bảng (Thắng = Thị uy, Thua = Nhường).`

function buildPrompt(
  timestampSeconds: number,
  isRaceEnd: boolean,
  participantNames?: string,
  history?: CommentaryHistory[],
  raceResults?: string
): string {
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

        resultsInfo = `\nKQ: 👑 VÔ ĐỊCH: ${winner}`

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
TRẠNG THÁI: ${focusStrategy}${namesInfo}${historyInfo}
HÌNH ẢNH: Quan sát ảnh.

NHIỆM VỤ: Viết 1 bình luận "sắc lẹm" (MAX 20-30 từ).
- Quan sát ảnh -> Mô tả nhanh (Ai lên/xuống?) -> Thêm Twist hài hước.
- KHÔNG dùng từ điển cố định (Thanh Nộ...). Hãy tự do sáng tạo.
- KHÔNG lặp lại từ đã dùng.

VIẾT NGAY:`
}

interface ZaiResponse {
  choices: Array<{
    message: {
      content: string
    }
  }>
}

export async function generateZaiCommentary(
  screenshotBase64: string,
  timestampSeconds: number,
  isRaceEnd: boolean = false,
  participantNames?: string,
  history?: CommentaryHistory[],
  raceResults?: string
): Promise<string> {
  if (!ZAI_API_KEY) {
    console.warn('Z_AI_API_KEY not set')
    return getFallbackCommentary(timestampSeconds, isRaceEnd)
  }

  try {
    const prompt = buildPrompt(timestampSeconds, isRaceEnd, participantNames, history, raceResults)
    const imageUrl = screenshotBase64.startsWith('data:')
      ? screenshotBase64
      : `data:image/jpeg;base64,${screenshotBase64}`

    const response = await fetch(ZAI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ZAI_API_KEY}`,
        'Accept-Language': 'en-US,en',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 1.0,
        top_p: 0.9,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: imageUrl },
              },
              { type: 'text', text: prompt },
            ],
          },
        ],
      }),
    })

    if (!response.ok) {
      throw new Error((await response.text()))
    }

    const data: ZaiResponse = await response.json()
    let text = data.choices?.[0]?.message?.content || ''

    // Clean up
    text = text
      .replace(/^["']|["']$/g, '')
      .replace(/^(Giây \d+|Phút \d+).*?:/i, '')
      .replace(/(\r\n|\n|\r)/gm, " ")
      .replace(/---[\s\S]*/, "")
      .replace(/\*?Giải thích:.*$/i, "")
      .trim()

    console.log(`[ZAI][${timestampSeconds}s] ${text.substring(0, 60)}...`)
    return text || getFallbackCommentary(timestampSeconds, isRaceEnd)
  } catch (error) {
    console.error('Z.AI API Error:', error)
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
