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

const RACE_DURATION = 36

const SYSTEM_PROMPT = `Bạn là một bình luận viên đua vịt huyền thoại tại Việt Nam. 
Phong cách: Hòa trộn giữa sự bay bổng, dùng từ cực "đắt" của Tạ Biên Cương và sự "chặt chém", thực dụng, hài hước của các streamer 90p. 

NGUYÊN TẮC BÌNH LUẬN:
1. Ngôn ngữ: Dùng từ lóng Gen Z, thuật ngữ mạng xã hội (flex, check VAR, cook, báo thủ, hệ điều hành, trầm cảm, thoát ly thực tại...).
2. Phép so sánh: Phải cực đoan và phi logic (So sánh vịt với giá vàng, người yêu cũ, chủ nợ, hay một định luật vật lý bị bỏ quên).
3. Thái độ: Phải có sự phân biệt đối xử rõ ràng. Vịt dẫn đầu là "Vị vua", vịt cuối bảng là "Tội đồ" hoặc "Kẻ đang tìm kiếm ý nghĩa cuộc sống".
4. Độ dài: TUYỆT ĐỐI dưới 100 ký tự. Phải súc tích nhưng "đâm bang".

CẤM CÁC TỪ NHÀM CHÁN: "vô địch", "đội sổ", "tên bắn", "vấp cỏ", "tấu hài", "dưỡng sinh", "phả hơi nóng", "gáy", "cháy".`

function getPromptForTimestamp(timestampSeconds: number, isRaceEnd: boolean, participantNames?: string): string {
  const styles = ["Chiêm tinh học", "Kinh tế tài chính", "Văn học hiện thực phê phán", "Tâm linh huyền bí", "Giang hồ mõm"]
  const randomStyle = styles[Math.floor(Math.random() * styles.length)]

  const namesContext = participantNames
    ? `\n🦆 DANH SÁCH VỊT ĐANG ĐUA: ${participantNames}\nHãy gọi tên vịt theo đúng danh sách trên.`
    : ''

  if (isRaceEnd) {
    return `KẾT THÚC! Phong cách: ${randomStyle}.${namesContext}
Nhiệm vụ: Vinh danh kẻ thắng như một vị thần, mỉa mai kẻ thua như một "báo thủ" chính hiệu.
Dùng từ ngữ cực gắt: 'cook', 'về vườn', 'out trình', 'tư duy'.
Chỉ trả về 1 câu < 100 ký tự.`
  }

  return `⏱️ GIÂY THỨ: ${timestampSeconds}/${RACE_DURATION}. Phong cách: ${randomStyle}.${namesContext}
Dựa vào vị trí các vịt trong ảnh:
- Xuất phát: Ví như đi xin việc, gặp chủ nợ, hay đi casting idol.
- Giữa trận: So sánh khoảng cách như "ví tiền cuối tháng" và "giá nhà quận 1".
- Nước rút: Như cách người yêu cũ quay xe hoặc cách deadline dí.

Yêu cầu: Phải có tính sát thương cao, dùng từ ngữ trendy của giới trẻ Việt Nam năm 2026.
Chỉ 1 câu duy nhất < 100 ký tự.`
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
 */
export async function generateZaiCommentary(
  screenshotBase64: string,
  timestampSeconds: number,
  isRaceEnd: boolean = false,
  participantNames?: string
): Promise<string> {
  if (!ZAI_API_KEY) {
    console.warn('Z_AI_API_KEY not set, using fallback commentary')
    return getFallbackCommentary(timestampSeconds, isRaceEnd)
  }

  try {
    const prompt = getPromptForTimestamp(timestampSeconds, isRaceEnd, participantNames)

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
