// Optional: run the browser bench in Chromium with CPU throttling via CDP.
//
//   scripts/build-wasm.sh
//   node crates/race-wasm/bench/run-chromium.mjs [--rate 4] [--r 19] [--channel chrome] [--headed]
//
// Uses the repo's Playwright. Without --channel it needs `pnpm exec playwright
// install chromium`; `--channel chrome` uses an installed Google Chrome.
// CDP `Emulation.setCPUThrottlingRate` is what DevTools' "4x slowdown" sets.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..') // crates/race-wasm: serves bench/ and pkg/
const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = args.indexOf(name)
  return index === -1 ? fallback : args[index + 1]
}
const rate = Number(flag('--rate', '4'))
const r = flag('--r', '')
const channel = flag('--channel', undefined)
const query = new URLSearchParams({ autorun: '1', ducks: flag('--ducks', '8'), ticks: flag('--ticks', '5400'), work: flag('--work', '1'), iterations: flag('--iterations', '15') })
if (r) query.set('r', r)

const types = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm' }
const server = createServer(async (req, res) => {
  const path = resolve(root, `.${decodeURIComponent(new URL(req.url, 'http://x').pathname)}`)
  if (!path.startsWith(root + sep)) { res.writeHead(403).end(); return }
  try {
    const body = await readFile(path)
    res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' }).end(body)
  } catch {
    res.writeHead(404).end()
  }
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const url = `http://127.0.0.1:${server.address().port}/bench/index.html?${query}`

const browser = await chromium.launch({ channel, headless: !args.includes('--headed') })
try {
  const page = await browser.newPage()
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate })
  page.on('console', (message) => console.error(`[page] ${message.text()}`))
  await page.goto(url)
  await page.waitForSelector('body[data-done="1"]', { timeout: 15 * 60 * 1000 })
  const result = await page.evaluate(() => window.__benchResult)
  console.log(JSON.stringify({ cpuThrottlingRate: rate, ...result }, null, 2))
} finally {
  await browser.close()
  server.close()
}
