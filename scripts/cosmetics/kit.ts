import { DUCK_PATHS, STROKE_TOKENS, shiftTone } from '../../lib/cosmetics/avatar-rig'

export const { OUTLINE_MAJOR: MAJOR, OUTLINE_MINOR: MINOR, DETAIL, COLOR: INK } = STROKE_TOKENS
export { DUCK_PATHS, shiftTone }

export const dark = (hex: string, amount = 1) => shiftTone(hex, -amount)
export const light = (hex: string, amount = 1) => shiftTone(hex, amount)

type Attrs = Record<string, string | number | undefined>

function attrs(values: Attrs) {
  return Object.entries(values)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}="${value}"`)
    .join(' ')
}

/** Outlined filled shape — the workhorse of every silhouette. */
export function solid(d: string, fill: string, extra: Attrs = {}) {
  return `<path d="${d}" ${attrs({ fill, stroke: INK, strokeWidth: MAJOR, strokeLinejoin: 'round', strokeLinecap: 'round', ...extra })}/>`
}

/** Secondary outlined shape (thinner outline). */
export function part(d: string, fill: string, extra: Attrs = {}) {
  return solid(d, fill, { strokeWidth: MINOR, ...extra })
}

/** Unoutlined tone shape: shadows, highlights, prints. */
export function tone(d: string, fill: string, opacity = 1, extra: Attrs = {}) {
  return `<path d="${d}" ${attrs({ fill, opacity: opacity === 1 ? undefined : opacity, ...extra })}/>`
}

export function line(d: string, stroke: string, width: number = DETAIL, extra: Attrs = {}) {
  return `<path d="${d}" ${attrs({ fill: 'none', stroke, strokeWidth: width, strokeLinecap: 'round', strokeLinejoin: 'round', ...extra })}/>`
}

export function dot(cx: number, cy: number, r: number, fill: string, extra: Attrs = {}) {
  return `<circle ${attrs({ cx, cy, r, fill, ...extra })}/>`
}

/** Stitching / seam detail used by uncommon+ fabric. */
export function stitch(d: string, stroke = '#FFFDF4', opacity = 0.7) {
  return line(d, stroke, 3, { strokeDasharray: '6 7', opacity })
}

/** Clips content to the shape group: highlights and shadows never spill past the outline. */
export function clipped(id: string, d: string, content: string) {
  return `<clipPath id="${id}"><path d="${d}"/></clipPath><g clip-path="url(#${id})">${content}</g>`
}

export function linear(id: string, stops: Array<[number, string, number?]>, x1 = 0, y1 = 0, x2 = 0, y2 = 1) {
  return `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops.map(([offset, color, opacity]) => `<stop offset="${offset}" stop-color="${color}"${opacity === undefined ? '' : ` stop-opacity="${opacity}"`}/>`).join('')}</linearGradient>`
}

export function radial(id: string, stops: Array<[number, string, number?]>, cx = 0.5, cy = 0.5, r = 0.5) {
  return `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">${stops.map(([offset, color, opacity]) => `<stop offset="${offset}" stop-color="${color}"${opacity === undefined ? '' : ` stop-opacity="${opacity}"`}/>`).join('')}</radialGradient>`
}

/** Metal sheen: bright top-right band fading to deep base. Rare+ only. */
export function metal(id: string, base: string) {
  return linear(id, [[0, light(base, 1.4)], [0.35, base], [0.62, dark(base, 0.6)], [0.78, light(base, 0.8)], [1, dark(base, 1.2)]], 1, 0, 0.2, 1)
}

/** Soft emissive glow filter. Epic+ only. */
export function glow(id: string, deviation = 6) {
  return `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${deviation}" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`
}

/** Four-point sparkle, used for glints on rare+ metal and gems. */
export function sparkle(cx: number, cy: number, size: number, fill = '#FFFDF4', extra: Attrs = {}) {
  const s = size
  const k = size * 0.22
  return `<path d="M${cx} ${cy - s} Q${cx + k} ${cy - k} ${cx + s} ${cy} Q${cx + k} ${cy + k} ${cx} ${cy + s} Q${cx - k} ${cy + k} ${cx - s} ${cy} Q${cx - k} ${cy - k} ${cx} ${cy - s} Z" ${attrs({ fill, ...extra })}/>`
}

