import { DUCK_PATHS, derivePalette, generateBaseDuckSvg } from '../../../../lib/cosmetics/avatar-rig'
import {
  DETAIL, INK, MAJOR, MINOR, animate, animateTransform, blink, burst, clipped, cycleStop, dark, defs, dot, glow, group,
  line, linear, livingGradient, metal, motes, part, pulse, radial, solid, sparkle, sway, sweepBand, tone, twinkle,
} from '../../kit'
import type { SetArt } from './types'

// Idol Pop — stage fashion: deep purple, gold, hot pink, holographic fabric, spotlights and confetti.

const PURPLE = '#7C3AED'
const PINK = '#FF3E9E'
const GOLD = '#FFD84D'

// ─── shared helpers (copied from per-slot art so this set is self-contained) ───
const WING = `<path d="${DUCK_PATHS.wing}" fill="none" stroke="${INK}" stroke-width="${MINOR}" stroke-linecap="round" stroke-linejoin="round"/>`
const NECKLINE = 'M222 236 C250 274 300 292 352 282 C384 276 404 260 414 238'
const SLEEVE = `${DUCK_PATHS.wing} C122 352 120 330 136 316 Z`

function bodyMask(id: string) {
  return `<mask id="${id}" maskUnits="userSpaceOnUse" x="-40" y="-80" width="620" height="640"><rect x="-40" y="-80" width="620" height="640" fill="#000"/><path d="${DUCK_PATHS.torso}" fill="#fff"/><path d="${DUCK_PATHS.torsoShadow}" fill="#fff"/><path d="${DUCK_PATHS.head}" fill="#000" stroke="#000" stroke-width="${MAJOR}"/></mask>`
}

const FACE_CLEAR = `<mask id="idl-face-clear" maskUnits="userSpaceOnUse" x="-40" y="-80" width="620" height="640"><rect x="-40" y="-80" width="620" height="640" fill="#fff"/><path d="${DUCK_PATHS.head}" fill="#000" stroke="#000" stroke-width="${MAJOR}"/><path d="${DUCK_PATHS.beak}" fill="#000" stroke="#000" stroke-width="${MAJOR + 6}"/></mask>`

/** Pets: origin = ground contact at PET_RIGHT, 1.2× like the core pets. */
const place = (id: string, content: string, options: { shadow?: number; float?: boolean } = {}) => group(id,
  `<ellipse cx="446" cy="436" rx="${(options.shadow ?? 44) * 1.2}" ry="9" fill="#100A20" opacity="${options.float ? 0.16 : 0.26}"/>`,
  `<g transform="translate(446 436) scale(1.2)">${content}</g>`,
)

const star5 = (x: number, y: number, r: number, fill: string, stroke = INK, width = 4) => {
  const pts = Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const rr = i % 2 ? r * 0.48 : r
    return `${(x + Math.cos(a) * rr).toFixed(1)},${(y + Math.sin(a) * rr).toFixed(1)}`
  }).join(' ')
  return `<polygon points="${pts}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round"/>`
}

const heart = (cx: number, cy: number, s: number, fill: string) =>
  `<path d="M${cx} ${cy + s * 0.9} C${cx - s * 1.4} ${cy - s * 0.1} ${cx - s * 0.8} ${cy - s * 1.2} ${cx} ${cy - s * 0.45} C${cx + s * 0.8} ${cy - s * 1.2} ${cx + s * 1.4} ${cy - s * 0.1} ${cx} ${cy + s * 0.9} Z" fill="${fill}" stroke="${INK}" stroke-width="${DETAIL}" stroke-linejoin="round"/>`

