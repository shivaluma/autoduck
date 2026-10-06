import { DUCK_PATHS, derivePalette, generateBaseDuckSvg } from '../../../../lib/cosmetics/avatar-rig'
import {
  DETAIL, INK, MAJOR, MINOR, animate, animateTransform, blink, burst, clipped, cycleStop, dark, defs, dot, flame, glow, group,
  hover, light, line, linear, motes, part, pulse, radial, solid, sparkle, sway, sweepBand, tone, twinkle,
} from '../../kit'
import type { SetArt } from './types'

// Sakura Spirit (Hoa Anh Linh) — sakura blossoms, fox spirits, paper lanterns and torii under an indigo night.
// Palette: blossom pink, silk white, indigo night, vermilion, soft gold. Every id is prefixed `sak-`.

const PINK = '#F6A6C6'
const PINK_DEEP = '#E0679A'
const SILK = '#FFF5FA'
const INDIGO = '#2E2A6B'
const VERMILION = '#E5484D'
const GOLD = '#F4C766'

/** Five-petal sakura blossom. */
function blossom(cx: number, cy: number, r: number, fill = PINK, core = GOLD, rot = 0) {
  const petals = Array.from({ length: 5 }, (_, i) =>
    `<path transform="rotate(${rot + i * 72} ${cx} ${cy})" d="M${cx} ${cy} C${cx - r * 0.75} ${cy - r * 0.55} ${cx - r * 0.55} ${cy - r * 1.15} ${cx} ${cy - r * 1.05} C${cx + r * 0.55} ${cy - r * 1.15} ${cx + r * 0.75} ${cy - r * 0.55} ${cx} ${cy} Z" fill="${fill}" stroke="${INK}" stroke-width="${Math.max(2, r * 0.18)}" stroke-linejoin="round"/>`).join('')
  return `${petals}${dot(cx, cy, r * 0.28, core)}`
}

/** Single loose petal (notched tip), used for drifting particles. */
const petalPath = (s: number) => `M0 ${-s} C${s * 0.7} ${-s * 0.6} ${s * 0.7} ${s * 0.5} 0 ${s} C${-s * 0.7} ${s * 0.5} ${-s * 0.7} ${-s * 0.6} 0 ${-s} Z`

/** Petals drifting along a vector while spinning and fading. Deterministic offsets. */
function driftPetals(options: { count: number; x: number; y: number; width: number; height: number; dx: number; dy: number; seconds: number; size?: number; colors?: string[]; seed?: number }) {
  const { count, x, y, width, height, dx, dy, seconds, size = 7, colors = [PINK, '#FBD3E4', '#FFFFFF'], seed = 1 } = options
  return Array.from({ length: count }, (_, i) => {
    const r1 = ((Math.sin((seed + i) * 12.9898) * 43758.5453) % 1 + 1) % 1
    const r2 = ((Math.sin((seed + i) * 78.233) * 12345.678) % 1 + 1) % 1
    const px = x + r1 * width
    const py = y + r2 * height
    const dur = seconds * (0.8 + r2 * 0.4)
    const begin = -(r1 * dur)
    const s = size * (0.7 + r2 * 0.6)
    return `<g transform="translate(${px.toFixed(1)} ${py.toFixed(1)})"><g>` +
      `<animateTransform attributeName="transform" type="translate" values="0 0;${(dx * 0.5).toFixed(1)} ${(dy * 0.5 + 6).toFixed(1)};${dx} ${dy}" dur="${dur.toFixed(2)}s" begin="${begin.toFixed(2)}s" repeatCount="indefinite"/>` +
      `<animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.15;0.75;1" dur="${dur.toFixed(2)}s" begin="${begin.toFixed(2)}s" repeatCount="indefinite"/>` +
      `<path d="${petalPath(s)}" fill="${colors[i % colors.length]}" stroke="${INK}" stroke-width="1.6"><animateTransform attributeName="transform" type="rotate" values="0;${i % 2 ? 360 : -360}" dur="${(dur * 0.8).toFixed(2)}s" begin="${begin.toFixed(2)}s" repeatCount="indefinite"/></path>` +
      `</g></g>`
  }).join('')
}

// ─── Outfit helpers (same approach as scripts/cosmetics/art/outfit.ts) ──────
const NECKLINE = 'M222 236 C250 274 300 292 352 282 C384 276 404 260 414 238'

