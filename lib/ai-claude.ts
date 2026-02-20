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

const SYSTEM_PROMPT = `Bạn là BLV đua vịt kiêm Streamer "mỏ hỗn", mang hệ tư tưởng GenZ 2025-2026 siêu nhạy trend.

NHIỆM VỤ:
- Mỗi timestamp phải quét toàn frame, chọn góc thú vị hoặc "vô tri" nhất.
- Luân phiên spotlight: Nhóm dẫn đầu -> Nhóm giữa -> Kẻ ra chuồng gà.
- KHÔNG LẶP LẠI nhân vật chính quá 2 lần liên tiếp.

ƯU TIÊN DRAMA:
- Chọn con có pha xử lý "ảo ma" nhất (vượt láo, quay xe, báo thủ).
- Nếu 2 câu trước tâng bốc Top, câu này PHẢI khịa Mid hoặc Bottom.

ĐỘ DÀI & GIỌNG VĂN:
- 1 câu là chuẩn (Tối đa 2 câu). 10–26 từ. Cực kỳ ngắn gọn, punchy.
- [Hành động nổi bật] → [Punchline mỏ hỗn/cảm lạnh].
- Dùng slangs trending bùng nổ: flex, báo thủ, vô tri, ao chình, đỉnh nóc kịch trần, kiếp nạn, đăng xuất, xà lơ.
- TUYỆT ĐỐI KHÔNG dùng Markdown (#, **). Viết tự nhiên phũ phàng như chat stream.

NGUYÊN TẮC CAMERA:
- 0–10s: Điểm danh sương sương, ai đang flex tốc độ, ai đang ngủ đông vô tri?
- 10–25s: Đánh lộn căng cực, focus lật kèo, mấy pha tấu hài xô đẩy.
- 25s+: Focus Top 1 lụm cúp và Kẻ bết bát đang thở cắn đuôi.
- Thomas là Sếp: Thảo mai gáy bẩn nếu sếp top 1, hoặc cười ẩn ý khịa nhẹ lúc sếp bét.`

