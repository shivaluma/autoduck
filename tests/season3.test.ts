import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyScarEconomy,
  generateDuckNews,
  resolvePredictions,
  resolveSeason3Race,
  selectChaosCard,
  selectChampion,
} from '../lib/season3'
import { mapSeason3RaceRanking, type Season3RaceMappingPlayer } from '../lib/season3-race-mapping'

const ranking = [
  { userId: 1, name: 'Thanh', rank: 1, hasShield: false },
  { userId: 2, name: 'Huy', rank: 2, hasShield: false },
  { userId: 3, name: 'Khoa', rank: 3, hasShield: false },
  { userId: 4, name: 'Long', rank: 4, hasShield: true },
  { userId: 5, name: 'Nam', rank: 5, hasShield: false },
]

const seasonPlayers: Season3RaceMappingPlayer[] = ranking.map((entry) => ({
  userId: entry.userId,
  scars: 0,
  shields: entry.hasShield ? 1 : 0,
  shieldConfirmed: entry.hasShield,
  isKing: entry.userId === 1,
  kingStreak: 2,
  user: { name: entry.name },
}))

test('Season 3 bridge maps the real race result and carries shield state', () => {
  const mapped = mapSeason3RaceRanking([
    { rank: 2, name: 'Huy' },
    { rank: 1, name: 'Thanh' },
    { rank: 3, name: 'Khoa' },
    { rank: 5, name: 'Nam' },
    { rank: 4, name: 'Long' },
  ], seasonPlayers)

  assert.deepEqual(mapped.map((entry) => entry.userId), [2, 1, 3, 5, 4])
  assert.equal(mapped.find((entry) => entry.userId === 4)?.hasShield, true)
})

test('Season 3 bridge rejects incomplete or foreign race results', () => {
  assert.throws(() => mapSeason3RaceRanking([{ rank: 1, name: 'Unknown' }], seasonPlayers), /không thuộc Season 3/)
  assert.throws(() => mapSeason3RaceRanking([
    { rank: 1, name: 'Thanh' },
    { rank: 2, name: 'Thanh' },
    { rank: 3, name: 'Khoa' },
    { rank: 4, name: 'Long' },
    { rank: 5, name: 'Nam' },
  ], seasonPlayers), /không trả đủ ranking/)
})

test('Season 3 bridge does not auto-use an unconfirmed Shield', () => {
  const players = seasonPlayers.map((player) => player.userId === 4 ? { ...player, shieldConfirmed: false } : player)
  const mapped = mapSeason3RaceRanking(ranking.map(({ userId, name, rank }) => ({ userId, name, rank })), players)
  assert.equal(mapped.find((entry) => entry.userId === 4)?.hasShield, false)
})

test('Normal keeps vanilla ranking untouched and shield protects the exact Bottom 2 duck', () => {
  const result = resolveSeason3Race(ranking, { type: 'NORMAL', targetUserId: null, targetUserId2: null })

  assert.deepEqual(result.ranking.map((entry) => entry.userId), [1, 2, 3, 4, 5])
  assert.deepEqual(result.bottomTwo.map((entry) => entry.userId), [4, 5])
  assert.deepEqual(result.scarVictims.map((entry) => entry.userId), [5])
  assert.deepEqual(result.protectedPlayers.map((entry) => entry.userId), [4])
})

test('two scars become one shield and using a shield consumes one without moving the penalty', () => {
  assert.deepEqual(applyScarEconomy(1, 0, 1, false), { scars: 0, shields: 1 })
  assert.deepEqual(applyScarEconomy(0, 1, 1, true), { scars: 0, shields: 0 })
  assert.deepEqual(applyScarEconomy(0, 1, 0, true), { scars: 0, shields: 0 })
})

test('Reverse turns raw Top 2 into losers without changing raw ranks', () => {
  const result = resolveSeason3Race(ranking, { type: 'REVERSE', targetUserId: null, targetUserId2: null })

  assert.deepEqual(result.ranking.map((entry) => entry.rank), [1, 2, 3, 4, 5])
  assert.deepEqual(result.scarVictims.map((entry) => entry.userId), [1, 2])
  assert.deepEqual(result.protectedPlayers.map((entry) => entry.userId), [])
})

