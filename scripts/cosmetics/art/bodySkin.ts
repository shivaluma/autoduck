import {
  DUCK_PATHS, INK, MAJOR, MINOR, animate, animateTransform, defs, dot, glow, group, line, linear,
  part, radial, sparkle, tone, twinkle,
} from '../kit'

// Skins paint onto the feathers only: torso + head + tail, minus eyes and beak, so the face stays clean.
function skinMask(id: string) {
  return `<mask id="${id}" maskUnits="userSpaceOnUse" x="-40" y="-80" width="620" height="640"><rect x="-40" y="-80" width="620" height="640" fill="#000"/>` +
    `<path d="${DUCK_PATHS.torso}" fill="#fff"/><path d="${DUCK_PATHS.head}" fill="#fff"/><path d="${DUCK_PATHS.tail}" fill="#fff"/>` +
    `<ellipse cx="320" cy="138" rx="46" ry="54" fill="#000"/><ellipse cx="382" cy="144" rx="36" ry="46" fill="#000"/>` +
    `<path d="${DUCK_PATHS.beak}" fill="#000" stroke="#000" stroke-width="${MAJOR}"/></mask>`
}

/** Head region gets reduced opacity so patterns never compete with the eyes. */
const HEAD_FADE = `<mask id="face-fade" maskUnits="userSpaceOnUse" x="-40" y="-80" width="620" height="640"><rect x="-40" y="-80" width="620" height="640" fill="#fff"/><path d="${DUCK_PATHS.head}" fill="#777"/></mask>`

function skin(id: string, content: string, extraDefs = '', options: { fadeHead?: boolean } = {}) {
  const fade = options.fadeHead !== false
  return group(id,
    defs(skinMask(`${id}-m`), fade ? HEAD_FADE : '', extraDefs),
    `<g mask="url(#${id}-m)"><g${fade ? ' mask="url(#face-fade)"' : ''}>${content}</g>`,
    `<path d="${DUCK_PATHS.torso}" fill="none" stroke="${INK}" stroke-width="${MAJOR}"/><path d="${DUCK_PATHS.head}" fill="none" stroke="${INK}" stroke-width="${MAJOR}"/></g>`,
    line(DUCK_PATHS.wing, INK, MINOR),
  )
}

const blob = (cx: number, cy: number, r: number, seed: number) => {
  const pts = Array.from({ length: 7 }, (_, i) => {
    const a = (i / 7) * Math.PI * 2
    const rr = r * (0.78 + (((seed * (i + 3)) % 7) / 7) * 0.4)
    return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.8] as const
  })
  return `M${pts[0]![0].toFixed(1)} ${pts[0]![1].toFixed(1)} ` + pts.map((p, i) => {
    const n = pts[(i + 1) % pts.length]!
    const mx = (p[0] + n[0]) / 2
    const my = (p[1] + n[1]) / 2
    return `Q${p[0].toFixed(1)} ${p[1].toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`
  }).join(' ') + ' Z'
}

