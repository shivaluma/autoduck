import { DUCK_PATHS, INK, MINOR, animate, animateTransform, defs, dot, flame, glow, group, line, linear, motes, part, radial, sparkle, tone, twinkle } from '../kit'

// Auras render behind the whole duck (AURA_BACK). Centre (256, 274). Common = static, rare+ = motion,
// legendary = set-piece with a clearance gap so the silhouette still pops.

const clover = (x: number, y: number, s: number, rot: number) => `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})">` +
  [0, 90, 180, 270].map((a) => `<path transform="rotate(${a})" d="M0 0 C-10 -6 -12 -20 -4 -22 C0 -24 2 -20 0 -16 C2 -20 6 -22 8 -18 C12 -10 6 -4 0 0 Z" fill="#22C55E" stroke="${INK}" stroke-width="3"/>`).join('') +
  line('M0 0 C4 10 2 18 -2 24', '#15803D', 3) + '</g>'

const petal = (x: number, y: number, rot: number, fill = '#F9A8D4') => `<path transform="translate(${x} ${y}) rotate(${rot})" d="M0 -14 C9 -6 9 6 0 14 C-9 6 -9 -6 0 -14 Z" fill="${fill}" stroke="${INK}" stroke-width="3"/>`

const bubble = (x: number, y: number, r: number) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#BAE6FD" fill-opacity="0.25" stroke="${INK}" stroke-width="4"/>` +
  `<path d="M${x - r * 0.5} ${y - r * 0.2} A${r * 0.55} ${r * 0.55} 0 0 1 ${x - r * 0.1} ${y - r * 0.6}" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round"/>`

