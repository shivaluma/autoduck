import { CANONICAL_PALETTES, DUCK_PATHS, derivePalette, generateBaseDuckSvg, type DuckPaletteTokens } from '../../../lib/cosmetics/avatar-rig'
import { INK, MINOR, animate, burst, clipped, cycleStop, glow, linear, livingGradient, metal, motes, radial, sparkle, sweepBand, tone, twinkle } from '../kit'

const WING = (outline: string) => `<path d="${DUCK_PATHS.wing}" fill="none" stroke="${outline}" stroke-width="${MINOR}" stroke-linecap="round" stroke-linejoin="round"/>`

/** Solid jewel tone + a colour-shifting sheen sweeping the body (rare tier). */
function jewel(id: string, base: string, sheen: string[], overrides: Partial<DuckPaletteTokens> = {}) {
  return duck(derivePalette(base, overrides), {
    defs: `<linearGradient id="${id}-sheen" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sheen[0]}" stop-opacity="0.55">${cycleStop(sheen, 4)}</stop><stop offset="0.6" stop-color="${base}" stop-opacity="0"/></linearGradient>`,
    overlay: clipped(`${id}-t`, DUCK_PATHS.torso, `<path d="${DUCK_PATHS.torso}" fill="url(#${id}-sheen)"/>` + sweepBand(`${id}-sweep`, 0, 180, 50, 300, 520, 3.4, 0, 0.5)) +
      clipped(`${id}-h`, DUCK_PATHS.head, `<path d="${DUCK_PATHS.head}" fill="url(#${id}-sheen)"/>`) + WING(INK),
  })
}

const plain = (id: string) => () => generateBaseDuckSvg(CANONICAL_PALETTES[id]!)

function duck(palette: DuckPaletteTokens, options: { overlay?: string; defs?: string } = {}) {
  return generateBaseDuckSvg(palette, options)
}

