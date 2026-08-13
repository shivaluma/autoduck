import assert from 'node:assert/strict'
import test from 'node:test'
import { assertRaceStateTransition, canTransitionRaceState } from '../lib/racing/state-machine'

test('race lifecycle allows only explicit forward transitions and safe pre-race rollback', () => {
  assert.equal(canTransitionRaceState('CREATED', 'CHAOS_REVEALED'), true)
  assert.equal(canTransitionRaceState('LOCKED', 'PREPARING'), true)
  assert.equal(canTransitionRaceState('COUNTDOWN', 'LOCKED'), true)
  assert.equal(canTransitionRaceState('RACING', 'RESOLVED'), false)
  assert.equal(canTransitionRaceState('FINISHED', 'RACING'), false)
  assert.doesNotThrow(() => assertRaceStateTransition('FINISHED', 'RESOLVED'))
  assert.throws(() => assertRaceStateTransition('RESOLVED', 'RACING'), /Invalid race transition/)
})
