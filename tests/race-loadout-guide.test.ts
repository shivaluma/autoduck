import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateLoadoutPairing } from '../lib/racing/loadout-guide'

test('loadout guide labels pure speed combo', () => {
  const pairing = evaluateLoadoutPairing(['NITRO', 'DRAFT_FIN'])
  assert.equal(pairing?.tier, 'recommended')
  assert.equal(pairing?.label, 'SPEED DEMON')
  assert.match(pairing?.badge ?? '', /SPEED COMBO/)
})

test('loadout guide labels pure defense combo', () => {
  const pairing = evaluateLoadoutPairing(['BUBBLE_SHIELD', 'FEATHER'])
  assert.equal(pairing?.label, 'FORTRESS')
  assert.match(pairing?.badge ?? '', /DEFENSE COMBO/)
})

test('loadout guide labels hybrid builds without avoid tier', () => {
  const hybrid = evaluateLoadoutPairing(['NITRO', 'FEATHER'])
  assert.equal(hybrid?.tier, 'hybrid')
  assert.equal(hybrid?.label, 'MAD DUCK')
  assert.match(hybrid?.badge ?? '', /HYBRID/)
  const menace = evaluateLoadoutPairing(['HOMING_ROCKET', 'BANANA'])
  assert.equal(menace?.tier, 'recommended')
  assert.equal(menace?.label, 'MENACE')
})
