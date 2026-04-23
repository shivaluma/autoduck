/**
 * OpenRouter Gemini Integration for Race Commentary
 * Endpoint: https://openrouter.ai/api/v1/chat/completions
 * Model: google/gemini-3-flash-preview
 */

import { CommentaryHistory } from './ai-zai'
import type { RaceMetaContext } from './types'

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ''
const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'
const MODEL = 'google/gemini-3-flash-preview'

// ---------------------------------------------------------------------------
// SYSTEM PROMPT
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `Mày là BLV đua vịt mỏ hỗn đang live trên sóng.

LUẬT SỐ 1 — KHÔNG THỂ PHÁ VỠ:
Câu 1 PHẢI mô tả diễn biến thật của cuộc đua: ai đang dẫn, ai bị tụt, ai vừa vượt, ai đứng hình, khoảng cách thế nào.
Nếu câu 1 không nói rõ điều gì đang xảy ra trên đường đua → toàn bộ bình luận bị tính là hỏng, phải làm lại.

LUẬT SỐ 2 — CẤU TRÚC BẮT BUỘC:
- ĐÚNG 2 câu, tổng 30–50 từ.
- Câu 1: Tường thuật diễn biến đường đua — cụ thể, sắc, như đang nhìn thấy.
- Câu 2: Ẩn dụ / phán xét / punchline bằng concept được giao để nâng drama.

LUẬT SỐ 3 — PHONG CÁCH:
- Giọng BLV esports đang livestream: sắc, ngắn, phản xạ ngay.
- Châm biếm thông minh, ẩn dụ bất ngờ — nhưng ẩn dụ KHÔNG được thay thế tường thuật.
- Không triết học dài dòng. Không truyện ngắn. Không metaphor trừu tượng mà quên mất đang đua vịt.

LUẬT SỐ 4 — CẤM:
- Mở đầu bằng: Nhìn, Trong khi, Trời ơi, Ồ, Wow.
- Lặp lại cấu trúc câu hoặc punchline từ lịch sử bình luận.
- Viết bình luận có thể dán vào bất kỳ cuộc đua nào mà vẫn đúng → đó là bình luận rác.

Kiểm tra trước khi xuất: đọc lại câu 1, nếu không thấy ai đang làm gì trên đường đua → viết lại ngay.`

// ---------------------------------------------------------------------------
// CONCEPT SPACES — grouped by domain for anti-repeat tracking
// ---------------------------------------------------------------------------

interface ConceptEntry {
  domain: string
  text: string
}

