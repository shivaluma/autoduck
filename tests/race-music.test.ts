import assert from 'node:assert/strict'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { RACE_MUSIC, pickRaceMusic } from '../components/racing/race-music'

test('each race id always gets the same track', () => {
  for (const raceId of [1, 113, 246, 247, 9999]) assert.equal(pickRaceMusic(raceId), pickRaceMusic(raceId))
})

test('every track gets picked across a range of races', () => {
  const picked = new Set(Array.from({ length: 300 }, (_, raceId) => pickRaceMusic(raceId).id))
  assert.deepEqual([...picked].sort(), RACE_MUSIC.map((track) => track.id).sort())
})

test('every track file ships and stays small', () => {
  for (const track of RACE_MUSIC) {
    const file = join('public', track.url)
    assert.ok(existsSync(file), `${file} is missing`)
    assert.ok(statSync(file).size < 1_000_000, `${file} is over 1 MB`)
  }
})