test('Duo and Constructors eliminate the worst group, including Shield protection', () => {
  const duo = resolveSeason3Race(ranking, { type: 'DUO', targetUserId: null, targetUserId2: null, groups: [[1, 5], [2, 3], [4]] })
  assert.deepEqual(duo.scarVictims.map((entry) => entry.userId), [1, 5])

  const constructors = resolveSeason3Race(ranking, { type: 'CONSTRUCTORS', targetUserId: null, targetUserId2: null, groups: [[1, 2, 3], [4, 5]] })
  assert.deepEqual(constructors.scarVictims.map((entry) => entry.userId), [5])
  assert.deepEqual(constructors.protectedPlayers.map((entry) => entry.userId), [4])
})

test('Triple, Cut Line, and Bounty Hunt follow their declared cutoffs', () => {
  const triple = resolveSeason3Race(ranking, { type: 'TRIPLE_ELIMINATION', targetUserId: null, targetUserId2: null })
  assert.deepEqual(triple.scarVictims.map((entry) => entry.userId), [3, 5])
  assert.deepEqual(triple.protectedPlayers.map((entry) => entry.userId), [4])

  const cutLine = resolveSeason3Race(ranking, { type: 'CUT_LINE', targetUserId: null, targetUserId2: null })
  assert.deepEqual(cutLine.scarVictims.map((entry) => entry.userId), [5])
  assert.deepEqual(cutLine.protectedPlayers.map((entry) => entry.userId), [4])

  const escaped = resolveSeason3Race(ranking, { type: 'BOUNTY_HUNT', targetUserId: 3, targetUserId2: null })
  assert.deepEqual(escaped.scarVictims.map((entry) => entry.userId), [5])
  const caught = resolveSeason3Race(ranking, { type: 'BOUNTY_HUNT', targetUserId: 4, targetUserId2: null })
  assert.deepEqual(caught.scarVictims.map((entry) => entry.userId), [5])
  const last = resolveSeason3Race(ranking, { type: 'BOUNTY_HUNT', targetUserId: 5, targetUserId2: null })
  assert.deepEqual(last.scarVictims.map((entry) => entry.userId), [5])
})

test('prediction points are awarded only for a raw Bottom 2 target', () => {
  const outcomes = resolvePredictions([
    { predictorUserId: 1, targetUserId: 5 },
    { predictorUserId: 2, targetUserId: 3 },
  ], ranking.slice(-2))

  assert.deepEqual(outcomes.map((outcome) => outcome.pointsAwarded), [1, 0])
})

test('King crown stays with a previous King who remains Top 3', () => {
  const result = resolveSeason3Race(ranking, { type: 'NORMAL', targetUserId: null, targetUserId2: null }, { userId: 2, streak: 3 })
  assert.equal(result.kingUserId, 2)
  assert.equal(result.kingStreak, 4)
  assert.equal(result.kingChanged, false)
})

test('Chaos selection returns exactly one card and persists random groups', () => {
  const card = selectChaosCard(ranking.slice(0, 3), () => 0.3)
  assert.ok(['NORMAL', 'REVERSE', 'DUO', 'TRIPLE_ELIMINATION', 'CUT_LINE', 'CONSTRUCTORS', 'BOUNTY_HUNT'].includes(card.type))
  if (card.type === 'DUO' || card.type === 'CONSTRUCTORS') assert.ok(card.groups && card.groups.flat().length === 3)
})

test('championship selection never uses prediction points', () => {
  assert.equal(selectChampion([
    { userId: 1, championshipPoints: 10, raceWins: 2 },
    { userId: 2, championshipPoints: 9, raceWins: 9 },
  ]), 1)
})

test('Duck News includes the S3 reveal facts', () => {
  const news = generateDuckNews({
    weekNumber: 6,
    scarVictims: [{ name: 'Thanh' }, { name: 'Huy' }],
    protectedPlayers: [{ name: 'Huy' }],
    chaos: { type: 'BOUNTY_HUNT', targetUserId: 1, targetUserId2: null },
    chaosTargetName: 'Thanh',
    kingName: 'Long',
    predictionWinners: [{ name: 'Khoa' }],
  })
  assert.match(news, /DUCK NEWS — WEEK 6/)
  assert.match(news, /BOUNTY HUNT — Thanh/)
  assert.match(news, /Khoa prediction chính xác/)
})
