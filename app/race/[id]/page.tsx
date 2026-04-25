'use client'

import { useEffect, useState, use } from 'react'
import Link from 'next/link'
import { ScrollArea } from '@/components/ui/scroll-area'
import { RaceLiveView } from './race-live-view'
import { RaceCelebration } from '@/components/race-celebration'
import type { RaceStatus } from '@/lib/types'
import Image from 'next/image'
import { ChestCard } from '@/components/chest-card'
import { ChestReveal } from '@/components/chest-reveal'
import { MYSTERY_CHESTS_ENABLED } from '@/lib/feature-flags'

const RARE_CHEST_EFFECTS = new Set([
  'LAST_LAUGH',
  'ANTI_SHIELD',
  'CANT_PASS_THOMAS',
  'GOLDEN_SHIELD',
  'MORE_PEOPLE_MORE_FUN',
])

const headlineTemplates = {
  bossDown: [
    'Triều đại Boss {name} đã sụp đổ sau {cloneCount} clone.',
    'Boss {name} gục ngã, lobby mở hội ăn mừng.',
    'Sau chuỗi thống trị, {name} cuối cùng cũng ngã.',
    '{cloneCount} clone là chưa đủ, {name} vẫn thua.',
    'Cuộc săn Boss thành công, {name} bị hạ.',
  ],
  rareChest: [
    'Rare Chest xuất hiện, tuần sau chuẩn bị hỗn loạn.',
    'Rare loot đã nổ, lobby bắt đầu lo lắng.',
    'Một chiếc Rare Chest vừa thay đổi meta.',
    'Race kết thúc nhưng hỗn loạn mới bắt đầu.',
    'Tuần sau sẽ không yên ổn nữa.',
  ],
  disaster: [
    'Có tới {loserCount} con dzịt cùng xuất hiện tuần này.',
    'Thảm họa tập thể, {loserCount} người cùng lãnh án.',
    'Lobby vừa chứng kiến vụ tai nạn hàng loạt.',
    '{loserCount} vịt rơi xuống đáy cùng lúc.',
    'Sáng thứ 2 đẫm máu.',
  ],
  shieldSave: [
    'Khiên của {name} vừa cứu một mạng.',
    '{name} thoát án nhờ khiên phút chót.',
    'Khiên bật đúng chỗ, {name} sống sót.',
    'Không có khiên thì {name} đã xong.',
    'Lobby cay đắng nhìn {name} sống tiếp.',
  ],
  thomas: [
    'Thomas tiếp tục khiến logic đầu hàng.',
    'Thomas lại sống sót như chưa từng có gì.',
    'Không ai hiểu vì sao Thomas vẫn top đầu.',
    'Thomas vận hành ngoài quy luật.',
    'Khoa học vẫn chưa giải thích được Thomas.',
  ],
  bossSurvived: [
    'Boss {name} vượt ải và tiếp tục thống trị.',
    '{name} tiếp tục thống trị lobby.',
    'Boss {name} sống sót sau áp lực {cloneCount} clone.',
    'Chuỗi thống trị của {name} chưa dừng lại.',
    'Lobby lại bất lực nhìn {name} sống tiếp.',
  ],
  normal: [
    '{losers} lãnh án trong một race không khoan nhượng.',
    'Race khép lại, {losers} rơi khỏi vùng an toàn.',
    '{winner} thắng cuộc, {losers} nhận phần drama.',
    'Một tuần nữa, bảng án lại gọi tên {losers}.',
    'Không có phép màu cho {losers}.',
  ],
}

function pickTemplate(templates: string[], seed: number) {
  return templates[Math.abs(seed) % templates.length]
}

function fillTemplate(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''))
}

