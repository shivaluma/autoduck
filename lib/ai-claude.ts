/**
 * Anthropic Claude 4.5 Haiku Integration for Race Commentary
 * V6: Narrative Flow + Viral Wit (Fixing disjointed commentary)
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

const SYSTEM_PROMPT = `Bạn là BLV Đua Vịt với phong cách: Tạ Biên Cương (hoa mỹ) + Rapper (vần điệu) + Táo Quân (cà khịa).
MỤC TIÊU: Kể một CÂU CHUYỆN kịch tính, xuyên suốt từ đầu đến cuối.

QUY TẮC VÀNG:
1. TÍNH LIÊN KẾT (QUAN TRỌNG NHẤT):
   - KHÔNG bình luận rời rạc từng con.
   - PHẢI nhắc lại diễn biến trước đó (Ví dụ: "Vừa bị chê giây trước, giờ Zịt A đã...")
   - Luôn so sánh Kẻ Dẫn Đầu vs Kẻ Bám Đuổi.

2. PHONG CÁCH:
   - Dùng từ ngữ bóng bẩy, ẩn dụ, so sánh bất ngờ (vũ trụ, thần thoại, showbiz, kinh tế...).
   - KHÔNG dùng từ đệm nhạt nhẽo ("ơi", "à", "ừ").
   - Giọng điệu: Gấp gáp, kịch tính, như đang hét vào mic.

3. CẤU TRÚC:
   - Một câu duy nhất.
   - Vế 1: Diễn biến thực tế (Ai vượt ai? Ai tụt?).
   - Vế 2: So sánh/Bình luận thâm thúy.`

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
    ? `\nDIỄN BIẾN ĐÃ QUA (Hãy nối tiếp mạch này):\n${history.map(h => `[${h.timestamp}s] ${h.text}`).join('\n')}`
    : '\n(Chưa có diễn biến, hãy mở đầu thật bùng nổ)'

  if (isRaceEnd) {
    let resultsInfo = ''
    if (raceResults) {
      try {
        const ranking = JSON.parse(raceResults) as Array<{ rank: number; name: string }>
        const winner = ranking[0]?.name || 'không rõ'
        const loser = ranking[ranking.length - 1]?.name || 'không rõ'
        resultsInfo = `\nKẾT QUẢ CHUNG CUỘC: 👑 VÔ ĐỊCH: ${winner} | 🥀 ĐỘI SỔ: ${loser}.`
      } catch { /* ignore */ }
    }

    return `${SYSTEM_PROMPT}

THỜI KHẮC QUYẾT ĐỊNH: Cuộc đua đã kết thúc!${namesInfo}${resultsInfo}${historyInfo}

NHIỆM VỤ: Viết 1 câu chốt hạ (max 200 ký tự).
- Kết nối lại với các sự kiện trong quá khứ (callback).
- Tôn vinh nhà vô địch bằng hình ảnh vĩ đại.
- "An ủi" kẻ thua cuộc bằng sự mỉa mai thâm thúy.

Ví dụ: "Vương miện đã chọn Zịt Tuấn làm chủ nhân của vũ trụ, trong khi Zịt Lợi vẫn đang loay hoay tìm định nghĩa của từ 'tốc độ' dưới đáy bảng xếp hạng!"`
  }

  // Dynamic context generation
  let contextPrompt = ''
  if (timestampSeconds <= 2) {
    contextPrompt = 'Giai đoạn XUẤT PHÁT: Ai là kẻ "nổ máy" nhanh nhất? Ai đang ngủ mơ? So sánh khí thế như đi đòi nợ vs đi dạo mát.'
  } else if (timestampSeconds <= 12) {
    contextPrompt = 'Giai đoạn BỨT TỐC: Cuộc chiến bắt đầu rõ rệt. Hãy so sánh kẻ dẫn đầu và kẻ bám đuổi (Khoảng cách ntn? Như mặt trăng với mặt trời?).'
  } else if (timestampSeconds <= 22) {
    contextPrompt = 'Giai đoạn CAO TRÀO: Có ai đang âm thầm vươn lên không? Hay kẻ dẫn đầu đang "hết xăng"? Hãy tạo drama kịch tính.'
  } else {
    contextPrompt = 'Giai đoạn NƯỚC RÚT: Sống còn! Dùng những từ ngữ mạnh nhất (cháy, nổ, hủy diệt, nuốt chửng). Ai sẽ là người chiến thắng?'
  }

  return `${SYSTEM_PROMPT}

THỜI GIAN: Giây ${timestampSeconds}/${RACE_DURATION}. ${contextPrompt}
HÌNH ẢNH: Nhìn screenshot để xác định ai dẫn đầu, ai bét bảng.${namesInfo}${historyInfo}

NHIỆM VỤ: Viết 1 câu bình luận kịch tính (max 180 ký tự).
- PHẢI SO SÁNH: Đừng chỉ nói về 1 con. Hãy nói "Zịt A đang bay, TRONG KHI Zịt B đang bò".
- Dùng từ ngữ "đắt": Xi măng, cốt thép, tên lửa, đi bộ, dưỡng sinh...

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
        max_tokens: 256,
        temperature: 0.9, // Balanced creativity and coherence
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
      const errorText = await response.text()
      throw new Error(`Anthropic API error: ${response.status} - ${errorText}`)
    }

    const data: AnthropicResponse = await response.json()
    let text = data.content?.[0]?.text || ''

    // Clean up
    text = text
      .replace(/^["']|["']$/g, '')
      .replace(/^(Giây \d+|Phút \d+).*?:/i, '')
      .replace(/(\r\n|\n|\r)/gm, " ")
      .trim()

    console.log(`[Claude][${timestampSeconds}s] ${text.substring(0, 60)}...`)
    return text || getFallbackCommentary(timestampSeconds, isRaceEnd)
  } catch (error) {
    console.error('Anthropic API Error:', error)
    return getFallbackCommentary(timestampSeconds, isRaceEnd)
  }
}

function getFallbackCommentary(timestampSeconds: number, isRaceEnd: boolean): string {
  if (isRaceEnd) return 'Cuộc đua đã khép lại với những cảm xúc vỡ òa!'
  if (timestampSeconds <= 5) return 'Các chiến binh vịt đã lao ra đường đua như những mũi tên!'
  return 'Cuộc đua đang diễn ra vô cùng kịch tính và khó lường!'
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
