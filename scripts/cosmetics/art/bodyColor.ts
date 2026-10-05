import { CANONICAL_PALETTES, DUCK_PATHS, derivePalette, generateBaseDuckSvg, type DuckPaletteTokens } from '../../../lib/cosmetics/avatar-rig'
import { INK, MINOR, animateTransform, clipped, linear, metal, radial, sparkle, tone, twinkle } from '../kit'

const WING = (outline: string) => `<path d="${DUCK_PATHS.wing}" fill="none" stroke="${outline}" stroke-width="${MINOR}" stroke-linecap="round" stroke-linejoin="round"/>`
const BELLY = 'M250 262 C320 250 400 270 412 322 C420 372 360 404 286 410 C240 412 214 380 222 340 C228 300 236 272 250 262 Z'

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
  'body-lavender': () => duck(CANONICAL_PALETTES['body-lavender']!, {
    overlay: clipped('lav-belly', DUCK_PATHS.torso, tone(BELLY, '#EFE6FF', 0.7)) + WING(INK),
  }),
  'body-midnight': () => duck(derivePalette('#4A5490', { eyeHighlight: '#9FE7FF', blush: '#C084FC', beakBase: '#FFB547', feetBase: '#FFB547' }), {
    overlay: clipped('mid-stars', DUCK_PATHS.torso, tone(BELLY, '#6E7AC0', 0.6)) + WING(INK),
  }),
  'body-matcha': () => duck(derivePalette('#9CC46A', { blush: '#FF8FA3' }), {
    overlay: clipped('matcha-belly', DUCK_PATHS.torso, tone(BELLY, '#F6EBCB')) +
      clipped('matcha-cheek', DUCK_PATHS.head, tone('M300 170 C330 160 370 176 380 214 C360 246 300 250 268 226 C262 200 276 178 300 170 Z', '#F6EBCB')) + WING(INK),
  }),
  'body-coral': () => duck(derivePalette('#FF7A6B', { beakBase: '#FFC24D', beakShadow: '#D98A16', beakHighlight: '#FFE7A6', feetBase: '#FFC24D', blush: '#FFD1C7' }), {
    overlay: clipped('coral-belly', DUCK_PATHS.torso, tone(BELLY, '#FFC2B4', 0.75)) + WING(INK),
  }),

  // ─── RARE — regional plumage & material ──────────────────────────────────
  'body-mallard': () => duck(derivePalette('#B9AFA2', { feetBase: '#FF8A3D', beakBase: '#F2C744', beakShadow: '#B08A1C', beakHighlight: '#FFF0A6' }), {
    defs: metal('mallard-head', '#1F8F5F'),
    overlay:
      clipped('mallard-h', DUCK_PATHS.head, `<path d="${DUCK_PATHS.head}" fill="url(#mallard-head)"/>` + tone('M300 70 C340 52 390 60 410 92 C380 76 340 72 300 86 Z', '#8AF0C0', 0.6)) +
      clipped('mallard-t', DUCK_PATHS.torso,
        tone('M220 210 C270 214 330 230 360 260 C380 300 360 330 320 330 C270 330 236 300 220 260 Z', '#8B4A2B') +
        tone('M150 300 C190 284 240 290 270 300 C250 330 200 344 150 330 Z', '#3A63C9') +
        tone('M150 300 C190 284 240 290 270 300 L268 306 C236 298 190 292 152 308 Z', '#FFFFFF', 0.85)) +
      `<path d="M226 222 C260 236 320 242 368 226" fill="none" stroke="#FFFFFF" stroke-width="10" stroke-linecap="round"/>` + WING(INK),
  }),
  'body-pearl': () => duck(derivePalette('#F3EEF7', { bodyShadow: '#C8BEDA', blush: '#FFB3CF', eyeHighlight: '#BDEBFF' }), {
    defs: linear('pearl-sheen', [[0, '#FFD6EC', 0.9], [0.35, '#D6F2FF', 0.5], [0.7, '#E9DCFF', 0.7], [1, '#FFF4D6', 0.4]], 1, 0, 0, 1),
    overlay:
      clipped('pearl-t', DUCK_PATHS.torso, `<path d="${DUCK_PATHS.torso}" fill="url(#pearl-sheen)"/>`) +
      clipped('pearl-h', DUCK_PATHS.head, `<path d="${DUCK_PATHS.head}" fill="url(#pearl-sheen)" opacity="0.8"/>`) +
      tone('M356 64 C384 66 404 82 410 104 C394 92 376 84 356 82 Z', '#FFFFFF', 0.95) + WING('#4B3A66'),
  }),
  'body-ink': () => duck(derivePalette('#2A2638', { bodyShadow: '#141120', bodyHighlight: '#57506E', outline: '#0B0716', beakBase: '#FFC93D', beakShadow: '#C98A0E', beakHighlight: '#FFF0A0', feetBase: '#FFC93D', blush: '#FF6FA0', eyeHighlight: '#FFFFFF' }), {
    overlay:
      clipped('ink-belly', DUCK_PATHS.torso, tone(BELLY, '#F4F1FA')) +
      clipped('ink-cheek', DUCK_PATHS.head, tone('M292 168 C320 152 372 168 384 214 C362 250 296 252 262 228 C256 202 268 180 292 168 Z', '#F4F1FA')) +
      `<path d="M300 62 C350 40 412 56 432 104" fill="none" stroke="#7A6F9E" stroke-width="6" stroke-linecap="round" opacity="0.8"/>` + WING('#0B0716'),
  }),

  // ─── EPIC — full-body gradient + emissive glints ─────────────────────────
  'body-sunset': () => duck(derivePalette('#FF6F7D', { bodyBase: 'url(#sunset)', bodyShadow: '#9D2B6B', bodyHighlight: '#FFE7A1', blush: '#FFFFFF', beakBase: '#FFD84D', beakShadow: '#E59A12', feetBase: '#FFD84D' }), {
    defs: linear('sunset', [[0, '#FFD45A'], [0.45, '#FF7A59'], [0.8, '#E8478B'], [1, '#8E3BB8']], 0.2, 0, 0, 1),
    overlay: `<g>${sparkle(420, 270, 9, '#FFF3C4')}${twinkle(2.6)}</g><g>${sparkle(150, 262, 7, '#FFF3C4')}${twinkle(2.2, 1)}</g>` + WING(INK),
  }),
  'body-chrome': () => duck(derivePalette('#B8C4D6', { bodyBase: 'url(#chrome)', bodyShadow: '#3B4A63', bodyHighlight: '#FFFFFF', outline: '#141B2B', eyeHighlight: '#00F2FE', blush: '#FF2BD6' }), {
    defs: linear('chrome', [[0, '#F8FBFF'], [0.3, '#9AA8BF'], [0.48, '#E6F7FF'], [0.52, '#5C6B86'], [0.75, '#C5D2E6'], [1, '#4A5874']], 0.3, 0, 0, 1) +
      linear('chrome-tint', [[0, '#00F2FE', 0.35], [1, '#FF2BD6', 0.35]], 0, 0, 1, 1) +
      linear('chrome-sweep', [[0, '#FFFFFF', 0], [0.5, '#FFFFFF', 0.9], [1, '#FFFFFF', 0]], 0, 0, 1, 0),
    overlay:
      clipped('chrome-t', DUCK_PATHS.torso, `<path d="${DUCK_PATHS.torso}" fill="url(#chrome-tint)"/><rect x="0" y="180" width="60" height="300" fill="url(#chrome-sweep)" transform="skewX(-24)">${animateTransform('translate', '0 0; 520 0; 520 0', 3.6)}</rect>`) +
      clipped('chrome-h', DUCK_PATHS.head, `<path d="${DUCK_PATHS.head}" fill="url(#chrome-tint)"/>`) + WING('#141B2B'),
  }),

  // ─── LEGENDARY — Golden Duck (Pond Royalty) ──────────────────────────────
  'body-golden': () => duck(derivePalette('#F2B627', { bodyBase: 'url(#gold-body)', bodyShadow: '#8A5A0B', bodyHighlight: '#FFF6C9', outline: '#3A2207', beakBase: '#FF7A1A', beakShadow: '#B5470A', beakHighlight: '#FFC48A', feetBase: '#FF7A1A', blush: '#FF5C7A', eyeHighlight: '#FFF3A6' }), {
    defs: metal('gold-body', '#F2B627') +
      linear('gold-sweep', [[0, '#FFFFFF', 0], [0.5, '#FFFBEA', 0.95], [1, '#FFFFFF', 0]], 0, 0, 1, 0) +
      radial('gold-bloom', [[0, '#FFF3A6', 0.55], [1, '#FFF3A6', 0]]),
    overlay:
      clipped('gold-t', DUCK_PATHS.torso, `<rect x="0" y="180" width="70" height="300" fill="url(#gold-sweep)" transform="skewX(-24)">${animateTransform('translate', '-40 0; 560 0; 560 0', 3.2)}</rect>`) +
      clipped('gold-h', DUCK_PATHS.head, `<rect x="160" y="0" width="56" height="260" fill="url(#gold-sweep)" transform="skewX(-24)">${animateTransform('translate', '-40 0; 340 0; 340 0', 3.2, { begin: '0.4s' })}</rect>`) +
      `<path d="M300 300 C330 290 362 300 376 320" fill="none" stroke="#FFF3A6" stroke-width="6" stroke-linecap="round" opacity="0.8"/>` +
      `<g>${sparkle(416, 252, 12, '#FFFBEA')}${twinkle(2.4)}</g><g>${sparkle(176, 276, 9, '#FFFBEA')}${twinkle(2.8, 0.9)}</g><g>${sparkle(268, 80, 8, '#FFFBEA')}${twinkle(2.2, 1.6)}</g>` + WING('#3A2207'),
  }),
}
