/**
 * Anthropic Claude 4.5 Haiku Integration for Race Commentary
 * Using Anthropic Messages API with vision
 * Endpoint: https://api.anthropic.com/v1/messages
 */

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || ''
const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-haiku-4-5-20241022'

// Timestamps to capture during the race (seconds) - 8 key moments across 36s race
export const COMMENTARY_TIMESTAMPS = [0, 5, 10, 15, 20, 25, 30, 33]

const RACE_DURATION = 36

const SYSTEM_PROMPT = `Bạn là một bình luận viên đua vịt tại Việt Nam, phong cách hòa trộn giữa sự uyên bác của Tạ Biên Cương và sự hài hước, "chặt chém" của các streamer nổi tiếng. Ngôn ngữ sử dụng phải trẻ trung, trendy và giàu tính hình ảnh.`

function getPromptForTimestamp(timestampSeconds: number, isRaceEnd: boolean): string {
  const styles = ["kiếm hiệp", "đời sống vỉa hè", "bình luận bóng đá World Cup", "triết học hài hước", "rap battle"]
  const randomStyle = styles[Math.floor(Math.random() * styles.length)]

  if (isRaceEnd) {
    return `Cuộc đua đã KẾT THÚC! Đây là kết quả cuối cùng.
Phong cách: ${randomStyle}.
Nhiệm vụ: Nhìn vào ảnh, vinh danh kẻ thắng và mỉa mai kẻ bại.
Hãy làm cho người thắng nở mày nở mặt, người thua muốn "về vườn".
Dùng từ ngữ mới mẻ, tránh "vô địch", "đội sổ".
TUYỆT ĐỐI cấm dùng: "tên bắn", "vấp cỏ", "tấu hài", "lạc sang Thái Lan", "bơi như hack", "dưỡng sinh", "phả hơi nóng", "gáy", "cháy", "vỡ òa".
Chỉ trả về 1 câu bình luận dưới 100 ký tự.`
  }

  return `⏱️ THỜI GIAN: Giây ${timestampSeconds}/${RACE_DURATION} của cuộc đua.
Phong cách: ${randomStyle}.

Nhìn vào ảnh screenshot cuộc đua vịt, hãy tự đánh giá:
- Đang ở giai đoạn nào? (xuất phát / đầu / giữa / căng thẳng / nước rút)
- Vịt nào dẫn đầu? Vịt nào bét bảng?
- Khoảng cách giữa các vịt ra sao?

Rồi đưa ra MỘT câu bình luận phù hợp với giai đoạn đó.

Gợi ý phong cách theo giai đoạn:
- Xuất phát: hình ảnh độc lạ (mất phanh, chủ nợ đuổi, thấy crush)
- Đầu: cà khịa vịt chậm (tìm kho báu, bơi kiểu hưởng thụ, quên mang não)
- Giữa: so sánh cực đoan giữa vịt đầu và vịt cuối (siêu xe vs xe lu)
- Căng thẳng: cao trào (mượn gió bẻ măng, đánh úp, suýt soát trong gang tấc)
- Nước rút: điên rồ (xé tan mặt nước, hóa rồng, cú lừa lịch sử)

TUYỆT ĐỐI cấm dùng: "tên bắn", "vấp cỏ", "tấu hài", "lạc sang Thái Lan", "bơi như hack", "dưỡng sinh", "phả hơi nóng", "gáy", "cháy", "vỡ òa", "không thể tin nổi".
Chỉ trả về 1 câu bình luận dưới 100 ký tự. Không giải thích, không thêm gì khác.`
}

interface AnthropicResponse {
  content: Array<{
    type: string
    text: string
  }>
}

/**
 * Generate race commentary using Anthropic Claude 4.5 Haiku with vision
 */
export async function generateClaudeCommentary(
  screenshotBase64: string,
  timestampSeconds: number,
  isRaceEnd: boolean = false
): Promise<string> {
  if (!ANTHROPIC_API_KEY) {
    console.warn('ANTHROPIC_API_KEY not set, using fallback commentary')
    return getFallbackCommentary(timestampSeconds, isRaceEnd)
  }

  try {
    const prompt = getPromptForTimestamp(timestampSeconds, isRaceEnd)

    // Strip data URI prefix if present — Anthropic expects raw base64
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
        max_tokens: 256,
        temperature: 1.0,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/jpeg',
                  data: rawBase64,
                },
              },
              {
                type: 'text',
                text: prompt,
              },
            ],
          },
        ],
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Anthropic API error: ${response.status} - ${errorText}`)
    }

    const data: AnthropicResponse = await response.json()
    const text = data.content?.[0]?.text || ''

    console.log(`[Claude][${timestampSeconds}s] Generated commentary:`, text.substring(0, 50))

    return text.trim() || getFallbackCommentary(timestampSeconds, isRaceEnd)
  } catch (error) {
    console.error('Anthropic API Error:', error)
    return getFallbackCommentary(timestampSeconds, isRaceEnd)
  }
}

function getFallbackCommentary(timestampSeconds: number, isRaceEnd: boolean): string {
  if (isRaceEnd) return 'CHEQUERED FLAG! Cuộc đua đã kết thúc!'
  if (timestampSeconds <= 1) return 'LIGHTS OUT! Các con dzịt lao ra khỏi vạch xuất phát!'
  if (timestampSeconds <= 3) return 'Cuộc đua đang diễn ra sôi nổi!'
  if (timestampSeconds <= 5) return 'Gay cấn quá! Các con dzịt đang cố vượt lên!'
  if (timestampSeconds <= 7) return 'Gần tới đích rồi! Ai sẽ về nhất?'
  return 'Nước rút cuối cùng! Hồi hộp quá!'
}

/**
 * Check if we should capture at this timestamp
 */
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