export const BODY_COLOR_ART: Record<string, () => string> = {
  // ─── COMMON — clean solid palettes ───────────────────────────────────────
  'body-sunshine': plain('body-sunshine'),
  'body-tangerine': plain('body-tangerine'),
  'body-mint': plain('body-mint'),
  'body-sky': plain('body-sky'),
  'body-rose': plain('body-rose'),
  'body-cream': plain('body-cream'),

  // ─── UNCOMMON — a second tone ────────────────────────────────────────────
  'body-lavender': plain('body-lavender'),
  'body-midnight': () => duck(derivePalette('#4A5490', { eyeHighlight: '#9FE7FF', blush: '#C084FC', beakBase: '#FFB547', feetBase: '#FFB547' }), {
    overlay: clipped('mid-stars', DUCK_PATHS.torso, `<g>${sparkle(160, 290, 6, '#C7D2FE')}${twinkle(3)}</g><g>${sparkle(230, 370, 5, '#C7D2FE')}${twinkle(3, 1.5)}</g>`) + WING(INK),
  }),
  'body-matcha': () => duck(derivePalette('#9CC46A', { blush: '#FF8FA3' })),
  'body-coral': () => duck(derivePalette('#FF7A6B', { beakBase: '#FFC24D', beakShadow: '#D98A16', beakHighlight: '#FFE7A6', feetBase: '#FFC24D', blush: '#FFD1C7' })),
  'body-bubblegum': () => duck(derivePalette('#FF8AD8', { blush: '#FF4FA3' })),
  'body-grape': () => duck(derivePalette('#8B5CF6', { blush: '#F0ABFC', eyeHighlight: '#E9D5FF' })),
  'body-cocoa': () => duck(derivePalette('#A0694A', { blush: '#FF9E8A', beakBase: '#FFB347', feetBase: '#FFB347' })),
  'body-lime': () => duck(derivePalette('#B6F23A')),
  'body-peach': () => duck(derivePalette('#FFB38A')),
  'body-aqua': () => duck(derivePalette('#3EDBF0')),

  // ─── RARE — one jewel colour with a moving sheen ─────────────────────────
  'body-mallard': () => jewel('mallard', '#1F8F5F', ['#5EEAD4', '#7C3AED', '#22C55E'], { feetBase: '#FF8A3D', beakBase: '#F2C744', beakShadow: '#B08A1C', beakHighlight: '#FFF0A6' }),
  'body-cherry': () => jewel('cherry', '#E11D48', ['#FDA4AF', '#FDE68A', '#FB7185'], { beakBase: '#FFC24D', feetBase: '#FFC24D', blush: '#FFD1DC' }),
  'body-sapphire': () => jewel('sapphire', '#2563EB', ['#93C5FD', '#C4B5FD', '#67E8F9'], { eyeHighlight: '#BFDBFE', blush: '#F0ABFC' }),
  'body-pearl': () => duck(derivePalette('#F3EEF7', { bodyShadow: '#C8BEDA', blush: '#FFB3CF', eyeHighlight: '#BDEBFF' }), {
    defs: `<linearGradient id="pearl-sheen" x1="1" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="#FFD6EC" stop-opacity="0.9">${cycleStop(['#FFD6EC', '#D6F2FF', '#E9DCFF', '#FFF4D6'], 5)}</stop>` +
      `<stop offset="0.4" stop-color="#D6F2FF" stop-opacity="0.55">${cycleStop(['#D6F2FF', '#E9DCFF', '#FFF4D6', '#FFD6EC'], 5)}</stop>` +
      `<stop offset="0.75" stop-color="#E9DCFF" stop-opacity="0.7">${cycleStop(['#E9DCFF', '#FFF4D6', '#FFD6EC', '#D6F2FF'], 5)}</stop>` +
      `<stop offset="1" stop-color="#FFF4D6" stop-opacity="0.4"/></linearGradient>`,
    overlay:
      clipped('pearl-t', DUCK_PATHS.torso, `<path d="${DUCK_PATHS.torso}" fill="url(#pearl-sheen)"/>` + sweepBand('pearl-sweep', 0, 180, 60, 300, 520, 3.6, 0, 0.6)) +
      clipped('pearl-h', DUCK_PATHS.head, `<path d="${DUCK_PATHS.head}" fill="url(#pearl-sheen)" opacity="0.8"/>`) +
      tone('M356 64 C384 66 404 82 410 104 C394 92 376 84 356 82 Z', '#FFFFFF', 0.95) + burst(392, 76, 8, 3, 1) + WING('#4B3A66'),
  }),

  'body-ink': () => duck(derivePalette('#2A2638', { bodyShadow: '#141120', bodyHighlight: '#57506E', outline: '#0B0716', beakBase: '#FFC93D', beakShadow: '#C98A0E', beakHighlight: '#FFF0A0', feetBase: '#FFC93D', blush: '#FF6FA0', eyeHighlight: '#FFFFFF' }), {
    overlay:
      `<path d="M300 62 C350 40 412 56 432 104" fill="none" stroke="#9D8FD6" stroke-width="6" stroke-linecap="round" stroke-dasharray="60 200">${animate('stroke-dashoffset', '60;-200', 3, { calcMode: 'linear', keySplines: undefined })}</path>` +
      `<path d="M96 330 C110 280 170 236 244 228" fill="none" stroke="#9D8FD6" stroke-width="5" stroke-linecap="round" stroke-dasharray="50 220" opacity="0.8">${animate('stroke-dashoffset', '50;-220', 3, { calcMode: 'linear', keySplines: undefined, begin: '1.2s' })}</path>` +
      WING('#0B0716'),
  }),

  // ─── EPIC — full-body gradient + emissive glints ─────────────────────────
  'body-sunset': () => duck(derivePalette('#FF6F7D', { bodyBase: 'url(#sunset)', bodyShadow: '#9D2B6B', bodyHighlight: '#FFE7A1', blush: '#FFFFFF', beakBase: '#FFD84D', beakShadow: '#E59A12', feetBase: '#FFD84D' }), {
    defs: livingGradient('sunset', [['#FFD45A', '#FF9E5E', '#FFB3E6', '#FFD45A'], ['#FF7A59', '#F25C8A', '#B15CFF', '#FF7A59'], ['#E8478B', '#9B4DCA', '#4F46E5', '#E8478B'], ['#8E3BB8', '#3B2A8F', '#1E1B4B', '#8E3BB8']], 8, 0.2, 0, 0, 1) +
      radial('sun-bloom', [[0, '#FFE7A1', 0.55], [1, '#FFE7A1', 0]]) + glow('sun-glow', 4),
    overlay:
      clipped('sunset-t', DUCK_PATHS.torso, `<circle cx="380" cy="260" r="90" fill="url(#sun-bloom)">${animate('cy', '250;300;250', 8)}</circle>`) +
      `<g filter="url(#sun-glow)">${burst(420, 270, 10, 2.6)}${burst(150, 262, 8, 2.6, 0.9)}${burst(250, 70, 7, 2.6, 1.7)}</g>` +
      motes({ count: 6, x: 120, y: 300, width: 260, height: 80, rise: 90, colors: ['#FFE7A1', '#FFB3E6'], size: [2, 3.5], seconds: 3.2, seed: 31 }) + WING(INK),
  }),

  'body-chrome': () => duck(derivePalette('#B8C4D6', { bodyBase: 'url(#chrome)', bodyShadow: '#3B4A63', bodyHighlight: '#FFFFFF', outline: '#141B2B', eyeHighlight: '#00F2FE', blush: '#FF2BD6' }), {
    defs: linear('chrome', [[0, '#F8FBFF'], [0.3, '#9AA8BF'], [0.48, '#E6F7FF'], [0.52, '#5C6B86'], [0.75, '#C5D2E6'], [1, '#4A5874']], 0.3, 0, 0, 1) +
      `<linearGradient id="chrome-tint" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#00F2FE" stop-opacity="0.35">${cycleStop(['#00F2FE', '#FF2BD6', '#22FFA6'], 3)}</stop><stop offset="1" stop-color="#FF2BD6" stop-opacity="0.35">${cycleStop(['#FF2BD6', '#22FFA6', '#00F2FE'], 3)}</stop></linearGradient>` + glow('chrome-glow', 3),
    overlay:
      clipped('chrome-t', DUCK_PATHS.torso, `<path d="${DUCK_PATHS.torso}" fill="url(#chrome-tint)"/>` + sweepBand('chrome-sweep', 0, 180, 60, 300, 520, 2.2, 0, 0.95) + sweepBand('chrome-sweep2', -40, 180, 20, 300, 520, 2.2, 0.25, 0.9)) +
      clipped('chrome-h', DUCK_PATHS.head, `<path d="${DUCK_PATHS.head}" fill="url(#chrome-tint)"/>` + sweepBand('chrome-sweep3', 160, 0, 40, 270, 320, 2.2, 0.6, 0.9)) +
      `<g filter="url(#chrome-glow)">${burst(398, 286, 9, 2.2, 0.5)}${burst(380, 70, 7, 2.2, 1.2)}</g>` + WING('#141B2B'),
  }),

  // ─── LEGENDARY — Golden Duck (Pond Royalty) ──────────────────────────────
  'body-golden': () => duck(derivePalette('#F2B627', { bodyBase: 'url(#gold-body)', bodyShadow: '#8A5A0B', bodyHighlight: '#FFF6C9', outline: '#3A2207', beakBase: '#FF7A1A', beakShadow: '#B5470A', beakHighlight: '#FFC48A', feetBase: '#FF7A1A', blush: '#FF5C7A', eyeHighlight: '#FFF3A6' }), {
    defs: metal('gold-body', '#F2B627') + radial('gold-bloom', [[0, '#FFF3A6', 0.6], [1, '#FFF3A6', 0]]) + glow('gold-glow', 5),
    overlay:
      clipped('gold-t', DUCK_PATHS.torso, sweepBand('gold-sweep', -40, 180, 70, 300, 600, 2.6, 0, 0.95) + `<ellipse cx="300" cy="300" rx="120" ry="60" fill="url(#gold-bloom)">${animate('opacity', '0.2;0.8;0.2', 2.6)}</ellipse>`) +
      clipped('gold-h', DUCK_PATHS.head, sweepBand('gold-sweep-h', 140, 0, 56, 270, 360, 2.6, 0.3, 0.95)) +
      `<path d="M300 300 C330 290 362 300 376 320" fill="none" stroke="#FFF3A6" stroke-width="6" stroke-linecap="round" opacity="0.8"/>` +
      `<g filter="url(#gold-glow)">${burst(416, 252, 13, 2.2)}${burst(176, 276, 10, 2.2, 0.7)}${burst(268, 80, 9, 2.2, 1.4)}${burst(120, 360, 8, 2.2, 1.8)}</g>` +
      motes({ count: 10, x: 90, y: 280, width: 200, height: 130, rise: 110, colors: ['#FFF3A6', '#FDE047'], size: [2, 4], seconds: 3, seed: 41, shape: 'sparkle' }) + WING('#3A2207'),
  }),
}
