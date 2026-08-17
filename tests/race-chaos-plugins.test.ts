import assert from 'node:assert/strict'
import test from 'node:test'
import {
  prepareChaosRule,
  resolveChaosRule,
  type ChaosRuleId,
} from '../packages/race-core/src'

const raw = Array.from({ length: 8 }, (_, index) => ({
  playerId: `p${index + 1}`,
  rank: index + 1,
}))

function losers(type: ChaosRuleId, prepared: Parameters<typeof resolveChaosRule>[2] = {}) {
  return resolveChaosRule(type, raw, prepared).loserPlayerIds
}

test('Normal, Reverse, Triple, and Cut Line resolve from the immutable raw ranking', () => {
  assert.deepEqual(losers('NORMAL'), ['p7', 'p8'])
  assert.deepEqual(losers('REVERSE'), ['p2', 'p1'])
  assert.deepEqual(losers('TRIPLE_ELIMINATION'), ['p6', 'p7', 'p8'])
  assert.deepEqual(losers('CUT_LINE'), ['p5', 'p6', 'p7', 'p8'])
})

test('Duo uses average rank then deterministic tie-breaks', () => {
  const result = resolveChaosRule('DUO', raw, {
    groups: [['p1', 'p8'], ['p3', 'p6'], ['p2', 'p4'], ['p5', 'p7']],
  })

  assert.deepEqual(result.loserPlayerIds, ['p5', 'p7'])
  assert.equal(Array.isArray(result.metadata.scores), true)

  const tied = resolveChaosRule('DUO', raw.slice(0, 4), {
    groups: [['p1', 'p4'], ['p2', 'p3']],
  })
  assert.deepEqual(tied.loserPlayerIds, ['p1', 'p4'])

  // Odd lobby (trio vs pair): Trio with better average is safe despite higher total sum
  const trioTest = resolveChaosRule('DUO', raw.slice(0, 5), {
    groups: [['p1', 'p2', 'p5'], ['p3', 'p4']], // Group 0 avg = (1+2+5)/3 = 2.67, Group 1 avg = (3+4)/2 = 3.5
  })
  assert.deepEqual(trioTest.loserPlayerIds, ['p3', 'p4'])
})

test('Constructors makes every duck on the worse team lose and handles odd lobbies fairly', () => {
  assert.deepEqual(
    losers('CONSTRUCTORS', { groups: [['p1', 'p2', 'p3', 'p8'], ['p4', 'p5', 'p6', 'p7']] }),
    ['p4', 'p5', 'p6', 'p7'],
  )

  const tie = resolveChaosRule('CONSTRUCTORS', raw.slice(0, 4), {
    groups: [['p1', 'p4'], ['p2', 'p3']],
  })
  assert.deepEqual(tie.loserPlayerIds, ['p1', 'p2', 'p3', 'p4'])
  assert.equal(tie.metadata.tie, true)

  // 7-player odd lobby test (4 vs 3):
  // Team A (p2, p3, p4, p7) avg = 4.0; Team B (p1, p5, p6) avg = 4.0 -> Exact tie
  const oddTie = resolveChaosRule('CONSTRUCTORS', raw.slice(0, 7), {
    groups: [['p2', 'p3', 'p4', 'p7'], ['p1', 'p5', 'p6']],
  })
  assert.deepEqual(oddTie.loserPlayerIds, ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'])
  assert.equal(oddTie.metadata.tie, true)

  // Team A (p1, p2, p3, p7: avg 3.25) vs Team B (p4, p5, p6: avg 5.0) -> Team B loses
  const oddDecisive = resolveChaosRule('CONSTRUCTORS', raw.slice(0, 7), {
    groups: [['p1', 'p2', 'p3', 'p7'], ['p4', 'p5', 'p6']],
  })
  assert.deepEqual(oddDecisive.loserPlayerIds, ['p4', 'p5', 'p6'])
})

test('Bounty Hunt falls back to raw Bottom 2 when Wanted escapes Top 50%', () => {
  const result = resolveChaosRule('BOUNTY_HUNT', raw, { targetPlayerId: 'p4' })
  assert.deepEqual(result.loserPlayerIds, ['p7', 'p8'])
  assert.equal(result.metadata.escaped, true)
})

test('Bounty Hunt makes Wanted and every duck behind lose when Wanted misses Top 50%', () => {
  assert.deepEqual(losers('BOUNTY_HUNT', { targetPlayerId: 'p6' }), ['p6', 'p7', 'p8'])
  assert.deepEqual(losers('BOUNTY_HUNT', { targetPlayerId: 'p8' }), ['p8'])
})

test('Chaos preparation is deterministic and persists every player exactly once', () => {
  const players = raw.map(({ playerId }) => ({ playerId }))
  const sequence = [0.91, 0.14, 0.72, 0.31, 0.55, 0.03, 0.44]
  const prepare = (type: ChaosRuleId) => {
    let cursor = 0
    return prepareChaosRule(type, players, () => sequence[cursor++ % sequence.length])
  }

  assert.deepEqual(prepare('DUO'), prepare('DUO'))
  assert.deepEqual(prepare('CONSTRUCTORS'), prepare('CONSTRUCTORS'))
  assert.deepEqual(prepare('BOUNTY_HUNT'), prepare('BOUNTY_HUNT'))
  assert.deepEqual([...prepare('DUO').groups!.flat()].sort(), players.map((player) => player.playerId).sort())
  assert.deepEqual([...prepare('CONSTRUCTORS').groups!.flat()].sort(), players.map((player) => player.playerId).sort())
})

test('Duo uses one trio for an odd lobby instead of giving one duck a free singleton group', () => {
  const players = raw.slice(0, 7).map(({ playerId }) => ({ playerId }))
  const prepared = prepareChaosRule('DUO', players, () => 0.4)
  assert.deepEqual(prepared.groups!.map((group) => group.length).sort(), [2, 2, 3])
})

test('Chaos rejects incomplete persisted group data', () => {
  assert.throws(() => losers('DUO'), /persisted pairs/)
  assert.throws(() => losers('CONSTRUCTORS', { groups: [['p1']] }), /two persisted teams/)
  assert.throws(() => losers('BOUNTY_HUNT', { targetPlayerId: 'missing' }), /valid Wanted/)
})
