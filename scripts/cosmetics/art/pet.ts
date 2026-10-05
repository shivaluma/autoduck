import {
  INK, MINOR, animate, animateTransform, blink, clipped, burst, defs, dot, flame, glow, group, hover, line, linear, metal, motes, part,
  pulse, radial, sway, sweepBand, tone,
} from '../kit'

// Pets are drawn in local space: origin = ground contact, x grows right, y grows up as negative.
// Placed at PET_RIGHT (446, 436) at 1.2×. Target height ≈ 120–160px (18–28% of the duck's volume).
const place = (id: string, content: string, options: { shadow?: number; float?: boolean } = {}) => group(id,
  options.shadow === 0 ? '' : `<ellipse cx="446" cy="436" rx="${(options.shadow ?? 44) * 1.2}" ry="9" fill="#100A20" opacity="${options.float ? 0.16 : 0.26}"/>`,
  `<g transform="translate(446 436) scale(1.2)">${content}</g>`,
)

/** Pet eyes; uncommon+ pets blink (common pets stay static per the rarity motion budget). */
const eyes = (lx: number, ly: number, rx: number, ry: number, r = 6, alive = true) => {
  const eye = (x: number, y: number) => dot(x, y, r, INK) + dot(x + r * 0.35, y - r * 0.35, r * 0.35, '#FFFFFF')
  return alive ? blink(lx, ly, 3.6, eye(lx, ly)) + blink(rx, ry, 3.6, eye(rx, ry)) : eye(lx, ly) + eye(rx, ry)
}

const bob = (seconds = 2.4, distance = 6) => animateTransform('translate', `0 0; 0 ${-distance}; 0 0`, seconds)

