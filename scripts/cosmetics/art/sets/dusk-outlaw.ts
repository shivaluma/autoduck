import { DUCK_PATHS, derivePalette, generateBaseDuckSvg } from '../../../../lib/cosmetics/avatar-rig'
import {
  DETAIL, INK, MAJOR, MINOR, animate, animateTransform, blink, burst, clipped, cycleStop, defs, dot, flame, glow, group,
  hover, light, line, linear, metal, motes, part, pulse, radial, solid, sparkle, stitch, sway, sweepBand, tone, twinkle,
} from '../../kit'
import type { SetArt } from './types'

// Dusk Outlaw — dark western at sunset: sulfur orange, charcoal, bone white, brass; hellfire vs holy light.
const SULFUR = '#F97316'
const EMBER = '#FDE047'
const CHAR = '#2A2233'
const BONE = '#F5EBDD'
const BRASS = '#D4A72C'

// ─── Outfit plumbing (copied from scripts/cosmetics/art/outfit.ts) ─────────
const NECKLINE = 'M222 236 C250 274 300 292 352 282 C384 276 404 260 414 238'
const SLEEVE = `${DUCK_PATHS.wing} C122 352 120 330 136 316 Z`

function bodyMask(id: string) {
  return `<mask id="${id}" maskUnits="userSpaceOnUse" x="-40" y="-80" width="620" height="640"><rect x="-40" y="-80" width="620" height="640" fill="#000"/><path d="${DUCK_PATHS.torso}" fill="#fff"/><path d="${DUCK_PATHS.torsoShadow}" fill="#fff"/><path d="${DUCK_PATHS.head}" fill="#000" stroke="#000" stroke-width="${MAJOR}"/></mask>`
}

const CLEAR_FACE_MASK = `<mask id="dso-face-clear" maskUnits="userSpaceOnUse" x="-40" y="-80" width="620" height="640"><rect x="-40" y="-80" width="620" height="640" fill="#fff"/><path d="${DUCK_PATHS.head}" fill="#000" stroke="#000" stroke-width="${MAJOR}"/><path d="${DUCK_PATHS.beak}" fill="#000" stroke="#000" stroke-width="${MAJOR + 6}"/></mask>`

const clearFace = (content: string) => `<defs>${CLEAR_FACE_MASK}</defs><g mask="url(#dso-face-clear)">${content}</g>`

// ─── Pet plumbing (copied from scripts/cosmetics/art/pet.ts) ───────────────
const place = (id: string, content: string, options: { shadow?: number; float?: boolean } = {}) => group(id,
  options.shadow === 0 ? '' : `<ellipse cx="446" cy="436" rx="${(options.shadow ?? 44) * 1.2}" ry="9" fill="#100A20" opacity="${options.float ? 0.16 : 0.26}"/>`,
  `<g transform="translate(446 436) scale(1.2)">${content}</g>`,
)

const WING = (outline: string) => `<path d="${DUCK_PATHS.wing}" fill="none" stroke="${outline}" stroke-width="${MINOR}" stroke-linecap="round" stroke-linejoin="round"/>`

const star = (cx: number, cy: number, r: number, fill: string) => {
  const pts = Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const rr = i % 2 ? r * 0.48 : r
    return `${(cx + Math.cos(a) * rr).toFixed(1)},${(cy + Math.sin(a) * rr).toFixed(1)}`
  }).join(' ')
  return `<polygon points="${pts}" fill="${fill}" stroke="${INK}" stroke-width="${DETAIL}" stroke-linejoin="round"/>`
}

