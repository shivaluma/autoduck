import fs from 'node:fs'
import path from 'node:path'
import { COSMETIC_CATALOG } from '../lib/cosmetics/catalog'
import {
  CANONICAL_PALETTES,
  DUCK_RIG_ANCHORS,
  DUCK_VIEWBOX,
  FACE_SAFE_ZONE,
  STROKE_TOKENS,
  THEME_PALETTES,
  generateBaseDuckSvg,
  getDuckPalette,
} from '../lib/cosmetics/avatar-rig'
import type { CosmeticDefinition } from '../lib/cosmetics/types'

const root = path.join(process.cwd(), 'public', 'cosmetics', 'v1')
const previewRoot = path.join(process.cwd(), 'public', 'cosmetics', 'previews', 'v1')
const uiRoot = path.join(process.cwd(), 'public', 'cosmetics', 'ui')

const { OUTLINE_MAJOR, OUTLINE_MINOR, DETAIL, COLOR } = STROKE_TOKENS

function frame(content: string, viewBox = DUCK_VIEWBOX) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="100%" height="100%" fill="none">\n${content}\n</svg>\n`
}

function hash(value: string) {
  return [...value].reduce((total, char) => ((total * 31) + char.charCodeAt(0)) >>> 0, 7)
}

const PALETTE_COLORS = [
  '#FF5B67', '#61C9FF', '#58E6B0', '#B99AFF', '#FFD84D', '#FF78A8',
  '#8EE3F5', '#F08A5D', '#FFBE3D', '#38EF7D', '#11998E', '#EA384D',
  '#9333EA', '#06B6D4', '#F43F5E', '#10B981', '#F59E0B', '#6366F1',
]

// -------------------------------------------------------------
// 1. HEADWEAR (Head Items - Skull Baseline Y:88..96, Brim Y <= 112)
// -------------------------------------------------------------
function generateHead(item: CosmeticDefinition, primary: string, secondary: string, seed: number) {
  const { id, rarity } = item

  // COMMON HEADWEAR (Grounded, clean 2-value shapes, zero visual noise)
  if (id === 'head-cap-red') {
    return `<g id="head-cap">
      <path d="M236 96 C240 44, 310 28, 372 40 C404 48, 416 72, 412 96 Z" fill="#EF4444" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}" stroke-linejoin="round"/>
      <path d="M242 92 C248 54, 305 38, 362 44" fill="#B91C1C" opacity="0.45"/>
      <path d="M260 92 C270 56, 320 44, 370 48" stroke="#FFFDF4" stroke-width="${OUTLINE_MINOR}" stroke-linecap="round" fill="none"/>
      <circle cx="320" cy="36" r="10" fill="#FFFDF4" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <path d="M344 90 C384 82, 444 86, 468 100 C440 114, 376 112, 340 102 Z" fill="#DC2626" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}" stroke-linejoin="round"/>
    </g>`
  }

  if (id === 'head-beanie') {
    return `<g id="head-beanie">
      <path d="M236 96 C240 36, 316 28, 374 38 C406 46, 416 70, 412 96 Z" fill="#3B82F6" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}" stroke-linejoin="round"/>
      <path d="M228 98 C284 84, 364 84, 420 98 L418 84 C364 72, 284 72, 228 84 Z" fill="#1D4ED8" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
      <circle cx="316" cy="28" r="14" fill="#FFFDF4" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <line x1="260" y1="86" x2="260" y2="98" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <line x1="320" y1="84" x2="320" y2="98" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <line x1="380" y1="86" x2="380" y2="98" stroke="${COLOR}" stroke-width="${DETAIL}"/>
    </g>`
  }

  if (id === 'head-paper-boat') {
    return `<g id="head-paper-boat">
      <polygon points="240,96 328,40 416,96 328,80" fill="#FFFDF4" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}" stroke-linejoin="round"/>
      <polygon points="280,88 328,40 376,88" fill="#E2E8F0"/>
      <line x1="328" y1="40" x2="328" y2="80" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
    </g>`
  }

  if (id === 'head-traffic-cone') {
    return `<g id="head-cone">
      <polygon points="268,96 328,12 388,96" fill="#F97316" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}" stroke-linejoin="round"/>
      <polygon points="286,68 328,12 370,68" fill="#FFFDF4" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
      <path d="M240 98 H416" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}" stroke-linecap="round"/>
    </g>`
  }

  // UNCOMMON HEADWEAR (Themed accents, ribbons, clean lines)
  if (id === 'head-bucket-blue') {
    return `<g id="head-bucket">
      <path d="M256 92 C260 48, 316 36, 370 40 C396 44, 406 68, 404 92 Z" fill="#61C9FF" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}" stroke-linejoin="round"/>
      <path d="M250 86 C296 74, 364 76, 408 88 L408 76 C364 64, 296 62, 250 74 Z" fill="#1C7ED6"/>
      <!-- Brim curving high above eye level Y: 104 -->
      <path d="M228 98 C288 78, 376 80, 436 100 C444 110, 392 116, 328 112 C264 108, 220 108, 228 98 Z" fill="#38BDF8" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}" stroke-linejoin="round"/>
    </g>`
  }

  if (id === 'head-chef-hat') {
    return `<g id="head-chef">
      <path d="M256 76 C216 56, 216 -4, 268 -8 C288 -32, 352 -32, 372 -8 C424 -4, 432 56, 396 76 Z" fill="#FFFDF4" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}" stroke-linejoin="round"/>
      <path d="M272 72 V24 M310 68 V12 M350 68 V16 M380 72 V30" stroke="#CBD5E1" stroke-width="${OUTLINE_MINOR}" stroke-linecap="round"/>
      <path d="M252 96 C300 80, 360 80, 404 96 L400 76 C360 64, 300 64, 252 76 Z" fill="#EDF2F7" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
    </g>`
  }

  if (id === 'head-cat-ears') {
    return `<g id="head-cat-ears">
      <path d="M250 88 C290 56, 370 60, 404 92" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}" fill="none"/>
      <path d="M252 76 L236 12 L290 44 Z" fill="#FFFDF4" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}" stroke-linejoin="round"/>
      <polygon points="252,60 244,24 280,44" fill="#FF78A8"/>
      <path d="M348 48 L392 12 L396 76 Z" fill="#FFFDF4" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}" stroke-linejoin="round"/>
      <polygon points="356,48 384,24 388,60" fill="#FF78A8"/>
    </g>`
  }

  if (id === 'head-captain-cap') {
    return `<g id="head-capt">
      <path d="M236 96 C240 44, 310 28, 372 40 C404 48, 416 72, 412 96 Z" fill="#0F172A" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}" stroke-linejoin="round"/>
      <path d="M250 88 C300 76, 370 76, 410 88" stroke="#FFD84D" stroke-width="${OUTLINE_MINOR}" fill="none"/>
      <circle cx="328" cy="60" r="9" fill="#FFD84D" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <path d="M344 90 C384 82, 444 86, 468 100 C440 114, 376 112, 340 102 Z" fill="#18181B" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}" stroke-linejoin="round"/>
    </g>`
  }

  // RARE HEADWEAR (Distinct cutout, cultural & stylized gear)
  if (id === 'head-cowboy-hat') {
    return `<g id="head-cowboy">
      <path d="M260 90 C264 40, 310 32, 370 36 C396 40, 404 64, 400 90 Z" fill="#854D0E" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}" stroke-linejoin="round"/>
      <path d="M256 86 C296 76, 360 76, 402 86" stroke="#FEF08A" stroke-width="${OUTLINE_MINOR}"/>
      <circle cx="328" cy="80" r="6" fill="#FEF08A" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <path d="M210 96 C240 106, 290 84, 350 84 C410 84, 440 106, 456 96 C430 118, 236 118, 210 96 Z" fill="#713F12" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}" stroke-linejoin="round"/>
    </g>`
  }

  if (id === 'head-bamboo-hat') {
    return `<g id="head-non-la">
      <polygon points="196,100 328,20 460,100" fill="#F4E0A5" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}" stroke-linejoin="round"/>
      <line x1="328" y1="20" x2="328" y2="100" stroke="#D4B668" stroke-width="${OUTLINE_MINOR}"/>
      <path d="M236 80 C290 64, 370 64, 424 80" stroke="#D4B668" stroke-width="${OUTLINE_MINOR}" fill="none"/>
      <!-- Silk chin ribbon -->
      <path d="M256 100 C244 150, 252 184, 284 196" stroke="#FF5B67" stroke-width="${OUTLINE_MINOR}" fill="none" stroke-linecap="round"/>
    </g>`
  }

  if (id === 'head-office-headset') {
    return `<g id="head-headset">
      <path d="M248 96 C256 28, 364 28, 396 96" stroke="#1E293B" stroke-width="16" stroke-linecap="round" fill="none"/>
      <path d="M248 96 C256 28, 364 28, 396 96" stroke="#64748B" stroke-width="${OUTLINE_MINOR}" stroke-linecap="round" fill="none"/>
      <rect x="232" y="86" width="26" height="40" rx="10" fill="#0F172A" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
      <rect x="384" y="86" width="26" height="40" rx="10" fill="#0F172A" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
      <!-- Slim mic curving to chin, clear of eyes -->
      <path d="M396 112 C424 140, 420 180, 360 196" stroke="#475569" stroke-width="${OUTLINE_MINOR}" fill="none" stroke-linecap="round"/>
      <ellipse cx="356" cy="196" rx="10" ry="7" fill="#0F172A" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <circle cx="352" cy="195" r="3" fill="#EF4444"/>
    </g>`
  }

  // EPIC HEADWEAR (Advanced materials, glowing trims, fantasy/sci-fi)
  if (id === 'head-wizard-hat') {
    return `<g id="head-wizard">
      <path d="M220 100 C290 72, 380 76, 444 104 C420 116, 300 116, 220 100 Z" fill="#2B1D52" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}" stroke-linejoin="round"/>
      <path d="M264 92 C276 56, 280 20, 230 -12 C210 -24, 190 -16, 196 4 C210 30, 270 50, 376 88 Z" fill="#493282" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}" stroke-linejoin="round"/>
      <path d="M264 92 C310 80, 350 84, 380 92" stroke="#FFD84D" stroke-width="${OUTLINE_MINOR}"/>
      <polygon points="240,8 246,24 262,24 250,34 254,48 240,40 226,48 230,34 218,24 234,24" fill="#FFD84D"/>
    </g>`
  }

  if (id === 'head-cyber-mohawk') {
    return `<g id="head-mohawk">
      <defs>
        <filter id="mohawk-glow-512" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <g fill="#FF007F" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}" stroke-linejoin="round" filter="url(#mohawk-glow-512)">
        <polygon points="240,88 232,28 268,72"/>
        <polygon points="264,72 264,8 304,56"/>
        <polygon points="296,56 312,-12 336,44"/>
        <polygon points="332,44 356,-8 372,44"/>
        <polygon points="368,44 400,12 396,68"/>
      </g>
      <path d="M250 96 C296 76, 370 76, 410 96" stroke="#00F2FE" stroke-width="${OUTLINE_MAJOR}" stroke-linecap="round"/>
      <circle cx="264" cy="90" r="5" fill="#FFFDF4"/>
      <circle cx="396" cy="90" r="5" fill="#FFFDF4"/>
    </g>`
  }

  if (id === 'head-space-dome') {
    return `<g id="head-space-dome">
      <!-- Subtle semi-transparent dome, keeping face perfectly visible -->
      <ellipse cx="336" cy="120" rx="112" ry="100" fill="#61C9FF" fill-opacity="0.16" stroke="#38BDF8" stroke-width="${OUTLINE_MINOR}"/>
      <path d="M276 60 C310 38, 376 38, 408 60" stroke="#FFFDF4" stroke-width="${OUTLINE_MINOR}" stroke-linecap="round" opacity="0.8"/>
      <!-- Dome neck ring below chin Y: 236 -->
      <path d="M216 236 C280 264, 370 264, 424 236" stroke="#94A3B8" stroke-width="18" stroke-linecap="round"/>
      <path d="M216 236 C280 264, 370 264, 424 236" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}" fill="none"/>
      <circle cx="232" cy="240" r="6" fill="#38EF7D"/>
      <circle cx="408" cy="240" r="6" fill="#38EF7D"/>
    </g>`
  }

  if (id === 'head-dragon-horns') {
    return `<g id="head-dragon-horns">
      <path d="M268 76 C230 50, 190 10, 200 -24 C230 0, 270 30, 288 52 Z" fill="#DC2626" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}" stroke-linejoin="round"/>
      <path d="M356 52 C390 30, 436 0, 460 -24 C470 10, 430 50, 392 76 Z" fill="#DC2626" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}" stroke-linejoin="round"/>
      <path d="M216 -8 L244 28" stroke="#FFD84D" stroke-width="${DETAIL}" stroke-linecap="round"/>
      <path d="M444 -8 L416 28" stroke="#FFD84D" stroke-width="${DETAIL}" stroke-linecap="round"/>
    </g>`
  }

  // LEGENDARY HEADWEAR (Prestige crowns, celestial/mythic artifacts)
  if (id === 'head-tiny-crown' || id === 'head-diamond-crown' || id === 'head-galaxy-crown' || id === 'head-fish-crown') {
    const isDiamond = id === 'head-diamond-crown'
    const isGalaxy = id === 'head-galaxy-crown'
    const crownColor = isDiamond ? '#67E8F9' : isGalaxy ? '#C084FC' : '#FFD84D'
    const crownShadow = isDiamond ? '#06B6D4' : isGalaxy ? '#9333EA' : '#D97706'
    const jewelColor = isDiamond ? '#FFFDF4' : isGalaxy ? '#38EF7D' : '#EF4444'
    return `<g id="head-crown" transform="rotate(6 330 44)">
      <path d="M284 64 L292 12 L314 36 L336 4 L358 36 L380 12 L388 64 Z" fill="${crownColor}" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}" stroke-linejoin="round"/>
      <path d="M284 64 L336 44 L388 64 Z" fill="${crownShadow}" opacity="0.35"/>
      <path d="M280 66 C312 56, 360 56, 392 66" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}" stroke-linecap="round"/>
      <circle cx="292" cy="14" r="7" fill="${jewelColor}" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <circle cx="336" cy="6" r="9" fill="${jewelColor}" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <circle cx="380" cy="14" r="7" fill="${jewelColor}" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <circle cx="336" cy="44" r="5" fill="#FFFDF4"/>
    </g>`
  }

  // REDDIT & LOL HEADWEAR
  if (id === 'head-snoo-antenna-glow') {
    return `<g id="head-snoo-antenna">
      <defs>
        <filter id="snoo-glow-512" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <path d="M330 84 C330 30, 310 -8, 345 -14" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}" stroke-linecap="round" fill="none"/>
      <path d="M330 84 C330 30, 310 -8, 345 -14" stroke="#FFFDF4" stroke-width="${OUTLINE_MINOR}" stroke-linecap="round" fill="none"/>
      <circle cx="348" cy="-16" r="14" fill="#FF4500" stroke="${COLOR}" stroke-width="${DETAIL}" filter="url(#snoo-glow-512)"/>
      <circle cx="345" cy="-19" r="4" fill="#FFFDF4"/>
    </g>`
  }

  if (id === 'head-spirit-blossom-kanzashi') {
    return `<g id="head-spirit-kanzashi">
      <path d="M365 75 C395 110, 420 150, 415 190" stroke="#38BDF8" stroke-width="${OUTLINE_MINOR}" fill="none" stroke-linecap="round"/>
      <g transform="translate(365, 70)">
        <path d="M0 0 C-10 -22, 10 -22, 0 0" fill="#FFC0D9" stroke="${COLOR}" stroke-width="${DETAIL}"/>
        <path d="M0 0 C-22 -10, -22 10, 0 0" fill="#FFC0D9" stroke="${COLOR}" stroke-width="${DETAIL}"/>
        <path d="M0 0 C10 22, -10 22, 0 0" fill="#FFC0D9" stroke="${COLOR}" stroke-width="${DETAIL}"/>
        <path d="M0 0 C22 10, 22 -10, 0 0" fill="#FFC0D9" stroke="${COLOR}" stroke-width="${DETAIL}"/>
        <path d="M0 0 C15 -18, 25 -5, 0 0" fill="#FFC0D9" stroke="${COLOR}" stroke-width="${DETAIL}"/>
        <circle cx="0" cy="0" r="7" fill="#FDE047" stroke="${COLOR}" stroke-width="${DETAIL}"/>
        <circle cx="0" cy="0" r="3" fill="#FFFDF4"/>
      </g>
      <circle cx="415" cy="195" r="8" fill="#FBBF24" stroke="${COLOR}" stroke-width="${DETAIL}"/>
    </g>`
  }

  if (id === 'head-star-guardian-wings-tiara') {
    return `<g id="head-sg-tiara">
      <path d="M260 88 C295 50, 365 50, 400 88" stroke="#FDE047" stroke-width="${OUTLINE_MAJOR}" stroke-linecap="round" fill="none"/>
      <polygon points="260,88 230,40 275,65" fill="#FFFDF4" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}" stroke-linejoin="round"/>
      <polygon points="400,88 430,40 385,65" fill="#FFFDF4" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}" stroke-linejoin="round"/>
      <polygon points="330,30 336,46 352,52 336,58 330,74 324,58 308,52 324,46" fill="#FDE047" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <circle cx="330" cy="52" r="5" fill="#FF78A8"/>
    </g>`
  }

  if (id === 'head-blood-moon-horns') {
    return `<g id="head-blood-horns">
      <path d="M265 80 C235 45, 195 -10, 215 -35 C235 -20, 260 25, 280 60 Z" fill="#991B1B" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}" stroke-linejoin="round"/>
      <path d="M355 60 C375 25, 400 -20, 420 -35 C440 -10, 400 45, 370 80 Z" fill="#991B1B" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}" stroke-linejoin="round"/>
      <path d="M230 -10 L255 15" stroke="#F59E0B" stroke-width="${OUTLINE_MINOR}" stroke-linecap="round"/>
      <path d="M405 -10 L380 15" stroke="#F59E0B" stroke-width="${OUTLINE_MINOR}" stroke-linecap="round"/>
      <path d="M255 90 C295 72, 345 72, 385 90" stroke="#991B1B" stroke-width="${OUTLINE_MINOR}" fill="none"/>
    </g>`
  }

  if (id === 'head-reddit-cone-head-prime') {
    return `<g id="head-cone-prime">
      <defs>
        <filter id="cone-halo-512" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <ellipse cx="330" cy="18" rx="55" ry="16" fill="none" stroke="#FDE047" stroke-width="${OUTLINE_MINOR}" filter="url(#cone-halo-512)"/>
      <polygon points="265,96 330,8 395,96" fill="#FF5B00" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}" stroke-linejoin="round"/>
      <polygon points="280,68 330,8 380,68" fill="#FFFDF4" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
      <polygon points="296,44 330,8 364,44" fill="#FF5B00"/>
      <path d="M238 98 H422" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}" stroke-linecap="round"/>
    </g>`
  }

  if (id === 'head-project-cyber-helm') {
    return `<g id="head-project-helm">
      <path d="M236 94 C240 38, 310 26, 376 36 C408 44, 420 68, 416 94 Z" fill="#0F172A" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}" stroke-linejoin="round"/>
      <path d="M246 90 C280 60, 360 60, 400 90" stroke="#00F2FE" stroke-width="${OUTLINE_MINOR}" fill="none"/>
      <polygon points="390,30 425,-5 415,40" fill="#00F2FE" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <rect x="230" y="80" width="20" height="30" rx="6" fill="#38BDF8" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <rect x="402" y="80" width="20" height="30" rx="6" fill="#38BDF8" stroke="${COLOR}" stroke-width="${DETAIL}"/>
    </g>`
  }

  if (id === 'head-coven-antler-crown') {
    return `<g id="head-coven-antlers">
      <path d="M270 75 C240 30, 200 10, 180 -25 M225 10 C210 -15, 190 -10, 185 -5 M270 75 C285 30, 275 -10, 260 -35" stroke="#18181B" stroke-width="12" stroke-linecap="round" fill="none"/>
      <path d="M270 75 C240 30, 200 10, 180 -25 M225 10 C210 -15, 190 -10, 185 -5 M270 75 C285 30, 275 -10, 260 -35" stroke="#4C1D95" stroke-width="${DETAIL}" stroke-linecap="round" fill="none"/>
      <path d="M360 75 C390 30, 430 10, 450 -25 M405 10 C420 -15, 440 -10, 445 -5 M360 75 C345 30, 355 -10, 370 -35" stroke="#18181B" stroke-width="12" stroke-linecap="round" fill="none"/>
      <path d="M360 75 C390 30, 430 10, 450 -25 M405 10 C420 -15, 440 -10, 445 -5 M360 75 C345 30, 355 -10, 370 -35" stroke="#4C1D95" stroke-width="${DETAIL}" stroke-linecap="round" fill="none"/>
      <circle cx="315" cy="55" r="9" fill="#7C3AED" stroke="${COLOR}" stroke-width="${DETAIL}"/>
    </g>`
  }

  if (id === 'head-winterblessed-crown') {
    return `<g id="head-winter-crown">
      <path d="M265 80 L210 10 L180 25 M210 10 L220 -25 M265 80 L250 20 L270 -10" stroke="#38BDF8" stroke-width="10" stroke-linecap="round" fill="none"/>
      <path d="M365 80 L420 10 L450 25 M420 10 L410 -25 M365 80 L380 20 L360 -10" stroke="#38BDF8" stroke-width="10" stroke-linecap="round" fill="none"/>
      <polygon points="315,20 326,38 344,44 326,50 315,68 304,50 286,44 304,38" fill="#A7F3D0" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <circle cx="315" cy="44" r="4" fill="#FFFDF4"/>
    </g>`
  }

  if (id === 'head-high-noon-hellfire-hat') {
    return `<g id="head-high-noon-hat">
      <path d="M256 90 C260 38, 310 28, 370 34 C396 38, 406 62, 402 90 Z" fill="#18181B" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}" stroke-linejoin="round"/>
      <path d="M200 96 C240 106, 290 82, 350 82 C410 82, 444 106, 466 96 C434 120, 230 120, 200 96 Z" fill="#271810" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}" stroke-linejoin="round"/>
      <path d="M250 86 Q315 72 380 84" stroke="#EA580C" stroke-width="${OUTLINE_MINOR}" fill="none"/>
      <polygon points="315,62 322,76 332,76 324,84 327,96 315,88 303,96 306,84 298,76 308,76" fill="#FBBF24"/>
    </g>`
  }

  if (id === 'head-dark-star-singularity') {
    return `<g id="head-dark-singularity">
      <circle cx="330" cy="36" r="26" fill="#0F172A" stroke="#7C3AED" stroke-width="${OUTLINE_MAJOR}"/>
      <circle cx="330" cy="36" r="14" fill="#020617"/>
      <ellipse cx="330" cy="36" rx="42" ry="14" stroke="#C084FC" stroke-width="${DETAIL}" fill="none" transform="rotate(-15 330 36)"/>
      <circle cx="368" cy="28" r="4" fill="#38BDF8"/>
      <circle cx="292" cy="44" r="3" fill="#F43F5E"/>
    </g>`
  }

  // Fallback headwear
  return `<g id="head-custom-${seed}">
    <path d="M244 96 C248 44, 320 36, 380 40 C408 44, 416 68, 410 96 Z" fill="${primary}" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}" stroke-linejoin="round"/>
    <path d="M236 96 C280 84, 370 84, 416 96" stroke="${secondary}" stroke-width="${OUTLINE_MINOR}" fill="none"/>
    <circle cx="328" cy="40" r="7" fill="#FFFDF4" stroke="${COLOR}" stroke-width="${DETAIL}"/>
  </g>`
}

// -------------------------------------------------------------
// 2. OUTFITS (Torso Hugging + Wing Sleeve + Collar Alignment)
// -------------------------------------------------------------
function generateOutfit(item: CosmeticDefinition, primary: string, secondary: string, seed: number) {
  const { id, rarity } = item

  // COMMON OUTFITS (Clean tees, minimal everyday shapes)
  if (id === 'outfit-tee-white' || (rarity === 'common' && !id.includes('tie'))) {
    const teeColor = id === 'outfit-tee-white' ? '#FFFDF4' : primary
    return `<g id="outfit-tee">
      <path d="M84 326 c0 -54 44 -92 114 -104 l24 30 q38 34 86 -2 l34 6 c38 16 60 38 68 66 c14 66 -52 100 -166 96 c-106 -2 -160 -36 -160 -92 Z" fill="${teeColor}" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}" stroke-linejoin="round"/>
      <path d="M222 252 C248 276, 284 276, 310 252" stroke="#CBD5E1" stroke-width="${OUTLINE_MAJOR}" stroke-linecap="round" fill="none"/>
      <path d="M222 252 C248 276, 284 276, 310 252" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}" stroke-linecap="round" fill="none"/>
      <path d="M136 304 C164 284, 210 290, 240 324 C216 356, 160 364, 136 304 Z" fill="${teeColor}" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}" stroke-linejoin="round"/>
      ${id === 'outfit-tee-white' ? `<rect x="270" y="304" width="44" height="28" rx="6" fill="#EF4444" stroke="${COLOR}" stroke-width="${DETAIL}"/><circle cx="292" cy="318" r="5" fill="#FFFDF4"/>` : ''}
    </g>`
  }

  // UNCOMMON OUTFITS (Office shirt, raincoat, clean aprons)
  if (id === 'outfit-office-shirt' || id === 'outfit-office-tie') {
    return `<g id="outfit-office">
      <path d="M84 326 c0 -54 44 -92 114 -104 l24 30 q38 34 86 -2 l34 6 c38 16 60 38 68 66 c14 66 -52 100 -166 96 c-106 -2 -160 -36 -160 -92 Z" fill="#E0F2FE" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}" stroke-linejoin="round"/>
      <path d="M136 304 C164 284, 210 290, 240 324 C216 356, 160 364, 136 304 Z" fill="#BAE6FD" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}" stroke-linejoin="round"/>
      <polygon points="220,250 252,284 276,252 300,284 328,250" fill="#FFFDF4" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}" stroke-linejoin="round"/>
      <polygon points="262,270 290,270 282,292 270,292" fill="#EF4444" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <polygon points="270,292 282,292 296,376 276,396 256,376" fill="#EF4444" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}" stroke-linejoin="round"/>
      <line x1="266" y1="324" x2="286" y2="324" stroke="#FFD84D" stroke-width="${DETAIL}" stroke-linecap="round"/>
      <rect x="296" y="300" width="30" height="34" rx="4" fill="#BAE6FD" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <line x1="306" y1="290" x2="306" y2="304" stroke="#1E293B" stroke-width="${DETAIL}" stroke-linecap="round"/>
    </g>`
  }

  // RARE OUTFITS (Dev hoodie, racing suit, lucky ao dai)
  if (id === 'outfit-dev-hoodie') {
    return `<g id="outfit-hoodie">
      <path d="M84 326 c0 -54 44 -92 114 -104 l24 30 q38 34 86 -2 l34 6 c38 16 60 38 68 66 c14 66 -52 100 -166 96 c-106 -2 -160 -36 -160 -92 Z" fill="#1E293B" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}" stroke-linejoin="round"/>
      <path d="M136 304 C164 284, 210 290, 240 324 C216 356, 160 364, 136 304 Z" fill="#0F172A" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}" stroke-linejoin="round"/>
      <path d="M212 244 C240 284, 300 284, 336 248" stroke="#334155" stroke-width="20" stroke-linecap="round"/>
      <path d="M212 244 C240 284, 300 284, 336 248" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}" stroke-linecap="round" fill="none"/>
      <line x1="252" y1="268" x2="248" y2="310" stroke="#FFFDF4" stroke-width="${DETAIL}" stroke-linecap="round"/>
      <line x1="292" y1="268" x2="296" y2="306" stroke="#FFFDF4" stroke-width="${DETAIL}" stroke-linecap="round"/>
      <text x="290" y="330" fill="#38EF7D" font-family="monospace" font-weight="900" font-size="24" text-anchor="middle">&lt;/&gt;</text>
      <path d="M250 350 H350 L336 396 H264 Z" fill="#0F172A" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}" stroke-linejoin="round"/>
    </g>`
  }

  if (id === 'outfit-racing-suit') {
    return `<g id="outfit-racing">
      <path d="M84 326 c0 -54 44 -92 114 -104 l24 30 q38 34 86 -2 l34 6 c38 16 60 38 68 66 c14 66 -52 100 -166 96 c-106 -2 -160 -36 -160 -92 Z" fill="#DC2626" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}" stroke-linejoin="round"/>
      <path d="M136 304 C164 284, 210 290, 240 324 C216 356, 160 364, 136 304 Z" fill="#991B1B" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}" stroke-linejoin="round"/>
      <path d="M256 252 L256 400" stroke="#FFFDF4" stroke-width="20"/>
      <rect x="246" y="264" width="10" height="16" fill="#18181B"/>
      <rect x="256" y="280" width="10" height="16" fill="#18181B"/>
      <rect x="246" y="296" width="10" height="16" fill="#18181B"/>
      <rect x="256" y="312" width="10" height="16" fill="#18181B"/>
      <rect x="246" y="328" width="10" height="16" fill="#18181B"/>
      <rect x="256" y="344" width="10" height="16" fill="#18181B"/>
      <circle cx="316" cy="316" r="22" fill="#FFFDF4" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <text x="316" y="325" fill="#DC2626" font-family="sans-serif" font-weight="900" font-size="20" text-anchor="middle">07</text>
    </g>`
  }

  if (id === 'outfit-lucky-ao-dai') {
    return `<g id="outfit-ao-dai">
      <path d="M84 326 c0 -54 44 -92 114 -104 l24 30 q38 34 86 -2 l34 6 c38 16 60 38 68 66 c14 66 -52 100 -166 96 c-106 -2 -160 -36 -160 -92 Z" fill="#047857" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}" stroke-linejoin="round"/>
      <path d="M136 304 C164 284, 210 290, 240 324 C216 356, 160 364, 136 304 Z" fill="#065F46" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}" stroke-linejoin="round"/>
      <path d="M228 248 C264 270, 300 252, 324 244" stroke="#F59E0B" stroke-width="${OUTLINE_MINOR}" stroke-linecap="round"/>
      <circle cx="296" cy="252" r="5" fill="#FDE68A"/>
      <circle cx="312" cy="270" r="5" fill="#FDE68A"/>
      <circle cx="330" cy="290" r="5" fill="#FDE68A"/>
      <path d="M280 340 C280 310, 306 300, 306 300 C306 300, 332 310, 332 340 C318 350, 294 350, 280 340 Z" fill="#FDE68A" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <circle cx="306" cy="328" r="5" fill="#EF4444"/>
    </g>`
  }

  // EPIC OUTFITS (Space suit, wizard robe, cyber samurai)
  if (id === 'outfit-space-suit') {
    return `<g id="outfit-space">
      <path d="M84 326 c0 -54 44 -92 114 -104 l24 30 q38 34 86 -2 l34 6 c38 16 60 38 68 66 c14 66 -52 100 -166 96 c-106 -2 -160 -36 -160 -92 Z" fill="#F8FAFC" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}" stroke-linejoin="round"/>
      <path d="M136 304 C164 284, 210 290, 240 324 C216 356, 160 364, 136 304 Z" fill="#E2E8F0" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}" stroke-linejoin="round"/>
      <rect x="250" y="290" width="88" height="68" rx="10" fill="#1E293B" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
      <circle cx="270" cy="310" r="5" fill="#38EF7D"/>
      <circle cx="292" cy="310" r="5" fill="#38EF7D"/>
      <circle cx="314" cy="310" r="5" fill="#EF4444"/>
      <line x1="264" y1="336" x2="320" y2="336" stroke="#38BDF8" stroke-width="${DETAIL}"/>
      <path d="M250 312 C210 320, 200 356, 230 376" stroke="#EF4444" stroke-width="${OUTLINE_MINOR}" fill="none" stroke-linecap="round"/>
      <path d="M338 312 C370 320, 380 356, 350 376" stroke="#3B82F6" stroke-width="${OUTLINE_MINOR}" fill="none" stroke-linecap="round"/>
    </g>`
  }

  if (id === 'outfit-cyber-samurai') {
    return `<g id="outfit-cyber-samurai">
      <path d="M84 326 c0 -54 44 -92 114 -104 l24 30 q38 34 86 -2 l34 6 c38 16 60 38 68 66 c14 66 -52 100 -166 96 c-106 -2 -160 -36 -160 -92 Z" fill="#0B0F19" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}" stroke-linejoin="round"/>
      <path d="M136 304 C164 284, 210 290, 240 324 C216 356, 160 364, 136 304 Z" fill="#1E1B4B" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}" stroke-linejoin="round"/>
      <!-- Cyan cyber trims -->
      <path d="M220 252 Q276 280 330 252" stroke="#00F2FE" stroke-width="${OUTLINE_MINOR}" stroke-linecap="round" fill="none"/>
      <line x1="288" y1="272" x2="288" y2="396" stroke="#FF007F" stroke-width="${DETAIL}"/>
      <polygon points="274,310 288,296 302,310 288,324" fill="#00F2FE"/>
    </g>`
  }

  // REDDIT & LOL OUTFITS
  if (id === 'outfit-spirit-blossom-haori') {
    return `<g id="outfit-spirit-haori">
      <path d="M84 326 c0 -54 44 -92 114 -104 l24 30 q38 34 86 -2 l34 6 c38 16 60 38 68 66 c14 66 -52 100 -166 96 c-106 -2 -160 -36 -160 -92 Z" fill="#FCE7F3" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}" stroke-linejoin="round"/>
      <path d="M136 304 C164 284, 210 290, 240 324 C216 356, 160 364, 136 304 Z" fill="#E9D5FF" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}" stroke-linejoin="round"/>
      <rect x="230" y="320" width="100" height="34" rx="6" fill="#06B6D4" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
      <circle cx="280" cy="337" r="8" fill="#FDE047" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <path d="M240 252 Q280 290 320 252" stroke="#F43F5E" stroke-width="${OUTLINE_MINOR}" fill="none"/>
      <circle cx="200" cy="340" r="5" fill="#FF78A8"/>
      <circle cx="340" cy="350" r="6" fill="#FF78A8"/>
    </g>`
  }

  if (id === 'outfit-star-guardian-sailor-dress') {
    return `<g id="outfit-sg-dress">
      <path d="M84 326 c0 -54 44 -92 114 -104 l24 30 q38 34 86 -2 l34 6 c38 16 60 38 68 66 c14 66 -52 100 -166 96 c-106 -2 -160 -36 -160 -92 Z" fill="#FFFDF4" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}" stroke-linejoin="round"/>
      <path d="M136 304 C164 284, 210 290, 240 324 C216 356, 160 364, 136 304 Z" fill="#BAE6FD" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}" stroke-linejoin="round"/>
      <path d="M216 248 L250 290 L280 252 L310 290 L344 248" fill="#38BDF8" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
      <polygon points="280,285 288,300 304,300 292,310 296,325 280,315 264,325 268,310 256,300 272,300" fill="#FDE047" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <path d="M220 376 C250 394, 310 394, 340 376" stroke="#FF78A8" stroke-width="${OUTLINE_MINOR}" fill="none"/>
    </g>`
  }

  if (id === 'outfit-kda-holographic-jacket') {
    return `<g id="outfit-kda-jacket">
      <path d="M84 326 c0 -54 44 -92 114 -104 l24 30 q38 34 86 -2 l34 6 c38 16 60 38 68 66 c14 66 -52 100 -166 96 c-106 -2 -160 -36 -160 -92 Z" fill="#0B0F19" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}" stroke-linejoin="round"/>
      <path d="M136 304 C164 284, 210 290, 240 324 C216 356, 160 364, 136 304 Z" fill="#C084FC" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}" stroke-linejoin="round"/>
      <path d="M220 248 L275 320 L275 398 L220 380 Z" fill="#00F2FE" opacity="0.8"/>
      <path d="M330 248 L275 320 L275 398 L330 380 Z" fill="#FF007F" opacity="0.8"/>
      <line x1="275" y1="250" x2="275" y2="400" stroke="#FFD84D" stroke-width="${OUTLINE_MINOR}"/>
      <circle cx="310" cy="300" r="6" fill="#FFD84D"/>
    </g>`
  }

  if (id === 'outfit-project-cyber-exosuit') {
    return `<g id="outfit-project-exosuit">
      <path d="M84 326 c0 -54 44 -92 114 -104 l24 30 q38 34 86 -2 l34 6 c38 16 60 38 68 66 c14 66 -52 100 -166 96 c-106 -2 -160 -36 -160 -92 Z" fill="#18181B" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}" stroke-linejoin="round"/>
      <path d="M136 304 C164 284, 210 290, 240 324 C216 356, 160 364, 136 304 Z" fill="#27272A" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}" stroke-linejoin="round"/>
      <polygon points="250,280 300,280 315,330 280,360 240,330" fill="#0F172A" stroke="#00F2FE" stroke-width="${OUTLINE_MINOR}"/>
      <circle cx="278" cy="318" r="12" fill="#00F2FE" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <circle cx="278" cy="318" r="6" fill="#FFFDF4"/>
      <line x1="230" y1="360" x2="330" y2="360" stroke="#00F2FE" stroke-width="${DETAIL}"/>
    </g>`
  }

  if (id === 'outfit-blood-moon-assassin-garb') {
    return `<g id="outfit-blood-garb">
      <path d="M84 326 c0 -54 44 -92 114 -104 l24 30 q38 34 86 -2 l34 6 c38 16 60 38 68 66 c14 66 -52 100 -166 96 c-106 -2 -160 -36 -160 -92 Z" fill="#7F1D1D" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}" stroke-linejoin="round"/>
      <path d="M136 304 C164 284, 210 290, 240 324 C216 356, 160 364, 136 304 Z" fill="#18181B" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}" stroke-linejoin="round"/>
      <path d="M220 250 L280 330 L340 250" stroke="#F59E0B" stroke-width="${OUTLINE_MINOR}" fill="none"/>
      <rect x="236" y="330" width="88" height="30" rx="4" fill="#991B1B" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
      <circle cx="280" cy="345" r="7" fill="#F59E0B"/>
      <path d="M265 360 L260 400 L275 400 L280 360" fill="#991B1B" stroke="${COLOR}" stroke-width="${DETAIL}"/>
    </g>`
  }

  if (id === 'outfit-coven-witch-gown') {
    return `<g id="outfit-coven-gown">
      <path d="M84 326 c0 -54 44 -92 114 -104 l24 30 q38 34 86 -2 l34 6 c38 16 60 38 68 66 c14 66 -52 100 -166 96 c-106 -2 -160 -36 -160 -92 Z" fill="#2E1065" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}" stroke-linejoin="round"/>
      <path d="M136 304 C164 284, 210 290, 240 324 C216 356, 160 364, 136 304 Z" fill="#18181B" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}" stroke-linejoin="round"/>
      <path d="M226 248 C260 280, 300 280, 334 248" stroke="#A855F7" stroke-width="${OUTLINE_MINOR}" fill="none"/>
      <line x1="260" y1="290" x2="300" y2="310" stroke="#C084FC" stroke-width="${DETAIL}"/>
      <line x1="300" y1="290" x2="260" y2="310" stroke="#C084FC" stroke-width="${DETAIL}"/>
      <line x1="260" y1="310" x2="300" y2="330" stroke="#C084FC" stroke-width="${DETAIL}"/>
      <line x1="300" y1="310" x2="260" y2="330" stroke="#C084FC" stroke-width="${DETAIL}"/>
      <polygon points="280,345 292,360 280,375 268,360" fill="#A855F7" stroke="${COLOR}" stroke-width="${DETAIL}"/>
    </g>`
  }

  if (id === 'outfit-high-noon-gunslinger-poncho') {
    return `<g id="outfit-high-noon-poncho">
      <path d="M84 326 c0 -54 44 -92 114 -104 l24 30 q38 34 86 -2 l34 6 c38 16 60 38 68 66 c14 66 -52 100 -166 96 c-106 -2 -160 -36 -160 -92 Z" fill="#78350F" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}" stroke-linejoin="round"/>
      <path d="M136 304 C164 284, 210 290, 240 324 C216 356, 160 364, 136 304 Z" fill="#451A03" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}" stroke-linejoin="round"/>
      <line x1="220" y1="255" x2="330" y2="385" stroke="#18181B" stroke-width="14" stroke-linecap="round"/>
      <rect x="230" y="265" width="8" height="12" rx="2" fill="#FDE047" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <rect x="250" y="289" width="8" height="12" rx="2" fill="#FDE047" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <rect x="270" y="313" width="8" height="12" rx="2" fill="#FDE047" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <rect x="290" y="337" width="8" height="12" rx="2" fill="#FDE047" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <rect x="310" y="361" width="8" height="12" rx="2" fill="#FDE047" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <polygon points="260,330 264,340 274,340 266,346 269,356 260,350 251,356 254,346 246,340 256,340" fill="#FDE047" stroke="${COLOR}" stroke-width="${DETAIL}"/>
    </g>`
  }

  if (id === 'outfit-reddit-drip-squad-puffer') {
    return `<g id="outfit-drip-puffer">
      <path d="M84 326 c0 -54 44 -92 114 -104 l24 30 q38 34 86 -2 l34 6 c38 16 60 38 68 66 c14 66 -52 100 -166 96 c-106 -2 -160 -36 -160 -92 Z" fill="#06B6D4" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}" stroke-linejoin="round"/>
      <path d="M136 304 C164 284, 210 290, 240 324 C216 356, 160 364, 136 304 Z" fill="#8B5CF6" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}" stroke-linejoin="round"/>
      <path d="M190 280 C240 300, 310 300, 360 280" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}" fill="none"/>
      <path d="M180 320 C240 340, 310 340, 370 320" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}" fill="none"/>
      <path d="M190 360 C240 380, 310 380, 360 360" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}" fill="none"/>
      <rect x="290" y="295" width="34" height="26" rx="6" fill="#FDE047" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <circle cx="307" cy="308" r="5" fill="#EF4444"/>
    </g>`
  }

  if (id === 'outfit-porcelain-hanfu-robe') {
    return `<g id="outfit-porcelain-robe">
      <path d="M84 326 c0 -54 44 -92 114 -104 l24 30 q38 34 86 -2 l34 6 c38 16 60 38 68 66 c14 66 -52 100 -166 96 c-106 -2 -160 -36 -160 -92 Z" fill="#FFFDF4" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}" stroke-linejoin="round"/>
      <path d="M136 304 C164 284, 210 290, 240 324 C216 356, 160 364, 136 304 Z" fill="#E2E8F0" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}" stroke-linejoin="round"/>
      <path d="M220 250 L275 325 L330 250" stroke="#2563EB" stroke-width="${OUTLINE_MINOR}" fill="none"/>
      <rect x="235" y="325" width="90" height="28" rx="4" fill="#2563EB" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
      <circle cx="280" cy="339" r="6" fill="#FDE047"/>
      <path d="M260 360 C275 350, 285 350, 300 360" stroke="#2563EB" stroke-width="${OUTLINE_MINOR}" fill="none"/>
    </g>`
  }

  if (id === 'outfit-winterblessed-regal-coat') {
    return `<g id="outfit-winter-coat">
      <path d="M84 326 c0 -54 44 -92 114 -104 l24 30 q38 34 86 -2 l34 6 c38 16 60 38 68 66 c14 66 -52 100 -166 96 c-106 -2 -160 -36 -160 -92 Z" fill="#0F172A" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}" stroke-linejoin="round"/>
      <path d="M136 304 C164 284, 210 290, 240 324 C216 356, 160 364, 136 304 Z" fill="#0369A1" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}" stroke-linejoin="round"/>
      <path d="M210 248 C250 285, 310 285, 350 248" stroke="#FFFDF4" stroke-width="20" stroke-linecap="round"/>
      <path d="M210 248 C250 285, 310 285, 350 248" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}" stroke-linecap="round" fill="none"/>
      <line x1="280" y1="275" x2="280" y2="395" stroke="#38BDF8" stroke-width="${OUTLINE_MINOR}"/>
      <circle cx="280" cy="305" r="5" fill="#FDE047"/>
      <circle cx="280" cy="345" r="5" fill="#FDE047"/>
    </g>`
  }

  // LEGENDARY OUTFITS (Paladin knight armor, coronation mantle)
  if (id === 'outfit-quack-knight' || id === 'outfit-diamond-armor' || id === 'outfit-royal-mantle' || rarity === 'legendary') {
    return `<g id="outfit-armor">
      <path d="M84 326 c0 -54 44 -92 114 -104 l24 30 q38 34 86 -2 l34 6 c38 16 60 38 68 66 c14 66 -52 100 -166 96 c-106 -2 -160 -36 -160 -92 Z" fill="#94A3B8" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}" stroke-linejoin="round"/>
      <path d="M136 304 C164 284, 210 290, 240 324 C216 356, 160 364, 136 304 Z" fill="#64748B" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}" stroke-linejoin="round"/>
      <path d="M220 252 Q276 280 324 250" stroke="#FFD84D" stroke-width="${OUTLINE_MINOR}" fill="none"/>
      <polygon points="288,292 312,308 300,344 276,344 264,308" fill="#FFD84D" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <circle cx="256" cy="310" r="4" fill="#FFFDF4"/>
      <circle cx="324" cy="310" r="4" fill="#FFFDF4"/>
    </g>`
  }

  // Fallback outfit
  return `<g id="outfit-custom-${seed}">
    <path d="M84 326 c0 -54 44 -92 114 -104 l24 30 q38 34 86 -2 l34 6 c38 16 60 38 68 66 c14 66 -52 100 -166 96 c-106 -2 -160 -36 -160 -92 Z" fill="${primary}" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}" stroke-linejoin="round"/>
    <path d="M136 304 C164 284, 210 290, 240 324 C216 356, 160 364, 136 304 Z" fill="${secondary}" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}" stroke-linejoin="round"/>
    <path d="M220 252 Q276 280 330 252" stroke="${secondary}" stroke-width="${OUTLINE_MINOR}" stroke-linecap="round" fill="none"/>
    <circle cx="304" cy="304" r="5" fill="#FFFDF4" stroke="${COLOR}" stroke-width="${DETAIL}"/>
  </g>`
}

// -------------------------------------------------------------
// 3. BODY SKINS (Face Safe Zone Preserved: opacity <= 0.45 on head)
// -------------------------------------------------------------
function generateBodySkin(item: CosmeticDefinition, primary: string, secondary: string) {
  const { id, rarity } = item

  if (id === 'bodySkin-tiger-quack') {
    return `<g id="skin-tiger" fill="${COLOR}" opacity="0.8">
      <!-- 3 Forehead stripes well above eyes Y: 52..84 -->
      <path d="M272 68 Q292 76 312 60 L308 52 Q288 64 268 60 Z"/>
      <path d="M284 90 Q304 96 324 84 L320 76 Q300 88 280 84 Z"/>
      <!-- Flank and tail stripes -->
      <path d="M130 284 Q180 276 210 296 L204 308 Q170 288 124 296 Z"/>
      <path d="M150 330 Q210 316 256 340 L250 352 Q200 330 144 344 Z"/>
      <path d="M180 376 Q240 364 296 380 L292 390 Q230 376 176 388 Z"/>
    </g>`
  }

  if (id === 'bodySkin-dragon-scale') {
    return `<g id="skin-dragon">
      <g stroke="#C95E24" stroke-width="${DETAIL}" fill="none">
        <path d="M276 76 C288 88, 304 88, 316 76 C328 88, 344 88, 356 76"/>
        <path d="M150 290 C160 304, 180 304, 190 290 C200 304, 220 304, 230 290 C240 304, 260 304, 270 290"/>
        <path d="M170 320 C180 334, 200 334, 210 320 C220 334, 240 334, 250 320 C260 334, 280 334, 290 320"/>
      </g>
      <circle cx="170" cy="296" r="4" fill="#FFD84D"/>
      <circle cx="210" cy="296" r="4" fill="#FFD84D"/>
      <circle cx="250" cy="296" r="4" fill="#FFD84D"/>
    </g>`
  }

  if (id === 'bodySkin-neon-scales' || id === 'bodySkin-circuit-feathers') {
    return `<g id="skin-cyber">
      <g stroke="#00F2FE" stroke-width="${DETAIL}" stroke-linecap="round" stroke-linejoin="round" fill="none">
        <path d="M270 80 H310 L330 60 H360"/>
        <path d="M150 290 H210 L240 320 H310 L330 300"/>
        <path d="M170 330 H230 L250 350 H320"/>
      </g>
      <circle cx="360" cy="60" r="4" fill="#FF007F"/>
      <circle cx="150" cy="290" r="4" fill="#00F2FE"/>
      <circle cx="330" cy="300" r="4" fill="#FF007F"/>
    </g>`
  }

  if (id === 'bodySkin-galaxy-dust' || id === 'bodySkin-star-freckles') {
    return `<g id="skin-galaxy">
      <g fill="#FFFDF4" opacity="0.85">
        <path d="M296 90 Q302 90 302 84 Q302 90 308 90 Q302 90 302 96 Q302 90 296 90 Z"/>
        <path d="M240 304 Q252 304 252 292 Q252 304 264 304 Q252 304 252 316 Q252 304 240 304 Z"/>
      </g>
      <circle cx="276" cy="80" r="4" fill="#FF78A8"/>
      <circle cx="210" cy="296" r="5" fill="#B99AFF"/>
      <circle cx="276" cy="284" r="5" fill="#61C9FF"/>
    </g>`
  }

  if (id === 'bodySkin-gold-veins') {
    return `<g id="skin-kintsugi" stroke="#FFD84D" stroke-width="${DETAIL}" stroke-linecap="round" stroke-linejoin="round" fill="none">
      <path d="M276 70 L292 90 L280 106 L300 120"/>
      <circle cx="292" cy="90" r="3" fill="#FFFDF4" stroke="none"/>
      <path d="M140 296 L190 310 L220 290 L270 320 L310 304"/>
    </g>`
  }

  if (id === 'bodySkin-lotus-speckles') {
    return `<g id="skin-lotus" fill="#FF78A8" opacity="0.75">
      <path d="M296 86 C288 70, 312 70, 316 86 C312 102, 288 102, 296 86 Z"/>
      <path d="M170 290 C160 270, 190 270, 196 290 C190 310, 160 310, 170 290 Z"/>
      <path d="M250 280 C240 260, 270 260, 276 280 C270 300, 240 300, 250 280 Z"/>
    </g>`
  }

  // REDDIT & LOL BODY SKINS
  if (id === 'bodySkin-spirit-inks') {
    return `<g id="skin-spirit-inks" stroke="#C084FC" stroke-width="${DETAIL}" fill="none" opacity="0.8">
      <path d="M280 75 C310 65, 330 85, 350 70" stroke-linecap="round"/>
      <path d="M140 290 C175 270, 220 300, 260 280 C290 265, 320 295, 340 285" stroke-width="${OUTLINE_MINOR}" stroke-linecap="round"/>
      <circle cx="160" cy="275" r="4" fill="#FDA4AF" stroke="none"/>
      <circle cx="235" cy="305" r="5" fill="#FDA4AF" stroke="none"/>
      <circle cx="310" cy="275" r="4" fill="#FDA4AF" stroke="none"/>
    </g>`
  }

  if (id === 'bodySkin-hextech-runes') {
    return `<g id="skin-hextech-runes" stroke="#38BDF8" stroke-width="${DETAIL}" stroke-linecap="round" stroke-linejoin="round" fill="none">
      <polygon points="295,65 315,55 335,65 335,85 315,95 295,85" stroke="#FDE047"/>
      <path d="M150 290 L180 290 L200 320 L250 320 L270 290 L310 290"/>
      <polygon points="210,320 225,310 240,320 240,335 225,345 210,335" fill="#0284C7" stroke="#38BDF8"/>
      <circle cx="180" cy="290" r="3" fill="#FDE047" stroke="none"/>
      <circle cx="270" cy="290" r="3" fill="#FDE047" stroke="none"/>
    </g>`
  }

  if (id === 'bodySkin-kda-iridescent') {
    return `<g id="skin-kda-iridescent">
      <polygon points="280,70 300,55 320,70 300,85" fill="#FF007F" opacity="0.6"/>
      <polygon points="310,70 330,55 350,70 330,85" fill="#00F2FE" opacity="0.6"/>
      <polygon points="150,290 180,270 210,290 180,310" fill="#00F2FE" opacity="0.6"/>
      <polygon points="200,310 230,290 260,310 230,330" fill="#FF007F" opacity="0.6"/>
      <polygon points="250,290 280,270 310,290 280,310" fill="#C084FC" opacity="0.6"/>
      <polygon points="290,320 315,305 340,320 315,335" fill="#FDE047" opacity="0.6"/>
    </g>`
  }

  if (id === 'bodySkin-blood-moon-markings') {
    return `<g id="skin-blood-moon" fill="#991B1B" opacity="0.85">
      <circle cx="315" cy="75" r="7"/>
      <path d="M305 85 L325 85 L315 105 Z"/>
      <path d="M145 295 Q180 270 215 300 Q180 310 145 295 Z"/>
      <path d="M225 315 Q260 285 295 320 Q260 330 225 315 Z"/>
      <circle cx="180" cy="335" r="6"/>
      <circle cx="260" cy="345" r="6"/>
    </g>`
  }

  if (id === 'bodySkin-star-constellations') {
    return `<g id="skin-star-constellations" stroke="#FDE047" stroke-width="${DETAIL}" fill="none">
      <line x1="285" y1="75" x2="315" y2="60"/>
      <line x1="315" y1="60" x2="345" y2="80"/>
      <line x1="160" y1="290" x2="200" y2="275"/>
      <line x1="200" y1="275" x2="245" y2="310"/>
      <line x1="245" y1="310" x2="290" y2="285"/>
      <line x1="290" y1="285" x2="325" y2="315"/>
      <polygon points="285,75 287,79 291,79 288,81 289,85 285,83 281,85 282,81 279,79 283,79" fill="#FFFDF4" stroke="none"/>
      <polygon points="315,60 317,64 321,64 318,66 319,70 315,68 311,70 312,66 309,64 313,64" fill="#FFFDF4" stroke="none"/>
      <polygon points="200,275 203,280 208,280 204,283 205,288 200,285 195,288 196,283 192,280 197,280" fill="#FFFDF4" stroke="none"/>
      <polygon points="290,285 293,290 298,290 294,293 295,298 290,295 285,298 286,293 282,290 287,290" fill="#FFFDF4" stroke="none"/>
    </g>`
  }

  if (id === 'bodySkin-snoo-wireframe') {
    return `<g id="skin-snoo-wireframe" stroke="#00F2FE" stroke-width="${DETAIL}" stroke-linecap="round" fill="none" opacity="0.75">
      <ellipse cx="320" cy="80" rx="35" ry="20" stroke-dasharray="6 6"/>
      <line x1="285" y1="80" x2="355" y2="80"/>
      <ellipse cx="230" cy="320" rx="90" ry="55" stroke-dasharray="8 8"/>
      <line x1="140" y1="320" x2="320" y2="320"/>
      <line x1="230" y1="265" x2="230" y2="375"/>
    </g>`
  }

  if (id === 'bodySkin-coven-bramble') {
    return `<g id="skin-coven-bramble" stroke="#18181B" stroke-width="${OUTLINE_MINOR}" stroke-linecap="round" fill="none">
      <path d="M280 70 Q310 90 340 70 M305 80 L315 65"/>
      <path d="M140 290 Q180 320 220 290 Q260 270 300 310 M175 305 L165 320 M265 280 L275 265 M280 300 L295 315" stroke="#4C1D95"/>
      <circle cx="220" cy="290" r="4" fill="#A855F7" stroke="none"/>
      <circle cx="300" cy="310" r="4" fill="#A855F7" stroke="none"/>
    </g>`
  }

  if (id === 'bodySkin-diamond-facets') {
    return `<g id="skin-diamond-facets" stroke="#67E8F9" stroke-width="${DETAIL}" fill="none">
      <polygon points="300,60 320,60 330,75 310,85 290,75" fill="#A5F3FC" fill-opacity="0.5"/>
      <polygon points="160,285 190,285 205,305 175,320 145,305" fill="#A5F3FC" fill-opacity="0.5"/>
      <polygon points="220,295 250,295 265,315 235,330 205,315" fill="#A5F3FC" fill-opacity="0.5"/>
      <polygon points="275,280 305,280 320,300 290,315 260,300" fill="#A5F3FC" fill-opacity="0.5"/>
      <circle cx="190" cy="285" r="3" fill="#FFFDF4" stroke="none"/>
      <circle cx="250" cy="295" r="3" fill="#FFFDF4" stroke="none"/>
    </g>`
  }

  if (id === 'bodySkin-porcelain-glaze') {
    return `<g id="skin-porcelain-glaze" stroke="#2563EB" stroke-width="${DETAIL}" fill="none" opacity="0.85">
      <path d="M285 75 C295 65, 310 65, 320 75 C330 65, 345 65, 355 75" stroke-linecap="round"/>
      <path d="M145 290 C165 270, 195 270, 215 290 C235 270, 265 270, 285 290 C305 270, 335 270, 350 290" stroke-width="${OUTLINE_MINOR}" stroke-linecap="round"/>
      <circle cx="180" cy="285" r="5" fill="#1D4ED8" stroke="none"/>
      <circle cx="250" cy="285" r="5" fill="#1D4ED8" stroke="none"/>
      <circle cx="320" cy="285" r="5" fill="#1D4ED8" stroke="none"/>
    </g>`
  }

  if (id === 'bodySkin-high-noon-brands') {
    return `<g id="skin-high-noon-brands" stroke="#EA580C" stroke-width="${OUTLINE_MINOR}" stroke-linecap="round" fill="none">
      <path d="M290 70 L315 85 L340 70"/>
      <path d="M150 295 L190 275 L230 315 L270 280 L310 310"/>
      <circle cx="190" cy="275" r="4" fill="#FDE047" stroke="none"/>
      <circle cx="270" cy="280" r="4" fill="#FDE047" stroke="none"/>
    </g>`
  }

  // Subtle freckles fallback
  return `<g id="skin-organic" fill="${primary}" opacity="0.6">
    <circle cx="270" cy="116" r="6"/>
    <circle cx="290" cy="96" r="5"/>
    <circle cx="170" cy="296" r="9"/>
    <circle cx="230" cy="284" r="8"/>
    <circle cx="290" cy="304" r="9"/>
  </g>`
}

// -------------------------------------------------------------
// 4. FACE ACCESSORIES (Face Safe Zone: Eyes Remain 100% Readable)
// -------------------------------------------------------------
function generateFace(item: CosmeticDefinition, primary: string) {
  const { id } = item

  if (id === 'face-happy' || id === 'face-victory-wink') {
    return `<g id="face-happy">
      <!-- Soft cheek blush, leaving eye sockets crisp -->
      <circle cx="304" cy="188" r="13" fill="#FF78A8" opacity="0.6"/>
      <circle cx="400" cy="192" r="11" fill="#FF78A8" opacity="0.6"/>
      ${id === 'face-victory-wink' ? `<path d="M368 144 Q384 130 400 144" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}" stroke-linecap="round" fill="none"/>` : ''}
    </g>`
  }

  if (id === 'face-shades' || id === 'face-disco-shades') {
    return `<g id="face-shades">
      <!-- Clean sunglasses frame centered on eye anchors -->
      <path d="M288 120 H356 C356 156, 344 172, 316 172 C292 172, 288 156, 288 120 Z" fill="#18181B" stroke="#00F2FE" stroke-width="${OUTLINE_MINOR}" stroke-linejoin="round"/>
      <path d="M364 124 H416 C416 156, 408 168, 392 168 C372 168, 364 156, 364 124 Z" fill="#18181B" stroke="#00F2FE" stroke-width="${OUTLINE_MINOR}" stroke-linejoin="round"/>
      <line x1="356" y1="128" x2="364" y2="128" stroke="#00F2FE" stroke-width="${OUTLINE_MINOR}"/>
      <!-- Crisp specular shine -->
      <line x1="296" y1="132" x2="320" y2="124" stroke="#FFFDF4" stroke-width="${DETAIL}" stroke-linecap="round"/>
      <line x1="372" y1="136" x2="392" y2="128" stroke="#FFFDF4" stroke-width="${DETAIL}" stroke-linecap="round"/>
    </g>`
  }

  // POLISHED: Clean subtle eyebags + temple sweat drop, no messy eye overlapping!
  if (id === 'face-office-burnout' || id === 'face-monday-face' || id === 'face-sleepy-eyes') {
    return `<g id="face-burnout">
      <!-- Translucent soft violet crescent under eyes -->
      <path d="M298 170 Q320 186 342 170" stroke="#7C3AED" stroke-width="${DETAIL}" stroke-linecap="round" fill="none" opacity="0.6"/>
      <path d="M366 172 Q384 184 402 172" stroke="#7C3AED" stroke-width="${DETAIL}" stroke-linecap="round" fill="none" opacity="0.6"/>
      <!-- Cute anime sweat drop on temple -->
      <path d="M280 114 C280 108, 288 108, 288 114 C288 120, 280 120, 280 114 Z" fill="#60A5FA"/>
    </g>`
  }

  // POLISHED: Slim horizontal cyber laser visor that accents eyes without heavy clutter
  if (id === 'face-laser-visor' || id === 'face-cyber-scan' || id === 'face-space-visor') {
    return `<g id="face-visor">
      <defs>
        <filter id="visor-glow-512" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <path d="M284 132 C330 122, 390 126, 420 140 L416 154 C390 142, 330 138, 284 148 Z" fill="#EF4444" fill-opacity="0.75" stroke="${COLOR}" stroke-width="${DETAIL}" stroke-linejoin="round" filter="url(#visor-glow-512)"/>
      <line x1="292" y1="142" x2="410" y2="146" stroke="#FFFDF4" stroke-width="${DETAIL}" stroke-linecap="round"/>
    </g>`
  }

  if (id === 'face-pixel-eyes') {
    return `<g id="face-pixel" fill="#18181B">
      <rect x="290" y="130" width="14" height="10"/>
      <rect x="304" y="130" width="14" height="10"/>
      <rect x="318" y="130" width="14" height="10"/>
      <rect x="332" y="130" width="14" height="10"/>
      <rect x="304" y="140" width="14" height="14"/>
      <rect x="318" y="140" width="14" height="14"/>
      <rect x="366" y="134" width="14" height="10"/>
      <rect x="380" y="134" width="14" height="10"/>
      <rect x="394" y="134" width="14" height="10"/>
      <rect x="374" y="144" width="14" height="14"/>
      <rect x="388" y="144" width="14" height="14"/>
      <rect x="306" y="132" width="4" height="4" fill="#FFFDF4"/>
      <rect x="376" y="136" width="4" height="4" fill="#FFFDF4"/>
    </g>`
  }

  // REDDIT & LOL FACE ITEMS
  if (id === 'face-spirit-fox-mask') {
    return `<g id="face-fox-mask">
      <g transform="translate(260, 95) rotate(-15)">
        <path d="M0 40 C-10 10, 30 -5, 50 15 C70 -5, 110 10, 100 40 C95 65, 50 75, 50 75 C50 75, 5 65, 0 40 Z" fill="#FFFDF4" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
        <polygon points="5,15 15,-15 35,5" fill="#DC2626" stroke="${COLOR}" stroke-width="${DETAIL}"/>
        <polygon points="65,5 85,-15 95,15" fill="#DC2626" stroke="${COLOR}" stroke-width="${DETAIL}"/>
        <path d="M20 35 Q35 25 45 40" stroke="#DC2626" stroke-width="${DETAIL}" fill="none"/>
        <path d="M55 40 Q65 25 80 35" stroke="#DC2626" stroke-width="${DETAIL}" fill="none"/>
        <circle cx="50" cy="55" r="4" fill="#18181B"/>
      </g>
    </g>`
  }

  if (id === 'face-kda-neon-demon-visor') {
    return `<g id="face-kda-mask">
      <path d="M330 180 C360 170, 410 170, 440 185 L430 225 C390 235, 350 230, 320 215 Z" fill="#0B0F19" stroke="#FF007F" stroke-width="${OUTLINE_MINOR}"/>
      <g fill="#00F2FE">
        <polygon points="345,188 355,188 350,202"/>
        <polygon points="365,188 375,188 370,205"/>
        <polygon points="385,188 395,188 390,205"/>
        <polygon points="405,188 415,188 410,202"/>
        <polygon points="350,220 360,220 355,206"/>
        <polygon points="370,220 380,220 375,208"/>
        <polygon points="390,220 400,220 395,208"/>
        <polygon points="410,220 420,220 415,206"/>
      </g>
    </g>`
  }

  if (id === 'face-star-guardian-gem') {
    return `<g id="face-sg-gem">
      <polygon points="352,105 356,118 369,122 356,126 352,139 348,126 335,122 348,118" fill="#FDE047" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <circle cx="352" cy="122" r="4" fill="#FF78A8"/>
      <circle cx="305" cy="188" r="10" fill="#FF78A8" opacity="0.6"/>
      <circle cx="395" cy="192" r="9" fill="#FF78A8" opacity="0.6"/>
      <polygon points="295,175 297,178 300,178 298,180 299,183 295,181 291,183 292,180 290,178 293,178" fill="#FFFDF4"/>
      <polygon points="405,180 407,183 410,183 408,185 409,188 405,186 401,188 402,185 400,183 403,183" fill="#FFFDF4"/>
    </g>`
  }

  if (id === 'face-blood-moon-oni-half-mask') {
    return `<g id="face-oni-mask">
      <path d="M330 185 C370 170, 420 175, 450 195 L440 235 C390 245, 340 235, 320 215 Z" fill="#991B1B" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}"/>
      <polygon points="360,190 372,190 366,215" fill="#FDE047" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <polygon points="410,190 422,190 416,215" fill="#FDE047" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <line x1="340" y1="210" x2="430" y2="210" stroke="#18181B" stroke-width="${OUTLINE_MINOR}"/>
    </g>`
  }

  if (id === 'face-rojom-abyss-eyes') {
    return `<g id="face-rojom-eyes">
      <circle cx="320" cy="138" r="28" fill="none" stroke="#7C3AED" stroke-width="${DETAIL}" opacity="0.8"/>
      <circle cx="320" cy="138" r="18" fill="none" stroke="#C084FC" stroke-width="${DETAIL}" opacity="0.9"/>
      <circle cx="382" cy="144" r="22" fill="none" stroke="#7C3AED" stroke-width="${DETAIL}" opacity="0.8"/>
      <circle cx="382" cy="144" r="14" fill="none" stroke="#C084FC" stroke-width="${DETAIL}" opacity="0.9"/>
      <circle cx="352" cy="115" r="4" fill="#38BDF8"/>
    </g>`
  }

  if (id === 'face-arcane-hextech-monocle') {
    return `<g id="face-hextech-monocle">
      <circle cx="382" cy="144" r="22" fill="#0284C7" fill-opacity="0.35" stroke="#F59E0B" stroke-width="${OUTLINE_MINOR}"/>
      <circle cx="382" cy="144" r="12" fill="none" stroke="#38BDF8" stroke-width="${DETAIL}"/>
      <path d="M360 144 L340 135" stroke="#F59E0B" stroke-width="${OUTLINE_MINOR}"/>
      <circle cx="386" cy="138" r="3" fill="#FFFDF4"/>
    </g>`
  }

  if (id === 'face-snoo-heart-blush') {
    return `<g id="face-snoo-blush">
      <path d="M304 184 C298 174, 288 180, 298 194 L304 200 L310 194 C320 180, 310 174, 304 184 Z" fill="#FF4500" opacity="0.75"/>
      <path d="M394 188 C388 178, 378 184, 388 198 L394 204 L400 198 C410 184, 400 178, 394 188 Z" fill="#FF4500" opacity="0.75"/>
      <circle cx="320" cy="132" r="3" fill="#FFFDF4"/>
      <circle cx="382" cy="138" r="3" fill="#FFFDF4"/>
    </g>`
  }

  if (id === 'face-high-noon-smolder') {
    return `<g id="face-high-noon-cigar">
      <path d="M410 216 L445 224" stroke="#78350F" stroke-width="10" stroke-linecap="round"/>
      <circle cx="446" cy="224" r="4" fill="#EA580C"/>
      <circle cx="447" cy="224" r="2" fill="#FDE047"/>
      <path d="M450 220 C465 205, 455 185, 470 170" stroke="#CBD5E1" stroke-width="${DETAIL}" fill="none" opacity="0.7" stroke-linecap="round"/>
    </g>`
  }

  if (id === 'face-coven-occult-veil') {
    return `<g id="face-coven-veil">
      <path d="M280 120 C320 100, 380 100, 420 125 L415 160 C380 145, 320 145, 285 160 Z" fill="#18181B" fill-opacity="0.45" stroke="#7C3AED" stroke-width="${DETAIL}"/>
      <polygon points="352,100 357,112 352,124 347,112" fill="#A855F7" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <circle cx="352" cy="112" r="3" fill="#FFFDF4"/>
    </g>`
  }

  if (id === 'face-project-hud-reticle') {
    return `<g id="face-project-hud">
      <circle cx="382" cy="144" r="24" fill="none" stroke="#00F2FE" stroke-width="${DETAIL}" stroke-dasharray="10 8"/>
      <line x1="382" y1="116" x2="382" y2="124" stroke="#00F2FE" stroke-width="${DETAIL}"/>
      <line x1="382" y1="164" x2="382" y2="172" stroke="#00F2FE" stroke-width="${DETAIL}"/>
      <line x1="354" y1="144" x2="362" y2="144" stroke="#00F2FE" stroke-width="${DETAIL}"/>
      <line x1="402" y1="144" x2="410" y2="144" stroke="#00F2FE" stroke-width="${DETAIL}"/>
      <circle cx="382" cy="144" r="4" fill="#FF007F"/>
    </g>`
  }

  return `<g id="face-custom">
    <ellipse cx="320" cy="140" rx="34" ry="26" fill="${primary}" fill-opacity="0.25" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
    <ellipse cx="384" cy="146" rx="26" ry="22" fill="${primary}" fill-opacity="0.25" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
    <line x1="354" y1="142" x2="362" y2="142" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
  </g>`
}

// -------------------------------------------------------------
// 5. PETS (Pet Visual Contract: 20-28% volume, Lower Contrast)
// -------------------------------------------------------------
function generatePet(item: CosmeticDefinition, primary: string, secondary: string) {
  const { id } = item

  const wrapper = (content: string) => `<g id="pet-companion">
    <defs>
      <style>
        @keyframes pet-bob-512 {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-8px); }
        }
      </style>
    </defs>
    <g style="animation: pet-bob-512 2.4s ease-in-out infinite">
      ${content}
    </g>
  </g>`

  if (id === 'pet-shiba-dog' || id === 'pet-shiba-inu') {
    return wrapper(`<!-- Shiba Inu Pet (Controlled Scale & Contrast) -->
      <ellipse cx="432" cy="380" rx="34" ry="28" fill="#F59E0B" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
      <path d="M462 370 C476 360, 482 344, 470 336 C460 340, 456 354, 458 366" fill="#F59E0B" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <ellipse cx="422" cy="388" rx="20" ry="14" fill="#FFFDF4"/>
      <circle cx="428" cy="352" r="24" fill="#F59E0B" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
      <ellipse cx="428" cy="360" rx="13" ry="10" fill="#FFFDF4"/>
      <polygon points="408,338 404,312 424,328" fill="#F59E0B" stroke="${COLOR}" stroke-width="${DETAIL}" stroke-linejoin="round"/>
      <polygon points="411,335 408,318 420,330" fill="#FF78A8"/>
      <polygon points="440,328 454,312 450,338" fill="#F59E0B" stroke="${COLOR}" stroke-width="${DETAIL}" stroke-linejoin="round"/>
      <polygon points="442,330 450,318 447,335" fill="#FF78A8"/>
      <circle cx="418" cy="350" r="4" fill="${COLOR}"/>
      <circle cx="438" cy="350" r="4" fill="${COLOR}"/>
      <polygon points="428,356 425,353 431,353" fill="${COLOR}"/>
      <circle cx="412" cy="358" r="3" fill="#FF78A8" opacity="0.6"/>
      <circle cx="444" cy="358" r="3" fill="#FF78A8" opacity="0.6"/>
      <path d="M412 372 Q428 378 444 372" stroke="#EF4444" stroke-width="${DETAIL}" stroke-linecap="round"/>
      <circle cx="428" cy="376" r="4" fill="#FFD84D"/>`)
  }

  if (id === 'pet-corgi-pup') {
    return wrapper(`<!-- Corgi Pup Pet -->
      <ellipse cx="432" cy="382" rx="35" ry="27" fill="#D97706" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
      <ellipse cx="425" cy="389" rx="20" ry="13" fill="#FFFDF4"/>
      <circle cx="428" cy="352" r="25" fill="#D97706" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
      <polygon points="428,330 423,358 433,358" fill="#FFFDF4"/>
      <ellipse cx="402" cy="328" rx="11" ry="22" fill="#D97706" stroke="${COLOR}" stroke-width="${DETAIL}" transform="rotate(-25 402 328)"/>
      <ellipse cx="402" cy="328" rx="6" ry="16" fill="#FF78A8" transform="rotate(-25 402 328)"/>
      <ellipse cx="454" cy="328" rx="11" ry="22" fill="#D97706" stroke="${COLOR}" stroke-width="${DETAIL}" transform="rotate(25 454 328)"/>
      <ellipse cx="454" cy="328" rx="6" ry="16" fill="#FF78A8" transform="rotate(25 454 328)"/>
      <circle cx="418" cy="352" r="4" fill="${COLOR}"/>
      <circle cx="438" cy="352" r="4" fill="${COLOR}"/>
      <circle cx="428" cy="358" r="4" fill="${COLOR}"/>
      <path d="M428 362 Q428 370 433 370 Q436 370 435 362 Z" fill="#FF78A8"/>`)
  }

  if (id === 'pet-calico-cat' || id === 'pet-lucky-black-cat' || id === 'pet-cloud-cat') {
    const isBlack = id === 'pet-lucky-black-cat'
    const isCloud = id === 'pet-cloud-cat'
    const catColor = isBlack ? '#18181B' : '#FFFDF4'
    const eyeColor = isBlack ? '#FFD84D' : COLOR

    return wrapper(`<!-- Cat Pet -->
      ${isCloud ? '<ellipse cx="432" cy="402" rx="40" ry="13" fill="#BAE6FD" opacity="0.8"/>' : ''}
      <ellipse cx="432" cy="380" rx="30" ry="26" fill="${catColor}" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
      <path d="M458 376 C474 366, 480 346, 470 338 C464 343, 460 358, 454 372" fill="none" stroke="${COLOR}" stroke-width="${DETAIL}" stroke-linecap="round"/>
      ${!isBlack && !isCloud ? '<ellipse cx="445" cy="374" rx="11" ry="10" fill="#F59E0B"/><ellipse cx="422" cy="390" rx="10" ry="8" fill="#18181B"/>' : ''}
      <circle cx="428" cy="352" r="23" fill="${catColor}" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
      <polygon points="408,342 405,316 424,332" fill="${catColor}" stroke="${COLOR}" stroke-width="${DETAIL}" stroke-linejoin="round"/>
      <polygon points="411,339 408,322 421,334" fill="#FF78A8"/>
      <polygon points="438,332 451,316 448,342" fill="${catColor}" stroke="${COLOR}" stroke-width="${DETAIL}" stroke-linejoin="round"/>
      <polygon points="440,334 448,322 445,339" fill="#FF78A8"/>
      <circle cx="418" cy="352" r="4" fill="${eyeColor}"/>
      <circle cx="438" cy="352" r="4" fill="${eyeColor}"/>
      <polygon points="428,358 425,355 431,355" fill="#FF78A8"/>
      <path d="M415 372 Q428 377 441 372" stroke="#EF4444" stroke-width="${DETAIL}" stroke-linecap="round"/>
      <circle cx="428" cy="375" r="4" fill="#FFD84D" stroke="${COLOR}" stroke-width="${DETAIL}"/>`)
  }

  if (id === 'pet-mini-capybara') {
    return wrapper(`<!-- Capybara Pet -->
      <ellipse cx="432" cy="380" rx="36" ry="28" fill="#854D0E" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
      <path d="M406 360 C406 344, 448 344, 451 360 L451 376 C451 386, 406 386, 406 376 Z" fill="#713F12" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
      <circle cx="424" cy="376" r="3" fill="${COLOR}"/>
      <circle cx="434" cy="376" r="3" fill="${COLOR}"/>
      <circle cx="428" cy="334" r="10" fill="#F59E0B" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <circle cx="428" cy="326" r="3" fill="#22C55E"/>`)
  }

  if (id === 'pet-baby-dragon') {
    return wrapper(`<!-- Baby Dragon Pet -->
      <ellipse cx="432" cy="380" rx="32" ry="26" fill="#10B981" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
      <path d="M452 364 C468 344, 480 356, 464 376 Z" fill="#34D399" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <circle cx="426" cy="350" r="23" fill="#10B981" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
      <polygon points="412,336 406,316 422,330" fill="#FFD84D" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <polygon points="436,330 446,316 442,336" fill="#FFD84D" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <circle cx="416" cy="350" r="4" fill="${COLOR}"/>
      <circle cx="436" cy="350" r="4" fill="${COLOR}"/>
      <circle cx="406" cy="360" r="5" fill="#EF4444" opacity="0.8"/>`)
  }

  // REDDIT & LOL PETS
  if (id === 'pet-spirit-fox-kiko') {
    return wrapper(`<!-- Spirit Fox Kiko -->
      <ellipse cx="432" cy="380" rx="30" ry="24" fill="#FFFDF4" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
      <path d="M455 375 C475 355, 485 330, 470 320 C455 330, 450 355, 448 370" fill="#FFC0D9" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <circle cx="426" cy="352" r="22" fill="#FFFDF4" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
      <polygon points="408,340 404,315 422,330" fill="#FFFDF4" stroke="${COLOR}" stroke-width="${DETAIL}" stroke-linejoin="round"/>
      <polygon points="410,336 408,322 418,332" fill="#FF78A8"/>
      <polygon points="436,330 448,315 446,340" fill="#FFFDF4" stroke="${COLOR}" stroke-width="${DETAIL}" stroke-linejoin="round"/>
      <polygon points="438,332 445,322 443,336" fill="#FF78A8"/>
      <circle cx="416" cy="352" r="4" fill="#0284C7"/>
      <circle cx="436" cy="352" r="4" fill="#0284C7"/>
      <polygon points="426,358 423,355 429,355" fill="#18181B"/>
      <circle cx="410" cy="360" r="3" fill="#FF78A8" opacity="0.6"/>
      <circle cx="442" cy="360" r="3" fill="#FF78A8" opacity="0.6"/>`)
  }

  if (id === 'pet-star-guardian-dango') {
    return wrapper(`<!-- Star Guardian Dango -->
      <ellipse cx="432" cy="370" rx="28" ry="26" fill="#FEF08A" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
      <polygon points="402,365 390,350 406,355" fill="#FFFDF4" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <polygon points="462,365 474,350 458,355" fill="#FFFDF4" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <polygon points="432,330 435,338 444,340 435,342 432,350 429,342 420,340 429,338" fill="#FDE047" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <circle cx="422" cy="368" r="4" fill="#18181B"/>
      <circle cx="442" cy="368" r="4" fill="#18181B"/>
      <circle cx="416" cy="374" r="4" fill="#FF78A8"/>
      <circle cx="448" cy="374" r="4" fill="#FF78A8"/>`)
  }

  if (id === 'pet-reddit-snoo-mini-bot') {
    return wrapper(`<!-- Reddit Snoo Mini Bot -->
      <ellipse cx="432" cy="390" rx="26" ry="10" fill="#00F2FE" opacity="0.75"/>
      <circle cx="432" cy="360" r="24" fill="#FFFDF4" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
      <path d="M432 336 L432 322 L442 320" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}" stroke-linecap="round" fill="none"/>
      <circle cx="444" cy="318" r="5" fill="#FF4500" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <ellipse cx="432" cy="360" rx="16" ry="10" fill="#0F172A"/>
      <circle cx="426" cy="360" r="3" fill="#00F2FE"/>
      <circle cx="438" cy="360" r="3" fill="#00F2FE"/>`)
  }

  if (id === 'pet-blood-moon-little-crow') {
    return wrapper(`<!-- Blood Moon Little Crow -->
      <polygon points="415,360 455,360 445,395 425,395" fill="#18181B" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
      <polygon points="410,360 430,335 445,360" fill="#991B1B" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
      <polygon points="445,345 465,350 445,355" fill="#F59E0B" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <circle cx="435" cy="348" r="3" fill="#EF4444"/>
      <rect x="428" y="365" width="8" height="18" rx="2" fill="#FFFDF4" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <line x1="432" y1="368" x2="432" y2="380" stroke="#DC2626" stroke-width="${DETAIL}"/>`)
  }

  if (id === 'pet-porofessor-poro') {
    return wrapper(`<!-- Porofessor Poro -->
      <circle cx="432" cy="370" r="28" fill="#FFFDF4" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
      <!-- Curved horns -->
      <path d="M412 350 C400 340, 400 325, 412 325 C416 335, 418 345, 418 350" fill="#78350F" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <path d="M452 350 C464 340, 464 325, 452 325 C448 335, 446 345, 446 350" fill="#78350F" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <circle cx="424" cy="366" r="4" fill="#18181B"/>
      <circle cx="440" cy="366" r="4" fill="#18181B"/>
      <circle cx="440" cy="366" r="8" fill="none" stroke="#F59E0B" stroke-width="${DETAIL}"/>
      <!-- Pink tongue -->
      <path d="M428 376 C428 390, 436 390, 436 376 Z" fill="#FF78A8" stroke="${COLOR}" stroke-width="${DETAIL}"/>`)
  }

  if (id === 'pet-little-legend-pengu') {
    return wrapper(`<!-- Little Legend Pengu -->
      <ellipse cx="432" cy="375" rx="24" ry="28" fill="#0F172A" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
      <ellipse cx="432" cy="380" rx="16" ry="18" fill="#FFFDF4"/>
      <polygon points="426,368 438,368 432,376" fill="#F59E0B" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <circle cx="425" cy="362" r="3" fill="#18181B"/>
      <circle cx="439" cy="362" r="3" fill="#18181B"/>
      <!-- Tiny knight cap & wooden sword -->
      <polygon points="420,350 444,350 432,335" fill="#3B82F6" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <line x1="452" y1="365" x2="462" y2="390" stroke="#78350F" stroke-width="4" stroke-linecap="round"/>`)
  }

  if (id === 'pet-project-cyber-drone') {
    return wrapper(`<!-- PROJECT Cyber Drone -->
      <polygon points="432,340 460,365 448,390 416,390 404,365" fill="#18181B" stroke="#00F2FE" stroke-width="${OUTLINE_MINOR}"/>
      <circle cx="432" cy="365" r="10" fill="#00F2FE" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <circle cx="432" cy="365" r="4" fill="#FFFDF4"/>
      <line x1="410" y1="390" x2="400" y2="405" stroke="#00F2FE" stroke-width="${DETAIL}"/>
      <line x1="454" y1="390" x2="464" y2="405" stroke="#00F2FE" stroke-width="${DETAIL}"/>`)
  }

  if (id === 'pet-coven-shadow-familiar') {
    return wrapper(`<!-- Coven Shadow Familiar -->
      <ellipse cx="432" cy="380" rx="26" ry="24" fill="#18181B" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
      <circle cx="432" cy="355" r="20" fill="#18181B" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
      <polygon points="416,345 412,325 426,340" fill="#18181B" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <polygon points="448,345 452,325 438,340" fill="#18181B" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <circle cx="424" cy="355" r="3" fill="#A855F7"/>
      <circle cx="440" cy="355" r="3" fill="#A855F7"/>
      <circle cx="432" cy="344" r="3" fill="#C084FC"/>
      <path d="M452 385 C468 375, 475 355, 465 345" stroke="#4C1D95" stroke-width="${OUTLINE_MINOR}" fill="none" stroke-linecap="round"/>`)
  }

  if (id === 'pet-cafe-cutie-pastry-pup') {
    return wrapper(`<!-- Cafe Cutie Pastry Pup -->
      <ellipse cx="432" cy="380" rx="28" ry="24" fill="#FDE68A" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
      <circle cx="432" cy="355" r="22" fill="#FDE68A" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
      <!-- Cream swirl hat with cherry -->
      <path d="M418 340 C418 320, 446 320, 446 340 Z" fill="#FFFDF4" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <circle cx="432" cy="320" r="5" fill="#EF4444"/>
      <circle cx="424" cy="355" r="4" fill="#78350F"/>
      <circle cx="440" cy="355" r="4" fill="#78350F"/>
      <circle cx="418" cy="362" r="3" fill="#FF78A8"/>
      <circle cx="446" cy="362" r="3" fill="#FF78A8"/>`)
  }

  if (id === 'pet-arcane-firelight-beetle') {
    return wrapper(`<!-- Arcane Firelight Beetle -->
      <ellipse cx="432" cy="370" rx="22" ry="26" fill="#047857" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
      <ellipse cx="432" cy="380" rx="14" ry="14" fill="#34D399" opacity="0.9"/>
      <ellipse cx="432" cy="350" rx="14" ry="10" fill="#065F46" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <circle cx="426" cy="348" r="3" fill="#FDE047"/>
      <circle cx="438" cy="348" r="3" fill="#FDE047"/>
      <path d="M414 365 C395 350, 400 330, 415 345" stroke="#A7F3D0" stroke-width="${DETAIL}" fill="none"/>
      <path d="M450 365 C469 350, 464 330, 449 345" stroke="#A7F3D0" stroke-width="${DETAIL}" fill="none"/>`)
  }

  // Fallback companion creature
  return wrapper(`<!-- Creature Companion -->
    <ellipse cx="432" cy="378" rx="32" ry="26" fill="${primary}" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
    <polygon points="412,344 406,322 425,338" fill="${secondary}" stroke="${COLOR}" stroke-width="${DETAIL}" stroke-linejoin="round"/>
    <polygon points="439,338 452,322 449,344" fill="${secondary}" stroke="${COLOR}" stroke-width="${DETAIL}" stroke-linejoin="round"/>
    <circle cx="418" cy="368" r="4" fill="${COLOR}"/>
    <circle cx="442" cy="368" r="4" fill="${COLOR}"/>
    <circle cx="412" cy="378" r="3" fill="#FF78A8" opacity="0.6"/>
    <circle cx="448" cy="378" r="3" fill="#FF78A8" opacity="0.6"/>`)
}

// -------------------------------------------------------------
// 6. TRAILS (Behind Duck / Tail Tip Anchor: 84, 322)
// -------------------------------------------------------------
function generateTrail(item: CosmeticDefinition, primary: string) {
  const { id } = item

  if (id === 'trail-ripples') {
    return `<g id="trail-ripples">
      <defs>
        <style>@keyframes ripple-flow-512 { 0% { stroke-dashoffset: 0; } 100% { stroke-dashoffset: -72; } }</style>
      </defs>
      <g stroke="#61C9FF" stroke-width="${OUTLINE_MAJOR}" stroke-linecap="round" fill="none" opacity="0.85" style="animation: ripple-flow-512 1.5s linear infinite">
        <path d="M30 400 C76 372, 150 376, 190 408" stroke-dasharray="32 20"/>
        <path d="M16 428 C72 396, 170 404, 220 436" stroke-dasharray="40 24"/>
        <path d="M44 456 C90 432, 156 436, 196 460" stroke-dasharray="28 16"/>
      </g>
      <circle cx="36" cy="384" r="5" fill="#BAE6FD"/>
      <circle cx="70" cy="368" r="4" fill="#BAE6FD"/>
    </g>`
  }

  if (id === 'trail-neon-wake' || id === 'trail-pixel-stream') {
    return `<g id="trail-neon">
      <defs>
        <style>@keyframes speed-dash-512 { 0% { stroke-dashoffset: 0; } 100% { stroke-dashoffset: -80; } }</style>
      </defs>
      <g stroke="#00F2FE" stroke-width="${OUTLINE_MINOR}" stroke-linecap="round" fill="none" style="animation: speed-dash-512 0.8s linear infinite">
        <line x1="16" y1="390" x2="176" y2="390" stroke-dasharray="36 24"/>
        <line x1="8" y1="420" x2="208" y2="420" stroke-dasharray="48 28" stroke="#FF007F"/>
        <line x1="32" y1="450" x2="184" y2="450" stroke-dasharray="32 20"/>
      </g>
    </g>`
  }

  if (id === 'trail-dragon-sparks') {
    return `<g id="trail-fire">
      <path d="M24 410 Q110 380 184 416" stroke="#FF5B00" stroke-width="16" stroke-linecap="round" fill="none"/>
      <path d="M44 430 Q120 410 170 436" stroke="#FFD84D" stroke-width="${OUTLINE_MINOR}" stroke-linecap="round" fill="none"/>
      <circle cx="50" cy="384" r="5" fill="#FFFDF4"/>
      <circle cx="90" cy="372" r="4" fill="#FFD84D"/>
      <circle cx="30" cy="436" r="4" fill="#FF5B00"/>
    </g>`
  }

  // REDDIT & LOL TRAILS
  if (id === 'trail-spirit-sakura-drifts') {
    return `<g id="trail-spirit-sakura">
      <defs>
        <style>@keyframes sakura-drift { 0% { transform: translate(0, 0) rotate(0deg); opacity: 0; } 50% { opacity: 0.9; } 100% { transform: translate(-80px, 30px) rotate(180deg); opacity: 0; } }</style>
      </defs>
      <g stroke="#FFC0D9" stroke-width="${OUTLINE_MINOR}" stroke-linecap="round" fill="none" opacity="0.8">
        <path d="M20 400 Q80 370 160 410" stroke-dasharray="24 16"/>
        <path d="M10 430 Q70 410 180 440" stroke-dasharray="30 20"/>
      </g>
      ${[
        { x: 50, y: 390, r: 8, fill: '#FF78A8', d: '0s' },
        { x: 90, y: 370, r: 10, fill: '#FFC0D9', d: '0.4s' },
        { x: 130, y: 420, r: 7, fill: '#FF78A8', d: '0.8s' },
        { x: 30, y: 440, r: 9, fill: '#FFD1E3', d: '1.2s' }
      ].map(p => `<g transform="translate(${p.x}, ${p.y})" style="animation: sakura-drift 2s ease-in-out infinite ${p.d}">
        <ellipse cx="0" cy="0" rx="${p.r}" ry="${p.r * 0.6}" fill="${p.fill}" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      </g>`).join('')}
    </g>`
  }

  if (id === 'trail-star-guardian-stardust') {
    return `<g id="trail-sg-stardust">
      <defs>
        <style>@keyframes star-twinkle-trail { 0%, 100% { transform: scale(0.6) rotate(0deg); opacity: 0.3; } 50% { transform: scale(1.1) rotate(90deg); opacity: 1; } }</style>
      </defs>
      <path d="M16 410 Q90 380 180 415" stroke="#FDE047" stroke-width="${OUTLINE_MINOR}" stroke-dasharray="20 15" stroke-linecap="round" fill="none"/>
      <path d="M30 435 Q100 410 190 445" stroke="#FF78A8" stroke-width="${OUTLINE_MINOR}" stroke-dasharray="25 20" stroke-linecap="round" fill="none"/>
      ${[
        { x: 40, y: 390, fill: '#FDE047', d: '0s' },
        { x: 85, y: 370, fill: '#BAE6FD', d: '0.3s' },
        { x: 120, y: 430, fill: '#FFC0D9', d: '0.6s' },
        { x: 160, y: 400, fill: '#FDE047', d: '0.9s' }
      ].map(s => `<g transform="translate(${s.x}, ${s.y})" style="animation: star-twinkle-trail 1.4s ease-in-out infinite ${s.d}">
        <polygon points="0,-9 3,-3 9,0 3,3 0,9 -3,3 -9,0 -3,-3" fill="${s.fill}" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      </g>`).join('')}
    </g>`
  }

  if (id === 'trail-kda-neon-laser-steps') {
    return `<g id="trail-kda-laser">
      <path d="M20 395 L180 395" stroke="#00F2FE" stroke-width="${OUTLINE_MINOR}" stroke-dasharray="24 16" stroke-linecap="round"/>
      <path d="M10 425 L190 425" stroke="#FF007F" stroke-width="${OUTLINE_MAJOR}" stroke-dasharray="32 18" stroke-linecap="round"/>
      <path d="M25 450 L170 450" stroke="#FFD84D" stroke-width="${OUTLINE_MINOR}" stroke-dasharray="16 12" stroke-linecap="round"/>
      <polygon points="60,420 70,405 80,420 70,435" fill="#00F2FE" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <polygon points="120,415 132,398 144,415 132,432" fill="#FF007F" stroke="${COLOR}" stroke-width="${DETAIL}"/>
    </g>`
  }

  if (id === 'trail-project-digital-grid') {
    return `<g id="trail-project-grid">
      <g stroke="#00F2FE" stroke-width="${DETAIL}" opacity="0.85">
        <line x1="20" y1="410" x2="180" y2="410"/>
        <line x1="10" y1="435" x2="190" y2="435"/>
        <line x1="20" y1="460" x2="180" y2="460"/>
        <line x1="40" y1="390" x2="20" y2="470"/>
        <line x1="80" y1="390" x2="60" y2="470"/>
        <line x1="120" y1="390" x2="100" y2="470"/>
        <line x1="160" y1="390" x2="140" y2="470"/>
      </g>
      <rect x="50" y="425" width="10" height="10" fill="#00F2FE"/>
      <rect x="110" y="400" width="8" height="8" fill="#FFFDF4"/>
    </g>`
  }

  if (id === 'trail-blood-moon-crimson-petals') {
    return `<g id="trail-blood-petals">
      <path d="M15 410 Q90 375 180 415" stroke="#991B1B" stroke-width="${OUTLINE_MAJOR}" stroke-linecap="round" fill="none"/>
      <path d="M30 435 Q100 405 170 445" stroke="#EF4444" stroke-width="${OUTLINE_MINOR}" stroke-linecap="round" fill="none"/>
      <circle cx="45" cy="385" r="7" fill="#7F1D1D" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <circle cx="95" cy="370" r="5" fill="#DC2626"/>
      <circle cx="135" cy="425" r="6" fill="#F59E0B"/>
      <circle cx="60" cy="445" r="4" fill="#EF4444"/>
    </g>`
  }

  if (id === 'trail-coven-dark-feathers') {
    return `<g id="trail-coven-feathers">
      <ellipse cx="100" cy="420" rx="90" ry="25" fill="#2E1065" opacity="0.3"/>
      <g fill="#18181B" stroke="${COLOR}" stroke-width="${DETAIL}">
        <path d="M40 400 C60 380, 80 410, 50 425 Z"/>
        <path d="M85 375 C105 355, 125 385, 95 400 Z"/>
        <path d="M125 415 C145 395, 165 425, 135 440 Z"/>
      </g>
      <circle cx="70" cy="390" r="3" fill="#A855F7"/>
      <circle cx="110" cy="430" r="4" fill="#C084FC"/>
    </g>`
  }

  if (id === 'trail-arcane-chemtech-fumes') {
    return `<g id="trail-arcane-fumes">
      <ellipse cx="90" cy="420" rx="80" ry="22" fill="#047857" opacity="0.45"/>
      <circle cx="40" cy="405" r="14" fill="#10B981" opacity="0.7"/>
      <circle cx="80" cy="385" r="18" fill="#34D399" opacity="0.6"/>
      <circle cx="130" cy="415" r="16" fill="#A7F3D0" opacity="0.7"/>
      <circle cx="70" cy="390" r="6" fill="#FDE047"/>
      <circle cx="115" cy="420" r="5" fill="#FDE047"/>
    </g>`
  }

  if (id === 'trail-cafe-cutie-sparkle-sprinkles') {
    return `<g id="trail-cafe-sprinkles">
      <path d="M20 410 Q90 380 180 415" stroke="#FBCFE8" stroke-width="${OUTLINE_MAJOR}" stroke-linecap="round" fill="none"/>
      ${[
        { x: 35, y: 395, color: '#EF4444', rot: 25 },
        { x: 65, y: 375, color: '#3B82F6', rot: -40 },
        { x: 95, y: 415, color: '#F59E0B', rot: 15 },
        { x: 130, y: 385, color: '#10B981', rot: 60 },
        { x: 155, y: 425, color: '#A855F7', rot: -10 }
      ].map(s => `<rect x="${s.x}" y="${s.y}" width="10" height="4" rx="2" fill="${s.color}" transform="rotate(${s.rot} ${s.x} ${s.y})" stroke="${COLOR}" stroke-width="${DETAIL}"/>`).join('')}
    </g>`
  }

  if (id === 'trail-reddit-upvote-arrows') {
    return `<g id="trail-reddit-arrows">
      <defs>
        <style>@keyframes upvote-rise { 0% { transform: translateY(0); opacity: 0; } 50% { opacity: 1; } 100% { transform: translateY(-40px); opacity: 0; } }</style>
      </defs>
      <path d="M20 420 Q90 395 180 425" stroke="#FF4500" stroke-width="${OUTLINE_MINOR}" stroke-dasharray="24 16" stroke-linecap="round" fill="none"/>
      ${[
        { x: 40, y: 410, scale: 0.9, d: '0s' },
        { x: 80, y: 385, scale: 1.2, d: '0.4s' },
        { x: 120, y: 425, scale: 0.8, d: '0.8s' },
        { x: 155, y: 395, scale: 1.0, d: '1.2s' }
      ].map(a => `<g transform="translate(${a.x}, ${a.y}) scale(${a.scale})" style="animation: upvote-rise 1.6s ease-out infinite ${a.d}">
        <polygon points="0,-12 9,0 4,0 4,10 -4,10 -4,0 -9,0" fill="#FF4500" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      </g>`).join('')}
    </g>`
  }

  if (id === 'trail-arcade-pixel-coins') {
    return `<g id="trail-arcade-coins">
      <path d="M15 410 L180 410" stroke="#F59E0B" stroke-width="${OUTLINE_MINOR}" stroke-dasharray="16 16"/>
      ${[
        { x: 40, y: 395 }, { x: 85, y: 375 }, { x: 130, y: 420 }, { x: 165, y: 390 }
      ].map(c => `<g transform="translate(${c.x}, ${c.y})">
        <circle cx="0" cy="0" r="8" fill="#FDE047" stroke="${COLOR}" stroke-width="${DETAIL}"/>
        <rect x="-2" y="-5" width="4" height="10" fill="#F59E0B"/>
      </g>`).join('')}
    </g>`
  }

  return `<g id="trail-flow">
    <defs>
      <style>@keyframes stream-flow-dyn-512 { 0% { stroke-dashoffset: 0; } 100% { stroke-dashoffset: -64; } }</style>
    </defs>
    <g stroke="${primary}" stroke-width="${OUTLINE_MAJOR}" stroke-linecap="round" fill="none" opacity="0.8" style="animation: stream-flow-dyn-512 1.4s linear infinite">
      <path d="M24 396 Q100 370 176 404" stroke-dasharray="32 20"/>
      <path d="M12 424 Q110 400 196 432" stroke-dasharray="40 24"/>
      <path d="M40 452 Q110 430 170 456" stroke-dasharray="28 16"/>
    </g>
  </g>`
}

// -------------------------------------------------------------
// 7. NECK ACCESSORIES (Neck Anchor: 256, 248)
// -------------------------------------------------------------
function generateNeck(item: CosmeticDefinition, primary: string) {
  const { id } = item

  if (id === 'neck-red-scarf') {
    return `<g id="neck-scarf">
      <path d="M212 244 C250 276, 310 268, 336 244 L328 270 C300 296, 240 296, 208 264 Z" fill="#EF4444" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}" stroke-linejoin="round"/>
      <path d="M264 272 L244 350 L276 356 L292 276 Z" fill="#DC2626" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}" stroke-linejoin="round"/>
      <line x1="248" y1="344" x2="272" y2="350" stroke="#FFD84D" stroke-width="${DETAIL}"/>
    </g>`
  }

  if (id === 'neck-golden-bow') {
    return `<g id="neck-bow">
      <polygon points="252,256 280,270 252,284" fill="#FFD84D" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <polygon points="308,256 280,270 308,284" fill="#FFD84D" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <circle cx="280" cy="270" r="8" fill="#10B981" stroke="${COLOR}" stroke-width="${DETAIL}"/>
    </g>`
  }

  // REDDIT & LOL NECK ITEMS
  if (id === 'neck-spirit-prayer-beads') {
    return `<g id="neck-spirit-beads">
      <path d="M212 244 Q276 286 332 244" stroke="#78350F" stroke-width="8" stroke-linecap="round" fill="none"/>
      ${[
        { cx: 220, cy: 246 }, { cx: 236, cy: 258 }, { cx: 254, cy: 268 },
        { cx: 274, cy: 272, r: 9, fill: '#06B6D4' },
        { cx: 294, cy: 268 }, { cx: 312, cy: 258 }, { cx: 328, cy: 246 }
      ].map(b => `<circle cx="${b.cx}" cy="${b.cy}" r="${b.r || 7}" fill="${b.fill || '#FDE047'}" stroke="${COLOR}" stroke-width="${DETAIL}"/>`).join('')}
      <!-- Silk tassel hanging -->
      <path d="M274 281 L270 315 L278 315 Z" fill="#F43F5E" stroke="${COLOR}" stroke-width="${DETAIL}"/>
    </g>`
  }

  if (id === 'neck-star-guardian-choker') {
    return `<g id="neck-sg-choker">
      <path d="M214 246 Q276 276 330 246" stroke="#FFFDF4" stroke-width="12" stroke-linecap="round" fill="none"/>
      <path d="M214 246 Q276 276 330 246" stroke="${COLOR}" stroke-width="${DETAIL}" stroke-linecap="round" fill="none"/>
      <!-- Star brooch -->
      <polygon points="274,256 277,266 287,268 278,274 281,284 274,277 267,284 270,274 261,268 271,266" fill="#FDE047" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <circle cx="274" cy="270" r="3" fill="#FF78A8"/>
    </g>`
  }

  if (id === 'neck-kda-diamond-pendant') {
    return `<g id="neck-kda-pendant">
      <path d="M214 246 Q276 276 330 246" stroke="#18181B" stroke-width="10" stroke-linecap="round" fill="none"/>
      <path d="M214 246 Q276 276 330 246" stroke="#FFD84D" stroke-width="2" stroke-linecap="round" fill="none"/>
      <!-- Iridescent diamond -->
      <polygon points="274,265 286,277 274,295 262,277" fill="#00F2FE" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <polygon points="274,265 286,277 274,285" fill="#FF007F" opacity="0.6"/>
    </g>`
  }

  if (id === 'neck-project-energy-collar') {
    return `<g id="neck-project-collar">
      <path d="M212 244 Q276 276 332 244" stroke="#18181B" stroke-width="14" stroke-linecap="round" fill="none"/>
      <path d="M216 246 Q276 276 328 246" stroke="#00F2FE" stroke-width="4" stroke-linecap="round" fill="none"/>
      <rect x="264" y="264" width="20" height="12" rx="3" fill="#0F172A" stroke="#00F2FE" stroke-width="${DETAIL}"/>
      <circle cx="274" cy="270" r="3" fill="#00F2FE"/>
    </g>`
  }

  if (id === 'neck-blood-moon-tassel') {
    return `<g id="neck-blood-tassel">
      <path d="M212 244 Q276 280 332 244" stroke="#991B1B" stroke-width="10" stroke-linecap="round" fill="none"/>
      <!-- Gold Magatama bead -->
      <path d="M274 265 C282 265, 286 272, 280 280 C274 286, 268 280, 274 265 Z" fill="#F59E0B" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <!-- Crimson silk tassel -->
      <line x1="274" y1="282" x2="274" y2="315" stroke="#DC2626" stroke-width="6" stroke-linecap="round"/>
      <line x1="274" y1="282" x2="274" y2="315" stroke="${COLOR}" stroke-width="${DETAIL}" stroke-linecap="round"/>
    </g>`
  }

  if (id === 'neck-coven-obsidian-amulet') {
    return `<g id="neck-coven-amulet">
      <path d="M214 246 Q276 276 330 246" stroke="#2E1065" stroke-width="10" stroke-linecap="round" fill="none"/>
      <polygon points="274,265 284,277 274,295 264,277" fill="#18181B" stroke="#A855F7" stroke-width="${DETAIL}"/>
      <circle cx="274" cy="278" r="3" fill="#C084FC"/>
    </g>`
  }

  if (id === 'neck-arcane-hextech-gem-pendant') {
    return `<g id="neck-hextech-pendant">
      <path d="M212 244 Q276 278 332 244" stroke="#D97706" stroke-width="8" stroke-linecap="round" fill="none"/>
      <!-- Hextech crystal in brass cog -->
      <circle cx="274" cy="276" r="12" fill="#78350F" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <polygon points="274,266 282,276 274,286 266,276" fill="#00F2FE" stroke="${COLOR}" stroke-width="${DETAIL}"/>
    </g>`
  }

  if (id === 'neck-cafe-cutie-ruffle-collar') {
    return `<g id="neck-cafe-ruffle">
      <path d="M210 244 C240 280, 305 280, 334 244 L326 266 C295 296, 245 296, 218 266 Z" fill="#FFFDF4" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}" stroke-linejoin="round"/>
      <!-- Pink ribbon bow & cherry heart -->
      <polygon points="262,268 274,276 262,284" fill="#FF78A8" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <polygon points="286,268 274,276 286,284" fill="#FF78A8" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <circle cx="274" cy="276" r="5" fill="#EF4444" stroke="${COLOR}" stroke-width="${DETAIL}"/>
    </g>`
  }

  if (id === 'neck-reddit-gold-award-medal') {
    return `<g id="neck-reddit-gold">
      <path d="M214 244 L274 276 L330 244" stroke="#FF4500" stroke-width="10" stroke-linecap="round" fill="none"/>
      <!-- Shiny gold medallion with star -->
      <circle cx="274" cy="285" r="14" fill="#FDE047" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
      <polygon points="274,275 277,282 284,283 278,288 280,295 274,291 268,295 270,288 264,283 271,282" fill="#F59E0B"/>
    </g>`
  }

  if (id === 'neck-arcade-pixel-bandana') {
    return `<g id="neck-arcade-bandana">
      <polygon points="214,244 332,244 274,294" fill="#FF007F" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}" stroke-linejoin="round"/>
      <rect x="254" y="254" width="8" height="8" fill="#00F2FE"/>
      <rect x="286" y="254" width="8" height="8" fill="#00F2FE"/>
      <rect x="270" y="270" width="8" height="8" fill="#FFD84D"/>
    </g>`
  }

  return `<g id="neck-custom">
    <path d="M212 244 Q276 280 332 244" stroke="${primary}" stroke-width="14" stroke-linecap="round"/>
    <path d="M212 244 Q276 280 332 244" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}" stroke-linecap="round" fill="none"/>
  </g>`
}

// -------------------------------------------------------------
// 8. BACK ACCESSORIES (Back Center: 144, 286)
// -------------------------------------------------------------
function generateBack(item: CosmeticDefinition, primary: string) {
  const { id } = item

  if (id === 'back-dragon-wings') {
    return `<g id="back-wings">
      <path d="M156 280 C110 220, 60 230, 40 270 C70 284, 100 296, 110 324 C80 320, 56 336, 60 356 C100 356, 136 330, 160 304 Z" fill="#EF4444" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}" stroke-linejoin="round"/>
      <path d="M156 280 C100 240, 50 250, 40 270" stroke="#FFD84D" stroke-width="${OUTLINE_MINOR}" fill="none"/>
    </g>`
  }

  if (id === 'back-jetpack' || id === 'back-rocket-pack') {
    return `<g id="back-jetpack">
      <rect x="96" y="250" width="44" height="84" rx="12" fill="#CBD5E1" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
      <path d="M104 334 L92 376 L144 376 L132 334 Z" fill="#FF5B00" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
      <polygon points="104,376 118,404 132,376" fill="#FFD84D"/>
    </g>`
  }

  // REDDIT & LOL BACK ITEMS
  if (id === 'back-spirit-blossom-sacred-ribbons') {
    return `<g id="back-spirit-ribbons">
      <!-- Ceremonial huge silk bow and flowing ribbons -->
      <path d="M140 270 C80 200, 30 220, 20 280 C60 290, 100 290, 130 280 Z" fill="#FFC0D9" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}"/>
      <path d="M140 280 C90 320, 40 370, 30 430 C60 410, 100 380, 135 310 Z" fill="#06B6D4" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
      <circle cx="138" cy="276" r="14" fill="#FDE047" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
      <circle cx="138" cy="276" r="6" fill="#FF78A8"/>
    </g>`
  }

  if (id === 'back-star-guardian-celestial-wings') {
    return `<g id="back-sg-wings">
      <!-- Pair of magical pastel wings with gold feathers -->
      <path d="M150 280 C100 180, 30 190, 15 250 C45 265, 85 270, 95 300 C60 300, 35 325, 40 350 C80 345, 120 325, 150 290 Z" fill="#FFFDF4" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}" stroke-linejoin="round"/>
      <path d="M140 270 C95 200, 40 210, 30 250" stroke="#FDE047" stroke-width="${OUTLINE_MINOR}" fill="none"/>
      <polygon points="85,270 92,284 106,286 96,295 98,308 85,302 72,308 74,295 64,286 78,284" fill="#FF78A8" stroke="${COLOR}" stroke-width="${DETAIL}"/>
    </g>`
  }

  if (id === 'back-kda-crystalline-fox-tails') {
    return `<g id="back-kda-tails">
      <!-- Holographic prismatic fox tails fanning out -->
      <path d="M140 300 C90 200, 20 230, 10 310 C30 350, 90 360, 130 320 Z" fill="#00F2FE" opacity="0.8" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}"/>
      <path d="M130 310 C80 250, 10 300, 5 380 C35 410, 90 395, 125 335 Z" fill="#FF007F" opacity="0.8" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}"/>
      <path d="M135 290 C95 230, 45 250, 40 300" stroke="#FFFDF4" stroke-width="${OUTLINE_MINOR}" fill="none"/>
    </g>`
  }

  if (id === 'back-project-cyber-wing-booster') {
    return `<g id="back-project-wings">
      <!-- Cyber mechanical wings & thrusters -->
      <polygon points="145,260 70,220 50,250 110,290 145,285" fill="#18181B" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}"/>
      <line x1="75" y1="230" x2="135" y2="265" stroke="#00F2FE" stroke-width="4"/>
      <polygon points="135,285 55,275 40,310 95,335 130,310" fill="#27272A" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}"/>
      <line x1="60" y1="285" x2="120" y2="310" stroke="#00F2FE" stroke-width="4"/>
      <!-- Thruster jet glow -->
      <polygon points="45,255 15,265 40,280" fill="#00F2FE"/>
    </g>`
  }

  if (id === 'back-blood-moon-demon-banner') {
    return `<g id="back-blood-banner">
      <!-- Sashimono samurai banner on back -->
      <line x1="145" y1="360" x2="105" y2="160" stroke="#78350F" stroke-width="8" stroke-linecap="round"/>
      <line x1="105" y1="165" x2="55" y2="175" stroke="#78350F" stroke-width="6" stroke-linecap="round"/>
      <polygon points="105,170 55,180 65,330 118,315" fill="#991B1B" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
      <circle cx="85" cy="240" r="16" fill="#18181B"/>
      <circle cx="85" cy="240" r="12" fill="#DC2626"/>
    </g>`
  }

  if (id === 'back-coven-raven-feather-cape') {
    return `<g id="back-coven-cape">
      <path d="M150 270 C100 230, 40 270, 25 340 C35 390, 70 420, 110 430 C125 390, 135 330, 150 270 Z" fill="#18181B" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}" stroke-linejoin="round"/>
      <path d="M130 285 C90 260, 50 300, 40 360 C65 385, 95 395, 120 375 Z" fill="#2E1065" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <circle cx="70" cy="350" r="4" fill="#A855F7"/>
    </g>`
  }

  if (id === 'back-arcane-hextech-rocket-harness') {
    return `<g id="back-hextech-harness">
      <!-- Dual brass tubes with glowing pressure dials -->
      <rect x="100" y="240" width="30" height="90" rx="8" fill="#78350F" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
      <rect x="75" y="260" width="28" height="75" rx="8" fill="#D97706" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
      <circle cx="115" cy="265" r="8" fill="#00F2FE" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <circle cx="89" cy="285" r="7" fill="#00F2FE" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <!-- Copper pipes -->
      <path d="M100 290 Q85 300 75 290" stroke="#F59E0B" stroke-width="4" fill="none"/>
    </g>`
  }

  if (id === 'back-cafe-cutie-giant-teacup') {
    return `<g id="back-cafe-teacup">
      <ellipse cx="100" cy="290" rx="42" ry="34" fill="#FFFDF4" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}"/>
      <path d="M60 290 C60 330, 140 330, 140 290 Z" fill="#FFC0D9" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
      <!-- Teacup handle -->
      <path d="M60 290 C40 290, 40 320, 62 320" stroke="${COLOR}" stroke-width="6" fill="none"/>
      <!-- Tea steam -->
      <path d="M90 260 Q100 240 90 220" stroke="#BAE6FD" stroke-width="4" stroke-linecap="round" fill="none"/>
      <path d="M110 260 Q120 240 110 220" stroke="#BAE6FD" stroke-width="4" stroke-linecap="round" fill="none"/>
    </g>`
  }

  if (id === 'back-reddit-snoo-jetpack') {
    return `<g id="back-snoo-jetpack">
      <!-- White capsule jetpack with upvote icons -->
      <rect x="90" y="250" width="46" height="88" rx="16" fill="#FFFDF4" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}"/>
      <rect x="100" y="265" width="26" height="36" rx="6" fill="#0F172A"/>
      <polygon points="113,272 120,282 116,282 116,292 110,292 110,282 106,282" fill="#FF4500"/>
      <!-- Orange exhaust thruster -->
      <polygon points="98,338 105,365 121,365 128,338" fill="#FF4500" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
      <polygon points="104,365 113,388 122,365" fill="#FDE047"/>
    </g>`
  }

  if (id === 'back-arcade-pixel-sword-shield') {
    return `<g id="back-arcade-sword">
      <!-- Crossed 8-bit sword and shield -->
      <line x1="60" y1="210" x2="140" y2="350" stroke="#3B82F6" stroke-width="12" stroke-linecap="square"/>
      <line x1="60" y1="210" x2="140" y2="350" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <polygon points="110,260 145,275 130,325 95,310" fill="#F59E0B" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
      <rect x="110" y="280" width="12" height="12" fill="#DC2626"/>
    </g>`
  }

  return `<g id="back-custom">
    <path d="M160 270 C100 230, 50 250, 44 290 C76 304, 110 316, 120 340 C96 336, 70 348, 76 364 C110 364, 144 336, 164 300 Z" fill="${primary}" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}" stroke-linejoin="round"/>
  </g>`
}

// -------------------------------------------------------------
// 9. AURAS (12 Dynamic Game-Inspired Concepts with Silhouette Clearance)
// -------------------------------------------------------------
function generateAura(id: string, primary: string, secondary: string) {
  // 1. ASTRAL DRAGON SPIRIT (Silhouette Clearance Gap: Center Opacity 0.25)
  if (id === 'aura-dragon-flame') {
    return `<g id="aura-astral-dragon">
      <defs>
        <filter id="dragon-glow-512" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <style>
          @keyframes dragon-coil-512 { 0%, 100% { transform: translateY(0px) rotate(0deg); } 50% { transform: translateY(-10px) rotate(2deg); } }
          @keyframes ember-rise-512 { 0% { transform: translateY(0) scale(0.6); opacity: 0; } 50% { opacity: 0.9; } 100% { transform: translateY(-100px) scale(1.1); opacity: 0; } }
        </style>
      </defs>
      <g filter="url(#dragon-glow-512)">
        <!-- Soft background flame with silhouette clearance -->
        <g transform-origin="256 274">
          <circle cx="256" cy="274" r="190" fill="#DC2626" opacity="0.18"/>
          <circle cx="256" cy="274" r="140" fill="#F59E0B" opacity="0.22"/>
        </g>
        <g style="animation: dragon-coil-512 4s ease-in-out infinite" transform-origin="256 274">
          <path d="M70 340 C40 210, 130 90, 260 70 C380 50, 470 130, 460 250 C450 340, 390 410, 300 420 C200 430, 120 370, 160 300 C190 240, 280 240, 310 290" fill="none" stroke="#DC2626" stroke-width="26" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>
          <path d="M70 340 C40 210, 130 90, 260 70 C380 50, 470 130, 460 250 C450 340, 390 410, 300 420 C200 430, 120 370, 160 300 C190 240, 280 240, 310 290" fill="none" stroke="#FBBF24" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>
          <!-- Dragon Head on outer left -->
          <g transform="translate(60, 170) rotate(-20)">
            <path d="M20 40 C10 10, 60 10, 90 30 C100 35, 110 55, 95 65 C80 75, 40 70, 20 40 Z" fill="#DC2626" stroke="${COLOR}" stroke-width="${DETAIL}"/>
            <circle cx="50" cy="35" r="5" fill="#FEF08A"/>
            <path d="M85 40 C110 30, 140 45, 160 35" stroke="#FDE047" stroke-width="${DETAIL}" fill="none" stroke-linecap="round"/>
          </g>
          <!-- Flaming pearl on outer right -->
          <circle cx="440" cy="320" r="16" fill="#FEF08A" stroke="#F97316" stroke-width="${DETAIL}"/>
        </g>
        <!-- Subtle rising embers -->
        <g fill="#FDE047">
          <circle cx="100" cy="400" r="4" style="animation: ember-rise-512 2.2s infinite"/>
          <circle cx="420" cy="380" r="5" style="animation: ember-rise-512 1.9s infinite 0.3s"/>
        </g>
      </g>
    </g>`
  }

  // 2. PHẬT QUANG VẠN TRƯỢNG (Sunbeam Rays with Head Clearance)
  if (id === 'aura-golden-rays' || id === 'aura-royal-sparkles') {
    return `<g id="aura-phat-quang">
      <defs>
        <filter id="mandala-glow-512" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="b1"/>
          <feMerge><feMergeNode in="b1"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <style>
          @keyframes mandala-spin-cw-512 { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
          @keyframes sacred-pulse-512 { 0%, 100% { transform: scale(1); opacity: 0.75; } 50% { transform: scale(1.05); opacity: 0.95; } }
        </style>
      </defs>
      <g filter="url(#mandala-glow-512)">
        <g style="animation: sacred-pulse-512 3.5s ease-in-out infinite" transform-origin="256 240">
          <circle cx="256" cy="240" r="185" fill="#FEF08A" opacity="0.14"/>
          <circle cx="256" cy="240" r="145" fill="#FBBF24" opacity="0.18"/>
        </g>
        <g style="animation: mandala-spin-cw-512 30s linear infinite" transform-origin="256 240">
          ${[...Array(16)].map((_, i) => {
            const angle = (i * 22.5 * Math.PI) / 180
            const x1 = 256 + Math.cos(angle) * 130
            const y1 = 240 + Math.sin(angle) * 130
            const x2 = 256 + Math.cos(angle) * (i % 2 === 0 ? 220 : 180)
            const y2 = 240 + Math.sin(angle) * (i % 2 === 0 ? 220 : 180)
            return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${i % 2 === 0 ? '#FDE047' : '#F59E0B'}" stroke-width="${i % 2 === 0 ? OUTLINE_MINOR : DETAIL}" stroke-linecap="round" opacity="0.85"/>`
          }).join('')}
        </g>
        <circle cx="256" cy="240" r="165" stroke="#FBBF24" stroke-width="${DETAIL}" stroke-dasharray="16 12" fill="none" opacity="0.8"/>
      </g>
    </g>`
  }

  // 3. LÔI THẦN SẤM SÉT (Lightning Arc Tempest)
  if (id === 'aura-storm-cloud') {
    return `<g id="aura-thunder-storm">
      <defs>
        <filter id="lightning-glow-512" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="b1"/>
          <feMerge><feMergeNode in="b1"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <style>
          @keyframes zap-flash-1 { 0%, 100% { opacity: 0.2; } 15% { opacity: 0.95; } 30% { opacity: 0.1; } 50% { opacity: 0.85; } }
        </style>
      </defs>
      <g filter="url(#lightning-glow-512)">
        <ellipse cx="256" cy="274" rx="195" ry="160" fill="#3B0764" opacity="0.25"/>
        <g stroke="#00F2FE" stroke-linecap="round" fill="none" style="animation: zap-flash-1 1.4s infinite">
          <path d="M90 110 L140 145 L110 175 L180 220" stroke-width="${OUTLINE_MINOR}"/>
          <path d="M420 90 L370 145 L410 175 L340 240 L380 270 L300 340" stroke-width="${OUTLINE_MINOR}" stroke="#A855F7"/>
          <path d="M420 90 L370 145 L410 175 L340 240 L380 270 L300 340" stroke="#FFFDF4" stroke-width="${DETAIL}"/>
        </g>
      </g>
    </g>`
  }

  // 4. HÀN BĂNG CỰC QUANG (Glacial Frost Aurora)
  if (id === 'aura-moon-glow') {
    return `<g id="aura-glacial-frost">
      <defs>
        <style>@keyframes ice-orbit-512 { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }</style>
      </defs>
      <ellipse cx="256" cy="274" rx="190" ry="155" fill="#0284C7" opacity="0.18"/>
      <g style="animation: ice-orbit-512 24s linear infinite" transform-origin="256 274">
        <circle cx="256" cy="274" r="165" stroke="#38BDF8" stroke-width="${DETAIL}" stroke-dasharray="14 14" fill="none" opacity="0.6"/>
        ${[...Array(6)].map((_, i) => {
          const angle = (i * 60 * Math.PI) / 180
          const cx = 256 + Math.cos(angle) * 185
          const cy = 274 + Math.sin(angle) * 155
          return `<polygon points="${cx},${cy - 14} ${cx + 8},${cy} ${cx},${cy + 14} ${cx - 8},${cy}" fill="#E0F2FE" stroke="#0284C7" stroke-width="${DETAIL}"/>`
        }).join('')}
      </g>
    </g>`
  }

  // 5. HỎA DIỆM SƠN (Super Saiyan Inferno)
  if (id === 'aura-chilli-heat') {
    return `<g id="aura-super-saiyan-fire">
      <defs>
        <style>@keyframes fire-roar-1 { 0%, 100% { transform: scaleY(1) translateY(0); } 50% { transform: scaleY(1.08) translateY(-10px); } }</style>
      </defs>
      <g style="animation: fire-roar-1 1.4s ease-in-out infinite" transform-origin="256 436">
        <path d="M80 436 C50 330, 80 210, 120 160 C140 100, 200 50, 256 20 C310 50, 370 100, 390 160 C430 210, 460 330, 430 436 Z" fill="#DC2626" opacity="0.25"/>
        <path d="M110 436 C90 340, 120 240, 150 190 C170 130, 210 90, 256 60 C300 90, 340 130, 360 190 C390 240, 420 340, 400 436 Z" fill="#EA580C" opacity="0.4"/>
        <path d="M150 436 C140 360, 170 270, 195 230 C215 180, 235 140, 256 110 C275 140, 295 180, 315 230 C340 270, 370 360, 360 436 Z" fill="#FDE047" opacity="0.6"/>
      </g>
    </g>`
  }

  // 6. U HỒN VẠN QUỶ (Spectral Soul Wisps)
  if (id === 'aura-ghost-fog') {
    return `<g id="aura-spectral-ghosts">
      <defs>
        <style>@keyframes ghost-drift-1 { 0%, 100% { transform: translateY(0px); } 50% { transform: translateY(-12px); } }</style>
      </defs>
      <ellipse cx="256" cy="274" rx="190" ry="155" fill="#064E3B" opacity="0.22"/>
      <g style="animation: ghost-drift-1 3s ease-in-out infinite" transform-origin="110 160">
        <path d="M110 140 C85 140, 75 165, 75 190 C75 220, 100 230, 95 245 C105 235, 120 235, 125 245 C130 225, 145 210, 145 190 C145 165, 135 140, 110 140 Z" fill="#6EE7B7" stroke="#065F46" stroke-width="${DETAIL}"/>
        <circle cx="98" cy="175" r="4" fill="#064E3B"/><circle cx="122" cy="175" r="4" fill="#064E3B"/>
      </g>
      <g style="animation: ghost-drift-1 3.5s ease-in-out infinite 0.5s" transform-origin="400 180">
        <path d="M400 150 C375 150, 365 175, 365 200 C365 230, 390 240, 385 255 C395 245, 410 245, 415 255 C420 235, 435 220, 435 200 C435 175, 425 150, 400 150 Z" fill="#A7F3D0" stroke="#065F46" stroke-width="${DETAIL}"/>
        <circle cx="388" cy="185" r="4" fill="#064E3B"/><circle cx="412" cy="185" r="4" fill="#064E3B"/>
      </g>
    </g>`
  }

  // 7. CYBER MATRIX HUD (Clean Outer Hologram Ring)
  if (id === 'aura-neon-glitch') {
    return `<g id="aura-cyber-matrix">
      <defs>
        <style>@keyframes hud-spin-cw { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }</style>
      </defs>
      <g style="animation: hud-spin-cw 20s linear infinite" transform-origin="256 274">
        <circle cx="256" cy="274" r="195" stroke="#00F2FE" stroke-width="${DETAIL}" stroke-dasharray="36 18 10 18" fill="none" opacity="0.8"/>
        <circle cx="256" cy="274" r="160" stroke="#FF007F" stroke-width="${DETAIL}" stroke-dasharray="20 20" fill="none" opacity="0.6"/>
        <path d="M61 274 L75 260 M61 274 L75 288" stroke="#00F2FE" stroke-width="${DETAIL}" stroke-linecap="round"/>
        <path d="M451 274 L437 260 M451 274 L437 288" stroke="#00F2FE" stroke-width="${DETAIL}" stroke-linecap="round"/>
      </g>
    </g>`
  }

  // 8. HOA KHAI PHÚ QUÝ (Lotus Cyclone)
  if (id === 'aura-lotus-breeze') {
    return `<g id="aura-lotus-cyclone">
      <defs>
        <style>@keyframes petal-spiral-512 { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }</style>
      </defs>
      <ellipse cx="256" cy="274" rx="190" ry="155" fill="#F43F5E" opacity="0.16"/>
      <g style="animation: petal-spiral-512 18s linear infinite" transform-origin="256 274">
        <path d="M100 200 C150 120, 360 100, 410 220 C460 340, 260 440, 150 390 C60 350, 60 260, 100 200 Z" stroke="#FDA4AF" stroke-width="${DETAIL}" stroke-dasharray="60 30" fill="none" stroke-linecap="round"/>
        ${[...Array(6)].map((_, i) => {
          const angle = (i * 60 * Math.PI) / 180
          const cx = 256 + Math.cos(angle) * 165
          const cy = 274 + Math.sin(angle) * 135
          return `<path d="M${cx} ${cy - 10} C${cx + 6} ${cy - 4}, ${cx + 6} ${cy + 4}, ${cx} ${cy + 10} C${cx - 6} ${cy + 4}, ${cx - 6} ${cy - 4}, ${cx} ${cy - 10} Z" fill="#F43F5E" stroke="${COLOR}" stroke-width="${DETAIL}"/>`
        }).join('')}
      </g>
    </g>`
  }

  // 9. COSMIC SINGULARITY (Galaxy Nebula)
  if (id === 'aura-space-dust') {
    return `<g id="aura-cosmic-singularity">
      <defs>
        <style>@keyframes galaxy-spin-512 { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }</style>
      </defs>
      <ellipse cx="256" cy="274" rx="190" ry="150" fill="#312E81" opacity="0.22"/>
      <g style="animation: galaxy-spin-512 24s linear infinite" transform-origin="256 274">
        <ellipse cx="256" cy="274" rx="195" ry="115" stroke="#818CF8" stroke-width="${DETAIL}" stroke-dasharray="40 20" fill="none" transform="rotate(-25 256 274)"/>
        <circle cx="85" cy="210" r="12" fill="#C084FC" stroke="${COLOR}" stroke-width="${DETAIL}"/>
        <circle cx="427" cy="338" r="10" fill="#38BDF8" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      </g>
    </g>`
  }

  // 10. PIXEL ARCADE
  if (id === 'aura-pixel-orbit') {
    return `<g id="aura-arcade-pixel">
      <defs>
        <style>@keyframes pixel-ring-cw { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }</style>
      </defs>
      <g style="animation: pixel-ring-cw 12s steps(12) infinite" transform-origin="256 274">
        <ellipse cx="256" cy="274" rx="190" ry="150" stroke="#00F2FE" stroke-width="${OUTLINE_MINOR}" stroke-dasharray="20 20" fill="none" opacity="0.75"/>
        ${[...Array(4)].map((_, i) => {
          const angle = (i * 90 * Math.PI) / 180
          const cx = 256 + Math.cos(angle) * 190
          const cy = 274 + Math.sin(angle) * 150
          return `<rect x="${cx - 9}" y="${cy - 9}" width="18" height="18" fill="${i % 2 === 0 ? '#FF007F' : '#FFD84D'}" stroke="${COLOR}" stroke-width="${DETAIL}"/>`
        }).join('')}
      </g>
    </g>`
  }

  // 11. NEON DISCO
  if (id === 'aura-disco-lights') {
    return `<g id="aura-disco-party">
      <defs>
        <style>
          @keyframes laser-sweep-1 { 0%, 100% { transform: rotate(-20deg); } 50% { transform: rotate(20deg); } }
          @keyframes laser-sweep-2 { 0%, 100% { transform: rotate(20deg); } 50% { transform: rotate(-20deg); } }
        </style>
      </defs>
      <g style="animation: laser-sweep-1 3.5s ease-in-out infinite" transform-origin="60 0">
        <polygon points="60,0 10,440 200,440" fill="#00F2FE" opacity="0.18"/>
        <line x1="60" y1="0" x2="105" y2="440" stroke="#00F2FE" stroke-width="${DETAIL}" opacity="0.8"/>
      </g>
      <g style="animation: laser-sweep-2 4s ease-in-out infinite" transform-origin="450 0">
        <polygon points="450,0 310,440 500,440" fill="#FF007F" opacity="0.18"/>
        <line x1="450" y1="0" x2="405" y2="440" stroke="#FF007F" stroke-width="${DETAIL}" opacity="0.8"/>
      </g>
    </g>`
  }

  // 12. ENCHANTED FIREFLIES / BUBBLES
  if (id === 'aura-bubbles' || id === 'aura-fairy-lights') {
    return `<g id="aura-fairy-fireflies">
      <defs>
        <style>@keyframes firefly-bob-1 { 0%, 100% { transform: translate(0, 0); opacity: 0.4; } 50% { transform: translate(8px, -14px); opacity: 0.9; } }</style>
      </defs>
      <ellipse cx="256" cy="274" rx="190" ry="155" fill="#059669" opacity="0.18"/>
      ${[
        { x: 90, y: 160, r: 8 }, { x: 140, y: 100, r: 10 }, { x: 370, y: 90, r: 9 },
        { x: 430, y: 170, r: 10 }, { x: 440, y: 310, r: 9 },
      ].map((f, i) => `
        <g transform="translate(${f.x}, ${f.y})" style="animation: firefly-bob-1 2.2s ease-in-out infinite ${i * 0.3}s">
          <circle cx="0" cy="0" r="${f.r}" fill="#FDE047" stroke="#34D399" stroke-width="${DETAIL}"/>
          <circle cx="0" cy="0" r="${f.r / 2}" fill="#FFFDF4"/>
        </g>
      `).join('')}
    </g>`
  }

  // REDDIT & LOL AURAS
  if (id === 'aura-spirit-lotus-sanctuary') {
    return `<g id="aura-spirit-sanctuary">
      <defs>
        <style>@keyframes lotus-rot { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }</style>
      </defs>
      <ellipse cx="256" cy="274" rx="200" ry="160" fill="#FCE7F3" opacity="0.25"/>
      <g style="animation: lotus-rot 24s linear infinite" transform-origin="256 274">
        <circle cx="256" cy="274" r="175" stroke="#06B6D4" stroke-width="${DETAIL}" stroke-dasharray="24 16" fill="none" opacity="0.8"/>
        ${[0, 72, 144, 216, 288].map((deg) => {
          const rad = (deg * Math.PI) / 180
          const cx = 256 + Math.cos(rad) * 175
          const cy = 274 + Math.sin(rad) * 140
          return `<g transform="translate(${cx}, ${cy})">
            <ellipse cx="0" cy="0" rx="14" ry="8" fill="#FFC0D9" stroke="${COLOR}" stroke-width="${DETAIL}"/>
            <circle cx="0" cy="0" r="4" fill="#FDE047"/>
          </g>`
        }).join('')}
      </g>
    </g>`
  }

  if (id === 'aura-star-guardian-constellation') {
    return `<g id="aura-sg-constellation">
      <defs>
        <style>@keyframes zodiac-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }</style>
      </defs>
      <ellipse cx="256" cy="274" rx="200" ry="160" fill="#FEF08A" opacity="0.2"/>
      <g style="animation: zodiac-spin 20s linear infinite" transform-origin="256 274">
        <circle cx="256" cy="274" r="180" stroke="#FDE047" stroke-width="${DETAIL}" stroke-dasharray="16 12" fill="none"/>
        <circle cx="256" cy="274" r="150" stroke="#38BDF8" stroke-width="${DETAIL}" stroke-dasharray="8 8" fill="none"/>
        ${[0, 60, 120, 180, 240, 300].map((deg, i) => {
          const rad = (deg * Math.PI) / 180
          const cx = 256 + Math.cos(rad) * 180
          const cy = 274 + Math.sin(rad) * 145
          return `<polygon points="${cx},${cy - 10} ${cx + 3},${cy - 3} ${cx + 10},${cy} ${cx + 3},${cy + 3} ${cx},${cy + 10} ${cx - 3},${cy + 3} ${cx - 10},${cy} ${cx - 3},${cy - 3}" fill="${i % 2 === 0 ? '#FDE047' : '#FF78A8'}" stroke="${COLOR}" stroke-width="${DETAIL}"/>`
        }).join('')}
      </g>
    </g>`
  }

  if (id === 'aura-kda-all-out-stage-lights') {
    return `<g id="aura-kda-stage">
      <polygon points="60,0 20,440 180,440" fill="#00F2FE" opacity="0.22"/>
      <polygon points="450,0 330,440 490,440" fill="#FF007F" opacity="0.22"/>
      <ellipse cx="256" cy="400" rx="180" ry="50" fill="#0B0F19" opacity="0.3"/>
      <!-- Prismatic crystals -->
      <polygon points="100,160 120,180 100,210 80,180" fill="#00F2FE" stroke="${COLOR}" stroke-width="${DETAIL}" opacity="0.9"/>
      <polygon points="410,150 430,175 410,205 390,175" fill="#FF007F" stroke="${COLOR}" stroke-width="${DETAIL}" opacity="0.9"/>
    </g>`
  }

  if (id === 'aura-project-cyber-overdrive') {
    return `<g id="aura-project-overdrive">
      <defs>
        <style>@keyframes hex-pulse { 0%, 100% { opacity: 0.5; transform: scale(0.98); } 50% { opacity: 0.9; transform: scale(1.02); } }</style>
      </defs>
      <g style="animation: hex-pulse 2s ease-in-out infinite" transform-origin="256 274">
        <polygon points="256,90 396,160 396,380 256,450 116,380 116,160" stroke="#00F2FE" stroke-width="${OUTLINE_MINOR}" fill="none" opacity="0.7" stroke-dasharray="24 16"/>
        <polygon points="256,110 376,170 376,360 256,430 136,360 136,170" stroke="#F59E0B" stroke-width="${DETAIL}" fill="none" opacity="0.8"/>
      </g>
      <line x1="80" y1="274" x2="130" y2="274" stroke="#00F2FE" stroke-width="4"/>
      <line x1="382" y1="274" x2="432" y2="274" stroke="#00F2FE" stroke-width="4"/>
    </g>`
  }

  if (id === 'aura-blood-moon-eclipse') {
    return `<g id="aura-blood-eclipse">
      <!-- Big crimson moon backdrop -->
      <circle cx="256" cy="220" r="150" fill="#7F1D1D" opacity="0.4"/>
      <circle cx="256" cy="220" r="146" fill="#18181B"/>
      <circle cx="270" cy="210" r="130" fill="#991B1B" opacity="0.85"/>
      <circle cx="285" cy="200" r="115" fill="#DC2626" opacity="0.6"/>
      <!-- Drifting blood clouds -->
      <ellipse cx="140" cy="340" rx="70" ry="20" fill="#7F1D1D" opacity="0.5"/>
      <ellipse cx="370" cy="330" rx="80" ry="24" fill="#7F1D1D" opacity="0.5"/>
    </g>`
  }

  if (id === 'aura-coven-eldritch-eclipse') {
    return `<g id="aura-coven-eclipse">
      <circle cx="256" cy="240" r="160" fill="#18181B" stroke="#A855F7" stroke-width="${OUTLINE_MINOR}" opacity="0.75"/>
      <circle cx="256" cy="240" r="145" stroke="#4C1D95" stroke-width="${DETAIL}" stroke-dasharray="14 10" fill="none"/>
      <!-- Thorny brambles -->
      <path d="M100 240 C110 160, 180 110, 256 110" stroke="#7E22CE" stroke-width="${OUTLINE_MINOR}" fill="none"/>
      <path d="M412 240 C402 160, 332 110, 256 110" stroke="#7E22CE" stroke-width="${OUTLINE_MINOR}" fill="none"/>
      <circle cx="100" cy="240" r="6" fill="#EF4444"/>
      <circle cx="412" cy="240" r="6" fill="#EF4444"/>
    </g>`
  }

  if (id === 'aura-arcane-hexcore-surge') {
    return `<g id="aura-hexcore-surge">
      <defs>
        <style>@keyframes hex-ring-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }</style>
      </defs>
      <ellipse cx="256" cy="274" rx="200" ry="160" fill="#0284C7" opacity="0.2"/>
      <g style="animation: hex-ring-spin 16s linear infinite" transform-origin="256 274">
        <circle cx="256" cy="274" r="180" stroke="#D97706" stroke-width="${OUTLINE_MINOR}" stroke-dasharray="30 18" fill="none"/>
        <circle cx="256" cy="274" r="160" stroke="#00F2FE" stroke-width="${DETAIL}" stroke-dasharray="12 12" fill="none"/>
        <polygon points="256,94 266,110 246,110" fill="#00F2FE"/>
        <polygon points="436,274 420,284 420,264" fill="#00F2FE"/>
        <polygon points="256,454 246,438 266,438" fill="#00F2FE"/>
        <polygon points="76,274 92,264 92,284" fill="#00F2FE"/>
      </g>
    </g>`
  }

  if (id === 'aura-cafe-cutie-sugar-cloud') {
    return `<g id="aura-cafe-cloud">
      <ellipse cx="256" cy="274" rx="195" ry="155" fill="#FCE7F3" opacity="0.3"/>
      <!-- Soft sugar aroma puffs -->
      <circle cx="100" cy="220" r="32" fill="#FFFDF4" opacity="0.6"/>
      <circle cx="130" cy="200" r="26" fill="#FFFDF4" opacity="0.6"/>
      <circle cx="410" cy="220" r="32" fill="#FFFDF4" opacity="0.6"/>
      <circle cx="380" cy="200" r="26" fill="#FFFDF4" opacity="0.6"/>
      <!-- Floating sweet hearts -->
      <circle cx="95" cy="160" r="8" fill="#FF78A8"/>
      <circle cx="415" cy="160" r="8" fill="#FF78A8"/>
      <circle cx="256" cy="80" r="10" fill="#FFC0D9"/>
    </g>`
  }

  if (id === 'aura-reddit-karma-whirlwind') {
    return `<g id="aura-reddit-karma">
      <defs>
        <style>@keyframes karma-rot { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }</style>
      </defs>
      <ellipse cx="256" cy="274" rx="200" ry="160" fill="#FF4500" opacity="0.18"/>
      <g style="animation: karma-rot 18s linear infinite" transform-origin="256 274">
        <circle cx="256" cy="274" r="180" stroke="#FF4500" stroke-width="${DETAIL}" stroke-dasharray="24 16" fill="none"/>
        ${[0, 60, 120, 180, 240, 300].map((deg) => {
          const rad = (deg * Math.PI) / 180
          const cx = 256 + Math.cos(rad) * 180
          const cy = 274 + Math.sin(rad) * 145
          return `<g transform="translate(${cx}, ${cy}) rotate(${deg + 90})">
            <polygon points="0,-8 6,0 3,0 3,7 -3,7 -3,0 -6,0" fill="#FF4500" stroke="${COLOR}" stroke-width="${DETAIL}"/>
          </g>`
        }).join('')}
      </g>
    </g>`
  }

  if (id === 'aura-arcade-game-over-glitch') {
    return `<g id="aura-arcade-glitch">
      <rect x="66" y="94" width="380" height="360" rx="16" fill="none" stroke="#00F2FE" stroke-width="${OUTLINE_MINOR}" stroke-dasharray="30 20" opacity="0.8"/>
      <rect x="80" y="110" width="352" height="328" rx="12" fill="none" stroke="#FF007F" stroke-width="${DETAIL}" stroke-dasharray="16 16" opacity="0.6"/>
      <rect x="70" y="260" width="24" height="24" fill="#FFD84D" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <rect x="418" y="260" width="24" height="24" fill="#FF007F" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <rect x="244" y="80" width="24" height="24" fill="#00F2FE" stroke="${COLOR}" stroke-width="${DETAIL}"/>
    </g>`
  }

  return `<g id="aura-default">
    <ellipse cx="256" cy="274" rx="190" ry="150" fill="${primary}" opacity="0.25"/>
    <circle cx="256" cy="274" r="170" stroke="${secondary}" stroke-width="${OUTLINE_MINOR}" stroke-dasharray="24 16" fill="none"/>
  </g>`
}

// -------------------------------------------------------------
// FINISH & NAMEPLATE
// -------------------------------------------------------------
function generateFinish(item: CosmeticDefinition, primary: string, secondary: string) {
  const { id } = item

  if (id === 'finish-spirit-blossom-tree') {
    return `<g id="finish-spirit-tree">
      <!-- Spirit blossom burst & tree arch -->
      <path d="M256 460 C256 340, 160 260, 100 200 C150 180, 220 220, 256 280 C292 220, 362 180, 412 200 C352 260, 256 340, 256 460 Z" fill="#78350F" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}"/>
      ${[
        { cx: 100, cy: 190, r: 24, fill: '#FFC0D9' },
        { cx: 412, cy: 190, r: 24, fill: '#FFC0D9' },
        { cx: 256, cy: 140, r: 32, fill: '#FF78A8' },
        { cx: 180, cy: 160, r: 20, fill: '#06B6D4' },
        { cx: 332, cy: 160, r: 20, fill: '#06B6D4' }
      ].map(b => `<circle cx="${b.cx}" cy="${b.cy}" r="${b.r}" fill="${b.fill}" stroke="${COLOR}" stroke-width="${DETAIL}"/>`).join('')}
    </g>`
  }

  if (id === 'finish-star-guardian-final-spark') {
    return `<g id="finish-sg-spark">
      <!-- Massive prismatic star beam blast -->
      <polygon points="256,20 290,180 460,256 290,332 256,492 222,332 52,256 222,180" fill="#FEF08A" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}"/>
      <polygon points="256,80 278,200 398,256 278,312 256,432 234,312 114,256 234,200" fill="#FF78A8" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <circle cx="256" cy="256" r="36" fill="#FFFDF4" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
    </g>`
  }

  if (id === 'finish-kda-popstar-fireworks') {
    return `<g id="finish-kda-fireworks">
      <polygon points="256,40 310,200 472,256 310,312 256,472 202,312 40,256 202,200" fill="#00F2FE" opacity="0.8" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}"/>
      <polygon points="256,100 295,215 412,256 295,297 256,412 217,297 100,256 217,215" fill="#FF007F" opacity="0.8" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
      <circle cx="256" cy="256" r="40" fill="#FFD84D" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
    </g>`
  }

  if (id === 'finish-project-laser-grid-wipe') {
    return `<g id="finish-project-wipe">
      <rect x="56" y="56" width="400" height="400" fill="#0F172A" stroke="#00F2FE" stroke-width="${OUTLINE_MAJOR}" opacity="0.85"/>
      <g stroke="#00F2FE" stroke-width="${DETAIL}">
        ${[100, 150, 200, 250, 300, 350, 400].map(p => `
          <line x1="${p}" y1="56" x2="${p}" y2="456"/>
          <line x1="56" y1="${p}" x2="456" y2="${p}"/>
        `).join('')}
      </g>
      <polygon points="256,160 352,256 256,352 160,256" fill="#00F2FE" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
    </g>`
  }

  if (id === 'finish-blood-moon-torii-gate') {
    return `<g id="finish-blood-torii">
      <!-- Torii gate arch -->
      <path d="M120 180 L392 180 L412 150 L100 150 Z" fill="#991B1B" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}"/>
      <rect x="130" y="200" width="252" height="20" fill="#7F1D1D" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
      <rect x="160" y="200" width="30" height="260" fill="#991B1B" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}"/>
      <rect x="322" y="200" width="30" height="260" fill="#991B1B" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}"/>
      <!-- Eerie moon in center -->
      <circle cx="256" cy="290" r="46" fill="#DC2626" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
    </g>`
  }

  if (id === 'finish-coven-crow-storm') {
    return `<g id="finish-coven-storm">
      <circle cx="256" cy="256" r="190" fill="#18181B" opacity="0.8" stroke="#A855F7" stroke-width="${OUTLINE_MAJOR}"/>
      ${[
        { cx: 160, cy: 150 }, { cx: 350, cy: 160 }, { cx: 140, cy: 340 }, { cx: 360, cy: 330 }, { cx: 256, cy: 100 }
      ].map(c => `<g transform="translate(${c.cx}, ${c.cy})">
        <path d="M-20,-10 Q0,-25 20,-10 Q0,-5 -20,-10 Z" fill="#2E1065" stroke="${COLOR}" stroke-width="${DETAIL}"/>
        <circle cx="0" cy="-12" r="4" fill="#EF4444"/>
      </g>`).join('')}
      <polygon points="256,180 290,256 256,332 222,256" fill="#A855F7" stroke="${COLOR}" stroke-width="${DETAIL}"/>
    </g>`
  }

  if (id === 'finish-arcane-super-mega-death-rocket') {
    return `<g id="finish-arcane-rocket">
      <circle cx="256" cy="256" r="180" fill="#EA580C" opacity="0.75" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}"/>
      <circle cx="256" cy="256" r="130" fill="#FDE047" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}"/>
      <!-- Shark Rocket Head in center -->
      <polygon points="256,160 320,280 192,280" fill="#00F2FE" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}"/>
      <circle cx="236" cy="240" r="8" fill="#DC2626"/>
      <circle cx="276" cy="240" r="8" fill="#DC2626"/>
    </g>`
  }

  if (id === 'finish-cafe-cutie-giant-parfait') {
    return `<g id="finish-cafe-parfait">
      <ellipse cx="256" cy="420" rx="140" ry="40" fill="#FFFDF4" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}"/>
      <path d="M156 420 C156 280, 356 280, 356 420 Z" fill="#FCE7F3" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}"/>
      <!-- Ice cream scoops & cherries -->
      <circle cx="216" cy="270" r="45" fill="#FFC0D9" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}"/>
      <circle cx="296" cy="270" r="45" fill="#BAE6FD" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}"/>
      <circle cx="256" cy="210" r="50" fill="#FFFDF4" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}"/>
      <circle cx="256" cy="145" r="16" fill="#EF4444" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
    </g>`
  }

  if (id === 'finish-reddit-platinum-shower') {
    return `<g id="finish-reddit-platinum">
      <polygon points="256,40 310,200 472,256 310,312 256,472 202,312 40,256 202,200" fill="#FF4500" opacity="0.8" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}"/>
      <circle cx="256" cy="256" r="60" fill="#00F2FE" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}"/>
      <circle cx="256" cy="256" r="40" fill="#FFFDF4" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
      <polygon points="256,226 268,250 294,254 275,273 280,298 256,286 232,298 237,273 218,254 244,250" fill="#FF4500"/>
    </g>`
  }

  if (id === 'finish-arcade-victory-screen') {
    return `<g id="finish-arcade-victory">
      <rect x="56" y="100" width="400" height="312" rx="20" fill="#18181B" stroke="#00F2FE" stroke-width="${OUTLINE_MAJOR}"/>
      <rect x="76" y="120" width="360" height="272" rx="12" fill="#0F172A" stroke="#FF007F" stroke-width="${OUTLINE_MINOR}"/>
      <!-- "YOU WIN" pixel badge banner -->
      <rect x="120" y="210" width="272" height="92" rx="10" fill="#FDE047" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}"/>
      <rect x="136" y="226" width="240" height="60" fill="#FF007F"/>
      <circle cx="200" cy="256" r="12" fill="#00F2FE"/>
      <circle cx="256" cy="256" r="12" fill="#FFFDF4"/>
      <circle cx="312" cy="256" r="12" fill="#00F2FE"/>
    </g>`
  }

  return `<g id="finish-burst">
    ${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
      const angle = (i * 45 * Math.PI) / 180
      const x1 = 256 + Math.cos(angle) * 110
      const y1 = 256 + Math.sin(angle) * 110
      const x2 = 256 + Math.cos(angle) * 190
      const y2 = 256 + Math.sin(angle) * 190
      return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${i % 2 === 0 ? primary : secondary}" stroke-width="${OUTLINE_MINOR}" stroke-linecap="round"/>`
    }).join('')}
    <circle cx="256" cy="256" r="30" fill="#FFD84D" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
  </g>`
}

function generateNameplate(item: CosmeticDefinition, primary: string, secondary: string) {
  const { id } = item

  if (id === 'nameplate-spirit-blossom-scroll') {
    return `<g id="nameplate-spirit-scroll">
      <path d="M104 430 C200 445, 312 445, 408 430 L392 484 C304 496, 208 496, 120 484 Z" fill="#FFFDF4" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}" stroke-linejoin="round"/>
      <path d="M120 440 L392 440" stroke="#FFC0D9" stroke-width="6"/>
      <circle cx="140" cy="458" r="10" fill="#06B6D4" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <circle cx="372" cy="458" r="10" fill="#FF78A8" stroke="${COLOR}" stroke-width="${DETAIL}"/>
    </g>`
  }

  if (id === 'nameplate-star-guardian-ribbon') {
    return `<g id="nameplate-sg-ribbon">
      <path d="M96 430 C200 455, 312 455, 416 430 L400 484 C304 496, 208 496, 112 484 Z" fill="#FFFDF4" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}" stroke-linejoin="round"/>
      <path d="M112 436 L400 436" stroke="#FDE047" stroke-width="6"/>
      <polygon points="256,442 262,456 276,458 265,468 268,482 256,474 244,482 247,468 236,458 250,456" fill="#FDE047" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <circle cx="130" cy="458" r="8" fill="#FF78A8"/>
      <circle cx="382" cy="458" r="8" fill="#38BDF8"/>
    </g>`
  }

  if (id === 'nameplate-kda-neon-glass') {
    return `<g id="nameplate-kda-glass">
      <polygon points="104,430 408,430 388,484 124,484" fill="#0B0F19" stroke="#00F2FE" stroke-width="${OUTLINE_MAJOR}" stroke-linejoin="round"/>
      <line x1="120" y1="440" x2="392" y2="440" stroke="#FF007F" stroke-width="4"/>
      <rect x="140" y="450" width="16" height="16" fill="#00F2FE" transform="rotate(45 148 458)"/>
      <rect x="364" y="450" width="16" height="16" fill="#FF007F" transform="rotate(45 372 458)"/>
    </g>`
  }

  if (id === 'nameplate-project-holo-banner') {
    return `<g id="nameplate-project-holo">
      <polygon points="96,430 416,430 396,484 116,484" fill="#18181B" stroke="#00F2FE" stroke-width="${OUTLINE_MAJOR}"/>
      <line x1="120" y1="457" x2="392" y2="457" stroke="#00F2FE" stroke-width="2" stroke-dasharray="8 6"/>
      <rect x="130" y="450" width="14" height="14" fill="#00F2FE"/>
      <rect x="368" y="450" width="14" height="14" fill="#F59E0B"/>
    </g>`
  }

  if (id === 'nameplate-blood-moon-katana-plaque') {
    return `<g id="nameplate-blood-katana">
      <!-- Lacquered crimson plaque -->
      <polygon points="104,430 408,430 392,484 120,484" fill="#7F1D1D" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}"/>
      <!-- Katana handle/scabbard underneath -->
      <line x1="80" y1="457" x2="432" y2="457" stroke="#18181B" stroke-width="8" stroke-linecap="round"/>
      <line x1="80" y1="457" x2="432" y2="457" stroke="#DC2626" stroke-width="3" stroke-linecap="round"/>
      <circle cx="256" cy="457" r="10" fill="#F59E0B" stroke="${COLOR}" stroke-width="${DETAIL}"/>
    </g>`
  }

  if (id === 'nameplate-coven-gothic-sigil') {
    return `<g id="nameplate-coven-sigil">
      <polygon points="100,430 412,430 392,484 120,484" fill="#18181B" stroke="#A855F7" stroke-width="${OUTLINE_MAJOR}"/>
      <circle cx="256" cy="457" r="12" fill="#2E1065" stroke="#C084FC" stroke-width="${DETAIL}"/>
      <polygon points="256,449 262,463 250,463" fill="#EF4444"/>
      <circle cx="140" cy="457" r="6" fill="#A855F7"/>
      <circle cx="372" cy="457" r="6" fill="#A855F7"/>
    </g>`
  }

  if (id === 'nameplate-arcane-piltover-gold') {
    return `<g id="nameplate-arcane-gold">
      <polygon points="100,430 412,430 392,484 120,484" fill="#78350F" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}"/>
      <rect x="120" y="438" width="272" height="38" fill="#FDE047" stroke="${COLOR}" stroke-width="${OUTLINE_MINOR}"/>
      <!-- Hextech blue crystal center -->
      <polygon points="256,442 268,457 256,472 244,457" fill="#00F2FE" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <circle cx="150" cy="457" r="6" fill="#D97706"/>
      <circle cx="362" cy="457" r="6" fill="#D97706"/>
    </g>`
  }

  if (id === 'nameplate-cafe-cutie-menu-board') {
    return `<g id="nameplate-cafe-board">
      <rect x="104" y="430" width="304" height="54" rx="12" fill="#FCE7F3" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}"/>
      <rect x="120" y="438" width="272" height="38" rx="6" fill="#FFFDF4" stroke="${COLOR}" stroke-width="${DETAIL}"/>
      <circle cx="140" cy="457" r="8" fill="#FF78A8"/>
      <circle cx="372" cy="457" r="8" fill="#FF78A8"/>
      <circle cx="256" cy="457" r="6" fill="#EF4444"/>
    </g>`
  }

  if (id === 'nameplate-reddit-front-page-badge') {
    return `<g id="nameplate-reddit-badge">
      <rect x="100" y="430" width="312" height="54" rx="14" fill="#0F172A" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}"/>
      <rect x="114" y="438" width="284" height="38" rx="8" fill="#1E293B"/>
      <!-- Upvote icon badge -->
      <polygon points="142,444 148,452 145,452 145,464 139,464 139,452 136,452" fill="#FF4500"/>
      <circle cx="368" cy="457" r="8" fill="#FDE047" stroke="${COLOR}" stroke-width="${DETAIL}"/>
    </g>`
  }

  if (id === 'nameplate-arcade-high-score-board') {
    return `<g id="nameplate-arcade-board">
      <rect x="96" y="430" width="320" height="54" rx="6" fill="#18181B" stroke="#00F2FE" stroke-width="${OUTLINE_MAJOR}"/>
      <rect x="110" y="438" width="292" height="38" fill="#0F172A" stroke="#FF007F" stroke-width="${DETAIL}"/>
      <rect x="130" y="448" width="18" height="18" fill="#FFD84D"/>
      <rect x="364" y="448" width="18" height="18" fill="#00F2FE"/>
    </g>`
  }

  return `<g id="nameplate-pedestal">
    <path d="M104 430 C200 452, 312 452, 408 430 L392 484 C304 496, 208 496, 120 484 Z" fill="${primary}" stroke="${COLOR}" stroke-width="${OUTLINE_MAJOR}" stroke-linejoin="round"/>
    <circle cx="144" cy="458" r="8" fill="${secondary}"/>
    <circle cx="368" cy="458" r="8" fill="${secondary}"/>
  </g>`
}

// Master Asset Resolver
function assetFor(item: CosmeticDefinition): string {
  const { id, slot } = item
  if (slot === 'bodyColor') {
    const palette = getDuckPalette(id)
    return frame(generateBaseDuckSvg(palette))
  }

  const seed = hash(id)
  const primary = PALETTE_COLORS[seed % PALETTE_COLORS.length]!
  const secondary = PALETTE_COLORS[(seed + 4) % PALETTE_COLORS.length]!

  let content = ''
  if (slot === 'head') content = generateHead(item, primary, secondary, seed)
  else if (slot === 'outfit') content = generateOutfit(item, primary, secondary, seed)
  else if (slot === 'bodySkin') content = generateBodySkin(item, primary, secondary)
  else if (slot === 'aura') content = generateAura(id, primary, secondary)
  else if (slot === 'pet') content = generatePet(item, primary, secondary)
  else if (slot === 'trail') content = generateTrail(item, primary)
  else if (slot === 'face') content = generateFace(item, primary)
  else if (slot === 'neck') content = generateNeck(item, primary)
  else if (slot === 'back') content = generateBack(item, primary)
  else if (slot === 'finish') content = generateFinish(item, primary, secondary)
  else if (slot === 'nameplate') content = generateNameplate(item, primary, secondary)
  else throw new Error(`Unknown slot: ${slot}`)

  return frame(content)
}

// Generate all cosmetic assets and previews
console.log(`Generating ${COSMETIC_CATALOG.length} canonical 512x512 cosmetics...`)

const defaultPalette = getDuckPalette('body-sunshine')
const canonicalBaseBodySvg = generateBaseDuckSvg(defaultPalette)

for (const item of COSMETIC_CATALOG) {
  const outputPath = path.join(process.cwd(), 'public', item.asset)
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  const asset = assetFor(item)
  fs.writeFileSync(outputPath, asset, 'utf8')

  const innerContent = asset.slice(asset.indexOf('>') + 1).replace('</svg>', '').trim()
  const preview = item.slot === 'bodyColor'
    ? asset
    : frame(`<g opacity="0.32">${canonicalBaseBodySvg}</g>\n${innerContent}`)

  const previewOutputPath = path.join(process.cwd(), 'public', item.previewAsset!)
  fs.mkdirSync(path.dirname(previewOutputPath), { recursive: true })
  fs.writeFileSync(previewOutputPath, preview, 'utf8')
}

// Generate UI icons in 512x512
const uiIcons: Record<string, string> = {
  qp: '<circle cx="256" cy="256" r="176" fill="#FFD84D" stroke="#1B132B" stroke-width="28"/><path d="M172 192 q84 -76 168 0 v120 q-84 76 -168 0 Z" fill="#FFF3A6" stroke="#1B132B" stroke-width="20"/><circle cx="288" cy="232" r="16" fill="#1B132B"/><path d="m340 264 62 26 -62 28" fill="#FF9B42" stroke="#1B132B" stroke-width="16"/>',
  shop: '<path d="M96 174 h320 l-28 224 H132 Z" fill="#61C9FF" stroke="#1B132B" stroke-width="28"/><path d="M158 192 V148 q0 -76 98 -76 t98 76 v44" stroke="#FFD84D" stroke-width="28"/><path d="M182 278 h148" stroke="#1B132B" stroke-width="24"/>',
  wardrobe: '<path d="M110 130 h292 v302 H110 Z" fill="#B99AFF" stroke="#1B132B" stroke-width="28"/><path d="M256 134 v296" stroke="#1B132B" stroke-width="20"/><circle cx="222" cy="286" r="14" fill="#FFD84D"/><circle cx="292" cy="286" r="14" fill="#FFD84D"/>',
  collection: '<path d="M96 88 h146 v332 H96 q-28 0 -28 -28 V116 q0 -28 28 -28 Z m174 0 h146 q28 0 28 28 v276 q0 28 -28 28 h-146 Z" fill="#58E6B0" stroke="#1B132B" stroke-width="24"/><path d="M256 96 v320" stroke="#1B132B" stroke-width="20"/>',
  gacha: '<path d="M126 184 q0 -110 130 -110 t130 110 v178 H126 Z" fill="#FF78A8" stroke="#1B132B" stroke-width="28"/><circle cx="256" cy="224" r="96" fill="#EAF8FF" stroke="#1B132B" stroke-width="20"/><path d="M206 224 q50 -54 100 0 -4 72 -50 72 t-50 -72 Z" fill="#FFD84D"/>',
  rare: '<path d="m256 52 50 126 136 10 -104 88 34 132 -116 -72 -116 72 34 -132 -104 -88 136 -10 Z" fill="#61C9FF" stroke="#1B132B" stroke-width="24"/>',
  legendary: '<path d="m90 152 86 62 80 -134 80 134 86 -62 -36 260 H126 Z" fill="#FFD84D" stroke="#1B132B" stroke-width="26"/><circle cx="256" cy="290" r="48" fill="#FF78A8"/>',
}
fs.mkdirSync(uiRoot, { recursive: true })
for (const [name, content] of Object.entries(uiIcons)) fs.writeFileSync(path.join(uiRoot, `${name}.svg`), frame(content), 'utf8')

console.log(`✓ Successfully generated ${COSMETIC_CATALOG.length} canonical 512x512 cosmetic SVGs in ${root}`)
