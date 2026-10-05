import { INK, animate, animateTransform, burst, defs, dot, flame, glow, group, line, linear, metal, motes, part, sparkle, tone, twinkle } from '../kit'

// Trails stream left from TAIL_TIP (84, 322) along the waterline (y ≈ 430). Render behind the duck.

const ripple = (cx: number, cy: number, rx: number, opacity = 0.8) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${rx * 0.18}" fill="none" stroke="#BAE6FD" stroke-width="5" opacity="${opacity}"/>`

const paperBoat = (x: number, y: number, s: number, fill = '#FFFDF4') => `<g transform="translate(${x} ${y}) scale(${s})">` +
  part('M-26 -4 L26 -4 L16 10 L-16 10 Z', fill) + part('M-10 -4 L4 -34 L14 -4 Z', fill) + tone('M4 -34 L14 -4 L6 -4 Z', '#CBD5E1') + '</g>'

const RAW_TRAIL_ART: Record<string, () => string> = {
  // ─── COMMON — static water marks ─────────────────────────────────────────
  'trail-ripples': () => group('ripples',
    ripple(70, 432, 60), ripple(-4, 438, 40, 0.6), ripple(150, 444, 34, 0.5),
    line('M20 420 C34 414 48 414 60 420', '#FFFFFF', 4, { opacity: 0.7 }),
  ),

  'trail-bubble-wake': () => group('bubble-wake',
    [[60, 400, 12], [20, 380, 9], [-6, 350, 7], [40, 350, 6], [90, 372, 7], [-14, 400, 5]].map(([x, y, r]) =>
      `<circle cx="${x}" cy="${y}" r="${r}" fill="#BAE6FD" fill-opacity="0.3" stroke="${INK}" stroke-width="3"/>` + dot(x! - r! * 0.35, y! - r! * 0.35, r! * 0.25, '#FFFFFF')).join(''),
    ripple(60, 434, 56, 0.6),
  ),

  'trail-paper-boats': () => group('paper-boats',
    ripple(34, 440, 44, 0.6), ripple(-10, 420, 26, 0.5),
    paperBoat(34, 430, 1.1), paperBoat(-8, 410, 0.75, '#FDE68A'),
  ),

  // ─── UNCOMMON ────────────────────────────────────────────────────────────
  'trail-lotus-petals': () => group('lotus-petals',
    ripple(60, 436, 60, 0.6),
    [[60, 424, -20, '#F9A8D4'], [10, 410, 30, '#FBCFE8'], [-14, 436, 70, '#F9A8D4'], [110, 440, 10, '#FBCFE8']].map(([x, y, r, c]) =>
      `<path transform="translate(${x} ${y}) rotate(${r})" d="M0 -14 C9 -6 9 6 0 14 C-9 6 -9 -6 0 -14 Z" fill="${c}" stroke="${INK}" stroke-width="3"/>` +
      `<path transform="translate(${x} ${y}) rotate(${r})" d="M0 -10 V8" stroke="#F472B6" stroke-width="2"/>`).join(''),
    part('M20 448 a18 7 0 1 0 36 0 a18 7 0 1 0 -36 0 Z', '#4ADE80', { strokeWidth: 4 }) + tone('M28 446 l10 -4 l2 6 Z', '#15803D'),
    `<ellipse cx="60" cy="436" rx="20" ry="4" fill="none" stroke="#BAE6FD" stroke-width="3"><animate attributeName="rx" values="20;70" dur="2.4s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.8;0" dur="2.4s" repeatCount="indefinite"/></ellipse>`,
  ),

  'trail-coffee-spill': () => group('coffee-spill',
    part('M120 436 C90 420 40 424 10 430 C-20 436 -20 452 4 454 C40 458 100 456 126 448 C134 444 132 440 120 436 Z', '#7A4A26'),
    tone('M20 436 C50 430 90 428 110 434 C80 436 50 438 20 436 Z', '#C79A6B', 0.8),
    dot(-14, 418, 6, '#7A4A26', { stroke: INK, strokeWidth: 3 }), dot(40, 408, 4, '#7A4A26', { stroke: INK, strokeWidth: 3 }),
    `<ellipse cx="70" cy="440" rx="10" ry="4" fill="#FFFFFF" opacity="0.6"/>`,
    motes({ count: 3, x: 20, y: 400, width: 80, height: 20, rise: 50, colors: ['#FFFFFF'], size: [3, 5], seconds: 2.6, seed: 111 }),
  ),

  // ─── RARE — animated ─────────────────────────────────────────────────────
  'trail-neon-wake': () => group('neon-wake',
    defs(glow('wake-glow', 4)),
    `<g filter="url(#wake-glow)" stroke-linecap="round" fill="none">` +
    [[330, '#00F2FE', 6, 0], [360, '#FF2BD6', 5, 0.2], [390, '#00F2FE', 4, 0.4], [420, '#FF2BD6', 6, 0.1]].map(([y, c, w, d]) =>
      `<path d="M100 ${y} H-20" stroke="${c}" stroke-width="${w}" stroke-dasharray="36 22">${animate('stroke-dashoffset', '0;116', 0.8, { begin: `${d}s`, calcMode: 'linear', keySplines: undefined })}</path>`).join('') + '</g>',
    motes({ count: 6, x: -20, y: 320, width: 120, height: 110, rise: 30, colors: ['#00F2FE', '#FF2BD6'], size: [2, 3.5], seconds: 1.2, seed: 113, drift: -40 }),
  ),

  'trail-pixel-stream': () => group('pixel-stream',
    [[80, 330, 18, '#61C9FF'], [50, 350, 14, '#B99AFF'], [24, 326, 12, '#58E6B0'], [0, 360, 10, '#FF78A8'], [-18, 336, 8, '#FFD84D'], [60, 390, 12, '#58E6B0'], [20, 410, 10, '#61C9FF']].map(([x, y, s, c], i) =>
      `<rect x="${x}" y="${y}" width="${s}" height="${s}" fill="${c}" stroke="${INK}" stroke-width="3">${animate('opacity', '1;0.2;1', 1 + i * 0.15, { calcMode: 'discrete', keySplines: undefined })}${animateTransform('translate', '0 0; -14 0', 1 + i * 0.15, { calcMode: 'discrete' })}</rect>`).join(''),
  ),

  // ─── EPIC ────────────────────────────────────────────────────────────────
  'trail-rainbow-wake': () => group('rainbow-wake',
    defs(glow('rainbow-glow', 3)),
    `<g filter="url(#rainbow-glow)" fill="none" stroke-linecap="round" opacity="0.92">` +
    ['#EF4444', '#F97316', '#FDE047', '#22C55E', '#38BDF8', '#8B5CF6'].map((c, i) =>
      `<path d="M96 ${318 + i * 10} C60 ${300 + i * 10} 20 ${340 + i * 10} -24 ${316 + i * 10}" stroke="${c}" stroke-width="9">${animate('d', `M96 ${318 + i * 10} C60 ${300 + i * 10} 20 ${340 + i * 10} -24 ${316 + i * 10};M96 ${318 + i * 10} C60 ${336 + i * 10} 20 ${300 + i * 10} -24 ${324 + i * 10};M96 ${318 + i * 10} C60 ${300 + i * 10} 20 ${340 + i * 10} -24 ${316 + i * 10}`, 1.6)}</path>`).join('') + '</g>',
    `<g>${sparkle(-6, 300, 8, '#FFFFFF')}${twinkle(1.4)}</g><g>${sparkle(40, 396, 6, '#FFFFFF')}${twinkle(1.8, 0.6)}</g>`,
    motes({ count: 8, x: -24, y: 300, width: 120, height: 80, rise: 30, colors: ['#FFFFFF', '#FDE047', '#38BDF8'], size: [2.5, 4.5], seconds: 1.4, seed: 115, shape: 'sparkle', drift: -50 }),
  ),

  'trail-dragon-sparks': () => group('dragon-sparks',
    defs(glow('spark-glow', 4)),
    `<g filter="url(#spark-glow)">` +
    [[90, 330, 0], [70, 360, 0.3], [96, 380, 0.6], [60, 400, 0.9], [80, 420, 1.2]].map(([x, y, d]) =>
      `<g>${part(`M${x} ${y} c-8 -12 -4 -22 4 -30 c0 10 8 10 8 20 c0 8 -6 12 -12 10 Z`, '#F97316', { strokeWidth: 3 })}${animateTransform('translate', '0 0; -90 -30', 1.5, { begin: `${d}s` })}${animate('opacity', '1;0', 1.5, { begin: `${d}s`, calcMode: 'linear', keySplines: undefined })}</g>`).join('') +
    [[40, 340], [10, 380], [-10, 330], [30, 410]].map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="4" fill="#FDE047">${twinkle(0.9 + i * 0.2, i * 0.2)}</circle>`).join('') + '</g>',
    tone('M100 430 C60 420 10 426 -24 436 C10 442 60 444 100 438 Z', '#7F1D1D', 0.4),
    `<g filter="url(#spark-glow)">${flame(70, 432, 34, ['#DC2626', '#FDE047'], 0.45)}${flame(30, 436, 26, ['#F97316', '#FDE047'], 0.5, 0.2)}</g>`,
  ),

  // ─── LEGENDARY — Golden Wake (Pond Royalty) ──────────────────────────────
  'trail-golden-water': () => group('golden-wake',
    defs(metal('liquid-gold', '#F2B627'), linear('coin', [[0, '#FFF0A6'], [1, '#C98A10']], 0, 0, 1, 1), glow('gold-glow', 4)),
    part('M110 424 C80 406 30 410 0 420 C-24 426 -28 446 -6 452 C30 460 90 458 120 446 C132 440 126 430 110 424 Z', 'url(#liquid-gold)'),
    `<path d="M20 428 C50 420 80 418 104 426" fill="none" stroke="#FFFBEA" stroke-width="5" stroke-linecap="round" stroke-dasharray="16 40">${animate('stroke-dashoffset', '0;-112', 1.4, { calcMode: 'linear', keySplines: undefined })}</path>`,
    part('M90 412 C84 396 92 386 100 392 C104 400 100 408 90 412 Z', 'url(#liquid-gold)', { strokeWidth: 4 }),
    part('M20 410 C14 396 22 388 28 394 C32 400 28 406 20 410 Z', 'url(#liquid-gold)', { strokeWidth: 4 }),
    `<g filter="url(#gold-glow)">` + [[60, 380, 0], [16, 360, 0.7], [96, 350, 1.4]].map(([x, y, d]) =>
      `<g transform="translate(${x} ${y})"><ellipse rx="13" ry="13" fill="url(#coin)" stroke="${INK}" stroke-width="4">${animate('rx', '13;2;13', 1.2, { begin: `${d}s` })}</ellipse><path d="M-4 -5 h8 M-4 0 h8 M-4 5 h8" stroke="#B7791F" stroke-width="2"/>${animateTransform('translate', '0 6; 0 -10; 0 6', 2.1, { begin: `${d}s` })}</g>`).join('') + '</g>',
    `<g>${sparkle(-10, 400, 9, '#FFFBEA')}${twinkle(1.8)}</g><g>${sparkle(120, 400, 7, '#FFFBEA')}${twinkle(2.2, 0.8)}</g>`,
    line('M-20 446 C10 440 40 440 70 444', '#B7791F', 4, { opacity: 0.6 }),
    `<ellipse cx="60" cy="440" rx="20" ry="5" fill="none" stroke="#FDE047" stroke-width="4"><animate attributeName="rx" values="20;90" dur="1.8s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.9;0" dur="1.8s" repeatCount="indefinite"/></ellipse>`,
    burst(40, 380, 10, 1.8, 0.4) + burst(100, 360, 8, 1.8, 1.1) + motes({ count: 8, x: -10, y: 380, width: 130, height: 50, rise: 70, colors: ['#FFF3A6', '#FDE047'], size: [2, 4], seconds: 2, seed: 117, shape: 'sparkle' }),
  ),
}


/** Trails read small at thumbnail size, so every wake is scaled up around the tail tip. */
export const TRAIL_ART: Record<string, () => string> = Object.fromEntries(Object.entries(RAW_TRAIL_ART).map(([id, draw]) => [
  id, () => `<g transform="translate(84 430) scale(1.35) translate(-84 -430)">${draw()}</g>`,
]))