export const DUSK_OUTLAW_ART: SetArt = {
  // ─── RARE · Màu — Ember Dust ─────────────────────────────────────────────
  bodyColor: {
    'body-outlaw-ember': () => generateBaseDuckSvg(
      derivePalette('#D9541E', { beakBase: '#FFC24D', beakShadow: '#C98A0E', beakHighlight: '#FFF0A0', feetBase: '#3A2A20', feetShadow: '#1F1610', blush: '#FFB38A', eyeHighlight: '#FDE68A' }),
      {
        defs: `<linearGradient id="dso-ember-sheen" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FDE047" stop-opacity="0.55">${cycleStop(['#FDE047', '#FB923C', '#F87171'], 4)}</stop><stop offset="0.6" stop-color="#D9541E" stop-opacity="0"/></linearGradient>`,
        overlay:
          clipped('dso-ember-t', DUCK_PATHS.torso, `<path d="${DUCK_PATHS.torso}" fill="url(#dso-ember-sheen)"/>` + sweepBand('dso-ember-sweep', 0, 180, 50, 300, 520, 3.4, 0, 0.45)) +
          clipped('dso-ember-h', DUCK_PATHS.head, `<path d="${DUCK_PATHS.head}" fill="url(#dso-ember-sheen)"/>`) +
          motes({ count: 5, x: 110, y: 330, width: 220, height: 60, rise: 80, colors: ['#FDE047', '#FB923C'], size: [2, 3.5], seconds: 2.8, seed: 501 }) +
          WING(INK),
      },
    ),
  },

  // ─── RARE · Mặt — Dusk Squint ────────────────────────────────────────────
  face: {
    'face-outlaw-squint': () => group('dso-squint',
      // heavy squinting lids (gunslinger stare) — pupils stay visible
      clipped('dso-lid-l', 'M278 138 a42 50 0 1 0 84 0 a42 50 0 1 0 -84 0 Z', `<rect x="270" y="84" width="100" height="44" fill="#4A3A2E"/>`),
      line('M280 126 Q320 134 362 124', INK, MINOR),
      clipped('dso-lid-r', 'M350 144 a32 42 0 1 0 64 0 a32 42 0 1 0 -64 0 Z', `<rect x="345" y="98" width="74" height="38" fill="#4A3A2E"/>`),
      line('M352 134 Q382 140 412 132', INK, MINOR),
      // ember glint in the eyes
      `<circle cx="330" cy="152" r="4" fill="${EMBER}">${animate('opacity', '0.3;1;0.3', 1.8)}</circle>`,
      `<circle cx="390" cy="156" r="3" fill="${EMBER}">${animate('opacity', '0.3;1;0.3', 1.8, { begin: '0.3s' })}</circle>`,
      // scar across the brow
      line('M296 92 L312 112 M300 104 l8 -4', '#B45309', 4),
      // matchstick at the beak corner with a flickering flame
      line('M350 238 L300 252', INK, 9), line('M350 238 L300 252', '#F5D7A1', 5), dot(298, 252, 6, '#DC2626', { stroke: INK, strokeWidth: 3 }),
      `<g filter="url(#dso-match-glow)">${flame(296, 246, 22, [SULFUR, EMBER], 0.5)}</g>`,
      defs(glow('dso-match-glow', 3)),
    ),
  },

  // ─── RARE · Trail — Sulfur Smoke ─────────────────────────────────────────
  trail: {
    'trail-outlaw-sulfur': () => `<g transform="translate(84 430) scale(1.35) translate(-84 -430)">${group('dso-sulfur',
      defs(radial('dso-smoke', [[0, '#FDBA74', 0.85], [0.45, '#9333EA', 0.7], [1, '#2A2233', 0]])),
      ...[[78, 404, 40, 0], [36, 384, 34, 0.8], [-4, 364, 28, 1.6], [-36, 346, 22, 2.2]].map(([x, y, r, d]) =>
        `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#dso-smoke)">${animate('r', `${r! * 0.7};${r! * 1.3};${r! * 0.7}`, 2.4, { begin: `${d}s` })}${animateTransform('translate', '0 0; -10 -8; 0 0', 2.4, { begin: `${d}s` })}</circle>`),
      tone('M110 434 C70 424 20 428 -20 438 C20 444 70 446 110 440 Z', '#3A2A20', 0.45),
      `<g filter="url(#dso-ember-glow)">${motes({ count: 8, x: -20, y: 380, width: 130, height: 60, rise: 60, colors: [EMBER, SULFUR, '#F87171'], size: [2, 4], seconds: 1.8, seed: 511, drift: -30 })}</g>`,
      defs(glow('dso-ember-glow', 3)),
    )}</g>`,
  },

  // ─── EPIC · Nón — Hellfire Stetson ───────────────────────────────────────
  head: {
    'head-outlaw-stetson': () => `<g transform="translate(0 -10)">${group('dso-stetson',
      defs(linear('dso-felt', [[0, '#4A3B5C'], [0.55, CHAR], [1, '#140F1C']], 1, 0, 0, 1), metal('dso-brass', BRASS), glow('dso-hell-glow', 4)),
      // demon horns punch through the crown
      `<g filter="url(#dso-hell-glow)">${solid('M272 54 C252 30 250 4 266 -10 C266 12 280 30 300 46 Z', '#B91C1C', { strokeWidth: MINOR })}${solid('M408 50 C430 28 434 2 420 -12 C418 10 404 28 388 42 Z', '#B91C1C', { strokeWidth: MINOR })}</g>`,
      tone('M266 -10 C258 8 262 24 274 38 L280 34 C270 22 266 8 266 -10 Z M420 -12 C426 6 422 22 410 36 L404 32 C414 20 420 6 420 -12 Z', '#FCA5A5', 0.8),
      flame(266, -6, 26, [SULFUR, EMBER], 0.55), flame(420, -8, 24, [SULFUR, EMBER], 0.6, 0.2),
      // flat-topped gambler crown with a pinched dent
      solid('M256 92 C254 60 262 30 290 24 L340 30 L390 24 C418 30 428 60 426 92 Z', 'url(#dso-felt)'),
      tone('M340 30 L332 70 L348 70 Z', '#140F1C', 0.8),
      tone('M392 30 C414 36 422 60 420 86 C412 64 404 46 390 38 Z', '#6B5A82', 0.7),
      // glowing ember hatband with brass concho
      `<path d="M254 90 C300 78 384 76 428 88 L428 76 C384 64 300 66 254 78 Z" fill="${SULFUR}" stroke="${INK}" stroke-width="${MINOR}">${animate('fill', `${SULFUR};#FDBA74;${SULFUR}`, 1.6)}</path>`,
      `<g filter="url(#dso-hell-glow)">${pulse(340, 80, 1.15, 1.6, part('M340 70 L350 80 L340 90 L330 80 Z', 'url(#dso-brass)', { strokeWidth: DETAIL }))}</g>`,
      // narrow upturned brim (kept high, clear of the eyes)
      solid('M214 92 C222 104 252 104 290 98 C340 92 392 92 440 98 C462 100 476 92 480 80 C468 88 450 88 440 86 C392 80 340 80 290 86 C254 90 226 90 214 92 Z', '#1F1828'),
      tone('M420 92 C448 94 470 88 478 80 C470 96 450 100 426 98 Z', '#6B5A82', 0.8),
      stitch('M236 98 C276 96 320 90 360 88', BRASS, 0.7),
      motes({ count: 6, x: 250, y: -20, width: 180, height: 30, rise: 50, colors: [EMBER, SULFUR], size: [2, 3.5], seconds: 1.8, seed: 521 }),
    )}</g>`,
  },

  // ─── EPIC · Pet — Lil' Bone Bandit ───────────────────────────────────────
  pet: {
    'pet-outlaw-skull': () => place('dso-bone-bandit',
      defs(glow('dso-skull-glow', 4), radial('dso-skull-aura', [[0, SULFUR, 0.45], [1, SULFUR, 0]])) +
      `<g>${animateTransform('translate', '0 0; 0 -10; 0 0; 0 0', 1.4, { keyTimes: '0;0.3;0.6;1' })}` +
        `<ellipse cx="0" cy="-60" rx="56" ry="52" fill="url(#dso-skull-aura)">${animate('opacity', '0.5;1;0.5', 1.4)}</ellipse>` +
        // little bone legs
        line('M-18 -6 L-22 0 M18 -6 L22 0', BONE, 8) + line('M-18 -6 L-22 0 M18 -6 L22 0', INK, 2) +
        // cow-skull head with curled horns
        sway(-40, -86, 8, 2, solid('M-30 -84 C-54 -84 -70 -100 -66 -118 C-58 -104 -46 -98 -30 -98 Z', BONE, { strokeWidth: MINOR })) +
        sway(40, -86, 8, 2, solid('M30 -84 C54 -84 70 -100 66 -118 C58 -104 46 -98 30 -98 Z', BONE, { strokeWidth: MINOR }), 0.3) +
        solid('M-34 -92 C-36 -118 -18 -126 0 -126 C18 -126 36 -118 34 -92 C34 -66 20 -44 12 -26 C8 -18 -8 -18 -12 -26 C-20 -44 -34 -66 -34 -92 Z', BONE) +
        tone('M10 -122 C26 -116 32 -102 30 -88 C24 -100 18 -110 6 -116 Z', '#FFFFFF', 0.9) +
        tone('M-34 -92 C-34 -70 -22 -48 -12 -30 C-22 -46 -30 -66 -28 -92 Z', '#D6C4A8', 0.9) +
        // ember eye sockets
        `<g filter="url(#dso-skull-glow)">${blink(-14, -88, 3, `<ellipse cx="-14" cy="-88" rx="9" ry="10" fill="${INK}"/><circle cx="-14" cy="-87" r="4" fill="${EMBER}">${animate('fill', `${EMBER};${SULFUR};${EMBER}`, 1.2)}</circle>`)}${blink(14, -88, 3, `<ellipse cx="14" cy="-88" rx="9" ry="10" fill="${INK}"/><circle cx="14" cy="-87" r="4" fill="${EMBER}">${animate('fill', `${EMBER};${SULFUR};${EMBER}`, 1.2, { begin: '0.2s' })}</circle>`)}</g>` +
        dot(-4, -56, 3, INK) + dot(4, -56, 3, INK) +
        line('M-10 -40 h20 M-6 -44 v8 M0 -44 v8 M6 -44 v8', INK, 2.5) +
        // tiny red bandana
        sway(0, -36, 6, 1.6, solid('M-24 -40 C-10 -32 10 -32 24 -40 L16 -24 C6 -18 -6 -18 -16 -24 Z', '#DC2626', { strokeWidth: 4 }) + dot(-6, -30, 2, '#FFFFFF') + dot(8, -28, 2, '#FFFFFF')) +
        // tiny brass-banded hat
        solid('M-20 -124 C-20 -142 20 -142 20 -124 Z', CHAR, { strokeWidth: 5 }) + part('M-34 -122 C-12 -128 12 -128 34 -122 C20 -118 -20 -118 -34 -122 Z', '#1F1828', { strokeWidth: 4 }) +
        line('M-18 -127 H18', BRASS, 3) +
      `</g>` +
      `<g filter="url(#dso-skull-glow)">${motes({ count: 5, x: -30, y: -120, width: 60, height: 40, rise: 50, colors: [EMBER, SULFUR], size: [2, 3.5], seconds: 2, seed: 531 })}</g>`,
      { shadow: 34 }),
  },

  // ─── EPIC · Aura — Fallen Halo (holy light vs hellfire) ──────────────────
  aura: {
    'aura-outlaw-halo': () => group('dso-fallen-halo',
      defs(
        radial('dso-hellfire', [[0, SULFUR, 0], [0.55, SULFUR, 0], [0.8, '#DC2626', 0.45], [1, '#7F1D1D', 0]]),
        radial('dso-holy', [[0, '#FFF7D6', 0.7], [1, '#FFF7D6', 0]]),
        metal('dso-halo-gold', BRASS),
        glow('dso-halo-glow', 6),
      ),
      // left: hellfire glow licking up behind the duck
      `<ellipse cx="120" cy="330" rx="170" ry="150" fill="url(#dso-hellfire)">${animate('rx', '160;180;160', 1.4)}</ellipse>`,
      `<g filter="url(#dso-halo-glow)">${flame(40, 380, 80, ['#DC2626', SULFUR], 0.6)}${flame(90, 420, 60, [SULFUR, EMBER], 0.55, 0.2)}${flame(10, 300, 54, ['#DC2626', SULFUR], 0.7, 0.1)}</g>`,
      // right: holy light from the cracked halo
      `<ellipse cx="380" cy="-6" rx="120" ry="60" fill="url(#dso-holy)">${animate('opacity', '0.45;1;0.45', 2.4)}</ellipse>`,
      ...[0, 1, 2, 3, 4].map((i) => `<path d="M380 -6 L${330 + i * 25} 90" stroke="#FFF7D6" stroke-width="${8 - i}" stroke-linecap="round" opacity="0.35">${animate('opacity', '0.1;0.45;0.1', 2.4, { begin: `${i * 0.3}s` })}</path>`),
      // the broken halo itself, tilting and hovering
      `<g filter="url(#dso-halo-glow)">${hover(8, 2.6,
        `<g transform="rotate(-14 380 -6)">${`<path d="M300 -6 A80 22 0 0 1 452 -18" fill="none" stroke="${INK}" stroke-width="16" stroke-linecap="round"/><path d="M300 -6 A80 22 0 0 1 452 -18" fill="none" stroke="url(#dso-halo-gold)" stroke-width="9" stroke-linecap="round"/>`}` +
        `<path d="M456 4 A80 22 0 0 1 330 14" fill="none" stroke="${INK}" stroke-width="16" stroke-linecap="round"/><path d="M456 4 A80 22 0 0 1 330 14" fill="none" stroke="url(#dso-halo-gold)" stroke-width="9" stroke-linecap="round"/>` +
        line('M452 -18 l6 10 l-4 4', INK, 4) + `</g>`)}</g>`,
      burst(468, -30, 10, 2.2), burst(300, -40, 8, 2.2, 1.1),
      `<g filter="url(#dso-halo-glow)">${motes({ count: 10, x: 0, y: 260, width: 200, height: 200, rise: 140, colors: [EMBER, SULFUR, '#F87171'], size: [2.5, 5], seconds: 2.4, seed: 541 })}</g>`,
      motes({ count: 6, x: 320, y: 40, width: 140, height: 80, rise: -60, colors: ['#FFF7D6', '#FDE68A'], size: [2, 3.5], seconds: 3, seed: 543, shape: 'sparkle' }),
    ),
  },

  // ─── LEGENDARY · Áo — Dusk Reaper Duster ─────────────────────────────────
  outfit: {
    'outfit-outlaw-duster': () => clearFace(group('dso-duster',
      defs(
        bodyMask('dso-duster-m'),
        linear('dso-leather', [[0, '#5A4636'], [0.5, '#3A2A20'], [1, '#1F1610']], 1, 0, 0, 1),
        linear('dso-lining', [[0, EMBER], [0.5, SULFUR], [1, '#B91C1C']], 0, 0, 0, 1),
        metal('dso-buckle', BRASS),
        glow('dso-duster-glow', 5),
      ),
      // tattered coat-tails flaring behind and below the duck — unique silhouette
      sway(110, 330, 5, 2.2, solid('M120 320 C80 350 60 400 40 452 L66 438 L76 462 L96 440 L110 464 L124 436 L144 452 L150 380 Z', 'url(#dso-leather)') +
        tone('M120 330 C92 360 78 400 66 438 L76 462 L96 440 L110 464 L124 436 C130 400 134 370 128 340 Z', 'url(#dso-lining)', 0.9)),
      `<g filter="url(#dso-duster-glow)">${flame(70, 450, 40, ['#DC2626', SULFUR], 0.55)}${flame(110, 460, 34, [SULFUR, EMBER], 0.5, 0.15)}${flame(140, 452, 30, ['#DC2626', SULFUR], 0.6, 0.3)}</g>`,
      // body of the coat inside the torso mask
      `<g mask="url(#dso-duster-m)">`,
      `<path d="${DUCK_PATHS.torso}" fill="url(#dso-leather)"/>`,
      `<path d="${DUCK_PATHS.torsoShadow}" fill="url(#dso-leather)"/>`,
      tone(DUCK_PATHS.torsoShadow, '#140C08', 0.75),
      tone('M300 236 C360 240 404 270 410 312 C390 280 352 258 300 252 Z', light('#5A4636'), 0.7),
      // open front shows the ember-lit lining
      `<path d="M300 260 C312 320 318 370 330 430 L380 430 C372 380 378 320 400 268 Z" fill="url(#dso-lining)">${animate('opacity', '0.75;1;0.75', 1.4)}</path>`,
      line('M300 260 C312 320 318 370 330 430 M400 268 C378 320 372 380 380 430', INK, MINOR),
      // bandolier with brass rounds
      line('M140 300 C200 330 260 360 330 400', INK, 18), line('M140 300 C200 330 260 360 330 400', '#7C2D12', 12),
      ...[0, 1, 2, 3, 4, 5].map((i) => part(`M${154 + i * 30} ${304 + i * 15} h8 v12 h-8 Z`, 'url(#dso-buckle)', { strokeWidth: 3 })),
      sweepBand('dso-duster-sweep', -40, 200, 50, 260, 560, 2.8, 0, 0.35),
      `<path d="${DUCK_PATHS.torso}" fill="none" stroke="${INK}" stroke-width="${MAJOR}"/>`,
      line(NECKLINE, INK, MINOR),
      '</g>',
      part(SLEEVE, '#3A2A20'),
      line('M138 340 C170 352 210 352 240 340', BRASS, 4),
      // high turned-up collar with a red bandana knot
      solid('M226 240 C254 280 306 296 354 288 C386 282 408 266 418 242 L420 220 C404 256 370 274 338 276 C288 280 248 260 230 222 Z', '#2A1F18', { strokeWidth: MINOR }),
      sway(330, 286, 8, 1.8, solid('M318 282 C326 270 342 270 348 282 L362 316 L340 304 L330 322 Z', '#DC2626', { strokeWidth: 5 }) + dot(336, 292, 2.5, '#FFFFFF') + dot(344, 304, 2.5, '#FFFFFF')),
      // cracked sheriff star — burning
      `<g filter="url(#dso-duster-glow)">${pulse(392, 326, 1.12, 1.4, star(392, 326, 16, BRASS) + line('M386 316 L394 328 L388 338', INK, 2.5))}</g>`,
      `<circle cx="392" cy="326" r="18" fill="none" stroke="${SULFUR}" stroke-width="3">${animate('r', '16;30', 1.4, { calcMode: 'linear', keySplines: undefined })}${animate('opacity', '0.8;0', 1.4, { calcMode: 'linear', keySplines: undefined })}</circle>`,
      // spur-like brass buckle on the belt
      part('M222 392 h28 v18 h-28 Z', 'url(#dso-buckle)', { strokeWidth: 4 }),
      `<g filter="url(#dso-duster-glow)">${motes({ count: 10, x: 40, y: 360, width: 360, height: 100, rise: 120, colors: [EMBER, SULFUR, '#F87171'], size: [2, 4.5], seconds: 2.4, seed: 551 })}</g>`,
      burst(410, 300, 9, 2.2, 0.4), burst(140, 300, 7, 2.2, 1.3),
      sparkle(376, 312, 4, '#FFFBEA'),
      `<g>${dot(392, 326, 3, '#FFFBEA')}${twinkle(1.2)}</g>`,
    )),
  },
}

