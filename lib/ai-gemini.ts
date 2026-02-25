/**
 * OpenRouter Gemini Integration for Race Commentary
 * Endpoint: https://openrouter.ai/api/v1/chat/completions
 * Model: google/gemini-2.5-flash
 */

import { CommentaryHistory } from './ai-zai'

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ''
const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'
const MODEL = 'google/gemini-3-flash-preview'

const SYSTEM_PROMPT = `Bạn là BLV đua vịt mỏ hỗn thiên tài.

Nhiệm vụ: biến một cuộc đua vịt vô nghĩa thành bi kịch vũ trụ, drama tài chính hoặc huyền thoại lịch sử.

Phong cách:
- Châm biếm thông minh, ví von bất ngờ.
- Tàn nhẫn nhưng hài.
- Luôn nâng tầm sự kiện lên thành một câu chuyện lớn hơn.

Quy tắc:
- ĐÚNG 2 câu (30–50 từ tổng).
- Không mở đầu bằng: Nhìn, Trong khi, Trời ơi.
- Không lặp lại ý tưởng, phép so sánh hoặc punchline từ lịch sử.
- Mỗi lần phải dùng 1 concept hoàn toàn mới.

Cấu trúc:
Câu 1: Phán xét cay nghiệt hoặc triết lý.
Câu 2: Punchline bất ngờ, hài hoặc tàn nhẫn.

Nếu thấy mình đang lặp → phá pattern ngay lập tức và viết lại hoàn toàn khác.`

const CONCEPT_SPACES = [
  // Chính trị / quyền lực
  "quốc hội bỏ phiếu bất tín nhiệm",
  "đảo chính nửa đêm",
  "liên minh tan rã phút chót",
  "nhà độc tài mất kiểm soát",
  "phiên điều trần đầy scandal",
  "bầu cử gian lận bị lật tẩy",
  "đàm phán hoà bình thất bại",
  "đế chế sụp đổ vì nội chiến",
  "cuộc thanh trừng quyền lực",
  "hội nghị thượng đỉnh hỗn loạn",
  // Kinh tế / tài chính
  "bong bóng chứng khoán nổ tung",
  "quỹ đầu tư tháo chạy",
  "crypto rug pull kinh điển",
  "ngân hàng phá sản dây chuyền",
  "IPO thảm hoạ",
  "bear market kéo dài",
  "nhà đầu tư FOMO rồi vỡ mộng",
  "mô hình ponzi sụp đổ",
  "làn sóng sa thải toàn cầu",
  "startup burn rate quá đà",
  "quỹ phòng hộ cháy tài khoản",
  "thị trường margin call hàng loạt",
  // Startup / công sở
  "cuộc họp chiến lược thất bại",
  "KPI bóp nghẹt nhân sự",
  "sếp toxic lên ngôi",
  "nhân viên nghỉ việc hàng loạt",
  "quản lý vi mô gây thảm hoạ",
  "team building biến thành nội chiến",
  "performance review cay nghiệt",
  "pivot sai thời điểm",
  "burnout tập thể",
  "chính sách nội bộ phản tác dụng",
  "board họp kín sa thải CEO",
  "deadline chồng deadline",
  // Công nghệ / tương lai
  "AI nổi loạn giành quyền kiểm soát",
  "server sập giờ cao điểm",
  "thuật toán thao túng xã hội",
  "metaverse phá sản",
  "blockchain fork chia rẽ",
  "cyber attack quy mô lớn",
  "robot đình công",
  "data leak toàn cầu",
  "deepfake phá huỷ danh tiếng",
  "hệ điều hành lỗi hệ thống",
  "startup AI thổi phồng định giá",
  "nền tảng số sụp đổ dây chuyền",
  // Showbiz / văn hoá
  "drama hậu trường nổ tung",
  "scandal ngoại tình lộ clip",
  "show thực tế lật mặt phút cuối",
  "màn comeback thất bại",
  "diễn viên chính bị thay vai",
  "fan war cháy khét",
  "giải thưởng mua bằng tiền",
  "idol hết thời",
  "phim bom tấn flop nặng",
  "anti-fan lên sóng",
  "hợp đồng quảng cáo bị huỷ",
  "ngôi sao dính phốt liên hoàn",
  // Lịch sử / chiến tranh
  "trận thành bị vây hãm",
  "cuộc viễn chinh thất bại",
  "tướng lĩnh phản bội",
  "chiến thuật gọng kìm sụp đổ",
  "đội quân đào ngũ giữa trận",
  "hiệp ước đình chiến phản tác dụng",
  "chiến tranh lạnh leo thang",
  "vương triều bị ám sát",
  "đại dịch thời trung cổ",
  "cuộc thập tự chinh sai lầm",
  "đế quốc bành trướng quá đà",
  "quân tiếp viện đến trễ",
  // Tâm linh / huyền bí
  "giáo phái tự phong cứu thế",
  "lời tiên tri sai lệch",
  "nghi thức triệu hồi thất bại",
  "nghiệp báo quay ngược",
  "kiếp nạn thứ 81",
  "thiên cơ bị lộ",
  "bùa chú phản chủ",
  "pháp sư mất linh lực",
  "thiên mệnh đổi chủ",
  "ngày tận thế giả",
  "thần bảo hộ nghỉ việc",
  "luân hồi lỗi hệ thống",
  // Triết học / tâm lý
  "chủ nghĩa hư vô lên ngôi",
  "bi kịch hiện sinh",
  "nghịch lý tự do tuyệt đối",
  "thí nghiệm đạo đức thất bại",
  "ảo tưởng kiểm soát",
  "vòng lặp nhận thức sai lầm",
  "cú sốc bản ngã",
  "triết lý stoic bị bóp méo",
  "thuyết định mệnh nghiệt ngã",
  "khủng hoảng danh tính",
  "ý chí tự do sụp đổ",
  "niềm tin tập thể tan vỡ",
  // Game / esports
  "team pick sai meta",
  "combat tổng thất bại",
  "late game choke nặng",
  "mid lane feed vô thức",
  "rank cao nhưng kỹ năng thấp",
  "clutch pha cuối hụt tay",
  "tactical pause vô nghĩa",
  "streamer outplay cả giải",
  "buff nhầm mục tiêu",
  "draft chiến thuật sai bài",
  "carry bỏ team",
  "combat thua vì ping cao",
  // Phi lý / vũ trụ
  "vũ trụ song song va chạm",
  "timeline bị bẻ cong",
  "nghịch lý du hành thời gian",
  "thần linh bỏ việc tập thể",
  "ngày tận thế bị delay",
  "cỗ máy vận mệnh trục trặc",
  "luật nhân quả lỗi hệ thống",
  "ngân hà phá sản",
  "thực tại bị glitch",
  "đa vũ trụ hợp nhất lỗi",
  "hố đen nuốt kịch bản",
  "entropy tăng đột biến",
]

