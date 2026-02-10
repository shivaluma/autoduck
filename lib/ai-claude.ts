/**
 * Anthropic Claude 4.5 Haiku Integration for Race Commentary
 * V4: Natural BLV voice, stateful narrative, race results injection
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

const SYSTEM_PROMPT = `Bạn là BLV đua vịt, giọng Tạ Biên Cương pha streamer đường phố. Bạn đang bình luận trực tiếp một cuộc đua vịt.

QUY TẮC:
- Viết như đang NÓI, không phải đang viết. Câu phải tự nhiên, có nhịp thở, có ngắt.
- KHÔNG dùng ngoặc kép quá 1 lần trong câu. KHÔNG dùng markdown (**, ##, []...).  
- KHÔNG bắt đầu bằng label/header. Viết thẳng nội dung.
- Tập trung vào 1-2 con vịt chính, KHÔNG liệt kê tất cả.
- Mỗi câu bình luận phải nối tiếp câu trước, tạo mạch truyện.
- Dùng từ lóng tự nhiên: cook, out trình, quay xe, báo thủ, tới công chuyện... nhưng KHÔNG nhồi nhét, chỉ dùng khi hợp ngữ cảnh.
- So sánh phi logic nhưng phải MỚI mỗi lần, không lặp.
- Độ dài: 100-180 ký tự.`

function buildPrompt(
  timestampSeconds: number,
  isRaceEnd: boolean,
  participantNames?: string,
  history?: CommentaryHistory[],
  raceResults?: string
): string {
  const namesInfo = participantNames
    ? `\nCác vịt đang đua: ${participantNames}.`
    : ''

  const historyInfo = history && history.length > 0
    ? `\nCác câu bình luận trước:\n${history.map(h => `[${h.timestamp}s] ${h.text}`).join('\n')}\nHãy tiếp nối mạch truyện, KHÔNG lặp từ lóng hay so sánh đã dùng.`
    : ''

  if (isRaceEnd) {
    let resultsInfo = ''
    if (raceResults) {
      try {
        const ranking = JSON.parse(raceResults) as Array<{ rank: number; name: string }>
        const winner = ranking[0]?.name || 'không rõ'
        const last = ranking[ranking.length - 1]?.name || 'không rõ'
        resultsInfo = `\nKẾT QUẢ CHÍNH THỨC: Vô địch: ${winner}. Cuối bảng: ${last}. Bảng xếp hạng: ${ranking.map(r => `#${r.rank} ${r.name}`).join(', ')}.`
      } catch { /* ignore parse errors */ }
    }

    return `Cuộc đua kết thúc rồi.${namesInfo}${resultsInfo}${historyInfo}

Viết 1 câu bình luận kết thúc (100-180 ký tự). Tung hô vịt thắng, cà khịa vịt thua. Nếu có lịch sử bình luận thì callback lại drama trước đó. Viết như đang nói trên mic, tự nhiên, có cảm xúc.`
  }

  const phase = timestampSeconds <= 2 ? 'vừa xuất phát'
    : timestampSeconds <= 12 ? 'đang hình thành đội hình'
      : timestampSeconds <= 22 ? 'đang nóng lên'
        : 'nước rút'

  return `Giây ${timestampSeconds}/${RACE_DURATION}, ${phase}. Nhìn vào ảnh.${namesInfo}${historyInfo}

Viết 1 câu bình luận (100-180 ký tự). Chọn 1-2 vịt nổi bật nhất để nói. Viết như đang nói trên mic, tự nhiên, không gượng ép từ lóng.`
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
  isRaceEnd: boolean = false,
  participantNames?: string,
  history?: CommentaryHistory[],
  raceResults?: string
): Promise<string> {
  if (!ANTHROPIC_API_KEY) {
    console.warn('ANTHROPIC_API_KEY not set, using fallback commentary')
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
        temperature: 0.85,
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

    // Clean up: strip any headers, markdown, or labels AI might sneak in
    text = text
      .replace(/^\*\*[^*]+\*\*\s*/g, '')  // **HEADER**
      .replace(/^#+\s+.+\n?/g, '')        // # Header
      .replace(/^\[.+?\]\s*/g, '')         // [LABEL]
      .replace(/^(GIÂY|PHÁT SÓNG|KẾT THÚC|KHỞI ĐỘNG|NƯỚC RÚT)[^:]*:\s*/gi, '') // Vietnamese headers
      .trim()

    console.log(`[Claude][${timestampSeconds}s] ${text.substring(0, 60)}...`)
    return text || getFallbackCommentary(timestampSeconds, isRaceEnd)
  } catch (error) {
    console.error('Anthropic API Error:', error)
    return getFallbackCommentary(timestampSeconds, isRaceEnd)
  }
}

function getFallbackCommentary(timestampSeconds: number, isRaceEnd: boolean): string {
  if (isRaceEnd) return 'Cuộc đua kết thúc rồi bà con ơi!'
  if (timestampSeconds <= 2) return 'Đèn xanh bật, các con vịt lao ra khỏi vạch xuất phát!'
  if (timestampSeconds <= 12) return 'Đội hình đang dần hình thành, gay cấn lắm đây!'
  if (timestampSeconds <= 22) return 'Cuộc đua nóng lên từng giây!'
  return 'Nước rút rồi, ai sẽ về nhất đây!'
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
