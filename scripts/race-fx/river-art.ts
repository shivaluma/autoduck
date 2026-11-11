import { RACE_FX_SHEETS } from '../../lib/race-fx/manifest'
import { INK, MAJOR, MINOR, defs, dot, glow, group, line, linear, part, radial, solid, tone } from '../cosmetics/kit'

// River event art (engine S3.17, docs/race-fx.md): the surf wave, vortex, gust and bread loops, and the
// four banner icons. Same conventions as art.ts: a 256×256 viewBox for sheets (128×128 for icons), and
// every animation's period equals its sheet duration so the baked loops are seamless.

const D = Object.fromEntries(RACE_FX_SHEETS.map((sheet) => [sheet.key, sheet.frames / sheet.fps])) as Record<string, number>

const loop = (attr: string, values: string, seconds: number, begin = 0, extra = '') =>
  `<animate attributeName="${attr}" values="${values}" dur="${seconds}s" begin="${begin}s" repeatCount="indefinite"${extra}/>`
const move = (type: 'translate' | 'rotate' | 'scale', values: string, seconds: number, begin = 0, extra = '') =>
  `<animateTransform attributeName="transform" type="${type}" values="${values}" dur="${seconds}s" begin="${begin}s" repeatCount="indefinite" additive="sum"${extra}/>`
const LINEAR = ' calcMode="linear"'
const ease = (count: number) => ` calcMode="spline" keySplines="${Array.from({ length: count }, () => '0.45 0 0.55 1').join(';')}"`

/** A spray droplet that arcs forward and fades, once per period. */
const droplet = (x: number, y: number, dx: number, dy: number, r: number, seconds: number, begin: number) =>
  `<g>${move('translate', `0 0;${dx * 0.6} ${dy};${dx} ${dy * 0.2}`, seconds, begin)}${loop('opacity', '0;1;0', seconds, begin)}` +
  dot(x, y, r, '#F0F9FF', { stroke: INK, strokeWidth: 3 }) + `</g>`

const WAVE_BODY = 'M14 196 C30 128 92 70 166 76 C206 80 232 104 236 136 C218 120 192 120 178 136 C168 152 178 172 200 178 C160 204 76 208 14 196 Z'
const WAVE_FOAM = 'M30 150 C52 106 100 70 166 76 C206 80 232 104 236 136 C222 118 204 112 188 116 C178 100 156 94 140 102 C124 92 102 98 94 112 C78 108 62 118 58 132 C46 132 36 140 30 150 Z'

const LOAF = 'M58 150 C40 112 64 70 128 70 C192 70 216 112 198 150 C188 176 68 176 58 150 Z'
const loaf = (gradientId: string) =>
  solid(LOAF, `url(#${gradientId})`) +
  tone('M70 142 C60 112 80 84 128 82 C104 92 86 112 84 146 Z', '#FEF3C7', 0.55) +
  line('M98 96 l16 26 M128 90 l16 28 M158 96 l14 24', '#92400E', 7) +
  line('M98 96 l16 26 M128 90 l16 28 M158 96 l14 24', '#FDE68A', 2.5) +
  tone('M70 156 C100 170 156 170 186 156 C176 172 80 172 70 156 Z', '#B45309', 0.45)

/** One wind curl: an ink underlay plus a moving white dash. */
const curl = (d: string, width: number, seconds: number, begin: number) =>
  `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${width + 6}" stroke-linecap="round" stroke-dasharray="230 250" opacity="0.55">${loop('stroke-dashoffset', '480;0', seconds, begin, LINEAR)}</path>` +
  `<path d="${d}" fill="none" stroke="#FFFFFF" stroke-width="${width}" stroke-linecap="round" stroke-dasharray="230 250">${loop('stroke-dashoffset', '480;0', seconds, begin, LINEAR)}</path>`

const leaf = (x: number, y: number, rot: number) =>
  `<g transform="translate(${x} ${y}) rotate(${rot})">${part('M0 -14 C12 -8 12 8 0 16 C-12 8 -12 -8 0 -14 Z', '#ECFDF5', { strokeWidth: 4 })}${line('M0 -10 V14', '#6EE7B7', 2.5)}</g>`