export const IDOL_POP_ART: SetArt = {
  // ─── Màu · rare — amethyst with a holographic stage-light sheen ─────────────
  bodyColor: {
    'body-idol-amethyst': () => generateBaseDuckSvg(derivePalette(PURPLE, { blush: '#FF8AD8', eyeHighlight: '#F5D0FE', beakBase: '#FFC24D', beakShadow: '#D98A16', beakHighlight: '#FFE7A6', feetBase: '#FFC24D' }), {
      defs: `<linearGradient id="idl-amy-sheen" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F0ABFC" stop-opacity="0.6">${cycleStop(['#F0ABFC', '#FDE68A', '#67E8F9'], 4)}</stop><stop offset="0.6" stop-color="${PURPLE}" stop-opacity="0"/></linearGradient>`,
      overlay:
        clipped('idl-amy-t', DUCK_PATHS.torso, `<path d="${DUCK_PATHS.torso}" fill="url(#idl-amy-sheen)"/>` + sweepBand('idl-amy-sweep', 0, 180, 50, 300, 520, 3.2, 0, 0.55)) +
        clipped('idl-amy-h', DUCK_PATHS.head, `<path d="${DUCK_PATHS.head}" fill="url(#idl-amy-sheen)"/>`) +
        burst(410, 270, 9, 2.6, 0.4) + burst(160, 300, 7, 2.6, 1.6) + WING,
    }),
  },

  // ─── Mặt · rare — star-shaped pop-star shades ───────────────────────────────
  face: {
    'face-idol-star-shades': () => group('idl-shades',
      defs(linear('idl-lens', [[0, '#FF8AD8'], [0.55, PINK], [1, '#7C3AED']], 0, 0, 0, 1), metal('idl-frame', GOLD)),
      line('M276 124 C248 120 230 128 218 144', INK, 8), line('M276 124 C248 120 230 128 218 144', GOLD, 3),
      star5(320, 142, 44, 'url(#idl-lens)', INK, MINOR + 2),
      star5(388, 148, 33, 'url(#idl-lens)', INK, MINOR + 2),
      line('M356 130 C364 124 370 124 374 132', INK, 9), line('M356 130 C364 124 370 124 374 132', 'url(#idl-frame)', 4),
      clipped('idl-lens-glint', `M276 98 H434 V192 H276 Z`, sweepBand('idl-shade-sweep', 230, 96, 22, 100, 240, 2.4, 0, 0.75)),
      tone('M306 116 l10 -6 l4 8 l-10 6 Z M378 128 l7 -4 l3 6 l-7 4 Z', '#FFFFFF', 0.85),
      `<g>${sparkle(438, 108, 9, '#FFFBEA')}${twinkle(1.6)}</g>`,
      `<g>${sparkle(284, 98, 7, '#FFFBEA')}${twinkle(1.6, 0.8)}</g>`,
    ),
  },

  // ─── Trail · rare — confetti ribbons tumbling off the tail ─────────────────
  trail: {
    'trail-idol-confetti': () => `<g transform="translate(84 430) scale(1.35) translate(-84 -430)">${group('idl-confetti',
      ...[['M100 420 C70 410 30 428 -10 414', PINK, 8, 0], ['M100 400 C66 392 36 404 -4 392', GOLD, 7, 0.3], ['M96 380 C70 372 44 384 14 372', '#67E8F9', 6, 0.6]].map(([d, c, w, b]) =>
        `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-dasharray="40 12">${animate('stroke-dashoffset', '0;52', 0.9, { begin: `${b}s`, calcMode: 'linear', keySplines: undefined })}</path>`),
      [[60, 410, PINK, 0], [30, 396, GOLD, 0.4], [80, 388, '#67E8F9', 0.8], [10, 420, '#A855F7', 1.2], [44, 372, '#FF8AD8', 0.6]].map(([x, y, c, d]) =>
        `<g><rect x="${x}" y="${y}" width="10" height="6" rx="1.5" fill="${c}" stroke="${INK}" stroke-width="2">${animateTransform('rotate', `0 ${Number(x) + 5} ${Number(y) + 3};180 ${Number(x) + 5} ${Number(y) + 3};360 ${Number(x) + 5} ${Number(y) + 3}`, 1.6, { begin: `${d}s`, calcMode: 'linear' })}</rect>${animateTransform('translate', '0 -6;-18 10;0 -6', 2.2, { begin: `${d}s` })}</g>`).join(''),
      `<g>${star5(-4, 402, 7, GOLD, INK, 2.5)}${twinkle(1.4)}</g>`,
    )}</g>`,
  },

  // ─── Nón · epic — glossy idol headset with a star tiara ─────────────────────
  head: {
    'head-idol-headset': () => group('idl-headset',
      defs(metal('idl-chrome', '#C4B5FD'), glow('idl-hs-glow', 4), radial('idl-cup', [[0, '#FF8AD8'], [1, '#7C3AED']], 0.4, 0.35, 0.7)),
      // band over the skull
      line('M238 128 C228 66 280 30 344 28 C404 26 440 58 442 100', INK, 22),
      line('M238 128 C228 66 280 30 344 28 C404 26 440 58 442 100', 'url(#idl-chrome)', 12),
      `<path d="M262 70 C292 44 332 36 368 36" fill="none" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round" stroke-dasharray="20 120">${animate('stroke-dashoffset', '140;0', 2.4, { calcMode: 'linear', keySplines: undefined })}</path>`,
      // star tiara on top
      `<g filter="url(#idl-hs-glow)">${pulse(346, 18, 1.12, 1.6, star5(346, 18, 22, GOLD, INK, 5) + tone('M346 4 l5 10 l-8 2 Z', '#FFF7CC', 0.9))}</g>`,
      `<g>${sparkle(316, 24, 7, '#FFFBEA')}${twinkle(1.8)}</g><g>${sparkle(378, 22, 6, '#FFFBEA')}${twinkle(1.8, 0.9)}</g>`,
      // ear cup with a glowing ring light
      solid('M216 116 C216 98 232 90 250 94 L258 162 C240 170 220 160 218 144 Z', 'url(#idl-cup)'),
      `<ellipse cx="237" cy="129" rx="9" ry="16" fill="none" stroke="#FDE68A" stroke-width="4" filter="url(#idl-hs-glow)">${animate('stroke', `#FDE68A;${PINK};#67E8F9;#FDE68A`, 2.4)}</ellipse>`,
      // mic boom ends under the cheek, left of the beak root
      line('M242 160 C248 200 270 222 298 230', INK, 9),
      line('M242 160 C248 200 270 222 298 230', 'url(#idl-chrome)', 5),
      `<g>${part('M292 220 C306 216 318 224 316 236 C312 246 296 246 290 238 Z', '#1E1B2E')}<circle cx="304" cy="231" r="4" fill="${PINK}">${animate('opacity', '1;0.3;1', 0.9)}</circle></g>`,
    ),
  },

  // ─── Pet · epic — a living lightstick fan ───────────────────────────────────
  pet: {
    'pet-idol-lightstick': () => place('idl-stick', `<g transform="translate(34 0) scale(1.08)">` +
      defs(radial('idl-orb', [[0, '#FFFFFF'], [0.45, '#FFC2E6'], [1, PINK]], 0.4, 0.35, 0.7), glow('idl-stick-glow', 7), metal('idl-handle', '#C4B5FD')) +
      `<g>${animateTransform('translate', '0 0;0 -10;0 0', 2.2)}${animateTransform('rotate', '-6 0 -40;6 0 -40;-6 0 -40', 1.8)}` +
        solid('M-8 -10 h16 l-2 -56 h-12 Z', 'url(#idl-handle)', { strokeWidth: MINOR }) +
        part('M-10 -66 h20 v10 h-20 Z', '#1E1B2E', { strokeWidth: 4 }) + dot(0, -30, 3, '#FDE68A') +
        `<g filter="url(#idl-stick-glow)"><circle cx="0" cy="-102" r="40" fill="url(#idl-orb)" stroke="${INK}" stroke-width="${MINOR}">${animate('r', '38;42;38', 1.2)}</circle></g>` +
        `<circle cx="0" cy="-102" r="48" fill="none" stroke="${PINK}" stroke-width="3">${animate('r', '42;64', 1.2, { calcMode: 'linear', keySplines: undefined })}${animate('opacity', '0.8;0', 1.2, { calcMode: 'linear', keySplines: undefined })}</circle>` +
        blink(-12, -106, 3.4, dot(-12, -106, 5, INK) + dot(-10, -108, 1.8, '#FFFFFF')) + blink(12, -106, 3.4, dot(12, -106, 5, INK) + dot(14, -108, 1.8, '#FFFFFF')) +
        line('M-6 -92 q6 6 12 0', INK, 3) + tone('M-20 -98 a5 3 0 1 0 10 0 a5 3 0 1 0 -10 0 Z M10 -98 a5 3 0 1 0 10 0 a5 3 0 1 0 -10 0 Z', '#FF8AD8', 0.7) +
        tone('M-24 -122 C-14 -134 4 -136 14 -130 C0 -128 -12 -124 -24 -122 Z', '#FFFFFF', 0.9) +
      `</g>` +
      `<g>${heart(-44, -120, 8, PINK)}${animateTransform('translate', '0 6;0 -14;0 6', 2.4)}${animate('opacity', '0;1;0', 2.4)}</g>` +
      `<g>${heart(46, -84, 6, '#FF8AD8')}${animateTransform('translate', '0 6;0 -14;0 6', 2.4, { begin: '1.2s' })}${animate('opacity', '0;1;0', 2.4, { begin: '1.2s' })}</g>` +
      `</g>`, { shadow: 34, float: true }),
  },

  // ─── Aura · epic — swinging stage spotlights ───────────────────────────────
  aura: {
    'aura-idol-spotlights': () => group('idl-spot',
      defs(
        linear('idl-beam-l', [[0, '#FDE68A', 0.75], [1, '#FDE68A', 0]], 0, 0, 0, 1),
        linear('idl-beam-r', [[0, '#FF8AD8', 0.7], [1, '#FF8AD8', 0]], 0, 0, 0, 1),
        radial('idl-floor', [[0, '#F0ABFC', 0.55], [1, '#F0ABFC', 0]]),
        glow('idl-spot-glow', 5),
      ),
      `<ellipse cx="256" cy="436" rx="220" ry="40" fill="url(#idl-floor)">${animate('opacity', '0.5;1;0.5', 2)}</ellipse>`,
      sway(60, -30, 14, 3.2, `<path d="M48 -30 L72 -30 L240 440 L-90 440 Z" fill="url(#idl-beam-l)"/>`),
      sway(452, -30, 14, 3.2, `<path d="M440 -30 L464 -30 L600 440 L270 440 Z" fill="url(#idl-beam-r)"/>`, 1.6),
      // light rigs
      `<g filter="url(#idl-spot-glow)">${part('M36 -46 h48 v22 h-48 Z', '#1E1B2E')}${dot(60, -24, 9, '#FDE68A')}${part('M428 -46 h48 v22 h-48 Z', '#1E1B2E')}${dot(452, -24, 9, '#FF8AD8')}</g>`,
      motes({ count: 10, x: 0, y: 280, width: 512, height: 160, rise: 180, colors: [GOLD, PINK, '#67E8F9', '#FFFFFF'], size: [2.5, 5], seconds: 3, seed: 501, shape: 'sparkle' }),
      `<g>${star5(36, 300, 12, GOLD, INK, 3)}${twinkle(1.8)}</g><g>${star5(486, 250, 10, PINK, INK, 3)}${twinkle(1.8, 0.9)}</g>`,
    ),
  },

  // ─── Áo · legendary — holographic stagewear with a glittering tailcoat ─────
  outfit: {
    'outfit-idol-holo-stagewear': () => {
      const holo = livingGradient('idl-holo', [['#F0ABFC', '#67E8F9', '#FDE68A', '#F0ABFC'], ['#A855F7', '#EC4899', '#6366F1', '#A855F7'], ['#4C1D95', '#831843', '#1E3A8A', '#4C1D95']], 4, 1, 0, 0, 1)
      const inner =
        // gold chain sash + rhinestone stars
        line('M240 262 C280 320 330 360 400 372', GOLD, 8) + line('M240 262 C280 320 330 360 400 372', '#B7791F', 3, { strokeDasharray: '4 6' }) +
        [[268, 300], [304, 336], [346, 360]].map(([x, y], i) => `<g>${star5(x!, y!, 9, '#FFFBEA', INK, 2.5)}${twinkle(1.4, i * 0.4)}</g>`).join('') +
        sweepBand('idl-holo-sweep', -40, 200, 70, 260, 580, 2.2, 0, 0.75) +
        motes({ count: 8, x: 110, y: 300, width: 300, height: 110, rise: 80, colors: ['#FFFFFF', GOLD, '#F0ABFC'], size: [2, 4], seconds: 2.4, seed: 503, shape: 'sparkle' })
      const outfit = group('idl-stagewear',
        defs(bodyMask('idl-sw-m'), holo, metal('idl-gold', GOLD), glow('idl-sw-glow', 4)),
        // glittering tailcoat flaps swaying behind the tail (unique silhouette)
        sway(110, 360, 6, 2.6,
          solid('M118 350 C88 372 60 410 40 452 C70 446 96 430 112 410 C106 440 110 462 124 476 C140 448 150 410 146 372 Z', 'url(#idl-holo)') +
          line('M62 436 C80 420 96 400 108 380 M118 452 C126 424 132 400 132 380', '#FFFFFF', 3, { opacity: 0.7 })),
        `<g mask="url(#idl-sw-m)">`,
        `<path d="${DUCK_PATHS.torso}" fill="url(#idl-holo)"/><path d="${DUCK_PATHS.torsoShadow}" fill="url(#idl-holo)"/>`,
        tone(DUCK_PATHS.torsoShadow, dark('#6D28D9'), 0.55),
        tone('M300 236 C360 240 404 270 410 312 C390 280 352 258 300 252 Z', '#FFFFFF', 0.45),
        inner,
        `<path d="${DUCK_PATHS.torso}" fill="none" stroke="${INK}" stroke-width="${MAJOR}"/>`,
        line(NECKLINE, INK, MINOR),
        '</g>',
        // high gold collar + sleeve
        part('M226 244 C254 284 306 300 354 292 C386 286 408 270 418 246 L420 226 C404 262 370 280 338 282 C288 286 248 264 230 226 Z', 'url(#idl-gold)'),
        part(SLEEVE, 'url(#idl-holo)'),
        // shoulder epaulette with fringe
        `<g filter="url(#idl-sw-glow)">${solid('M150 296 C172 276 214 274 238 292 C220 304 176 308 150 296 Z', 'url(#idl-gold)', { strokeWidth: MINOR })}</g>`,
        sway(194, 300, 8, 1.4, line('M164 300 v18 M178 302 v20 M192 303 v22 M206 302 v20 M220 300 v18', GOLD, 4)),
        // mic brooch
        pulse(380, 318, 1.15, 1.2, `${dot(380, 318, 11, PINK, { stroke: INK, strokeWidth: DETAIL })}${sparkle(380, 318, 6, '#FFFFFF')}`),
        burst(410, 290, 10, 2.2, 0.3), burst(200, 340, 8, 2.2, 1.1),
      )
      return `<defs>${FACE_CLEAR}</defs><g mask="url(#idl-face-clear)">${outfit}</g>`
    },
  },
}