export const BODY_SKIN_ART: Record<string, () => string> = {
  // ─── COMMON ──────────────────────────────────────────────────────────────
  'bodySkin-cheek-freckles': () => skin('freckles',
    [[252, 178, 4], [266, 188, 3.5], [248, 196, 3], [276, 200, 3], [262, 206, 2.5], [404, 196, 3], [414, 186, 2.5]].map(([x, y, r]) => dot(x!, y!, r!, '#B45309', { opacity: 0.75 })).join('') +
    [[300, 300], [318, 312], [290, 318]].map(([x, y]) => dot(x!, y!, 3.5, '#B45309', { opacity: 0.5 })).join(''),
    '', { fadeHead: false }),

  'bodySkin-racing-stripes': () => skin('stripes',
    line('M300 20 C250 60 226 140 226 220 C226 260 180 260 120 290 C96 302 80 314 70 330', '#FFFDF4', 18) +
    line('M330 18 C282 60 256 140 256 224 C256 272 196 280 136 306 C110 318 94 330 84 342', '#EF4444', 14),
    '', { fadeHead: false }),

  'bodySkin-polka-pond': () => skin('polka',
    [[120, 300, 14], [176, 270, 12], [230, 300, 16], [150, 360, 16], [214, 380, 12], [280, 360, 14], [340, 300, 12], [366, 380, 16], [250, 250, 10], [96, 340, 10], [240, 120, 12], [260, 70, 10], [420, 120, 9]].map(([x, y, r]) => dot(x!, y!, r!, '#FFFDF4', { opacity: 0.85 })).join('')),

  'bodySkin-band-aid-hero': () => group('band-aid',
    defs(skinMask('bandaid-m')),
    `<g mask="url(#bandaid-m)">${line('M150 360 l14 -10 M160 372 l14 -10 M140 348 l14 -10', '#8B5CF6', 4, { opacity: 0.45 })}</g>`,
    `<g transform="rotate(-24 262 92)">${part('M226 80 h72 a12 12 0 0 1 0 24 h-72 a12 12 0 0 1 0 -24 Z', '#F5C6A5', { strokeWidth: 5 })}${part('M250 82 h26 v20 h-26 Z', '#FBE3CF', { strokeWidth: 3 })}${dot(256, 88, 1.6, '#C08457')}${dot(268, 96, 1.6, '#C08457')}${dot(262, 92, 1.6, '#C08457')}</g>`,
    `<g transform="rotate(18 214 300)">${part('M176 290 h76 a12 12 0 0 1 0 24 h-76 a12 12 0 0 1 0 -24 Z', '#F5C6A5', { strokeWidth: 5 })}${part('M202 292 h26 v20 h-26 Z', '#FBE3CF', { strokeWidth: 3 })}</g>`,
    `<g transform="rotate(70 196 300)">${part('M162 290 h68 a12 12 0 0 1 0 24 h-68 a12 12 0 0 1 0 -24 Z', '#F5C6A5', { strokeWidth: 5 })}</g>`,
  ),

  // ─── UNCOMMON ────────────────────────────────────────────────────────────
  'bodySkin-tiger-quack': () => skin('tiger',
    `<path d="${DUCK_PATHS.torso}" fill="#FF8A1F" opacity="0.9"/><path d="${DUCK_PATHS.head}" fill="#FF8A1F" opacity="0.9"/><path d="${DUCK_PATHS.tail}" fill="#FF8A1F" opacity="0.9"/>` +
    tone('M250 262 C320 250 400 270 412 322 C420 372 360 404 286 410 C240 412 214 380 222 340 C228 300 236 272 250 262 Z', '#FFF1DC', 0.9) +
    ['M70 290 C110 300 130 290 150 270 C130 300 110 316 74 314 Z', 'M120 240 C150 262 180 264 200 250 C186 274 158 286 124 270 Z', 'M200 226 C220 250 250 256 268 246 C254 268 228 278 204 262 Z',
      'M90 360 C130 360 160 350 180 330 C164 362 136 378 96 380 Z', 'M180 400 C210 388 226 370 236 350 C238 376 222 400 196 414 Z', 'M260 410 C280 396 290 380 294 362 C302 384 294 404 274 420 Z',
      'M240 60 C264 70 286 66 300 52 C292 76 268 88 244 82 Z', 'M222 112 C240 124 258 124 270 116 C262 134 244 140 226 132 Z', 'M418 74 C400 84 392 98 392 112 C406 102 418 92 426 92 Z',
    ].map((d) => tone(d, '#1B132B', 0.85)).join('')),

  'bodySkin-cow-spots': () => skin('cow',
    `<path d="${DUCK_PATHS.torso}" fill="#FFFDF4" opacity="0.92"/><path d="${DUCK_PATHS.head}" fill="#FFFDF4" opacity="0.92"/><path d="${DUCK_PATHS.tail}" fill="#FFFDF4" opacity="0.92"/>` +
    [[130, 290, 34, 3], [240, 330, 28, 5], [340, 380, 24, 2], [170, 390, 20, 6], [260, 70, 26, 4], [230, 190, 18, 1], [410, 110, 16, 3], [80, 300, 18, 5]].map(([x, y, r, s]) => tone(blob(x!, y!, r!, s!), '#1F1A2E')).join('') +
    tone('M252 196 a20 14 0 1 0 40 0 a20 14 0 1 0 -40 0 Z', '#FFB3C7', 0.9)),

  'bodySkin-koi-patches': () => skin('koi',
    `<path d="${DUCK_PATHS.torso}" fill="#FFFDF4" opacity="0.9"/><path d="${DUCK_PATHS.head}" fill="#FFFDF4" opacity="0.9"/><path d="${DUCK_PATHS.tail}" fill="#FFFDF4" opacity="0.9"/>` +
    [[150, 290, 46, 2, '#FF5A1F'], [300, 360, 40, 4, '#FF5A1F'], [320, 60, 44, 6, '#FF5A1F'], [210, 380, 22, 3, '#1F1A2E'], [380, 300, 16, 5, '#1F1A2E'], [90, 320, 22, 1, '#FF5A1F']].map(([x, y, r, s, c]) => tone(blob(x as number, y as number, r as number, s as number), c as string)).join('') +
    line('M126 270 C150 262 176 268 190 282', '#FF9A6B', 5, { opacity: 0.8 })),

  'bodySkin-street-camo': () => skin('camo',
    `<path d="${DUCK_PATHS.torso}" fill="#7C8B5A" opacity="0.92"/><path d="${DUCK_PATHS.head}" fill="#7C8B5A" opacity="0.92"/><path d="${DUCK_PATHS.tail}" fill="#7C8B5A" opacity="0.92"/>` +
    [[120, 280, 30, 1, '#4B5A32'], [220, 320, 34, 3, '#3B2F22'], [320, 380, 30, 5, '#4B5A32'], [170, 390, 24, 2, '#B9A774'], [290, 260, 22, 6, '#B9A774'], [380, 320, 20, 4, '#3B2F22'],
      [260, 80, 28, 2, '#4B5A32'], [240, 180, 22, 5, '#3B2F22'], [410, 90, 18, 3, '#B9A774'], [90, 330, 18, 4, '#3B2F22']].map(([x, y, r, s, c]) => tone(blob(x as number, y as number, r as number, s as number), c as string)).join('')),

  // ─── RARE ────────────────────────────────────────────────────────────────
  'bodySkin-me-tattoo': () => group('me-tattoo',
    defs(skinMask('tattoo-m')),
    `<g mask="url(#tattoo-m)">` +
    `<path d="M196 330 C176 304 196 284 214 298 C232 284 252 304 232 330 L214 350 Z" fill="#E11D48" stroke="#1E3A8A" stroke-width="5" stroke-linejoin="round"/>` +
    tone('M200 312 C200 300 210 296 214 304 Z', '#FDA4AF') +
    `<path d="M160 324 L176 318 L250 318 L268 324 L250 342 L176 342 Z" fill="#FFFDF4" stroke="#1E3A8A" stroke-width="4" stroke-linejoin="round"/>` +
    `<text x="214" y="337" text-anchor="middle" font-family="Georgia, serif" font-weight="900" font-size="20" fill="#1E3A8A">MẸ</text>` +
    `<path d="M290 360 c14 -10 30 -10 40 0 c-8 -2 -14 0 -18 6 c10 0 18 4 22 12 c-14 -4 -28 -2 -40 4 c4 -8 8 -14 14 -16 c-8 -2 -14 0 -18 -6 Z" fill="#1E3A8A" opacity="0.9"/>` +
    sparkle(270, 300, 6, '#1E3A8A') + `</g>`,
    line(DUCK_PATHS.wing, INK, MINOR),
  ),

  'bodySkin-circuit-feathers': () => skin('circuit',
    `<g filter="url(#circuit-glow)" fill="none" stroke="#00F2FE" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="M80 300 H140 L160 280 H230 L250 300 H300"/><path d="M100 360 H170 L190 380 H280 L300 360 H360"/><path d="M230 150 V110 L260 80 H300"/><path d="M420 110 L400 90 H370"/><path d="M200 400 L220 420"/></g>` +
    [[300, 300], [360, 360], [300, 80], [370, 90], [80, 300], [100, 360]].map(([x, y]) => dot(x!, y!, 7, '#0B1220', { stroke: '#00F2FE', strokeWidth: 4 })).join('') +
    `<circle r="5" fill="#FFFFFF"><animateMotion dur="2.4s" repeatCount="indefinite" path="M80 300 H140 L160 280 H230 L250 300 H300"/></circle>`,
    glow('circuit-glow', 3)),

  'bodySkin-star-constellations': () => skin('constellation',
    `<path d="${DUCK_PATHS.torso}" fill="url(#night)" opacity="0.55"/>` +
    line('M120 300 L170 270 L230 296 L260 260 M170 270 L190 340 L270 370 L340 340', '#FDE68A', 3, { opacity: 0.85 }) +
    line('M250 80 L290 60 L330 70', '#FDE68A', 3, { opacity: 0.7 }) +
    [[120, 300, 6], [170, 270, 8], [230, 296, 6], [260, 260, 7], [190, 340, 6], [270, 370, 8], [340, 340, 6], [250, 80, 6], [290, 60, 7], [330, 70, 5]].map(([x, y, r], i) => `<g>${sparkle(x!, y!, r!, '#FFF7D6')}${i % 3 === 0 ? twinkle(2.6, i * 0.3) : ''}</g>`).join(''),
    radial('night', [[0, '#312E81', 0.2], [1, '#1E1B4B', 0.9]], 0.4, 0.4, 0.7)),

  // ─── EPIC ────────────────────────────────────────────────────────────────
  'bodySkin-dragon-scale': () => skin('dragon-scale',
    `<path d="${DUCK_PATHS.torso}" fill="url(#scale-tile)"/><path d="${DUCK_PATHS.head}" fill="url(#scale-tile)" opacity="0.6"/><path d="${DUCK_PATHS.tail}" fill="url(#scale-tile)"/>` +
    // belly plates
    [0, 1, 2, 3].map((i) => `<path d="M${300 + i * 4} ${300 + i * 26} C${330 + i * 4} ${292 + i * 26} ${380 - i * 6} ${296 + i * 26} ${400 - i * 10} ${310 + i * 26}" fill="none" stroke="#FFD84D" stroke-width="10" stroke-linecap="round" opacity="0.85"/>`).join('') +
    `<rect x="-40" y="200" width="40" height="260" fill="url(#scale-sweep)" transform="skewX(-24)">${animateTransform('translate', '0 0; 520 0; 520 0', 3.6)}</rect>`,
    `<pattern id="scale-tile" width="52" height="40" patternUnits="userSpaceOnUse"><rect width="52" height="40" fill="#7F1D1D" opacity="0.85"/><path d="M0 40 C0 18 26 18 26 40 M26 40 C26 18 52 18 52 40 M-26 20 C-26 -2 0 -2 0 20 M0 20 C0 -2 26 -2 26 20 M26 20 C26 -2 52 -2 52 20" fill="#B91C1C" stroke="#1B132B" stroke-width="3"/><path d="M6 36 C6 26 14 22 20 24 M32 16 C32 6 40 2 46 4" fill="none" stroke="#FFB020" stroke-width="3" stroke-linecap="round"/></pattern>` +
    linear('scale-sweep', [[0, '#FFFFFF', 0], [0.5, '#FFF3A6', 0.8], [1, '#FFFFFF', 0]], 0, 0, 1, 0)),

  'bodySkin-gold-veins': () => skin('kintsugi',
    `<path d="${DUCK_PATHS.torso}" fill="#F8FAFC" opacity="0.92"/><path d="${DUCK_PATHS.head}" fill="#F8FAFC" opacity="0.92"/><path d="${DUCK_PATHS.tail}" fill="#F8FAFC" opacity="0.92"/>` +
    tone(DUCK_PATHS.torsoShadow, '#CBD5E1', 0.7) +
    line('M120 300 C140 280 170 284 186 270 C210 250 230 262 250 250', '#2563EB', 3, { opacity: 0.35 }) +
    `<g filter="url(#kin-glow)" fill="none" stroke="url(#kin-gold)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="M90 310 L130 300 L150 320 L196 312 L214 340 L262 336"/><path d="M196 312 L210 280 L250 268"/><path d="M262 336 L300 370 L350 362 L380 390"/><path d="M262 60 L280 90 L270 120 L290 150"/><path d="M150 380 L190 372 L210 400"/></g>` +
    `<path d="M90 310 L130 300 L150 320 L196 312 L214 340 L262 336" fill="none" stroke="#FFFBEA" stroke-width="3" stroke-dasharray="20 220" stroke-linecap="round">${animate('stroke-dashoffset', '240;0', 2.8, { calcMode: 'linear', keySplines: undefined })}</path>`,
    linear('kin-gold', [[0, '#FFF0A6'], [0.5, '#F2B627'], [1, '#B7791F']], 0, 0, 1, 1) + glow('kin-glow', 3)),

  // ─── LEGENDARY — Galaxy Body (Cosmic Pond) ───────────────────────────────
  'bodySkin-galaxy-dust': () => skin('galaxy-body',
    `<path d="${DUCK_PATHS.torso}" fill="url(#galaxy)"/><path d="${DUCK_PATHS.head}" fill="url(#galaxy)"/><path d="${DUCK_PATHS.tail}" fill="url(#galaxy)"/>` +
    tone('M90 330 C160 280 260 300 340 260 C380 240 410 260 420 290 C380 280 340 300 300 320 C220 360 140 360 90 330 Z', '#F0ABFC', 0.35) +
    tone('M120 380 C200 360 300 380 380 350 C340 390 220 410 120 380 Z', '#67E8F9', 0.3) +
    [[110, 300], [160, 340], [200, 280], [250, 360], [300, 300], [360, 340], [390, 300], [180, 400], [280, 400], [240, 70], [300, 50], [420, 110], [230, 200], [80, 300]].map(([x, y], i) => `<g>${dot(x!, y!, i % 3 === 0 ? 3 : 2, '#FFFFFF')}${twinkle(1.6 + (i % 4) * 0.5, i * 0.2)}</g>`).join('') +
    [[200, 330, 9], [330, 380, 7], [270, 90, 6]].map(([x, y, r], i) => `<g>${sparkle(x!, y!, r!, '#FFF7D6')}${twinkle(2.4, i * 0.8)}</g>`).join('') +
    `<g><path d="M60 250 l60 20" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round" opacity="0.9"/>${animateTransform('translate', '0 0; 360 120; 360 120', 4)}${animate('opacity', '0;1;0;0', 4, { keyTimes: '0;0.15;0.35;1', calcMode: 'linear', keySplines: undefined })}</g>`,
    linear('galaxy', [[0, '#1E1B4B'], [0.4, '#4C1D95'], [0.75, '#312E81'], [1, '#0B0716']], 1, 0, 0, 1)),
}

