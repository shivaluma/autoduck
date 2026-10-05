import {
  DETAIL, INK, MINOR, animate, around, blink, burst, clipped, defs, dot, flame, gem, glow, group, hover, livingGradient, motes, pulse, sway, sweepBand,
  line, linear, metal, part, radial, solid, sparkle, stitch, tone, twinkle,
} from '../kit'

// Skull fit: dome apex ≈ (361, 43); band runs left (228,104) → right (440,98).
// Brims stay above the pupils (y ≥ 134) so the face always reads first.

const DOME = 'M228 104 C224 50 292 18 360 22 C418 26 446 60 440 98 C380 82 286 84 228 104 Z'

export const HEAD_ART: Record<string, () => string> = {
  // ─── COMMON — one silhouette, base + shadow ──────────────────────────────
  'head-cap-red': () => group('cap-red',
    solid(DOME, '#EF4444'),
    clipped('cap-red-c', DOME, tone('M220 110 C236 60 280 34 318 30 C276 52 262 80 262 104 Z', '#B91C1C')),
    line('M330 24 C318 50 314 74 318 92', INK, DETAIL, { opacity: 0.5 }),
    tone('M300 60 h40 v22 h-40 Z', '#FFFDF4'),
    tone('M308 66 h10 v10 h-10 Z M322 66 h10 v10 h-10 Z', '#EF4444'),
    solid('M384 88 C424 80 472 86 496 102 C474 118 420 116 382 106 Z', '#DC2626'),
    tone('M392 96 C424 92 456 96 480 104 C452 110 420 110 392 104 Z', '#991B1B', 0.6),
    dot(352, 22, 9, '#B91C1C', { stroke: INK, strokeWidth: DETAIL }),
  ),

  'head-bucket-blue': () => group('bucket',
    solid('M258 92 C256 52 300 34 350 34 C404 34 430 60 428 90 Z', '#4F9FE8'),
    clipped('bucket-c', 'M258 92 C256 52 300 34 350 34 C404 34 430 60 428 90 Z', tone('M250 96 C262 62 288 44 320 38 C292 56 286 76 288 96 Z', '#2D6CB5')),
    solid('M214 100 C250 80 310 74 346 76 C392 78 444 82 470 96 C450 116 390 108 346 106 C296 106 236 118 214 100 Z', '#61B4F5'),
    tone('M230 104 C270 98 310 96 346 98 C392 100 430 102 458 100 C430 110 390 106 346 106 C296 106 248 114 230 104 Z', '#2D6CB5', 0.7),
    tone('M262 86 C310 74 380 74 426 84 L426 76 C380 66 310 66 262 78 Z', '#2D6CB5'),
  ),

  'head-beanie': () => group('beanie',
    solid('M234 96 C228 38 298 10 358 14 C420 18 448 58 440 94 Z', '#F97316'),
    clipped('beanie-c', 'M234 96 C228 38 298 10 358 14 C420 18 448 58 440 94 Z',
      tone('M226 100 C238 50 276 22 316 18 C286 42 276 70 278 100 Z', '#C2410C') +
      line('M262 96 C262 60 280 34 300 22 M300 92 C300 56 316 30 336 16 M340 88 C344 52 360 28 378 18 M380 86 C388 56 404 36 418 30', '#C2410C', 4, { opacity: 0.55 })),
    solid('M222 106 C280 84 380 76 448 98 L446 72 C380 52 280 58 226 82 Z', '#FDBA74'),
    line('M250 96 V76 M276 90 V70 M302 86 V66 M328 84 V62 M354 82 V62 M380 84 V64 M406 88 V68 M430 94 V74', '#EA8A3C', 5),
    dot(356, 12, 20, '#FFFDF4', { stroke: INK, strokeWidth: MINOR }),
    tone('M342 4 C352 -2 368 2 372 12 C362 8 350 8 342 14 Z', '#E2E8F0'),
  ),

  'head-party-cone': () => group('party-cone',
    solid('M286 78 L384 -36 L428 66 Z', '#A855F7'),
    clipped('party-c', 'M286 78 L384 -36 L428 66 Z',
      tone('M300 78 L392 -40 L404 -26 L320 78 Z M352 78 L412 2 L420 18 L374 78 Z', '#FDE047') +
      dot(330, 40, 6, '#61C9FF') + dot(396, 46, 6, '#FF78A8') + dot(372, 4, 5, '#58E6B0') +
      tone('M286 78 L384 -36 L350 78 Z', '#7E22CE', 0.4)),
    solid('M284 74 C320 92 390 88 430 62 L428 76 C390 102 320 104 282 86 Z', '#FDE047', { strokeWidth: MINOR }),
    solid('M384 -36 c-14 -8 -12 -26 0 -28 c4 -12 22 -10 22 2 c14 -2 18 18 6 24 c4 12 -14 20 -22 10 Z', '#FF78A8', { strokeWidth: MINOR }),
    line('M290 86 C264 130 258 168 266 204', '#FFFDF4', 3, { opacity: 0.7 }),
  ),

  'head-traffic-cone': () => group('traffic-cone',
    solid('M286 80 L350 -34 L420 76 Z', '#F97316'),
    clipped('cone-c', 'M286 80 L350 -34 L420 76 Z',
      tone('M290 40 H420 V56 H290 Z M300 0 H400 V14 H300 Z', '#FFFDF4') +
      tone('M286 80 L350 -34 L330 80 Z', '#C2410C', 0.5) + tone('M362 -16 L404 60 L392 60 Z', '#FDBA74', 0.8)),
    solid('M244 100 C300 80 400 74 456 92 L452 72 C400 58 300 62 248 80 Z', '#EA580C'),
    tone('M254 96 C306 80 396 76 446 88 L446 84 C396 72 306 76 254 90 Z', '#9A3412', 0.6),
  ),

  'head-paper-boat': () => group('paper-hat',
    solid('M232 98 L336 4 L446 92 Z', '#F8FAFC'),
    clipped('paper-c', 'M232 98 L336 4 L446 92 Z',
      tone('M232 98 L336 4 L310 98 Z', '#CBD5E1', 0.7) +
      line('M300 52 H364 M288 64 H384 M276 76 H396 M318 40 H350', '#94A3B8', 4, { opacity: 0.8 }) +
      tone('M326 48 h22 v14 h-22 Z', '#94A3B8', 0.6)),
    solid('M222 110 C290 92 380 86 452 100 L448 80 C380 68 290 72 226 90 Z', '#E2E8F0'),
    line('M240 98 C300 84 380 80 436 88', '#94A3B8', 4),
    line('M336 4 V90', INK, DETAIL, { opacity: 0.35 }),
  ),

  'head-sweatband': () => group('sweatband',
    solid('M230 102 C280 78 380 70 442 92 L440 66 C380 46 280 54 228 76 Z', '#FFFDF4'),
    tone('M230 94 C282 72 380 64 441 84 L441 76 C380 56 282 64 229 86 Z', '#EF4444'),
    solid('M232 86 C206 92 186 112 178 140 C196 128 210 118 230 104 Z', '#FFFDF4', { strokeWidth: MINOR }),
    solid('M230 80 C200 74 176 82 158 100 C182 98 206 98 230 96 Z', '#FFFDF4', { strokeWidth: MINOR }),
    tone('M196 104 C186 116 182 126 180 136 L186 132 C190 120 196 110 204 104 Z', '#EF4444'),
  ),

  // ─── UNCOMMON — + highlight + one material detail ────────────────────────
  'head-tiny-crown': () => group('tiny-crown',
    sway(354, 56, 3, 3.2,
      solid('M312 58 L304 14 L332 34 L350 4 L370 32 L398 12 L396 56 C368 48 340 50 312 58 Z', '#FFD84D') +
      tone('M350 14 L364 32 L388 20 L386 50 C372 46 360 46 350 46 Z', '#FFF3A6', 0.85) +
      tone('M312 58 L304 14 L322 30 L322 56 Z', '#D9A21B', 0.8) +
      part('M310 60 C340 50 370 50 400 58 L398 46 C370 38 340 38 312 48 Z', '#F2B627') +
      gem(355, 50, 8, '#EF4444') +
      dot(304, 14, 6, '#FF78A8', { stroke: INK, strokeWidth: DETAIL }) +
      dot(350, 4, 6, '#61C9FF', { stroke: INK, strokeWidth: DETAIL }) +
      dot(398, 12, 6, '#58E6B0', { stroke: INK, strokeWidth: DETAIL })),
    burst(392, 30, 7, 2.6),
  ),

  'head-chef-hat': () => group('chef',
    pulse(330, 80, 1.04, 2.6,
      solid('M252 82 C210 70 206 10 252 2 C266 -14 300 -10 316 -2 C330 -16 370 -14 384 2 C430 4 440 64 412 80 Z', '#FFFDF4') +
      tone('M252 82 C214 70 210 20 244 6 C236 30 244 60 268 80 Z', '#E2E8F0') +
      tone('M330 6 C350 0 372 6 380 18 C366 14 350 14 336 18 Z M392 14 C410 18 420 32 420 48 C412 38 402 30 390 26 Z', '#FFFFFF') +
      line('M290 78 C286 52 290 30 300 14 M346 76 C348 52 352 32 360 18', '#CBD5E1', 5)),
    solid('M246 102 C300 84 370 80 418 96 L414 74 C370 62 300 64 250 80 Z', '#F1F5F9'),
    line('M262 94 C310 80 370 78 406 86', '#CBD5E1', 4),
  ),

  'head-office-headset': () => group('headset',
    line('M242 132 C232 70 280 30 344 28 C402 26 438 56 440 98', INK, 22),
    line('M242 132 C232 70 280 30 344 28 C402 26 438 56 440 98', '#475569', 12),
    line('M262 70 C290 44 330 36 366 36', '#94A3B8', 4),
    solid('M218 116 C218 100 232 92 248 96 L256 160 C240 166 222 158 220 142 Z', '#334155'),
    part('M226 118 C228 108 236 104 244 106 L250 150 C240 154 230 150 228 140 Z', '#64748B'),
    line('M240 160 C250 210 300 232 342 226', INK, 9),
    line('M240 160 C250 210 300 232 342 226', '#334155', 5),
    part('M336 216 C350 212 362 220 360 232 C356 242 340 242 334 234 Z', '#1E293B'),
    `<circle cx="444" cy="96" r="7" fill="#58E6B0" stroke="${INK}" stroke-width="${DETAIL}">${animate('fill', '#58E6B0;#58E6B0;#EF4444;#58E6B0', 2.4)}</circle>`,
  ),

  'head-cat-ears': () => group('cat-ears',
    line('M240 108 C236 62 286 30 344 28 C402 26 436 56 440 92', INK, 16),
    line('M240 108 C236 62 286 30 344 28 C402 26 436 56 440 92', '#F472B6', 8),
    sway(280, 56, 6, 2.8, solid('M262 66 L244 4 L312 40 Z', '#1F1A2E') + tone('M266 54 L256 20 L294 42 Z', '#FF9EC7')),
    sway(396, 50, 6, 2.8, solid('M366 32 L420 -2 L426 66 Z', '#1F1A2E') + tone('M376 34 L414 12 L416 52 Z', '#FF9EC7'), 0.4),
    tone('M248 10 L256 24 L264 18 Z M418 4 L414 16 L422 18 Z', '#FFFDF4', 0.7),
  ),

  'head-bamboo-hat': () => group('non-la',
    solid('M190 106 L338 2 L484 96 C420 128 270 132 190 106 Z', '#F4E0A5'),
    clipped('nonla-c', 'M190 106 L338 2 L484 96 C420 128 270 132 190 106 Z',
      tone('M190 106 L338 2 L300 124 Z', '#D9BF78', 0.85) +
      line('M226 82 C290 96 390 92 448 72 M262 58 C306 68 380 66 418 52 M294 34 C320 40 360 40 386 32', '#B8964A', 4) +
      line('M338 2 L250 124 M338 2 L300 128 M338 2 L352 128 M338 2 L404 122 M338 2 L452 108', '#C9A75C', 3, { opacity: 0.6 }) +
      tone('M338 2 L420 54 L380 30 Z', '#FFF6D6', 0.8)),
    sway(228, 118, 4, 3, line('M228 118 C220 170 236 218 262 244', '#E11D48', 5)),
    sway(440, 112, 4, 3, line('M440 112 C446 160 430 208 404 240', '#E11D48', 5, { opacity: 0.85 }), 0.6),
  ),

  'head-frog-hood': () => group('frog-hood',
    solid('M216 214 C196 132 224 52 296 28 C360 8 432 34 444 100 C384 76 300 72 260 104 C238 130 236 170 250 214 Z', '#4ADE80'),
    clipped('frog-c', 'M216 214 C196 132 224 52 296 28 C360 8 432 34 444 100 C384 76 300 72 260 104 C238 130 236 170 250 214 Z',
      tone('M210 220 C200 140 224 70 270 40 C246 90 238 150 252 220 Z', '#16A34A') +
      tone('M340 18 C390 18 428 44 440 82 C410 54 380 40 346 36 Z', '#BBF7D0', 0.8)),
    line('M262 102 C300 78 380 74 442 98', '#BBF7D0', 6),
    solid('M282 40 C278 12 300 -2 318 4 C336 10 338 34 326 46 Z', '#4ADE80', { strokeWidth: MINOR }),
    blink(306, 20, 3.4, dot(306, 20, 11, '#FFFDF4', { stroke: INK, strokeWidth: DETAIL }) + dot(309, 22, 5, INK)),
    solid('M366 30 C368 4 392 -4 408 6 C422 16 418 38 404 46 Z', '#4ADE80', { strokeWidth: MINOR }),
    blink(392, 20, 3.4, dot(392, 20, 11, '#FFFDF4', { stroke: INK, strokeWidth: DETAIL }) + dot(395, 22, 5, INK)),
    dot(236, 190, 7, '#16A34A'), dot(226, 166, 5, '#16A34A'),
  ),

  // ─── RARE — multi-part, material sheen ───────────────────────────────────
  'head-cowboy-hat': () => group('cowboy',
    defs(linear('leather', [[0, '#C68A4E'], [0.5, '#9A5B2A'], [1, '#6B3A17']], 1, 0, 0, 1)),
    sway(340, 96, 2.5, 3.4,
      solid('M262 92 C252 40 286 2 326 12 C340 0 370 -2 384 12 C420 6 442 40 430 90 Z', 'url(#leather)') +
      line('M330 14 C338 36 342 58 342 80', '#5A2E10', 6) +
      tone('M388 18 C412 20 428 42 424 74 C414 52 402 36 386 28 Z', '#E2B07A', 0.8) +
      tone('M262 92 C254 50 270 22 298 14 C282 38 280 64 284 92 Z', '#6B3A17', 0.7) +
      part('M262 96 C310 80 384 78 432 92 L430 74 C384 62 310 64 264 78 Z', '#3F2412') +
      dot(344, 84, 9, '#E2E8F0', { stroke: INK, strokeWidth: DETAIL }) +
      solid('M180 74 C196 112 252 118 304 110 C352 102 404 100 450 108 C486 112 508 94 514 62 C500 88 476 94 448 90 C402 84 352 86 302 94 C248 102 204 100 180 74 Z', '#8B4F22') +
      tone('M424 100 C458 104 494 96 512 70 C500 98 474 110 440 108 Z', '#C68A4E') +
      tone('M190 84 C210 104 250 108 290 104 C250 112 210 108 190 84 Z', '#5A2E10', 0.8) +
      stitch('M206 96 C246 108 290 106 330 98', '#E2B07A', 0.8) +
      burst(346, 82, 9, 2.2)),
    motes({ count: 5, x: 170, y: 100, width: 70, height: 30, rise: 40, colors: ['#D6B48A', '#C68A4E'], size: [2, 4], seconds: 2.4, seed: 11, drift: -20 }),
  ),

  'head-wizard-hat': () => group('wizard',
    defs(linear('wiz', [[0, '#8B5CF6'], [1, '#3B1D7A']], 0.8, 0, 0.2, 1), glow('wiz-glow', 4)),
    solid('M264 84 C290 44 306 -2 270 -2 C258 -2 248 6 238 18 C266 10 276 18 260 40 C300 26 330 16 352 -2 C368 24 396 56 418 82 Z', 'url(#wiz)'),
    tone('M352 -2 C368 24 396 56 418 82 L392 82 C376 54 362 30 352 -2 Z', '#B39BFF', 0.7),
    `<g filter="url(#wiz-glow)">` +
      `<g>${sparkle(312, 50, 10, '#FDE047')}${twinkle(1.8)}</g><g>${sparkle(372, 40, 7, '#FDE047')}${twinkle(1.8, 0.6)}</g><g>${dot(338, 70, 4, '#FDE047')}${twinkle(1.8, 1.2)}</g>` +
      `<g>${tone('M296 26 C306 22 314 28 312 38 C306 32 300 30 296 26 Z', '#FDE047')}${animate('opacity', '0.5;1;0.5', 2.4)}</g></g>`,
    part('M258 96 C300 78 380 74 424 90 L422 72 C380 60 300 64 262 80 Z', '#FDE047'),
    tone('M262 90 C300 76 380 72 422 84 L422 80 C380 68 300 70 262 86 Z', '#D9A21B'),
    solid('M206 104 C250 84 320 78 360 80 C410 82 460 88 486 104 C460 118 400 114 352 110 C290 108 232 118 206 104 Z', '#4C2A99'),
    tone('M360 104 C410 106 452 108 476 104 C452 114 404 114 360 110 Z', '#B39BFF', 0.6),
    pulse(340, 82, 1.18, 1.8, gem(340, 82, 9, '#61C9FF')),
    motes({ count: 6, x: 240, y: -20, width: 120, height: 40, rise: 50, colors: ['#FDE047', '#C4B5FD'], size: [3, 5], seconds: 2.6, seed: 4, shape: 'sparkle' }),
  ),

  'head-viking-horns': () => group('viking',
    defs(metal('steel', '#94A3B8'), linear('horn', [[0, '#FFFBEB'], [1, '#D6C49A']], 0, 0, 1, 1)),
    solid('M248 70 C232 40 214 12 182 0 C206 26 210 52 228 82 Z', 'url(#horn)'),
    line('M206 14 L220 10 M216 32 L232 26 M226 52 L240 46', '#B59F6E', 4),
    solid('M424 62 C440 32 462 8 494 -2 C470 26 464 54 444 82 Z', 'url(#horn)'),
    line('M470 10 L458 6 M460 30 L446 24 M450 52 L436 46', '#B59F6E', 4),
    solid('M230 102 C222 48 290 16 352 18 C412 20 448 54 442 98 C380 82 286 84 230 102 Z', 'url(#steel)'),
    clipped('viking-c', 'M230 102 C222 48 290 16 352 18 C412 20 448 54 442 98 C380 82 286 84 230 102 Z', sweepBand('viking-sweep', 180, 0, 50, 120, 320, 2.8)),
    part('M226 108 C284 86 380 80 448 102 L446 84 C380 64 284 70 228 90 Z', '#64748B'),
    line('M336 20 C332 46 330 70 334 86', '#475569', 8),
    dot(252, 96, 5, '#E2E8F0', { stroke: INK, strokeWidth: 3 }), dot(296, 86, 5, '#E2E8F0', { stroke: INK, strokeWidth: 3 }),
    dot(380, 82, 5, '#E2E8F0', { stroke: INK, strokeWidth: 3 }), dot(426, 90, 5, '#E2E8F0', { stroke: INK, strokeWidth: 3 }),
    burst(400, 40, 10, 2.8, 1.2), burst(186, 4, 7, 2.8, 0.4), burst(490, 0, 7, 2.8, 2),
  ),

  'head-motorbike-helmet': () => group('non-bao-hiem',
    defs(linear('enamel', [[0, '#FF8A8A'], [0.45, '#E11D48'], [1, '#881337']], 1, 0, 0, 1)),
    solid('M226 110 C220 46 290 12 356 14 C420 16 452 56 446 104 C380 86 286 88 226 110 Z', 'url(#enamel)'),
    clipped('helmet-c', 'M226 110 C220 46 290 12 356 14 C420 16 452 56 446 104 C380 86 286 88 226 110 Z',
      tone('M300 14 L326 14 L300 110 L274 110 Z M338 14 L352 14 L330 104 L316 104 Z', '#FFFDF4', 0.95) +
      tone('M218 112 C230 70 256 40 290 26 C268 54 260 84 262 112 Z', '#881337', 0.5) +
      sweepBand('helmet-sweep', 170, 0, 44, 130, 330, 2.4, 0, 0.9)),
    tone('M378 26 C410 30 432 50 436 76 C424 60 406 46 384 40 Z', '#FFFFFF', 0.75),
    sway(398, 100, 4, 2.6, solid('M398 92 C430 88 470 94 488 108 C470 120 430 118 400 108 Z', '#1E1B2E') + tone('M408 100 C434 98 458 102 474 108 C452 112 428 112 408 106 Z', '#475569')),
    part('M222 116 C282 94 380 88 452 106 L450 94 C380 76 282 82 224 102 Z', '#1E1B2E'),
    sway(236, 112, 5, 2.2, line('M236 112 C226 160 236 210 262 240', '#1E1B2E', 6)),
    burst(420, 50, 8, 2.4, 1),
  ),

  'head-pho-bowl': () => group('pho-bowl',
    defs(linear('ceramic', [[0, '#FFFFFF'], [0.6, '#F1F5F9'], [1, '#CBD5E1']], 1, 0, 0, 1)),
    sway(318, 70, 3, 1.8, line('M318 70 L268 -2', INK, 14) + line('M318 70 L268 -2', '#B45309', 7)),
    sway(340, 70, 3, 1.8, line('M340 70 L310 -6', INK, 14) + line('M340 70 L310 -6', '#D97706', 7), 0.3),
    solid('M238 64 C276 48 404 46 438 62 C430 92 410 102 338 102 C268 102 246 92 238 64 Z', 'url(#ceramic)'),
    clipped('bowl-c', 'M238 64 C276 48 404 46 438 62 C430 92 410 102 338 102 C268 102 246 92 238 64 Z',
      line('M244 74 C300 84 380 84 434 72', '#2563EB', 6) +
      line('M276 88 q8 -8 16 0 t16 0 M330 92 q8 -8 16 0 t16 0 M384 88 q8 -8 16 0 t16 0', '#2563EB', 3)),
    solid('M240 64 C280 52 400 50 436 62 C400 74 280 76 240 64 Z', '#FDE68A', { strokeWidth: MINOR }),
    line('M262 64 C276 58 300 72 316 62 C330 56 352 70 368 60 C384 54 404 66 420 60', '#F5D27A', 5),
    part('M286 54 C298 46 318 48 324 58 C312 62 296 62 286 54 Z', '#B45309', { strokeWidth: 4 }),
    part('M356 52 C368 44 388 46 394 56 C382 60 366 60 356 52 Z', '#B45309', { strokeWidth: 4 }),
    tone('M332 50 c6 -8 16 -6 18 2 c-6 4 -14 4 -18 -2 Z', '#22C55E'),
    tone('M398 60 c4 -6 12 -6 14 0 c-4 4 -10 4 -14 0 Z', '#22C55E'),
    sway(262, 92, 8, 2, line('M262 92 C258 110 260 124 266 136', '#FDE68A', 6)), sway(402, 96, 8, 2, line('M402 96 C408 112 406 124 400 136', '#FDE68A', 6), 0.5),
    [[362, 0], [392, 0.9], [420, 1.7]].map(([x, d]) => `<path d="M${x} 46 c-10 -14 10 -22 0 -36 c-10 -14 10 -22 0 -36" fill="none" stroke="#FFFFFF" stroke-width="6" stroke-linecap="round" opacity="0"><animateTransform attributeName="transform" type="translate" values="0 6;0 -30" dur="2.6s" begin="${d}s" repeatCount="indefinite"/><animate attributeName="opacity" values="0;0.75;0" dur="2.6s" begin="${d}s" repeatCount="indefinite"/></path>`).join(''),
  ),

  // ─── EPIC — layered set-piece + emissive / idle motion ───────────────────
  'head-space-dome': () => group('space-dome',
    defs(radial('glass', [[0, '#E0F7FF', 0.04], [0.75, '#A5E8FF', 0.14], [1, '#61C9FF', 0.38]], 0.4, 0.4, 0.6), glow('dome-glow', 4)),
    `<ellipse cx="338" cy="140" rx="160" ry="146" fill="url(#glass)" stroke="${INK}" stroke-width="${MINOR}"/>`,
    clipped('dome-c', 'M178 140 a160 146 0 1 0 320 0 a160 146 0 1 0 -320 0 Z',
      sweepBand('dome-sweep', 120, -20, 60, 340, 460, 3.6, 0, 0.55) +
      motes({ count: 8, x: 200, y: 120, width: 260, height: 160, rise: 140, colors: ['#E0F7FF', '#A5E8FF'], size: [3, 7], seconds: 4, seed: 21, drift: 14 }) +
      `<g opacity="0.9">${sparkle(250, 120, 5, '#FFFFFF')}${twinkle(1.6)}</g><g>${sparkle(440, 80, 4, '#FFFFFF')}${twinkle(2.2, 0.7)}</g>`),
    `<ellipse cx="338" cy="140" rx="148" ry="134" fill="none" stroke="#E0F7FF" stroke-width="3" opacity="0.6"/>`,
    line('M402 22 C446 40 478 76 488 120', '#FFFFFF', 12, { opacity: 0.75 }),
    line('M478 150 C478 166 474 180 468 192', '#FFFFFF', 8, { opacity: 0.6 }),
    tone('M230 52 c10 -10 22 -14 30 -12 c-14 8 -22 16 -28 26 Z', '#FFFFFF', 0.7),
    part('M196 236 C250 286 420 290 478 230 L486 250 C420 312 250 310 188 254 Z', '#E2E8F0'),
    line('M210 256 C270 296 410 296 470 250', '#94A3B8', 4),
    [[262, 268, '#38BDF8', 0], [298, 280, '#F43F5E', 0.3], [334, 284, '#FDE047', 0.6], [370, 282, '#58E6B0', 0.9]].map(([x, y, c, d]) => `<circle cx="${x}" cy="${y}" r="6" fill="${c}">${animate('opacity', '0.25;1;0.25', 1.2, { begin: `${d}s` })}</circle>`).join(''),
    sway(306, 8, 10, 1.6, line('M300 -2 L312 8', INK, 6) + `<g filter="url(#dome-glow)">${dot(298, -4, 9, '#F43F5E', { stroke: INK, strokeWidth: DETAIL })}<circle cx="298" cy="-4" r="9" fill="#FECDD3">${animate('opacity', '0;1;0', 1.2)}</circle></g>`),
    `<circle cx="298" cy="-4" r="10" fill="none" stroke="#F43F5E" stroke-width="3">${animate('r', '10;26', 1.2, { calcMode: 'linear', keySplines: undefined })}${animate('opacity', '0.9;0', 1.2, { calcMode: 'linear', keySplines: undefined })}</circle>`,
  ),

  'head-cyber-mohawk': () => group('cyber-mohawk',
    defs(livingGradient('neon', [['#FF2BD6', '#8B5CF6', '#00F2FE', '#22FFA6'], ['#00F2FE', '#22FFA6', '#FF2BD6', '#8B5CF6']], 3, 0, 0, 1, 0), glow('mohawk-glow', 6)),
    `<g filter="url(#mohawk-glow)">` +
      around(340, 84, `<animateTransform attributeName="transform" type="scale" values="1 1;1 1.08;1 0.97;1 1" dur="0.9s" repeatCount="indefinite"/>`,
        solid('M246 80 L232 20 L276 56 L280 -2 L316 44 L336 -10 L358 38 L392 -2 L392 48 L434 20 L428 84 C380 66 296 64 246 80 Z', 'url(#neon)', { strokeWidth: MINOR }) +
        `<path d="M246 80 L232 20 L276 56 L280 -2 L316 44 L336 -10 L358 38 L392 -2 L392 48 L434 20 L428 84" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-dasharray="40 260">${animate('stroke-dashoffset', '0;-300', 1.4, { calcMode: 'linear', keySplines: undefined })}</path>`) +
      `</g>`,
    part('M232 106 C290 82 380 76 446 98 L444 82 C380 62 290 68 234 90 Z', '#0B0F19'),
    `<path d="M252 98 C300 82 380 78 434 92" stroke="#00F2FE" stroke-width="4" fill="none" stroke-dasharray="14 10">${animate('stroke-dashoffset', '0;-48', 0.8, { calcMode: 'linear', keySplines: undefined })}</path>`,
    `<circle cx="440" cy="92" r="7" fill="#FF2BD6" stroke="${INK}" stroke-width="${DETAIL}">${animate('fill', '#FF2BD6;#00F2FE;#FF2BD6', 1.2)}</circle>`,
    `<g filter="url(#mohawk-glow)">${motes({ count: 7, x: 240, y: -10, width: 200, height: 40, rise: 50, colors: ['#FF2BD6', '#00F2FE', '#FFFFFF'], size: [2, 4], seconds: 1.6, seed: 8, drift: 16 })}</g>`,
  ),

  'head-dragon-horns': () => group('dragon-horns',
    defs(linear('dhorn', [[0, '#7F1D1D'], [0.6, '#DC2626'], [1, '#FFD84D']], 0, 1, 0.3, 0), glow('ember', 5),
      `<linearGradient id="horn-heat" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#FDE047" stop-opacity="0"/><stop offset="1" stop-color="#FDE047" stop-opacity="0.8">${animate('stop-opacity', '0.15;0.8;0.15', 1.6)}</stop></linearGradient>`),
    solid('M268 76 C250 40 246 4 270 -8 C262 18 276 40 300 66 Z', 'url(#dhorn)'),
    tone('M268 76 C250 40 246 4 270 -8 C262 18 276 40 300 66 Z', 'url(#horn-heat)'),
    solid('M254 78 C224 70 204 46 206 18 C220 42 240 54 266 60 Z', 'url(#dhorn)', { strokeWidth: MINOR }),
    solid('M386 62 C406 28 434 8 466 8 C440 24 424 48 412 78 Z', 'url(#dhorn)'),
    tone('M386 62 C406 28 434 8 466 8 C440 24 424 48 412 78 Z', 'url(#horn-heat)'),
    solid('M418 84 C448 76 476 80 494 98 C468 94 444 96 424 100 Z', 'url(#dhorn)', { strokeWidth: MINOR }),
    line('M262 44 L278 40 M258 24 L270 20 M402 48 L416 54 M420 28 L432 34', '#FCA5A5', 4, { opacity: 0.8 }),
    part('M236 100 C290 80 380 74 444 94 L442 82 C380 64 290 70 238 88 Z', '#FFD84D'),
    `<g filter="url(#ember)">${pulse(340, 80, 1.2, 1.4, gem(340, 80, 10, '#DC2626'))}</g>`,
    `<g filter="url(#ember)">${flame(270, -4, 30, ['#F97316', '#FDE047'], 0.5)}${flame(466, 10, 28, ['#F97316', '#FDE047'], 0.55, 0.2)}</g>`,
    `<g filter="url(#ember)">${motes({ count: 6, x: 250, y: -20, width: 40, height: 20, rise: 60, colors: ['#FDE047', '#F97316'], size: [2, 4], seconds: 1.6, seed: 3 })}${motes({ count: 6, x: 446, y: -6, width: 40, height: 20, rise: 60, colors: ['#FDE047', '#F97316'], size: [2, 4], seconds: 1.7, seed: 9 })}</g>`,
  ),

  // ─── LEGENDARY — unique silhouette, multi-layer motion, Pond Royalty set ──
  'head-dragon-emperor-crown': () => group('emperor-crown',
    defs(
      metal('gold', '#F2B627'),
      linear('lacquer', [[0, '#3B2A55'], [1, '#120A20']], 1, 0, 0, 1),
      radial('crown-aura', [[0, '#FFF3A6', 0.55], [1, '#FFF3A6', 0]]),
      glow('crown-glow', 6),
    ),
    `<ellipse cx="346" cy="40" rx="150" ry="70" fill="url(#crown-aura)">${animate('opacity', '0.35;0.9;0.35', 2.4)}</ellipse>`,
    hover(5, 2.8,
      // cánh chuồn — the mandarin hat wings give a silhouette no other item shares
      sway(240, 84, 4, 2.8, solid('M240 74 C200 70 168 58 150 40 C150 64 176 86 236 94 Z', 'url(#lacquer)') + line('M230 80 C200 76 178 66 162 52', '#F2B627', 4)) +
      sway(436, 80, 4, 2.8, solid('M436 68 C476 62 504 48 512 30 C514 56 490 80 438 90 Z', 'url(#lacquer)') + line('M446 76 C474 70 494 60 504 46', '#F2B627', 4), 1.4) +
      solid('M236 100 C228 50 290 20 352 20 C414 20 448 54 440 96 C380 80 290 82 236 100 Z', 'url(#lacquer)') +
      solid('M246 92 L254 30 L286 56 L306 4 L336 44 L356 -6 L378 42 L408 4 L422 54 L446 32 L438 92 C380 76 300 76 246 92 Z', 'url(#gold)') +
      clipped('crown-c', 'M246 92 L254 30 L286 56 L306 4 L336 44 L356 -6 L378 42 L408 4 L422 54 L446 32 L438 92 C380 76 300 76 246 92 Z',
        sweepBand('crown-sweep', 160, -20, 60, 140, 380, 2.6, 0, 0.95)) +
      // stylised dragon crest coiling over the brow
      part('M300 70 C306 50 330 42 352 50 C372 56 380 40 372 28 C392 34 398 58 384 72 C366 88 336 70 318 82 Z', '#FFE58A') +
      `<circle cx="370" cy="36" r="4" fill="#DC2626">${animate('fill', '#DC2626;#FDE047;#DC2626', 1.6)}</circle>` +
      line('M318 76 C330 64 346 62 360 66', '#B7791F', 4) +
      part('M232 106 C290 84 380 78 448 100 L446 84 C380 62 290 68 234 90 Z', '#B7791F') +
      pulse(290, 88, 1.15, 2, gem(290, 88, 8, '#10B981'), 0.5) + pulse(400, 86, 1.15, 2, gem(400, 86, 8, '#10B981'), 1.5) +
      `<g filter="url(#crown-glow)">${pulse(346, 84, 1.22, 1.6, gem(346, 84, 12, '#DC2626'))}</g>` +
      dot(306, 6, 6, '#FF78A8', { stroke: INK, strokeWidth: DETAIL }) + dot(356, -4, 7, '#61C9FF', { stroke: INK, strokeWidth: DETAIL }) + dot(408, 6, 6, '#FF78A8', { stroke: INK, strokeWidth: DETAIL })),
    // orbiting spark ring around the crown
    `<g filter="url(#crown-glow)">${[0, 1.5, 3].map((d) => `<g>${sparkle(0, 0, 7, '#FFF3A6')}<animateMotion dur="4.5s" begin="${-d}s" repeatCount="indefinite" path="M346 40 m-170 0 a170 50 0 1 0 340 0 a170 50 0 1 0 -340 0"/></g>`).join('')}</g>`,
    burst(270, 18, 10, 2.4), burst(432, 10, 8, 2.4, 0.8), burst(484, 100, 7, 2.4, 1.6), burst(200, 60, 7, 2.4, 1.2),
    motes({ count: 8, x: 230, y: 10, width: 230, height: 80, rise: 70, colors: ['#FFF3A6', '#FDE047'], size: [2, 4], seconds: 3, seed: 14, shape: 'sparkle' }),
  ),
}

