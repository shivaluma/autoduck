import { RACE_FX_SHEETS } from '../../lib/race-fx/manifest'
import {
  DETAIL, INK, MAJOR, MINOR, around, defs, dot, flame, glow, group, line, linear, metal, part, pulse, radial, solid,
  sparkle, tone,
} from '../cosmetics/kit'

// Race FX art, authored in a 256×256 viewBox centred on (128,128). Every animation's period equals its
// sprite-sheet duration (frames / fps) so baked loops are seamless and one-shots play exactly once.

const D = Object.fromEntries(RACE_FX_SHEETS.map((sheet) => [sheet.key, sheet.frames / sheet.fps])) as Record<string, number>

const loop = (attr: string, values: string, seconds: number, begin = 0, extra = '') =>
  `<animate attributeName="${attr}" values="${values}" dur="${seconds}s" begin="${begin}s" repeatCount="indefinite"${extra}/>`
const move = (type: 'translate' | 'rotate' | 'scale', values: string, seconds: number, begin = 0, extra = '') =>
  `<animateTransform attributeName="transform" type="${type}" values="${values}" dur="${seconds}s" begin="${begin}s" repeatCount="indefinite" additive="sum"${extra}/>`
const ease = (count: number) => ` calcMode="spline" keySplines="${Array.from({ length: count }, () => '0.45 0 0.55 1').join(';')}"`
/** One-shot timeline: values over keyTimes, played once per period (the sheet samples exactly one period). */
function checkTimeline(values: string, keyTimes: string) {
  const v = values.split(';').length
  const k = keyTimes.split(';')
  if (v !== k.length || k[0] !== '0' || k.at(-1) !== '1') throw new Error(`Invalid SMIL timeline: values="${values}" keyTimes="${keyTimes}" (browsers silently ignore it)`)
}
const shot = (attr: string, values: string, keyTimes: string, seconds: number) => (checkTimeline(values, keyTimes),
  `<animate attributeName="${attr}" values="${values}" keyTimes="${keyTimes}" dur="${seconds}s" repeatCount="indefinite"/>`)
const shotMove = (type: 'translate' | 'rotate' | 'scale', values: string, keyTimes: string, seconds: number) => (checkTimeline(values, keyTimes),
  `<animateTransform attributeName="transform" type="${type}" values="${values}" keyTimes="${keyTimes}" dur="${seconds}s" repeatCount="indefinite" additive="sum"/>`)

function ripples(cx: number, cy: number, rx: number, seconds: number, count = 2, color = '#CFF6FF') {
  return Array.from({ length: count }, (_, i) =>
    `<ellipse cx="${cx}" cy="${cy}" rx="${rx * 0.4}" ry="${rx * 0.09}" fill="none" stroke="${color}" stroke-width="5">` +
    loop('rx', `${rx * 0.4};${rx}`, seconds, -(i * seconds) / count) + loop('ry', `${rx * 0.09};${rx * 0.2}`, seconds, -(i * seconds) / count) +
    loop('opacity', '0.9;0', seconds, -(i * seconds) / count) + `</ellipse>`).join('')
}

/** Isometric box shared by the three pickup types. */
function box(id: string, faces: { top: string; left: string; right: string }, glyph: string, glyphColor: string, extras = '') {
  const top = 'M128 52 L190 84 L128 116 L66 84 Z'
  const left = 'M66 84 L128 116 L128 186 L66 154 Z'
  const right = 'M128 116 L190 84 L190 154 L128 186 Z'
  const s = D[id]!
  return group(id,
    ripples(128, 206, 96, s, 2),
    `<ellipse cx="128" cy="204" rx="70" ry="14" fill="#0B3A52" opacity="0.35"/>`,
    `<g>${move('translate', '0 0;0 -10;0 0', s, 0, ease(2))}${move('rotate', '-4 128 120;4 128 120;-4 128 120', s, 0, ease(2))}` +
      solid(left, faces.left) + solid(right, faces.right) + solid(top, faces.top) +
      tone('M128 58 L180 84 L128 110 Z', '#FFFFFF', 0.35) +
      `<g clip-path="url(#${id}-clip)">${`<rect x="20" y="40" width="26" height="170" fill="#FFFFFF" opacity="0.55" transform="skewX(-20)">${move('translate', '0 0;220 0;220 0', s)}</rect>`}</g>` +
      `<clipPath id="${id}-clip"><path d="${left} ${right} ${top}"/></clipPath>` +
      `<g filter="url(#${id}-glow)">${loop('opacity', '0.75;1;0.75', s)}` +
        `<text x="0" y="0" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="54" fill="${glyphColor}" stroke="${INK}" stroke-width="5" paint-order="stroke" text-anchor="middle" transform="translate(160 158) skewY(-27)">${glyph}</text>` +
        `<text x="0" y="0" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="54" fill="${glyphColor}" stroke="${INK}" stroke-width="5" paint-order="stroke" text-anchor="middle" transform="translate(97 158) skewY(27)">${glyph}</text>` +
      `</g>` +
      extras + `</g>`,
    defs(glow(`${id}-glow`, 3)),
  )
}

const spark = (cx: number, cy: number, size: number, seconds: number, begin: number, fill = '#FFFBEA') =>
  around(cx, cy, `<animateTransform attributeName="transform" type="scale" values="0;1.2;0;0" keyTimes="0;0.25;0.5;1" dur="${seconds}s" begin="${begin}s" repeatCount="indefinite"/>`, sparkle(cx, cy, size, fill))

/** Particles that fly from the centre outward and fade once per period. */
function radiate(options: { count: number; cx: number; cy: number; distance: number; seconds: number; draw: (x: number, y: number, i: number) => string; spin?: boolean; gravity?: number; startAngle?: number }) {
  const { count, cx, cy, distance, seconds, draw, spin, gravity = 0, startAngle = 0 } = options
  return Array.from({ length: count }, (_, i) => {
    const angle = startAngle + (i / count) * Math.PI * 2
    const reach = distance * (0.75 + ((i * 37) % 10) / 40)
    const dx = Math.cos(angle) * reach
    const dy = Math.sin(angle) * reach
    return `<g>${shotMove('translate', `0 0;${(dx * 0.7).toFixed(1)} ${(dy * 0.7).toFixed(1)};${dx.toFixed(1)} ${(dy + gravity).toFixed(1)}`, '0;0.45;1', seconds)}` +
      `${shot('opacity', '1;1;0', '0;0.6;1', seconds)}` +
      (spin ? `<g>${shotMove('rotate', `0 ${cx} ${cy};${(i % 2 ? 1 : -1) * 240} ${cx} ${cy}`, '0;1', seconds)}${draw(cx, cy, i)}</g>` : draw(cx, cy, i)) + `</g>`
  }).join('')
}

const featherShape = (x: number, y: number, rot: number, scale = 1) =>
  `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${scale})">${part('M0 -26 C16 -16 16 14 0 26 C-16 14 -16 -16 0 -26 Z', '#F8FAFC', { strokeWidth: 4 })}${line('M0 -22 V30', '#94A3B8', 3)}${line('M0 -8 l8 -6 M0 4 l9 -6 M0 -2 l-8 -6', '#CBD5E1', 2)}</g>`

const star5 = (x: number, y: number, r: number, fill: string) => {
  const pts = Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const rr = i % 2 ? r * 0.45 : r
    return `${(x + Math.cos(a) * rr).toFixed(1)},${(y + Math.sin(a) * rr).toFixed(1)}`
  }).join(' ')
  return `<polygon points="${pts}" fill="${fill}" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>`
}