// Module-level state: tránh lặp concept 2 lần liên tiếp
let lastConceptIndex = -1

function pickConcept(): string {
  let idx: number
  do {
    idx = Math.floor(Math.random() * CONCEPT_SPACES.length)
  } while (idx === lastConceptIndex)
  lastConceptIndex = idx
  return CONCEPT_SPACES[idx]
}

function buildPrompt(
  timestampSeconds: number,
  isRaceEnd: boolean,
  participantNames?: string,
  history?: CommentaryHistory[],
  raceResults?: string
): string {
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

    const historyContext = history && history.length > 0
      ? `\n🚫 TRÁNH DÙNG LẠI VĂN NÀY:\n${history.map(h => `- ${h.text}`).join('\n')}`
      : ''

    const endConcept = pickConcept()
    return `${SYSTEM_PROMPT}\n\nTÌNH HUỐNG: VỀ ĐÍCH!${namesInfo}${resultsInfo}${shieldContext}${historyContext}\n🎯 CONCEPT BẮT BUỘC CHO LẦN NÀY: "${endConcept}" — hãy dùng đúng góc nhìn này để bình luận, không được dùng concept khác.\n\nNHIỆM VỤ: Viết 1 đoạn chốt hạ cực gắt, ĐÚNG 2 CÂU (~30-50 từ).\n- Vinh danh Quán quân HOẶC sỉ nhục Kẻ bết bát qua lăng kính concept trên.\n- Tuyệt đối né những từ mở đầu lặp lố bịch như "Nhìn", "Trời ơi".\n- TRÁNH XA các idea đã dùng trong LỊCH SỬ BÌNH LUẬN.`
  }

  const historyInfo = history && history.length > 0
    ? `\n🚫 LỊCH SỬ BÌNH LUẬN (TUYỆT ĐỐI KHÔNG DÙNG LẠI CHẤT VĂN Ở DƯỚI):\n${history.map(h => `- ${h.timestamp}s: ${h.text}`).join('\n')}`
    : '\n(Chưa bình luận gì, tự do xõa ngôn từ)'

  let focusStrategy = ""
  if (timestampSeconds <= 5) {
    focusStrategy = "KHỞI ĐỘNG: Đứa nào bứt tốc flex sức mạnh? Đứa nào đứng hình dính breakpoint?"
  } else if (timestampSeconds <= 20) {
    focusStrategy = "DIỄN BIẾN: Khúc cua gắt! Lật kèo phút 90 cỡ nào? Ai đang hít khói khóc thét?"
  } else {
    focusStrategy = "VỀ ĐÍCH: Ai sắp lụm cúp hiệu năng đỉnh? Ai kiếp nạn thứ 82 ngã sấp mặt?"
  }

  const concept = pickConcept()
  return `${SYSTEM_PROMPT}\n\nTHỜI GIAN: Giây ${timestampSeconds}/36.\nTRẠNG THÁI: ${focusStrategy}${spotlightInstruction}${namesInfo}${historyInfo}\nHÌNH ẢNH: Quan sát ảnh.\n🎯 CONCEPT BẮT BUỘC CHO LẦN NÀY: "${concept}" — hãy dùng đúng góc nhìn này để bình luận, không được dùng concept khác.\n\nNHIỆM VỤ: Viết 1 bình luận xéo xắt, ĐÚNG 2 CÂU (~30-50 từ).\n- Phân tích ảnh → Câu 1 phán xét/triết lý qua lăng kính "${concept}". Câu 2 punchline tàn nhẫn hoặc hài.\n- CẤM MỞ ĐẦU BẰNG "Nhìn [tên vịt]", "Trong khi", "Trời ơi".\n- ÉP NHỜ GA: Hạn chế réo tên ${hotDucks.slice(0, 3).join(', ')}.\n- ĐÀO TẠO KHUẤT TẦM: Chửi rủa/Thương hại lố lăng ${coldDucks.join(', ') || coolDucks.join(', ')}.\n- Viết plain text mượt như đang nói trên sóng livestream.\n\nVIẾT NGAY:`
}

