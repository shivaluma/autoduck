import {
  DETAIL, DUCK_PATHS, INK, MAJOR, MINOR, animate, animateTransform, dark, defs, dot, glow, group, light,
  line, linear, metal, part, solid, sparkle, stitch, tone, twinkle,
} from '../kit'

// Neckline follows the head's lower edge: (408,244) → (320,284) → (242,262).
const NECKLINE = 'M222 236 C250 274 300 292 352 282 C384 276 404 260 414 238'
const SLEEVE = `${DUCK_PATHS.wing} C122 352 120 330 136 316 Z`
const CHEST = 'M300 270 C350 268 400 290 410 330 C418 372 380 400 330 404 C300 380 292 330 300 270 Z'

/** Mask = torso minus head (+ its outline), so cloth never covers the chin. */
function bodyMask(id: string) {
  return `<mask id="${id}" maskUnits="userSpaceOnUse" x="-40" y="-80" width="620" height="640"><rect x="-40" y="-80" width="620" height="640" fill="#000"/><path d="${DUCK_PATHS.torso}" fill="#fff"/><path d="${DUCK_PATHS.head}" fill="#000" stroke="#000" stroke-width="${MAJOR}"/></mask>`
}

interface Garment {
  id: string
  fill: string
  shadow?: string
  highlight?: string
  sleeve?: string | false
  inner?: string
  over?: string
  extraDefs?: string
}

/** Torso-hugging garment: fill + 3-value shading inside the mask, crisp outline, wing sleeve, then details on top. */
function garment({ id, fill, shadow, highlight, sleeve, inner = '', over = '', extraDefs = '' }: Garment) {
  const base = fill.startsWith('url') ? '#888888' : fill
  return group(id,
    defs(bodyMask(`${id}-m`), extraDefs),
    `<g mask="url(#${id}-m)">`,
    `<path d="${DUCK_PATHS.torso}" fill="${fill}"/>`,
    tone(DUCK_PATHS.torsoShadow, shadow ?? dark(base), 0.75),
    tone('M300 236 C360 240 404 270 410 312 C390 280 352 258 300 252 Z', highlight ?? light(base), 0.7),
    inner,
    `<path d="${DUCK_PATHS.torso}" fill="none" stroke="${INK}" stroke-width="${MAJOR}"/>`,
    line(NECKLINE, INK, MINOR),
    '</g>',
    sleeve === false ? '' : part(SLEEVE, sleeve ?? fill),
    over,
  )
}

const masked = (id: string, content: string) => `<g mask="url(#${id}-m)">${content}</g>`