/** Faceted gem with outline and a highlight facet. */
export function gem(cx: number, cy: number, r: number, color: string) {
  const top = `M${cx} ${cy - r} L${cx + r * 0.86} ${cy - r * 0.2} L${cx + r * 0.5} ${cy + r} L${cx - r * 0.5} ${cy + r} L${cx - r * 0.86} ${cy - r * 0.2} Z`
  return `<g>${part(top, color, { strokeWidth: DETAIL + 1 })}${tone(`M${cx} ${cy - r * 0.7} L${cx + r * 0.5} ${cy - r * 0.15} L${cx} ${cy + r * 0.1} L${cx - r * 0.3} ${cy - r * 0.2} Z`, light(color, 1.6), 0.85)}${tone(`M${cx - r * 0.5} ${cy + r * 0.85} L${cx} ${cy + r * 0.1} L${cx + r * 0.42} ${cy + r * 0.85} Z`, dark(color), 0.55)}</g>`
}

/** SMIL attributes are camelCase (attributeName, repeatCount…) — never kebab-case them. */
function smilAttrs(values: Attrs) {
  return Object.entries(values)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}="${value}"`)
    .join(' ')
}

/** SMIL helpers — animations run inside <img>-embedded SVG in every modern browser. */
export function animate(attribute: string, values: string, seconds: number, extra: Attrs = {}) {
  return `<animate ${smilAttrs({ attributeName: attribute, values, dur: `${seconds}s`, repeatCount: 'indefinite', calcMode: 'spline', keySplines: values.split(';').slice(1).map(() => '0.45 0 0.55 1').join(';'), ...extra })}/>`
}

export function animateTransform(type: 'rotate' | 'translate' | 'scale', values: string, seconds: number, extra: Attrs = {}) {
  return `<animateTransform ${smilAttrs({ attributeName: 'transform', type, values, dur: `${seconds}s`, repeatCount: 'indefinite', additive: 'sum', ...extra })}/>`
}

export function twinkle(seconds: number, delay = 0) {
  return animate('opacity', '0.15;1;0.15', seconds, { begin: `${delay}s` })
}

export function defs(...content: string[]) {
  return `<defs>${content.join('')}</defs>`
}

export function group(id: string, ...content: string[]) {
  return `<g id="${id}">${content.join('\n')}</g>`
}

// ─── Motion kit (v2.1) ─────────────────────────────────────────────────────
// Every motion is SMIL so it plays inside <img>-embedded layers. Rarity budget:
// common = static · uncommon = one gentle loop · rare = 2–3 loops · epic/legendary = layered, emissive motion.

/** Applies a transform animation around a pivot instead of the SVG origin. */
export function around(cx: number, cy: number, motion: string, content: string) {
  return `<g transform="translate(${cx} ${cy})"><g>${motion}<g transform="translate(${-cx} ${-cy})">${content}</g></g></g>`
}

export function sway(cx: number, cy: number, degrees: number, seconds: number, content: string, begin = 0) {
  return around(cx, cy, animateTransform('rotate', `${-degrees};${degrees};${-degrees}`, seconds, { begin: `${begin}s`, calcMode: 'spline', keyTimes: '0;0.5;1', keySplines: '0.45 0 0.55 1;0.45 0 0.55 1' }), content)
}

export function pulse(cx: number, cy: number, scale: number, seconds: number, content: string, begin = 0) {
  return around(cx, cy, animateTransform('scale', `1;${scale};1`, seconds, { begin: `${begin}s`, calcMode: 'spline', keyTimes: '0;0.5;1', keySplines: '0.45 0 0.55 1;0.45 0 0.55 1' }), content)
}

export function hover(distance: number, seconds: number, content: string, begin = 0) {
  return `<g>${animateTransform('translate', `0 0;0 ${-distance};0 0`, seconds, { begin: `${begin}s`, calcMode: 'spline', keyTimes: '0;0.5;1', keySplines: '0.45 0 0.55 1;0.45 0 0.55 1' })}${content}</g>`
}

/** Quick blink: squash Y around the eye centre for a few frames every `seconds`. */
export function blink(cx: number, cy: number, seconds: number, content: string, begin = 0) {
  return around(cx, cy, `<animateTransform attributeName="transform" type="scale" values="1 1;1 1;1 0.08;1 1" keyTimes="0;0.9;0.95;1" dur="${seconds}s" begin="${begin}s" repeatCount="indefinite"/>`, content)
}

/** Cycles a gradient stop through colours — drop inside a <stop>. */
export function cycleStop(colors: string[], seconds: number, begin = 0) {
  return `<animate attributeName="stop-color" values="${[...colors, colors[0]].join(';')}" dur="${seconds}s" begin="${begin}s" repeatCount="indefinite"/>`
}

/** Gradient whose stops colour-cycle; stops = list of colour loops, one per stop. */
export function livingGradient(id: string, loops: string[][], seconds: number, x1 = 0, y1 = 0, x2 = 1, y2 = 1) {
  return `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${loops.map((colors, index) => `<stop offset="${loops.length === 1 ? 0 : index / (loops.length - 1)}" stop-color="${colors[0]}">${cycleStop(colors, seconds)}</stop>`).join('')}</linearGradient>`
}

/** Diagonal light band that sweeps across whatever clip it sits in. */
export function sweepBand(gradientId: string, x: number, y: number, width: number, height: number, travel: number, seconds: number, begin = 0, opacity = 0.85) {
  return `${linear(gradientId, [[0, '#FFFFFF', 0], [0.5, '#FFFFFF', opacity], [1, '#FFFFFF', 0]], 0, 0, 1, 0)}` +
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="url(#${gradientId})" transform="skewX(-22)"><animateTransform attributeName="transform" type="translate" values="0 0;${travel} 0;${travel} 0" keyTimes="0;0.45;1" dur="${seconds}s" begin="${begin}s" repeatCount="indefinite" additive="sum"/></rect>`
}

