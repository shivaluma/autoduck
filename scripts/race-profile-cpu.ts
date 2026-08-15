#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const profileDir = fileURLToPath(new URL('../artifacts/profiles', import.meta.url))
mkdirSync(profileDir, { recursive: true })

const script = fileURLToPath(new URL('./race-simulate-balance.ts', import.meta.url))
const seeds = process.argv.includes('--seeds') ? process.argv[process.argv.indexOf('--seeds') + 1] : '500'
const args = [
  '--cpu-prof',
  `--cpu-prof-dir=${profileDir}`,
  '--import',
  'tsx',
  script,
  '--mode',
  'benchmark',
  '--seeds',
  seeds,
  '--workers',
  '1',
  '--bootstrap-archetype',
  '0',
  '--bootstrap-matrix',
  '0',
  ...process.argv.slice(2).filter((arg) => arg !== '--seeds' && arg !== process.argv[process.argv.indexOf('--seeds') + 1]),
]

console.log(`Writing CPU profile to ${profileDir}`)
console.log(`Command: node ${args.join(' ')}`)
const result = spawnSync(process.execPath, args, { stdio: 'inherit' })
if (result.status !== 0) process.exit(result.status ?? 1)
console.log(`\nOpen ${profileDir}/*.cpuprofile in Chrome DevTools → Performance/Profiler`)
