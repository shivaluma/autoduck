/**
 * Z.AI GLM-4.6v Integration for Race Commentary
 * Using pure fetch API (no SDK)
 * Endpoint: https://api.z.ai/api/coding/paas/v4/chat/completions
 */

const ZAI_API_KEY = process.env.Z_AI_API_KEY || ''
const ZAI_ENDPOINT = 'https://api.z.ai/api/coding/paas/v4/chat/completions'
const MODEL = 'glm-4.6v'

// Timestamps to capture during the race (seconds) - 8 key moments across 36s race
export const COMMENTARY_TIMESTAMPS = [0, 5, 10, 15, 20, 25, 30, 33]

type CommentaryType = 'start' | 'early' | 'mid' | 'tension' | 'final' | 'end'

function getCommentaryType(timestampSeconds: number, isRaceEnd: boolean): CommentaryType {
  if (isRaceEnd) return 'end'
  if (timestampSeconds <= 2) return 'start'      // 0s: Xuất phát
  if (timestampSeconds <= 8) return 'early'      // 5s: Đầu cuộc đua
  if (timestampSeconds <= 18) return 'mid'       // 10s, 15s: Giữa chặng
  if (timestampSeconds <= 28) return 'tension'   // 20s, 25s: Căng thẳng
  return 'final'                                  // 30s, 33s: Nước rút
}

// System prompt applied to ALL phases
const SYSTEM_PROMPT = `Bạn là một bình luận viên đua vịt tại Việt Nam, phong cách hòa trộn giữa sự uyên bác của Tạ Biên Cương và sự hài hước, "chặt chém" của các streamer nổi tiếng. Ngôn ngữ sử dụng phải trẻ trung, trendy và giàu tính hình ảnh.

`

function getPromptForType(type: CommentaryType): string {
  // Mẹo: Thêm một chút keyword ngẫu nhiên vào để mỗi lần gọi là một kiểu khác nhau
  const styles = ["kiếm hiệp", "đời sống vỉa hè", "bình luận bóng đá World Cup", "triết học hài hước", "rap battle"]
  const randomStyle = styles[Math.floor(Math.random() * styles.length)]

  const prompts: Record<CommentaryType, string> = {
    start: `Bạn là BLV đua vịt có ngôn từ phong phú bậc nhất. Trận đấu BẮT ĐẦU!
Phong cách: ${randomStyle}.
Nhiệm vụ: Mô tả cú xuất phát của các vịt. 
Lưu ý: TUYỆT ĐỐI KHÔNG dùng từ "tên bắn", "vấp cỏ". Hãy dùng các hình ảnh độc lạ khác (ví dụ: như mất phanh, như chủ nợ đuổi, như thấy crush...).
Chỉ trả về 1 câu bình luận dưới 25 từ.`,

    early: `Bạn là BLV đang soi từng milimet đường đua. Vịt đang dàn đội hình.
Phong cách: ${randomStyle}.
Nhiệm vụ: Cà khịa những con vịt đang bơi lỗi hoặc quá chậm. 
Lưu ý: Cấm dùng "tấu hài", "lạc sang Thái Lan". Hãy thử dùng: "đang tìm kho báu", "bơi kiểu hưởng thụ", "quên mang não"...
Chỉ trả về 1 câu bình luận.`,

    mid: `Bạn là thánh soi chặng giữa. Thứ hạng đã hình thành.
Phong cách: ${randomStyle}.
Nhiệm vụ: So sánh vịt đầu và vịt cuối. 
Yêu cầu: Dùng phép so sánh cực đoan. Ví dụ: "Một bên là siêu xe, một bên là xe lu". 
Cấm dùng: "bơi như hack", "dưỡng sinh".
Chỉ trả về 1 câu dưới 25 từ.`,

    tension: `Cuộc đua đang cực kỳ GAY CẤN, các vịt đang áp sát nhau!
Phong cách: ${randomStyle}.
Nhiệm vụ: Đẩy cao trào, làm người xem nghẹt thở. 
Cấm dùng: "phả hơi nóng", "gáy", "cuộc chiến vương quyền". 
Hãy dùng: "mượn gió bẻ măng", "đánh úp", "suýt soát trong gang tấc".
Chỉ trả về 1 câu dưới 25 từ.`,

    final: `GIÂY PHÚT SINH TỬ! Về đích đến nơi rồi!
Phong cách: Tổng lực, gào thét, điên rồ.
Nhiệm vụ: Mô tả sự bứt phá cuối cùng. 
Cấm dùng: "cháy", "vỡ òa", "không thể tin nổi". 
Dùng từ ngữ mạnh: "xé tan mặt nước", "hóa rồng", "cú lừa lịch sử".
Chỉ trả về 1 câu dưới 25 từ.`,

    end: `Hạ màn! Đã có vịt vô địch.
Nhiệm vụ: Vinh danh kẻ thắng và chia buồn (mỉa mai) kẻ bại. 
Hãy làm cho người thắng thấy nở mày nở mặt, người thua thấy muốn "về vườn".
Dùng từ ngữ mới mẻ, tránh các từ "vô địch", "đội sổ" thông thường.
Chỉ trả về 1 câu dưới 25 từ.`,
  }
  return SYSTEM_PROMPT + prompts[type]
}

interface ZaiResponse {
  choices: Array<{
    message: {
      content: string
    }
  }>
}

/**
 * Generate race commentary using Z.AI GLM-4.6v via pure fetch API
 * @param screenshotBase64 - Base64 encoded screenshot of the race
 * @param timestampSeconds - Current timestamp in seconds
 * @param isRaceEnd - Whether this is the final result
 */
export async function generateZaiCommentary(
  screenshotBase64: string,
  timestampSeconds: number,
  isRaceEnd: boolean = false
): Promise<string> {
  if (!ZAI_API_KEY) {
    console.warn('Z_AI_API_KEY not set, using fallback commentary')
    return getFallbackCommentary(timestampSeconds, isRaceEnd)
  }

  try {
    const type = getCommentaryType(timestampSeconds, isRaceEnd)
    const prompt = getPromptForType(type)

    // Ensure we have a valid data URI
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
        temperature: 1.2,  // Cao hơn để sáng tạo hơn
        top_p: 0.95,       // Randomness cao
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: {
                  url: imageUrl,
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
      throw new Error(`Z.AI API error: ${response.status} - ${errorText}`)
    }

    const data: ZaiResponse = await response.json()
    const text = data.choices?.[0]?.message?.content || ''

    console.log(`[${timestampSeconds}s] Generated commentary:`, text.substring(0, 50))

    return text.trim() || getFallbackCommentary(timestampSeconds, isRaceEnd)
  } catch (error) {
    console.error('Z.AI API Error:', error)
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
    // Allow 0.5s tolerance
    if (Math.abs(elapsedSeconds - target) < 0.5 && !capturedSet.has(target)) {
      capturedSet.add(target)
      return target
    }
  }
  return null
}
