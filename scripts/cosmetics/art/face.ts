import {
  DETAIL, INK, MAJOR, MINOR, animate, animateTransform, clipped, defs, dot, glow, group, line, linear, part,
  radial, solid, sparkle, tone, twinkle,
} from '../kit'

// Eye rig: left (near) eye (320,138) rx42 ry50 · right eye (382,144) rx32 ry42 · beak root (354,186).
const EYE_L = { cx: 320, cy: 138, rx: 42, ry: 50 }
const EYE_R = { cx: 382, cy: 144, rx: 32, ry: 42 }
const eyePath = (e: typeof EYE_L) => `M${e.cx - e.rx} ${e.cy} a${e.rx} ${e.ry} 0 1 0 ${e.rx * 2} 0 a${e.rx} ${e.ry} 0 1 0 ${-e.rx * 2} 0 Z`

/** Upper eyelid covering the top `cover` fraction of an eye. Neutral lid tone works on every body color. */
function lid(e: typeof EYE_L, cover: number, fill = '#E4DAF0', id = 'lid') {
  const y = e.cy - e.ry + e.ry * 2 * cover
  return clipped(`${id}-${e.cx}`, eyePath(e), `<rect x="${e.cx - e.rx - 4}" y="${e.cy - e.ry - 4}" width="${e.rx * 2 + 8}" height="${y - (e.cy - e.ry) + 4}" fill="${fill}"/>`) +
    line(`M${e.cx - e.rx + 4} ${y} Q${e.cx} ${y + 6} ${e.cx + e.rx - 4} ${y}`, INK, MINOR)
}

function heart(cx: number, cy: number, s: number, fill: string, extra = '') {
  return `<path d="M${cx} ${cy + s * 0.9} C${cx - s * 1.4} ${cy - s * 0.1} ${cx - s * 0.8} ${cy - s * 1.2} ${cx} ${cy - s * 0.45} C${cx + s * 0.8} ${cy - s * 1.2} ${cx + s * 1.4} ${cy - s * 0.1} ${cx} ${cy + s * 0.9} Z" fill="${fill}" stroke="${INK}" stroke-width="${DETAIL}" stroke-linejoin="round">${extra}</path>`
}

