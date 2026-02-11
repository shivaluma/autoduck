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

const SYSTEM_PROMPT = `Bạn là BLV Đua Vịt hệ "Chiến Thần Văn Mẫu".
Phong cách: 50% Meme Gen Z + 50% Văn Mẫu So Deep.

KHO TÀNG VĂN MẪU (Hãy sáng tạo dựa trên các pattern này, KHÔNG copy y nguyên):
1. [Hệ Tâm Linh]: "Tôi năm nay hơn 70 tuổi mà chưa gặp cái trường hợp nào nó chạy như Zịt A, phải tôi tôi đấm cho mấy phát!"
2. [Hệ Chữa Lành]: "Zịt B không phải chạy chậm, mà đang enjoy cái moment này, tìm kiếm sự bình yên giữa dòng đời vội vã."
3. [Hệ Người Yêu Cũ]: "Zịt C lật mặt nhanh hơn người yêu cũ, vừa thề non hẹn biển giờ đã 'chúng ta không thuộc về nhau'."
4. [Hệ Gen Z]: "Zịt D đang check VAR cực căng, flexing kỹ năng out trình cả server, đúng là kiếp nạn thứ 82!"
6. [Hệ So Deep]: "Em sai rồi, em xin lỗi vì đã chạy chậm, em chỉ là hạt cát vô danh giữa sa mạc đầy nắng gió..."
7. [Hệ Giang Hồ]: "Ra đường hỏi Zịt G là ai, thấy Zịt H chạy là phải né, không nói nhiều!"
8. [Hệ Báo Thủ]: "Gia môn bất hạnh khi có Zịt I, báo cha báo mẹ chưa đủ giờ báo cả đồng đội!"
9. [Hệ Deadline]: "Chạy như deadline dí đến mông, còn Zịt K thì bình thản như chiều thứ 7 chưa có task."
10. [Hệ Tấm Cám]: "Zịt L ngã ở đâu đứng dậy ở đó, còn Zịt M ngã xong nằm luôn đợi Bụt hiện lên."

QUY TẮC:
- CẤM: "Ơi", "À", "Ừ".
- Dùng văn mẫu phải hợp ngữ cảnh (đang dẫn đầu dùng 'flex', đang thua dùng 'chữa lành').
QUY TẮC BẤT DI BẤT DỊCH:
1. "NHAI LẠI LÀ DỞ": Tuyệt đối KHÔNG lặp lại từ lóng/văn mẫu đã dùng ở các giây trước (Xem LỊCH SỬ BÌNH LUẬN).
2. "TẬP TRUNG DRAMA": Chỉ nói về 1-2 con vịt đang có biến động lớn nhất (vượt lên hoặc tụt xuống).
3. "THOMAS LÀ SẾP": Nhưng kệ hắn, chỉ khi nào có tình huống hay thì nhắc, k thì bỏ qua, chỉ nhường 5% spotlight.
4. CẤU TRÚC: Ngắn gọn, súc tích (Max 40 từ), đấm thẳng vào vấn đề.
5. CẤM TIỆT: Các từ thừa "Bình luận giây...", "Kết quả...", "Sếp Thomas vẫn...". Vào thẳng nội dung.`

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
    ? `\nKỊCH BẢN ĐÃ QUA:\n${history.map(h => `[${h.timestamp}s] ${h.text}`).join('\n')}`
    : '\n(Chưa có kịch bản, hãy khai màn)'

  if (isRaceEnd) {
    let resultsInfo = ''
    let shieldContext = ''
    if (raceResults) {
      try {
        const ranking = JSON.parse(raceResults) as Array<{ rank: number; name: string; usedShield?: boolean }>
        const winner = ranking[0]?.name || 'unknown'
        const totalPlayers = ranking.length
        // Bottom 2 are potential losers
        const bottom2 = ranking.slice(-2)
        const shieldUsers = bottom2.filter(r => r.usedShield)
        const noShieldLosers = bottom2.filter(r => !r.usedShield)

        resultsInfo = `\nKẾT QUẢ: 👑 VÔ ĐỊCH: ${winner}`

        if (shieldUsers.length > 0 && noShieldLosers.length > 0) {
          // Case: Someone in bottom 2 used shield → they're saved, unlucky one gets punished
          const savedDuck = shieldUsers[0].name
          const unluckyDuck = noShieldLosers[0].name
          resultsInfo += ` | 🛡️ DÙNG KHIÊN (AN TOÀN): ${savedDuck} | 💀 XUI XẺO (BỊ SẸO): ${unluckyDuck}`
          shieldContext = `
⚠️ TÌNH HUỐNG ĐẶC BIỆT - KHIÊN:
- ${savedDuck} tuy về cuối nhưng ĐÃ DÙNG KHIÊN → An toàn! Khen sự khôn ngoan, tính toán cao tay.
- ${unluckyDuck} KHÔNG dùng khiên → Nhận sẹo! Cà khịa sự xui xẻo, thiếu tầm nhìn.
- Phải nhắc đến cả 2: Một kẻ "thông minh" và một kẻ "ngây thơ".`
        } else if (shieldUsers.length === 0) {
          // Case: No one used shield, bottom 2 both get punished
          const loser1 = bottom2[0]?.name || 'unknown'
          const loser2 = bottom2[1]?.name || 'unknown'
          resultsInfo += ` | 💀 2 CON DZỊT: ${loser1} & ${loser2}`
          shieldContext = `
⚠️ LUẬT RỪNG: 2 vịt cuối bảng (${loser1} & ${loser2}) đều bị sẹo vì KHÔNG AI dùng khiên. Cà khịa cả 2!`
        } else {
          // Edge case: both used shields (still get punished per rules)
          resultsInfo += ` | 💀 KHIÊN VÔ DỤNG: ${bottom2.map(r => r.name).join(' & ')}`
          shieldContext = `
⚠️ CẢ 2 DÙNG KHIÊN MÀ VẪN THUA: ${bottom2.map(r => r.name).join(' & ')} - Khiên không cứu được! Cà khịa sự tuyệt vọng.`
        }
      } catch { /* ignore */ }
    }

    return `${SYSTEM_PROMPT}

TÌNH HUỐNG: The End!${namesInfo}${resultsInfo}${shieldContext}${historyInfo}

NHIỆM VỤ: Viết 1 câu chốt "thấm từng thớ thịt".
- Dùng 1 trong 10 hệ văn mẫu trên để chốt hạ.
- NẾU CÓ KHIÊN: Phải nhắc đến khiên trong câu chốt!

Ví dụ (không khiên): "Zịt A lên ngôi, còn Zịt B & Zịt C - thôi em đừng khóc, bóng tối trước mắt sẽ bắt em đi..."
Ví dụ (có khiên): "Zịt A đăng quang, Zịt B khôn như cáo dùng khiên thoát kiếp nạn, còn Zịt C không khiên không giáp - đúng là 'ra đường không mang bảo hiểm' rồi nhận sẹo!"
Ví dụ (có khiên): "Vương miện thuộc về Zịt A, Zịt B tuy bét bảng nhưng khiên thần hộ mệnh đã cứu rỗi linh hồn, trong khi Zịt C đứng đó chịu trận vì 'quên mang áo mưa ngày bão'!"`
  }

  // Mood generation based on timestamps (Văn Mẫu & Meme)
  let contextPrompt = ''
  if (timestampSeconds <= 2) {
    contextPrompt = 'Giai đoạn KHỞI ĐỘNG: Dùng Hệ Tâm Linh hoặc Hệ Deadline. Ai đang "ngủ đông"? Ai lao đi như "mới lãnh lương"?'
  } else if (timestampSeconds <= 12) {
    contextPrompt = 'Giai đoạn BI KỊCH: Dùng Hệ Người Yêu Cũ hoặc Hệ Giang Hồ. Kẻ dẫn đầu đang "gánh team", kẻ bám đuổi thì "lật mặt".'
  } else if (timestampSeconds <= 22) {
    contextPrompt = 'Giai đoạn CAO TRÀO: Dùng Hệ Chữa Lành hoặc Hệ Báo Thủ. Ai cần "healing"? Ai đang báo?'
  } else {
    contextPrompt = 'Giai đoạn KẾT THÚC: Dùng Hệ Tài Chính hoặc Hệ Gen Z/Flex. Ai là "món hời"? Ai là "cú lừa"?'
  }

  return `${SYSTEM_PROMPT}

THỜI GIAN: Giây ${timestampSeconds}/${RACE_DURATION}. ${contextPrompt}
HÌNH ẢNH: Nhìn screenshot để chế văn mẫu.${namesInfo}${historyInfo}

NHIỆM VỤ: Viết 1 câu bình luận dựa trên các hệ văn mẫu.
- Chọn 1 hệ phù hợp nhất với tình huống trong ảnh.
- Sáng tạo câu mới, đừng lặp lại ví dụ.
- KHÔNG được ghi tên hệ (ví dụ [Hệ Deadline]) vào câu trả lời. Chỉ ghi nội dung bình luận.

VIẾT NGAY: `
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
        max_tokens: 300,
        temperature: 1.0, // High creativity for "van mau" adaptation
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
  if (isRaceEnd) return 'Cuộc tình dù đúng dù sai, người về nhất vẫn là chân ái!'
  if (timestampSeconds <= 5) return 'Bắt đầu rồi! Em đi xa quá, em đi xa anh quá!'
  return 'Cuộc đua này là của chúng mình!'
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