export const PET_ART: Record<string, () => string> = {
  // ─── COMMON — static, 2 values ───────────────────────────────────────────
  'pet-rubber-duckling': () => place('duckling',
    part('M-44 -26 C-46 -54 -10 -64 18 -56 C34 -52 42 -40 40 -24 C40 -6 20 0 -6 0 C-30 0 -44 -10 -44 -26 Z', '#FFD84D') +
    tone('M-44 -26 C-40 -8 -20 -2 0 -2 C20 -2 34 -8 40 -22 C34 0 10 4 -10 2 C-30 0 -46 -10 -44 -26 Z', '#E5A812') +
    part('M-6 -64 C-10 -90 8 -108 30 -104 C50 -100 56 -78 46 -62 C34 -50 6 -48 -6 -64 Z', '#FFD84D') +
    part('M46 -82 C58 -84 70 -80 74 -74 C68 -66 56 -66 46 -70 Z', '#FF9B42') +
    eyes(22, -84, 38, -82, 4.5, false) + tone('M-26 -34 C-14 -44 6 -44 14 -34 C2 -30 -14 -28 -26 -34 Z', '#FFF1A8'),
    { shadow: 40 }),

  'pet-origami-frog': () => place('origami-frog',
    part('M-50 0 L-30 -50 L0 -66 L34 -50 L52 0 Z', '#4ADE80') +
    tone('M-50 0 L-30 -50 L0 -66 L-6 0 Z', '#16A34A') +
    line('M-30 -50 L-6 0 M34 -50 L-6 0 M0 -66 L-6 0', '#14532D', 3, { opacity: 0.6 }) +
    part('M-34 -50 L-24 -80 L-6 -60 Z', '#86EFAC') + part('M6 -62 L22 -84 L36 -52 Z', '#86EFAC') +
    eyes(-22, -64, 20, -66, 5, false) +
    part('M-64 0 L-44 -16 L-36 0 Z', '#22C55E') + part('M66 0 L44 -16 L38 0 Z', '#22C55E'),
    { shadow: 50 }),

  'pet-office-mouse': () => place('office-mouse',
    line('M-46 -20 C-80 -30 -84 -70 -60 -80 C-40 -88 -30 -66 -48 -60', INK, 7) + line('M-46 -20 C-80 -30 -84 -70 -60 -80 C-40 -88 -30 -66 -48 -60', '#94A3B8', 3) +
    part('M-44 -26 C-46 -72 -6 -90 22 -84 C50 -78 56 -46 50 -20 C46 -4 26 0 0 0 C-28 0 -42 -10 -44 -26 Z', '#E2E8F0') +
    tone('M-44 -26 C-40 -8 -20 -2 0 -2 C24 -2 44 -6 50 -20 C48 0 22 4 -4 2 C-30 0 -46 -10 -44 -26 Z', '#94A3B8') +
    line('M6 -84 L4 -50 M-40 -50 C-20 -54 30 -54 52 -48', '#94A3B8', 4) +
    part('M0 -76 h8 v16 h-8 Z', '#475569', { strokeWidth: 3 }) +
    eyes(-6, -32, 22, -32, 5, false) + tone('M0 -18 q8 6 16 0', 'none') + line('M2 -20 q6 6 12 0', INK, 3),
    { shadow: 46 }),

  'pet-bread-pigeon': () => place('bread-pigeon',
    line('M-6 0 l-6 -18 M10 0 l2 -18', '#F97316', 5) +
    part('M-48 -30 C-50 -64 -10 -78 18 -68 C40 -60 46 -40 40 -24 C34 -10 14 -10 -10 -12 C-30 -14 -46 -18 -48 -30 Z', '#94A3B8') +
    tone('M-48 -30 C-40 -16 -20 -12 0 -12 C18 -12 32 -14 40 -24 C36 -6 10 -6 -12 -8 C-32 -10 -48 -16 -48 -30 Z', '#64748B') +
    tone('M-4 -64 C10 -70 24 -66 30 -56 C18 -54 6 -56 -4 -64 Z', '#5EEAD4', 0.9) +
    part('M4 -66 C2 -96 22 -108 38 -100 C52 -92 52 -74 42 -64 C30 -56 10 -56 4 -66 Z', '#94A3B8') +
    dot(34, -86, 4.5, INK) + dot(35.5, -87.5, 1.6, '#FFFFFF') +
    part('M50 -84 L64 -80 L50 -74 Z', '#F2C744', { strokeWidth: 4 }) +
    part('M40 -78 C56 -88 86 -84 92 -72 C86 -62 58 -60 44 -66 Z', '#E7B062') +
    line('M54 -80 l6 6 M66 -82 l6 6 M78 -80 l6 6', '#B7791F', 3),
    { shadow: 46 }),

  // ─── UNCOMMON — + highlight + material detail ────────────────────────────
  'pet-shiba-inu': () => place('shiba',
    sway(-46, -50, 14, 0.6, part('M-56 -70 C-80 -84 -84 -54 -66 -44 C-54 -38 -46 -50 -50 -60 Z', '#E8893B') + tone('M-62 -62 C-70 -66 -70 -56 -64 -52 Z', '#FFF1DC')) +
    part('M-44 0 C-50 -40 -36 -66 -4 -68 C28 -70 44 -44 40 0 Z', '#E8893B') +
    tone('M-18 0 C-22 -30 -12 -48 6 -48 C22 -48 28 -30 24 0 Z', '#FFF1DC') +
    part('M-36 -64 C-44 -104 -22 -124 6 -122 C36 -120 52 -98 44 -68 C36 -44 -26 -40 -36 -64 Z', '#E8893B') +
    part('M-30 -106 L-36 -136 L-12 -118 Z', '#E8893B', { strokeWidth: 6 }) + part('M26 -118 L44 -136 L42 -102 Z', '#E8893B', { strokeWidth: 6 }) +
    tone('M-30 -112 L-32 -128 L-18 -118 Z M30 -116 L40 -128 L40 -108 Z', '#FFC9A8') +
    tone('M-24 -70 C-28 -90 -10 -94 6 -88 C22 -94 38 -88 34 -70 C24 -56 -14 -56 -24 -70 Z', '#FFF1DC') +
    eyes(-12, -92, 22, -92, 5) + dot(6, -78, 5, INK) + line('M0 -70 q6 6 12 0', INK, 3) +
    tone('M-6 -116 C6 -122 22 -118 30 -110 C18 -112 6 -112 -6 -116 Z', '#FFB36B'),
    { shadow: 46 }),

  'pet-calico-cat': () => place('calico',
    sway(36, -10, 10, 2.2, line('M36 -10 C70 -20 74 -60 54 -74', INK, 16) + line('M36 -10 C70 -20 74 -60 54 -74', '#FFFDF4', 8) + line('M58 -50 C64 -60 62 -68 56 -74', '#1F1A2E', 8)) +
    part('M-42 0 C-48 -44 -30 -66 0 -66 C30 -66 46 -44 40 0 Z', '#FFFDF4') +
    tone('M-42 0 C-46 -30 -38 -50 -20 -58 C-22 -36 -20 -16 -12 0 Z', '#F59E0B') + tone('M24 -60 C38 -50 44 -30 40 0 L26 0 C30 -24 28 -44 24 -60 Z', '#1F1A2E') +
    part('M-40 -64 C-46 -102 -20 -120 4 -118 C32 -116 48 -96 40 -66 C32 -44 -30 -42 -40 -64 Z', '#FFFDF4') +
    tone('M-40 -64 C-46 -96 -26 -114 -8 -116 C-14 -98 -14 -80 -6 -62 C-22 -56 -36 -56 -40 -64 Z', '#F59E0B') +
    tone('M18 -116 C34 -112 46 -96 42 -78 C34 -90 26 -100 14 -104 Z', '#1F1A2E') +
    part('M-36 -100 L-38 -134 L-12 -114 Z', '#F59E0B', { strokeWidth: 6 }) + part('M20 -114 L42 -132 L40 -98 Z', '#1F1A2E', { strokeWidth: 6 }) +
    tone('M-32 -106 L-34 -126 L-18 -114 Z', '#FFC9D6') +
    eyes(-14, -88, 20, -88, 5) + tone('M0 -76 l6 0 -3 4 Z', '#FF78A8') + line('M-2 -70 q5 4 10 0', INK, 3) +
    line('M-30 -76 h-18 M-30 -70 l-16 4 M34 -76 h18 M34 -70 l16 4', INK, 2.5, { opacity: 0.7 }),
    { shadow: 46 }),

  'pet-mini-capybara': () => place('capybara',
    part('M-56 -10 C-62 -50 -30 -78 10 -76 C44 -74 62 -50 58 -20 C56 -4 40 0 0 0 C-36 0 -54 -2 -56 -10 Z', '#A9744B') +
    tone('M-56 -10 C-50 -2 -30 0 0 0 C30 0 50 -2 58 -18 C56 2 30 4 0 4 C-34 4 -58 2 -56 -10 Z', '#7A4F2E') +
    part('M24 -64 C30 -88 58 -92 70 -74 C80 -58 72 -36 54 -32 C40 -30 26 -44 24 -64 Z', '#A9744B') +
    tone('M54 -66 C66 -64 72 -56 70 -46 C62 -52 56 -56 50 -58 Z', '#C99868') +
    part('M28 -76 C24 -88 32 -92 38 -84 Z', '#7A4F2E', { strokeWidth: 4 }) +
    blink(50, -62, 4, dot(50, -62, 4.5, INK)) + blink(70, -54, 4, dot(70, -54, 3.5, INK)) +
    hover(5, 2.4, part('M30 -106 a16 15 0 1 0 32 0 a16 15 0 1 0 -32 0 Z', '#FACC15') + tone('M38 -114 c4 -4 10 -4 12 0 Z', '#FEF08A') +
      part('M46 -122 c4 -8 14 -10 18 -6 c-4 6 -12 8 -18 6 Z', '#22C55E', { strokeWidth: 3 })) +
    tone('M-30 -60 C-10 -70 14 -70 26 -62 C10 -60 -10 -58 -30 -60 Z', '#C99868', 0.8),
    { shadow: 54 }),

  'pet-coffee-slime': () => place('coffee-slime',
    part('M-34 0 L-42 -96 H42 L34 0 Z', '#FFFFFF', { fillOpacity: 0.35 }) +
    tone('M-37 -40 L-40 -80 H40 L37 -40 Z', '#7A4A26') + tone('M-34 -2 L-37 -40 H37 L34 -2 Z', '#C79A6B') +
    hover(4, 1.8, part('M-26 -84 h20 v18 h-20 Z', '#E0F2FE', { fillOpacity: 0.85, strokeWidth: 3 })) + hover(4, 1.8, part('M6 -78 h18 v16 h-18 Z', '#E0F2FE', { fillOpacity: 0.85, strokeWidth: 3 }), 0.6) +
    eyes(-12, -54, 14, -54, 5) + line('M-6 -42 q7 6 14 0', '#FFF1DC', 3) +
    line('M18 -96 L34 -142', INK, 9) + line('M18 -96 L34 -142', '#22C55E', 5) +
    tone('M-30 -90 L-28 -8 L-22 -8 L-24 -90 Z', '#FFFFFF', 0.6),
    { shadow: 40 }),

  // ─── RARE — material + idle motion ───────────────────────────────────────
  'pet-tiny-drone': () => place('drone',
    `<g>${bob(1.8, 8)}` +
    `<g transform="translate(0 -70)"><g>${animateTransform('rotate', '-5;5;-5', 2.6)}` +
    line('M-56 -18 L56 -18', INK, 10) + line('M-56 -18 L56 -18', '#64748B', 5) +
    [-52, 52].map((x) => `<ellipse cx="${x}" cy="-26" rx="30" ry="5" fill="#94A3B8" opacity="0.8" stroke="${INK}" stroke-width="3"><animate attributeName="rx" values="30;6;30" dur="0.18s" repeatCount="indefinite"/></ellipse>` + dot(x, -22, 5, INK)).join('') +
    part('M-34 -14 C-34 -30 34 -30 34 -14 C34 10 -34 10 -34 -14 Z', 'url(#drone-shell)') +
    part('M-12 -4 a12 12 0 1 0 24 0 a12 12 0 1 0 -24 0 Z', '#0F172A', { strokeWidth: 4 }) +
    `<circle cx="0" cy="-4" r="6" fill="#38BDF8">${animate('fill', '#38BDF8;#F43F5E;#38BDF8', 2)}</circle>` + dot(3, -7, 2, '#FFFFFF') +
    `<circle cx="26" cy="-16" r="4" fill="#22C55E">${animate('opacity', '1;0.2;1', 1)}</circle>` +
    tone('M-24 -22 C-10 -28 10 -28 20 -24 C6 -22 -10 -20 -24 -22 Z', '#FFFFFF', 0.8) +
    `<path d="M-10 6 L-30 56 L30 56 L10 6 Z" fill="url(#drone-beam)">${animate('opacity', '0.3;1;0.3', 1.6)}</path>` +
    `</g></g></g>` +
    defs(linear('drone-shell', [[0, '#F8FAFC'], [1, '#94A3B8']], 0, 0, 0, 1), linear('drone-beam', [[0, '#BAE6FD', 0.7], [1, '#BAE6FD', 0]], 0, 0, 0, 1)),
    { shadow: 30, float: true }),

  'pet-golden-carp': () => place('golden-carp',
    `<g>${bob(2.6, 10)}<g transform="translate(0 -80) rotate(-8)">` +
    `<path d="M-50 0 C-80 -24 -88 -4 -74 0 C-88 4 -80 24 -50 0 Z" fill="url(#carp-gold)" stroke="${INK}" stroke-width="${MINOR}" stroke-linejoin="round">${animateTransform('rotate', '-10 -50 0; 10 -50 0; -10 -50 0', 1.2)}</path>` +
    part('M-56 0 C-40 -34 20 -40 52 -10 C60 -2 60 4 52 10 C20 40 -40 34 -56 0 Z', 'url(#carp-gold)') +
    tone('M-40 4 C-20 24 20 24 44 10 C20 16 -10 16 -40 4 Z', '#B7791F', 0.7) +
    [[-24, -6], [-8, -12], [8, -8], [-14, 8], [2, 4]].map(([x, y]) => `<path d="M${x! - 6} ${y} q6 -8 12 0" fill="none" stroke="#B7791F" stroke-width="2.5"/>`).join('') +
    tone('M-2 -30 C10 -46 28 -44 32 -28 C20 -26 8 -26 -2 -30 Z', '#FF5A1F') +
    dot(36, -6, 5, INK) + dot(38, -8, 1.8, '#FFFFFF') +
    line('M54 2 C66 0 74 6 80 14 M54 4 C64 10 68 18 70 26', '#FF5A1F', 3) +
    clipped('carp-c', 'M-56 0 C-40 -34 20 -40 52 -10 C60 -2 60 4 52 10 C20 40 -40 34 -56 0 Z', sweepBand('carp-sweep', -60, -40, 20, 80, 130, 2.4, 0, 0.8)) + burst(16, -20, 7, 2.4, 0.5) + `</g></g>` +
    motes({ count: 5, x: 30, y: -120, width: 40, height: 30, rise: 50, colors: ['#BAE6FD'], size: [2.5, 5], seconds: 2.6, seed: 91 }) +
    defs(metal('carp-gold', '#F2B627')),
    { shadow: 40, float: true }),

  'pet-lucky-black-cat': () => place('maneki',
    part('M-44 0 C-50 -46 -30 -70 0 -70 C30 -70 48 -46 42 0 Z', '#1F1A2E') +
    tone('M-20 0 C-24 -28 -14 -44 2 -44 C18 -44 24 -28 20 0 Z', '#2E2745') +
    sway(6, -66, 12, 1.4, part('M-6 -60 a12 12 0 1 0 24 0 a12 12 0 1 0 -24 0 Z', 'url(#bell)', { strokeWidth: 4 }) + line('M-2 -56 h16', INK, 3)) + burst(14, -66, 6, 1.4, 0.3) +
    line('M-36 -66 C-10 -56 20 -56 40 -66', '#E11D48', 9) +
    part('M-40 -66 C-48 -104 -22 -122 4 -120 C32 -118 50 -98 42 -68 C34 -46 -30 -44 -40 -66 Z', '#1F1A2E') +
    part('M-36 -102 L-40 -136 L-12 -116 Z', '#1F1A2E', { strokeWidth: 6 }) + part('M20 -116 L44 -134 L40 -100 Z', '#1F1A2E', { strokeWidth: 6 }) +
    tone('M-32 -108 L-34 -126 L-20 -116 Z M28 -114 L38 -124 L38 -106 Z', '#E11D48', 0.8) +
    blink(-12, -90, 4, `<ellipse cx="-12" cy="-90" rx="7" ry="9" fill="#FDE047"/>` + dot(-12, -88, 3.5, INK)) + blink(22, -90, 4, `<ellipse cx="22" cy="-90" rx="7" ry="9" fill="#FDE047"/>` + dot(22, -88, 3.5, INK)) +
    tone('M2 -78 l6 0 -3 4 Z', '#FF78A8') +
    `<g>${part('M40 -80 C58 -96 62 -120 52 -130 C42 -136 34 -124 38 -112 C40 -102 36 -92 30 -84 Z', '#1F1A2E')}${tone('M46 -126 c4 -2 8 0 8 4 c-4 0 -6 -2 -8 -4 Z', '#FF78A8')}${animateTransform('rotate', '0 36 -84; -18 36 -84; 0 36 -84', 1.4)}</g>` +
    tone('M-24 -112 C-10 -118 10 -116 22 -108 C6 -110 -10 -110 -24 -112 Z', '#4B4466') +
    motes({ count: 4, x: -40, y: -30, width: 80, height: 20, rise: 70, colors: ['#FDE047'], size: [3, 5], seconds: 2.4, seed: 95, shape: 'sparkle' }) +
    defs(metal('bell', '#F2B627')),
    { shadow: 46 }),

  // ─── EPIC — layered motion + emissive ────────────────────────────────────
  'pet-baby-dragon': () => place('baby-dragon',
    defs(linear('drake', [[0, '#4ADE80'], [1, '#15803D']], 1, 0, 0, 1), glow('ember-glow', 4)) +
    `<g>${part('M-30 -56 C-70 -96 -86 -60 -70 -44 C-60 -58 -48 -54 -40 -46 Z', '#A7F3D0')}${line('M-34 -54 L-66 -82 M-40 -50 L-74 -60', '#15803D', 3)}${animateTransform('rotate', '0 -30 -56; -22 -30 -56; 0 -30 -56', 0.9)}</g>` +
    sway(30, -12, 12, 1.2, line('M30 -12 C70 -6 76 -40 60 -52', INK, 16) + line('M30 -12 C70 -6 76 -40 60 -52', '#22C55E', 8) + part('M56 -50 l14 -14 l2 18 Z', '#FDE047', { strokeWidth: 4 })) +
    pulse(0, 0, 1.04, 1.6, part('M-40 0 C-46 -42 -26 -64 2 -64 C30 -64 44 -42 38 0 Z', 'url(#drake)')) +
    tone('M-14 0 C-18 -28 -8 -44 6 -44 C20 -44 24 -26 20 0 Z', '#FEF3C7') + line('M-10 -34 h28 M-12 -22 h32 M-12 -10 h32', '#FCD34D', 3) +
    part('M-36 -64 C-40 -104 -14 -120 12 -116 C42 -112 54 -88 44 -62 C34 -42 -28 -42 -36 -64 Z', 'url(#drake)') +
    part('M-24 -108 L-32 -132 L-8 -114 Z', '#FDE047', { strokeWidth: 5 }) + part('M18 -114 L28 -136 L34 -106 Z', '#FDE047', { strokeWidth: 5 }) +
    part('M30 -80 C46 -84 60 -78 62 -66 C52 -58 38 -60 28 -66 Z', '#86EFAC') + dot(50, -72, 2.5, INK) +
    eyes(-12, -88, 16, -90, 6) + tone('M-30 -72 a8 5 0 1 0 16 0 a8 5 0 1 0 -16 0 Z', '#FF78A8', 0.6) +
    `<g filter="url(#ember-glow)"><g opacity="0">${animate('opacity', '0;0;1;0', 3, { keyTimes: '0;0.7;0.78;1', calcMode: 'linear', keySplines: undefined })}<g transform="rotate(80 64 -70)">${flame(64, -70, 40, ['#F97316', '#FDE047'], 0.3)}</g></g></g>` +
    `<g filter="url(#ember-glow)">${[0, 1, 2].map((i) => `<circle cx="64" cy="-70" r="${5 - i}" fill="${['#FDE047', '#F97316', '#EF4444'][i]}">${animateTransform('translate', `0 0; ${20 + i * 6} ${-10 - i * 4}`, 1.2, { begin: `${i * 0.4}s` })}${animate('opacity', '1;0', 1.2, { begin: `${i * 0.4}s`, calcMode: 'linear', keySplines: undefined })}</circle>`).join('')}</g>`,
    { shadow: 46 }),

  'pet-neon-jellyfish': () => place('jellyfish',
    defs(radial('jelly', [[0, '#FBCFE8', 0.95], [0.6, '#E879F9', 0.85], [1, '#7C3AED', 0.8]], 0.4, 0.35, 0.7), glow('jelly-glow', 6)) +
    `<g>${bob(2.8, 14)}<g transform="translate(0 -96)" filter="url(#jelly-glow)">` +
    [-26, -10, 8, 24].map((x, i) => `<path d="M${x} 0 C${x - 8} 20 ${x + 8} 34 ${x} 56" fill="none" stroke="${i % 2 ? '#67E8F9' : '#F0ABFC'}" stroke-width="5" stroke-linecap="round"><animate attributeName="d" values="M${x} 0 C${x - 8} 20 ${x + 8} 34 ${x} 56;M${x} 0 C${x + 8} 20 ${x - 8} 34 ${x + 4} 56;M${x} 0 C${x - 8} 20 ${x + 8} 34 ${x} 56" dur="${1.6 + i * 0.2}s" repeatCount="indefinite"/></path>`).join('') +
    `<path d="M-44 0 C-48 -40 -20 -58 0 -58 C24 -58 48 -40 44 0 C30 8 -30 8 -44 0 Z" fill="url(#jelly)" stroke="${INK}" stroke-width="${MINOR}" stroke-linejoin="round">${animateTransform('scale', '1 1; 1.06 0.94; 1 1', 1.4)}</path>` +
    line('M-40 0 q10 8 20 0 t20 0 t20 0 t20 0', '#FBCFE8', 4) +
    eyes(-12, -24, 14, -24, 5) + line('M-4 -12 q5 4 10 0', INK, 3) +
    tone('M-26 -44 C-14 -54 4 -54 14 -48 C0 -46 -14 -42 -26 -44 Z', '#FFFFFF', 0.85) +
    `<ellipse cx="0" cy="-24" rx="56" ry="44" fill="none" stroke="#F0ABFC" stroke-width="3">${animate('rx', '50;72', 1.4, { calcMode: 'linear', keySplines: undefined })}${animate('ry', '40;60', 1.4, { calcMode: 'linear', keySplines: undefined })}${animate('opacity', '0.8;0', 1.4, { calcMode: 'linear', keySplines: undefined })}</ellipse>` +
    `</g></g>` +
    motes({ count: 6, x: -50, y: -40, width: 100, height: 40, rise: 90, colors: ['#F0ABFC', '#67E8F9'], size: [2, 4], seconds: 2.6, seed: 97 }),
    { shadow: 34, float: true }),

  // ─── LEGENDARY — Moon Rabbit (Spirit Lotus) ──────────────────────────────
  'pet-moon-rabbit': () => place('moon-rabbit',
    defs(metal('moon-gold', '#FCD34D'), radial('moon-halo', [[0, '#FEF3C7', 0.7], [1, '#FEF3C7', 0]]), glow('lantern-glow', 6)) +
    `<g>${bob(3, 10)}` +
    `<circle cx="0" cy="-90" r="78" fill="url(#moon-halo)"><animate attributeName="r" values="70;84;70" dur="3s" repeatCount="indefinite"/></circle>` +
    part('M-60 -40 C-50 4 30 14 62 -30 C30 -6 -24 -6 -46 -50 Z', 'url(#moon-gold)') +
    tone('M-40 -30 C-20 -14 20 -12 46 -26 C20 -4 -24 -6 -40 -30 Z', '#B7791F', 0.5) +
    dot(-20, -22, 4, '#E8B33A') + dot(14, -18, 3, '#E8B33A') +
    // rabbit sitting on the crescent
    part('M-26 -36 C-32 -70 -14 -84 6 -84 C26 -84 36 -66 30 -36 C22 -26 -18 -26 -26 -36 Z', '#FFFFFF') +
    tone('M-26 -36 C-30 -58 -22 -74 -10 -80 C-14 -64 -12 -48 -4 -32 C-14 -30 -22 -30 -26 -36 Z', '#E2E8F0') +
    sway(-14, -82, 8, 2.6, part('M-22 -82 C-26 -110 -16 -122 -6 -118 C0 -112 -4 -94 -10 -82 Z', '#FFFFFF', { strokeWidth: 6 }) + tone('M-14 -88 C-18 -104 -14 -112 -9 -110 C-8 -102 -10 -94 -12 -88 Z', '#FFC9D6')) +
    sway(12, -84, 10, 1.8, part('M6 -84 C10 -114 26 -122 32 -114 C36 -106 26 -92 16 -82 Z', '#FFFFFF', { strokeWidth: 6 }) + tone('M12 -88 C16 -104 24 -112 28 -108 C28 -100 22 -94 16 -88 Z', '#FFC9D6'), 0.5) +
    blink(-6, -64, 3.8, dot(-6, -64, 4, INK) + dot(-5, -65.5, 1.4, '#FFFFFF')) + blink(14, -64, 3.8, dot(14, -64, 4, INK) + dot(15, -65.5, 1.4, '#FFFFFF')) +
    tone('M2 -56 l6 0 -3 4 Z', '#FF78A8') + tone('M-18 -54 a6 4 0 1 0 12 0 a6 4 0 1 0 -12 0 Z M12 -54 a6 4 0 1 0 12 0 a6 4 0 1 0 -12 0 Z', '#FF9EC7', 0.6) +
    // lồng đèn ông sao — star lantern swinging on a stick
    line('M24 -44 L60 -98', INK, 7) + line('M24 -44 L60 -98', '#B45309', 3) +
    `<g>${line('M60 -98 L60 -84', '#FDE047', 2)}<g filter="url(#lantern-glow)">` +
    `<path d="M60 -86 l7 14 16 2 -12 10 3 16 -14 -8 -14 8 3 -16 -12 -10 16 -2 Z" fill="#EF4444" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>` +
    `<circle cx="60" cy="-64" r="6" fill="#FDE047">${animate('opacity', '0.5;1;0.5', 1.4)}</circle></g>` +
    line('M60 -48 l-4 12 M60 -48 l4 12', '#FDE047', 2) +
    `${animateTransform('rotate', '-8 60 -98; 8 60 -98; -8 60 -98', 2.2)}</g>` +
    `</g>` +
    `<g filter="url(#lantern-glow)">${burst(-56, -110, 9, 2.2)}${burst(70, -140, 8, 2.2, 0.7)}${burst(-70, -60, 7, 2.2, 1.4)}</g>` +
    motes({ count: 8, x: -80, y: -170, width: 160, height: 60, rise: -110, colors: ['#FEF3C7', '#FDE047'], size: [2, 3.5], seconds: 3.2, seed: 99, shape: 'sparkle', drift: 18 }),
    { shadow: 40, float: true }),
}