/** Sparkle that pops in, spins a quarter turn and fades — staggered bursts read as "magic". */
export function burst(cx: number, cy: number, size: number, seconds: number, begin = 0, fill = '#FFFBEA') {
  return around(cx, cy,
    `<animateTransform attributeName="transform" type="scale" values="0;1.15;0;0" keyTimes="0;0.18;0.4;1" dur="${seconds}s" begin="${begin}s" repeatCount="indefinite"/>`,
    `<g>${sparkle(cx, cy, size, fill)}<animateTransform attributeName="transform" type="rotate" values="0 ${cx} ${cy};90 ${cx} ${cy}" dur="${seconds}s" begin="${begin}s" repeatCount="indefinite"/></g>`)
}

/** Deterministic pseudo-random in [0,1) so generated art is stable between runs. */
function seeded(seed: number) {
  const x = Math.sin(seed * 9301 + 49297) * 233280
  return x - Math.floor(x)
}

/** Particles that rise and fade inside a box — embers, motes, bubbles. */
export function motes(options: { count: number; x: number; y: number; width: number; height: number; rise: number; colors: string[]; size?: [number, number]; seconds?: number; seed?: number; drift?: number; shape?: 'dot' | 'sparkle' }) {
  const { count, x, y, width, height, rise, colors, size = [2.5, 5], seconds = 3, seed = 1, drift = 10, shape = 'dot' } = options
  return Array.from({ length: count }, (_, i) => {
    const r1 = seeded(seed + i * 3.1)
    const r2 = seeded(seed + i * 7.7)
    const r3 = seeded(seed + i * 1.3)
    const px = x + r1 * width
    const py = y + r2 * height
    const radius = size[0] + r3 * (size[1] - size[0])
    const color = colors[i % colors.length]!
    const duration = seconds * (0.75 + r3 * 0.5)
    const begin = -(r2 * duration)
    const sway = (r1 - 0.5) * 2 * drift
    const mark = shape === 'sparkle' ? sparkle(px, py, radius * 1.6, color) : `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${radius.toFixed(1)}" fill="${color}"/>`
    return `<g>${mark}<animateTransform attributeName="transform" type="translate" values="0 0;${sway.toFixed(1)} ${-rise}" dur="${duration.toFixed(2)}s" begin="${begin.toFixed(2)}s" repeatCount="indefinite"/><animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.2;0.7;1" dur="${duration.toFixed(2)}s" begin="${begin.toFixed(2)}s" repeatCount="indefinite"/></g>`
  }).join('')
}

/** Flickering flame tongue anchored at its base. */
export function flame(cx: number, cy: number, height: number, colors: [string, string], seconds = 0.6, begin = 0) {
  const w = height * 0.42
  const d = `M${cx} ${cy} C${cx - w} ${cy - height * 0.3} ${cx - w * 0.3} ${cy - height * 0.7} ${cx} ${cy - height} C${cx + w * 0.3} ${cy - height * 0.7} ${cx + w} ${cy - height * 0.3} ${cx} ${cy} Z`
  const inner = `M${cx} ${cy} C${cx - w * 0.5} ${cy - height * 0.25} ${cx - w * 0.15} ${cy - height * 0.5} ${cx} ${cy - height * 0.68} C${cx + w * 0.15} ${cy - height * 0.5} ${cx + w * 0.5} ${cy - height * 0.25} ${cx} ${cy} Z`
  return around(cx, cy, `<animateTransform attributeName="transform" type="scale" values="1 1;0.86 1.18;1.08 0.9;1 1" dur="${seconds}s" begin="${begin}s" repeatCount="indefinite"/>`,
    `<path d="${d}" fill="${colors[0]}"/><path d="${inner}" fill="${colors[1]}"/>`)
}
