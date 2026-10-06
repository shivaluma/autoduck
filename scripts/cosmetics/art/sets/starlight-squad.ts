import { derivePalette, generateBaseDuckSvg, type DuckPaletteTokens } from '../../../../lib/cosmetics/avatar-rig'
import {
  DETAIL, DUCK_PATHS, INK, MAJOR, MINOR, animate, animateTransform, blink, burst, clipped, cycleStop, dark, defs, dot, glow, group,
  hover, light, line, linear, motes, part, pulse, radial, solid, sparkle, sway, sweepBand, tone, twinkle,
} from '../../kit'
import type { SetArt } from './types'

// Starlight Squad — magical-girl guardian team: pastel pink / sky / lilac with gold, stars, crescents, ribbons.

const PINK = '#F9A8D4'
const SKY = '#7DD3FC'
const LILAC = '#C4B5FD'
const GOLD = '#FCD34D'

/** Five-point star path. */
function starPath(x: number, y: number, r: number, inner = 0.45) {
  return Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const rr = i % 2 ? r * inner : r
    return `${i === 0 ? 'M' : 'L'}${(x + Math.cos(a) * rr).toFixed(1)} ${(y + Math.sin(a) * rr).toFixed(1)}`
  }).join(' ') + ' Z'
}
const star = (x: number, y: number, r: number, fill: string = GOLD, stroke: string = INK, width: number = DETAIL) =>
  `<path d="${starPath(x, y, r)}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round"/>`

function heartPath(cx: number, cy: number, s: number) {
  return `M${cx} ${cy + s * 0.9} C${cx - s * 1.4} ${cy - s * 0.1} ${cx - s * 0.8} ${cy - s * 1.2} ${cx} ${cy - s * 0.45} C${cx + s * 0.8} ${cy - s * 1.2} ${cx + s * 1.4} ${cy - s * 0.1} ${cx} ${cy + s * 0.9} Z`
}

// ─── Outfit plumbing (copied from scripts/cosmetics/art/outfit.ts) ──────────
const NECKLINE = 'M222 236 C250 274 300 292 352 282 C384 276 404 260 414 238'
const SLEEVE = `${DUCK_PATHS.wing} C122 352 120 330 136 316 Z`

function bodyMask(id: string) {
  return `<mask id="${id}" maskUnits="userSpaceOnUse" x="-40" y="-80" width="620" height="640"><rect x="-40" y="-80" width="620" height="640" fill="#000"/><path d="${DUCK_PATHS.torso}" fill="#fff"/><path d="${DUCK_PATHS.torsoShadow}" fill="#fff"/><path d="${DUCK_PATHS.head}" fill="#000" stroke="#000" stroke-width="${MAJOR}"/></mask>`
}

function garment({ id, fill, shadow, highlight, sleeve, inner = '', over = '', extraDefs = '' }: {
  id: string; fill: string; shadow?: string; highlight?: string; sleeve?: string | false; inner?: string; over?: string; extraDefs?: string
}) {
  const base = fill.startsWith('url') ? '#888888' : fill
  return group(id,
    defs(bodyMask(`${id}-m`), extraDefs),
    `<g mask="url(#${id}-m)">`,
    `<path d="${DUCK_PATHS.torso}" fill="${fill}"/>`,
    `<path d="${DUCK_PATHS.torsoShadow}" fill="${fill}"/>`,
    tone(DUCK_PATHS.torsoShadow, shadow ?? dark(base), 0.75),
    tone('M300 236 C360 240 404 270 410 312 C390 280 352 258 300 252 Z', highlight ?? light(base), 0.7),
    inner,
    `<path d="${DUCK_PATHS.torso}" fill="none" stroke="${INK}" stroke-width="${MAJOR}"/>`,
    line(NECKLINE, INK, MINOR),
    '</g>',
    sleeve === false ? '' : part(SLEEVE, sleeve ?? fill),
    over,
  )
}

const clearFace = (id: string, content: string) =>
  `<defs><mask id="${id}" maskUnits="userSpaceOnUse" x="-40" y="-80" width="620" height="640"><rect x="-40" y="-80" width="620" height="640" fill="#fff"/><path d="${DUCK_PATHS.head}" fill="#000" stroke="#000" stroke-width="${MAJOR}"/><path d="${DUCK_PATHS.beak}" fill="#000" stroke="#000" stroke-width="${MAJOR + 6}"/></mask></defs><g mask="url(#${id})">${content}</g>`