export const RACE_FX_ART: Record<string, () => string> = {
  // ─── World objects ──────────────────────────────────────────────────────
  'box-quack': () => box('box-quack', { top: '#A5F3FC', left: '#22D3EE', right: '#0891B2' }, '?', '#FFFFFF',
    spark(204, 64, 9, D['box-quack']!, 0) + spark(56, 72, 7, D['box-quack']!, D['box-quack']! / 2)),

  'box-golden': () => {
    const s = D['box-golden']!
    return group('box-golden-wrap',
      defs(radial('gold-halo', [[0, '#FFF3A6', 0.85], [1, '#FFF3A6', 0]]), metal('gold-face', '#F2B627')),
      `<g opacity="0.85">${move('rotate', `0 128 120;45 128 120`, s, 0, ' calcMode="linear"')}${Array.from({ length: 8 }, (_, i) => `<path transform="rotate(${i * 45} 128 120)" d="M120 120 L112 4 L144 4 L136 120 Z" fill="#FFF7CC" opacity="${i % 2 ? 0.3 : 0.55}"/>`).join('')}</g>`,
      `<circle cx="128" cy="120" r="96" fill="url(#gold-halo)">${loop('r', '86;102;86', s)}</circle>`,
      box('box-golden', { top: '#FFF0A6', left: 'url(#gold-face)', right: '#C98A10' }, '★', '#FFFBEA',
        spark(206, 60, 11, s, 0) + spark(52, 66, 9, s, s / 3) + spark(196, 168, 8, s, (2 * s) / 3)),
    )
  },

  'box-chaos': () => {
    const s = D['box-chaos']!
    return group('box-chaos-wrap',
      `<g opacity="0.9">${flame(60, 196, 70, ['#7C3AED', '#E879F9'], s / 2)}${flame(196, 196, 64, ['#7C3AED', '#E879F9'], s / 2, s / 4)}${flame(128, 206, 52, ['#581C87', '#C084FC'], s / 2, s / 3)}</g>`,
      box('box-chaos', { top: '#C4B5FD', left: '#7C3AED', right: '#4C1D95' }, '!', '#F0ABFC',
        `<g>${move('rotate', '0 128 84;360 128 84', s, 0, ' calcMode="linear"')}${[0, 120, 240].map((a) => `<circle cx="${128 + Math.cos((a * Math.PI) / 180) * 40}" cy="${84 + Math.sin((a * Math.PI) / 180) * 20}" r="6" fill="#F0ABFC" stroke="${INK}" stroke-width="3"/>`).join('')}</g>`),
    )
  },

  'hazard-anchor': () => {
    const s = D['hazard-anchor']!
    return group('anchor',
      defs(metal('anchor-metal', '#94A3B8')),
      ripples(128, 176, 110, s, 3),
      `<g>${move('rotate', '-6 128 60;6 128 60;-6 128 60', s, 0, ease(2))}` +
        line('M128 20 V70', INK, 12) + line('M128 20 V70', '#94A3B8', 6) +
        [24, 40, 56].map((y) => `<ellipse cx="128" cy="${y}" rx="7" ry="9" fill="none" stroke="${INK}" stroke-width="9"/><ellipse cx="128" cy="${y}" rx="7" ry="9" fill="none" stroke="#CBD5E1" stroke-width="4"/>`).join('') +
        solid('M118 70 h20 v76 h-20 Z', 'url(#anchor-metal)', { strokeWidth: MINOR }) +
        solid('M84 92 h88 v14 h-88 Z', 'url(#anchor-metal)', { strokeWidth: MINOR }) +
        solid('M70 128 C74 166 108 184 128 184 C148 184 182 166 186 128 L170 132 C164 156 146 166 128 166 C110 166 92 156 86 132 Z', 'url(#anchor-metal)', { strokeWidth: MINOR }) +
        solid('M62 120 L80 140 L88 116 Z M194 120 L176 140 L168 116 Z', '#94A3B8', { strokeWidth: MINOR }) +
        `<circle cx="128" cy="62" r="13" fill="none" stroke="${INK}" stroke-width="12"/><circle cx="128" cy="62" r="13" fill="none" stroke="#CBD5E1" stroke-width="6"/>` +
      `</g>`,
      `<ellipse cx="128" cy="186" rx="100" ry="26" fill="#1F7FB0" opacity="0.8"/>`,
      `<path d="M40 178 C70 170 92 186 128 178 C164 170 186 186 216 178" fill="none" stroke="#CFF6FF" stroke-width="5" stroke-linecap="round">${move('translate', '0 0;-8 3;0 0', s, 0, ease(2))}</path>`,
      ...[0, 1, 2].map((i) => `<circle cx="${100 + i * 26}" cy="176" r="${5 + i}" fill="#BAE6FD" stroke="${INK}" stroke-width="2.5">${loop('cy', '176;120', s, -(i * s) / 3)}${loop('opacity', '0;1;0', s, -(i * s) / 3)}</circle>`),
    )
  },

  'hazard-whirlpool': () => {
    const s = D['hazard-whirlpool']!
    return group('whirlpool',
      defs(radial('vortex', [[0, '#020617'], [0.35, '#0C4A6E'], [0.75, '#0EA5E9'], [1, '#7DD3FC', 0.2]])),
      `<ellipse cx="128" cy="128" rx="120" ry="86" fill="url(#vortex)"/>`,
      `<g transform="translate(128 128) scale(1 0.72)"><g>${move('rotate', '0;-360', s, 0, ' calcMode="linear"')}` +
        Array.from({ length: 5 }, (_, i) => `<path transform="rotate(${i * 72})" d="M0 0 C30 -10 70 -10 100 30" fill="none" stroke="${i % 2 ? '#E0F2FE' : '#7DD3FC'}" stroke-width="${10 - i}" stroke-linecap="round" opacity="0.9"/>`).join('') +
        Array.from({ length: 5 }, (_, i) => `<path transform="rotate(${i * 72 + 36})" d="M0 0 C20 -6 46 -6 66 18" fill="none" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round" opacity="0.7"/>`).join('') +
      `</g></g>`,
      `<ellipse cx="128" cy="128" rx="120" ry="86" fill="none" stroke="#E0F2FE" stroke-width="6" stroke-dasharray="18 14">${loop('stroke-dashoffset', '0;64', s, 0, ' calcMode="linear"')}</ellipse>`,
      `<ellipse cx="128" cy="128" rx="18" ry="12" fill="#020617"/>`,
    )
  },

  'hazard-ice': () => {
    const s = D['hazard-ice']!
    const floe = 'M40 120 L76 66 L150 52 L214 92 L206 156 L140 196 L62 178 Z'
    return group('ice',
      defs(linear('ice-face', [[0, '#F0FDFF'], [0.5, '#BAE6FD'], [1, '#38BDF8']], 0, 0, 1, 1), glow('ice-glow', 3)),
      ripples(128, 186, 116, s, 2),
      solid(floe, 'url(#ice-face)'),
      tone('M76 66 L150 52 L214 92 L140 110 Z', '#FFFFFF', 0.7),
      tone('M40 120 L140 110 L140 196 L62 178 Z', '#7DD3FC', 0.45),
      line('M140 110 L120 140 L132 160 L110 184 M140 110 L176 132 L190 150', '#0369A1', 3, { opacity: 0.7 }),
      `<clipPath id="ice-clip"><path d="${floe}"/></clipPath><g clip-path="url(#ice-clip)"><rect x="10" y="30" width="30" height="190" fill="#FFFFFF" opacity="0.8" transform="skewX(-20)">${move('translate', '0 0;260 0;260 0', s)}</rect></g>`,
      `<g filter="url(#ice-glow)">${spark(186, 78, 10, s, 0)}${spark(80, 96, 8, s, s / 2)}</g>`,
      ...[0, 1, 2, 3].map((i) => `<circle cx="${70 + i * 40}" cy="${170 - (i % 2) * 20}" r="${10 + (i % 2) * 4}" fill="#E0F2FE" opacity="0">${loop('cy', `${170 - (i % 2) * 20};${110 - (i % 2) * 20}`, s, -(i * s) / 4)}${loop('opacity', '0;0.55;0', s, -(i * s) / 4)}</circle>`),
    )
  },

  'hazard-goo': () => {
    const s = D['hazard-goo']!
    return group('goo',
      defs(radial('goo-fill', [[0, '#BEF264'], [0.6, '#65A30D'], [1, '#365314']], 0.45, 0.4, 0.7)),
      `<g>${move('scale', '1 1;1.04 0.95;1 1', s, 0, ease(2))}` +
        solid('M36 150 C30 112 70 92 104 102 C120 76 170 76 186 104 C222 104 236 140 214 162 C200 186 150 190 128 180 C100 194 50 190 36 150 Z', 'url(#goo-fill)') +
        tone('M70 116 C90 104 112 108 120 118 C102 116 86 120 74 130 Z M160 100 C176 100 188 108 190 120 C180 112 170 110 160 112 Z', '#ECFCCB', 0.8) +
        `<path d="M72 184 C70 200 76 210 82 214" fill="none" stroke="#4D7C0F" stroke-width="10" stroke-linecap="round">${loop('d', 'M72 184 C70 200 76 210 82 214;M72 184 C70 206 76 220 80 230;M72 184 C70 200 76 210 82 214', s)}</path>` +
      `</g>`,
      ...[[90, 130, 0], [150, 120, 1], [176, 150, 2], [118, 160, 3]].map(([x, y, i]) => {
        const b = -(i! * s) / 4
        return `<g><circle cx="${x}" cy="${y}" r="0" fill="#D9F99D" stroke="${INK}" stroke-width="3">${loop('r', '0;12;14;0', s, b, ' keyTimes="0;0.6;0.7;1"')}</circle><circle cx="${x! - 4}" cy="${y! - 4}" r="0" fill="#FFFFFF">${loop('r', '0;3;3;0', s, b, ' keyTimes="0;0.6;0.7;1"')}</circle></g>`
      }),
      ...[0, 1].map((i) => `<circle cx="${110 + i * 40}" cy="110" r="4" fill="#D9F99D">${loop('cy', '110;60', s, -(i * s) / 2)}${loop('opacity', '1;0', s, -(i * s) / 2)}</circle>`),
    )
  },

  rocket: () => {
    const s = D.rocket!
    return group('rocket-proj',
      defs(linear('rocket-body', [[0, '#FFFFFF'], [0.5, '#E2E8F0'], [1, '#94A3B8']], 0, 0, 0, 1), glow('exhaust-glow', 5)),
      // exhaust plume (points left), flickering
      `<g filter="url(#exhaust-glow)"><g transform="rotate(-90 70 128)">${flame(70, 128, 96, ['#F97316', '#FDE047'], s / 2)}${flame(70, 128, 60, ['#FDE047', '#FFFFFF'], s / 3, s / 6)}</g></g>`,
      ...[0, 1, 2].map((i) => `<circle cx="40" cy="${118 + i * 10}" r="${10 + i * 2}" fill="#E2E8F0" opacity="0">${loop('cx', '60;-10', s, -(i * s) / 3)}${loop('r', '8;18', s, -(i * s) / 3)}${loop('opacity', '0.8;0', s, -(i * s) / 3)}</circle>`),
      `<g>${move('translate', '0 0;0 -2;0 2;0 0', s)}` +
        solid('M76 112 L72 84 L108 112 Z', '#EF4444', { strokeWidth: MINOR }) + solid('M76 144 L72 172 L108 144 Z', '#EF4444', { strokeWidth: MINOR }) +
        solid('M76 110 h104 c26 0 48 8 60 18 c-12 10 -34 18 -60 18 h-104 c-6 0 -10 -4 -10 -10 v-16 c0 -6 4 -10 10 -10 Z', 'url(#rocket-body)') +
        tone('M180 110 c26 0 48 8 60 18 c-12 10 -34 18 -60 18 Z', '#EF4444') +
        tone('M86 132 h94 v14 h-94 Z', '#94A3B8', 0.5) +
        `<circle cx="150" cy="122" r="10" fill="#38BDF8" stroke="${INK}" stroke-width="${DETAIL}"/>` + dot(147, 119, 3, '#FFFFFF') +
        line('M118 110 v36', '#EF4444', 6) +
        part('M66 116 h-10 v24 h10 Z', '#475569', { strokeWidth: 4 }) +
      `</g>`,
    )
  },

  banana: () => {
    const s = D.banana!
    return group('banana-peel',
      ripples(128, 172, 100, s, 2),
      `<ellipse cx="128" cy="172" rx="70" ry="14" fill="#0B3A52" opacity="0.3"/>`,
      `<g>${move('rotate', '-8 128 150;8 128 150;-8 128 150', s, 0, ease(2))}${move('translate', '0 0;0 -5;0 0', s, 0, ease(2))}` +
        // three floppy peel petals around a bright inner fruit
        solid('M128 160 C92 166 52 150 36 112 C62 132 96 136 122 130 Z', '#FDE047', { strokeWidth: MINOR }) +
        tone('M128 160 C96 164 60 150 44 124 C70 140 98 144 124 140 Z', '#EAB308') +
        solid('M128 160 C164 166 204 150 220 112 C194 132 160 136 134 130 Z', '#FACC15', { strokeWidth: MINOR }) +
        tone('M128 160 C160 164 196 150 212 124 C186 140 158 144 132 140 Z', '#CA8A04') +
        solid('M126 158 C118 120 104 90 80 70 C114 82 134 110 138 150 Z', '#FDE68A', { strokeWidth: MINOR }) +
        solid('M112 146 C108 116 116 90 128 72 C140 90 148 116 144 146 C138 166 118 166 112 146 Z', '#FEF9C3', { strokeWidth: MINOR }) +
        tone('M120 144 C118 120 122 100 128 88 C126 108 128 126 134 146 Z', '#FFFFFF', 0.8) +
        part('M123 74 h10 l-2 -14 h-6 Z', '#78350F', { strokeWidth: 4 }) +
        dot(72, 134, 3.5, '#92400E') + dot(186, 136, 3.5, '#92400E') + dot(100, 92, 3, '#92400E') +
      `</g>`,
    )
  },

  // ─── Duck status overlays ───────────────────────────────────────────────
  'nitro-flame': () => {
    const s = D['nitro-flame']!
    return group('nitro',
      defs(glow('nitro-glow', 6)),
      `<g filter="url(#nitro-glow)"><g transform="rotate(-90 196 132)">` +
        flame(196, 132, 170, ['#2563EB', '#38BDF8'], s, 0) +
        flame(196, 132, 120, ['#7DD3FC', '#E0F2FE'], s * 0.66, s / 4) +
        flame(196, 132, 70, ['#FFFFFF', '#FFFFFF'], s / 2, s / 3) +
      `</g></g>`,
      ...Array.from({ length: 6 }, (_, i) => `<circle cx="150" cy="${112 + (i % 3) * 14}" r="${3 + (i % 2) * 2}" fill="${i % 2 ? '#FDE047' : '#E0F2FE'}">${loop('cx', '170;10', s, -(i * s) / 6, ' calcMode="linear"')}${loop('opacity', '1;0', s, -(i * s) / 6)}</circle>`),
    )
  },

  'wind-streak': () => {
    const s = D['wind-streak']!
    return group('wind',
      ...[[96, 6, '#E0F2FE'], [118, 4, '#7DD3FC'], [140, 7, '#FFFFFF'], [162, 4, '#7DD3FC'], [182, 5, '#E0F2FE']].map(([y, w, c], i) =>
        `<path d="M250 ${y} C190 ${(y as number) - 10} 120 ${(y as number) + 8} 6 ${y}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-dasharray="70 190" opacity="0.85">${loop('stroke-dashoffset', '0;260', s, -(i * s) / 5, ' calcMode="linear"')}</path>`),
    )
  },

  'shield-bubble': () => {
    const s = D['shield-bubble']!
    return group('shield',
      defs(
        radial('shield-fill', [[0, '#E0F2FE', 0.05], [0.8, '#A5F3FC', 0.18], [1, '#67E8F9', 0.45]]),
        `<linearGradient id="shield-rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F0ABFC">${loop('stop-color', '#F0ABFC;#67E8F9;#FDE68A;#F0ABFC', s)}</stop><stop offset="0.5" stop-color="#67E8F9">${loop('stop-color', '#67E8F9;#FDE68A;#F0ABFC;#67E8F9', s)}</stop><stop offset="1" stop-color="#FDE68A">${loop('stop-color', '#FDE68A;#F0ABFC;#67E8F9;#FDE68A', s)}</stop></linearGradient>`,
        glow('shield-glow', 4),
      ),
      `<g>${move('scale', '1 1;1.03 0.97;0.97 1.03;1 1', s)}` +
        around(128, 128, '', `<circle cx="128" cy="128" r="104" fill="url(#shield-fill)"/><circle cx="128" cy="128" r="104" fill="none" stroke="url(#shield-rim)" stroke-width="7" filter="url(#shield-glow)"/>`) +
      `</g>`,
      `<g>${move('rotate', '0 128 128;360 128 128', s, 0, ' calcMode="linear"')}<path d="M60 70 A96 96 0 0 1 128 32" fill="none" stroke="#FFFFFF" stroke-width="10" stroke-linecap="round" opacity="0.85"/><circle cx="72" cy="196" r="6" fill="#FFFFFF" opacity="0.7"/></g>`,
      spark(186, 64, 8, s, s / 2),
    )
  },

  dizzy: () => {
    const s = D.dizzy!
    return group('dizzy-orbit',
      `<ellipse cx="128" cy="128" rx="86" ry="30" fill="none" stroke="#FDE68A" stroke-width="3" stroke-dasharray="8 10" opacity="0.6"/>`,
      ...[0, 1, 2].map((i) => `<g>${star5(0, 0, 18 - i * 3, i === 1 ? '#F472B6' : '#FDE047')}<animateMotion dur="${s}s" begin="${-(i * s) / 3}s" repeatCount="indefinite" path="M128 98 a86 30 0 1 1 -0.1 0"/></g>`),
    )
  },

  silenced: () => {
    const s = D.silenced!
    return group('silenced-mark',
      pulse(128, 128, 1.1, s,
        `<circle cx="128" cy="128" r="70" fill="#1E1B2E" stroke="${INK}" stroke-width="${MAJOR}"/>` +
        solid('M88 110 h22 l34 -26 v88 l-34 -26 h-22 Z', '#94A3B8', { strokeWidth: MINOR }) +
        `<circle cx="128" cy="128" r="70" fill="none" stroke="#EF4444" stroke-width="12"/>` + line('M80 176 L176 80', '#EF4444', 12)),
    )
  },

  'feather-orbit': () => {
    const s = D['feather-orbit']!
    return group('feathers',
      ...[0, 1, 2].map((i) => `<g>${featherShape(0, 0, 30, 0.8)}<animateMotion dur="${s}s" begin="${-(i * s) / 3}s" repeatCount="indefinite" rotate="auto" path="M128 60 a96 70 0 1 1 -0.1 0"/></g>`),
    )
  },

  'target-lock': () => {
    const s = D['target-lock']!
    return group('reticle',
      defs(glow('reticle-glow', 3)),
      `<g filter="url(#reticle-glow)">` +
        `<g>${move('rotate', '0 128 128;90 128 128', s, 0, ' calcMode="linear"')}` +
          [0, 90, 180, 270].map((a) => `<path transform="rotate(${a} 128 128)" d="M128 28 A100 100 0 0 1 198 58" fill="none" stroke="#EF4444" stroke-width="10" stroke-linecap="round"/>`).join('') +
        `</g>` +
        `<g>${move('scale', '1;0.85;1', s, 0, ease(2))}` + around(128, 128, '', line('M128 70 V100 M128 156 V186 M70 128 H100 M156 128 H186', '#FCA5A5', 6) + `<circle cx="128" cy="128" r="10" fill="#EF4444"/>`) + `</g>` +
      `</g>`,
    )
  },

  // ─── One-shot effects ───────────────────────────────────────────────────
  explosion: () => {
    const s = D.explosion!
    return group('boom',
      defs(radial('boom-core', [[0, '#FFFFFF'], [0.3, '#FDE047'], [0.65, '#F97316'], [1, '#DC2626', 0]])),
      `<circle cx="128" cy="128" r="10" fill="#FFFFFF">${shot('r', '10;90;100', '0;0.2;1', s)}${shot('opacity', '1;0.6;0;0', '0;0.2;0.45;1', s)}</circle>`,
      `<circle cx="128" cy="128" r="20" fill="url(#boom-core)">${shot('r', '20;96;110', '0;0.35;1', s)}${shot('opacity', '1;1;0', '0;0.5;1', s)}</circle>`,
      ...[[96, 104, 38], [160, 108, 34], [128, 156, 40], [100, 152, 30], [160, 156, 28]].map(([x, y, r]) =>
        `<circle cx="${x}" cy="${y}" r="0" fill="#64748B" opacity="0">${shot('r', `0;${r};${r! * 1.3}`, '0;0.5;1', s)}${shot('opacity', '0;0.7;0', '0;0.45;1', s)}</circle>`),
      `<circle cx="128" cy="128" r="30" fill="none" stroke="#FDE68A" stroke-width="10">${shot('r', '30;120', '0;1', s)}${shot('stroke-width', '10;1', '0;1', s)}${shot('opacity', '1;0', '0;1', s)}</circle>`,
      radiate({ count: 10, cx: 128, cy: 128, distance: 110, seconds: s, gravity: 30, spin: true, draw: (x, y, i) => i % 2 ? `<path d="M${x - 6} ${y - 4} l12 -3 l-2 12 Z" fill="#475569" stroke="${INK}" stroke-width="2"/>` : `<circle cx="${x}" cy="${y}" r="5" fill="#FDE047"/>` }),
    )
  },

  splash: () => {
    const s = D.splash!
    return group('splash-crown',
      `<ellipse cx="128" cy="170" rx="20" ry="6" fill="none" stroke="#E0F2FE" stroke-width="7">${shot('rx', '20;110', '0;1', s)}${shot('ry', '6;24', '0;1', s)}${shot('opacity', '1;0', '0;1', s)}</ellipse>`,
      ...[-60, -32, 0, 32, 60].map((dx, i) =>
        `<path d="M${128 + dx} 170 C${128 + dx - 6} 150 ${128 + dx + 6} 130 ${128 + dx * 1.3} 110" fill="none" stroke="#BAE6FD" stroke-width="${12 - Math.abs(dx) / 10}" stroke-linecap="round" opacity="0">${shot('opacity', '0;1;0', '0;0.3;1', s)}${shotMove('translate', `0 30;0 ${-20 - (i % 2) * 12};0 40`, '0;0.4;1', s)}</path>`),
      radiate({ count: 9, cx: 128, cy: 140, distance: 100, seconds: s, gravity: 80, startAngle: -Math.PI, draw: (x, y) => `<path d="M${x} ${y - 8} C${x + 7} ${y} ${x + 5} ${y + 7} ${x} ${y + 7} C${x - 5} ${y + 7} ${x - 7} ${y} ${x} ${y - 8} Z" fill="#E0F2FE" stroke="${INK}" stroke-width="2"/>` }),
    )
  },

  'bubble-pop': () => {
    const s = D['bubble-pop']!
    return group('pop',
      `<circle cx="128" cy="128" r="96" fill="#A5F3FC" fill-opacity="0.15" stroke="#E0F2FE" stroke-width="6">${shot('r', '96;104;110;110', '0;0.25;0.35;1', s)}${shot('opacity', '1;1;0;0', '0;0.3;0.38;1', s)}</circle>`,
      `<circle cx="128" cy="128" r="104" fill="none" stroke="#FFFFFF" stroke-width="4" stroke-dasharray="10 16">${shot('r', '104;104;124', '0;0.35;1', s)}${shot('opacity', '0;0;1;0', '0;0.34;0.4;1', s)}</circle>`,
      radiate({ count: 12, cx: 128, cy: 128, distance: 120, seconds: s, draw: (x, y, i) => `<circle cx="${x}" cy="${y}" r="${4 + (i % 3)}" fill="#E0F2FE" stroke="${INK}" stroke-width="2"/>` }),
    )
  },

  'horn-wave': () => {
    const s = D['horn-wave']!
    return group('horn',
      ...[0, 1, 2].map((i) => `<circle cx="128" cy="128" r="20" fill="none" stroke="${i === 1 ? '#FDE047' : '#FDBA74'}" stroke-width="10" opacity="0">${shot('r', `20;20;${110 + i * 4}`, `0;${i * 0.18};1`, s)}${shot('opacity', `0;0;1;0`, `0;${i * 0.18};${i * 0.18 + 0.05};1`, s)}${shot('stroke-width', '10;10;2', `0;${i * 0.18};1`, s)}</circle>`),
      pulse(128, 128, 1.2, s,
        solid('M98 112 h20 l38 -28 v88 l-38 -28 h-20 Z', '#F97316', { strokeWidth: MINOR }) + tone('M118 112 l38 -28 v20 l-38 18 Z', '#FDBA74')),
      ...[0, 1].map((i) => `<text x="${170 + i * 22}" y="${96 + i * 18}" font-size="${30 - i * 6}" font-family="Arial Black, sans-serif" fill="#FDE047" stroke="${INK}" stroke-width="3" paint-order="stroke">♪${shot('opacity', '0;1;0', '0;0.3;1', s)}${shotMove('translate', `0 0;${10 + i * 6} -30`, '0;1', s)}</text>`),
    )
  },

  'sparkle-burst': () => {
    const s = D['sparkle-burst']!
    return group('sparkles',
      `<circle cx="128" cy="128" r="16" fill="none" stroke="#A5F3FC" stroke-width="8">${shot('r', '16;96', '0;1', s)}${shot('opacity', '1;0', '0;1', s)}</circle>`,
      radiate({ count: 8, cx: 128, cy: 128, distance: 100, seconds: s, draw: (x, y, i) => sparkle(x, y, i % 2 ? 10 : 15, i % 3 ? '#FFFBEA' : '#A5F3FC') }),
    )
  },

  'coin-burst': () => {
    const s = D['coin-burst']!
    const coin = (x: number, y: number) => `<g><ellipse cx="${x}" cy="${y}" rx="14" ry="14" fill="#FACC15" stroke="${INK}" stroke-width="3">${shot('rx', '14;3;14;3;14', '0;0.25;0.5;0.75;1', s)}</ellipse><text x="${x}" y="${y + 6}" text-anchor="middle" font-size="16" font-family="Arial Black, sans-serif" fill="#B45309">★</text></g>`
    return group('coins',
      `<g opacity="0.8">${shotMove('rotate', '0 128 128;60 128 128', '0;1', s)}${shot('opacity', '0.9;0', '0;1', s)}${Array.from({ length: 8 }, (_, i) => `<path transform="rotate(${i * 45} 128 128)" d="M122 128 L114 20 L142 20 L134 128 Z" fill="#FFF7CC" opacity="0.45"/>`).join('')}</g>`,
      radiate({ count: 9, cx: 128, cy: 140, distance: 100, seconds: s, gravity: 60, startAngle: -Math.PI * 0.95, draw: coin }),
      spark(128, 100, 22, s, 0),
    )
  },

  'feather-puff': () => {
    const s = D['feather-puff']!
    return group('puff',
      `<circle cx="128" cy="128" r="20" fill="#F1F5F9" opacity="0.7">${shot('r', '20;80', '0;1', s)}${shot('opacity', '0.7;0', '0;1', s)}</circle>`,
      radiate({ count: 7, cx: 128, cy: 128, distance: 96, seconds: s, gravity: 40, spin: true, draw: (x, y, i) => featherShape(x, y, i * 50, 0.7) }),
    )
  },

  'nitro-ignite': () => {
    const s = D['nitro-ignite']!
    return group('ignite',
      defs(glow('ignite-glow', 5)),
      `<g filter="url(#ignite-glow)">` +
        `<ellipse cx="128" cy="128" rx="20" ry="12" fill="none" stroke="#38BDF8" stroke-width="12">${shot('rx', '20;120', '0;1', s)}${shot('ry', '12;64', '0;1', s)}${shot('opacity', '1;0', '0;1', s)}</ellipse>` +
        `<ellipse cx="128" cy="128" rx="10" ry="6" fill="none" stroke="#FFFFFF" stroke-width="6">${shot('rx', '10;90', '0;1', s)}${shot('ry', '6;48', '0;1', s)}${shot('opacity', '1;0;0', '0;0.8;1', s)}</ellipse>` +
        radiate({ count: 8, cx: 128, cy: 128, distance: 110, seconds: s, draw: (x, y, i) => `<path d="M${x} ${y} l10 -4 l-6 -10 l14 -6" fill="none" stroke="${i % 2 ? '#FDE047' : '#7DD3FC'}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>` }) +
      `</g>`,
    )
  },

  'slip-stars': () => {
    const s = D['slip-stars']!
    return group('slip',
      `<path d="M128 128 m-10 0 a10 10 0 1 1 20 0 a20 20 0 1 1 -40 0 a30 30 0 1 1 60 0 a40 40 0 1 1 -80 0" fill="none" stroke="#FDE68A" stroke-width="6" stroke-linecap="round">${shotMove('rotate', '0 128 128;540 128 128', '0;1', s)}${shot('opacity', '1;1;0', '0;0.6;1', s)}</path>`,
      radiate({ count: 6, cx: 128, cy: 128, distance: 90, seconds: s, spin: true, draw: (x, y, i) => star5(x, y, 12, i % 2 ? '#FDE047' : '#F472B6') }),
    )
  },

  confetti: () => {
    const s = D.confetti!
    const colors = ['#EF4444', '#FDE047', '#22C55E', '#38BDF8', '#A855F7', '#F472B6']
    return group('confetti-burst',
      `<circle cx="128" cy="128" r="10" fill="#FFF3A6">${shot('r', '10;70;70', '0;0.4;1', s)}${shot('opacity', '1;0;0', '0;0.4;1', s)}</circle>`,
      radiate({ count: 18, cx: 128, cy: 128, distance: 120, seconds: s, gravity: 70, spin: true, draw: (x, y, i) => i % 3 === 0
        ? `<path d="M${x - 10} ${y} q5 -8 10 0 t10 0" fill="none" stroke="${colors[i % 6]}" stroke-width="5" stroke-linecap="round"/>`
        : `<rect x="${x - 6}" y="${y - 4}" width="12" height="8" rx="2" fill="${colors[i % 6]}" stroke="${INK}" stroke-width="1.5"/>` }),
      radiate({ count: 6, cx: 128, cy: 128, distance: 70, seconds: s, startAngle: 0.5, draw: (x, y) => sparkle(x, y, 12, '#FFFBEA') }),
    )
  },
}