export default function RaceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const resolvedParams = use(params)
  const raceId = resolvedParams.id
  const [race, setRace] = useState<RaceStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [polling, setPolling] = useState(true)

  useEffect(() => {
    const fetchRace = async () => {
      try {
        const res = await fetch(`/api/races/${raceId}`)
        const data = await res.json()
        setRace(data)
        setLoading(false)
        if (data.status === 'finished' || data.status === 'failed') setPolling(false)
      } catch { setLoading(false) }
    }
    fetchRace()
    const interval = setInterval(() => { if (polling) fetchRace() }, 3000)
    return () => clearInterval(interval)
  }, [raceId, polling])

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-transparent flex items-center justify-center">
        <div className="text-center">
          <div className="text-7xl animate-bob mb-4">🦆</div>
          <div className="font-display text-2xl text-[var(--color-ggd-lavender)] text-outlined">Đang tải...</div>
        </div>
      </div>
    )
  }

  if (!race) {
    return (
      <div className="min-h-screen bg-transparent flex items-center justify-center">
        <div className="text-center">
          <div className="font-display text-8xl text-[var(--color-ggd-orange)] text-outlined mb-4">404</div>
          <p className="font-data text-lg text-[var(--color-ggd-muted)] mb-6">Không tìm thấy trận đua 🦆</p>
          <Link href="/" className="font-display text-lg text-[var(--color-ggd-neon-green)] hover:text-white transition-colors">← Về Chuồng</Link>
        </div>
      </div>
    )
  }

  const isRunning = race.status === 'running'
  const isFinished = race.status === 'finished'
  const isFailed = race.status === 'failed'
  const sortedParticipants = [...race.participants].sort((a, b) => (a.initialRank ?? 99) - (b.initialRank ?? 99))
  const hasResults = sortedParticipants.length > 0 && sortedParticipants[0].initialRank !== null
  const consumedChestByOwnerId = new Map(MYSTERY_CHESTS_ENABLED ? (race.consumedChests ?? []).map((chest) => [chest.ownerId, chest]) : [])
  const awardedChestByOwnerId = new Map(MYSTERY_CHESTS_ENABLED ? (race.awardedChests ?? []).map((chest) => [chest.ownerId, chest]) : [])
  const resultGridClass = MYSTERY_CHESTS_ENABLED
    ? 'grid-cols-[56px_minmax(0,1.35fr)_132px_110px_minmax(0,1.15fr)]'
    : 'grid-cols-[56px_minmax(0,1.35fr)_132px_110px]'
  const bossFalls = Array.from(
    new Set(
      sortedParticipants
        .filter((participant) => participant.isClone && participant.gotScar && typeof participant.cloneOfUserId === 'number')
        .map((participant) => sortedParticipants.find((candidate) => candidate.userId === participant.cloneOfUserId && !candidate.isClone)?.name)
        .filter((name): name is string => Boolean(name))
    )
  )
  const victims = sortedParticipants.filter((participant) => participant.gotScar)
  const winner = sortedParticipants.find((participant) => participant.initialRank === 1)
  const thomasWinner = winner?.name.toLowerCase() === 'thomas'
  const bossOwnerIds = Array.from(new Set(sortedParticipants.filter((participant) => participant.isClone && typeof participant.cloneOfUserId === 'number').map((participant) => participant.cloneOfUserId as number)))
  const bossNames = bossOwnerIds
    .map((bossOwnerId) => sortedParticipants.find((participant) => participant.userId === bossOwnerId && !participant.isClone)?.name)
    .filter((name): name is string => Boolean(name))
  const activeModifiers = Array.from(new Set((race.consumedChests ?? []).map((chest) => chest.effect.replaceAll('_', ' '))))
  const cleanDuckName = (name: string) => name.replace(/^Zịt\s+/i, '')
  const formatNameList = (names: string[]) => {
    if (names.length === 0) return 'không ai'
    if (names.length === 1) return names[0]
    return `${names.slice(0, -1).join(', ')} và ${names.at(-1)}`
  }
  const shortCommentary = (content: string) => {
    const sentences = content
      .replace(/\s+/g, ' ')
      .split(/(?<=[.!?。！？])\s+/)
      .filter(Boolean)
    const shortText = sentences.slice(0, 2).join(' ') || content
    return shortText.length > 150 ? `${shortText.slice(0, 147)}...` : shortText
  }
  const winnerName = winner ? cleanDuckName(winner.displayName ?? winner.name) : 'Không rõ'
  const victimNames = victims.map((victim) => cleanDuckName(victim.displayName ?? victim.name))
  const renderedVictims = formatNameList(victimNames)
  const participantKey = (participant: typeof sortedParticipants[number]) => `${participant.userId}:${participant.cloneIndex ?? 'main'}`
  const effectiveShieldKeys = new Set<string>()
  const shieldScanVictimOwnerIds = new Set<number>()
  const shieldScanSafeOwnerIds = new Set<number>()
  const shieldScanPenaltySlots = Math.max(1, Math.min(victims.length || 2, sortedParticipants.length))
  const shieldScanEntries = [...sortedParticipants]
    .filter((participant) => typeof participant.initialRank === 'number')
    .sort((left, right) => (right.initialRank ?? 0) - (left.initialRank ?? 0))

  for (const participant of shieldScanEntries) {
    if (shieldScanVictimOwnerIds.size >= shieldScanPenaltySlots) break
    if (participant.isImmortal) continue

    const ownerId = participant.cloneOfUserId ?? participant.userId
    if (shieldScanVictimOwnerIds.has(ownerId)) continue

    if (participant.usedShield) {
      if (!shieldScanSafeOwnerIds.has(ownerId)) {
        effectiveShieldKeys.add(participantKey(participant))
        shieldScanSafeOwnerIds.add(ownerId)
      }
      continue
    }

    shieldScanVictimOwnerIds.add(ownerId)
  }

  const shieldSavedParticipants = sortedParticipants.filter((participant) => effectiveShieldKeys.has(participantKey(participant)) && !participant.gotScar)
  const decorativeShieldParticipants = sortedParticipants.filter((participant) => participant.usedShield && !effectiveShieldKeys.has(participantKey(participant)) && !participant.gotScar)
  const shieldSavedName = shieldSavedParticipants[0] ? cleanDuckName(shieldSavedParticipants[0].displayName ?? shieldSavedParticipants[0].name) : ''
  const decorativeShieldNames = decorativeShieldParticipants.map((participant) => cleanDuckName(participant.displayName ?? participant.name))
  const thomasEntry = sortedParticipants.find((participant) => participant.name.toLowerCase() === 'thomas' && !participant.isClone)
  const thomasTopThree = typeof thomasEntry?.initialRank === 'number' && thomasEntry.initialRank <= 3
  const cloneCountByBoss = new Map<number, number>()
  for (const participant of sortedParticipants) {
    if (participant.isClone && typeof participant.cloneOfUserId === 'number') {
      cloneCountByBoss.set(participant.cloneOfUserId, (cloneCountByBoss.get(participant.cloneOfUserId) ?? 0) + 1)
    }
  }
  const primaryBossOwnerId = bossOwnerIds[0]
  const primaryBossName = primaryBossOwnerId
    ? cleanDuckName(sortedParticipants.find((participant) => participant.userId === primaryBossOwnerId && !participant.isClone)?.name ?? bossNames[0] ?? 'Boss')
    : ''
  const primaryBossCloneCount = primaryBossOwnerId ? cloneCountByBoss.get(primaryBossOwnerId) ?? 0 : 0
  const bossSurvived = bossNames.length > 0 && bossFalls.length === 0
  const awardedChests = race.awardedChests ?? []
  const awardedRareChests = awardedChests.filter((chest) => RARE_CHEST_EFFECTS.has(chest.effect))
  const awardedCommonChests = awardedChests.filter((chest) => !RARE_CHEST_EFFECTS.has(chest.effect) && chest.effect !== 'NOTHING')
  const narrativeKind = (() => {
    if (bossFalls.length > 0) return 'bossDown'
    if (awardedRareChests.length > 0) return 'rareChest'
    if (victims.length >= 4) return 'disaster'
    if (shieldSavedParticipants.length > 0) return 'shieldSave'
    if (thomasTopThree) return 'thomas'
    if (bossSurvived) return 'bossSurvived'
    return 'normal'
  })()
  const headlineNameSource = (bossFalls[0] ?? primaryBossName) || shieldSavedName || winnerName
  const matchHeadline = fillTemplate(
    pickTemplate(headlineTemplates[narrativeKind], Number(raceId) + victims.length + awardedChests.length),
    {
      name: cleanDuckName(headlineNameSource),
      cloneCount: primaryBossCloneCount,
      loserCount: victims.length,
      losers: renderedVictims,
      winner: winnerName,
    }
  )
  const narrativeIcon = {
    bossDown: '👑',
    rareChest: '✨',
    disaster: '☠️',
    shieldSave: '🛡',
    thomas: '🦆',
    bossSurvived: '🔥',
    normal: '📰',
  }[narrativeKind]
  const reportBlocks = [
    {
      icon: '📋',
      title: 'Trước Race',
      lines: [
        primaryBossName ? `Boss ${primaryBossName} bước vào race với ${primaryBossCloneCount} clone.` : 'Không có Boss active trong race này.',
        shieldSavedParticipants.length > 0
          ? `${shieldSavedParticipants.length} khiên thật sự cứu mạng: ${formatNameList(shieldSavedParticipants.map((participant) => cleanDuckName(participant.displayName ?? participant.name)))}.`
          : decorativeShieldParticipants.length > 0
            ? `${formatNameList(decorativeShieldNames)} có bật khiên, nhưng lần này khiên chủ yếu đi du lịch.`
            : 'Không có cú cứu mạng bằng khiên nào được ghi nhận.',
        `Tổng cộng ${sortedParticipants.length} entries tham chiến${activeModifiers.length > 0 ? `, kèm ${activeModifiers.slice(0, 2).join(' + ')}.` : '.'}`,
      ],
    },
    {
      icon: '🎬',
      title: 'Diễn Biến',
      lines: [
        `${winnerName} cán đích đầu tiên và giữ vị trí thắng cuộc.`,
        thomasTopThree ? 'Thomas tiếp tục len vào top an toàn như thể luật vật lý chỉ là gợi ý.' : 'Nhóm giữa race giằng co cho tới đoạn cuối.',
        race.commentaries[0] ? shortCommentary(race.commentaries[0].content) : `${renderedVictims} tụt khỏi vùng an toàn ở đoạn quyết định.`,
      ],
    },
    {
      icon: '🏁',
      title: 'Kết Quả',
      lines: [
        `${renderedVictims} ${victims.length === 1 ? 'là con dzịt' : `là ${victims.length} con dzịt`} tuần này.`,
        bossFalls.length > 0
          ? `Boss ${bossFalls.map(cleanDuckName).join(', ')} mất ngôi sau nhiều tuần thống trị.`
          : bossSurvived
            ? `Boss ${primaryBossName} né án thành công và tiếp tục thống trị.`
            : 'Không có triều đại Boss nào sụp đổ trong trận này.',
        awardedRareChests.length > 0
          ? 'Rare Chest đã được mở, meta tuần sau bắt đầu có mùi bất ổn.'
          : awardedCommonChests.length > 0
            ? 'Common Chest rơi ra sau trận đấu.'
            : 'Không có chest nào xuất hiện.',
      ],
    },
  ]
  const narrativeTags = [
    bossFalls.length > 0 ? 'Boss Down' : null,
    bossSurvived ? 'Boss Survived' : null,
    awardedRareChests.length > 0 ? 'Rare Chest' : null,
    victims.length >= 4 ? 'Disaster Round' : null,
    shieldSavedParticipants.length > 0 ? 'Shield Saved' : null,
    thomasTopThree ? 'Thomas Incident' : null,
  ].filter((tag): tag is string => Boolean(tag))
  const heroHeadline = (() => {
    if (victims.length >= 4) return '☠️ THẢM HỌA TẬP THỂ'
    if (bossFalls.length > 0) return '👑 TRIỀU ĐẠI ĐÃ SỤP ĐỔ'
    if (thomasWinner) return '🦆 Thomas vừa làm điều không ai tin nổi'
    if (victims.length > 0) {
      const names = victims.map((victim) => cleanDuckName(victim.displayName ?? victim.name))
      const renderedNames = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} và ${names.at(-1)}`
      return `💀 ${renderedNames} đã ngã xuống.`
    }
    return '🏁 Race đã chốt sổ.'
  })()
  const heroSubline = (() => {
    if (bossFalls.length > 0) return `${bossFalls.map(cleanDuckName).join(', ')} mất ngôi Boss ngay trong race này.`
    if (victims.length >= 4) return `${victims.length} con dzịt cùng rơi khỏi vùng an toàn.`
    return race.finalVerdict ?? 'Kết quả chính thức đã được ghi nhận.'
  })()
  const getParticipantStatus = (participant: typeof sortedParticipants[number], index: number) => {
    if (participant.gotScar && participant.isClone && typeof participant.cloneOfUserId === 'number') return 'Boss Down'
    if (participant.gotScar) return 'Dzịt'
    if (index === 0) return 'Winner'
    return 'Safe'
  }
  return (
    <div className="min-h-screen bg-transparent bubble-bg">
      <div className={`h-2 ${isRunning ? 'bg-[var(--color-ggd-neon-green)] animate-pulse shadow-[0_0_15px_rgba(61,255,143,0.5)]' :
        isFinished ? 'neon-divider' : isFailed ? 'bg-[var(--color-ggd-orange)]' : 'bg-[var(--color-ggd-muted)]/20'}`} />

      <header className="border-b-4 border-[var(--color-ggd-outline)]">
        <div className="max-w-7xl mx-auto px-4 py-4 flex flex-col gap-3 sm:px-6 sm:flex-row sm:items-center sm:justify-between">
          <Link href="/" className="font-data text-sm text-[var(--color-ggd-muted)] hover:text-white transition-colors">← Về Chuồng</Link>
          <div className="flex flex-wrap items-center gap-3 sm:gap-4 animate-slide-right">
            <div className="font-display text-2xl text-white text-outlined">
              🦆 Trận <span className="text-[var(--color-ggd-neon-green)]">#{raceId}</span>
            </div>
            <div className={`ggd-tag ${isFinished ? 'bg-[var(--color-ggd-neon-green)] text-[var(--color-ggd-outline)]' :
              isRunning ? 'bg-[var(--color-ggd-gold)] text-[var(--color-ggd-outline)] animate-pulse' :
                isFailed ? 'bg-[var(--color-ggd-orange)] text-white' : 'bg-[var(--color-ggd-muted)]/30 text-[var(--color-ggd-muted)]'}`}>
              {race.status === 'pending' ? '⏳ Chờ...' : race.status === 'running' ? '🏃 ĐANG CHẠY!' :
                race.status === 'finished' ? '🏁 KẾT THÚC!' : '💥 LỖI'}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6 sm:px-6 sm:py-8">
        {isRunning && (
          <div className="space-y-6">
            <div className="ggd-card-green p-5 ggd-stripe sm:p-8">
              <div className="flex items-center justify-center gap-3 sm:gap-6">
                <div className="hidden text-5xl animate-bob sm:block">🦆</div>
                <div className="text-center">
                  <div className="font-display text-3xl text-[var(--color-ggd-neon-green)] text-outlined sm:text-4xl">ĐANG ĐUA! 🏃💨</div>
                  <div className="font-data text-sm text-[var(--color-ggd-muted)] mt-1">Phát trực tiếp...</div>
                </div>
                <div className="hidden text-5xl animate-bob sm:block" style={{ animationDelay: '0.3s' }}>🦆</div>
              </div>
            </div>
            <div className="animate-slide-up"><RaceLiveView raceId={parseInt(raceId)} /></div>
          </div>
        )}

        {isFinished && (
          <>
            <RaceCelebration
              allPlayers={sortedParticipants.map(p => ({ name: p.displayName ?? p.name, avatarUrl: p.avatarUrl, gotScar: p.gotScar, usedShield: p.usedShield, initialRank: p.initialRank }))}
              victims={victims.map(p => ({ name: p.displayName ?? p.name, avatarUrl: p.avatarUrl }))}
              verdict={race.finalVerdict} duration={3000}
              bossFalls={bossFalls}
              consumedChests={MYSTERY_CHESTS_ENABLED ? race.consumedChests : []}
              awardedChests={MYSTERY_CHESTS_ENABLED ? race.awardedChests : []}
              raceId={Number(raceId)}
            />
            {race.finalVerdict && (
              <div className={`ggd-card-gold ggd-stripe animate-slide-up opacity-0 overflow-hidden ${bossFalls.length > 0 ? 'shadow-[0_0_35px_rgba(255,204,0,0.35),0_8px_0_var(--color-ggd-outline)]' : victims.length >= 4 ? 'shadow-[0_0_42px_rgba(255,87,51,0.45),0_8px_0_var(--color-ggd-outline)]' : ''}`} style={{ animationDelay: '0.1s' }}>
                <div className="relative px-4 py-7 text-center sm:px-8 sm:py-9">
                  <div className="flex justify-center gap-3 mb-6">
                    {(victims.length >= 4 ? ['🚨', '💀', '☠️', '💀', '🚨'] : bossFalls.length > 0 ? ['👑', '💔', '⚡', '💔', '👑'] : ['🎉', '🦆', '🏆', '🦆', '🎉']).map((emoji, i) => (
                      <div key={i} className="text-3xl animate-bob" style={{ animationDelay: `${i * 0.15}s` }}>{emoji}</div>
                    ))}
                  </div>
                  <div className="font-display text-lg text-[var(--color-ggd-gold)] glow-gold mb-3">✨ Kết Quả Chính Thức ✨</div>
                  <h2 className="font-display text-4xl text-white leading-tight text-outlined md:text-6xl">{heroHeadline}</h2>
                  <p className="mx-auto mt-4 max-w-3xl font-readable text-lg text-white/88 leading-relaxed md:text-xl">{heroSubline}</p>
                  <div className="mt-6 flex flex-wrap justify-center gap-2">
                    <span className="ggd-tag bg-[var(--color-ggd-neon-green)] text-[var(--color-ggd-outline)]">{sortedParticipants.length} vịt</span>
                    <span className="ggd-tag bg-[var(--color-ggd-orange)] text-white">{victims.length} losers</span>
                    <span className="ggd-tag bg-[var(--color-ggd-panel)] text-white">Boss: {bossNames.length > 0 ? bossNames.map(cleanDuckName).join(', ') : 'Không'}</span>
                    {activeModifiers.slice(0, 2).map((modifier) => (
                      <span key={modifier} className="ggd-tag bg-[var(--color-ggd-hot-pink)] text-white">{modifier}</span>
                    ))}
                    {race.awardedChests?.some((chest) => chest.effect === 'GOLDEN_SHIELD') && (
                      <span className="ggd-tag bg-[var(--color-ggd-sky)] text-[var(--color-ggd-outline)]">🛡 Legendary defense</span>
                    )}
                    {race.awardedChests?.some((chest) => chest.effect !== 'NOTHING') && (
                      <span className="ggd-tag bg-[var(--color-ggd-gold)] text-[var(--color-ggd-outline)]">✨ Chest dropped</span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {hasResults && (
              <>
                <section className="ggd-card animate-slide-up opacity-0 overflow-hidden" style={{ animationDelay: '0.18s' }}>
                  <div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                    <div className="flex min-w-0 items-start gap-4">
                      <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-xl border-3 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-gold)] text-3xl shadow-[0_4px_0_var(--color-ggd-outline)]">
                        {narrativeIcon}
                      </div>
                      <div className="min-w-0">
                        <div className="font-data text-xs font-black uppercase tracking-widest text-[var(--color-ggd-gold)]">📰 Match Headline · Trận #{raceId}</div>
                        <h3 className="mt-1 font-display text-2xl leading-tight text-white text-outlined sm:text-3xl">{matchHeadline}</h3>
                      </div>
                    </div>
                    {narrativeTags.length > 0 && (
                      <div className="flex flex-wrap gap-2 sm:justify-end">
                        {narrativeTags.map((tag) => (
                          <span key={tag} className="ggd-tag bg-[var(--color-ggd-panel)] text-white/82">{tag}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </section>

                <section className="grid grid-cols-1 gap-4 animate-slide-up opacity-0 md:grid-cols-3" style={{ animationDelay: '0.24s' }}>
                  {reportBlocks.map((block) => (
                    <article key={block.title} className="rounded-xl border-4 border-[var(--color-ggd-outline)] bg-[rgba(16,18,35,0.82)] p-5 shadow-[0_5px_0_var(--color-ggd-outline),0_14px_26px_rgba(0,0,0,0.42)]">
                      <div className="flex items-center gap-3 border-b-2 border-[var(--color-ggd-outline)]/25 pb-3">
                        <span className="text-2xl">{block.icon}</span>
                        <h3 className="font-display text-lg text-white text-outlined">{block.title}</h3>
                      </div>
                      <div className="mt-4 space-y-3">
                        {block.lines.map((line) => (
                          <p key={line} className="font-readable text-sm leading-relaxed text-white/78">{line}</p>
                        ))}
                      </div>
                    </article>
                  ))}
                </section>
              </>
            )}
          </>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className={`${isRunning ? 'lg:col-span-3' : 'lg:col-span-2'} animate-slide-up opacity-0`} style={{ animationDelay: '0.2s' }}>
            <div className="ggd-card-green ggd-stripe overflow-x-auto">
              <div className="bg-[var(--color-ggd-neon-green)] px-5 py-3 rounded-t-[6px] flex items-center justify-between">
                <span className="font-display text-lg text-[var(--color-ggd-outline)]">🏆 Bảng Xếp Hạng</span>
                <span className="font-data text-sm text-[var(--color-ggd-outline)]/70">{sortedParticipants.length} vịt</span>
              </div>

              <div className={`grid ${resultGridClass} min-w-[920px] gap-2 px-5 py-3 border-b-[3px] border-[var(--color-ggd-outline)]/40 bg-[var(--color-ggd-panel)]`}>
                <div className="ggd-col-header">Rank</div>
                <div className="ggd-col-header">VỊT 🦆</div>
                <div className="ggd-col-header">Status</div>
                <div className="ggd-col-header text-center">KHIÊN</div>
                {MYSTERY_CHESTS_ENABLED && <div className="ggd-col-header">Loot / Chest</div>}
              </div>

              {hasResults ? (
                <div className="py-1">
                  {sortedParticipants.map((p, idx) => {
                    const consumedChest = !p.isClone ? consumedChestByOwnerId.get(p.userId) : undefined
                    const awardedChest = p.gotScar && !p.isClone ? awardedChestByOwnerId.get(p.userId) : undefined

                    const status = getParticipantStatus(p, idx)
                    const rowBadges = [
                      p.isClone ? 'Clone' : null,
                      p.isImmortal ? 'Immortal' : null,
                      p.chestEffect ? p.chestEffect.replaceAll('_', ' ') : null,
                    ].filter((badge): badge is string => Boolean(badge)).slice(0, 2)
                    return (
                    <div
                      key={`${p.userId}-${p.cloneIndex ?? 0}-${p.initialRank ?? idx}`}
                      className={`grid ${resultGridClass} min-w-[920px] gap-2 items-center px-5 py-3.5 duck-row
                        ${p.gotScar ? 'loser' : p.usedShield ? 'shielded' : idx < 3 ? 'winner' : ''}
                        animate-slide-right opacity-0`}
                      style={{ animationDelay: `${0.3 + idx * 0.08}s` }}
                    >
                      <div className="flex items-center justify-center relative">
                        <span className={`position-number text-3xl ${p.gotScar ? 'text-[var(--color-ggd-orange)] glow-orange' :
                          idx === 0 ? 'text-[var(--color-ggd-gold)] glow-gold' : idx === 1 ? 'text-white/80' :
                            idx === 2 ? 'text-[var(--color-ggd-neon-green)] glow-green' : 'text-[var(--color-ggd-muted)]/40'}`}>
                          {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : String((p.initialRank ?? idx + 1)).padStart(2, '0')}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-2 h-12 rounded-full flex-shrink-0 ${p.gotScar ? 'bg-[var(--color-ggd-orange)] shadow-[0_0_8px_rgba(255,87,51,0.6)]' : p.usedShield ? 'bg-[var(--color-ggd-sky)] shadow-[0_0_8px_rgba(61,200,255,0.5)]' :
                          idx === 0 ? 'bg-[var(--color-ggd-gold)] shadow-[0_0_8px_rgba(255,204,0,0.5)]' : 'bg-[var(--color-ggd-muted)]/20'}`} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="font-body text-base font-extrabold text-white truncate">
                              {p.displayName ?? p.name}
                            </div>
                            {rowBadges.map((badge) => (
                              <span key={badge} className="ggd-tag bg-[var(--color-ggd-panel)] text-white/75 text-[10px] px-2 py-0">{badge}</span>
                            ))}
                          </div>
                          {idx === 0 && isFinished && <div className="font-display text-xs text-[var(--color-ggd-gold)] glow-gold mt-0.5">👑 VỊT THẮNG CUỘC</div>}
                        </div>
                      </div>
                      <div>
                        {status === 'Dzịt' ? (
                          <span className="font-display text-xl text-[var(--color-ggd-orange)] glow-orange">💀 Dzịt</span>
                        ) : status === 'Boss Down' ? (
                          <span className="font-display text-base text-[var(--color-ggd-gold)] glow-gold">👑 Boss Down</span>
                        ) : status === 'Winner' ? (
                          <span className="font-display text-xl text-[var(--color-ggd-gold)] glow-gold">Winner</span>
                        ) : effectiveShieldKeys.has(participantKey(p)) ? (
                          <span className="font-display text-base text-[var(--color-ggd-sky)] glow-sky">🛡 Thoát</span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 font-data text-[11px] uppercase tracking-wider text-white/68 font-black">
                            <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-ggd-neon-green)]/75" /> Safe
                          </span>
                        )}
                      </div>
                      <div className="flex justify-center">
                        {p.usedShield ? (
                          <span className="shield-chip shield-tier-fresh">
                            <Image src="/assets/v2/shield-cracked.svg" alt="shield" width={18} height={18} className="shield-chip-icon" unoptimized />
                            <span>Tao có khiên</span>
                          </span>
                        ) : (<span className="empty-cell">—</span>)}
                      </div>
                      {MYSTERY_CHESTS_ENABLED && (
                        <div className="min-w-0">
                          {consumedChest || awardedChest ? (
                            <div className="flex flex-col gap-2 min-w-0">
                              {consumedChest && (
                                <>
                              <ChestCard effect={consumedChest.effect} size="sm" opened animated={false} />
                              <div className="font-data text-[10px] text-[var(--color-ggd-muted)] truncate flex items-center gap-1">
                                <span className={consumedChest.outcome === 'success' ? 'text-[var(--color-ggd-neon-green)]' : 'text-[var(--color-ggd-orange)]'}>
                                  {consumedChest.outcome === 'success' ? '✓ HIT' : '✗ FIZZLED'}
                                </span>
                                {consumedChest.targetName && <span className="opacity-70">→ {consumedChest.targetName}</span>}
                              </div>
                                </>
                              )}
                              {awardedChest && (
                                <ChestReveal
                                  chestId={awardedChest.id}
                                  effect={awardedChest.effect}
                                  compact
                                  animated
                                />
                              )}
                            </div>
                          ) : (<span className="empty-cell">—</span>)}
                        </div>
                      )}
                    </div>
                  )})}
                </div>
              ) : (
                <div className="py-16 text-center">
                  <div className="text-5xl mb-3 animate-bob">🥚</div>
                  <div className="font-data text-base text-[var(--color-ggd-muted)]">{isRunning ? 'Đang đua... 🏃' : 'Chưa có kết quả'}</div>
                </div>
              )}
            </div>

            {race.videoUrl && (
              <div className="mt-6 ggd-card animate-slide-up opacity-0" style={{ animationDelay: '0.6s' }}>
                <div className="px-5 py-3 bg-[var(--color-ggd-panel)] rounded-t-[6px]">
                  <span className="font-display text-lg text-white text-outlined">🎬 Xem Lại</span>
                </div>
                <div className="aspect-video bg-black rounded-b-[18px]">
                  <video src={race.videoUrl} controls className="w-full h-full rounded-b-[18px]" />
                </div>
              </div>
            )}
          </div>

          {!isRunning && (
            <div className="animate-slide-up opacity-0 lg:sticky lg:top-4 lg:self-start" style={{ animationDelay: '0.35s' }}>
              <div className="ggd-card ggd-stripe overflow-hidden">
                <div className="px-5 py-3 bg-[var(--color-ggd-panel)] rounded-t-[6px] flex items-center justify-between">
                  <span className="font-display text-lg text-white text-outlined">🎤 MC Vịt</span>
                  <span className="ggd-tag bg-[var(--color-ggd-neon-green)] text-[var(--color-ggd-outline)] text-xs">TIMELINE</span>
                </div>
                <ScrollArea className="h-[360px] sm:h-[520px]">
                  {race.commentaries.length > 0 ? (
                    <div className="relative py-3 pl-5 pr-3">
                      <div className="absolute left-[31px] top-5 bottom-5 w-0.5 bg-gradient-to-b from-[var(--color-ggd-neon-green)] via-[var(--color-ggd-gold)] to-[var(--color-ggd-orange)]/70" />
                      {race.commentaries.map((c, idx) => (
                        <div key={idx} className="relative ml-7 mb-3 rounded-xl border-2 border-[var(--color-ggd-outline)]/35 bg-black/30 px-4 py-3 shadow-[0_4px_0_rgba(0,0,0,0.55)] transition-colors hover:bg-[var(--color-ggd-neon-green)]/8 animate-slide-right opacity-0"
                          style={{ animationDelay: `${0.4 + idx * 0.05}s` }}>
                          <div className="absolute -left-[38px] top-4 h-4 w-4 rounded-full border-2 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-gold)] shadow-[0_0_12px_rgba(255,204,0,0.55)]" />
                          <div className="flex items-center gap-2 mb-2">
                            <span className="font-data text-xs font-black text-[var(--color-ggd-neon-green)]">{formatTime(c.timestamp)}</span>
                            <div className="h-px flex-1 bg-white/12" />
                          </div>
                          <p className="font-readable text-base text-white/92 leading-snug">{shortCommentary(c.content)}</p>
                        </div>
                      ))}
                      {victims.map((victim, index) => (
                        <div key={`victim-${victim.userId}-${victim.cloneIndex ?? index}`} className="relative ml-7 mb-3 rounded-xl border-2 border-[var(--color-ggd-orange)]/70 bg-[rgba(255,87,51,0.18)] px-4 py-3 shadow-[0_4px_0_rgba(0,0,0,0.65)] animate-slide-right opacity-0"
                          style={{ animationDelay: `${0.45 + (race.commentaries.length + index) * 0.05}s` }}>
                          <div className="absolute -left-[38px] top-4 h-4 w-4 rounded-full border-2 border-[var(--color-ggd-outline)] bg-[var(--color-ggd-orange)] shadow-[0_0_14px_rgba(255,87,51,0.65)]" />
                          <div className="font-data text-xs font-black text-[var(--color-ggd-orange)]">FINAL</div>
                          <p className="mt-1 font-display text-lg text-white text-outlined">☠️ {cleanDuckName(victim.displayName ?? victim.name)} bị loại.</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="px-5 py-16 text-center">
                      <div className="text-4xl mb-3 animate-bob">🎤</div>
                      <p className="font-data text-base text-[var(--color-ggd-muted)]">{isRunning ? 'MC Vịt đang chuẩn bị...' : 'Chưa có bình luận'}</p>
                    </div>
                  )}
                </ScrollArea>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 pt-4 border-t-4 border-[var(--color-ggd-outline)] animate-fade-in opacity-0 sm:flex-row sm:items-center sm:justify-between" style={{ animationDelay: '0.7s' }}>
          <Link href="/" className="font-display text-lg text-[var(--color-ggd-muted)] hover:text-white transition-colors px-4 py-3 text-center sm:text-left">← Về Chuồng</Link>
          {isFinished && (
            <Link href="/race/new" className="w-full sm:w-auto">
              <button className="ggd-btn w-full bg-[var(--color-ggd-orange)] text-white text-lg px-10 py-3 sm:w-auto">Trận Tiếp → 🦆</button>
            </Link>
          )}
        </div>
      </main>
    </div>
  )
}
