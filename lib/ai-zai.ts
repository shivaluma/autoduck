/**
 * Z.AI GLM-4.6v Integration for Race Commentary
 * V10: "Gen Z Meme Lord" + "Văn Mẫu" (Massive Example Bank)
 * Endpoint: https://api.z.ai/api/coding/paas/v4/chat/completions
 */

const ZAI_API_KEY = process.env.Z_AI_API_KEY || ''
const ZAI_ENDPOINT = 'https://api.z.ai/api/coding/paas/v4/chat/completions'
const MODEL = 'glm-4.6v'

export const COMMENTARY_TIMESTAMPS = [0, 5, 10, 15, 20, 25, 30, 33]

const RACE_DURATION = 36

export interface CommentaryHistory {
  timestamp: number
  text: string
}

const SYSTEM_PROMPT = `Bạn là BLV Đua Vịt hệ "Chiến Thần Chặt Chém" - Ngôn ngữ sắc bén, gãy gọn, dùng từ đắt.
Phong cách: Kể chuyện drama, tập trung vào 1-2 nhân vật nổi bật nhất. TUYỆT ĐỐI KHÔNG LIỆT KÊ.

TỪ ĐIỂN BẮT BUỘC (Dùng linh hoạt, đúng ngữ cảnh):
- Vịt bứt tốc: "Dùng Thanh Nộ" (TUYỆT ĐỐI KHÔNG DÙNG TỪ KHÁC như "Bung").
- Vịt chậm/tụt lại: "Phùng Canh Mộ".
- Vịt out trình (bỏ xa đối thủ): "Chưa tày đâu".
- Vịt lật kèo (đang thua thành thắng): "Quay xe", "Ảo ma".
- Vịt bị vượt mặt: "Hít khói", "Tắt điện".

QUY TẮC BẤT DI BẤT DỊCH:
1. "NHAI LẠI LÀ DỞ": Tuyệt đối KHÔNG lặp lại từ lóng/văn mẫu đã dùng ở các giây trước (Xem LỊCH SỬ BÌNH LUẬN).
2. "TẬP TRUNG DRAMA": Chỉ nói về 1-2 con vịt đang có biến động lớn nhất (vượt lên hoặc tụt xuống).
3. "THOMAS LÀ SẾP": Nhưng Sếp chỉ được nhắc đến KHI VÀ CHỈ KHI hắn đang DẪN ĐẦU hoặc VỀ BÉT. Nếu chạy giữa đoàn thì KỆ SẾP.
4. CẤU TRÚC: Ngắn gọn, súc tích (Max 40 từ), đấm thẳng vào vấn đề.
5. CẤM TIỆT: Các từ thừa "Bình luận giây...", "Kết quả...", "Sếp Thomas vẫn...". Vào thẳng nội dung.`

