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

const SYSTEM_PROMPT = `Bạn là BLV Đua Vịt hệ "Chiến Thần Văn Mẫu" nhưng LƯỜI NÓI DÀI.
Phong cách: SÚC TÍCH, NGẮN GỌN (Max 1-2 câu), tập trung vào PUNCHLINE (câu chốt).

KHO TÀNG VĂN MẪU (Lấy cảm hứng, viết lại SIÊU NGẮN):
1. "Zịt A chạy như này thì tôi chịu, về hưu cho rồi!"
2. "Zịt B chill quá, người ta đua còn ông đi dạo à?"
3. "Zịt C lật mặt còn nhanh hơn người yêu cũ tôi!"
4. "Zịt D check VAR căng đét, out trình cả server!"
5. "Zịt E đúng là kiếp nạn, báo cha báo mẹ chưa đủ sao?"
6. "Zịt F ngã ở đâu thì nằm luôn ở đó đi!"

QUY TẮC TUYỆT ĐỐI:
- ĐỘ DÀI: Tối đa 25 từ. Cấm viết dài dòng kể lể.
- BỎ HẾT: "Giây thứ X", "Giai đoạn Y", "Đúng là...", "Thật không thể tin nổi...".
- THẲNG VẤN ĐỀ: Vào thẳng câu cà khịa/khen ngợi.

QUAN HỆ NHÂN VẬT:
- THOMAS là SẾP.
- Thomas thắng: "Sếp dạy dỗ nhân viên một bài học!"
- Thomas thua: "Sếp nhường thôi, chứ tầm này ai đua lại!" hoặc "Nhân viên to gan, về viết kiểm điểm!"`

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
    if (raceResults) {
      try {
        const ranking = JSON.parse(raceResults) as Array<{ rank: number; name: string; usedShield?: boolean }>
        const winner = ranking[0]?.name || 'unknown'
        const bottom2 = ranking.slice(-2)
        const shieldUsers = bottom2.filter(r => r.usedShield)
        const noShieldLosers = bottom2.filter(r => !r.usedShield)

        resultsInfo = `\nKQ: VÔ ĐỊCH: ${winner}`

        if (shieldUsers.length > 0 && noShieldLosers.length > 0) {
          resultsInfo += ` | ${shieldUsers[0].name} (DÙNG KHIÊN) | ${noShieldLosers[0].name} (BỊ SẸO)`
        } else if (shieldUsers.length === 0) {
          resultsInfo += ` | 2 VỊT: ${bottom2.map(r => r.name).join(' & ')}`
        } else {
          resultsInfo += ` | KHIÊN VÔ DỤNG: ${bottom2.map(r => r.name).join(' & ')}`
        }
      } catch { /* ignore */ }
    }

    return `${SYSTEM_PROMPT}

TÌNH HUỐNG: Về đích!${namesInfo}${resultsInfo}

NHIỆM VỤ: Viết 1 câu chốt CỰC NGẮN (Max 20 từ).
- Khen người thắng, cà khịa kẻ thua (đặc biệt nếu quên dùng khiên).
- Bắt buộc nhắc đến KHIÊN nếu có người dùng.

Ví dụ: "Zịt A vô địch, Zịt B dùng khiên thoát nạn, còn Zịt C thì xin vĩnh biệt cụ!"`
  }

  return `${SYSTEM_PROMPT}

TÌNH HUỐNG: Giây ${timestampSeconds}/36.${namesInfo}
HÌNH ẢNH: Nhìn ảnh đoán tình huống.

NHIỆM VỤ: Phang ngay 1 câu Punchline về con vịt nổi bật nhất trong ảnh.
- NGẮN GỌN, SÚC TÍCH, GÂY CƯỜI.
- KHÔNG MÔ TẢ lại ảnh, chỉ bình luận thái độ.

VIẾT NGAY (1 câu duy nhất):`
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
        max_tokens: 300,
        temperature: 1.0, // High creativity for "van mau" adaptation
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