export const AURA_ART: Record<string, () => string> = {
  // ─── COMMON ──────────────────────────────────────────────────────────────
  'aura-fireflies': () => group('fireflies',
    [[50, 200, 1], [480, 250, 0.8], [110, 100, 0.9], [450, 390, 1], [30, 340, 0.7]].map(([x, y, s]) => `<circle cx="${x}" cy="${y}" r="${30 * s!}" fill="#D9F99D" opacity="0.22"/><circle cx="${x}" cy="${y}" r="${18 * s!}" fill="#D9F99D" opacity="0.3"/>` + dot(x!, y!, 10 * s!, '#BEF264', { stroke: INK, strokeWidth: 3 })).join(''),
  ),

  'aura-coffee-steam': () => group('coffee-steam',
    line('M120 220 C90 180 150 150 120 110 C96 80 130 50 118 20', '#FFFFFF', 12, { opacity: 0.5 }),
    line('M200 160 C176 120 226 96 200 56 C184 30 208 4 200 -20', '#FFFFFF', 10, { opacity: 0.4 }),
    line('M470 200 C446 170 490 140 466 110', '#FFFFFF', 9, { opacity: 0.4 }),
    `<ellipse cx="74" cy="250" rx="13" ry="9" fill="#7A4A26" stroke="${INK}" stroke-width="3" transform="rotate(-30 74 250)"/>` + line('M66 254 C72 248 78 248 82 244', '#3B2412', 2.5),
    `<ellipse cx="480" cy="290" rx="11" ry="8" fill="#7A4A26" stroke="${INK}" stroke-width="3" transform="rotate(20 480 290)"/>`,
  ),

  'aura-bubble-halo': () => group('bubble-halo',
    [[40, 250, 16], [70, 160, 12], [130, 80, 18], [470, 300, 14], [490, 200, 10], [450, 390, 12], [30, 360, 10], [200, 20, 10]].map(([x, y, r]) => bubble(x!, y!, r!)).join(''),
  ),

  // ─── UNCOMMON — one element drifts ───────────────────────────────────────
  'aura-lucky-leaves': () => group('lucky-leaves',
    `<g>${clover(70, 170, 1, -20)}${animateTransform('translate', '0 0; 6 -10; 0 0', 4)}</g>`,
    clover(470, 250, 0.8, 30), clover(110, 380, 0.7, 10),
    `<g>${clover(430, 90, 0.9, -40)}${animateTransform('translate', '0 0; -6 8; 0 0', 5)}</g>`,
    sparkle(140, 120, 6, '#FDE047'), sparkle(490, 350, 5, '#FDE047'),
    motes({ count: 4, x: 60, y: 260, width: 420, height: 120, rise: 90, colors: ['#86EFAC'], size: [3, 5], seconds: 3.4, seed: 101, shape: 'sparkle' }),
  ),

  'aura-lotus-breeze': () => group('lotus-breeze',
    line('M30 330 C40 200 140 110 260 100 C380 92 470 160 500 260', '#F9A8D4', 6, { opacity: 0.45, strokeDasharray: '2 14' }),
    petal(40, 300, -30), petal(80, 190, 10), petal(160, 120, 40), petal(470, 190, -50), petal(500, 290, -10, '#FBCFE8'),
    `<g>${petal(380, 100, 60, '#FBCFE8')}${animateTransform('translate', '0 0; 10 6; 0 0', 4)}</g>`,
    [0, 1.6, 3.2, 4.8].map((d, i) => `<g>${petal(0, 0, i * 50, i % 2 ? '#FBCFE8' : '#F9A8D4')}<animateMotion dur="6.4s" begin="${-d}s" repeatCount="indefinite" rotate="auto" path="M30 330 C40 200 140 110 260 100 C380 92 470 160 500 260"/><animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.85;1" dur="6.4s" begin="${-d}s" repeatCount="indefinite"/></g>`).join(''),
  ),

  // ─── RARE — motion ───────────────────────────────────────────────────────
  'aura-storm-cloud': () => group('storm-cloud',
    defs(glow('bolt-glow', 4)),
    part('M40 120 C20 80 60 40 104 58 C116 20 180 14 200 54 C240 40 276 70 262 108 C240 128 70 136 40 120 Z', '#475569'),
    tone('M48 116 C80 126 220 124 256 106 C244 120 80 132 48 116 Z', '#334155'),
    tone('M110 64 C130 40 170 38 190 60 C166 52 136 54 110 64 Z', '#94A3B8', 0.8),
    [70, 120, 170, 220].map((x, i) => `<path d="M${x} 136 l-10 26" stroke="#7DD3FC" stroke-width="4" stroke-linecap="round" opacity="0.8">${animateTransform('translate', '0 -6; 0 14', 0.8, { begin: `${i * 0.2}s` })}${animate('opacity', '0.9;0', 0.8, { begin: `${i * 0.2}s`, calcMode: 'linear', keySplines: undefined })}</path>`).join(''),
    `<g filter="url(#bolt-glow)" opacity="0"><path d="M150 132 L132 176 L152 176 L136 220 L178 160 L156 160 L170 132 Z" fill="#FDE047" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/><animate attributeName="opacity" values="0;0;1;0;1;0;0" keyTimes="0;0.6;0.64;0.68;0.72;0.78;1" dur="3.2s" repeatCount="indefinite"/></g>`,
    `<rect x="-30" y="-60" width="580" height="580" fill="#E0F2FE" opacity="0"><animate attributeName="opacity" values="0;0;0.14;0;0.1;0;0" keyTimes="0;0.6;0.64;0.68;0.72;0.78;1" dur="3.2s" repeatCount="indefinite"/></rect>`,
  ),

  'aura-neon-glitch': () => group('neon-glitch',
    defs(glow('glitch-glow', 3)),
    `<g filter="url(#glitch-glow)" opacity="0.75">` +
    `<g transform="translate(-14 4)"><path d="${DUCK_PATHS.torso}" fill="none" stroke="#FF2BD6" stroke-width="6"/><path d="${DUCK_PATHS.head}" fill="none" stroke="#FF2BD6" stroke-width="6"/>${animateTransform('translate', '0 0; -6 0; 4 0; 0 0', 0.6, { calcMode: 'discrete' })}</g>` +
    `<g transform="translate(14 -4)"><path d="${DUCK_PATHS.torso}" fill="none" stroke="#00F2FE" stroke-width="6"/><path d="${DUCK_PATHS.head}" fill="none" stroke="#00F2FE" stroke-width="6"/>${animateTransform('translate', '0 0; 6 0; -4 0; 0 0', 0.7, { calcMode: 'discrete' })}</g></g>`,
    [[30, 180, 60, '#00F2FE'], [450, 260, 50, '#FF2BD6'], [60, 400, 40, '#FF2BD6'], [470, 120, 36, '#00F2FE']].map(([x, y, w, c], i) => `<rect x="${x}" y="${y}" width="${w}" height="8" fill="${c}"><animate attributeName="opacity" values="1;0;1;1;0" dur="${1 + i * 0.3}s" repeatCount="indefinite" calcMode="discrete"/></rect>`).join(''),
    `<g opacity="0.5">${[0, 1, 2].map((i) => `<rect x="-30" y="${60 + i * 140}" width="580" height="3" fill="${i % 2 ? '#FF2BD6' : '#00F2FE'}"><animateTransform attributeName="transform" type="translate" values="0 0;0 120" dur="${1.6 + i * 0.4}s" repeatCount="indefinite"/></rect>`).join('')}</g>`,
  ),

  // ─── EPIC — emissive set-pieces ──────────────────────────────────────────
  'aura-golden-rays': () => group('golden-rays',
    defs(radial('ray-fade', [[0, '#FFF3A6', 0.9], [0.55, '#FDE047', 0.45], [1, '#F59E0B', 0]]), glow('ray-glow', 8)),
    `<circle cx="256" cy="250" r="230" fill="url(#ray-fade)" opacity="0.55"/>`,
    `<g filter="url(#ray-glow)" opacity="0.85"><g>${Array.from({ length: 12 }, (_, i) => `<path transform="rotate(${i * 30} 256 250)" d="M248 250 L232 12 L280 12 L264 250 Z" fill="${i % 2 ? '#FDE047' : '#FFF3A6'}" opacity="${i % 2 ? 0.55 : 0.8}"/>`).join('')}${animateTransform('rotate', '0 256 250; 360 256 250', 30, { calcMode: 'linear' })}</g></g>`,
    `<circle cx="256" cy="250" r="214" fill="none" stroke="#FDE047" stroke-width="4" stroke-dasharray="4 18" opacity="0.8">${animateTransform('rotate', '360 256 250; 0 256 250', 40, { calcMode: 'linear' })}</circle>`,
    `<g>${sparkle(40, 120, 10, '#FFFBEA')}${twinkle(2)}</g><g>${sparkle(480, 180, 12, '#FFFBEA')}${twinkle(2.4, 0.8)}</g>`,
    `<circle cx="256" cy="250" r="200" fill="none" stroke="#FFF3A6" stroke-width="6" opacity="0"><animate attributeName="r" values="140;260" dur="2.4s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.8;0" dur="2.4s" repeatCount="indefinite"/></circle>`,
    motes({ count: 12, x: 20, y: 220, width: 470, height: 220, rise: 200, colors: ['#FFF3A6', '#FDE047'], size: [2.5, 5], seconds: 3.4, seed: 103, shape: 'sparkle' }),
  ),

  'aura-ghost-fog': () => group('ghost-fog',
    defs(linear('fog', [[0, '#C4B5FD', 0], [0.5, '#C4B5FD', 0.55], [1, '#C4B5FD', 0]], 0, 0, 1, 0), glow('wisp-glow', 5)),
    `<path d="M-20 420 C60 380 140 400 200 386 C280 370 360 400 440 380 C490 370 520 386 540 400 L540 460 L-20 460 Z" fill="url(#fog)"><animateTransform attributeName="transform" type="translate" values="0 0; 16 -4; 0 0" dur="6s" repeatCount="indefinite"/></path>`,
    `<path d="M-20 440 C80 410 160 430 260 414 C360 400 440 430 540 416 L540 470 L-20 470 Z" fill="url(#fog)" opacity="0.8"/>`,
    `<g filter="url(#wisp-glow)">` + [0, 2.6, 5.2].map((delay, i) => `<g><path d="M0 -16 C12 -16 16 -4 16 6 L16 16 L10 12 L5 16 L0 12 L-5 16 L-10 12 L-16 16 L-16 6 C-16 -4 -12 -16 0 -16 Z" fill="#EDE9FE" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>${dot(-5, -2, 2.6, INK)}${dot(5, -2, 2.6, INK)}<animateMotion dur="7.8s" begin="${-delay}s" repeatCount="indefinite" path="M256 30 C460 30 520 220 460 340 C400 440 110 440 50 330 C0 220 60 30 256 30 Z"/>${i === 1 ? animate('opacity', '0.6;1;0.6', 2) : ''}</g>`).join('') + '</g>',
    `<g filter="url(#wisp-glow)">${motes({ count: 8, x: 20, y: 300, width: 470, height: 130, rise: 140, colors: ['#DDD6FE', '#A78BFA'], size: [3, 6], seconds: 3.6, seed: 105 })}</g>`,
  ),

  // ─── LEGENDARY — Thần Long (Pond Royalty) ────────────────────────────────
  'aura-dragon-flame': () => group('dragon-flame',
    defs(
      radial('flame-core', [[0, '#FDE047', 0], [0.55, '#FDE047', 0], [0.72, '#F97316', 0.55], [0.9, '#DC2626', 0.65], [1, '#7F1D1D', 0]]),
      linear('dragon-body', [[0, '#FFE58A'], [0.5, '#F2B627'], [1, '#B45309']], 0, 0, 0, 1),
      radial('pearl', [[0, '#FFFFFF'], [0.5, '#BAE6FD'], [1, '#38BDF8']], 0.35, 0.35, 0.7),
      glow('dragon-glow', 6),
    ),
    // flame halo with a clear centre (silhouette clearance gap)
    `<ellipse cx="256" cy="250" rx="270" ry="250" fill="url(#flame-core)"><animate attributeName="rx" values="262;278;262" dur="1.6s" repeatCount="indefinite"/><animate attributeName="ry" values="246;256;246" dur="1.3s" repeatCount="indefinite"/></ellipse>`,
    [[40, 300], [70, 180], [140, 70], [450, 120], [500, 260], [470, 380]].map(([x, y], i) => `<path d="M${x} ${y} c-10 -16 -6 -30 6 -40 c0 12 10 14 10 26 c0 10 -8 16 -16 14 Z" fill="${i % 2 ? '#F97316' : '#FDE047'}" opacity="0.85">${animateTransform('scale', '1 1; 1 1.2; 1 1', 0.9 + i * 0.15)}${animate('opacity', '0.5;0.95;0.5', 0.9 + i * 0.15)}</path>`).join(''),
    // serpentine dragon body coiling behind the duck
    `<path d="M470 400 C540 300 520 160 430 90 C350 30 220 20 130 70 C50 116 20 220 60 320" fill="none" stroke="${INK}" stroke-width="46" stroke-linecap="round"/>`,
    `<path d="M470 400 C540 300 520 160 430 90 C350 30 220 20 130 70 C50 116 20 220 60 320" fill="none" stroke="url(#dragon-body)" stroke-width="32" stroke-linecap="round"/>`,
    `<path d="M470 400 C540 300 520 160 430 90 C350 30 220 20 130 70 C50 116 20 220 60 320" fill="none" stroke="#B45309" stroke-width="20" stroke-dasharray="2 14" stroke-linecap="round" opacity="0.8"><animate attributeName="stroke-dashoffset" values="0;-32" dur="1.2s" repeatCount="indefinite"/></path>`,
    `<path d="M470 400 C540 300 520 160 430 90 C350 30 220 20 130 70 C50 116 20 220 60 320" fill="none" stroke="#DC2626" stroke-width="6" stroke-dasharray="12 14" transform="translate(0 -16)" opacity="0.9"/>`,
    // dragon head at the tail end (lower-left), whiskers flowing
    part('M60 320 C30 330 6 360 14 392 C34 400 60 392 74 372 C92 380 104 370 100 356 C86 340 76 326 60 320 Z', 'url(#dragon-body)'),
    part('M20 350 L-6 334 L16 344 Z', '#FFE58A', { strokeWidth: 4 }) + part('M40 330 L30 296 L52 324 Z', '#DC2626', { strokeWidth: 4 }),
    dot(52, 352, 6, '#DC2626', { stroke: INK, strokeWidth: 3 }) + dot(53, 351, 2, '#FFFFFF'),
    `<path d="M16 382 C-6 400 -10 430 6 448" fill="none" stroke="#FFE58A" stroke-width="4" stroke-linecap="round">${animate('d', 'M16 382 C-6 400 -10 430 6 448;M16 382 C-2 404 -16 426 -4 450;M16 382 C-6 400 -10 430 6 448', 2.4)}</path>`,
    `<path d="M34 394 C30 420 40 440 60 452" fill="none" stroke="#FFE58A" stroke-width="4" stroke-linecap="round">${animate('d', 'M34 394 C30 420 40 440 60 452;M34 394 C38 422 34 444 52 458;M34 394 C30 420 40 440 60 452', 2.8)}</path>`,
    // flaming pearl
    `<g filter="url(#dragon-glow)"><circle cx="480" cy="430" r="20" fill="url(#pearl)" stroke="${INK}" stroke-width="${MINOR}"/>${sparkle(474, 424, 6, '#FFFFFF')}<circle cx="480" cy="430" r="28" fill="none" stroke="#F97316" stroke-width="4" opacity="0.7">${animate('r', '24;34;24', 1.6)}${animate('opacity', '0.8;0.1;0.8', 1.6)}</circle></g>`,
    `<g filter="url(#dragon-glow)">${motes({ count: 14, x: 0, y: 140, width: 520, height: 300, rise: 220, colors: ['#FDE047', '#F97316', '#FCA5A5'], size: [2.5, 5.5], seconds: 2.6, seed: 107 })}</g>`,
    `<g filter="url(#dragon-glow)">${flame(150, 70, 60, ['#F97316', '#FDE047'], 0.5)}${flame(420, 88, 56, ['#DC2626', '#FDE047'], 0.55, 0.2)}${flame(500, 230, 50, ['#F97316', '#FDE047'], 0.5, 0.3)}${flame(30, 250, 48, ['#DC2626', '#FDE047'], 0.6, 0.1)}</g>`,
  ),
}