// ─── Pet plumbing (from pet.ts) ─────────────────────────────────────────────
const place = (id: string, content: string, options: { shadow?: number; float?: boolean } = {}) => group(id,
  `<ellipse cx="446" cy="436" rx="${(options.shadow ?? 44) * 1.2}" ry="9" fill="#100A20" opacity="${options.float ? 0.16 : 0.26}"/>`,
  `<g transform="translate(446 436) scale(1.2)">${content}</g>`,
)

// ─── Body colour ────────────────────────────────────────────────────────────
function duck(palette: DuckPaletteTokens, options: { overlay?: string; defs?: string } = {}) {
  return generateBaseDuckSvg(palette, options)
}

const WING = `<path d="${DUCK_PATHS.wing}" fill="none" stroke="${INK}" stroke-width="${MINOR}" stroke-linecap="round" stroke-linejoin="round"/>`

export const STARLIGHT_SQUAD_ART: SetArt = {
  bodyColor: {
    // Rare: one soft pink, with a pastel colour-shifting sheen and twinkling star freckles.
    'body-starlight-pastel': () => duck(derivePalette(PINK, { blush: '#FF5FA2', eyeHighlight: '#E0F2FE', beakBase: '#FFC24D', beakShadow: '#D98A16', beakHighlight: '#FFE7A6', feetBase: '#FFC24D' }), {
      defs: `<linearGradient id="sls-body-sheen" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${SKY}" stop-opacity="0.55">${cycleStop([SKY, LILAC, '#FFF3C4'], 4)}</stop><stop offset="0.6" stop-color="${PINK}" stop-opacity="0"/></linearGradient>`,
      overlay:
        clipped('sls-body-t', DUCK_PATHS.torso, `<path d="${DUCK_PATHS.torso}" fill="url(#sls-body-sheen)"/>` + sweepBand('sls-body-sweep', 0, 180, 50, 300, 520, 3.4, 0, 0.5)) +
        clipped('sls-body-h', DUCK_PATHS.head, `<path d="${DUCK_PATHS.head}" fill="url(#sls-body-sheen)"/>`) +
        `<g>${sparkle(170, 300, 7, '#FFFBEA')}${twinkle(2.2)}</g><g>${sparkle(380, 340, 6, '#FFFBEA')}${twinkle(2.6, 1)}</g>` + WING,
    }),
  },

  face: {
    // Rare: star-shaped highlights in the pupils, glittery lashes and a heart blush.
    'face-starlight-twinkle': () => group('sls-face',
      defs(glow('sls-face-glow', 2)),
      line('M286 92 C300 84 316 84 330 92 M296 86 l-6 -8 M310 84 l0 -9 M324 86 l6 -8', INK, 5),
      line('M360 104 C372 96 388 98 398 106 M368 98 l-4 -8 M384 96 l2 -9', INK, 4),
      `<g filter="url(#sls-face-glow)">` +
        pulse(330, 148, 1.2, 1.4, star(330, 148, 17, GOLD, INK, 3.5)) +
        pulse(390, 154, 1.2, 1.4, star(390, 154, 13, GOLD, INK, 3), 0.3) + `</g>`,
      `<path d="${heartPath(266, 198, 10)}" fill="#FF7AB6" opacity="0.8"/>`,
      `<path d="${heartPath(250, 182, 6)}" fill="#FF7AB6" opacity="0.6"/>`,
      burst(276, 110, 8, 2.2, 0.4, '#FFFBEA'),
    ),
  },

  head: {
    // Epic: gold crescent tiara with a heart gem, two pastel ribbons streaming behind, orbiting star.
    'head-starlight-tiara': () => group('sls-tiara',
      defs(linear('sls-tiara-gold', [[0, '#FFFBEA'], [0.45, '#FDE68A'], [1, '#E0A21B']], 1, 0, 0, 1), glow('sls-tiara-glow', 4)),
      // ribbons (behind band)
      sway(244, 92, 8, 2.4, part('M246 88 C218 84 196 98 182 122 C200 118 214 116 228 120 C222 108 230 98 246 100 Z', PINK, { strokeWidth: 5 }) + tone('M232 96 C214 98 200 108 190 118 C204 114 216 112 226 114 Z', '#FBCFE8', 0.9)),
      sway(244, 96, 10, 2.8, part('M244 98 C222 106 206 126 200 152 C214 140 228 134 240 134 C234 122 238 108 250 104 Z', SKY, { strokeWidth: 5 }), 0.6),
      // band
      part('M234 106 C286 82 380 76 444 100 L442 80 C380 60 286 66 236 86 Z', 'url(#sls-tiara-gold)', { strokeWidth: 6 }),
      // crescent centrepiece
      `<g transform="translate(346 64) scale(1.45) translate(-346 -64)">` + part('M340 80 C306 74 288 44 300 10 C308 32 326 44 350 46 C368 46 382 38 392 26 C390 60 368 84 340 80 Z', 'url(#sls-tiara-gold)', { strokeWidth: 6 }),
      tone('M314 30 C318 44 330 54 348 56 C332 58 318 48 314 30 Z', '#FFFBEA', 0.8) +
      `<g filter="url(#sls-tiara-glow)">${pulse(346, 64, 1.2, 1.6, `<path d="${heartPath(346, 64, 9)}" fill="#FF5FA2" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>`)}</g></g>`,
      dot(276, 92, 5, SKY, { stroke: INK, strokeWidth: 3 }), dot(410, 88, 5, LILAC, { stroke: INK, strokeWidth: 3 }),
      clipped('sls-tiara-c', 'M234 104 C286 82 380 76 444 98 L442 84 C380 64 286 70 236 90 Z', sweepBand('sls-tiara-sweep', 180, 40, 30, 80, 300, 2.4, 0, 0.9)),
      `<g filter="url(#sls-tiara-glow)">${[0, 1.3].map((d) => `<g>${star(0, 0, 8, '#FFFBEA', INK, 2.5)}<animateMotion dur="2.6s" begin="${-d}s" repeatCount="indefinite" path="M340 40 m-110 0 a110 30 0 1 0 220 0 a110 30 0 1 0 -220 0"/></g>`).join('')}</g>`,
      burst(392, 22, 9, 2.4, 0.8), burst(286, 30, 7, 2.4, 1.6),
    ),
  },

  outfit: {
    // Legendary: sailor-collar captain uniform, crest brooch, pleated pastel skirt hem, star-tipped wand and a cape of sparkles.
    'outfit-starlight-captain': () => clearFace('sls-outfit-clear', garment({
      id: 'sls-captain', fill: 'url(#sls-captain-cloth)', shadow: '#8B5CF6', highlight: '#F5F3FF', sleeve: '#E0E7FF',
      extraDefs: linear('sls-captain-cloth', [[0, '#E0F2FE'], [0.5, LILAC], [1, '#A78BFA']], 0, 0, 0, 1) +
        `<linearGradient id="sls-captain-hem" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${PINK}">${cycleStop([PINK, SKY, LILAC], 3)}</stop><stop offset="1" stop-color="${SKY}">${cycleStop([SKY, LILAC, PINK], 3)}</stop></linearGradient>` +
        glow('sls-captain-glow', 4) + radial('sls-captain-gem', [[0, '#FFFFFF'], [0.5, '#F9A8D4'], [1, '#DB2777']], 0.35, 0.35, 0.7),
      inner:
        // pleated skirt hem (colour-cycling)
        `<path d="M70 372 L96 420 L122 372 L148 420 L174 372 L200 420 L226 372 L252 420 L278 372 L304 420 L330 372 L356 420 L382 372 L408 420 L420 372 V440 H70 Z" fill="url(#sls-captain-hem)" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>` +
        line('M70 372 H420', '#FFFFFF', 4, { opacity: 0.8 }) +
        sweepBand('sls-captain-sweep', -30, 220, 50, 220, 560, 2.8, 0, 0.6) +
        [[150, 320], [220, 300], [270, 350], [380, 330]].map(([x, y], i) => `<g>${star(x!, y!, 6, GOLD, INK, 2)}${twinkle(1.6 + i * 0.3, i * 0.4)}</g>`).join(''),
      over:
        // big magical-girl back bow
        sway(110, 290, 6, 2.6,
          solid('M110 290 C76 250 40 262 46 292 C52 318 86 314 110 298 Z', '#FF5FA2', { strokeWidth: MINOR }) +
          solid('M110 296 C84 318 66 352 86 366 C104 360 112 330 116 304 Z', '#FF7AB6', { strokeWidth: MINOR }) +
          tone('M100 286 C80 270 60 270 56 286 C70 280 86 282 100 292 Z', '#FBCFE8', 0.9) +
          `<circle cx="112" cy="294" r="11" fill="#FF5FA2" stroke="${INK}" stroke-width="${MINOR}"/>`) +
        // star epaulette
        `<g filter="url(#sls-captain-glow)">${pulse(250, 300, 1.15, 1.8, star(250, 300, 16, GOLD, INK, 4))}</g>` +
        // sailor collar
        solid('M226 240 C250 280 300 298 350 290 C384 284 404 268 416 240 L424 262 C404 300 370 318 334 320 L322 304 L306 322 C266 316 236 294 220 262 Z', SKY, { strokeWidth: MINOR }) +
        line('M232 262 C256 292 296 306 334 304', '#FFFFFF', 4) +
        // ribbon bow
        solid('M312 300 c-24 -16 -40 -6 -36 10 c4 14 24 12 36 0 c12 12 32 14 36 0 c4 -16 -12 -26 -36 -10 Z', '#FF5FA2', { strokeWidth: 4 }) +
        sway(312, 312, 8, 2, line('M304 314 L288 352 M320 314 L334 354', '#FF5FA2', 8) + line('M304 314 L288 352 M320 314 L334 354', INK, 2, { opacity: 0.4 })) +
        // crest brooch with pulsing gem
        `<g filter="url(#sls-captain-glow)">${pulse(312, 306, 1.18, 1.4, `<circle cx="312" cy="306" r="10" fill="url(#sls-captain-gem)" stroke="${INK}" stroke-width="3.5"/>` + sparkle(309, 302, 4, '#FFFFFF'))}</g>` +
        // star wand in the wing hand
        sway(150, 346, 10, 2.2,
          line('M150 370 L220 270', INK, 13) + line('M150 370 L220 270', '#FFFFFF', 6) +
          line('M162 344 L170 334 M176 326 L184 316', LILAC, 5) +
          `<g filter="url(#sls-captain-glow)">${pulse(226, 262, 1.15, 1.2, star(226, 262, 28, GOLD, INK, 4.5) + star(226, 262, 12, '#FFFBEA', 'none', 0))}</g>` +
          `<path d="M206 286 C190 292 178 286 172 276" fill="none" stroke="${PINK}" stroke-width="5" stroke-linecap="round">${animate('d', 'M206 286 C190 292 178 286 172 276;M206 286 C194 300 178 300 168 292;M206 286 C190 292 178 286 172 276', 1.6)}</path>`) +
        `<g filter="url(#sls-captain-glow)">${motes({ count: 10, x: 180, y: 220, width: 80, height: 80, rise: 70, colors: ['#FFFBEA', GOLD, PINK], size: [2, 4], seconds: 2.2, seed: 301, shape: 'sparkle' })}</g>` +
        burst(400, 300, 10, 2.2, 0.3) + burst(130, 300, 8, 2.2, 1.1) + burst(260, 400, 7, 2.2, 1.7),
    })),
  },

  pet: {
    // Epic: a round mochi-like star sprite floating on a crescent, wings flapping, trailing sparkles.
    'pet-starlight-mochi': () => place('sls-mochi',
      defs(radial('sls-mochi-body', [[0, '#FFFFFF'], [0.6, '#FDE7F3'], [1, PINK]], 0.4, 0.35, 0.75), glow('sls-mochi-glow', 4),
        linear('sls-mochi-moon', [[0, '#FFF3C4'], [1, '#E0A21B']], 1, 0, 0, 1)) +
      `<g>${animateTransform('translate', '0 0;0 -12;0 0', 2.6)}` +
        solid('M-46 -30 C-36 6 34 12 54 -22 C30 -2 -20 -6 -40 -40 Z', 'url(#sls-mochi-moon)', { strokeWidth: MINOR }) +
        sway(-30, -80, 22, 0.5, part('M-30 -80 C-56 -104 -66 -76 -50 -66 C-42 -60 -36 -66 -30 -72 Z', '#E0F2FE', { strokeWidth: 4 })) +
        sway(30, -80, 22, 0.5, part('M30 -80 C56 -104 66 -76 50 -66 C42 -60 36 -66 30 -72 Z', '#E0F2FE', { strokeWidth: 4 }), 0.25) +
        part(starPath(0, -78, 44, 0.62), 'url(#sls-mochi-body)', { strokeWidth: MINOR }) +
        blink(-12, -80, 3.4, dot(-12, -80, 5, INK) + dot(-10, -82, 1.8, '#FFFFFF')) +
        blink(12, -80, 3.4, dot(12, -80, 5, INK) + dot(14, -82, 1.8, '#FFFFFF')) +
        line('M-4 -68 q4 4 8 0', INK, 3) +
        tone('M-26 -70 a6 4 0 1 0 12 0 a6 4 0 1 0 -12 0 Z M14 -70 a6 4 0 1 0 12 0 a6 4 0 1 0 -12 0 Z', '#FF7AB6', 0.7) +
        `<g filter="url(#sls-mochi-glow)">${pulse(0, -122, 1.3, 1.2, star(0, -122, 7, GOLD, INK, 2.5))}</g>` +
      `</g>` +
      `<g filter="url(#sls-mochi-glow)">${motes({ count: 7, x: -50, y: -40, width: 100, height: 30, rise: -40, colors: ['#FFFBEA', SKY, PINK], size: [2, 3.5], seconds: 2, seed: 311, shape: 'sparkle' })}</g>` +
      burst(-56, -110, 7, 2.2) + burst(60, -120, 6, 2.2, 1.1),
      { shadow: 36, float: true }),
  },

  aura: {
    // Epic: a slowly turning ring of pastel stars + crescent moon, with falling star motes.
    'aura-starlight-halo': () => group('sls-halo',
      defs(radial('sls-halo-fade', [[0, '#FDE7F3', 0], [0.62, '#FDE7F3', 0], [0.82, LILAC, 0.35], [1, SKY, 0]]), glow('sls-halo-glow', 5)),
      `<ellipse cx="256" cy="250" rx="268" ry="248" fill="url(#sls-halo-fade)">${animate('opacity', '0.6;1;0.6', 3)}</ellipse>`,
      `<ellipse cx="256" cy="250" rx="232" ry="214" fill="none" stroke="${LILAC}" stroke-width="6" stroke-dasharray="4 18" stroke-linecap="round" opacity="0.8"/>` +
      `<g filter="url(#sls-halo-glow)"><g>${animateTransform('rotate', '0 256 250;360 256 250', 24, { calcMode: 'linear' })}` +
        Array.from({ length: 10 }, (_, i) => {
          const a = (i / 10) * Math.PI * 2
          const x = 256 + Math.cos(a) * 232
          const y = 250 + Math.sin(a) * 214
          const fill = [PINK, SKY, GOLD, LILAC][i % 4]!
          return `<g>${star(x, y, i % 2 ? 20 : 28, fill, INK, 4)}${animate('opacity', '0.55;1;0.55', 1.6 + (i % 3) * 0.4, { begin: `${i * 0.2}s` })}</g>`
        }).join('') + `</g></g>`,
      hover(10, 3.2, solid('M436 56 C410 52 392 30 398 4 C404 22 420 32 440 32 C452 32 462 28 470 20 C466 42 456 58 436 56 Z', GOLD, { strokeWidth: MINOR }) + sparkle(420, 40, 5, '#FFFBEA')),
      `<g filter="url(#sls-halo-glow)">${motes({ count: 10, x: 0, y: -40, width: 520, height: 120, rise: -260, colors: ['#FFFBEA', PINK, SKY], size: [2.5, 4.5], seconds: 3.4, seed: 321, shape: 'sparkle', drift: 30 })}</g>`,
    ),
  },

  trail: {
    // Rare: two pastel ribbons streaming from the tail with stars bobbing along.
    'trail-starlight-ribbon': () => `<g transform="translate(84 430) scale(1.35) translate(-84 -430)">` + group('sls-ribbon',
      defs(glow('sls-ribbon-glow', 3)),
      `<path d="M96 340 C60 320 30 360 -20 336" fill="none" stroke="${INK}" stroke-width="16" stroke-linecap="round">${animate('d', 'M96 340 C60 320 30 360 -20 336;M96 340 C60 360 30 320 -20 346;M96 340 C60 320 30 360 -20 336', 1.8)}</path>`,
      `<path d="M96 340 C60 320 30 360 -20 336" fill="none" stroke="${PINK}" stroke-width="9" stroke-linecap="round">${animate('d', 'M96 340 C60 320 30 360 -20 336;M96 340 C60 360 30 320 -20 346;M96 340 C60 320 30 360 -20 336', 1.8)}</path>`,
      `<path d="M96 356 C60 376 30 340 -16 366" fill="none" stroke="${INK}" stroke-width="14" stroke-linecap="round">${animate('d', 'M96 356 C60 376 30 340 -16 366;M96 356 C60 340 30 380 -16 360;M96 356 C60 376 30 340 -16 366', 2.1)}</path>`,
      `<path d="M96 356 C60 376 30 340 -16 366" fill="none" stroke="${SKY}" stroke-width="7" stroke-linecap="round">${animate('d', 'M96 356 C60 376 30 340 -16 366;M96 356 C60 340 30 380 -16 360;M96 356 C60 376 30 340 -16 366', 2.1)}</path>`,
      `<g filter="url(#sls-ribbon-glow)">` + [[40, 330, 0], [6, 352, 0.6], [70, 372, 1.2]].map(([x, y, d]) => hover(8, 1.8, star(x!, y!, 8, GOLD, INK, 2.5), d)).join('') + `</g>`,
      motes({ count: 5, x: -20, y: 320, width: 110, height: 60, rise: 30, colors: ['#FFFBEA', LILAC], size: [2, 3.5], seconds: 1.6, seed: 331, shape: 'sparkle', drift: -30 }),
    ) + `</g>`,
  },
}

