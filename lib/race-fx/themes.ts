import type { RACE_FX_DECOR } from './manifest'

/**
 * Race canvas themes: background, banks, water, decor and ambient weather. Purely visual: the
 * simulation never sees the theme, so switching one needs no balance or engine version bump.
 * Each race gets one at random, seeded by its race id so every spectator and replay sees the same.
 */

type DecorKey = typeof RACE_FX_DECOR[number]

export interface ThemeDecor {
  key: DecorKey
  /** Display size range in px. */
  size: [number, number]
  weight: number
  /** Water decor turns to a random angle and drifts; upright pieces (penguins, buoys) don't spin. */
  spin?: boolean
}

export interface RaceTheme {
  id: RaceThemeId
  name: string
  emoji: string
  background: number
  /** `tufts` scatters soft ellipses over the ground; `grid` draws a glowing city grid. */
  ground: { style: 'tufts'; colors: number[]; alpha: number } | { style: 'grid'; minor: number; major: number; lights: number[] }
  bank: { fill: number; edge: number; outer: number; glow?: number }
  /** Deep → mid → bright channel. */
  water: [number, number, number]
  foam: { edge: number; inner: number; glow?: boolean }
  currents: { color: number; alpha: number; additive?: boolean }
  glints: number[]
  wakeTint?: number[]
  decor: { bank: ThemeDecor[]; water: ThemeDecor[] }
  /** Screen-space weather. `fall` spawns above the view, `float` anywhere in it. */
  ambient?: {
    texture: 'p-streak' | 'p-petal' | 'p-dot'
    spawn: 'fall' | 'float'
    tint: number[]
    speedX: [number, number]
    speedY: [number, number]
    scale: [number, number]
    alpha: number
    lifespan: number
    /** ms between particles on desktop (doubled on phones). */
    frequency: number
    /** Fixed angle in degrees, or `spin` to tumble. */
    rotate?: number | 'spin'
    additive?: boolean
  }
}

export const RACE_THEME_IDS = ['pond', 'neon', 'sakura', 'glacier', 'lagoon'] as const
export type RaceThemeId = typeof RACE_THEME_IDS[number]

