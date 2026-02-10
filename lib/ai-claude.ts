/**
 * Anthropic Claude 4.5 Haiku Integration for Race Commentary
 * V5: "Viral Punchline" Style - High density of wit, metaphors, and memes. No filler words.
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

const SYSTEM_PROMPT = `Bạn là BLV Đua Vịt với "cái mồm" của Tạ Biên Cương và tư duy của một Rapper.
MỤC TIÊU: Mỗi câu bình luận phải là một "Punchline" có thể viral trên TikTok.

CẤM TUYỆT ĐỐI:
❌ KHÔNG dùng từ đệm vô nghĩa: "Ơi", "À", "Ừ", "Mẹ kiếp", "Chết tiệt", "Ê", "Ấy". 
❌ KHÔNG mô tả tẻ nhạt ("Zịt A đang bơi", "Zịt B nhanh quá").
❌ KHÔNG chào hỏi, không mở bài, không kết bài sáo rỗng.

YÊU CẦU BẮT BUỘC:
✅ Dùng các biện pháp tu từ: So sánh phi lý, Nhân hóa, Chơi chữ (Wordplay).
✅ Văn phong: "Thơ ca lai căng", "Triết lý vỉa hè", "Cà khịa thâm sâu".
✅ Độ dài: Ngắn gọn, súc tích (1 câu duy nhất, 2 vế đối lập).`

function buildPrompt(
  timestampSeconds: number,
  isRaceEnd: boolean,
  participantNames?: string,
  history?: CommentaryHistory[],
  raceResults?: string
): string {
  const namesInfo = participantNames
    ? `\nCASTING: ${participantNames}.`
    : ''

  const historyInfo = history && history.length > 0
    ? `\nDIỄN BIẾN ĐÃ QUA:\n${history.map(h => `[${h.timestamp}s] ${h.text}`).join('\n')}\n(Hãy nối tiếp mood này, nhưng đừng lặp từ)`
    : ''

  if (isRaceEnd) {
    let resultsInfo = ''
    if (raceResults) {
      try {
        const ranking = JSON.parse(raceResults) as Array<{ rank: number; name: string }>
        const winner = ranking[0]?.name || 'không rõ'
        const loser = ranking[ranking.length - 1]?.name || 'không rõ'
        resultsInfo = `\nKẾT QUẢ: 👑 VÔ ĐỊCH: ${winner} | 🥀 ĐỘI SỔ: ${loser}.`
      } catch { /* ignore */ }
    }

    return `${SYSTEM_PROMPT}

Tình huống: Cuộc đua đã hạ màn.${namesInfo}${resultsInfo}${historyInfo}

Nhiệm vụ: Viết 1 câu chốt hạ cực "chất".
- Đối với nhà vô địch: Tâng bốc lên mây xanh bằng một hình ảnh vĩ mô (vũ trụ, thần thoại).
- Đối với kẻ thua cuộc: Cà khịa thâm thúy (ví dụ: đang bận ngắm san hô, đi tìm kho báu đáy sông).
- Yêu cầu: "Sắc lẹm" như dao cạo.

Ví dụ mẫu: "Vương miện đã có chủ! Zit Tuân đăng quang trong sự ngỡ ngàng của vũ trụ! Còn Zit Lợi, có lẽ cậu ấy đang bận... ngắm san hô ở đáy bảng xếp hạng."`
  }

  const moodPrompt = timestampSeconds <= 2
    ? 'Giai đoạn XUẤT PHÁT. Hãy so sánh tốc độ với những thứ chậm chạp/nhanh khủng khiếp (người yêu cũ trở mặt, tin nhắn lương về...).'
    : timestampSeconds <= 12
      ? 'Giai đoạn LÀM QUEN. Hãy tìm một "nghệ sĩ hài" trên đường đua (vịt bơi loạn, đi lùi, vấp cỏ).'
      : timestampSeconds <= 22
        ? 'Giai đoạn GIỮA TRẬN. So sánh sự chênh lệch đẳng cấp. Kẻ dẫn đầu vs Kẻ hít khói.'
        : 'Giai đoạn NƯỚC RÚT. Kịch tính, cháy bỏng, văn thơ lai láng (Sóng bắt đầu từ gió...)'

  return `${SYSTEM_PROMPT}

Thời điểm: Giây ${timestampSeconds}/${RACE_DURATION}. ${moodPrompt}
Dữ liệu hình ảnh: Nhìn screenshot để biết ai dẫn, ai bét.${namesInfo}${historyInfo}

Nhiệm vụ: Viết 1 câu bình luận "sát thương" cao.
- Cấu trúc: [Vế 1: Thực tế cú shock] + [Vế 2: So sánh hình tượng/Meme].
- Ví dụ: "Zit Tân đang vấp cỏ, nhưng đó là cái vấp cỏ của một thiên tài!"
- Ví dụ: "Sóng bắt đầu từ gió, còn Zit Thanh bắt đầu phả hơi nóng vào gáy đối thủ!"

VIẾT NGAY (Không rào đón):`
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
        max_tokens: 200, // Short & punchy
        temperature: 1.0, // High creativity for metaphors
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
      // ... error handling
      throw new Error((await response.text()))
    }

    const data: AnthropicResponse = await response.json()
    let text = data.content?.[0]?.text || ''

    // Aggressive cleanup
    text = text
      .replace(/^["']|["']$/g, '') // remove quotes
      .replace(/^(Giây \d+|Phút \d+).*?:/i, '') // remove timestamps
      .replace(/(\r\n|\n|\r)/gm, " ") // remove newlines
      .trim()

    console.log(`[Claude][${timestampSeconds}s] ${text.substring(0, 60)}...`)
    return text || getFallbackCommentary(timestampSeconds, isRaceEnd)
  } catch (error) {
    console.error('Anthropic API Error:', error)
    return getFallbackCommentary(timestampSeconds, isRaceEnd)
  }
}

function getFallbackCommentary(timestampSeconds: number, isRaceEnd: boolean): string {
  if (isRaceEnd) return 'Vương miện đã có chủ! Một kết thúc không thể tin nổi!'
  if (timestampSeconds <= 5) return 'Tiếng còi vang lên và các chiến thần đã lao đi như tên bắn!'
  return 'Cuộc đua đang nóng hơn cả mùa hè Hà Nội!'
}

export function shouldCaptureAt(
  elapsedSeconds: number,
  timestamps: number[],
  capturedSet: Set<number>
): number | null {
  // ... keep existing logic
  for (const target of timestamps) {
    if (Math.abs(elapsedSeconds - target) < 0.5 && !capturedSet.has(target)) {
      capturedSet.add(target)
      return target
    }
  }
  return null
}
