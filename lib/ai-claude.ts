/**
 * Anthropic Claude 4.5 Haiku Integration for Race Commentary
 * STATEFUL: Receives commentary history for continuity & anti-repetition
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

const SYSTEM_PROMPT = `Bạn là một bình luận viên đua vịt huyền thoại tại Việt Nam. 
Phong cách: Hòa trộn giữa sự bay bổng, dùng từ cực "đắt" của Tạ Biên Cương và sự "chặt chém", thực dụng, hài hước của các streamer 90p. 

NGUYÊN TẮC BÌNH LUẬN:
1. Ngôn ngữ: Dùng từ lóng Gen Z, thuật ngữ mạng xã hội (flex, check VAR, cook, báo thủ, hệ điều hành, trầm cảm, thoát ly thực tại...).
2. Phép so sánh: Phải cực đoan và phi logic (So sánh vịt với giá vàng, người yêu cũ, chủ nợ, hay một định luật vật lý bị bỏ quên).
3. Thái độ: Phải có sự phân biệt đối xử rõ ràng. Vịt dẫn đầu là "Vị vua", vịt cuối bảng là "Tội đồ" hoặc "Kẻ đang tìm kiếm ý nghĩa cuộc sống".
4. Độ dài: TUYỆT ĐỐI dưới 100 ký tự. Phải súc tích nhưng "đâm bang".
5. TÍNH LIÊN KẾT: Nếu được cung cấp bình luận trước đó, PHẢI tạo liên kết. Ví dụ: "Vẫn là con vịt báo thủ đó...", "Ai ngờ cú quay xe thế kỷ...". KHÔNG lặp lại từ lóng hoặc phép so sánh đã dùng.

CẤM CÁC TỪ NHÀM CHÁN: "vô địch", "đội sổ", "tên bắn", "vấp cỏ", "tấu hài", "dưỡng sinh", "phả hơi nóng", "gáy", "cháy".`

function getPromptForTimestamp(
  timestampSeconds: number,
  isRaceEnd: boolean,
  participantNames?: string,
  history?: CommentaryHistory[]
): string {
  const contexts = [
    "Đang nợ lương/deadline dí",
    "Người yêu cũ đi lấy chồng",
    "Vừa trúng coin/chứng khoán",
    "Đi casting Rap Việt nhưng bị loại",
    "Hệ điều hành Windows đang Update",
    "Mở app ngân hàng thấy số dư",
    "Check điểm thi đại học",
    "Bị tag vào ảnh thời trung học"
  ]
  const randomContext = contexts[Math.floor(Math.random() * contexts.length)]

  const namesContext = participantNames
    ? `\n🦆 DANH SÁCH VỊT ĐANG ĐUA: ${participantNames}\nHãy gọi tên vịt theo đúng danh sách trên.`
    : ''

  const historyContext = history && history.length > 0
    ? `\n📜 BÌNH LUẬN TRƯỚC ĐÓ (để tránh lặp và tạo liên kết):
${history.map(h => `- Giây ${h.timestamp}s: "${h.text}"`).join('\n')}
⚠️ KHÔNG được lặp lại bất kỳ phép so sánh, từ lóng, hoặc cấu trúc câu nào ở trên. Hãy "quay xe" hoặc "nối điêu" sáng tạo.`
    : ''

  if (isRaceEnd) {
    return `KẾT THÚC! Bối cảnh cảm xúc: ${randomContext}.${namesContext}${historyContext}
Nhiệm vụ: Vinh danh kẻ thắng như một vị thần, mỉa mai kẻ thua như một "báo thủ" chính hiệu.
Dùng từ ngữ cực gắt: 'cook', 'về vườn', 'out trình', 'tới công chuyện', 'xu cà na'.
Nếu có bình luận trước, hãy tạo "plot twist" hoặc callback bất ngờ.
Chỉ trả về 1 câu < 100 ký tự.`
  }

  return `⏱️ GIÂY THỨ: ${timestampSeconds}/${RACE_DURATION}. Bối cảnh cảm xúc: ${randomContext}.${namesContext}${historyContext}
Dựa vào vị trí các vịt trong ảnh:
- Xuất phát: Ví như đi xin việc, gặp chủ nợ, hay đi casting idol.
- Giữa trận: So sánh khoảng cách như "ví tiền cuối tháng" và "giá nhà quận 1".
- Nước rút: Như cách người yêu cũ quay xe hoặc cách deadline dí.

Yêu cầu: 
- Phải có tính sát thương cao, dùng từ ngữ trendy 2026.
- Thử dùng: 'cà khịa', 'xu cà na', 'tới công chuyện', 'nội tại', 'vô tri', 'kiếp nạn'.
- Tránh tuyệt đối 'flex', 'trúng số', 'ý nghĩa cuộc đời' (quá phổ biến).
Chỉ 1 câu duy nhất < 100 ký tự.`
}

interface AnthropicResponse {
  content: Array<{
    type: string
    text: string
  }>
}

/**
 * Generate race commentary using Anthropic Claude 4.5 Haiku with vision
 * STATEFUL: accepts history for continuity
 */
export async function generateClaudeCommentary(
  screenshotBase64: string,
  timestampSeconds: number,
  isRaceEnd: boolean = false,
  participantNames?: string,
  history?: CommentaryHistory[]
): Promise<string> {
  if (!ANTHROPIC_API_KEY) {
    console.warn('ANTHROPIC_API_KEY not set, using fallback commentary')
    return getFallbackCommentary(timestampSeconds, isRaceEnd)
  }

  try {
    const prompt = getPromptForTimestamp(timestampSeconds, isRaceEnd, participantNames, history)

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
        temperature: 0.9,
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