export async function generateGeminiCommentary(
  screenshotBase64: string,
  timestampSeconds: number,
  isRaceEnd: boolean = false,
  participantNames?: string,
  history?: CommentaryHistory[],
  raceResults?: string
): Promise<string> {
  if (!OPENROUTER_API_KEY) {
    console.warn('OPENROUTER_API_KEY not set')
    return getFallbackCommentary(timestampSeconds, isRaceEnd)
  }

  try {
    const prompt = buildPrompt(timestampSeconds, isRaceEnd, participantNames, history, raceResults)
    const rawBase64 = screenshotBase64.replace(/^data:image\/w+;base64,/, '')
    const imageUrl = `data:image/jpeg;base64,${rawBase64}`

    const response = await fetch(OPENROUTER_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://autoduck.shivaluma.com', // Optional, for OpenRouter rankings
        'X-Title': 'AutoDuck', // Optional, for OpenRouter rankings
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 150,
        temperature: 0.9,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageUrl } },
            ],
          },
        ],
      }),
    })

    if (!response.ok) {
      throw new Error((await response.text()))
    }

    const data = await response.json()
    let text = data.choices?.[0]?.message?.content || ''

    // Clean up
    text = text
      .replace(/^["']|["']$/g, '')
      .replace(/^(Giây \d+|Phút \d+).*?:/i, '')
      .replace(/(\r\n|\n|\r)/gm, " ")
      .replace(/---\s*.*/, "")
      .replace(/\*?Giải thích:.*$/i, "")
      .trim()

    console.log(`[Gemini][${timestampSeconds}s] ${text.substring(0, 60)}...`)
    return text || getFallbackCommentary(timestampSeconds, isRaceEnd)
  } catch (error) {
    console.error('Gemini API Error:', error)
    return getFallbackCommentary(timestampSeconds, isRaceEnd)
  }
}

function getFallbackCommentary(timestampSeconds: number, isRaceEnd: boolean): string {
  if (isRaceEnd) return 'Chấn động luôn! Đường đua kết thúc với hiệu năng cực đỉnh, kẻ báo thủ chính thức cook và ôm sẹo!'
  if (timestampSeconds <= 5) return 'Súng nổ rồi! Vừa vô đã flex gắt quá, có ai dính breakpoint chưa kịp load data không?'
  if (timestampSeconds <= 20) return 'Anh em chạy nhìn như đang chờ Deployment thế, nhiệt lên! Pha bứt tốc kinh điển cút luôn cái nết!'
  return 'Úi giời ơi! Lật kèo kinh điển phút chót! Cục diện đang cực kỳ hỗn loạn!'
}