export const RACE_THEMES: Record<RaceThemeId, RaceTheme> = {
  pond: {
    id: 'pond', name: 'Duck Pond', emoji: '🌿',
    background: 0x2f7a46,
    ground: { style: 'tufts', colors: [0x2b6b3d, 0x3f8a4f], alpha: 0.55 },
    bank: { fill: 0xe9d49a, edge: 0x9a7b43, outer: 1.16 },
    water: [0x1a78ab, 0x2493c7, 0x34a8da],
    foam: { edge: 0xe6fbff, inner: 0xbdefff },
    currents: { color: 0xb8f4ff, alpha: 0.16 },
    glints: [0xffffff, 0xd9f6ff],
    decor: {
      bank: [{ key: 'reeds', size: [54, 94], weight: 0.6 }, { key: 'rock', size: [54, 94], weight: 0.4 }],
      water: [{ key: 'lilypad', size: [22, 34], weight: 0.7, spin: true }, { key: 'lotus', size: [22, 34], weight: 0.3, spin: true }],
    },
  },

  // Rain-soaked night canal: blade-runner magenta/cyan neon over black water.
  neon: {
    id: 'neon', name: 'Neon Canal', emoji: '🌃',
    background: 0x0c0a22,
    ground: { style: 'grid', minor: 0x2a1a63, major: 0x7c3aed, lights: [0xff2bd6, 0x22e9ff, 0xfde047] },
    bank: { fill: 0x18143a, edge: 0xff2bd6, outer: 1.16, glow: 0xff2bd6 },
    water: [0x060d26, 0x0b1f4d, 0x123a85],
    foam: { edge: 0x22e9ff, inner: 0x8b5cf6, glow: true },
    currents: { color: 0xff4fd8, alpha: 0.32, additive: true },
    glints: [0x22e9ff, 0xff4fd8, 0xffffff],
    wakeTint: [0x9ffcff, 0xffb8f0],
    decor: {
      bank: [{ key: 'neon-lamp', size: [58, 84], weight: 0.45 }, { key: 'neon-sign', size: [64, 92], weight: 0.35 }, { key: 'neon-roof', size: [70, 104], weight: 0.2 }],
      water: [{ key: 'neon-buoy', size: [26, 36], weight: 1 }],
    },
    ambient: {
      texture: 'p-streak', spawn: 'fall', tint: [0x7dd3fc, 0xf0abfc, 0xc4b5fd],
      speedX: [-140, -100], speedY: [900, 1150], scale: [0.6, 1.1], alpha: 0.4, lifespan: 1100, frequency: 14, rotate: 96, additive: true,
    },
  },

  // Spring Japanese garden: jade water, stone banks, falling cherry blossom.
  sakura: {
    id: 'sakura', name: 'Sakura Garden', emoji: '🌸',
    background: 0x5f9e57,
    ground: { style: 'tufts', colors: [0x4f8a48, 0x7bb86b, 0xf6b8cf, 0xfbd3e1], alpha: 0.55 },
    bank: { fill: 0xe7dfcf, edge: 0x8a7d68, outer: 1.18 },
    water: [0x167a78, 0x22a096, 0x55cdb9],
    foam: { edge: 0xf2fffb, inner: 0xc6f5e8 },
    currents: { color: 0xd7fff4, alpha: 0.18 },
    glints: [0xffffff, 0xffd6e7],
    wakeTint: [0xffffff, 0xffe4ef],
    decor: {
      bank: [{ key: 'sakura-tree', size: [84, 124], weight: 0.55 }, { key: 'stone-lantern', size: [50, 70], weight: 0.3 }, { key: 'rock', size: [44, 70], weight: 0.15 }],
      water: [{ key: 'koi', size: [30, 42], weight: 0.4, spin: true }, { key: 'petal-raft', size: [26, 38], weight: 0.4, spin: true }, { key: 'lilypad', size: [22, 32], weight: 0.2, spin: true }],
    },
    ambient: {
      texture: 'p-petal', spawn: 'fall', tint: [0xffc2d9, 0xff9cc2, 0xffe4ef],
      speedX: [50, 120], speedY: [55, 115], scale: [0.55, 1], alpha: 0.9, lifespan: 13000, frequency: 150, rotate: 'spin',
    },
  },

  // Arctic fjord under the aurora: snowfields, ice banks, drifting floes.
  glacier: {
    id: 'glacier', name: 'Aurora Glacier', emoji: '❄️',
    background: 0xdcebf5,
    ground: { style: 'tufts', colors: [0xc2d9ea, 0xf4faff, 0xb3cde2], alpha: 0.7 },
    bank: { fill: 0xbde8f6, edge: 0x5aa6cc, outer: 1.18 },
    water: [0x0b3560, 0x13588a, 0x2f86bb],
    foam: { edge: 0xffffff, inner: 0xd6f4ff },
    currents: { color: 0xd6f4ff, alpha: 0.2 },
    glints: [0xffffff, 0xcff3ff, 0x9ef7d0],
    decor: {
      bank: [{ key: 'snow-pine', size: [64, 100], weight: 0.6 }, { key: 'snowman', size: [50, 66], weight: 0.2 }, { key: 'rock', size: [44, 66], weight: 0.2 }],
      water: [{ key: 'ice-floe', size: [30, 48], weight: 0.75, spin: true }, { key: 'penguin', size: [34, 44], weight: 0.25 }],
    },
    ambient: {
      texture: 'p-dot', spawn: 'fall', tint: [0xffffff, 0xe0f2fe],
      speedX: [-35, 35], speedY: [40, 95], scale: [0.25, 0.65], alpha: 0.9, lifespan: 16000, frequency: 85,
    },
  },

  // Tropical lagoon at golden hour: turquoise shallows, wide beach, palms and tiki torches.
  lagoon: {
    id: 'lagoon', name: 'Sunset Lagoon', emoji: '🌴',
    background: 0x2c8048,
    ground: { style: 'tufts', colors: [0x1f6b37, 0x3f9c52, 0x56b061], alpha: 0.6 },
    bank: { fill: 0xf7e0a6, edge: 0xc9a25c, outer: 1.34 },
    water: [0x0a8fa8, 0x13b8c2, 0x6ee7d6],
    foam: { edge: 0xffffff, inner: 0xd5fff6 },
    currents: { color: 0xeafffb, alpha: 0.2 },
    glints: [0xfff1c1, 0xffc58a, 0xffffff],
    decor: {
      bank: [{ key: 'palm', size: [92, 130], weight: 0.6 }, { key: 'tiki-torch', size: [50, 70], weight: 0.25 }, { key: 'rock', size: [44, 64], weight: 0.15 }],
      water: [{ key: 'hibiscus', size: [24, 34], weight: 0.55, spin: true }, { key: 'coconut', size: [22, 30], weight: 0.45, spin: true }],
    },
    ambient: {
      texture: 'p-dot', spawn: 'float', tint: [0xffe08a, 0xffb36b],
      speedX: [-12, 12], speedY: [-28, -10], scale: [0.2, 0.45], alpha: 0.75, lifespan: 4200, frequency: 220, additive: true,
    },
  },
}

/** Deterministic pick so live viewers, late joiners and replays of one race agree. */
export function pickRaceTheme(raceId: number): RaceTheme {
  const hash = Math.imul((raceId | 0) ^ 0x9e3779b9, 0x85ebca6b) >>> 0
  return RACE_THEMES[RACE_THEME_IDS[((hash ^ (hash >>> 13)) >>> 0) % RACE_THEME_IDS.length]!]
}

export function pickWeighted<T extends { weight: number }>(items: T[], roll: number): T {
  const total = items.reduce((sum, item) => sum + item.weight, 0)
  let cursor = roll * total
  for (const item of items) {
    cursor -= item.weight
    if (cursor < 0) return item
  }
  return items.at(-1)!
}