export const FACE_ART: Record<string, () => string> = {
  // ─── COMMON — expressions ────────────────────────────────────────────────
  'face-happy': () => group('happy',
    tone('M244 196 a26 18 0 1 0 52 0 a26 18 0 1 0 -52 0 Z', '#FF6F9C', 0.55),
    line('M252 194 l8 -6 M266 196 l8 -6 M280 198 l8 -6', '#FFFDF4', 3, { opacity: 0.8 }),
    line('M286 84 C302 72 326 72 342 82', INK, MINOR), line('M364 96 C376 88 394 90 404 98', INK, MINOR),
    dot(312, 126, 7, '#FFFDF4'), dot(378, 136, 5, '#FFFDF4'),
  ),
  'face-sleepy-eyes': () => group('sleepy',
    lid(EYE_L, 0.52), lid(EYE_R, 0.55),
    line('M290 150 l-6 8 M304 156 l-4 9 M318 158 v9', INK, 4),
    `<g>${part('M440 70 h22 l-22 24 h22', 'none', { stroke: '#B99AFF', strokeWidth: 5 })}${part('M470 36 h14 l-14 16 h14', 'none', { stroke: '#B99AFF', strokeWidth: 4 })}${animateTransform('translate', '0 4; 0 -6; 0 4', 3)}${animate('opacity', '0.4;1;0.4', 3)}</g>`,
  ),
  'face-angry-brows': () => group('angry',
    solid('M276 80 L350 104 L346 118 L272 98 Z', '#1B132B', { strokeWidth: 4 }),
    solid('M362 112 L414 92 L418 106 L366 124 Z', '#1B132B', { strokeWidth: 4 }),
    line('M246 112 l10 8 m-14 4 l10 -2 m-2 -14 l2 12', '#EF4444', 5),
    tone('M244 200 a22 12 0 1 0 44 0 a22 12 0 1 0 -44 0 Z', '#EF4444', 0.35),
  ),
  'face-tiny-moustache': () => group('moustache',
    solid('M380 204 C366 190 342 192 338 210 C350 204 362 208 372 214 Z', '#3B2412', { strokeWidth: 4 }),
    solid('M386 204 C402 188 430 192 436 210 C422 204 408 208 394 214 Z', '#3B2412', { strokeWidth: 4 }),
    tone('M346 204 C356 198 366 200 372 206 Z M396 204 C408 198 420 200 428 206 Z', '#7A4A26'),
    dot(383, 207, 7, '#3B2412', { stroke: INK, strokeWidth: 4 }),
  ),
  'face-monday-face': () => group('monday',
    lid(EYE_L, 0.4, '#D9CDE8'), lid(EYE_R, 0.42, '#D9CDE8'),
    line('M286 186 C300 196 330 198 352 188', '#8B5CF6', 7, { opacity: 0.55 }),
    line('M362 188 C372 194 392 196 404 188', '#8B5CF6', 6, { opacity: 0.55 }),
    `<path d="M262 92 c-8 12 -8 22 0 26 c8 -4 8 -14 0 -26 Z" fill="#7DD3FC" stroke="${INK}" stroke-width="${DETAIL}">${animateTransform('translate', '0 0; 0 10; 0 0', 2.4)}</path>`,
  ),

  // ─── UNCOMMON — eyewear & props ──────────────────────────────────────────
  'face-shades': () => group('pond-shades',
    line('M274 116 C244 112 226 122 216 140', INK, 8),
    solid('M272 108 H362 C366 144 352 168 318 168 C286 168 270 144 272 108 Z', '#16323F'),
    solid('M366 114 H424 C428 146 416 166 394 166 C372 166 362 146 366 114 Z', '#16323F'),
    line('M362 116 C364 110 366 110 366 116', INK, 8),
    tone('M286 118 h24 l-18 34 h-14 Z', '#4FD1C5', 0.55), tone('M376 122 h16 l-12 26 h-10 Z', '#4FD1C5', 0.55),
    line('M272 108 H362 M366 114 H424', '#2DD4BF', 4),
  ),
  'face-nerd-glasses': () => group('nerd',
    line('M276 130 C250 124 232 130 220 144', INK, 7),
    `<ellipse cx="320" cy="140" rx="44" ry="42" fill="#E0F2FE" fill-opacity="0.22" stroke="${INK}" stroke-width="12"/>`,
    `<ellipse cx="320" cy="140" rx="44" ry="42" fill="none" stroke="#8B5E34" stroke-width="5"/>`,
    `<ellipse cx="392" cy="146" rx="32" ry="34" fill="#E0F2FE" fill-opacity="0.22" stroke="${INK}" stroke-width="12"/>`,
    `<ellipse cx="392" cy="146" rx="32" ry="34" fill="none" stroke="#8B5E34" stroke-width="5"/>`,
    part('M352 132 h18 v14 h-18 Z', '#FFFDF4', { strokeWidth: 4 }), line('M356 132 v14 M362 132 v14', '#CBD5E1', 2),
    line('M300 116 l12 -8 M380 126 l8 -6', '#FFFFFF', 5, { opacity: 0.8 }),
  ),
  'face-heart-eyes': () => group('heart-eyes',
    heart(330, 150, 22, '#FF3D7F'), heart(390, 156, 16, '#FF3D7F'),
    tone('M318 136 c4 -6 10 -6 12 -2 Z M382 146 c3 -4 7 -4 9 -1 Z', '#FFFFFF', 0.9),
    `<g>${heart(444, 82, 9, '#FF78A8')}${animateTransform('translate', '0 6; 0 -10; 0 6', 2.6)}${animate('opacity', '0;1;0', 2.6)}</g>`,
    `<g>${heart(468, 116, 6, '#FF78A8')}${animateTransform('translate', '0 6; 0 -10; 0 6', 2.6, { begin: '1.3s' })}${animate('opacity', '0;1;0', 2.6, { begin: '1.3s' })}</g>`,
  ),
  'face-bandit-mask': () => group('bandit',
    solid('M214 118 C190 110 170 116 156 132 C176 130 196 132 214 140 Z', '#1F1A2E', { strokeWidth: MINOR }),
    solid('M216 140 C192 146 176 160 170 178 C188 166 204 160 220 156 Z', '#1F1A2E', { strokeWidth: MINOR }),
    `<path d="M220 112 C260 96 400 98 432 120 C438 150 426 176 400 182 C380 184 368 172 352 172 C336 172 320 192 290 190 C250 186 220 160 220 112 Z ${eyePath({ cx: 322, cy: 142, rx: 30, ry: 34 })} ${eyePath({ cx: 386, cy: 148, rx: 22, ry: 28 })}" fill="#1F1A2E" fill-rule="evenodd" stroke="${INK}" stroke-width="${MINOR}"/>`,
    line('M240 120 C280 106 380 106 420 124', '#4B4466', 5),
  ),
  'face-swimming-goggles': () => group('goggles',
    line('M276 150 C240 150 218 160 204 176', INK, 16), line('M276 150 C240 150 218 160 204 176', '#FF7A59', 8),
    solid('M280 134 C280 108 300 96 322 96 C346 96 364 110 362 136 C360 164 342 178 320 178 C296 178 280 162 280 134 Z', '#38BDF8', { fillOpacity: 0.45 }),
    solid('M366 140 C366 118 380 108 396 108 C414 108 426 122 424 142 C422 164 410 174 394 174 C378 174 366 160 366 140 Z', '#38BDF8', { fillOpacity: 0.45 }),
    line('M362 136 C364 130 366 130 366 138', INK, 10),
    tone('M296 110 c10 -8 24 -8 32 -2 c-12 0 -22 4 -28 10 Z M378 118 c6 -6 16 -6 22 -2 c-8 0 -14 2 -18 8 Z', '#FFFFFF', 0.85),
  ),

  // ─── RARE — material eyewear ─────────────────────────────────────────────
  'face-monocle': () => group('monocle',
    defs(linear('mono-gold', [[0, '#FFF0A6'], [0.5, '#F2B627'], [1, '#9A6A0B']], 1, 0, 0, 1), linear('mono-glass', [[0, '#FFFFFF', 0.45], [1, '#BAE6FD', 0.08]], 1, 0, 0, 1)),
    `<ellipse cx="320" cy="140" rx="46" ry="52" fill="url(#mono-glass)" stroke="${INK}" stroke-width="16"/>`,
    `<ellipse cx="320" cy="140" rx="46" ry="52" fill="none" stroke="url(#mono-gold)" stroke-width="8"/>`,
    line('M298 106 C306 98 318 96 328 98', '#FFFFFF', 6, { opacity: 0.9 }),
    line('M286 180 C270 220 262 250 276 286 C286 310 300 318 316 314', INK, 7),
    line('M286 180 C270 220 262 250 276 286 C286 310 300 318 316 314', '#F2B627', 3, { strokeDasharray: '2 6' }),
    line('M364 108 C376 98 396 98 410 106', INK, MINOR),
    sparkle(358, 104, 8, '#FFF8D6'),
  ),
  'face-aviators': () => group('aviators',
    defs(linear('avi', [[0, '#FF9A3C'], [0.55, '#F43F5E'], [1, '#7C3AED']], 0, 0, 0, 1), linear('avi-wire', [[0, '#FFF3A6'], [1, '#C08A12']], 0, 0, 1, 1)),
    line('M272 118 C246 114 226 122 214 138', '#C08A12', 5),
    solid('M272 112 C300 104 344 104 360 114 C364 150 346 178 316 178 C284 178 268 150 272 112 Z', 'url(#avi)', { strokeWidth: 10 }),
    solid('M366 118 C384 112 412 114 424 120 C428 150 414 172 394 172 C372 172 362 150 366 118 Z', 'url(#avi)', { strokeWidth: 10 }),
    line('M272 112 C300 104 344 104 360 114 M366 118 C384 112 412 114 424 120', 'url(#avi-wire)', 4),
    line('M352 110 C358 104 368 106 372 114', 'url(#avi-wire)', 5),
    tone('M284 120 C296 116 310 116 318 118 L294 160 C284 152 280 136 284 120 Z', '#FFFFFF', 0.4),
    tone('M376 126 C384 124 392 124 398 126 L382 158 C374 150 372 138 376 126 Z', '#FFFFFF', 0.4),
  ),
  'face-pixel-eyes': () => group('pixel-shades',
    `<path d="M268 112 H432 V128 H424 V144 H416 V160 H392 V152 H384 V144 H368 V136 H352 V144 H344 V160 H336 V168 H296 V160 H288 V152 H280 V128 H268 Z" fill="#0B0716" stroke="${INK}" stroke-width="4"/>`,
    tone('M296 128 h16 v8 h-16 Z M312 136 h8 v8 h-8 Z M392 128 h12 v8 h-12 Z M404 136 h6 v6 h-6 Z', '#FFFFFF'),
    tone('M232 112 H268 V120 H232 Z', '#0B0716'),
    tone('M300 144 h8 v8 h-8 Z', '#61C9FF', 0.8),
  ),

  // ─── EPIC — emissive ─────────────────────────────────────────────────────
  'face-laser-visor': () => group('laser-visor',
    defs(linear('visor', [[0, '#FF2B4A', 0.95], [1, '#7F1D1D', 0.9]], 0, 0, 1, 0), glow('visor-glow', 6)),
    solid('M226 128 C226 104 260 98 330 100 C400 102 438 108 440 126 C442 150 436 170 420 174 C380 182 300 180 250 172 C232 168 226 150 226 128 Z', '#1E1B2E'),
    `<g filter="url(#visor-glow)">${solid('M246 132 C246 116 280 112 332 114 C390 116 424 120 426 132 C428 150 420 160 404 162 C370 166 300 166 262 160 C250 156 246 146 246 132 Z', 'url(#visor)', { strokeWidth: 4 })}</g>`,
    clipped('visor-scan', 'M246 132 C246 116 280 112 332 114 C390 116 424 120 426 132 C428 150 420 160 404 162 C370 166 300 166 262 160 C250 156 246 146 246 132 Z',
      `<rect x="236" y="110" width="200" height="6" fill="#FFE4E6" opacity="0.9">${animateTransform('translate', '0 0; 0 52; 0 0', 1.8)}</rect>`),
    dot(240, 140, 7, '#FF2B4A', { stroke: INK, strokeWidth: DETAIL }),
    line('M262 104 H300', '#94A3B8', 4),
  ),
  'face-kitsune-mask': () => group('kitsune',
    defs(glow('foxfire', 5), radial('fire', [[0, '#E0F2FE'], [0.5, '#60A5FA'], [1, '#6366F1', 0]])),
    `<path d="M236 160 C230 116 248 70 278 52 L296 92 C316 84 352 84 376 94 L404 62 C432 84 446 120 438 160 C420 190 384 196 352 186 C330 196 290 196 266 186 C250 182 238 172 236 160 Z ${eyePath({ cx: 322, cy: 142, rx: 26, ry: 30 })} ${eyePath({ cx: 386, cy: 148, rx: 20, ry: 26 })}" fill="#FFFDF4" fill-rule="evenodd" stroke="${INK}" stroke-width="${MAJOR}" stroke-linejoin="round"/>`,
    tone('M282 62 L292 88 L276 92 Z M402 72 L392 94 L408 98 Z', '#F43F5E'),
    line('M290 112 C300 104 312 102 322 104 M372 112 C380 106 392 106 400 110', '#E11D48', 6),
    line('M256 160 C264 150 274 148 282 152 M420 160 C414 152 404 150 396 154', '#E11D48', 5),
    tone('M348 164 c4 -8 12 -8 14 0 c-4 6 -10 6 -14 0 Z', '#E11D48'),
    tone('M246 150 C244 120 256 90 276 70 C262 98 258 126 262 156 Z', '#E2E8F0', 0.8),
    `<g filter="url(#foxfire)"><g>${tone('M462 120 c-14 -10 -16 -30 0 -48 c2 14 14 18 14 32 c0 10 -6 16 -14 16 Z', 'url(#fire)')}${animateTransform('translate', '0 4; 4 -8; 0 4', 2.4)}${twinkle(2.4)}</g><g>${tone('M200 92 c-10 -8 -12 -22 0 -34 c2 10 10 12 10 22 c0 8 -4 12 -10 12 Z', 'url(#fire)')}${animateTransform('translate', '0 4; -4 -8; 0 4', 2.8)}${twinkle(2.8, 1)}</g></g>`,
  ),

  // ─── LEGENDARY — Cosmic Eyes (Cosmic Pond) ───────────────────────────────
  'face-cosmic-eyes': () => group('cosmic-eyes',
    defs(radial('nebula', [[0, '#F0ABFC'], [0.35, '#8B5CF6'], [0.75, '#312E81'], [1, '#0B0716']], 0.6, 0.4, 0.7), glow('cosmic-glow', 5)),
    `<path d="${eyePath(EYE_L)}" fill="url(#nebula)" stroke="${INK}" stroke-width="${MINOR}"/>`,
    `<path d="${eyePath(EYE_R)}" fill="url(#nebula)" stroke="${INK}" stroke-width="${MINOR}"/>`,
    clipped('cosmic-l', eyePath(EYE_L), dot(300, 120, 2, '#FFFFFF') + dot(344, 170, 2, '#FFFFFF') + dot(296, 168, 1.5, '#FFFFFF') + tone('M286 150 C310 130 340 128 360 140 C340 136 312 140 286 156 Z', '#F0ABFC', 0.45)),
    clipped('cosmic-r', eyePath(EYE_R), dot(370, 120, 1.5, '#FFFFFF') + dot(400, 172, 2, '#FFFFFF')),
    `<g filter="url(#cosmic-glow)"><g>${sparkle(330, 150, 16, '#FFF7D6')}${animate('opacity', '0.7;1;0.7', 2)}</g><g>${sparkle(390, 156, 12, '#FFF7D6')}${animate('opacity', '0.7;1;0.7', 2, { begin: '0.5s' })}</g></g>`,
    `<g opacity="0.85">${line('M262 112 C300 70 420 70 446 120', '#C4B5FD', 3, { strokeDasharray: '4 10' })}<circle r="5" fill="#FDE047"><animateMotion dur="5s" repeatCount="indefinite" path="M262 112 C300 70 420 70 446 120"/></circle></g>`,
    `<g>${sparkle(450, 76, 7, '#FFFFFF')}${twinkle(2.2)}</g><g>${sparkle(250, 82, 6, '#FFFFFF')}${twinkle(2.6, 1)}</g>`,
  ),
}
