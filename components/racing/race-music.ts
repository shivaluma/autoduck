/**
 * Background music for the race canvas: chill lo-fi tracks from NoCopyrightSounds (NCS), trimmed to
 * 96 s loops at 64 kbps (`public/race-music/`, credits in `public/race-music/CREDITS.md`).
 *
 * Like the map theme, each race gets one track picked from its id, so every viewer of a race hears
 * the same song. The hash uses a different salt from `pickRaceTheme`, so a map doesn't always come
 * with the same song.
 */
export interface RaceMusicTrack {
  id: string
  title: string
  artist: string
  url: string
}

export const RACE_MUSIC: readonly RaceMusicTrack[] = [
  { id: 'cruising', title: 'Cruising', artist: 'Aisake, Dosi', url: '/race-music/cruising.mp3' },
  { id: 'miffy-cafe', title: 'miffy cafe', artist: 'sakuracloud', url: '/race-music/miffy-cafe.mp3' },
  { id: 'apart', title: 'apart', artist: 'sumu', url: '/race-music/apart.mp3' },
  { id: 'up-in-flumes', title: 'Up In Flumes', artist: 'T-Mass', url: '/race-music/up-in-flumes.mp3' },
  { id: 'long-road-home', title: 'The Long Road Home', artist: 'Inukshuk', url: '/race-music/long-road-home.mp3' },
  { id: 'lune', title: 'Lune', artist: 'Y&V', url: '/race-music/lune.mp3' },
]

export function pickRaceMusic(raceId: number): RaceMusicTrack {
  const hash = Math.imul((raceId | 0) ^ 0x2c1b3c6d, 0xc2b2ae35) >>> 0
  return RACE_MUSIC[((hash ^ (hash >>> 15)) >>> 0) % RACE_MUSIC.length]!
}
