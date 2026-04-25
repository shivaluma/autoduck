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

function sanitizeBriefText(text: string) {
  return text
    .replace(/\bcú\s+khao\b/gi, 'lần thua')
    .replace(/\bkhaos?\b/gi, 'lần thua')
    .replace(/\btotalKhaos\b/gi, 'totalLosses')
    .trim()
}

function buildFacts(players: PlayerData[], races: DashboardRaceLists, summary: DashboardSummary) {
  const activeEffects = players
    .map((player) => player.activeChest?.effect)
    .filter((effect): effect is NonNullable<PlayerData['activeChest']>['effect'] => Boolean(effect))
  const currentBoss = players
    .filter((player) => player.isBoss)
    .sort((left, right) => right.cleanStreak - left.cleanStreak)[0] ?? null
  const shieldRisk = players
    .flatMap((player) => player.activeShields.map((shield) => ({ player, shield })))
    .filter((entry) => entry.shield.charges <= 2)
    .sort((left, right) => left.shield.charges - right.shield.charges)[0] ?? null
  const pendingOwners = players
    .filter((player) => player.activeChest)
    .map((player) => `${cleanDuckName(player.name)}:${effectLabel(player.activeChest!.effect)}`)
  const latestRace = races.recentOfficial[0] ?? null

  return {
    week: Math.max(races.totalOfficial, 1),
    latestOfficialRaceId: latestRace?.id ?? 0,
    currentBoss: currentBoss
      ? { name: cleanDuckName(currentBoss.name), level: currentBoss.cleanStreak }
      : null,
    pendingEffects: activeEffects.map(effectLabel),
    pendingOwners,
    losers: activeEffects.includes('MORE_PEOPLE_MORE_FUN') ? '3 hoặc 4' : '2',
    antiShield: activeEffects.includes('ANTI_SHIELD'),
    thomasMode: activeEffects.includes('CANT_PASS_THOMAS'),
    lastLaugh: activeEffects.includes('LAST_LAUGH'),
    shieldRisk: shieldRisk
      ? { name: cleanDuckName(shieldRisk.player.name), charges: shieldRisk.shield.charges }
      : null,
    longestStreak: {
      name: cleanDuckName(summary.longestStreak.ownerName),
      value: summary.longestStreak.value,
    },
    mostUnlucky: summary.mostUnluckyDuck
      ? { name: cleanDuckName(summary.mostUnluckyDuck.name), totalLosses: summary.mostUnluckyDuck.totalKhaos }
      : null,
    latestVerdict: latestRace?.finalVerdict ?? null,
  }
}

function buildCacheKey(facts: ReturnType<typeof buildFacts>) {
  return `dashboard-brief:v2:after-race-${facts.latestOfficialRaceId}:total-${facts.week}`
}

function fallbackBrief(facts: ReturnType<typeof buildFacts>): DashboardBrief {
  if (facts.currentBoss) {
    return {
      headline: `WEEK ${facts.week}: SĂN BOSS ${facts.currentBoss.name}`,
      subline: `Boss Lv${facts.currentBoss.level}${facts.lastLaugh ? ', Last Laugh đang chờ kéo chân' : ''}.`,
      source: 'fallback',
    }
  }

  if (facts.antiShield) {
    return {
      headline: `WEEK ${facts.week}: KHIÊN HẾT QUYỀN LỰC`,
      subline: `Anti Shield bật, ${facts.losers} dzịt sẽ tự lo bằng chân trần.`,
      source: 'fallback',
    }
  }

  if (facts.shieldRisk) {
    return {
      headline: `WEEK ${facts.week}: KHIÊN ${facts.shieldRisk.name} SẮP NỔ`,
      subline: `Còn ${facts.shieldRisk.charges} charge, một tuần nữa là nghe tiếng nứt.`,
      source: 'fallback',
    }
  }

  if (facts.pendingEffects.length > 0) {
    return {
      headline: `WEEK ${facts.week}: ITEM ĐANG CHỜ NỔ`,
      subline: `${facts.pendingEffects.slice(0, 2).join(' + ')} đã armed cho race kế tiếp.`,
      source: 'fallback',
    }
  }

  return {
    headline: `WEEK ${facts.week}: BẦY VỊT TẠM YÊN`,
    subline: 'Không modifier lớn, nhưng lịch sử chứng minh bình yên chỉ là loading screen.',
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
              'Mày viết dashboard brief cho game đua vịt AutoDuck.',
              'Chỉ được dùng facts được đưa, không bịa luật, không bịa tên.',
              'Giọng meme Việt, sắc, ngắn, hơi cà khịa.',
              'Không bao giờ dùng từ Khao, khaos, totalKhaos. Nếu nói về field totalLosses thì gọi là lần thua hoặc sẹo.',
              'Trả về JSON hợp lệ: {"headline":"...","subline":"..."}',
              'headline tối đa 11 từ, uppercase được. subline tối đa 22 từ.',
            ].join(' '),
          },
          {
            role: 'user',
            content: `Facts tuần này:\n${JSON.stringify(facts, null, 2)}`,
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
