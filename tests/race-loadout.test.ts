import assert from 'node:assert/strict'
import test from 'node:test'
import { validateLoadout } from '../packages/race-core/src'
import { selectAutoLoadout } from '../lib/racing/loadout'

test('loadout enforces budget, slots, one Major and no duplicates', () => {
  assert.equal(validateLoadout(['NITRO', 'BANANA']).ready, true)
  assert.equal(validateLoadout(['FEATHER', 'QUACK_HORN']).ready, false)
  assert.throws(() => validateLoadout(['NITRO', 'HOMING_ROCKET']), /Prep Credits/)
  assert.throws(() => validateLoadout(['BANANA', 'BANANA']), /trùng nhau/)
  assert.throws(() => validateLoadout(['BANANA', 'FEATHER', 'QUACK_HORN']), /Tối đa 2/)
})

test('auto loadout is deterministic and always full budget', () => {
  const first = selectAutoLoadout('ab'.repeat(32), '42')
  const second = selectAutoLoadout('ab'.repeat(32), '42')
  assert.deepEqual(second, first)
  assert.equal(validateLoadout(first).ready, true)
})

test('auto loadout randomly selects across all available 2-cost major and 1-cost minor items', () => {
  const selectedMajors = new Set<string>()
  const selectedMinors = new Set<string>()
  let generatedHybrid = false
  let generatedThemed = false

  for (let i = 0; i < 200; i++) {
    const loadout = selectAutoLoadout(`seed-${i}`, `player-${i}`)
    assert.equal(validateLoadout(loadout).ready, true)
    assert.equal(loadout.length, 2)

    const [major, minor] = loadout
    selectedMajors.add(major)
    selectedMinors.add(minor)

    // Check if both pure combos (e.g. NITRO+DRAFT_FIN) and hybrid combos (e.g. NITRO+BANANA) are produced
    if ((major === 'NITRO' && minor === 'DRAFT_FIN') || (major === 'BUBBLE_SHIELD' && minor === 'FEATHER') || (major === 'HOMING_ROCKET' && minor === 'BANANA')) {
      generatedThemed = true
    } else {
      generatedHybrid = true
    }
  }

  // All 3 major items should be represented
  assert.deepEqual([...selectedMajors].sort(), ['BUBBLE_SHIELD', 'HOMING_ROCKET', 'NITRO'])
  // All 6 minor items should be represented
  assert.deepEqual([...selectedMinors].sort(), ['BANANA', 'DRAFT_FIN', 'FEATHER', 'PADDLE_BURST', 'QUACK_HORN', 'SHOCK_ABSORBER'])
  assert.equal(generatedThemed, true)
  assert.equal(generatedHybrid, true)
})
