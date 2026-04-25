import type { DashboardRaceLists, DashboardSummary } from './dashboard-data'
import type { PlayerData } from './types'

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ''
const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'
const MODEL = 'google/gemini-3-flash-preview'
const CACHE_TTL_MS = 8 * 24 * 60 * 60 * 1000

export interface DashboardBrief {
  headline: string
  subline: string
  source: 'ai' | 'fallback'
}

type BriefCacheEntry = {
  expiresAt: number
  brief: DashboardBrief
}

const briefCache = new Map<string, BriefCacheEntry>()

function cleanDuckName(name?: string | null) {
  return name ? name.replace(/^Zịt\s+/i, '') : ''
}

function effectLabel(effect: string) {
  return effect.replaceAll('_', ' ')
}

function formatNameList(names: string[]) {
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(', ')} và ${names.at(-1)}`
}

function sanitizeBriefText(text: string) {
  return text
    .replace(/\bcú\s+khao\b/gi, 'lần thua')
    .replace(/\bkhaos?\b/gi, 'lần thua')
    .replace(/\btotalKhaos\b/gi, 'totalLosses')
    .trim()
}

function buildFacts(players: PlayerData[], races: DashboardRaceLists, _summary: DashboardSummary) {
  const activeEffects = players
    .map((player) => player.activeChest?.effect)
    .filter((effect): effect is NonNullable<PlayerData['activeChest']>['effect'] => Boolean(effect))
  const currentBosses = players
    .filter((player) => player.isBoss)
    .sort((left, right) => right.cleanStreak - left.cleanStreak)
  const shieldRisk = players
    .flatMap((player) => player.activeShields.map((shield) => ({ player, shield })))
    .filter((entry) => entry.shield.charges <= 2)
    .sort((left, right) => left.shield.charges - right.shield.charges)[0] ?? null
  const pendingOwners = players
    .filter((player) => player.activeChest)
    .map((player) => `${cleanDuckName(player.name)}:${effectLabel(player.activeChest!.effect)}`)
  const activeShieldOwners = players
    .filter((player) => player.activeShields.length > 0)
    .map((player) => cleanDuckName(player.name))
  const latestRace = races.recentOfficial[0] ?? null

  return {
    nextRaceNumber: Math.max(races.totalOfficial + 1, 1),
    latestOfficialRaceId: latestRace?.id ?? 0,
    briefGoal: 'preview_next_race',
    currentBosses: currentBosses.map((boss) => ({
      name: cleanDuckName(boss.name),
      level: boss.cleanStreak,
    })),
    topBoss: currentBosses[0]
      ? { name: cleanDuckName(currentBosses[0].name), level: currentBosses[0].cleanStreak }
      : null,
    pendingEffects: activeEffects.map(effectLabel),
    pendingOwners,
    activeShieldOwners,
    expectedLosers: activeEffects.includes('MORE_PEOPLE_MORE_FUN') ? '3 hoặc 4' : '2',
    antiShield: activeEffects.includes('ANTI_SHIELD'),
    lastLaugh: activeEffects.includes('LAST_LAUGH'),
    shieldRisk: shieldRisk
      ? { name: cleanDuckName(shieldRisk.player.name), charges: shieldRisk.shield.charges }
      : null,
  }
}

function buildCacheKey(facts: ReturnType<typeof buildFacts>) {
  return `dashboard-brief:v3:after-race-${facts.latestOfficialRaceId}:next-${facts.nextRaceNumber}`
}

function fallbackBrief(facts: ReturnType<typeof buildFacts>): DashboardBrief {
  const bossCount = facts.currentBosses.length
  const bossNames = formatNameList(facts.currentBosses.slice(0, 3).map((boss) => boss.name))
  const topBoss = facts.topBoss

  if (facts.antiShield) {
    return {
      headline: `RACE #${facts.nextRaceNumber}: KHIÊN BỊ TƯỚC QUYỀN`,
      subline: `Không ai được cứu. ${facts.expectedLosers} ghế nóng đã bật đèn.`,
      source: 'fallback',
    }
  }

  if (bossCount >= 2) {
    return {
      headline: `RACE #${facts.nextRaceNumber}: ${bossCount} BOSS CÙNG LÊN THỚT`,
      subline: `${bossNames} cùng giữ ngai, chỉ cần một cú trượt là nổ chuồng.`,
      source: 'fallback',
    }
  }

  if (topBoss) {
    return {
      headline: `RACE #${facts.nextRaceNumber}: SĂN BOSS ${topBoss.name}`,
      subline: `Lv${topBoss.level} đã lên bảng giá. Lobby đang mài dao tinh thần.`,
      source: 'fallback',
    }
  }

  if (facts.pendingEffects.length > 0) {
    return {
      headline: `RACE #${facts.nextRaceNumber}: ITEM ĐANG GÀI CHỐT`,
      subline: `${facts.pendingEffects.slice(0, 2).join(' + ')} chờ kích hoạt. Tuần này khó chạy đường thẳng.`,
      source: 'fallback',
    }
  }

  if (facts.shieldRisk) {
    return {
      headline: `RACE #${facts.nextRaceNumber}: KHIÊN ${facts.shieldRisk.name} NỨT RỒI`,
      subline: `Còn ${facts.shieldRisk.charges} charge. Một cú hụt chân là nghe tiếng vỡ.`,
      source: 'fallback',
    }
  }

  return {
    headline: `RACE #${facts.nextRaceNumber}: CHUỒNG ĐANG QUÁ YÊN`,
    subline: 'Kinh nghiệm cho thấy yên tĩnh ở đây thường rất đắt.',
    source: 'fallback',
  }
}

