import assert from 'node:assert/strict'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { RACE_MUSIC } from '../components/racing/race-music'

test('the race music file ships, stays small and keeps its CC BY credit', () => {
  const file = join('public', RACE_MUSIC.url)
  assert.ok(existsSync(file), `${file} is missing`)
  assert.ok(statSync(file).size < 1_000_000, `${file} is over 1 MB`)
  assert.match(RACE_MUSIC.credit, /CC BY/)
})
