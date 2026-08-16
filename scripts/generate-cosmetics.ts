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

// -------------------------------------------------------------
// FINISH & NAMEPLATE
// -------------------------------------------------------------
function generateFinish(primary: string, secondary: string) {
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

function generateNameplate(primary: string, secondary: string) {
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
  else if (slot === 'finish') content = generateFinish(primary, secondary)
  else if (slot === 'nameplate') content = generateNameplate(primary, secondary)
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
