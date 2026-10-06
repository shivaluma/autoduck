import { DUCK_PATHS, derivePalette, generateBaseDuckSvg } from '../../../../lib/cosmetics/avatar-rig'
import {
  DETAIL, INK, MAJOR, MINOR, animate, animateTransform, blink, burst, clipped, defs, dot, flame, glow, group, hover,
  line, linear, metal, motes, part, pulse, radial, solid, sweepBand, tone, twinkle,
} from '../../kit'
import type { SetArt } from './types'

// Neon Protocol — red/black chrome cyberpunk: crimson neon, HUD glass, mech plating, glitch, exhaust vents.
// Palette: chrome black #16121F / #2A2433, crimson #E11D48 / #FF2E4D, white-hot #FFE4E6, amber accent #FFB020.

const RED = '#FF2E4D'
const HOT = '#FFE4E6'
const CHROME = '#2A2433'

// ─── Outfit plumbing (copied from scripts/cosmetics/art/outfit.ts) ─────────
const NECKLINE = 'M222 236 C250 274 300 292 352 282 C384 276 404 260 414 238'

function bodyMask(id: string) {
  return `<mask id="${id}" maskUnits="userSpaceOnUse" x="-40" y="-80" width="620" height="640"><rect x="-40" y="-80" width="620" height="640" fill="#000"/><path d="${DUCK_PATHS.torso}" fill="#fff"/><path d="${DUCK_PATHS.torsoShadow}" fill="#fff"/><path d="${DUCK_PATHS.head}" fill="#000" stroke="#000" stroke-width="${MAJOR}"/></mask>`
}

function faceClear(id: string, content: string) {
  return `<defs><mask id="${id}" maskUnits="userSpaceOnUse" x="-40" y="-80" width="620" height="640"><rect x="-40" y="-80" width="620" height="640" fill="#fff"/><path d="${DUCK_PATHS.head}" fill="#000" stroke="#000" stroke-width="${MAJOR}"/><path d="${DUCK_PATHS.beak}" fill="#000" stroke="#000" stroke-width="${MAJOR + 6}"/></mask></defs><g mask="url(#${id})">${content}</g>`
}

const WING = `<path d="${DUCK_PATHS.wing}" fill="none" stroke="${INK}" stroke-width="${MINOR}" stroke-linecap="round" stroke-linejoin="round"/>`

/** Pets: local space, origin = ground contact, placed at PET_RIGHT at 1.2×. */
const place = (id: string, content: string, options: { shadow?: number; float?: boolean } = {}) => group(id,
  `<ellipse cx="446" cy="436" rx="${(options.shadow ?? 44) * 1.2}" ry="9" fill="#100A20" opacity="${options.float ? 0.16 : 0.26}"/>`,
  `<g transform="translate(446 436) scale(1.2)">${content}</g>`,
)

/** Trails stream from the tail tip, scaled 1.35× around it like the core trails. */
const fromTail = (content: string) => `<g transform="translate(84 430) scale(1.35) translate(-84 -430)">${content}</g>`

