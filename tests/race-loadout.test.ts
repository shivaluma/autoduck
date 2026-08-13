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
