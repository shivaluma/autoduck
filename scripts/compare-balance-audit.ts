import { readFileSync, writeFileSync } from 'node:fs'
type Row = { loadout: string; ranks: number[]; winPct: number; bottom2Pct: number; avgRank: number; silences: number; silenceSeconds: number; rocketFired: number; rocketHit: number }
type Report = { seeds: number; start: number; players: number; pickups?: boolean; races: number; rows: Row[] }
const [beforePath, afterPath, outputPath] = process.argv.slice(2)
if (!beforePath || !afterPath || !outputPath) throw Error('Usage: compare-balance-audit before.json after.json output.md')
const before: Report = JSON.parse(readFileSync(beforePath, 'utf8'))
const after: Report = JSON.parse(readFileSync(afterPath, 'utf8'))
if (before.seeds !== after.seeds || before.start !== after.start || before.players !== after.players || Boolean(before.pickups) !== Boolean(after.pickups)) throw Error('Reports are not paired')
const interval = (samples: number[]) => {
  const mean = samples.reduce((a,b) => a+b,0) / samples.length
  if (samples.length < 2) return `${mean.toFixed(3)} [insufficient paired seeds]`
  const se = Math.sqrt(samples.reduce((sum,x) => sum + (x-mean)**2,0) / (samples.length-1) / samples.length)
  return `${mean.toFixed(3)} [${(mean-1.96*se).toFixed(3)}, ${(mean+1.96*se).toFixed(3)}]`
}
const spread = (rows: Row[], metric: 'winPct' | 'avgRank' | 'bottom2Pct') => Math.max(...rows.map(r => r[metric])) - Math.min(...rows.map(r => r[metric]))
const lines = [
  `# Paired balance audit: ${after.players} players, pickups ${after.pickups ? 'on' : 'off'}`,
  `\n${after.seeds} independent seeds, starting ${after.start}; ${after.races} races per version. Focus slot rotates; opponents and seeds are identical across treatments and versions.`,
  '\nRank delta = after − before; negative means improved. Brackets are approximate pointwise 95% paired confidence intervals, not simultaneous intervals across 18 comparisons. Win-rate spread is descriptive and subject to sampling noise.',
  '\n| Loadout | Win % before → after | Bottom-2 % before → after | Rank before → after | Paired rank delta [95% CI] |',
  '|---|---:|---:|---:|---:|',
]
for (const a of after.rows) {
  const b = before.rows.find(row => row.loadout === a.loadout)!
  if (!b || b.ranks.length !== after.seeds || a.ranks.length !== after.seeds) throw Error('Missing paired loadout or seed outcomes')
  lines.push(`| ${a.loadout} | ${b.winPct.toFixed(2)} → ${a.winPct.toFixed(2)} | ${b.bottom2Pct.toFixed(2)} → ${a.bottom2Pct.toFixed(2)} | ${b.avgRank.toFixed(3)} → ${a.avgRank.toFixed(3)} | ${interval(a.ranks.map((r,i) => r-b.ranks[i]!))} |`)
}
for (const metric of ['winPct','avgRank','bottom2Pct'] as const) lines.push(`\n${metric} max–min spread: ${spread(before.rows, metric).toFixed(3)} → ${spread(after.rows,metric).toFixed(3)}.`)
// Resample whole seed blocks, preserving dependence between treatments and versions.
let randomState = 0x51a12
const spreadDeltas: number[] = []
const pairedBefore = after.rows.map(a => before.rows.find(b => b.loadout === a.loadout)!)
for (let iteration = 0; iteration < 1000; iteration++) {
  const sumsBefore = new Array(after.rows.length).fill(0) as number[]
  const sumsAfter = new Array(after.rows.length).fill(0) as number[]
  for (let draw = 0; draw < after.seeds; draw++) {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0
    const index = Math.floor(randomState / 4294967296 * after.seeds)
    for (let row = 0; row < after.rows.length; row++) {
      sumsBefore[row]! += pairedBefore[row]!.ranks[index]!
      sumsAfter[row]! += after.rows[row]!.ranks[index]!
    }
  }
  spreadDeltas.push(((Math.max(...sumsAfter) - Math.min(...sumsAfter)) - (Math.max(...sumsBefore) - Math.min(...sumsBefore))) / after.seeds)
}
spreadDeltas.sort((a,b) => a-b)
lines.push(`\nPaired seed-block bootstrap (1,000 resamples): change in average-rank spread, approximate 95% percentile interval [${spreadDeltas[25]!.toFixed(3)}, ${spreadDeltas[974]!.toFixed(3)}]. Negative means narrower; an interval spanning zero is inconclusive.`)
for (const [label, report] of [['Before',before],['After',after]] as const) {
 const silences = report.rows.reduce((s,r) => s+r.silences,0)
 const seconds = report.rows.reduce((s,r) => s+r.silenceSeconds,0)
 const fired = report.rows.reduce((s,r) => s+r.rocketFired,0)
 const hit = report.rows.reduce((s,r) => s+r.rocketHit,0)
 lines.push(`\n${label}: ${silences} silence applications, ${seconds.toFixed(1)} nominal silence-seconds (not union uptime), ${(seconds/report.races).toFixed(3)} per race; focused prep rockets ${hit}/${fired} hit (${(100*hit/fired).toFixed(2)}%).`)
}
writeFileSync(outputPath, lines.join('\n')+'\n')
console.log(lines.join('\n'))
