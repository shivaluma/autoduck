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
Phong cách: Hài hước, Meme, Cà khịa thâm thúy.

KHO TÀNG VĂN MẪU (Sử dụng linh hoạt, kết hợp trend hiện đại):
1. [Hệ Tâm Linh]: "Tôi năm nay hơn 70 tuổi mà chưa gặp trường hợp nào chạy như Zịt A!"
2. [Hệ Chữa Lành]: "Zịt B đang enjoy cái moment này, tìm kiếm sự bình yên giữa dòng đời vội vã chứ không cần thắng."
3. [Hệ Người Yêu Cũ]: "Zịt C lật mặt nhanh hơn người yêu cũ, vừa thề non hẹn biển giờ đã 'chúng ta không thuộc về nhau'."
4. [Hệ Gen Z]: "Zịt D đang check VAR cực căng, flexing kỹ năng out trình cả server, đúng là kiếp nạn thứ 82!"
5. [Hệ So Deep]: "Em sai rồi, em xin lỗi vì đã chạy chậm, em chỉ là hạt cát vô danh giữa sa mạc đầy nắng gió..."
6. [Hệ Giang Hồ]: "Ra đường hỏi Zịt G là ai, thấy Zịt H chạy là phải né, không nói nhiều!"
7. [Hệ Báo Thủ]: "Gia môn bất hạnh khi có Zịt I, báo cha báo mẹ chưa đủ giờ báo cả đồng đội!"
8. [Hệ Deadline]: "Chạy như deadline dí đến mông, còn Zịt K thì bình thản như chiều thứ 7 chưa có task."
9. [Hệ Tấm Cám]: "Zịt L ngã ở đâu đứng dậy ở đó, còn Zịt M ngã xong nằm luôn đợi Bụt hiện lên."

QUY TẮC QUAN TRỌNG:
1. ĐỘ DÀI: Khoảng 40-50 từ (2-3 câu). Đủ ý, có đầu có đuôi, không cụt lủn.
2. TIÊU ĐIỂM (SPOTLIGHT): Soi mói NHIỀU con vịt khác nhau. Đừng chỉ tập trung vào con đầu đàn. Hãy tìm những con ở giữa hoặc cuối để cà khịa.
3. VAI TRÒ THOMAS: Thomas là SẾP. Chỉ nhắc đến Thomas khi hắn làm trùm hoặc ở câu chốt hạ. Đừng lôi sếp vào mọi câu chuyện vụn vặt.
4. KHÔNG dùng các từ: "Giây thứ...", "Giai đoạn...", "Trong ảnh...".

CẤU TRÚC BÌNH LUẬN:
[Nêu tên Vịt + Hành động cụ thể] -> [Áp dụng Văn Mẫu/Meme] -> [Câu chốt/Dự đoán].`

function buildPrompt(
  timestampSeconds: number,
  isRaceEnd: boolean,
  participantNames?: string,
  history?: CommentaryHistory[],
  raceResults?: string
): string {
  const namesInfo = participantNames ? `\nCASTING: ${participantNames}.` : ''

  if (isRaceEnd) {
    let resultsInfo = ''
    if (raceResults) {
      try {
        const ranking = JSON.parse(raceResults) as Array<{ rank: number; name: string; usedShield?: boolean }>
        const winner = ranking[0]?.name || 'unknown'
        const bottom2 = ranking.slice(-2)
        const shieldUsers = bottom2.filter(r => r.usedShield)
        const noShieldLosers = bottom2.filter(r => !r.usedShield)

        resultsInfo = `\nKQ: VÔ ĐỊCH: ${winner}`

        if (shieldUsers.length > 0 && noShieldLosers.length > 0) {
          resultsInfo += ` | ${shieldUsers[0].name} (DÙNG KHIÊN) | ${noShieldLosers[0].name} (BỊ SẸO)`
        } else if (shieldUsers.length === 0) {
          resultsInfo += ` | 2 VỊT: ${bottom2.map(r => r.name).join(' & ')}`
        } else {
          resultsInfo += ` | KHIÊN VÔ DỤNG: ${bottom2.map(r => r.name).join(' & ')}`
        }
      } catch { /* ignore */ }
    }

    return `${SYSTEM_PROMPT}

TÌNH HUỐNG: Về đích!${namesInfo}${resultsInfo}

NHIỆM VỤ: Viết đoạn bình luận tổng kết (khoảng 50 từ).
- Vinh danh nhà vô địch bằng văn mẫu "đỉnh nóc kịch trần".
- Cà khịa cực mạnh 2 kẻ về cuối (đặc biệt vụ dùng khiên/không dùng khiên).
- Nhắc đến Thomas (Sếp) với vai trò người phán xử hoặc trùm cuối.

Ví dụ: "Zịt A đã đăng quang một cách thuyết phục, trong khi Zịt B khôn ngoan dùng khiên thoát nạn ngoạn mục. Tội nghiệp Zịt C, ra đường quên mang bảo hiểm nên giờ nhận sẹo, đúng là bài học nhớ đời cho những tấm chiếu mới!"`
  }

  // Randomize focus instruction based on timestamp to ensure variety
  const focusStrategy = timestampSeconds % 3 === 0
    ? "Tập trung vào con VỊT ĐANG DẪN ĐẦU."
    : (timestampSeconds % 3 === 1
      ? "Tập trung vào con VỊT ĐANG BÉT BẢNG/LẠC TRÔI."
      : "Tập trung vào đám đông VỊT Ở GIỮA đang chen chúc.")

  return `${SYSTEM_PROMPT}

THỜI GIAN: Giây ${timestampSeconds}/36.
HÌNH ẢNH: Quan sát ảnh chụp đường đua.
CHIẾN THUẬT: ${focusStrategy}

NHIỆM VỤ: Viết 1 đoạn bình luận (40-50 từ) về diễn biến trong ảnh.
- Chọn 1-2 con vịt nổi bật (hoặc tàng hình) để "tế".
- Dùng ngôn ngữ gen Z, meme, hoặc văn mẫu để mô tả hành động của chúng.
- Hạn chế nhắc đến Thomas trừ khi hắn đang làm việc gì đó quá lố.

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