function bodyMask(id: string) {
  return `<mask id="${id}" maskUnits="userSpaceOnUse" x="-40" y="-80" width="620" height="640"><rect x="-40" y="-80" width="620" height="640" fill="#000"/><path d="${DUCK_PATHS.torso}" fill="#fff"/><path d="${DUCK_PATHS.torsoShadow}" fill="#fff"/><path d="${DUCK_PATHS.head}" fill="#000" stroke="#000" stroke-width="${MAJOR}"/></mask>`
}

const FACE_CLEAR = (id: string) => `<mask id="${id}" maskUnits="userSpaceOnUse" x="-40" y="-80" width="620" height="640"><rect x="-40" y="-80" width="620" height="640" fill="#fff"/><path d="${DUCK_PATHS.head}" fill="#000" stroke="#000" stroke-width="${MAJOR}"/><path d="${DUCK_PATHS.beak}" fill="#000" stroke="#000" stroke-width="${MAJOR + 6}"/></mask>`

// ─── Pet helpers (same placement as scripts/cosmetics/art/pet.ts) ──────────
const place = (id: string, content: string, options: { shadow?: number; float?: boolean } = {}) => group(id,
  `<ellipse cx="446" cy="436" rx="${(options.shadow ?? 44) * 1.2}" ry="9" fill="#100A20" opacity="${options.float ? 0.16 : 0.26}"/>`,
  `<g transform="translate(446 436) scale(1.2)">${content}</g>`,
)

