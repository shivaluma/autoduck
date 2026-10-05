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

/** SMIL helpers — animations run inside <img>-embedded SVG in every modern browser. */
export function animate(attribute: string, values: string, seconds: number, extra: Attrs = {}) {
  return `<animate ${attrs({ attributeName: attribute, values, dur: `${seconds}s`, repeatCount: 'indefinite', calcMode: 'spline', keySplines: values.split(';').slice(1).map(() => '0.45 0 0.55 1').join(';'), ...extra })}/>`
}

export function animateTransform(type: 'rotate' | 'translate' | 'scale', values: string, seconds: number, extra: Attrs = {}) {
  return `<animateTransform ${attrs({ attributeName: 'transform', type, values, dur: `${seconds}s`, repeatCount: 'indefinite', additive: 'sum', ...extra })}/>`
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