export const RIVER_FX_ART: Record<string, () => string> = {
  // A curling wave that pushes a duck from behind (flash flood). Travels to the right.
  'river-surf': () => {
    const s = D['river-surf']!
    return group('surf',
      defs(linear('surf-body', [[0, '#7DD3FC'], [0.55, '#0EA5E9'], [1, '#0369A1']]), glow('surf-glow', 3)),
      // Trailing foam
      ...[0, 1, 2].map((i) => `<ellipse cx="${40 - i * 12}" cy="${206 + (i % 2) * 6}" rx="26" ry="7" fill="#E0F2FE" opacity="0.7">${loop('rx', '10;30;10', s, -(i * s) / 3)}${loop('opacity', '0.8;0;0.8', s, -(i * s) / 3)}</ellipse>`),
      `<g>${move('translate', '0 0;6 -9;0 0', s, 0, ease(2))}${move('scale', '1 1;1.04 0.97;1 1', s, 0, ease(2))}` +
        solid(WAVE_BODY, 'url(#surf-body)') +
        tone('M40 190 C70 150 110 120 168 116 C150 132 150 156 172 172 C130 190 80 196 40 190 Z', '#38BDF8', 0.55) +
        `<path d="M52 176 C84 150 116 134 152 130" fill="none" stroke="#BAE6FD" stroke-width="5" stroke-linecap="round" stroke-dasharray="26 22" opacity="0.9">${loop('stroke-dashoffset', '96;0', s, 0, LINEAR)}</path>` +
        solid(WAVE_FOAM, '#F8FAFC', { strokeWidth: MINOR }) +
        tone('M188 116 C204 112 222 118 236 136 C224 126 208 124 196 128 Z', '#BAE6FD', 0.9) +
        `<g filter="url(#surf-glow)">${dot(150, 96, 5, '#FFFFFF')}${dot(112, 104, 4, '#FFFFFF')}${dot(78, 122, 4, '#FFFFFF')}</g>` +
      `</g>`,
      droplet(214, 96, 26, -34, 7, s, 0), droplet(196, 78, 34, -26, 5, s, -s / 3), droplet(226, 116, 22, -22, 6, s, (-2 * s) / 3),
    )
  },

  // The pull of the whirlpool event under a leading duck: a violet vortex with arrows drawn inward.
  'river-vortex': () => {
    const s = D['river-vortex']!
    return group('rvortex',
      defs(radial('rvortex-fill', [[0, '#0B0720'], [0.3, '#2E1065'], [0.7, '#7C3AED'], [1, '#DDD6FE', 0.15]]), glow('rvortex-glow', 4)),
      `<g transform="translate(128 132) scale(1 0.62)">` +
        `<circle r="120" fill="url(#rvortex-fill)"/>` +
        `<circle r="118" fill="none" stroke="${INK}" stroke-width="8" opacity="0.55"/>` +
        `<g>${move('rotate', '0;-360', s, 0, LINEAR)}` +
          Array.from({ length: 6 }, (_, i) => `<path transform="rotate(${i * 60})" d="M0 0 C34 -14 78 -12 108 34" fill="none" stroke="${i % 2 ? '#F5F3FF' : '#C4B5FD'}" stroke-width="${11 - i}" stroke-linecap="round" opacity="0.92"/>`).join('') +
          Array.from({ length: 6 }, (_, i) => `<path transform="rotate(${i * 60 + 30})" d="M0 0 C22 -8 50 -6 70 22" fill="none" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round" opacity="0.65"/>`).join('') +
        `</g>` +
        `<circle r="116" fill="none" stroke="#EDE9FE" stroke-width="6" stroke-dasharray="20 16" filter="url(#rvortex-glow)">${loop('stroke-dashoffset', '0;-72', s, 0, LINEAR)}</circle>` +
        // Arrows sliding toward the eye
        Array.from({ length: 4 }, (_, i) => `<g transform="rotate(${i * 90 + 45})"><g>${move('translate', '104 0;56 0', s, -(i * s) / 4)}${loop('opacity', '0;1;0', s, -(i * s) / 4)}` +
          `<path d="M14 -13 L-8 0 L14 13" fill="none" stroke="${INK}" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 -13 L-8 0 L14 13" fill="none" stroke="#FDE68A" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></g></g>`).join('') +
        `<ellipse rx="20" ry="20" fill="#0B0720" stroke="#A78BFA" stroke-width="4"/>` +
      `</g>`,
    )
  },

  // Wind curls with leaves, blowing to the right (the canvas flips and tints it for a headwind).
  'river-gust': () => {
    const s = D['river-gust']!
    return group('gust',
      curl('M10 86 C70 70 150 66 190 84 C214 96 212 126 190 130 C172 132 162 116 172 106', 14, s, 0),
      curl('M24 136 C90 124 170 124 214 142 C238 154 232 182 210 182 C194 180 190 164 200 158', 11, s, -s / 3),
      curl('M40 184 C90 176 130 176 160 188 C176 196 172 214 158 214', 9, s, (-2 * s) / 3),
      `<g>${move('translate', '-40 0;220 -18', s, 0, LINEAR)}${loop('opacity', '0;1;1;0', s)}<g>${move('rotate', '0 30 110;360 30 110', s, 0, LINEAR)}${leaf(30, 110, 20)}</g></g>`,
      `<g>${move('translate', '-60 0;200 14', s, -s / 2, LINEAR)}${loop('opacity', '0;1;1;0', s, -s / 2)}<g>${move('rotate', '0 40 162;-360 40 162', s, -s / 2, LINEAR)}${leaf(40, 162, -30)}</g></g>`,
    )
  },

  // A tumbling loaf (bread rain).
  'river-bread': () => {
    const s = D['river-bread']!
    return group('bread',
      defs(linear('bread-crust', [[0, '#FCD34D'], [0.6, '#F59E0B'], [1, '#B45309']]), radial('bread-halo', [[0, '#FEF3C7', 0.75], [0.6, '#FDE68A', 0.3], [1, '#FDE68A', 0]])),
      `<circle cx="128" cy="124" r="96" fill="url(#bread-halo)">${loop('opacity', '0.6;1;0.6', s)}</circle>`,
      `<g>${move('rotate', '-16 128 124;16 128 124;-16 128 124', s, 0, ease(2))}${move('translate', '0 6;0 -8;0 6', s, 0, ease(2))}${loaf('bread-crust')}</g>`,
      // Crumbs
      ...[[62, 190, 5], [196, 196, 4], [128, 206, 5], [90, 60, 4], [176, 54, 3]].map(([x, y, r], i) =>
        `<g>${loop('opacity', '0;1;0', s, -(i * s) / 5)}${dot(x!, y!, r!, '#FBBF24', { stroke: INK, strokeWidth: 2.5 })}</g>`),
    )
  },
}