const CONCEPT_SPACES: ConceptEntry[] = [
  // Chính trị
  { domain: 'politics', text: 'quốc hội bỏ phiếu bất tín nhiệm' },
  { domain: 'politics', text: 'đảo chính nửa đêm' },
  { domain: 'politics', text: 'liên minh tan rã phút chót' },
  { domain: 'politics', text: 'nhà độc tài mất kiểm soát' },
  { domain: 'politics', text: 'phiên điều trần đầy scandal' },
  { domain: 'politics', text: 'bầu cử gian lận bị lật tẩy' },
  { domain: 'politics', text: 'đàm phán hoà bình thất bại' },
  { domain: 'politics', text: 'đế chế sụp đổ vì nội chiến' },
  { domain: 'politics', text: 'cuộc thanh trừng quyền lực' },
  { domain: 'politics', text: 'hội nghị thượng đỉnh hỗn loạn' },
  // Kinh tế / tài chính
  { domain: 'finance', text: 'bong bóng chứng khoán nổ tung' },
  { domain: 'finance', text: 'quỹ đầu tư tháo chạy' },
  { domain: 'finance', text: 'crypto rug pull kinh điển' },
  { domain: 'finance', text: 'ngân hàng phá sản dây chuyền' },
  { domain: 'finance', text: 'IPO thảm hoạ' },
  { domain: 'finance', text: 'bear market kéo dài' },
  { domain: 'finance', text: 'nhà đầu tư FOMO rồi vỡ mộng' },
  { domain: 'finance', text: 'mô hình ponzi sụp đổ' },
  { domain: 'finance', text: 'làn sóng sa thải toàn cầu' },
  { domain: 'finance', text: 'startup burn rate quá đà' },
  { domain: 'finance', text: 'quỹ phòng hộ cháy tài khoản' },
  { domain: 'finance', text: 'thị trường margin call hàng loạt' },
  // Startup / công sở
  { domain: 'office', text: 'cuộc họp chiến lược thất bại' },
  { domain: 'office', text: 'KPI bóp nghẹt nhân sự' },
  { domain: 'office', text: 'sếp toxic lên ngôi' },
  { domain: 'office', text: 'nhân viên nghỉ việc hàng loạt' },
  { domain: 'office', text: 'quản lý vi mô gây thảm hoạ' },
  { domain: 'office', text: 'team building biến thành nội chiến' },
  { domain: 'office', text: 'performance review cay nghiệt' },
  { domain: 'office', text: 'pivot sai thời điểm' },
  { domain: 'office', text: 'burnout tập thể' },
  { domain: 'office', text: 'board họp kín sa thải CEO' },
  { domain: 'office', text: 'deadline chồng deadline' },
  // Công nghệ
  { domain: 'tech', text: 'AI nổi loạn giành quyền kiểm soát' },
  { domain: 'tech', text: 'server sập giờ cao điểm' },
  { domain: 'tech', text: 'thuật toán thao túng xã hội' },
  { domain: 'tech', text: 'metaverse phá sản' },
  { domain: 'tech', text: 'blockchain fork chia rẽ' },
  { domain: 'tech', text: 'cyber attack quy mô lớn' },
  { domain: 'tech', text: 'robot đình công' },
  { domain: 'tech', text: 'data leak toàn cầu' },
  { domain: 'tech', text: 'deepfake phá huỷ danh tiếng' },
  { domain: 'tech', text: 'startup AI thổi phồng định giá' },
  { domain: 'tech', text: 'nền tảng số sụp đổ dây chuyền' },
  // Showbiz
  { domain: 'showbiz', text: 'drama hậu trường nổ tung' },
  { domain: 'showbiz', text: 'scandal ngoại tình lộ clip' },
  { domain: 'showbiz', text: 'show thực tế lật mặt phút cuối' },
  { domain: 'showbiz', text: 'màn comeback thất bại' },
  { domain: 'showbiz', text: 'diễn viên chính bị thay vai' },
  { domain: 'showbiz', text: 'fan war cháy khét' },
  { domain: 'showbiz', text: 'idol hết thời' },
  { domain: 'showbiz', text: 'phim bom tấn flop nặng' },
  { domain: 'showbiz', text: 'hợp đồng quảng cáo bị huỷ' },
  { domain: 'showbiz', text: 'ngôi sao dính phốt liên hoàn' },
  // Lịch sử / chiến tranh
  { domain: 'war', text: 'trận thành bị vây hãm' },
  { domain: 'war', text: 'cuộc viễn chinh thất bại' },
  { domain: 'war', text: 'tướng lĩnh phản bội' },
  { domain: 'war', text: 'chiến thuật gọng kìm sụp đổ' },
  { domain: 'war', text: 'đội quân đào ngũ giữa trận' },
  { domain: 'war', text: 'hiệp ước đình chiến phản tác dụng' },
  { domain: 'war', text: 'vương triều bị ám sát' },
  { domain: 'war', text: 'đại dịch thời trung cổ' },
  { domain: 'war', text: 'cuộc thập tự chinh sai lầm' },
  { domain: 'war', text: 'quân tiếp viện đến trễ' },
  // Tâm linh
  { domain: 'spiritual', text: 'giáo phái tự phong cứu thế' },
  { domain: 'spiritual', text: 'lời tiên tri sai lệch' },
  { domain: 'spiritual', text: 'nghi thức triệu hồi thất bại' },
  { domain: 'spiritual', text: 'nghiệp báo quay ngược' },
  { domain: 'spiritual', text: 'kiếp nạn thứ 81' },
  { domain: 'spiritual', text: 'bùa chú phản chủ' },
  { domain: 'spiritual', text: 'pháp sư mất linh lực' },
  { domain: 'spiritual', text: 'thiên mệnh đổi chủ' },
  { domain: 'spiritual', text: 'thần bảo hộ nghỉ việc' },
  { domain: 'spiritual', text: 'luân hồi lỗi hệ thống' },
  // Triết học / tâm lý
  { domain: 'philosophy', text: 'chủ nghĩa hư vô lên ngôi' },
  { domain: 'philosophy', text: 'bi kịch hiện sinh' },
  { domain: 'philosophy', text: 'nghịch lý tự do tuyệt đối' },
  { domain: 'philosophy', text: 'ảo tưởng kiểm soát' },
  { domain: 'philosophy', text: 'vòng lặp nhận thức sai lầm' },
  { domain: 'philosophy', text: 'cú sốc bản ngã' },
  { domain: 'philosophy', text: 'thuyết định mệnh nghiệt ngã' },
  { domain: 'philosophy', text: 'khủng hoảng danh tính' },
  { domain: 'philosophy', text: 'niềm tin tập thể tan vỡ' },
  // Esports / game
  { domain: 'esports', text: 'team pick sai meta' },
  { domain: 'esports', text: 'late game choke nặng' },
  { domain: 'esports', text: 'mid lane feed vô thức' },
  { domain: 'esports', text: 'clutch pha cuối hụt tay' },
  { domain: 'esports', text: 'tactical pause vô nghĩa' },
  { domain: 'esports', text: 'streamer outplay cả giải' },
  { domain: 'esports', text: 'buff nhầm mục tiêu' },
  { domain: 'esports', text: 'draft chiến thuật sai bài' },
  { domain: 'esports', text: 'carry bỏ team' },
  // Vũ trụ / phi lý
  { domain: 'cosmic', text: 'vũ trụ song song va chạm' },
  { domain: 'cosmic', text: 'timeline bị bẻ cong' },
  { domain: 'cosmic', text: 'nghịch lý du hành thời gian' },
  { domain: 'cosmic', text: 'thần linh bỏ việc tập thể' },
  { domain: 'cosmic', text: 'ngày tận thế bị delay' },
  { domain: 'cosmic', text: 'cỗ máy vận mệnh trục trặc' },
  { domain: 'cosmic', text: 'luật nhân quả lỗi hệ thống' },
  { domain: 'cosmic', text: 'thực tại bị glitch' },
  { domain: 'cosmic', text: 'hố đen nuốt kịch bản' },
  { domain: 'cosmic', text: 'entropy tăng đột biến' },
]