async function generateAiBrief(facts: ReturnType<typeof buildFacts>): Promise<DashboardBrief | null> {
  if (!OPENROUTER_API_KEY) {
    return null
  }

  try {
    const response = await fetch(OPENROUTER_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://autoduck.shivaluma.com',
        'X-Title': 'AutoDuck Dashboard Brief',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: 'system',
            content: [
              'Mày là biên tập viên chuyên viết banner trang chủ cho game đua vịt AutoDuck.',
              'Nhiệm vụ: Viết preview cho race kế tiếp, KHÔNG recap race cũ.',
              'Mục tiêu: Headline phải khiến người ta muốn bấm xem race ngay. Subline phải gợi drama sắp xảy ra.',
              'Chỉ được dùng facts được đưa, không bịa luật, không bịa tên.',
              'Chỉ nói: áp lực, nguy cơ, boss đang bị săn, item sắp nổ, khiên sắp vỡ, số người dự kiến lãnh án, lobby sắp loạn.',
              'Không khẳng định chắc ai sẽ thua; chỉ nói nguy cơ, áp lực, hoặc drama đang chờ.',
              'Tone: Thể thao + báo lá cải + meme văn phòng Việt. Sắc, ngắn, tự tin, cà khịa vừa đủ.',
              'Headline style: như báo thể thao, có tension, có chữ đắt, tránh generic.',
              'Subline style: một câu phụ sắc bén, tăng tò mò, có punchline cuối càng tốt.',
              'Cấm: chúc mừng, kể chuyện trận trước, đạo đức giả, dùng từ khao/khaos/totalKhaos, lặp lại headline bằng wording khác, câu vô thưởng vô phạt.',
              'Ưu tiên event: 1 Anti Shield, 2 Boss cấp cao, 3 Pending rare item, 4 Shield sắp vỡ, 5 Số dzịt tăng, 6 Bình yên giả tạo.',
              'Cấm dùng cụm generic: gay cấn, hấp dẫn, kịch tính, rất nóng, đầy bất ngờ.',
              'Humor đến từ irony, humiliation, overconfidence, survival vô lý. Không đến từ spam meme vô nghĩa.',
              'Trả về JSON hợp lệ: {"headline":"...","subline":"..."}',
              'Rules: headline tối đa 11 từ, subline tối đa 22 từ, headline nên viết HOA một phần nếu hợp, mỗi output phải khác nhau về wording.',
            ].join(' '),
          },
          {
            role: 'user',
            content: [
              'Facts cho preview race kế tiếp:',
              JSON.stringify(facts, null, 2),
              'Viết headline và subline theo prompt.',
              'Nếu nhiều event cùng lúc, chọn event căng nhất.',
              'Nếu không có gì lớn, biến sự yên tĩnh thành cảm giác trước bão.',
            ].join('\n\n'),
          },
        ],
        temperature: 0.85,
        max_tokens: 160,
      }),
      signal: AbortSignal.timeout(2500),
    })

    if (!response.ok) {
      return null
    }

    const data = await response.json()
    const raw = data?.choices?.[0]?.message?.content
    if (typeof raw !== 'string') {
      return null
    }

    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    const parsed = JSON.parse(jsonMatch?.[0] ?? raw) as Partial<DashboardBrief>
    if (typeof parsed.headline !== 'string' || typeof parsed.subline !== 'string') {
      return null
    }

    return {
      headline: sanitizeBriefText(parsed.headline).slice(0, 90),
      subline: sanitizeBriefText(parsed.subline).slice(0, 160),
      source: 'ai',
    }
  } catch (error) {
    console.warn('Dashboard AI brief fallback:', error)
    return null
  }
}

export async function getDashboardBrief(
  players: PlayerData[],
  races: DashboardRaceLists,
  summary: DashboardSummary
): Promise<DashboardBrief> {
  const facts = buildFacts(players, races, summary)
  const cacheKey = buildCacheKey(facts)
  const cached = briefCache.get(cacheKey)

  if (cached && cached.expiresAt > Date.now()) {
    return cached.brief
  }

  const generatedBrief = (await generateAiBrief(facts)) ?? fallbackBrief(facts)
  const brief = {
    ...generatedBrief,
    headline: sanitizeBriefText(generatedBrief.headline),
    subline: sanitizeBriefText(generatedBrief.subline),
  }
  briefCache.set(cacheKey, {
    brief,
    expiresAt: Date.now() + CACHE_TTL_MS,
  })

  return brief
}