// ─── Item icons (static, 128×128) ─────────────────────────────────────────
export const RACE_ICON_ART: Record<string, () => string> = {
  nitro: () => group('i-nitro',
    defs(linear('i-nitro-can', [[0, '#93C5FD'], [1, '#1D4ED8']], 1, 0, 0, 1)),
    solid('M42 30 h44 a10 10 0 0 1 10 10 v66 a10 10 0 0 1 -10 10 h-44 a10 10 0 0 1 -10 -10 v-66 a10 10 0 0 1 10 -10 Z', 'url(#i-nitro-can)'),
    part('M54 14 h20 v16 h-20 Z', '#475569'), tone('M44 36 h8 v66 h-8 Z', '#DBEAFE', 0.7),
    solid('M70 44 L52 76 H66 L58 102 L82 66 H68 L76 44 Z', '#FDE047', { strokeWidth: 5 }),
  ),
  'draft-fin': () => group('i-fin',
    solid('M30 92 C46 60 64 30 90 18 C86 46 92 72 104 92 Z', '#64748B'), tone('M30 92 C46 60 64 30 90 18 C80 50 76 72 74 92 Z', '#94A3B8', 0.7),
    `<path d="M10 96 q14 -12 28 0 t28 0 t28 0 t28 0" fill="none" stroke="${INK}" stroke-width="12" stroke-linecap="round"/><path d="M10 96 q14 -12 28 0 t28 0 t28 0 t28 0" fill="none" stroke="#38BDF8" stroke-width="6" stroke-linecap="round"/>`,
  ),
  'paddle-burst': () => group('i-paddle',
    line('M26 104 L98 28', INK, 14), line('M26 104 L98 28', '#B45309', 7), solid('M86 20 C98 8 118 10 116 26 C114 40 98 44 90 38 Z', '#F59E0B'),
    line('M30 28 L102 104', INK, 14), line('M30 28 L102 104', '#92400E', 7), solid('M20 20 C8 32 10 52 26 50 C40 48 44 32 38 24 Z', '#FBBF24'),
    dot(64, 112, 6, '#7DD3FC', { stroke: INK, strokeWidth: 3 }), dot(46, 116, 4, '#7DD3FC', { stroke: INK, strokeWidth: 3 }),
  ),
  'bubble-shield': () => group('i-bubble',
    defs(radial('i-bubble-fill', [[0, '#E0F2FE', 0.4], [1, '#38BDF8', 0.85]], 0.4, 0.35, 0.7)),
    `<circle cx="64" cy="64" r="48" fill="url(#i-bubble-fill)" stroke="${INK}" stroke-width="${MAJOR - 4}"/>`,
    line('M34 46 A34 34 0 0 1 60 26', '#FFFFFF', 9), dot(88, 92, 6, '#FFFFFF', { opacity: 0.8 }),
  ),
  feather: () => group('i-feather', featherShape(64, 64, 35, 1.9)),
  'shock-absorber': () => group('i-vest',
    solid('M36 26 L54 20 C58 30 70 30 74 20 L92 26 L100 58 L96 108 H32 L28 58 Z', '#F97316'),
    tone('M36 26 L54 20 C56 26 60 28 64 28 L64 108 H32 L28 58 Z', '#FDBA74', 0.6),
    line('M30 62 H98 M32 84 H96', '#FFFFFF', 7), line('M64 30 V108', INK, 4),
  ),
  'homing-rocket': () => group('i-rocket',
    `<g transform="rotate(-40 64 64)">${solid('M24 52 h56 c18 0 30 6 38 12 c-8 6 -20 12 -38 12 h-56 Z', '#F1F5F9')}${tone('M80 52 c18 0 30 6 38 12 c-8 6 -20 12 -38 12 Z', '#EF4444')}${solid('M28 52 L36 34 L50 52 Z M28 76 L36 94 L50 76 Z', '#EF4444', { strokeWidth: MINOR })}<circle cx="78" cy="64" r="7" fill="#38BDF8" stroke="${INK}" stroke-width="4"/><path d="M24 56 C10 58 2 64 -4 64 C2 64 10 70 24 72 Z" fill="#F97316" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/><path d="M24 60 C16 61 10 64 6 64 C10 64 16 67 24 68 Z" fill="#FDE047"/></g>`,
  ),
  banana: () => group('i-banana',
    solid('M20 30 C20 84 58 114 112 104 C72 96 46 70 42 26 Z', '#FDE047', { strokeWidth: MINOR }), tone('M42 26 C46 70 72 96 112 104 C86 104 62 92 50 72 Z', '#EAB308'),
    tone('M26 40 C28 74 48 96 80 104 C52 92 36 70 32 40 Z', '#FEF9C3', 0.9),
    part('M26 36 l4 -12 l12 4 l-2 8 Z', '#78350F', { strokeWidth: 4 }), dot(100, 98, 4, '#78350F'),
  ),
  'quack-horn': () => group('i-horn',
    solid('M18 52 h18 l50 -30 v84 l-50 -30 h-18 Z', '#F97316'), tone('M36 52 l50 -30 v22 l-50 22 Z', '#FDBA74'),
    part('M24 76 l6 26 h12 l-4 -26 Z', '#475569', { strokeWidth: 5 }),
    line('M96 46 C106 54 106 74 96 82 M106 34 C122 50 122 78 106 94', '#FDE047', 7),
  ),
  tailwind: () => group('i-wind',
    line('M14 50 H76 C96 50 98 24 80 22 C68 22 64 34 72 40', INK, 13), line('M14 50 H76 C96 50 98 24 80 22 C68 22 64 34 72 40', '#7DD3FC', 7),
    line('M14 74 H94 C114 74 116 102 98 104 C86 104 82 92 90 86', INK, 13), line('M14 74 H94 C114 74 116 102 98 104 C86 104 82 92 90 86', '#E0F2FE', 7),
    line('M22 96 H56', INK, 11), line('M22 96 H56', '#7DD3FC', 5),
  ),
  magnet: () => group('i-magnet',
    solid('M30 28 h22 v44 c0 8 6 14 12 14 s12 -6 12 -14 v-44 h22 v44 c0 22 -16 38 -34 38 s-34 -16 -34 -38 Z', '#EF4444'),
    part('M30 28 h22 v16 h-22 Z M76 28 h22 v16 h-22 Z', '#E2E8F0'),
    line('M16 18 l8 8 M112 18 l-8 8 M64 6 v10', '#38BDF8', 6),
  ),
}

