/**
 * Background music for the race canvas: one looping track for every race
 * (`public/race-music/`, credits in `public/race-music/CREDITS.md`).
 *
 * "Fluffing a Duck" by Kevin MacLeod (incompetech.com), licensed under Creative Commons:
 * By Attribution 4.0 (https://creativecommons.org/licenses/by/4.0/). The in-race label credits it.
 */
export interface RaceMusicTrack {
  title: string
  artist: string
  credit: string
  url: string
}

export const RACE_MUSIC: RaceMusicTrack = {
  title: 'Fluffing a Duck',
  artist: 'Kevin MacLeod',
  credit: 'incompetech.com · CC BY 4.0',
  url: '/race-music/fluffing-a-duck.mp3',
}