function buildPrompt(
  timestampSeconds: number,
  isRaceEnd: boolean,
  participantNames?: string,
  history?: CommentaryHistory[],
  raceResults?: string
): string {
  // Analyze interactions to find "Cold" ducks (rarely mentioned)
  const participants = participantNames ? participantNames.split(',').map(n => n.trim()) : []
  const mentions: Record<string, number> = {}
  participants.forEach(p => mentions[p] = 0)

  if (history) {
    history.forEach(h => {
      participants.forEach(p => {
        if (h.text.includes(p)) mentions[p]++
      })
    })
  }

  // Sort ducks by mentions (Ascending)
  const sortedDucks = [...participants].sort((a, b) => mentions[a] - mentions[b])
  const coldDucks = sortedDucks.filter(p => mentions[p] === 0)
  const coolDucks = sortedDucks.filter(p => mentions[p] > 0 && mentions[p] <= 2)
  const hotDucks = sortedDucks.filter(p => mentions[p] > 2)

  let spotlightInstruction = ""
  if (coldDucks.length > 0) {
    spotlightInstruction = `\n🔦 ƯU TIÊN SPOTLIGHT (ĐANG TÀNG HÌNH): ${coldDucks.join(', ')} (Đào tụi này lên xem đang tấu hài gì).`
  } else if (coolDucks.length > 0) {
    spotlightInstruction = `\n🔦 ƯU TIÊN SPOTLIGHT (ÍT LÊN SÓNG): ${coolDucks.slice(0, 3).join(', ')}.`
  } else {
    spotlightInstruction = `\n🔦 SPOTLIGHT: Tự do tia drama cháy nhất, tém tém vụ nhắc lặp ${hotDucks.slice(0, 2).join(', ')}.`
  }

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

        // Count mentions for final recap logic
        const winnerMentions = mentions[winner] || 0
        const darkHorse = winnerMentions === 0 ? " (Kẻ im lặng đáng sợ)" : ""

        resultsInfo = `\nKQ: 👑 VÔ ĐỊCH: ${winner}${darkHorse}`

        if (shieldUsers.length > 0 && noShieldLosers.length > 0) {
          const savedDuck = shieldUsers[0].name
          const unluckyDuck = noShieldLosers[0].name
          resultsInfo += ` | 🛡️ ${savedDuck} (DÙNG KHIÊN) | 💀 ${unluckyDuck} (BỊ SẸO)`
          shieldContext = `\nTWIST KHIÊN: ${savedDuck} buff khiên thoát kiếp bết bát ảo ma, đẩy ${unluckyDuck} ra chuồng gà ôm sẹo. Khịa căng đét vô!`
        } else if (shieldUsers.length === 0) {
          resultsInfo += ` | 💀 2 VỊT: ${bottom2.map(r => r.name).join(' & ')}`
          shieldContext = `\nTWIST KHIÊN: Hai báo thủ dắt tay nhau quên bật khiên, ôm sẹo chung cho có bạn có bè!`
        } else {
          resultsInfo += ` | 💀 KHIÊN VÔ DỤNG: ${bottom2.map(r => r.name).join(' & ')}`
          shieldContext = `\nTWIST KHIÊN: Nổ khiên sáng rực rỡ mà vẫn cút về chót, xui đỉnh nóc bay phấp phới luôn!`
        }
      } catch { /* ignore */ }
    }

    // Include history to check for context in final verdict
    const historyContext = history && history.length > 0
      ? `\n🚫 TRÁNH DÙNG LẠI VĂN NÀY:\n${history.map(h => `- ${h.text}`).join('\n')}`
      : ''

    return `${SYSTEM_PROMPT}

TÌNH HUỐNG: VỀ ĐÍCH!${namesInfo}${resultsInfo}${shieldContext}${historyContext}

NHIỆM VỤ: Viết 1 câu chốt hạ cực gắt (MAX 25 từ).
- Vinh danh Quán quân bằng vocab "ao chình", "bá cháy".
- Tế sống kẻ thua cuộc tận đáy xã hội (đặc biệt vụ dùng khiên).
- Nếu Thomas thắng/thua: "Sếp out trình" hoặc "Sếp bị dí đi bụi".

Ví dụ: "Zịt A lụm cúp êm ru ao chình vãi, trong khi Zịt B bung khiên nín thở thoát kiếp nợ đời bỏ Zịt C ôm sẹo khóc thét!"`
  }

  // Define historyInfo for in-race prompt
  const historyInfo = history && history.length > 0
    ? `\n🚫 TRÁNH DÙNG LẠI VĂN CŨ:\n${history.map(h => `- ${h.text}`).join('\n')}`
    : '\n(Chưa có văn giải nghệ)'

  // Dynamic context based on race phase
  let focusStrategy = ""
  if (timestampSeconds <= 5) {
    focusStrategy = "KHỞI ĐỘNG: Đứa nào bứt tốc flex sức mạnh? Đứa nào đứng hình vô tri?"
  } else if (timestampSeconds <= 20) {
    focusStrategy = "DIỄN BIẾN: Khúc cua gắt! Lật cái bàn (quay xe) cỡ nào? Ai đang hít khói khóc thét?"
  } else {
    focusStrategy = "VỀ ĐÍCH: Ai sắp lụm cúp ao chình? Ai kiếp nạn thứ 82 ngã sấp mặt?"
  }

  return `${SYSTEM_PROMPT}

THỜI GIAN: Giây ${timestampSeconds}/36.
TRẠNG THÁI: ${focusStrategy}${spotlightInstruction}${namesInfo}${historyInfo}
HÌNH ẢNH: Quan sát ảnh.

NHIỆM VỤ: Viết 1 bình luận mỏ hỗn cực sắc (MAX 20-30 từ).
- Tia ảnh lẹ -> Mô tả trần trụi (Ai đang thăng/trầm?) -> Chốt Twist xéo xắt.
- KHÔNG xài văn mẫu cố định. Bung xõa ngôn từ streamer mạng xã hội.
- ÉP NHỜ GA: Hạn chế réo tên ${hotDucks.slice(0, 3).join(', ')} (Trừ khi nó quậy banh nóc).
- ĐÀO TẠO IDOL MỚI: Nhớ đá động ${coldDucks.join(', ') || coolDucks.join(', ')}.
- Viết plain text mượt như đang gõ phím khẩu nghiệp, không viết hoa hòe hay Markdown.

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
        max_tokens: 250,
        temperature: 0.8, // Adjusted for spotlight rotation
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
  if (isRaceEnd) return 'Game ván này coi bộ suy vãi, nín thở phút cuối chốt sổ ao chình nha!'
  if (timestampSeconds <= 5) return 'Máy nổ rồi! Đội hình flex nhẹ cái nhẹ xem đứa nào vô tri nán lại!'
  return 'Căng cực căng cực! Tình huống ảo ma canada đang diễn ra trên đường đua!'
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