// ─── Bank decor (static, 128×128) ─────────────────────────────────────────
export const RACE_DECOR_ART: Record<string, () => string> = {
  lilypad: () => group('d-lily',
    solid('M64 26 C98 26 118 46 118 68 C118 92 94 106 64 106 C34 106 10 92 10 68 C10 46 30 26 58 26 L64 66 Z', '#22C55E'),
    tone('M64 30 C94 32 112 48 114 66 C102 52 86 42 64 40 Z', '#86EFAC', 0.8), line('M64 66 L30 52 M64 66 L96 46 M64 66 L72 100', '#15803D', 3),
  ),
  lotus: () => group('d-lotus',
    solid('M64 56 C90 56 108 66 108 80 C108 96 88 104 64 104 C40 104 20 96 20 80 C20 66 38 56 58 56 Z', '#16A34A'),
    ...[-36, -18, 0, 18, 36].map((a) => `<path transform="rotate(${a} 64 80)" d="M64 80 C52 66 54 40 64 28 C74 40 76 66 64 80 Z" fill="${a === 0 ? '#FBCFE8' : '#F9A8D4'}" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>`),
    dot(64, 72, 7, '#FDE047', { stroke: INK, strokeWidth: 3 }),
  ),
  reeds: () => group('d-reeds',
    ...[[40, 0], [58, 1], [76, 2], [92, 3]].map(([x, i]) => line(`M${x} 120 C${x! - 6} 90 ${x! + 4} 60 ${x! - 2} ${30 + (i! % 2) * 14}`, i! % 2 ? '#4D7C0F' : '#65A30D', 6)),
    ...[[38, 34], [74, 40]].map(([x, y]) => part(`M${x! - 5} ${y} h10 v26 h-10 Z`, '#92400E', { strokeWidth: 3, rx: 5 })),
    `<path d="M20 120 C30 100 40 96 50 120 M80 120 C92 98 104 96 112 120" fill="#4D7C0F" stroke="${INK}" stroke-width="3"/>`,
  ),
  rock: () => group('d-rock',
    solid('M18 100 C14 76 30 52 56 48 C78 40 104 52 112 74 C118 92 108 106 88 108 L36 110 C26 110 20 106 18 100 Z', '#94A3B8'),
    tone('M30 70 C42 54 62 50 80 54 C64 58 48 66 40 80 Z', '#CBD5E1', 0.8), tone('M18 100 C40 104 80 106 110 94 C104 106 92 110 70 110 L36 110 Z', '#64748B', 0.8),
    tone('M60 50 C72 42 92 46 100 58 C90 54 74 52 60 56 Z', '#65A30D', 0.9),
  ),

  // ── Neon Canal ──
  'neon-lamp': () => group('d-neon-lamp',
    defs(glow('d-neon-lamp-glow', 4), radial('d-neon-lamp-halo', [[0, '#22E9FF', 0.65], [1, '#22E9FF', 0]])),
    dot(86, 46, 36, 'url(#d-neon-lamp-halo)'),
    line('M62 116 V46 C62 32 68 26 82 26', INK, 14), line('M62 116 V46 C62 32 68 26 82 26', '#4C3F8F', 6),
    part('M66 18 H108 L100 38 H74 Z', '#4C3F8F'),
    `<g filter="url(#d-neon-lamp-glow)">${line('M80 42 H94', '#22E9FF', 6)}${line('M58 64 V100', '#FF2BD6', 4)}</g>`,
    part('M44 112 H76 V122 H44 Z', '#2A2350', { rx: 3 }),
  ),
  'neon-sign': () => group('d-neon-sign',
    defs(glow('d-neon-sign-glow', 3)),
    part('M32 70 H42 V122 H32 Z', '#2A2350'), part('M86 70 H96 V122 H86 Z', '#2A2350'),
    solid('M18 14 H110 A8 8 0 0 1 118 22 V68 A8 8 0 0 1 110 76 H18 A8 8 0 0 1 10 68 V22 A8 8 0 0 1 18 14 Z', '#140F2E'),
    `<g filter="url(#d-neon-sign-glow)">`,
    line('M22 24 H106 V66 H22 Z', '#FF2BD6', 3),
    line('M28 58 C28 50 36 48 42 52 C40 42 46 34 54 36 C60 38 60 46 56 50 C62 54 62 62 56 64 H34 C30 64 28 62 28 58 Z', '#22E9FF', 4),
    line('M58 40 L68 42 L58 46', '#FDE047', 4), dot(53, 40, 2.5, '#22E9FF'),
    line('M88 30 L80 44 H90 L82 58', '#FDE047', 4),
    `</g>`,
  ),
  'neon-roof': () => group('d-neon-roof',
    defs(glow('d-neon-roof-glow', 3)),
    solid('M14 14 H114 V114 H14 Z', '#1E1846', { rx: 6 }),
    tone('M24 24 H104 V104 H24 Z', '#2A2160'),
    `<g filter="url(#d-neon-roof-glow)">${line('M20 20 H108 V108 H20 Z', '#FF2BD6', 3)}` +
      [[34, 36, '#22E9FF'], [50, 36, '#FDE047'], [34, 52, '#FF2BD6'], [50, 52, '#22E9FF'], [34, 68, '#22E9FF'], [50, 84, '#FF2BD6'], [34, 84, '#FDE047']]
        .map(([x, y, c]) => `<rect x="${x}" y="${y}" width="9" height="9" rx="2" fill="${c}"/>`).join('') + `</g>`,
    part('M68 36 H98 V62 H68 Z', '#3B2F6E', { rx: 3 }), line('M72 44 H94 M72 50 H94 M72 56 H94', '#140F2E', 3),
    part('M70 74 H98 V98 H70 Z', '#3B2F6E', { rx: 14 }), dot(84, 86, 6, '#140F2E'),
  ),
  'neon-buoy': () => group('d-neon-buoy',
    defs(glow('d-neon-buoy-glow', 4)),
    `<circle cx="64" cy="64" r="52" fill="none" stroke="#22E9FF" stroke-width="3" opacity="0.35"/>`,
    solid('M64 22 A42 42 0 1 1 63.9 22 Z', '#1B1640'),
    `<g filter="url(#d-neon-buoy-glow)"><circle cx="64" cy="64" r="28" fill="none" stroke="#FF2BD6" stroke-width="6"/>${dot(64, 64, 9, '#22E9FF')}</g>`,
  ),

  // ── Sakura Garden ──
  'sakura-tree': () => {
    const blooms: Array<[number, number, number]> = [[38, 50, 24], [64, 34, 28], [92, 50, 24], [50, 68, 20], [80, 68, 20], [64, 58, 22]]
    return group('d-sakura',
      solid('M54 124 C58 104 56 92 48 80 L58 76 C62 84 64 88 66 78 L76 80 C72 96 70 110 74 124 Z', '#6B3F2A'),
      ...blooms.map(([x, y, r]) => dot(x, y, r + 5, INK)),
      ...blooms.map(([x, y, r]) => dot(x, y, r, '#F9A8D4')),
      ...blooms.map(([x, y, r]) => dot(x - r * 0.25, y - r * 0.3, r * 0.55, '#FBCFE8')),
      ...[[30, 44], [56, 26], [74, 40], [98, 46], [46, 66], [86, 72], [64, 56]].map(([x, y]) => dot(x!, y!, 3, '#EC4899')),
    )
  },
  'stone-lantern': () => group('d-lantern',
    part('M34 112 H94 V124 H34 Z', '#78716C', { rx: 3 }),
    part('M54 80 H74 V112 H54 Z', '#A8A29E'),
    part('M40 70 H88 V82 H40 Z', '#A8A29E', { rx: 3 }),
    part('M44 40 H84 V70 H44 Z', '#A8A29E'),
    tone('M54 46 H74 V64 H54 Z', '#FDBA74'), tone('M58 50 H70 V60 H58 Z', '#FEF3C7'),
    solid('M24 42 C40 36 52 22 64 16 C76 22 88 36 104 42 Z', '#78716C'),
    dot(64, 12, 7, '#A8A29E', { stroke: INK, strokeWidth: MINOR }),
    tone('M42 76 H86 V80 H42 Z', '#65A30D', 0.7),
  ),
  koi: () => group('d-koi',
    part('M64 96 C54 110 48 122 56 126 C60 118 64 112 64 106 C64 112 68 118 72 126 C80 122 74 110 64 96 Z', '#FDBA74'),
    part('M52 50 C40 50 34 58 36 64 C42 60 48 58 54 60 Z', '#FED7AA'), part('M76 50 C88 50 94 58 92 64 C86 60 80 58 74 60 Z', '#FED7AA'),
    solid('M64 18 C80 26 82 54 76 78 C72 92 68 100 64 104 C60 100 56 92 52 78 C46 54 48 26 64 18 Z', '#FFF7ED'),
    tone('M56 30 C64 24 74 32 72 44 C64 48 54 42 56 30 Z', '#F97316'),
    tone('M60 62 C68 58 76 66 72 80 C66 82 58 74 60 62 Z', '#EA580C'),
    dot(58, 28, 2.5, INK), dot(70, 28, 2.5, INK),
  ),
  'petal-raft': () => group('d-petals',
    ...[[44, 46, 20], [78, 40, 110], [86, 76, 200], [50, 84, 290], [64, 62, 60]].map(([x, y, a], i) =>
      `<path transform="rotate(${a} ${x} ${y})" d="M${x} ${y! + 16} C${x! - 14} ${y! + 4} ${x! - 10} ${y! - 14} ${x! - 2} ${y! - 16} L${x} ${y! - 10} L${x! + 2} ${y! - 16} C${x! + 10} ${y! - 14} ${x! + 14} ${y! + 4} ${x} ${y! + 16} Z" fill="${i % 2 ? '#FBCFE8' : '#F9A8D4'}" stroke="${INK}" stroke-width="${MINOR - 2}" stroke-linejoin="round"/>`),
    part('M96 100 C104 92 116 94 118 104 C108 110 100 108 96 100 Z', '#4ADE80'),
  ),

  // ── Aurora Glacier ──
  'snow-pine': () => group('d-pine',
    part('M58 104 H70 V124 H58 Z', '#7C4A2D'),
    ...[[34, 108, 64], [42, 80, 48], [50, 54, 34]].map(([half, base, height]) =>
      solid(`M${64 - half!} ${base} L64 ${base! - height!} L${64 + half!} ${base} Z`, '#166534')),
    ...[[34, 108, 64], [42, 80, 48], [50, 54, 34]].map(([half, base, height]) =>
      tone(`M${64 - half! * 0.45} ${base! - height! * 0.55} L64 ${base! - height!} L${64 + half! * 0.45} ${base! - height! * 0.55} C${64 + half! * 0.2} ${base! - height! * 0.45} ${64 - half! * 0.2} ${base! - height! * 0.48} ${64 - half! * 0.45} ${base! - height! * 0.55} Z`, '#FFFFFF')),
    tone('M30 108 C44 102 60 106 70 104 C82 102 92 104 98 108 Z', '#FFFFFF', 0.9),
  ),
  snowman: () => group('d-snowman',
    dot(64, 90, 30, '#F8FAFC', { stroke: INK, strokeWidth: MINOR }),
    dot(64, 44, 20, '#F8FAFC', { stroke: INK, strokeWidth: MINOR }),
    part('M46 26 H82 V20 H74 V2 H54 V20 H46 Z', '#1E293B'),
    part('M44 58 C56 64 72 64 84 58 L86 66 C72 72 56 72 42 66 Z', '#EF4444'), part('M74 64 L80 84 L70 84 L68 66 Z', '#DC2626'),
    dot(57, 40, 3, INK), dot(71, 40, 3, INK), part('M64 46 L82 50 L64 52 Z', '#FB923C', { strokeWidth: 4 }),
    dot(64, 84, 3.5, INK), dot(64, 98, 3.5, INK),
    tone('M42 82 C46 72 54 68 60 68 C52 74 48 80 46 90 Z', '#E2E8F0'),
  ),
  'ice-floe': () => group('d-floe',
    part('M22 54 L44 26 L84 22 L110 46 L104 86 L70 106 L32 96 Z', '#5AA6CC', { transform: 'translate(0 8)' }),
    part('M22 54 L44 26 L84 22 L110 46 L104 86 L70 106 L32 96 Z', '#E0F7FF'),
    tone('M30 54 L48 32 L80 28 L66 44 L40 58 Z', '#FFFFFF', 0.9),
    line('M60 60 L74 70 L72 86 M74 70 L90 64', '#8CCBE6', 3),
  ),
  penguin: () => group('d-penguin',
    part('M14 100 C20 86 44 82 64 82 C88 82 110 86 114 100 C108 114 84 118 64 118 C42 118 18 114 14 100 Z', '#E0F7FF'),
    solid('M64 14 C84 14 92 36 92 60 C92 86 82 100 64 100 C46 100 36 86 36 60 C36 36 44 14 64 14 Z', '#1E293B'),
    tone('M64 36 C78 36 82 54 82 68 C82 86 76 94 64 94 C52 94 46 86 46 68 C46 54 50 36 64 36 Z', '#F8FAFC'),
    dot(56, 32, 4, '#FFFFFF'), dot(72, 32, 4, '#FFFFFF'), dot(57, 32, 2, INK), dot(71, 32, 2, INK),
    part('M56 40 L64 48 L72 40 Z', '#FB923C', { strokeWidth: 4 }),
    part('M48 98 H60 V104 H48 Z', '#FB923C', { strokeWidth: 4, rx: 3 }), part('M68 98 H80 V104 H68 Z', '#FB923C', { strokeWidth: 4, rx: 3 }),
  ),

  // ── Sunset Lagoon ──
  palm: () => group('d-palm',
    ...[0, 52, 103, 154, 206, 257, 308].map((a, i) =>
      `<g transform="rotate(${a} 64 64)"><path d="M64 64 C50 50 50 22 64 4 C78 22 78 50 64 64 Z" fill="${i % 2 ? '#22C55E' : '#16A34A'}" stroke="${INK}" stroke-width="${MINOR - 2}" stroke-linejoin="round"/>${line('M64 60 C62 42 62 24 64 10', '#14532D', 2.5)}</g>`),
    dot(58, 60, 8, '#92400E', { stroke: INK, strokeWidth: 4 }), dot(70, 60, 8, '#92400E', { stroke: INK, strokeWidth: 4 }), dot(64, 70, 8, '#78350F', { stroke: INK, strokeWidth: 4 }),
  ),
  'tiki-torch': () => group('d-tiki',
    defs(radial('d-tiki-halo', [[0, '#FDBA74', 0.6], [1, '#FDBA74', 0]])),
    dot(64, 26, 30, 'url(#d-tiki-halo)'),
    part('M58 52 H70 V124 H58 Z', '#B45309'), line('M58 70 H70 M58 88 H70 M58 106 H70', '#78350F', 3),
    part('M46 40 H82 L76 58 H52 Z', '#92400E'), line('M50 46 L78 52 M52 52 L76 46', '#FDE68A', 2.5),
    solid('M64 8 C52 20 50 32 56 40 H72 C78 32 76 20 64 8 Z', '#F97316'),
    tone('M64 20 C58 28 58 34 60 40 H68 C70 34 70 28 64 20 Z', '#FDE047'),
  ),
  hibiscus: () => group('d-hibiscus',
    ...[0, 72, 144, 216, 288].map((a) =>
      `<path transform="rotate(${a} 64 64)" d="M64 64 C44 52 40 22 56 14 C62 12 64 18 64 18 C64 18 66 12 72 14 C88 22 84 52 64 64 Z" fill="#F43F5E" stroke="${INK}" stroke-width="${MINOR - 2}" stroke-linejoin="round"/>`),
    dot(64, 64, 14, '#BE123C'),
    line('M64 64 L86 44', '#FDE047', 4), dot(88, 42, 5, '#FDE047', { stroke: INK, strokeWidth: 3 }),
  ),
  coconut: () => group('d-coconut',
    solid('M64 18 A46 46 0 1 1 63.9 18 Z', '#7C4A2D'),
    tone('M36 46 C44 30 60 26 74 28 C58 34 46 44 40 60 Z', '#A16207', 0.8),
    line('M40 80 C52 88 70 90 88 82 M34 64 C48 74 76 76 94 66', '#5B3420', 3),
    dot(54, 50, 5, '#3B2416'), dot(72, 50, 5, '#3B2416'), dot(63, 64, 5, '#3B2416'),
  ),
}