// ---------------------------------------------------------------------------
// Anti-repeat state: track last concept index AND last domain
// ---------------------------------------------------------------------------

let lastConceptIndex = -1
let lastDomain = ''

function pickConcept(): ConceptEntry {
  const candidates = CONCEPT_SPACES
    .map((c, i) => ({ ...c, i }))
    .filter(c => c.i !== lastConceptIndex && c.domain !== lastDomain)

  // Fallback: at minimum avoid exact same index
  const pool = candidates.length > 0
    ? candidates
    : CONCEPT_SPACES.map((c, i) => ({ ...c, i })).filter(c => c.i !== lastConceptIndex)

  const chosen = pool[Math.floor(Math.random() * pool.length)]
  lastConceptIndex = chosen.i
  lastDomain = chosen.domain
  return chosen
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function buildPrompt(
  timestampSeconds: number,
  isRaceEnd: boolean,
  participantNames?: string,
  history?: CommentaryHistory[],
  raceResults?: string,
  context?: RaceMetaContext
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

  // Spotlight: push under-mentioned ducks into focus
  let spotlightLine = ''
  if (coldDucks.length > 0) {
    spotlightLine = `\n� SPOTLIGHT: Ưu tiên nhắc ${coldDucks.join(', ')} — bọn này chưa lên sóng lần nào.`
  } else if (coolDucks.length > 0) {
    spotlightLine = `\n� SPOTLIGHT: Ưu tiên ${coolDucks.slice(0, 3).join(', ')} — đang thiếu airtime.`
  } else {
    spotlightLine = `\n� SPOTLIGHT: Tự do chọn nhân vật drama nhất; hạn chế réo ${hotDucks.slice(0, 2).join(', ')} quá nhiều.`
  }

  const namesLine = participantNames ? `\nCÁC CON VỊT: ${participantNames}.` : ''
  const metaContext = context
    ? [
        context.boss ? `👑 BOSS: ${context.boss.name} mang ${context.boss.cloneCount} clone, chỉ cần 1 clone về cuối là mất ngôi.` : '',
        context.underdogs && context.underdogs.length > 0
          ? `🎁 UNDERDOG: ${context.underdogs.map((item) => `${item.name} cầm ${item.chest}${item.target ? ` -> ${item.target}` : ''}`).join(' | ')}`
          : '',
        context.shieldsAtRisk && context.shieldsAtRisk.length > 0
          ? `⏳ KHIÊN SẮP VỠ: ${context.shieldsAtRisk.map((item) => `${item.owner} (${item.charges}c)`).join(' | ')}`
          : '',
        context.curseSwaps && context.curseSwaps.length > 0
          ? `🎭 CURSE SWAP: ${context.curseSwaps.map((item) => `${item.owner} đang chạy dưới tên ${item.displayName}`).join(' | ')}`
          : '',
      ].filter(Boolean).join('\n')
    : ''

  // ── RACE END ──────────────────────────────────────────────────────────────
  if (isRaceEnd) {
    let resultsInfo = ''
    let shieldContext = ''
    if (raceResults) {
      try {
        const ranking = JSON.parse(raceResults) as Array<{ rank: number; name: string; usedShield?: boolean }>
        const winner = ranking[0]?.name || 'unknown'
        const darkHorse = (mentions[winner] || 0) === 0 ? ' (kẻ im lặng suốt cuộc đua)' : ''

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

        resultsInfo = `\nKẾT QUẢ: 👑 ${winner}${darkHorse} về đích đầu tiên.`

        if (safeByShield.length > 0 && victims.length > 0) {
          // There are shield users who escaped and real victims
          const savedNames = safeByShield.map(s => s.name)
          const victimNames = victims.map(v => v.name)
          // Check if any victim was NOT originally in bottom 2 (pushed up by shields)
          const totalPlayers = ranking.length
          const pushedUpVictims = victims.filter(v => v.rank < totalPlayers - 1)

          resultsInfo += ` | 🛡️ ${savedNames.join(' & ')} dùng khiên thoát sẹo | 💀 CON DZIT: ${victimNames.join(' & ')}.`

          if (pushedUpVictims.length > 0) {
            // Someone higher ranked got screwed by shield cascade!
            const unlucky = pushedUpVictims[0]
            shieldContext = `\nTWIST KHIÊN ĐẨY LÊN: ${savedNames.join(' & ')} bật khiên → phạt đẩy lên trên → ${unlucky.name} (hạng ${unlucky.rank}/${totalPlayers}) xui xẻo dính chưởng thay dù đứng trên bét bảng. Cà khịa ${unlucky.name} là tâm điểm — rank cao mà vẫn thành con dzit, drama cực!`
          } else {
            shieldContext = `\nTWIST: ${savedNames.join(' & ')} bật khiên phút chót, đẩy ${victimNames.join(' & ')} ra mép bờ vực ôm sẹo.`
          }
        } else if (safeByShield.length === 0 && victims.length >= 2) {
          resultsInfo += ` | 💀 Hai kẻ bết bát: ${victims.map(r => r.name).join(' & ')} — cả hai đều quên bật khiên.`
        } else {
          // Edge case: everyone used shields or not enough victims
          const bottom2 = sortedFromBottom.slice(0, 2)
          resultsInfo += ` | 💀 ${bottom2.map(r => r.name).join(' & ')} — nổ khiên xong vẫn về chót.`
        }
      } catch { /* ignore */ }
    }

    const historyBlock = history && history.length > 0
      ? `\n🚫 ĐÃ DÙNG RỒI — TUYỆT ĐỐI KHÔNG LẶP LẠI:\n${history.map(h => `  - ${h.text}`).join('\n')}`
      : ''

    const { text: concept } = pickConcept()
    return [
      SYSTEM_PROMPT,
      '',
      `TÌNH HUỐNG: VỀ ĐÍCH.${namesLine}${resultsInfo}${shieldContext}${metaContext ? `\n${metaContext}` : ''}`,
      `🎯 CONCEPT: "${concept}"`,
      historyBlock,
      '',
      'NHIỆM VỤ: Viết 1 đoạn chốt hạ, ĐÚNG 2 CÂU (30–50 từ).',
      '- Câu 1: Tường thuật ai thắng/thua và điều gì xảy ra ở khoảnh khắc kết thúc.',
      `- Câu 2: Ẩn dụ qua lăng kính "${concept}" để chốt drama.`,
      '- Không mở đầu bằng "Nhìn", "Trời ơi".',
      '- Không lặp cấu trúc câu từ lịch sử.',
      '',
      'VIẾT NGAY:',
    ].join('\n')
  }

  // ── MID-RACE ──────────────────────────────────────────────────────────────
  const historyBlock = history && history.length > 0
    ? `\n🚫 ĐÃ BL RỒI — KHÔNG DÙNG LẠI IDEA/CẤU TRÚC NÀY:\n${history.map(h => `  - [${h.timestamp}s] ${h.text}`).join('\n')}`
    : '\n(Chưa có bình luận nào — tự do.)'

  let racePhase = ''
  if (timestampSeconds <= 5) {
    racePhase = 'XUẤT PHÁT: ai bứt lên đầu, ai chưa kịp chạy, ai loạng choạng ngay từ đầu?'
  } else if (timestampSeconds <= 15) {
    racePhase = 'GIỮA ĐƯỜNG: ai đang dẫn, ai đang bám đuổi sát, ai đang rớt hạng?'
  } else if (timestampSeconds <= 25) {
    racePhase = 'KHÚ CUA: có lật kèo không? Ai vừa vượt, ai vừa mất đà, ai đang hấp hối?'
  } else {
    racePhase = 'VỀ ĐÍCH: ai đang bứt pha quyết định, ai sắp bị tóm, khoảng cách ra sao?'
  }

  const { text: concept } = pickConcept()
  return [
    SYSTEM_PROMPT,
    '',
    `THỜI GIAN: Giây ${timestampSeconds}/36 — ${racePhase}`,
    `${spotlightLine}${namesLine}${metaContext ? `\n${metaContext}` : ''}`,
    historyBlock,
    `🎯 CONCEPT CHO LẦN NÀY: "${concept}"`,
    '',
    'HÌNH ẢNH: Phân tích ảnh chụp đường đua → xác định ai đang ở đâu, khoảng cách thế nào.',
    '',
    'NHIỆM VỤ: Viết 1 bình luận, ĐÚNG 2 CÂU (30–50 từ).',
    '- Câu 1: Nêu rõ diễn biến đường đua — tên cụ thể, vị trí cụ thể, hành động cụ thể.',
    `- Câu 2: Ẩn dụ hoặc phán xét bằng lăng kính "${concept}", gắt và hài.`,
    '- Cấm mở đầu bằng: Nhìn, Trong khi, Trời ơi, Ồ, Wow.',
    '- Cấm viết câu có thể copy-paste sang bất kỳ cuộc đua nào mà vẫn đúng.',
    '- Không lặp cấu trúc/punchline từ lịch sử bình luận.',
    '',
    'VIẾT NGAY:',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Heuristic: detect if output is too generic (could fit any race)
// ---------------------------------------------------------------------------

function isGenericOutput(text: string): boolean {
  const genericPatterns = [
    /cuộc đua (đang|vẫn|thật sự)/i,
    /đây là (một|cuộc)/i,
    /không ai (biết|ngờ)/i,
    /vậy là/i,
    /thật (không thể tin|sự)/i,
  ]
  return genericPatterns.some(p => p.test(text))
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function generateGeminiCommentary(
  screenshotBase64: string,
  timestampSeconds: number,
  isRaceEnd: boolean = false,
  participantNames?: string,
  history?: CommentaryHistory[],
  raceResults?: string,
  context?: RaceMetaContext
): Promise<string> {
  if (!OPENROUTER_API_KEY) {
    console.warn('OPENROUTER_API_KEY not set')
    return getFallbackCommentary(timestampSeconds, isRaceEnd)
  }

  const callAPI = async (prompt: string): Promise<string> => {
    const rawBase64 = screenshotBase64.replace(/^data:image\/\w+;base64,/, '')
    const imageUrl = `data:image/jpeg;base64,${rawBase64}`

    const response = await fetch(OPENROUTER_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://autoduck.shivaluma.com',
        'X-Title': 'AutoDuck',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 160,
        temperature: 1.05,       // Higher temp → less templated output
        top_p: 0.95,
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

    if (!response.ok) throw new Error(await response.text())

    const data = await response.json()
    return data.choices?.[0]?.message?.content || ''
  }

  try {
    const prompt = buildPrompt(timestampSeconds, isRaceEnd, participantNames, history, raceResults, context)
    let text = await callAPI(prompt)

    // Clean up formatting artifacts
    text = text
      .replace(/^["']|["']$/g, '')
      .replace(/^(Giây \d+|Phút \d+).*?:/i, '')
      .replace(/(\r\n|\n|\r)/gm, ' ')
      .replace(/---\s*.*/, '')
      .replace(/\*?Giải thích:.*$/i, '')
      .replace(/\*\*/g, '')
      .trim()

    // Retry once if output looks too generic
    if (isGenericOutput(text) || text.length < 20) {
      console.warn(`[Gemini][${timestampSeconds}s] Generic output detected, retrying...`)
      const retryPrompt = buildPrompt(timestampSeconds, isRaceEnd, participantNames, history, raceResults, context)
      const retryText = await callAPI(retryPrompt)
      text = retryText
        .replace(/^["']|["']$/g, '')
        .replace(/^(Giây \d+|Phút \d+).*?:/i, '')
        .replace(/(\r\n|\n|\r)/gm, ' ')
        .replace(/---\s*.*/, '')
        .replace(/\*?Giải thích:.*$/i, '')
        .replace(/\*\*/g, '')
        .trim() || text
    }

    console.log(`[Gemini][${timestampSeconds}s] ${text.substring(0, 70)}...`)
    return text || getFallbackCommentary(timestampSeconds, isRaceEnd)
  } catch (error) {
    console.error('Gemini API Error:', error)
    return getFallbackCommentary(timestampSeconds, isRaceEnd)
  }
}

// ---------------------------------------------------------------------------
// Fallback
// ---------------------------------------------------------------------------

function getFallbackCommentary(timestampSeconds: number, isRaceEnd: boolean): string {
  if (isRaceEnd) return 'Màn hình chốt điểm — kẻ dẫn đầu cán đích trước phần còn lại nửa thân, đúng kiểu carry bỏ team rồi nhận trophy một mình!'
  if (timestampSeconds <= 5) return 'Xuất phát xong mà đã dãn hàng — top 2 bứt ra xa, nhóm cuối đứng hình như server đang loading.'
  if (timestampSeconds <= 20) return 'Giữa đường cục diện rõ dần: 1-2 con đang hít khói nhóm đầu, khoảng cách đang nới ra từng giây.'
  return 'Thẳng đường về đích rồi — ai còn sức thì bứt, ai không thì cúi đầu chấp nhận sẹo trong im lặng.'
}