export const OUTFIT_ART: Record<string, () => string> = {
  // ─── COMMON ──────────────────────────────────────────────────────────────
  'outfit-tee-white': () => garment({
    id: 'tee', fill: '#F8FAFC', shadow: '#CBD5E1', highlight: '#FFFFFF',
    inner: line('M232 248 C262 282 306 298 352 290 C384 284 404 268 414 248', '#E2E8F0', 10),
    over: part('M318 318 c10 -12 30 -12 34 2 c10 -2 16 8 10 16 c-8 10 -34 10 -44 -18 Z', '#FFD84D', { strokeWidth: 4 }) + dot(340, 318, 3, INK),
  }),

  'outfit-office-tie': () => garment({
    id: 'office', fill: '#DBEAFE', shadow: '#93C5FD', highlight: '#FFFFFF',
    inner: line('M300 300 V400 M262 300 V410 M338 296 V404', '#BFDBFE', 3),
    over: part('M286 270 L314 296 L332 266 Z', '#FFFFFF') + part('M332 266 L346 300 L374 262 Z', '#FFFFFF') +
      solid('M322 288 L340 288 L346 300 L352 372 L332 396 L314 372 L322 300 Z', '#EF4444', { strokeWidth: MINOR }) +
      part('M322 280 h22 l-2 14 h-18 Z', '#DC2626', { strokeWidth: DETAIL }) +
      line('M326 318 L346 308 M322 342 L348 332 M324 366 L348 356', '#B91C1C', 4) +
      dot(390, 330, 4, '#FFFFFF', { stroke: INK, strokeWidth: 2 }),
  }),

  'outfit-pajamas': () => garment({
    id: 'pj', fill: '#C7D2FE', shadow: '#8B9CF0', highlight: '#EEF2FF',
    inner: [[160, 270], [230, 300], [300, 340], [370, 300], [200, 370], [280, 390], [380, 370], [130, 330]].map(([x, y]) => `<path d="M${x} ${y - 9} l2.6 6 6.4 .6 -4.8 4.2 1.4 6.2 -5.6 -3.2 -5.6 3.2 1.4 -6.2 -4.8 -4.2 6.4 -.6 Z" fill="#FFF7C2"/>`).join(''),
    over: part('M270 262 C290 290 318 296 336 286 L322 310 Z', '#A5B4FC') + part('M336 286 C356 290 382 276 398 256 L360 304 Z', '#A5B4FC') +
      dot(340, 330, 6, '#FFFFFF', { stroke: INK, strokeWidth: 3 }) + dot(342, 362, 6, '#FFFFFF', { stroke: INK, strokeWidth: 3 }),
  }),

  'outfit-sailor-shirt': () => garment({
    id: 'sailor', fill: '#FFFFFF', shadow: '#CBD5E1', highlight: '#FFFFFF', sleeve: '#F1F5F9',
    inner: line('M60 300 H440 M60 330 H440 M60 360 H440 M60 390 H440', '#1E3A8A', 9),
    over: solid('M226 240 C250 280 300 300 352 290 C384 284 404 268 416 240 L420 262 C396 308 360 330 326 330 L338 302 C290 306 246 290 224 262 Z', '#1E3A8A', { strokeWidth: MINOR }) +
      line('M232 258 C258 288 300 298 340 296', '#FFFFFF', 4) +
      part('M312 300 c-20 -14 -34 -6 -32 8 c2 12 20 12 32 2 c12 10 30 10 32 -2 c2 -14 -12 -22 -32 -8 Z', '#EF4444') +
      line('M306 312 L292 344 M318 312 L330 346', '#EF4444', 7),
  }),

  'outfit-football-jersey': () => garment({
    id: 'jersey', fill: '#DA251D', shadow: '#9B1410', highlight: '#FF6B5F',
    inner: line('M120 280 L180 400 M380 270 L410 330', '#B81B14', 10) +
      `<text x="182" y="364" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="58" fill="#FFDD00" stroke="${INK}" stroke-width="4">10</text>`,
    sleeve: '#DA251D',
    over: line(NECKLINE, '#FFDD00', 7) +
      `<path d="M350 300 l7 16 17 1 -13 11 4 17 -15 -9 -15 9 4 -17 -13 -11 17 -1 Z" fill="#FFDD00" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>` +
      line('M142 344 C176 358 214 358 246 344', '#FFDD00', 6) +
      `<text x="176" y="334" font-family="Arial, sans-serif" font-weight="900" font-size="30" fill="#FFDD00" stroke="${INK}" stroke-width="2.5">10</text>`,
  }),

  'outfit-chef-apron': () => group('apron',
    defs(bodyMask('apron-m')),
    masked('apron', solid('M262 268 C300 280 352 284 400 270 C420 320 412 380 380 424 L270 424 C250 380 248 320 262 268 Z', '#FFFDF4') +
      tone('M262 268 C250 320 252 380 270 424 L300 424 C284 380 280 320 288 274 Z', '#E2E8F0') +
      part('M300 340 h60 v36 h-60 Z', '#F1F5F9', { strokeWidth: DETAIL }) + line('M330 340 v36', INK, 3) +
      `<path d="${DUCK_PATHS.torso}" fill="none" stroke="${INK}" stroke-width="${MAJOR}"/>`),
    line('M266 270 C262 250 270 236 282 228 M398 270 C404 252 404 240 400 230', '#FFFDF4', 8),
    line('M264 316 C220 320 180 314 150 300', '#FFFDF4', 7), line('M264 316 C220 320 180 314 150 300', INK, 2, { opacity: 0.4 }),
    part('M318 302 c-8 -10 0 -18 10 -14 c6 -10 22 -6 20 6 c10 2 10 14 0 16 Z', '#FFFFFF', { strokeWidth: 3 }),
  ),

  // ─── UNCOMMON ────────────────────────────────────────────────────────────
  'outfit-raincoat': () => garment({
    id: 'raincoat', fill: '#FFD43B', shadow: '#E0A400', highlight: '#FFF6B8',
    inner: tone('M330 250 C380 256 404 280 408 300 C390 284 366 272 330 266 Z', '#FFFFFF', 0.8) + stitch('M300 280 C296 330 300 380 312 418', '#B78300', 0.9),
    over: [312, 346, 380].map((y) => part(`M300 ${y} h26 v10 h-26 Z`, '#8B5E34', { strokeWidth: 4 }) + line(`M296 ${y + 5} H330`, INK, 2)).join('') +
      part('M226 240 C252 276 300 296 350 288 C382 282 404 266 416 240 L414 222 C400 252 370 270 340 272 C290 278 250 260 232 226 Z', '#FFC21A'),
  }),

  'outfit-dev-hoodie': () => garment({
    id: 'hoodie', fill: '#334155', shadow: '#1E293B', highlight: '#64748B',
    inner: part('M236 350 C280 340 340 342 372 356 L366 406 C330 418 268 418 238 404 Z', '#2B3647', { strokeWidth: DETAIL }) +
      stitch('M240 352 C280 344 340 346 370 358', '#94A3B8', 0.7) +
      `<text x="262" y="330" font-family="Menlo, monospace" font-weight="700" font-size="34" fill="#58E6B0">&lt;/&gt;</text>`,
    over: solid('M206 232 C214 272 270 304 340 298 C384 294 414 270 422 236 C424 262 404 290 374 304 C320 322 240 312 210 274 C202 262 202 246 206 232 Z', '#475569', { strokeWidth: MINOR }) +
      line('M316 300 V346 M334 300 V340', '#E2E8F0', 4) + dot(316, 348, 5, '#E2E8F0') + dot(334, 342, 5, '#E2E8F0'),
  }),

  'outfit-pond-lifeguard': () => garment({
    id: 'lifeguard', fill: '#EF4444', shadow: '#B91C1C', highlight: '#FCA5A5', sleeve: false,
    inner: tone('M300 316 h20 v-20 h20 v20 h20 v20 h-20 v20 h-20 v-20 h-20 Z', '#FFFFFF') + line('M60 400 H440', '#FFFFFF', 8),
    over: line('M246 260 C262 300 288 320 300 340', '#FFFFFF', 5) + line('M396 252 C380 300 352 330 330 344', '#FFFFFF', 5) +
      part('M302 344 h30 a10 10 0 0 1 0 20 h-30 Z', '#FDE047', { strokeWidth: 4 }) + dot(310, 354, 4, INK),
  }),

  'outfit-biker-vest': () => group('biker',
    defs(bodyMask('biker-m'), linear('biker-leather', [[0, '#3F3F46'], [1, '#09090B']], 1, 0, 0, 1)),
    masked('biker', `<path d="M60 200 H300 C290 280 300 360 330 430 H60 Z" fill="url(#biker-leather)"/>` +
      tone('M300 200 C290 280 300 360 330 430 L310 430 C282 360 274 280 286 200 Z', '#71717A') +
      stitch('M286 260 C278 320 288 380 312 424', '#A1A1AA', 0.7) +
      `<path d="M300 240 C292 280 296 330 318 380" fill="none" stroke="#D4D4D8" stroke-width="6" stroke-dasharray="3 5"/>` +
      `<path d="${DUCK_PATHS.torso}" fill="none" stroke="${INK}" stroke-width="${MAJOR}"/>` + line(NECKLINE, INK, MINOR)),
    part(SLEEVE, '#27272A'),
    part('M176 330 a22 22 0 1 0 44 0 a22 22 0 1 0 -44 0 Z', '#FF7A1A', { strokeWidth: 4 }) +
    `<path d="M186 334 q12 -18 24 0 q-12 10 -24 0 Z" fill="${INK}"/>`,
    part('M228 280 l22 -8 l6 18 l-22 8 Z', '#FDE047', { strokeWidth: 3 }),
  ),

  'outfit-detective-coat': () => garment({
    id: 'detective', fill: '#C8A46B', shadow: '#8F6E3A', highlight: '#E9D3A6',
    inner: part('M90 360 C180 380 300 380 414 356 L412 380 C300 404 180 404 92 384 Z', '#8F6E3A', { strokeWidth: DETAIL }) +
      part('M296 360 h30 v26 h-30 Z', '#D9C08D', { strokeWidth: 4 }) +
      [[352, 320], [386, 316], [352, 400], [386, 396]].map(([x, y]) => dot(x!, y!, 5, '#5A3E1B')).join(''),
    over: solid('M240 252 L300 296 L282 344 L250 304 Z', '#B08A50', { strokeWidth: MINOR }) +
      solid('M410 246 L356 296 L380 340 L414 290 Z', '#B08A50', { strokeWidth: MINOR }),
  }),

  // ─── RARE ────────────────────────────────────────────────────────────────
  'outfit-lucky-ao-dai': () => garment({
    id: 'aodai', fill: 'url(#aodai-silk)', shadow: '#8E0B12', highlight: '#FF7A6B', sleeve: '#C8161D',
    extraDefs: linear('aodai-silk', [[0, '#F0423F'], [0.5, '#C8161D'], [1, '#8E0B12']], 1, 0, 0, 1) + linear('aodai-gold', [[0, '#FFF0A6'], [1, '#D49B16']], 0, 0, 1, 1),
    inner: [[160, 300, 1], [230, 360, 0.8], [130, 380, 0.7], [210, 270, 0.6]].map(([x, y, s]) => `<g transform="translate(${x} ${y}) scale(${s})" fill="url(#aodai-gold)" opacity="0.9"><path d="M0 -14 C8 -6 8 6 0 14 C-8 6 -8 -6 0 -14 Z"/><path d="M-14 0 C-6 -8 6 -8 14 0 C6 8 -6 8 -14 0 Z"/><circle r="4" fill="#FFF8D6"/></g>`).join('') +
      line('M340 280 C356 300 372 300 390 290', '#FFD84D', 4) + [306, 324, 342].map((y, i) => dot(370 - i * 2, y, 4, '#FFD84D', { stroke: INK, strokeWidth: 2 })).join(''),
    over: solid('M244 262 C276 288 330 296 372 286 C392 282 408 270 416 254 L414 238 C402 260 376 276 344 278 C300 282 264 270 246 248 Z', '#FFD84D', { strokeWidth: MINOR }) +
      solid('M300 400 C318 432 352 452 396 458 C380 440 372 420 370 402 Z', '#C8161D', { strokeWidth: MINOR }) +
      tone('M318 412 C334 434 356 446 380 450 L374 440 C356 436 340 426 330 410 Z', '#FFD84D', 0.8),
  }),

  'outfit-racing-suit': () => garment({
    id: 'racing', fill: 'url(#race-suit)', shadow: '#1E3A8A', highlight: '#BFDBFE', sleeve: '#2563EB',
    extraDefs: linear('race-suit', [[0, '#60A5FA'], [0.5, '#2563EB'], [1, '#1E3A8A']], 1, 0, 0, 1),
    inner: `<path d="M262 250 L300 250 L240 430 L200 430 Z" fill="#FFFFFF"/>` +
      [0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<rect x="${256 - i * 7.6}" y="${258 + i * 22}" width="11" height="11" fill="${INK}"/><rect x="${267 - i * 7.6}" y="${269 + i * 22}" width="11" height="11" fill="${INK}"/>`).join('') +
      part('M330 320 h56 v24 h-56 Z', '#FFFFFF', { strokeWidth: 4 }) + `<text x="336" y="339" font-family="Arial Black, sans-serif" font-size="17" font-weight="900" fill="#EF4444">QUACK</text>` +
      part('M120 340 h44 v20 h-44 Z', '#FDE047', { strokeWidth: 3 }) +
      line('M300 270 C300 320 310 370 330 420', '#E2E8F0', 5),
    over: part('M232 254 C262 282 310 294 356 286 C382 280 404 266 414 248 L412 234 C396 256 368 270 340 272 C296 276 256 262 236 238 Z', '#FFFFFF'),
  }),

  'outfit-boss-blazer': () => garment({
    id: 'blazer', fill: 'url(#blazer-wool)', shadow: '#0B1226', highlight: '#475569', sleeve: '#1E293B',
    extraDefs: linear('blazer-wool', [[0, '#334155'], [1, '#0F172A']], 1, 0, 0, 1),
    inner: `<path d="M286 270 L352 290 L330 420 L300 420 Z" fill="#F8FAFC"/>` +
      solid('M316 286 L338 286 L344 380 L327 400 L310 380 Z', '#7F1D1D', { strokeWidth: 5 }) +
      line('M308 330 H348', '#F2B627', 5) +
      dot(372, 350, 5, '#94A3B8') + dot(372, 380, 5, '#94A3B8'),
    over: solid('M244 252 L302 290 L290 360 L262 312 Z', '#1E293B', { strokeWidth: MINOR }) +
      solid('M410 244 L352 292 L364 356 L412 296 Z', '#1E293B', { strokeWidth: MINOR }) +
      part('M376 306 l22 -8 l2 12 l-24 6 Z', '#FFFFFF', { strokeWidth: 3 }) + tone('M378 306 l8 -10 l6 8 Z', '#F43F5E') +
      line('M246 256 L298 292 M408 250 L356 294', '#64748B', 3),
  }),

  'outfit-space-suit': () => garment({
    id: 'spacesuit', fill: 'url(#suit-white)', shadow: '#94A3B8', highlight: '#FFFFFF', sleeve: '#F1F5F9',
    extraDefs: linear('suit-white', [[0, '#FFFFFF'], [1, '#CBD5E1']], 1, 0, 0, 1),
    inner: part('M300 304 h80 v56 h-80 Z', '#1E293B', { strokeWidth: MINOR }) +
      `<rect x="310" y="314" width="18" height="12" rx="3" fill="#22C55E"><animate attributeName="opacity" values="1;0.3;1" dur="1.4s" repeatCount="indefinite"/></rect>` +
      `<rect x="334" y="314" width="18" height="12" rx="3" fill="#F43F5E"/><rect x="358" y="314" width="14" height="12" rx="3" fill="#38BDF8"/>` +
      line('M312 340 H370', '#38BDF8', 4) +
      tone('M100 360 C180 380 300 384 414 360 L412 376 C300 400 180 396 100 376 Z', '#38BDF8', 0.85) +
      line('M150 290 C176 310 200 340 210 380', '#94A3B8', 10) + line('M150 290 C176 310 200 340 210 380', '#E2E8F0', 5),
    over: part('M226 246 C254 286 306 300 354 292 C386 286 408 270 418 246 L420 228 C404 262 370 280 340 282 C290 286 248 266 228 228 Z', '#94A3B8') +
      part('M150 330 a16 16 0 1 0 32 0 a16 16 0 1 0 -32 0 Z', '#38BDF8', { strokeWidth: 4 }),
  }),

  'outfit-wizard-robe': () => garment({
    id: 'wizrobe', fill: 'url(#robe)', shadow: '#2E1065', highlight: '#A78BFA', sleeve: '#5B21B6',
    extraDefs: linear('robe', [[0, '#7C3AED'], [1, '#2E1065']], 1, 0, 0, 1),
    inner: [[160, 290, 9], [220, 360, 7], [130, 360, 6], [380, 340, 7], [260, 300, 5], [320, 390, 6]].map(([x, y, r]) => sparkle(x!, y!, r!, '#FDE047')).join('') +
      tone('M180 300 c10 -12 28 -12 34 0 c-12 -4 -24 -2 -34 8 Z', '#FDE047') +
      line('M80 370 C180 390 300 392 414 368', '#F2B627', 9) + line('M260 376 C258 400 266 418 278 430 M276 376 C282 398 296 412 312 420', '#F2B627', 6),
    over: part('M230 248 C258 284 306 298 352 290 C384 284 406 268 416 248 L414 232 C398 260 368 276 338 278 C292 282 254 264 234 234 Z', '#F2B627'),
  }),

  // ─── EPIC ────────────────────────────────────────────────────────────────
  'outfit-quack-knight': () => garment({
    id: 'knight', fill: 'url(#plate)', shadow: '#334155', highlight: '#F8FAFC', sleeve: false,
    extraDefs: metal('plate', '#A9B6C8') + linear('k-sweep', [[0, '#FFFFFF', 0], [0.5, '#FFFFFF', 0.85], [1, '#FFFFFF', 0]], 0, 0, 1, 0),
    inner: line('M120 300 C180 290 240 292 290 304 M100 350 C190 340 280 344 410 350', '#475569', 6) +
      [[140, 300], [200, 294], [260, 298], [140, 348], [220, 344], [380, 352]].map(([x, y]) => dot(x!, y!, 5, '#E2E8F0', { stroke: INK, strokeWidth: 3 })).join('') +
      `<rect x="0" y="200" width="50" height="260" fill="url(#k-sweep)" transform="skewX(-24)">${animateTransform('translate', '0 0; 520 0; 520 0', 3.8)}</rect>`,
    over: solid(CHEST, 'url(#plate)', { strokeWidth: MINOR }) +
      part('M334 304 l28 0 l0 36 c0 18 -14 28 -14 28 c0 0 -14 -10 -14 -28 Z', '#1D4ED8', { strokeWidth: 5 }) +
      `<path d="M342 326 c4 -10 16 -10 18 0 l8 2 -8 4 c-4 8 -14 8 -18 0 Z" fill="#FFD84D"/>` +
      solid('M128 300 C150 270 210 262 262 284 C268 312 252 340 220 352 C180 362 140 350 124 330 Z', 'url(#plate)') +
      line('M140 304 C170 286 214 282 252 296 M134 322 C166 306 210 302 246 316', '#475569', 5) +
      dot(240, 290, 6, '#E2E8F0', { stroke: INK, strokeWidth: 3 }) + sparkle(392, 300, 9),
  }),

  'outfit-cyber-samurai': () => garment({
    id: 'samurai', fill: 'url(#cyber-armor)', shadow: '#050816', highlight: '#334155', sleeve: false,
    extraDefs: linear('cyber-armor', [[0, '#1F2937'], [1, '#05070D']], 1, 0, 0, 1) + glow('neon-seam', 4),
    inner: `<g filter="url(#neon-seam)" fill="none" stroke-width="5" stroke-linecap="round">` +
      `<path d="M110 320 H290 M100 360 H300 M120 396 H300" stroke="#00F2FE">${animate('opacity', '0.45;1;0.45', 2)}</path>` +
      `<path d="M306 280 L330 420 M380 284 L360 410" stroke="#FF2BD6">${animate('opacity', '1;0.45;1', 2)}</path></g>` +
      line('M110 340 H300 M110 378 H300', '#334155', 4),
    over: solid('M118 300 C140 266 204 252 266 276 L254 336 C206 348 150 342 116 326 Z', '#111827') +
      `<g filter="url(#neon-seam)">${line('M132 304 C160 282 206 276 252 290', '#00F2FE', 4)}${line('M126 320 C170 330 214 330 252 322', '#FF2BD6', 3)}</g>` +
      part('M332 300 l22 -12 l22 12 l0 22 l-22 12 l-22 -12 Z', '#0B0F19', { strokeWidth: 5 }) +
      `<circle cx="354" cy="311" r="7" fill="#FF2BD6" filter="url(#neon-seam)">${animate('r', '5;8;5', 1.6)}</circle>`,
  }),

  'outfit-spirit-haori': () => garment({
    id: 'spirit-haori', fill: 'url(#haori)', shadow: '#C084FC', highlight: '#FFFFFF', sleeve: false,
    extraDefs: linear('haori', [[0, '#FFFFFF'], [0.6, '#FCE7F3'], [1, '#F9A8D4']], 0, 0, 0, 1) + linear('haori-sleeve', [[0, '#FFFFFF', 0.95], [1, '#F9A8D4', 0.75]], 0, 0, 0, 1) + glow('petal-glow', 3),
    inner: [[150, 300], [220, 350], [130, 380], [270, 400], [190, 270]].map(([x, y], i) => `<g transform="translate(${x} ${y}) rotate(${i * 40})"><path d="M0 -12 C7 -6 7 4 0 10 C-7 4 -7 -6 0 -12 Z" fill="#F472B6" opacity="0.75"/></g>`).join('') +
      line('M80 400 C180 420 300 420 414 396', '#A855F7', 7, { opacity: 0.7 }),
    over: solid('M246 254 L292 300 L300 420 L276 420 L268 304 Z', '#7C3AED', { strokeWidth: MINOR }) +
      solid('M410 244 L360 300 L344 420 L370 420 L380 306 Z', '#7C3AED', { strokeWidth: MINOR }) +
      solid('M136 316 C168 276 226 266 274 292 C276 340 264 392 226 430 C190 440 146 430 120 410 C114 380 120 340 136 316 Z', 'url(#haori-sleeve)') +
      line('M136 400 C170 414 206 416 236 410', '#A855F7', 5) +
      `<g filter="url(#petal-glow)">` + [[440, 300, 0], [470, 220, 1.2], [96, 230, 2.1]].map(([x, y, d]) => `<g transform="translate(${x} ${y})"><path d="M0 -10 C6 -5 6 4 0 9 C-6 4 -6 -5 0 -10 Z" fill="#F9A8D4">${animateTransform('rotate', '0;360', 6)}</path>${animateTransform('translate', '0 -8; 8 10; 0 -8', 4, { begin: `${d}s` })}${twinkle(4, d)}</g>`).join('') + '</g>',
  }),

  // ─── LEGENDARY — Dragon Robe (Pond Royalty) ──────────────────────────────
  'outfit-dragon-robe': () => garment({
    id: 'dragonrobe', fill: 'url(#imperial)', shadow: '#B7791F', highlight: '#FFF6C9', sleeve: false,
    extraDefs: linear('imperial', [[0, '#FFE58A'], [0.5, '#F2B627'], [1, '#C98A10']], 1, 0, 0, 1) +
      linear('dr-sweep', [[0, '#FFFFFF', 0], [0.5, '#FFFFFF', 0.8], [1, '#FFFFFF', 0]], 0, 0, 1, 0) + glow('dr-glow', 4),
    inner:
      // wave hem (thủy ba) in red & blue
      `<path d="M70 392 q20 -22 40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 V440 H70 Z" fill="#B91C1C"/>` +
      `<path d="M70 412 q20 -16 40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 V440 H70 Z" fill="#1D4ED8"/>` +
      // embroidered dragon coiling across the belly
      `<g filter="url(#dr-glow)" fill="none" stroke="#9A2A0E" stroke-width="9" stroke-linecap="round" stroke-linejoin="round">` +
      `<path d="M300 384 C296 350 330 336 352 352 C372 368 400 356 396 326 C394 304 376 292 360 296"/>` +
      `<path d="M300 370 l-14 -6 M312 346 l-12 -12 M340 342 l0 -16 M366 362 l6 14 M392 344 l14 4 M396 318 l14 -4" stroke-width="6"/></g>` +
      line('M300 384 C296 350 330 336 352 352 C372 368 400 356 396 326 C394 304 376 292 360 296', '#FFF3A6', 3, { strokeDasharray: '6 8' }) +
      `<path d="M362 300 c-10 -16 -32 -14 -36 0 c4 4 10 4 14 2 l-6 10 c10 4 22 0 28 -12 Z" fill="#B91C1C" stroke="${INK}" stroke-width="4"/>` +
      dot(342, 296, 3, '#FFF3A6') +
      `<circle cx="120" cy="336" r="10" fill="#DC2626" stroke="${INK}" stroke-width="4">${animate('r', '9;12;9', 2)}</circle>` +
      `<rect x="0" y="200" width="60" height="260" fill="url(#dr-sweep)" transform="skewX(-24)">${animateTransform('translate', '0 0; 540 0; 540 0', 3.4)}</rect>`,
    over: solid('M226 244 C254 284 306 300 354 292 C386 286 408 270 418 246 L420 222 C404 260 370 278 338 280 C288 284 248 262 230 222 Z', '#B91C1C', { strokeWidth: MINOR }) +
      line('M234 244 C262 276 306 288 350 282', '#FFD84D', 4) +
      solid('M132 306 C170 266 230 264 276 290 C282 336 268 378 238 404 C196 414 150 400 126 376 C118 352 120 324 132 306 Z', 'url(#imperial)') +
      `<path d="M128 372 q16 -14 32 0 t32 0 t32 0 t30 0 L238 404 C196 414 150 400 126 376 Z" fill="#1D4ED8" stroke="${INK}" stroke-width="${DETAIL}"/>` +
      `<g>${sparkle(420, 286, 10, '#FFFBEA')}${twinkle(2.4)}</g><g>${sparkle(196, 330, 8, '#FFFBEA')}${twinkle(2.8, 1)}</g>`,
  }),
}