function buildPrompt(
  timestampSeconds: number,
  isRaceEnd: boolean,
  participantNames?: string,
  history?: CommentaryHistory[],
  raceResults?: string
): string {
  const namesInfo = participantNames ? `\nCASTING: ${participantNames}.` : ''

  // Define these variables with default empty strings so they are accessible in all returns
  let historyInfo = ''
  if (history && history.length > 0) {
    historyInfo = `\n🚫 DANH SÁCH CẤM (ĐÃ DÙNG - KHÔNG ĐƯỢC LẶP LẠI TỪ KHÓA TRONG NÀY):\n${history.map(h => `- ${h.text}`).join('\n')}`
  } else {
    historyInfo = '\n(Chưa có kịch bản)'
  }

  if (isRaceEnd) {
    let resultsInfo = ''
    // The original shieldContext was only used in the race end prompt, and its logic is now integrated into the new prompt.
    // So, no need for a separate shieldContext variable at this scope.

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

    // Return the "End Game" prompt immediately
    return `${SYSTEM_PROMPT}

TÌNH HUỐNG: Về đích!${namesInfo}${resultsInfo}${historyInfo}

NHIỆM VỤ: Viết đoạn bình luận tổng kết (khoảng 40-50 từ).
- Vinh danh nhà vô địch bằng từ ngữ "đắt" nhất.
- Cà khịa cực mạnh kẻ về cuối (đặc biệt vụ dùng khiên/không dùng khiên).
- Nhắc đến Thomas (Sếp) với vai trò người phán xử.

Ví dụ: "Zịt A đã Dùng Thanh Nộ đúng lúc để đăng quang, trong khi Zịt B khôn ngoan dùng khiên thoát nạn. Còn Zịt C thì ôi thôi, bận Phùng Canh Mộ quá lâu nên giờ nhận sẹo, bài học nhớ đời!"`
  }

  // Randomize focus instruction based on timestamp to ensure variety
  const focusStrategy = timestampSeconds % 3 === 0
    ? "Tập trung vào con VỊT ĐANG BỨT TỐC/DẪN ĐẦU (Trừ khi là Thomas thì bỏ qua nếu không có gì đặc biệt)."
    : (timestampSeconds % 3 === 1
      ? "Tập trung vào con VỊT BỊ TỤT LẠI/LẶN MẤT TĂM."
      : "Tập trung vào cuộc CHIẾN GIỮA 2 CON VỊT (Không nhắc đến Thomas).")

  return `${SYSTEM_PROMPT}

THỜI GIAN: Giây ${timestampSeconds}/36.
HÌNH ẢNH: Quan sát ảnh chụp đường đua.
CHIẾN THUẬT: ${focusStrategy}${namesInfo}${historyInfo}

NHIỆM VỤ: Viết 1 đoạn bình luận (30-40 từ) "chặt chém" diễn biến trong ảnh.
- Dùng TỪ ĐIỂN BẮT BUỘC (Thanh Nộ, Phùng Canh Mộ, Chưa tày đâu, Quay xe...)
- Kiểm tra danh sách "🚫 ĐÃ DÙNG" ở trên. Nếu từ lóng nào đã xuất hiện, CẤM DÙNG LẠI. Hãy dùng từ khác hoặc mô tả khác.
- KHÔNG BẮT ĐẦU BẰNG "Bình luận giây...", "Sếp Thomas...". Vào thẳng câu chuyện.

VIẾT NGAY:`
}

interface ZaiResponse {
  choices: Array<{
    message: {
      content: string
    }
  }>
}

export async function generateZaiCommentary(
  screenshotBase64: string,
  timestampSeconds: number,
  isRaceEnd: boolean = false,
  participantNames?: string,
  history?: CommentaryHistory[],
  raceResults?: string
): Promise<string> {
  if (!ZAI_API_KEY) {
    console.warn('Z_AI_API_KEY not set')
    return getFallbackCommentary(timestampSeconds, isRaceEnd)
  }

  try {
    const prompt = buildPrompt(timestampSeconds, isRaceEnd, participantNames, history, raceResults)
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
        temperature: 1.0,
        top_p: 0.9,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: imageUrl },
              },
              { type: 'text', text: prompt },
            ],
          },
        ],
      }),
    })

    if (!response.ok) {
      throw new Error((await response.text()))
    }

    const data: ZaiResponse = await response.json()
    let text = data.choices?.[0]?.message?.content || ''

    // Clean up
    text = text
      .replace(/^["']|["']$/g, '')
      .replace(/^(Giây \d+|Phút \d+).*?:/i, '')
      .replace(/(\r\n|\n|\r)/gm, " ")
      .replace(/---[\s\S]*/, "")
      .replace(/\*?Giải thích:.*$/i, "")
      .trim()

    console.log(`[ZAI][${timestampSeconds}s] ${text.substring(0, 60)}...`)
    return text || getFallbackCommentary(timestampSeconds, isRaceEnd)
  } catch (error) {
    console.error('Z.AI API Error:', error)
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
