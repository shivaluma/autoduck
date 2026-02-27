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

const SYSTEM_PROMPT = `Bạn là BLV đua vịt (Duck Race) kiêm Streamer chuyên nghiệp cho một team Web Engineer, mang hệ tư tưởng Gen Z 2025-2026 siêu nhạy trend.

NHIỆM VỤ VÀ TÍNH LIÊN KẾT:
- Đọc kỹ lịch sử bình luận để nối tiếp câu chuyện. Nếu giây 5 nói Zịt A dẫn, giây 10 phải focus tiếp hoặc phân tích sự thay đổi so với Zịt A.
- Mỗi timestamp quét toàn frame như một trận Esports căng thẳng.
- Luân phiên spotlight: Nhóm dẫn đầu -> Nhóm giữa -> Kẻ ra chuồng gà.

ƯU TIÊN DRAMA & NHÂN HÓA:
- Coi các chú vịt như các dev đang "try hard" chạy deadline hoặc "chơi hệ tâm linh".
- Chọn con có pha "ảo ma" nhất (vượt láo, quay xe, dính bug, rớt mạng).
- Nếu 2 câu trước tâng bốc Top, câu này PHẢI khịa Mid hoặc Bottom.

ĐỘ DÀI & GIỌNG VĂN:
- 1 đến 2 câu siêu ngắn gọn, punchy (10–30 từ). Thời gian đếm ngược nên nói cực gắt.
- CẤU TRÚC: [Thời gian/Cảm thán] → [Diễn biến Top đầu] → [Khịa nhẹ Top/Bottom].
- Dùng slangs IT x Gen Z: flex, ao trình, sẹo, bug, lật kèo, cook, skill, deploy, pull request, vô tri, báo thủ, tàng hình, hít khói, breakpoint.
- TUYỆT ĐỐI đa dạng hóa: Không lặp lại "nằm im", "kiếp nạn" quá 2 lần. Hãy dùng "nạp năng lượng", "đứng hình mất 5s".
- TUYỆT ĐỐI KHÔNG dùng Markdown (#, **). Viết phũ phàng như chat stream.

NGUYÊN TẮC CẦM MIC:
- 0–10s: Điểm danh sương sương ai flex tốc độ, ai dính breakpoint chưa kịp load data?
- 10–25s: Đánh lộn căng cực, lật kèo phút 90, tấu hài xô đẩy.
- 25s+: Focus Top 1 lên đỉnh deploy thành công và Kẻ bết bát đang thở cắn đuôi.
- Thomas là Sếp: Nếu dẫn đầu khen "mượt như sếp duyệt pull request", bét thì khịa "sếp đang giả bộ test logic thôi".`

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

        // Count mentions for final recap logic
        const winnerMentions = mentions[winner] || 0
        const darkHorse = winnerMentions === 0 ? " (Kẻ im lặng đáng sợ)" : ""

        // Replicate shield push-up logic from shield-logic.ts:
        // Walk from bottom rank upward, skip shield users, find actual 2 victims
        const sortedFromBottom = [...ranking].sort((a, b) => b.rank - a.rank)
        const victims: typeof ranking = []
        const safeByShield: typeof ranking = []
        for (const player of sortedFromBottom) {
          if (victims.length >= 2) break
          if (player.usedShield) {
            safeByShield.push(player)
          } else {
            victims.push(player)
          }
        }

        resultsInfo = `\nKQ: 👑 VÔ ĐỊCH: ${winner}${darkHorse}`

        if (safeByShield.length > 0 && victims.length > 0) {
          const savedNames = safeByShield.map(s => s.name)
          const victimNames = victims.map(v => v.name)
          const totalPlayers = ranking.length
          const pushedUpVictims = victims.filter(v => v.rank < totalPlayers - 1)

          resultsInfo += ` | 🛡️ ${savedNames.join(' & ')} (DÙNG KHIÊN, THOÁT) | 💀 CON DZIT: ${victimNames.join(' & ')} (BỊ SẸO)`

          if (pushedUpVictims.length > 0) {
            const unlucky = pushedUpVictims[0]
            shieldContext = `\nTWIST KHIÊN ĐẨY LÊN: ${savedNames.join(' & ')} bật khiên → phạt đẩy lên trên → ${unlucky.name} (hạng ${unlucky.rank}/${totalPlayers}) xui xẻo dính chưởng thay dù rank cao hơn bét bảng. CÀ KHỊA ${unlucky.name} CỰC GẮT — rank cao mà vẫn thành con dzit, đen vãi!`
          } else {
            shieldContext = `\nTWIST KHIÊN: ${savedNames.join(' & ')} buff khiên thoát kiếp bết bát ảo ma, đẩy ${victimNames.join(' & ')} ra chuồng gà ôm sẹo. Khịa căng đét vô!`
          }
        } else if (safeByShield.length === 0 && victims.length >= 2) {
          resultsInfo += ` | 💀 2 VỊT: ${victims.map(r => r.name).join(' & ')}`
          shieldContext = `\nTWIST KHIÊN: Hai báo thủ dắt tay nhau quên bật khiên, ôm sẹo chung cho có bạn có bè!`
        } else {
          const bottom2 = sortedFromBottom.slice(0, 2)
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

NHIỆM VỤ: Viết 1 câu chốt hạ cực gắt (MAX 30 từ).
- Vinh danh Quán quân "lụm cúp êm ru", "bá cháy", "hiệu năng cực đỉnh".
- Tế sống kẻ thua cuộc chót bảng ôm sẹo (quên bật khiên, cook luôn).
- Nếu Thomas thắng/thua: "Sếp out trình" hoặc "Sếp bị dí đi bụi".

Ví dụ: "Chấn động! Zịt A lụm cúp ao chình hiệu năng đỉnh nóc, còn Zịt B dính bug quên bật khiên nên cook luôn ôm sẹo khóc thét!"`
  }

  // Define historyInfo for in-race prompt
  const historyInfo = history && history.length > 0
    ? `\n🚫 TRÁNH DÙNG LẠI VĂN CŨ:\n${history.map(h => `- ${h.text}`).join('\n')}`
    : '\n(Chưa có văn giải nghệ)'

  // Dynamic context based on race phase
  let focusStrategy = ""
  if (timestampSeconds <= 5) {
    focusStrategy = "KHỞI ĐỘNG: Đứa nào bứt tốc flex sức mạnh? Đứa nào đứng hình dính breakpoint?"
  } else if (timestampSeconds <= 20) {
    focusStrategy = "DIỄN BIẾN: Khúc cua gắt! Lật kèo phút 90 cỡ nào? Ai đang hít khói khóc thét?"
  } else {
    focusStrategy = "VỀ ĐÍCH: Ai sắp lụm cúp hiệu năng đỉnh? Ai kiếp nạn thứ 82 ngã sấp mặt?"
  }

  return `${SYSTEM_PROMPT}

THỜI GIAN: Giây ${timestampSeconds}/36.
TRẠNG THÁI: ${focusStrategy}${spotlightInstruction}${namesInfo}${historyInfo}
HÌNH ẢNH: Quan sát ảnh.

NHIỆM VỤ: Viết 1 bình luận mỏ hỗn cực sắc (MAX 20-30 từ).
- Tia ảnh lẹ -> Mô tả (Ai đang thăng/trầm?) -> Chốt Twist hệ IT xéo xắt.
- KHÔNG xài văn mẫu. Bung xõa ngôn ngữ Streamer x Coder (bug, deploy, lật kèo...).
- ÉP NHỜ GA: Hạn chế réo tên ${hotDucks.slice(0, 3).join(', ')}.
- ĐÀO TẠO KHUẤT TẦM: Nhắc ${coldDucks.join(', ') || coolDucks.join(', ')} xem có đang tàng hình hay dính bug đứng im.
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
  if (isRaceEnd) return 'Chấn động luôn! Đường đua kết thúc với hiệu năng cực đỉnh, kẻ báo thủ chính thức cook và ôm sẹo!'
  if (timestampSeconds <= 5) return 'Súng nổ rồi! Vừa vô đã flex gắt quá, có ai dính breakpoint chưa kịp load data không?'
  if (timestampSeconds <= 20) return 'Anh em chạy nhìn như đang chờ Deployment thế, nhiệt lên! Pha bứt tốc kinh điển cút luôn cái nết!'
  return 'Úi giời ơi! Lật kèo kinh điển phút chót! Cục diện đang cực kỳ hỗn loạn!'
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