const dashFlow = (d: string, color: string, width: number, dash: string, seconds: number, distance: number, begin = 0, extra = '') =>
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-dasharray="${dash}"${extra}>${animate('stroke-dashoffset', `0;${distance}`, seconds, { calcMode: 'linear', keySplines: undefined, begin: `${begin}s` })}</path>`

export const NEON_PROTOCOL_ART: SetArt = {
  // ─── Màu · RARE — black chrome body with a crimson neon sheen ───────────
  bodyColor: {
    'body-protocol-crimson-chrome': () => generateBaseDuckSvg(
      derivePalette('#B91C2C', { bodyShadow: '#5C0A16', bodyHighlight: '#FF8A9A', outline: '#140A12', beakBase: '#2A2433', beakShadow: '#16121F', beakHighlight: '#8A8296', feetBase: '#2A2433', blush: '#FFE4E6', eyeHighlight: RED, eyePupil: '#140A12' }),
      {
        defs: `<linearGradient id="npr-body-sheen" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${HOT}" stop-opacity="0.6">${animate('stop-color', `${HOT};#FFB020;${RED};${HOT}`, 4)}</stop><stop offset="0.5" stop-color="#B91C2C" stop-opacity="0"/></linearGradient>`,
        overlay:
          clipped('npr-body-t', DUCK_PATHS.torso, `<path d="${DUCK_PATHS.torso}" fill="url(#npr-body-sheen)"/>` +
            dashFlow('M90 352 C160 330 250 332 300 350 C340 364 380 360 410 340', HOT, 3, '24 140', 2.2, -164, 0, ' opacity="0.85"') +
            sweepBand('npr-body-sweep', 0, 180, 40, 300, 520, 3, 0, 0.55)) +
          clipped('npr-body-h', DUCK_PATHS.head, `<path d="${DUCK_PATHS.head}" fill="url(#npr-body-sheen)"/>`) + WING,
      },
    ),
  },

  // ─── Mặt · RARE — wraparound crimson visor with a running scanline ──────
  face: {
    'face-protocol-scanline-visor': () => group('npr-visor',
      defs(linear('npr-visor-glass', [[0, '#FF6B80', 0.95], [0.5, '#E11D48', 0.92], [1, '#5C0A16', 0.95]], 0, 0, 1, 0), glow('npr-visor-glow', 4)),
      line('M276 120 C250 116 230 122 216 136', INK, 9), line('M276 120 C250 116 230 122 216 136', '#3A3344', 4),
      solid('M268 108 C300 98 380 100 432 112 L428 160 C380 170 300 170 270 158 Z', CHROME),
      `<g filter="url(#npr-visor-glow)">${part('M280 116 C310 108 380 110 420 120 L418 150 C380 158 312 158 282 150 Z', 'url(#npr-visor-glass)', { strokeWidth: DETAIL })}</g>`,
      clipped('npr-visor-c', 'M280 116 C310 108 380 110 420 120 L418 150 C380 158 312 158 282 150 Z',
        `<rect x="270" y="112" width="160" height="5" fill="${HOT}" opacity="0.9">${animateTransform('translate', '0 0;0 40;0 0', 1.6)}</rect>` +
        line('M300 126 l10 -6 M392 128 l8 -6', '#FFFFFF', 4, { opacity: 0.7 }) +
        `<g>${line('M330 134 h10 M336 128 v12', HOT, 3)}${animateTransform('translate', '0 0;56 4;12 0;0 0', 2.4)}</g>`),
      line('M268 108 C300 98 380 100 432 112', '#4A4258', 4),
      `<circle cx="428" cy="122" r="5" fill="${RED}" stroke="${INK}" stroke-width="3">${animate('fill', `${RED};${HOT};${RED}`, 0.9)}</circle>`,
    ),
  },

  // ─── Nón · EPIC — angular hunter helm with crest blade and vent glow ─────
  head: {
    'head-protocol-hunter-helm': () => group('npr-helm',
      defs(metal('npr-helm-metal', '#3A3344'), glow('npr-helm-glow', 4),
        `<linearGradient id="npr-helm-vent" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${RED}">${animate('stop-color', `${RED};${HOT};${RED}`, 1.4)}</stop><stop offset="1" stop-color="#B91C2C"/></linearGradient>`),
      // crest blade sweeping back
      solid('M300 34 L238 -10 L262 44 Z', '#1E1925'),
      tone('M296 34 L246 0 L264 38 Z', RED, 0.9),
      // main shell
      solid('M226 104 C222 50 286 14 350 16 C414 18 446 54 442 100 C380 84 290 86 226 104 Z', 'url(#npr-helm-metal)'),
      clipped('npr-helm-c', 'M226 104 C222 50 286 14 350 16 C414 18 446 54 442 100 C380 84 290 86 226 104 Z',
        tone('M218 108 C228 66 254 38 290 24 C266 56 258 84 260 108 Z', '#16121F', 0.7) +
        sweepBand('npr-helm-sweep', 160, -10, 34, 140, 320, 2.6, 0, 0.6)),
      // plating seams
      line('M330 18 C326 44 324 68 328 90 M380 22 C390 46 396 70 396 88', INK, 4, { opacity: 0.6 }),
      // glowing side vents
      `<g filter="url(#npr-helm-glow)">${[0, 1, 2].map((i) => part(`M${360 + i * 18} ${44 + i * 4} h12 v22 h-12 Z`, 'url(#npr-helm-vent)', { strokeWidth: 3 })).join('')}</g>`,
      // band with HUD strip
      part('M222 110 C282 88 380 82 448 104 L446 90 C380 70 282 76 224 96 Z', '#16121F'),
      dashFlow('M240 104 C300 88 380 84 436 98', RED, 3, '10 8', 0.8, -36),
      // antenna fin + beacon
      line('M420 36 L448 0', INK, 7), line('M420 36 L448 0', '#4A4258', 3),
      `<g filter="url(#npr-helm-glow)"><circle cx="448" cy="0" r="6" fill="${RED}">${animate('opacity', '0.3;1;0.3', 1)}</circle></g>`,
      `<circle cx="448" cy="0" r="8" fill="none" stroke="${RED}" stroke-width="2">${animate('r', '8;20', 1, { calcMode: 'linear', keySplines: undefined })}${animate('opacity', '0.9;0', 1, { calcMode: 'linear', keySplines: undefined })}</circle>`,
      burst(300, 40, 7, 2.6, 0.8, HOT),
    ),
  },

  // ─── Áo · LEGENDARY — overdrive mech frame: chest reactor, shoulder plate, exhaust ─
  outfit: {
    'outfit-protocol-overdrive-frame': () => faceClear('npr-frame-clear', group('npr-frame',
      defs(bodyMask('npr-frame-m'), metal('npr-plate', '#3A3344'), glow('npr-frame-glow', 5),
        linear('npr-armor', [[0, '#3A3344'], [0.5, '#1E1925'], [1, '#0E0A14']], 1, 0, 0, 1),
        `<radialGradient id="npr-core" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#FFFFFF"/><stop offset="0.4" stop-color="${HOT}">${animate('stop-color', `${HOT};#FFB020;${HOT}`, 1.6)}</stop><stop offset="1" stop-color="${RED}"/></radialGradient>`),
      `<g mask="url(#npr-frame-m)">`,
      `<path d="${DUCK_PATHS.torso}" fill="url(#npr-armor)"/>`,
      `<path d="${DUCK_PATHS.torsoShadow}" fill="url(#npr-armor)"/>`,
      tone(DUCK_PATHS.torsoShadow, '#08060C', 0.8),
      tone('M300 236 C360 240 404 270 410 312 C390 280 352 258 300 252 Z', '#5A5268', 0.7),
      // plate seams + neon conduits
      line('M100 320 H290 M96 362 H300 M110 398 H300', '#0A070F', 5),
      `<g filter="url(#npr-frame-glow)">` +
        dashFlow('M100 342 H296', RED, 4, '30 60', 1.2, -90) +
        dashFlow('M106 382 H300', RED, 4, '22 50', 1, -72, 0.3) +
        dashFlow('M306 280 L326 420', HOT, 3, '18 40', 0.9, -58) +
        dashFlow('M392 290 L370 412', RED, 3, '18 40', 1.1, -58, 0.4) +
      `</g>`,
      sweepBand('npr-frame-sweep', -40, 200, 50, 260, 560, 2.2, 0, 0.55),
      `<path d="${DUCK_PATHS.torso}" fill="none" stroke="${INK}" stroke-width="${MAJOR}"/>`,
      line(NECKLINE, INK, MINOR),
      '</g>',
      // high mech collar
      solid('M228 242 C256 280 306 296 354 288 C386 282 408 266 418 242 L420 224 C404 258 372 276 340 278 C292 282 250 262 232 226 Z', '#1E1925', { strokeWidth: MINOR }),
      line('M236 246 C262 274 306 286 350 280', RED, 3),
      // chest reactor
      `<g filter="url(#npr-frame-glow)">${pulse(352, 336, 1.12, 1.2, `<circle cx="352" cy="336" r="24" fill="url(#npr-core)" stroke="${INK}" stroke-width="${MINOR}"/>`)}</g>`,
      `<circle cx="352" cy="336" r="30" fill="none" stroke="${RED}" stroke-width="3">${animate('r', '28;46', 1.2, { calcMode: 'linear', keySplines: undefined })}${animate('opacity', '0.9;0', 1.2, { calcMode: 'linear', keySplines: undefined })}</circle>`,
      `<g>${[0, 60, 120, 180, 240, 300].map((a) => `<path transform="rotate(${a} 352 336)" d="M352 304 v-8" stroke="${HOT}" stroke-width="4" stroke-linecap="round"/>`).join('')}${animateTransform('rotate', '0 352 336;360 352 336', 4, { calcMode: 'linear' })}</g>`,
      // shoulder pauldron over the wing (unique silhouette: angular plate + exhaust stack)
      solid('M124 304 C150 266 214 256 268 280 L258 338 C206 352 150 346 118 326 Z', 'url(#npr-plate)'),
      line('M138 306 C166 284 212 278 252 292', RED, 4),
      tone('M140 296 C170 278 210 274 244 282 C210 284 172 292 144 310 Z', '#8A8296', 0.7),
      [[150, 320], [190, 314], [230, 318]].map(([x, y]) => dot(x!, y!, 5, '#5A5268', { stroke: INK, strokeWidth: 3 })).join(''),
      // twin exhaust stacks on the back with flame + smoke
      solid('M88 262 L72 214 L96 210 L110 258 Z', '#1E1925', { strokeWidth: MINOR }),
      solid('M116 252 L106 200 L130 198 L138 248 Z', '#1E1925', { strokeWidth: MINOR }),
      `<g filter="url(#npr-frame-glow)">${flame(84, 212, 40, [RED, '#FFB020'], 0.4)}${flame(118, 198, 46, [RED, HOT], 0.45, 0.15)}</g>`,
      motes({ count: 7, x: 70, y: 150, width: 70, height: 40, rise: 70, colors: ['#5A5268', '#3A3344', RED], size: [3, 7], seconds: 1.8, seed: 211 }),
      // HUD tag on chest
      part('M372 384 h44 v18 h-44 Z', '#0E0A14', { strokeWidth: 4 }),
      `<text x="394" y="398" text-anchor="middle" font-family="Menlo, monospace" font-weight="700" font-size="12" fill="${RED}">OVR<animate attributeName="opacity" values="1;1;0;1" keyTimes="0;0.7;0.8;1" dur="1.4s" repeatCount="indefinite"/></text>`,
      burst(410, 300, 10, 2.2, 0.4, HOT), burst(160, 290, 8, 2.2, 1.3, HOT),
    )),
  },

  // ─── Pet · EPIC — floating sentry drone with eye lens and red scan cone ──
  pet: {
    'pet-protocol-sentry-drone': () => place('npr-sentry',
      defs(metal('npr-sentry-shell', '#3A3344'), glow('npr-sentry-glow', 4),
        linear('npr-scan', [[0, RED, 0.55], [1, RED, 0]], 0, 0, 0, 1)) +
      hover(8, 2.2,
        `<g transform="translate(0 -96) scale(1.35)">` +
          // scan cone sweeping the water
          `<g>${animateTransform('rotate', '-14 0 10;14 0 10;-14 0 10', 2.8)}<path d="M-8 14 L-34 76 L34 76 L8 14 Z" fill="url(#npr-scan)">${animate('opacity', '0.4;1;0.4', 1.4)}</path></g>` +
          // side thrusters
          [-1, 1].map((sx) => part(`M${sx * 36} -10 h${sx * 16} v22 h${-sx * 16} Z`, '#1E1925', { strokeWidth: 4 }) +
            `<g filter="url(#npr-sentry-glow)">${flame(sx * 44, 14, 20, [RED, '#FFB020'], 0.35, sx > 0 ? 0.1 : 0)}</g>`).join('') +
          // body shell
          solid('M-38 0 C-38 -30 -20 -44 0 -44 C20 -44 38 -30 38 0 C38 22 20 32 0 32 C-20 32 -38 22 -38 0 Z', 'url(#npr-sentry-shell)') +
          tone('M-26 -30 C-12 -40 10 -40 24 -30 C10 -34 -10 -34 -26 -30 Z', '#8A8296', 0.8) +
          line('M-34 6 H34', RED, 3) +
          // eye lens
          `<circle cx="0" cy="-6" r="15" fill="#0E0A14" stroke="${INK}" stroke-width="4"/>` +
          `<g filter="url(#npr-sentry-glow)"><g>${blink(0, -6, 3, `<circle cx="0" cy="-6" r="8" fill="${RED}"/><circle cx="-3" cy="-9" r="3" fill="${HOT}"/>`)}${animateTransform('translate', '0 0;5 0;-5 0;0 0', 3)}</g></g>` +
          // antenna fin
          line('M0 -44 L10 -62', INK, 6) + line('M0 -44 L10 -62', '#5A5268', 2.5) +
          `<circle cx="10" cy="-62" r="4" fill="${RED}">${twinkle(0.8)}</circle>` +
        `</g>`) +
      motes({ count: 4, x: -30, y: -40, width: 60, height: 20, rise: -40, colors: [RED, HOT], size: [1.5, 3], seconds: 1.4, seed: 221 }),
      { shadow: 34, float: true }),
  },

  // ─── Aura · EPIC — red alert hex grid + scrolling HUD rings ─────────────
  aura: {
    'aura-protocol-red-alert': () => group('npr-alert',
      defs(glow('npr-alert-glow', 5), radial('npr-alert-fade', [[0, RED, 0], [0.6, RED, 0], [0.82, RED, 0.25], [1, RED, 0]])),
      `<ellipse cx="256" cy="250" rx="260" ry="240" fill="url(#npr-alert-fade)">${animate('opacity', '0.5;1;0.5', 1.2)}</ellipse>`,
      // hex panels around the edges (face clear)
      [[40, 120], [70, 220], [36, 330], [470, 150], [490, 260], [462, 370], [130, 40], [400, 40]].map(([x, y], i) => {
        const hex = Array.from({ length: 6 }, (_, k) => `${(x! + Math.cos((k * Math.PI) / 3) * 22).toFixed(1)},${(y! + Math.sin((k * Math.PI) / 3) * 22).toFixed(1)}`).join(' ')
        return `<polygon points="${hex}" fill="${RED}" fill-opacity="0.12" stroke="${RED}" stroke-width="3">${animate('fill-opacity', '0.05;0.4;0.05', 1.6, { begin: `${i * 0.2}s` })}</polygon>`
      }).join(''),
      // rotating HUD ring with ticks
      `<g filter="url(#npr-alert-glow)" opacity="0.85"><g>${animateTransform('rotate', '0 256 250;360 256 250', 9, { calcMode: 'linear' })}` +
        `<circle cx="256" cy="250" r="236" fill="none" stroke="${RED}" stroke-width="4" stroke-dasharray="60 24 8 24"/></g>` +
        `<g>${animateTransform('rotate', '360 256 250;0 256 250', 14, { calcMode: 'linear' })}<circle cx="256" cy="250" r="214" fill="none" stroke="${HOT}" stroke-width="2" stroke-dasharray="4 18"/></g></g>`,
      // warning chevrons blinking left/right
      [[20, 250, 1], [500, 250, -1]].map(([x, y, d], i) => `<g>${[0, 1].map((k) => `<path d="M${x! + d! * k * 14} ${y! - 14} l${d! * 12} 14 l${-d! * 12} 14" fill="none" stroke="${RED}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}${animate('opacity', '1;0.15;1', 0.8, { begin: `${i * 0.4}s` })}</g>`).join(''),
      // glitch slices
      [0, 1].map((i) => `<rect x="-20" y="${120 + i * 220}" width="560" height="4" fill="${RED}" opacity="0.6"><animate attributeName="opacity" values="0;0.8;0;0" keyTimes="0;0.1;0.2;1" dur="${2 + i * 0.6}s" repeatCount="indefinite"/>${animateTransform('translate', '0 0;0 40', 2 + i * 0.6)}</rect>`).join(''),
      `<g filter="url(#npr-alert-glow)">${motes({ count: 8, x: 20, y: 300, width: 480, height: 140, rise: 160, colors: [RED, HOT], size: [2, 4], seconds: 2.6, seed: 231 })}</g>`,
    ),
  },

  // ─── Trail · RARE — crimson data stream: packets racing out of the tail ──
  trail: {
    'trail-protocol-data-stream': () => fromTail(group('npr-stream',
      defs(glow('npr-stream-glow', 3)),
      `<g filter="url(#npr-stream-glow)">` +
        [[330, RED, 6, 0], [352, HOT, 3, 0.2], [374, RED, 5, 0.4], [396, '#FFB020', 3, 0.1]].map(([y, c, w, d]) =>
          dashFlow(`M100 ${y} H-30`, c as string, w as number, '28 18', 0.7, 92, d as number)).join('') +
      `</g>`,
      [0, 1, 2, 3].map((i) => `<rect x="${60 - i * 26}" y="${338 + (i % 2) * 34}" width="10" height="10" fill="${HOT}" stroke="${INK}" stroke-width="2">${animate('opacity', '1;0.1;1', 0.6, { begin: `${i * 0.15}s`, calcMode: 'discrete', keySplines: undefined })}</rect>`).join(''),
      tone('M100 430 C60 422 10 426 -24 436 C10 442 60 444 100 438 Z', '#5C0A16', 0.45),
    )),
  },
}