export const SAKURA_SPIRIT_ART: SetArt = {
  // ─── RARE · bodyColor — solid blossom pink with a drifting silk sheen ─────
  bodyColor: {
    'body-sakura-dusk': () => {
      const palette = derivePalette('#3F3A8C', { blush: '#FF6FA3', eyeHighlight: '#FFD6E8', beakBase: '#FFB65C', beakShadow: '#D9832E', beakHighlight: '#FFE2B0', feetBase: '#FFB65C' })
      return generateBaseDuckSvg(palette, {
        defs: `<linearGradient id="sak-dusk-sheen" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F9A8D4" stop-opacity="0.7">${cycleStop(['#F9A8D4', '#C4B5FD', '#FDE68A'], 4.5)}</stop><stop offset="0.65" stop-color="#3F3A8C" stop-opacity="0"/></linearGradient>`,
        overlay:
          clipped('sak-dusk-t', DUCK_PATHS.torso, `<path d="${DUCK_PATHS.torso}" fill="url(#sak-dusk-sheen)"/>` + sweepBand('sak-dusk-sweep', 0, 180, 46, 300, 520, 3.8, 0, 0.45)) +
          clipped('sak-dusk-h', DUCK_PATHS.head, `<path d="${DUCK_PATHS.head}" fill="url(#sak-dusk-sheen)"/>`) +
          `<g>${blossom(196, 308, 8, '#FFF5FA', GOLD, 12)}${twinkle(3, 0.4)}</g>` +
          `<path d="${DUCK_PATHS.wing}" fill="none" stroke="${INK}" stroke-width="${MINOR}" stroke-linecap="round" stroke-linejoin="round"/>`,
      })
    },
  },

  // ─── RARE · face — kitsune eye flicks, cheek marks and a petal brow jewel ─
  face: {
    'face-sakura-kitsune-blush': () => group('sak-kitsune-face',
      defs(glow('sak-kf-glow', 3)),
      // vermilion eyeliner flicks sweep outward from the outer eye corners (never into the eyes)
      solid('M282 104 C268 98 256 98 246 104 C258 106 270 112 280 120 Z', VERMILION, { strokeWidth: 4 }),
      solid('M410 112 C422 104 434 102 446 106 C436 110 426 116 416 126 Z', VERMILION, { strokeWidth: 4 }),
      // three fox whisker marks on the cheek
      line('M246 172 C258 168 268 168 278 172 M244 186 C258 182 270 182 282 186 M248 200 C260 196 270 196 280 200', VERMILION, 5),
      tone('M240 186 a26 16 0 1 0 52 0 a26 16 0 1 0 -52 0 Z', '#FF7AA8', 0.4),
      // petal brow jewel above the eyes, glowing gently
      `<g filter="url(#sak-kf-glow)">${pulse(352, 76, 1.18, 2.4, blossom(352, 76, 11, PINK, GOLD))}</g>`,
      `<g>${sparkle(270, 92, 6, '#FFF5FA')}${twinkle(2.2)}</g>`,
      `<g>${sparkle(438, 92, 5, '#FFF5FA')}${twinkle(2.2, 1.1)}</g>`,
    ),
  },

  // ─── RARE · trail — a ribbon of pink water with petals riding the wake ────
  trail: {
    'trail-sakura-petal-stream': () => {
      const raw = group('sak-stream',
        defs(linear('sak-stream-water', [[0, '#FBD3E4', 0], [0.45, '#F6A6C6', 0.75], [1, '#FBD3E4', 0.95]], 0, 0, 1, 0)),
        `<path d="M110 424 C80 404 40 432 4 414 C-6 430 -4 446 6 452 C40 466 80 444 112 452 Z" fill="url(#sak-stream-water)" stroke="${INK}" stroke-width="3" stroke-opacity="0.35"/>`,
        `<path d="M100 430 C72 418 40 440 10 428" fill="none" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round" stroke-dasharray="16 16">${animate('stroke-dashoffset', '0;64', 1.4, { calcMode: 'linear', keySplines: undefined })}</path>`,
        `<ellipse cx="72" cy="440" rx="22" ry="5" fill="none" stroke="#FFF5FA" stroke-width="4">${animate('rx', '22;70', 2.2, { calcMode: 'linear', keySplines: undefined })}${animate('opacity', '0.9;0', 2.2, { calcMode: 'linear', keySplines: undefined })}</ellipse>`,
        driftPetals({ count: 7, x: 40, y: 384, width: 70, height: 46, dx: -60, dy: 16, seconds: 2.4, size: 10, seed: 4 }),
        `<g>${blossom(66, 432, 13, PINK, GOLD, 20)}${animateTransform('translate', '0 0;-8 3;0 0', 2.4)}</g>`,
        `<g>${blossom(22, 438, 10, '#FBD3E4', GOLD, 50)}${animateTransform('translate', '0 0;-6 -2;0 0', 2.8)}</g>`,
      )
      return `<g transform="translate(84 430) scale(1.35) translate(-84 -430)">${raw}</g>`
    },
  },

  // ─── EPIC · head — fox-spirit ears, sakura crown, swinging paper lantern ──
  head: {
    'head-sakura-lantern-ears': () => group('sak-lantern-ears',
      defs(radial('sak-lantern-glow', [[0, '#FFE6A6', 0.85], [1, '#FFB65C', 0]]), glow('sak-le-glow', 4), linear('sak-ear', [[0, '#FFFFFF'], [1, '#F3E8F2']], 0, 0, 0, 1)),
      // fox ears (twitching) sitting on the skull
      sway(276, 70, 5, 2.6, solid('M252 84 L250 14 L304 58 Z', 'url(#sak-ear)') + tone('M262 70 L262 34 L292 58 Z', '#FBB6CE') + tone('M252 84 L250 14 L264 40 L268 78 Z', '#E9D5E4', 0.8)),
      sway(392, 52, 5, 2.6, solid('M366 54 L418 2 L428 72 Z', 'url(#sak-ear)') + tone('M380 52 L412 20 L416 60 Z', '#FBB6CE'), 0.5),
      // sakura branch crown across the brow band
      line('M238 82 C280 60 340 54 400 60 C420 62 436 68 446 76', INK, 11),
      line('M238 82 C280 60 340 54 400 60 C420 62 436 68 446 76', '#6B4423', 6),
      ...[[262, 70, 12, 0], [312, 58, 14, 1], [362, 58, 12, 2], [412, 66, 10, 3]].map(([x, y, r, i]) =>
        `<g>${pulse(x!, y!, 1.12, 2.8, blossom(x!, y!, r!, i! % 2 ? '#FBD3E4' : PINK, GOLD, i! * 17), i! * 0.5)}</g>`),
      // hanging paper lantern from the right ear, swinging
      sway(432, 40, 9, 2.4,
        line('M432 40 V58', INK, 5) +
        `<circle cx="432" cy="78" r="30" fill="url(#sak-lantern-glow)">${animate('r', '24;34;24', 2.4)}</circle>` +
        solid('M418 60 h28 c8 6 10 26 0 36 h-28 c-10 -10 -8 -30 0 -36 Z', VERMILION, { strokeWidth: MINOR }) +
        part('M416 56 h32 v6 h-32 Z M416 94 h32 v6 h-32 Z', '#1B132B', { strokeWidth: 3 }) +
        line('M422 66 C420 74 420 82 422 90 M432 64 V92 M442 66 C444 74 444 82 442 90', '#B91C1C', 2.5) +
        `<g filter="url(#sak-le-glow)"><circle cx="432" cy="78" r="5" fill="#FFE6A6">${animate('opacity', '0.5;1;0.5', 1.4)}</circle></g>` +
        line('M432 100 V112', GOLD, 3)),
      driftPetals({ count: 4, x: 260, y: -10, width: 200, height: 30, dx: -90, dy: 24, seconds: 3, size: 6, seed: 9 }),
    ),
  },

  // ─── EPIC · pet — three-tailed fox spirit floating with foxfire ──────────
  pet: {
    'pet-sakura-kitsune': () => place('sak-kitsune-pet',
      defs(glow('sak-fox-glow', 5), linear('sak-fox-fur', [[0, '#FFFFFF'], [1, '#F1E4EE']], 0, 0, 0, 1)) +
      `<g>${animateTransform('translate', '0 0; 0 -10; 0 0', 2.6)}` +
      // three tails fanned behind, swishing
      sway(-24, -40, 14, 1.8, solid('M-24 -40 C-62 -40 -84 -80 -66 -106 C-56 -84 -40 -70 -18 -64 Z', 'url(#sak-fox-fur)', { strokeWidth: MINOR }) + tone('M-66 -106 C-74 -92 -72 -84 -64 -78 C-62 -88 -62 -98 -66 -106 Z', PINK)) +
      sway(-24, -44, 12, 2.1, solid('M-24 -44 C-56 -58 -64 -100 -40 -122 C-36 -98 -26 -82 -10 -70 Z', 'url(#sak-fox-fur)', { strokeWidth: MINOR }) + tone('M-40 -122 C-46 -108 -44 -98 -38 -92 C-36 -102 -36 -112 -40 -122 Z', PINK), 0.3) +
      sway(-24, -46, 10, 2.4, solid('M-24 -46 C-34 -78 -20 -114 6 -126 C0 -100 2 -82 4 -66 Z', 'url(#sak-fox-fur)', { strokeWidth: MINOR }) + tone('M6 -126 C-2 -114 -2 -104 2 -98 C4 -108 6 -118 6 -126 Z', PINK), 0.6) +
      // body + head
      part('M-34 -20 C-40 -52 -18 -68 6 -68 C30 -68 42 -48 36 -22 C30 -4 -26 -2 -34 -20 Z', 'url(#sak-fox-fur)') +
      part('M-26 -70 C-30 -104 -6 -118 16 -114 C40 -110 50 -88 42 -66 C34 -48 -18 -46 -26 -70 Z', 'url(#sak-fox-fur)') +
      part('M-18 -102 L-24 -132 L0 -112 Z', 'url(#sak-fox-fur)', { strokeWidth: 5 }) + part('M20 -112 L38 -134 L38 -100 Z', 'url(#sak-fox-fur)', { strokeWidth: 5 }) +
      tone('M-16 -108 L-20 -124 L-6 -112 Z M24 -112 L34 -124 L34 -106 Z', '#FBB6CE') +
      // vermilion spirit markings
      tone('M-4 -100 C2 -92 10 -92 14 -100 C8 -96 2 -96 -4 -100 Z', VERMILION) +
      line('M-20 -78 l-10 -4 M40 -80 l10 -4', VERMILION, 3) +
      blink(-6, -84, 3.6, dot(-6, -84, 5, INK) + dot(-4, -86, 1.8, '#FFFFFF')) + blink(22, -84, 3.6, dot(22, -84, 5, INK) + dot(24, -86, 1.8, '#FFFFFF')) +
      dot(8, -72, 3.5, INK) + tone('M-22 -74 a6 4 0 1 0 12 0 a6 4 0 1 0 -12 0 Z M26 -74 a6 4 0 1 0 12 0 a6 4 0 1 0 -12 0 Z', '#FF8FB5', 0.6) +
      // little bell collar
      line('M-22 -48 C-4 -40 18 -40 32 -48', VERMILION, 6) + dot(6, -40, 5, GOLD, { stroke: INK, strokeWidth: 3 }) +
      `</g>` +
      // foxfire wisps orbiting
      `<g filter="url(#sak-fox-glow)">${[0, 1.4].map((d) => `<g>${flame(0, 0, 20, ['#F472B6', '#FDE7F1'], 0.5, d)}<animateMotion dur="2.8s" begin="${-d}s" repeatCount="indefinite" path="M-60 -90 C-60 -140 70 -140 70 -90 C70 -40 -60 -40 -60 -90 Z"/></g>`).join('')}</g>`,
      { shadow: 36, float: true }),
  },

  // ─── EPIC · aura — vermilion torii under a rising moon, petals falling ───
  aura: {
    'aura-sakura-torii-moon': () => group('sak-torii-aura',
      defs(radial('sak-moon', [[0, '#FFF7E0'], [0.6, '#FDE7B0'], [1, '#F4C766']]), radial('sak-moon-halo', [[0, '#FFF1D6', 0.55], [1, '#FFF1D6', 0]]), glow('sak-torii-glow', 6)),
      `<circle cx="256" cy="130" r="210" fill="url(#sak-moon-halo)">${animate('opacity', '0.5;0.9;0.5', 3.6)}</circle>`,
      `<g filter="url(#sak-torii-glow)"><circle cx="256" cy="120" r="96" fill="url(#sak-moon)" opacity="0.85">${animate('r', '94;100;94', 3.6)}</circle></g>`,
      tone('M200 96 a14 10 0 1 0 28 0 a14 10 0 1 0 -28 0 Z M278 148 a10 7 0 1 0 20 0 a10 7 0 1 0 -20 0 Z', '#F4C766', 0.5),
      // torii gate framing the duck
      solid('M60 450 L74 150 H112 L102 450 Z', VERMILION),
      solid('M410 450 L400 150 H438 L452 450 Z', VERMILION),
      tone('M64 450 L76 160 H86 L78 450 Z M412 450 L404 160 H414 L422 450 Z', '#F87171', 0.7),
      solid('M24 126 C120 108 392 108 488 126 L478 100 C392 84 120 84 34 100 Z', VERMILION),
      solid('M18 96 C120 74 392 74 494 96 L484 68 C392 50 120 50 28 68 Z', '#1B132B', { strokeWidth: MINOR }),
      solid('M54 178 H458 V196 H54 Z', VERMILION, { strokeWidth: MINOR }),
      part('M236 126 h40 v54 h-40 Z', '#1B132B', { strokeWidth: 4 }), tone('M244 136 h24 v34 h-24 Z', GOLD, 0.9),
      // falling petals in front of the gate
      driftPetals({ count: 10, x: -10, y: -40, width: 540, height: 120, dx: -60, dy: 420, seconds: 6, size: 8, seed: 21 }),
      `<g>${sparkle(120, 60, 9, '#FFFDF4')}${twinkle(2.6)}</g><g>${sparkle(420, 40, 7, '#FFFDF4')}${twinkle(2.6, 1.3)}</g>`,
    ),
  },

  // ─── LEGENDARY · outfit — indigo night kimono, gold obi, silk sleeves ────
  outfit: {
    'outfit-sakura-silk-kimono': () => {
      const id = 'sak-kimono'
      const kimono = group(id,
        defs(
          bodyMask(`${id}-m`),
          linear('sak-kimono-silk', [[0, '#4B45A8'], [0.55, INDIGO], [1, '#16133D']], 1, 0, 0, 1),
          `<linearGradient id="sak-obi" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${GOLD}">${cycleStop([GOLD, '#FFE9A8', GOLD], 2.4)}</stop><stop offset="1" stop-color="#C8902E"/></linearGradient>`,
          linear('sak-sleeve', [[0, '#FFF5FA'], [1, '#F6A6C6']], 0, 0, 0, 1),
          glow('sak-kimono-glow', 4),
        ),
        `<g mask="url(#${id}-m)">`,
        `<path d="${DUCK_PATHS.torso}" fill="url(#sak-kimono-silk)"/>`,
        `<path d="${DUCK_PATHS.torsoShadow}" fill="url(#sak-kimono-silk)"/>`,
        tone(DUCK_PATHS.torsoShadow, '#0E0B2B', 0.7),
        tone('M300 236 C360 240 404 270 410 312 C390 280 352 258 300 252 Z', light('#4B45A8'), 0.6),
        // embroidered blossom branch across the silk, twinkling
        line('M90 400 C150 360 190 330 260 320 C300 314 330 300 350 280', '#C8902E', 5, { opacity: 0.9 }),
        ...[[120, 380, 14, 0], [180, 346, 12, 0.6], [240, 324, 15, 1.2], [300, 316, 11, 1.8], [150, 300, 10, 2.4]].map(([x, y, r, d]) =>
          `<g>${blossom(x!, y!, r!, d! % 1.2 === 0 ? PINK : '#FBD3E4', GOLD, x!)}${animate('opacity', '0.75;1;0.75', 2.4, { begin: `${d}s` })}</g>`),
        // gold wave hem
        `<path d="M40 402 q24 -18 48 0 t48 0 t48 0 t48 0 t48 0 t48 0 t48 0 t48 0 t48 0 V460 H40 Z" fill="#C8902E" opacity="0.85">${animateTransform('translate', '0 0;48 0', 2, { calcMode: 'linear' })}</path>`,
        sweepBand('sak-kimono-sweep', -40, 200, 60, 260, 580, 3, 0, 0.55),
        `<path d="${DUCK_PATHS.torso}" fill="none" stroke="${INK}" stroke-width="${MAJOR}"/>`,
        line(NECKLINE, INK, MINOR),
        '</g>',
        // crossed white collar (silk, tucked under the chin)
        solid('M228 244 C258 284 300 300 342 294 L330 326 C286 328 244 306 220 272 Z', SILK, { strokeWidth: MINOR }),
        solid('M414 236 C398 280 364 302 330 304 L342 330 C380 324 410 300 422 262 Z', SILK, { strokeWidth: MINOR }),
        line('M236 262 C262 292 300 306 336 304 M408 256 C394 288 364 306 336 310', PINK, 3),
        // obi sash with a knot + tassel
        `<g mask="url(#${id}-m)">${solid('M90 330 C180 350 300 352 412 330 L414 364 C300 386 180 384 92 366 Z', 'url(#sak-obi)')}${line('M96 348 C190 366 300 368 412 348', '#A06A1A', 3)}</g>`,
        `<g filter="url(#sak-kimono-glow)">${pulse(330, 360, 1.12, 2, part('M314 348 h32 v24 h-32 Z', VERMILION, { strokeWidth: 4 }) + blossom(330, 360, 8, PINK, GOLD))}</g>`,
        sway(336, 372, 10, 1.8, line('M336 372 V408', VERMILION, 5) + part('M330 404 h12 v18 h-12 Z', GOLD, { strokeWidth: 3 })),
        // flowing silk furisode sleeve over the wing
        sway(200, 296, 4, 3, solid('M136 316 C168 280 226 270 274 292 C272 326 256 352 232 366 C206 384 166 390 138 376 C126 358 126 334 136 316 Z', 'url(#sak-sleeve)') +
          line('M142 368 C170 380 204 378 230 362', PINK_DEEP, 4) +
          blossom(196, 344, 11, PINK, GOLD) + blossom(236, 320, 8, '#FBD3E4', GOLD, 30) + tone('M150 316 C180 292 220 288 250 300 C222 300 190 306 162 326 Z', '#FFFFFF', 0.7)),
        // glowing petal motes rising off the silk + light sparkle bursts
        `<g filter="url(#sak-kimono-glow)">${driftPetals({ count: 8, x: 90, y: 300, width: 330, height: 110, dx: -30, dy: -150, seconds: 3.2, size: 6, colors: [PINK, '#FFF5FA', '#FBD3E4'], seed: 33 })}</g>`,
        `<g filter="url(#sak-kimono-glow)">${burst(418, 290, 10, 2.4)}${burst(118, 330, 8, 2.4, 0.8)}${burst(300, 410, 7, 2.4, 1.6)}</g>`,
      )
      return `<defs>${FACE_CLEAR('sak-kimono-face-clear')}</defs><g mask="url(#sak-kimono-face-clear)">${kimono}</g>`
    },
  },
}

// Keep tree-shaken helpers referenced for future items in this set.
void [DETAIL, dark, hover, motes]