const ICON_WAVE = 'M10 100 C16 62 48 30 86 34 C106 36 118 50 118 66 C108 58 96 58 88 66 C82 76 88 88 100 92 C80 108 36 110 10 100 Z'

export const RIVER_ICON_ART: Record<string, () => string> = {
  'river-flood': () => group('i-flood',
    defs(linear('i-flood-body', [[0, '#7DD3FC'], [1, '#0369A1']])),
    solid(ICON_WAVE, 'url(#i-flood-body)', { strokeWidth: MAJOR - 2 }),
    part('M18 84 C28 56 52 36 86 34 C106 36 118 50 118 66 C110 54 98 50 90 52 C84 44 72 42 64 48 C54 44 44 50 42 58 C32 60 22 70 18 84 Z', '#F8FAFC', { strokeWidth: 4 }),
    dot(104, 26, 6, '#E0F2FE', { stroke: INK, strokeWidth: 3 }), dot(118, 40, 4, '#E0F2FE', { stroke: INK, strokeWidth: 3 }),
    `<path d="M6 116 q14 -10 28 0 t28 0 t28 0 t28 0" fill="none" stroke="${INK}" stroke-width="11" stroke-linecap="round"/><path d="M6 116 q14 -10 28 0 t28 0 t28 0 t28 0" fill="none" stroke="#38BDF8" stroke-width="5" stroke-linecap="round"/>`,
  ),
  'river-whirlpool': () => group('i-whirl',
    defs(radial('i-whirl-fill', [[0, '#1E1B4B'], [0.55, '#7C3AED'], [1, '#C4B5FD']])),
    `<circle cx="64" cy="64" r="52" fill="url(#i-whirl-fill)" stroke="${INK}" stroke-width="${MAJOR - 3}"/>`,
    line('M64 64 C78 56 96 60 100 78 C102 96 84 108 64 106 C40 104 24 84 28 60 C32 38 54 24 78 28', '#F5F3FF', 8),
    line('M64 64 C56 68 50 62 52 54 C56 44 70 42 78 50', '#FFFFFF', 5),
    dot(64, 64, 7, '#0B0720', { stroke: '#DDD6FE', strokeWidth: 3 }),
  ),
  'river-gust': () => group('i-gust',
    line('M10 46 H74 C94 46 100 22 82 18 C70 16 62 26 66 34', INK, 15), line('M10 46 H74 C94 46 100 22 82 18 C70 16 62 26 66 34', '#F1F5F9', 8),
    line('M10 70 H98 C120 70 124 98 104 102 C92 104 86 94 90 86', INK, 15), line('M10 70 H98 C120 70 124 98 104 102 C92 104 86 94 90 86', '#BAE6FD', 8),
    line('M22 94 H62 C76 94 78 112 66 114', INK, 13), line('M22 94 H62 C76 94 78 112 66 114', '#F1F5F9', 6),
    `<g transform="translate(104 40) rotate(30)">${part('M0 -12 C10 -6 10 8 0 14 C-10 8 -10 -6 0 -12 Z', '#86EFAC', { strokeWidth: 4 })}</g>`,
  ),
  'river-bread': () => group('i-bread',
    defs(linear('i-bread-crust', [[0, '#FCD34D'], [0.6, '#F59E0B'], [1, '#B45309']])),
    `<g transform="translate(64 64) rotate(-14) scale(0.62) translate(-128 -122)">${loaf('i-bread-crust')}</g>`,
    dot(20, 104, 5, '#FBBF24', { stroke: INK, strokeWidth: 3 }), dot(106, 108, 4, '#FBBF24', { stroke: INK, strokeWidth: 3 }), dot(100, 22, 4, '#FBBF24', { stroke: INK, strokeWidth: 3 }),
  ),
}
