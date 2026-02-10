/**
 * Anthropic Claude 4.5 Haiku Integration for Race Commentary
 * STATEFUL NARRATIVE MODE: BLV kể chuyện có đầu có đuôi
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

const SYSTEM_PROMPT = `Bạn là một BLV Đua Vịt huyền thoại. Nhiệm vụ của bạn là dẫn dắt người xem qua một hành trình cảm xúc từ lúc "khởi nghiệp" đến khi "vỡ nợ" hoặc "lên đỉnh".

NGUYÊN TẮC VÀNG:
1. TÍNH LIÊN KẾT: Mỗi câu bình luận phải dựa trên câu trước. Nếu giây trước vịt A dẫn, giây sau bị vượt, phải dùng từ như: "Bất ngờ chưa bà già!", "Quay xe khét lẹt!", "Vết xe đổ của...".
2. TIÊU ĐIỂM DRAMA: KHÔNG liệt kê tất cả vịt. Hãy chọn ra 1 "Ngôi sao" và 1 "Báo thủ" để đối đầu. Tập trung vào câu chuyện giữa 2 nhân vật chính.
3. CẤU TRÚC CÂU: 1 vế mô tả thực tế + 1 vế so sánh "đâm bang" + 1 vế dự đoán/cà khịa.
4. ĐỘ DÀI: 150-200 ký tự. Đủ độ mặn nhưng vẫn súc tích.
5. KHÔNG BAO GIỜ bắt đầu bằng header như "GIÂY THỨ X", "PHÁT SÓNG", "KẾT THÚC" hay bất kỳ label nào. Chỉ viết nội dung bình luận thuần túy.

PHONG CÁCH: Dùng từ lóng Gen Z tự nhiên (cook, out trình, tới công chuyện, vô tri, kiếp nạn, check VAR, quay xe, báo thủ, nội tại, xu cà na, trầm cảm, hệ điều hành...). Phép so sánh phi logic (giá vàng, người yêu cũ, chủ nợ, deadline, app ngân hàng...).

CẤM: "vô địch", "đội sổ", "tên bắn", "vấp cỏ", "tấu hài", "dưỡng sinh", "phả hơi nóng", "gáy", "cháy", "flex", "trúng số", "ý nghĩa cuộc đời". KHÔNG được bắt đầu câu bằng ** hoặc markdown formatting.`

function getPromptForTimestamp(
  timestampSeconds: number,
  isRaceEnd: boolean,
  participantNames?: string,
  history?: CommentaryHistory[]
): string {
  const namesContext = participantNames
    ? `\n🦆 DANH SÁCH VỊT ĐANG ĐUA: ${participantNames}\nHãy gọi tên vịt theo đúng danh sách trên, KHÔNG bịa tên.`
    : ''

  const historyContext = history && history.length > 0
    ? `\n📜 CÂU CHUYỆN ĐẾN GIỜ:\n${history.map(h => `[${h.timestamp}s] ${h.text}`).join('\n')}\n\n⚠️ Dựa vào mạch truyện ở trên, hãy TIẾP NỐI câu chuyện. KHÔNG lặp so sánh hoặc từ lóng đã dùng. Nếu có vịt đổi vị trí, hãy tạo drama "quay xe". Nếu vẫn giữ nguyên, hãy tăng tension.`
    : ''

  if (isRaceEnd) {
    return `Cuộc đua đã kết thúc. Nhìn vào kết quả cuối cùng trong ảnh.${namesContext}${historyContext}

Viết 1 câu bình luận kết thúc (150-200 ký tự):
- Callback lại các drama đã xảy ra trong lịch sử bình luận (nếu có)
- Vinh danh kẻ thắng + "chia buồn" kẻ thua theo kiểu cà khịa
- Tạo cảm giác "plot twist" hoặc "kết thúc mãn nhãn"
- KHÔNG bắt đầu bằng header hay label. Chỉ viết nội dung thuần.`
  }

  const phase = timestampSeconds <= 2 ? 'khởi động'
    : timestampSeconds <= 12 ? 'drama mở màn'
      : timestampSeconds <= 22 ? 'giữa trận nóng bỏng'
        : 'nước rút sinh tử'

  return `Đây là giây thứ ${timestampSeconds}/${RACE_DURATION}, giai đoạn: ${phase}. Nhìn vào ảnh screenshot.${namesContext}${historyContext}

Viết 1 câu bình luận (150-200 ký tự):
- Chọn 1 "ngôi sao" (dẫn đầu) và 1 "báo thủ" (chậm nhất) để tạo drama
- Cấu trúc: mô tả thực tế + so sánh phi logic + dự đoán/cà khịa
- Tiếp nối mạch truyện từ các câu trước (nếu có)
- KHÔNG bắt đầu bằng header, label, hay markdown. Chỉ viết nội dung thuần.`
}

interface AnthropicResponse {
  content: Array<{
    type: string
    text: string
  }>
}

/**
 * Generate race commentary using Anthropic Claude 4.5 Haiku with vision
 * STATEFUL NARRATIVE MODE
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
        max_tokens: 300,
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
    let text = data.content?.[0]?.text || ''

    // Strip any markdown formatting or headers the AI might add
    text = text.replace(/^\*\*.*?\*\*\s*/g, '').replace(/^#+\s*/g, '').replace(/^\[.*?\]\s*/g, '').trim()

    console.log(`[Claude][${timestampSeconds}s] Generated commentary:`, text.substring(0, 60))

    return text || getFallbackCommentary(timestampSeconds, isRaceEnd)
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
