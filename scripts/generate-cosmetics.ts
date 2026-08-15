import fs from 'node:fs'
import path from 'node:path'
import { COSMETIC_CATALOG } from '../lib/cosmetics/catalog'
import type { CosmeticDefinition } from '../lib/cosmetics/types'

const root = path.join(process.cwd(), 'public', 'cosmetics', 'v1')
const previewRoot = path.join(process.cwd(), 'public', 'cosmetics', 'previews', 'v1')
const uiRoot = path.join(process.cwd(), 'public', 'cosmetics', 'ui')

function frame(content: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" fill="none">${content}</svg>\n`
}

function hash(value: string) {
  return [...value].reduce((total, char) => ((total * 31) + char.charCodeAt(0)) >>> 0, 7)
}

const palette = ['#FF5B67', '#61C9FF', '#58E6B0', '#B99AFF', '#FFD84D', '#FF78A8', '#8EE3F5', '#F08A5D', '#FFBE3D', '#38EF7D', '#11998E', '#EA384D', '#9333EA', '#06B6D4']

// Duck Base Body
function body(color = '#FFD84D') {
  return `<!-- Duck Base -->
  <path d="M47 161c-9-8-15-18-17-29 14 4 26 10 35 17" fill="${color}" stroke="#241A38" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M40 164c0-36 35-57 82-55 46 1 78 22 83 51 7 34-26 51-83 49-54-1-82-17-82-45Z" fill="${color}" stroke="#241A38" stroke-width="8" stroke-linejoin="round"/>
  <path d="M106 108c-5-31 7-63 33-79 27-17 59-8 75 15 18 25 10 59-10 78-22 22-59 27-83 9-8-6-13-14-15-23Z" fill="${color}" stroke="#241A38" stroke-width="8" stroke-linejoin="round"/>
  <path d="M68 158c16-20 45-25 69-12-7 25-38 39-66 29" fill="#FFFDF4" opacity=".24"/>
  <ellipse cx="191" cy="72" rx="16" ry="21" fill="#FFFDF4" stroke="#241A38" stroke-width="6"/>
  <ellipse cx="160" cy="69" rx="21" ry="25" fill="#FFFDF4" stroke="#241A38" stroke-width="6"/>
  <ellipse cx="165" cy="76" rx="5.5" ry="9" fill="#241A38"/>
  <ellipse cx="195" cy="78" rx="4.5" ry="8" fill="#241A38"/>
  <circle cx="163" cy="72" r="2.5" fill="#FFFDF4"/>
  <circle cx="194" cy="75" r="2" fill="#FFFDF4"/>
  <path d="M177 93c17-1 34 4 55 11 9 3 9 11 0 16-20 10-42 12-59 5-10-4-12-14-5-23 3-4 6-7 9-9Z" fill="#FF9B42" stroke="#241A38" stroke-width="7" stroke-linejoin="round"/>
  <path d="M171 115c19 5 39 3 60-5" stroke="#C95E24" stroke-width="4" stroke-linecap="round"/>
  <path d="M89 201c1 9-4 15-15 20 12 3 24 0 32-9m30-8c1 9-4 15-15 20 12 2 23 0 31-8" fill="none" stroke="#FF9B42" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`
}

// -------------------------------------------------------------
// HATS (Head Items)
// -------------------------------------------------------------
function generateHead(id: string, primary: string, secondary: string, seed: number) {
  if (id === 'head-cap-red' || id === 'head-captain-cap') {
    const isCapt = id === 'head-captain-cap'
    const capColor = isCapt ? '#0F172A' : '#FF4D5A'
    const visorColor = isCapt ? '#18181B' : '#D93444'
    return `<g>
      <path d="M118 48 C120 22, 155 14, 186 20 C202 24, 208 36, 206 48 Z" fill="${capColor}" stroke="#241A38" stroke-width="7" stroke-linejoin="round"/>
      ${isCapt ? '<path d="M125 44 C150 38, 185 38, 205 44" stroke="#FFD84D" stroke-width="5" fill="none"/><circle cx="164" cy="30" r="4.5" fill="#FFD84D"/>' : '<path d="M130 46 C135 28, 160 22, 185 24" stroke="#FFFDF4" stroke-width="4" stroke-linecap="round" fill="none"/>'}
      <path d="M172 45 C192 41, 222 43, 234 50 C220 57, 188 56, 170 51 Z" fill="${visorColor}" stroke="#241A38" stroke-width="7" stroke-linejoin="round"/>
      <circle cx="160" cy="18" r="5" fill="#FFFDF4" stroke="#241A38" stroke-width="3"/>
    </g>`
  }

  if (id === 'head-bucket-blue') {
    return `<g>
      <path d="M128 46 C130 24, 158 18, 185 20 C198 22, 203 34, 202 46 Z" fill="#61C9FF" stroke="#241A38" stroke-width="7" stroke-linejoin="round"/>
      <path d="M125 43 C148 37, 182 38, 204 44 L204 38 C182 32, 148 31, 125 37 Z" fill="#1C7ED6"/>
      <path d="M114 49 C144 38, 188 39, 218 50 C222 56, 196 60, 164 58 C132 56, 110 55, 114 49 Z" fill="#4DABF7" stroke="#241A38" stroke-width="7" stroke-linejoin="round"/>
    </g>`
  }

  if (id === 'head-tiny-crown' || id === 'head-diamond-crown' || id === 'head-galaxy-crown' || id === 'head-fish-crown') {
    const isDiamond = id === 'head-diamond-crown'
    const isGalaxy = id === 'head-galaxy-crown'
    const crownColor = isDiamond ? '#67E8F9' : isGalaxy ? '#C084FC' : '#FFD84D'
    const jewelColor = isDiamond ? '#FFFDF4' : isGalaxy ? '#38EF7D' : '#FF4D5A'
    return `<g transform="rotate(8 165 24)">
      <path d="M142 32 L146 6 L157 18 L168 2 L179 18 L190 6 L194 32 Z" fill="${crownColor}" stroke="#241A38" stroke-width="6" stroke-linejoin="round"/>
      <path d="M140 33 C156 28, 180 28, 196 33" stroke="#241A38" stroke-width="4" stroke-linecap="round"/>
      <circle cx="146" cy="7" r="3.5" fill="${jewelColor}"/>
      <circle cx="168" cy="3" r="4.5" fill="${jewelColor}"/>
      <circle cx="190" cy="7" r="3.5" fill="${jewelColor}"/>
      <circle cx="168" cy="22" r="3" fill="#FFFDF4"/>
    </g>`
  }

  if (id === 'head-cyber-mohawk') {
    return `<g>
      <defs>
        <filter id="mohawk-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <g fill="#FF007F" stroke="#241A38" stroke-width="5" stroke-linejoin="round" filter="url(#mohawk-glow)">
        <polygon points="120,44 116,14 134,36"/>
        <polygon points="132,36 132,4 152,28"/>
        <polygon points="148,28 156,-6 168,22"/>
        <polygon points="166,22 178,-4 186,22"/>
        <polygon points="184,22 200,6 198,34"/>
      </g>
      <path d="M125 48 C148 38, 185 38, 205 48" stroke="#00F2FE" stroke-width="7" stroke-linecap="round"/>
      <circle cx="132" cy="45" r="3" fill="#FFFDF4"/>
      <circle cx="198" cy="45" r="3" fill="#FFFDF4"/>
    </g>`
  }

  if (id === 'head-office-headset') {
    return `<g>
      <path d="M124 50 C128 14, 182 14, 198 50" stroke="#1E293B" stroke-width="8" stroke-linecap="round" fill="none"/>
      <path d="M124 50 C128 14, 182 14, 198 50" stroke="#64748B" stroke-width="4" stroke-linecap="round" fill="none"/>
      <rect x="116" y="44" width="14" height="22" rx="6" fill="#0F172A" stroke="#241A38" stroke-width="4"/>
      <rect x="192" y="44" width="14" height="22" rx="6" fill="#0F172A" stroke="#241A38" stroke-width="4"/>
      <path d="M198 55 C210 65, 212 85, 188 92" stroke="#475569" stroke-width="4" fill="none" stroke-linecap="round"/>
      <ellipse cx="186" cy="92" rx="6" ry="4" fill="#0F172A" stroke="#241A38" stroke-width="2"/>
      <circle cx="184" cy="91" r="1.5" fill="#EF4444"/>
    </g>`
  }

  if (id === 'head-space-dome') {
    return `<g>
      <ellipse cx="168" cy="60" rx="56" ry="50" fill="#61C9FF" fill-opacity="0.25" stroke="#38BDF8" stroke-width="5"/>
      <path d="M138 32 C155 20, 188 20, 204 32" stroke="#FFFDF4" stroke-width="5" stroke-linecap="round" opacity="0.8"/>
      <!-- Collar under chin -->
      <path d="M108 120 C140 134, 185 134, 212 120" stroke="#94A3B8" stroke-width="10" stroke-linecap="round"/>
      <path d="M108 120 C140 134, 185 134, 212 120" stroke="#241A38" stroke-width="4" fill="none"/>
    </g>`
  }

  if (id === 'head-bamboo-hat') {
    return `<g>
      <polygon points="98,50 164,10 230,50" fill="#F4E0A5" stroke="#241A38" stroke-width="7" stroke-linejoin="round"/>
      <line x1="164" y1="10" x2="164" y2="50" stroke="#D4B668" stroke-width="3.5"/>
      <path d="M118 40 C145 32, 185 32, 212 40" stroke="#D4B668" stroke-width="3.5" fill="none"/>
      <path d="M128 50 C122 75, 126 92, 142 98" stroke="#FF5B67" stroke-width="4" fill="none" stroke-linecap="round"/>
    </g>`
  }

  if (id === 'head-cat-ears') {
    return `<g>
      <path d="M125 44 C145 28, 185 30, 202 46" stroke="#241A38" stroke-width="6" fill="none"/>
      <path d="M126 38 L118 6 L145 22 Z" fill="#FFFDF4" stroke="#241A38" stroke-width="6" stroke-linejoin="round"/>
      <polygon points="126,30 122,12 140,22" fill="#FF78A8"/>
      <path d="M174 24 L196 6 L198 38 Z" fill="#FFFDF4" stroke="#241A38" stroke-width="6" stroke-linejoin="round"/>
      <polygon points="178,24 192,12 194,30" fill="#FF78A8"/>
    </g>`
  }

  if (id === 'head-chef-hat') {
    return `<g>
      <path d="M128 38 C108 28, 108 -2, 134 -4 C144 -16, 176 -16, 186 -4 C212 -2, 216 28, 198 38 Z" fill="#FFFDF4" stroke="#241A38" stroke-width="7" stroke-linejoin="round"/>
      <path d="M136 36 V12 M155 34 V6 M175 34 V8 M190 36 V15" stroke="#E2E8F0" stroke-width="4" stroke-linecap="round"/>
      <path d="M126 48 C150 40, 180 40, 202 48 L200 38 C180 32, 150 32, 126 38 Z" fill="#EDF2F7" stroke="#241A38" stroke-width="6"/>
    </g>`
  }

  if (id === 'head-wizard-hat') {
    return `<g>
      <path d="M110 50 C145 36, 190 38, 222 52 C210 58, 150 58, 110 50 Z" fill="#2B1D52" stroke="#241A38" stroke-width="7" stroke-linejoin="round"/>
      <path d="M132 46 C138 28, 140 10, 115 -6 C105 -12, 95 -8, 98 2 C105 15, 135 25, 188 44 Z" fill="#493282" stroke="#241A38" stroke-width="7" stroke-linejoin="round"/>
      <path d="M132 46 C155 40, 175 42, 190 46" stroke="#FFD84D" stroke-width="6"/>
      <polygon points="120,4 123,12 131,12 125,17 127,24 120,20 113,24 115,17 109,12 117,12" fill="#FFD84D"/>
    </g>`
  }

  if (id === 'head-dragon-horns') {
    return `<g>
      <path d="M134 38 C115 25, 95 5, 100 -12 C115 0, 135 15, 144 26 Z" fill="#EF4444" stroke="#241A38" stroke-width="6" stroke-linejoin="round"/>
      <path d="M178 26 C195 15, 218 0, 230 -12 C235 5, 215 25, 196 38 Z" fill="#EF4444" stroke="#241A38" stroke-width="6" stroke-linejoin="round"/>
      <path d="M108 -4 L122 14" stroke="#FFD84D" stroke-width="3" stroke-linecap="round"/>
      <path d="M222 -4 L208 14" stroke="#FFD84D" stroke-width="3" stroke-linecap="round"/>
    </g>`
  }

  if (id === 'head-cloud-halo') {
    return `<g>
      <defs>
        <filter id="halo-glow-head" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <ellipse cx="165" cy="8" rx="36" ry="10" fill="none" stroke="#FFD84D" stroke-width="8" filter="url(#halo-glow-head)"/>
      <ellipse cx="165" cy="8" rx="36" ry="10" fill="none" stroke="#FFFDF4" stroke-width="3"/>
      <circle cx="135" cy="6" r="2.5" fill="#FFFDF4"/>
      <circle cx="195" cy="10" r="2.5" fill="#FFFDF4"/>
    </g>`
  }

  if (id === 'head-cowboy-hat') {
    return `<g>
      <!-- Wide Creased Felt Hat -->
      <path d="M132 44 C132 20, 150 16, 164 24 C178 16, 196 20, 196 44 Z" fill="#92400E" stroke="#241A38" stroke-width="7" stroke-linejoin="round"/>
      <path d="M104 48 C125 38, 205 38, 226 48 C232 58, 198 58, 164 56 C130 58, 98 58, 104 48 Z" fill="#78350F" stroke="#241A38" stroke-width="7" stroke-linejoin="round"/>
      <path d="M128 44 C150 38, 180 38, 200 44" stroke="#FFD84D" stroke-width="4" fill="none"/>
    </g>`
  }

  if (id === 'head-propeller-cap') {
    return `<g>
      <!-- Multi-color panels -->
      <path d="M120 46 C122 22, 142 16, 160 16 C160 30, 140 44, 120 46 Z" fill="#EF4444" stroke="#241A38" stroke-width="6" stroke-linejoin="round"/>
      <path d="M160 16 C180 16, 202 24, 204 46 C184 44, 160 30, 160 16 Z" fill="#3B82F6" stroke="#241A38" stroke-width="6" stroke-linejoin="round"/>
      <!-- Spinning Propeller -->
      <ellipse cx="145" cy="10" rx="14" ry="4" fill="#EAB308" stroke="#241A38" stroke-width="3" transform="rotate(-15 145 10)"/>
      <ellipse cx="175" cy="10" rx="14" ry="4" fill="#EAB308" stroke="#241A38" stroke-width="3" transform="rotate(15 175 10)"/>
      <circle cx="160" cy="10" r="4" fill="#EF4444" stroke="#241A38" stroke-width="2"/>
    </g>`
  }

  // Tailored Hat Generator
  const hatHeight = 22 + (seed % 18)
  return `<g>
    <path d="M122 48 C124 ${48 - hatHeight}, 160 ${40 - hatHeight}, 190 ${42 - hatHeight} C204 ${44 - hatHeight / 2}, 208 36, 205 48 Z" fill="${primary}" stroke="#241A38" stroke-width="7" stroke-linejoin="round"/>
    <path d="M112 50 C144 40, 185 40, 218 50 C220 56, 196 60, 164 58 C132 56, 110 55, 112 50 Z" fill="${secondary}" stroke="#241A38" stroke-width="6" stroke-linejoin="round"/>
    <circle cx="164" cy="${48 - hatHeight / 2}" r="6" fill="#FFFDF4" stroke="#241A38" stroke-width="3"/>
  </g>`
}

// -------------------------------------------------------------
// OUTFITS (Tailored Clothes with Wing Sleeves)
// -------------------------------------------------------------
function generateOutfit(id: string, primary: string, secondary: string, seed: number) {
  if (id === 'outfit-tee-white') {
    return `<g>
      <path d="M42 163c0-27 22-46 57-52l12 15q19 17 43-1l17 3c19 8 30 19 34 33 7 33-26 50-83 48-53-1-80-18-80-46Z" fill="#FFFDF4" stroke="#241A38" stroke-width="8" stroke-linejoin="round"/>
      <path d="M111 126 C124 138, 142 138, 155 126" stroke="#CBD5E1" stroke-width="6" stroke-linecap="round" fill="none"/>
      <path d="M111 126 C124 138, 142 138, 155 126" stroke="#241A38" stroke-width="4" stroke-linecap="round" fill="none"/>
      <path d="M68 152 C82 142, 105 145, 120 162 C108 178, 80 182, 68 152 Z" fill="#F8FAFC" stroke="#241A38" stroke-width="5" stroke-linejoin="round"/>
      <path d="M78 162 C90 156, 105 158, 112 168" stroke="#CBD5E1" stroke-width="3.5" stroke-linecap="round" fill="none"/>
      <rect x="135" y="152" width="22" height="14" rx="3" fill="#EF4444" stroke="#241A38" stroke-width="2.5"/>
      <circle cx="146" cy="159" r="3" fill="#FFFDF4"/>
    </g>`
  }

  if (id === 'outfit-office-shirt' || id === 'outfit-office-tie') {
    return `<g>
      <path d="M42 163c0-27 22-46 57-52l12 15q19 17 43-1l17 3c19 8 30 19 34 33 7 33-26 50-83 48-53-1-80-18-80-46Z" fill="#E0F2FE" stroke="#241A38" stroke-width="8" stroke-linejoin="round"/>
      <path d="M68 152 C82 142, 105 145, 120 162 C108 178, 80 182, 68 152 Z" fill="#BAE6FD" stroke="#241A38" stroke-width="5" stroke-linejoin="round"/>
      <polygon points="110,125 126,142 138,126 150,142 164,125" fill="#FFFDF4" stroke="#241A38" stroke-width="5" stroke-linejoin="round"/>
      <polygon points="131,135 145,135 141,146 135,146" fill="#EF4444" stroke="#241A38" stroke-width="3"/>
      <polygon points="135,146 141,146 148,188 138,198 128,188" fill="#EF4444" stroke="#241A38" stroke-width="5" stroke-linejoin="round"/>
      <line x1="133" y1="162" x2="143" y2="162" stroke="#FFD84D" stroke-width="3.5" stroke-linecap="round"/>
      <rect x="148" y="150" width="16" height="18" rx="2" fill="#BAE6FD" stroke="#241A38" stroke-width="3"/>
      <line x1="153" y1="145" x2="153" y2="152" stroke="#1E293B" stroke-width="3" stroke-linecap="round"/>
    </g>`
  }

  if (id === 'outfit-dev-hoodie') {
    return `<g>
      <path d="M42 163c0-27 22-46 57-52l12 15q19 17 43-1l17 3c19 8 30 19 34 33 7 33-26 50-83 48-53-1-80-18-80-46Z" fill="#1E293B" stroke="#241A38" stroke-width="8" stroke-linejoin="round"/>
      <path d="M68 152 C82 142, 105 145, 120 162 C108 178, 80 182, 68 152 Z" fill="#0F172A" stroke="#241A38" stroke-width="5" stroke-linejoin="round"/>
      <path d="M106 122 C120 142, 150 142, 168 124" stroke="#334155" stroke-width="12" stroke-linecap="round"/>
      <path d="M106 122 C120 142, 150 142, 168 124" stroke="#241A38" stroke-width="5" stroke-linecap="round" fill="none"/>
      <line x1="126" y1="134" x2="124" y2="156" stroke="#FFFDF4" stroke-width="3.5" stroke-linecap="round"/>
      <line x1="146" y1="134" x2="148" y2="154" stroke="#FFFDF4" stroke-width="3.5" stroke-linecap="round"/>
      <text x="145" y="165" fill="#38EF7D" font-family="monospace" font-weight="900" font-size="13" text-anchor="middle">&lt;/&gt;</text>
      <path d="M125 175 H175 L168 198 H132 Z" fill="#0F172A" stroke="#241A38" stroke-width="5" stroke-linejoin="round"/>
    </g>`
  }

  if (id === 'outfit-racing-suit') {
    return `<g>
      <path d="M42 163c0-27 22-46 57-52l12 15q19 17 43-1l17 3c19 8 30 19 34 33 7 33-26 50-83 48-53-1-80-18-80-46Z" fill="#DC2626" stroke="#241A38" stroke-width="8" stroke-linejoin="round"/>
      <path d="M68 152 C82 142, 105 145, 120 162 C108 178, 80 182, 68 152 Z" fill="#991B1B" stroke="#241A38" stroke-width="5" stroke-linejoin="round"/>
      <path d="M128 126 L128 200" stroke="#FFFDF4" stroke-width="12"/>
      <rect x="122" y="132" width="6" height="8" fill="#18181B"/>
      <rect x="128" y="140" width="6" height="8" fill="#18181B"/>
      <rect x="122" y="148" width="6" height="8" fill="#18181B"/>
      <rect x="128" y="156" width="6" height="8" fill="#18181B"/>
      <rect x="122" y="164" width="6" height="8" fill="#18181B"/>
      <rect x="128" y="172" width="6" height="8" fill="#18181B"/>
      <circle cx="158" cy="158" r="12" fill="#FFFDF4" stroke="#241A38" stroke-width="3"/>
      <text x="158" y="163" fill="#DC2626" font-family="sans-serif" font-weight="900" font-size="11" text-anchor="middle">07</text>
    </g>`
  }

  if (id === 'outfit-lucky-ao-dai') {
    return `<g>
      <path d="M42 163c0-27 22-46 57-52l12 15q19 17 43-1l17 3c19 8 30 19 34 33 7 33-26 50-83 48-53-1-80-18-80-46Z" fill="#047857" stroke="#241A38" stroke-width="8" stroke-linejoin="round"/>
      <path d="M68 152 C82 142, 105 145, 120 162 C108 178, 80 182, 68 152 Z" fill="#065F46" stroke="#241A38" stroke-width="5" stroke-linejoin="round"/>
      <path d="M114 124 C132 135, 150 126, 162 122" stroke="#F59E0B" stroke-width="6" stroke-linecap="round"/>
      <circle cx="148" cy="126" r="3" fill="#FDE68A"/>
      <circle cx="156" cy="135" r="3" fill="#FDE68A"/>
      <circle cx="165" cy="145" r="3" fill="#FDE68A"/>
      <path d="M140 170 C140 155, 153 150, 153 150 C153 150, 166 155, 166 170 C159 175, 147 175, 140 170 Z" fill="#FDE68A" stroke="#241A38" stroke-width="2.5"/>
      <circle cx="153" cy="164" r="3" fill="#EF4444"/>
    </g>`
  }

  if (id === 'outfit-space-suit') {
    return `<g>
      <path d="M42 163c0-27 22-46 57-52l12 15q19 17 43-1l17 3c19 8 30 19 34 33 7 33-26 50-83 48-53-1-80-18-80-46Z" fill="#F8FAFC" stroke="#241A38" stroke-width="8" stroke-linejoin="round"/>
      <path d="M68 152 C82 142, 105 145, 120 162 C108 178, 80 182, 68 152 Z" fill="#E2E8F0" stroke="#241A38" stroke-width="5" stroke-linejoin="round"/>
      <rect x="125" y="145" width="44" height="34" rx="5" fill="#1E293B" stroke="#241A38" stroke-width="4"/>
      <circle cx="135" cy="155" r="3" fill="#38EF7D"/>
      <circle cx="146" cy="155" r="3" fill="#38EF7D"/>
      <circle cx="157" cy="155" r="3" fill="#EF4444"/>
      <line x1="132" y1="168" x2="160" y2="168" stroke="#38BDF8" stroke-width="3.5"/>
      <path d="M125 156 C105 160, 100 178, 115 188" stroke="#EF4444" stroke-width="5" fill="none" stroke-linecap="round"/>
      <path d="M169 156 C185 160, 190 178, 175 188" stroke="#3B82F6" stroke-width="5" fill="none" stroke-linecap="round"/>
    </g>`
  }

  if (id === 'outfit-quack-knight' || id === 'outfit-diamond-armor' || id === 'outfit-pixel-armor' || id === 'outfit-bamboo-armor') {
    return `<g>
      <path d="M42 163c0-27 22-46 57-52l12 15q19 17 43-1l17 3c19 8 30 19 34 33 7 33-26 50-83 48-53-1-80-18-80-46Z" fill="#94A3B8" stroke="#241A38" stroke-width="8" stroke-linejoin="round"/>
      <path d="M68 152 C82 142, 105 145, 120 162 C108 178, 80 182, 68 152 Z" fill="#64748B" stroke="#241A38" stroke-width="5" stroke-linejoin="round"/>
      <path d="M110 126 Q138 140 162 125" stroke="#FFD84D" stroke-width="6" fill="none"/>
      <polygon points="144,146 156,154 150,172 138,172 132,154" fill="#FFD84D" stroke="#241A38" stroke-width="3"/>
      <circle cx="128" cy="155" r="2.5" fill="#FFFDF4"/>
      <circle cx="162" cy="155" r="2.5" fill="#FFFDF4"/>
    </g>`
  }

  if (id === 'outfit-cyber-samurai' || id === 'outfit-neon-tracksuit') {
    return `<g>
      <path d="M42 163c0-27 22-46 57-52l12 15q19 17 43-1l17 3c19 8 30 19 34 33 7 33-26 50-83 48-53-1-80-18-80-46Z" fill="#0F172A" stroke="#241A38" stroke-width="8" stroke-linejoin="round"/>
      <path d="M68 152 C82 142, 105 145, 120 162 C108 178, 80 182, 68 152 Z" fill="#1E293B" stroke="#241A38" stroke-width="5" stroke-linejoin="round"/>
      <path d="M112 126 L138 152 L164 126" stroke="#00F2FE" stroke-width="5" stroke-linecap="round" fill="none"/>
      <circle cx="138" cy="152" r="5" fill="#00F2FE"/>
      <path d="M85 165 H125 L145 185 H175" stroke="#FF007F" stroke-width="4.5" fill="none" stroke-linecap="round"/>
    </g>`
  }

  if (id === 'outfit-golden-tux' || id === 'outfit-boss-blazer') {
    return `<g>
      <path d="M42 163c0-27 22-46 57-52l12 15q19 17 43-1l17 3c19 8 30 19 34 33 7 33-26 50-83 48-53-1-80-18-80-46Z" fill="#18181B" stroke="#241A38" stroke-width="8" stroke-linejoin="round"/>
      <path d="M68 152 C82 142, 105 145, 120 162 C108 178, 80 182, 68 152 Z" fill="#27272A" stroke="#241A38" stroke-width="5" stroke-linejoin="round"/>
      <polygon points="120,126 138,156 130,178 116,145" fill="#FFD84D" stroke="#241A38" stroke-width="4"/>
      <polygon points="162,126 146,156 154,178 168,145" fill="#FFD84D" stroke="#241A38" stroke-width="4"/>
      <polygon points="132,128 150,128 141,146" fill="#FFFDF4"/>
      <polygon points="135,132 147,132 141,137" fill="#EF4444" stroke="#241A38" stroke-width="2"/>
    </g>`
  }

  if (id === 'outfit-dragon-robe' || id === 'outfit-royal-mantle') {
    return `<g>
      <path d="M42 163c0-27 22-46 57-52l12 15q19 17 43-1l17 3c19 8 30 19 34 33 7 33-26 50-83 48-53-1-80-18-80-46Z" fill="#B91C1C" stroke="#241A38" stroke-width="8" stroke-linejoin="round"/>
      <path d="M68 152 C82 142, 105 145, 120 162 C108 178, 80 182, 68 152 Z" fill="#991B1B" stroke="#241A38" stroke-width="5" stroke-linejoin="round"/>
      <path d="M68 152 C82 142, 105 145, 120 162" stroke="#FFD84D" stroke-width="4" fill="none"/>
      <path d="M110 126 Q138 140 165 126" stroke="#FFD84D" stroke-width="8" stroke-linecap="round" fill="none"/>
      <circle cx="148" cy="156" r="6" fill="#FFD84D"/>
      <circle cx="148" cy="176" r="6" fill="#FFD84D"/>
    </g>`
  }

  // Bespoke Themed Outfit Generator
  return `<g>
    <path d="M42 163c0-27 22-46 57-52l12 15q19 17 43-1l17 3c19 8 30 19 34 33 7 33-26 50-83 48-53-1-80-18-80-46Z" fill="${primary}" stroke="#241A38" stroke-width="8" stroke-linejoin="round"/>
    <path d="M68 152 C82 142, 105 145, 120 162 C108 178, 80 182, 68 152 Z" fill="${secondary}" stroke="#241A38" stroke-width="5" stroke-linejoin="round"/>
    <path d="M110 126 Q138 140 165 126" stroke="${secondary}" stroke-width="8" stroke-linecap="round" fill="none"/>
    <path d="M110 126 Q138 140 165 126" stroke="#241A38" stroke-width="4" stroke-linecap="round" fill="none"/>
    <line x1="144" y1="136" x2="144" y2="198" stroke="${secondary}" stroke-width="6"/>
    <circle cx="152" cy="152" r="3.5" fill="#FFFDF4" stroke="#241A38" stroke-width="2"/>
    <circle cx="152" cy="172" r="3.5" fill="#FFFDF4" stroke="#241A38" stroke-width="2"/>
  </g>`
}

// -------------------------------------------------------------
// BODY SKINS (Visible on Head, Cheek, AND Body)
// -------------------------------------------------------------
function generateBodySkin(id: string, primary: string, secondary: string) {
  if (id === 'bodySkin-tiger-quack') {
    return `<g fill="#241A38">
      <path d="M136 34 Q146 38 156 30 L154 26 Q144 32 134 30 Z"/>
      <path d="M142 45 Q152 48 162 42 L160 38 Q150 44 140 42 Z"/>
      <path d="M148 56 Q158 58 168 52 L166 48 Q156 54 146 52 Z"/>
      <path d="M125 72 Q136 76 145 70 L144 66 Q134 72 124 68 Z"/>
      <path d="M122 84 Q132 88 142 82 L140 78 Q130 84 120 80 Z"/>
      <path d="M65 142 Q90 138 105 148 L102 154 Q85 144 62 148 Z"/>
      <path d="M75 165 Q105 158 128 170 L125 176 Q100 165 72 172 Z"/>
      <path d="M90 188 Q120 182 148 190 L146 195 Q115 188 88 194 Z"/>
    </g>`
  }

  if (id === 'bodySkin-dragon-scale') {
    return `<g>
      <g stroke="#C95E24" stroke-width="3" fill="none">
        <path d="M138 38 C144 44, 152 44, 158 38 C164 44, 172 44, 178 38"/>
        <path d="M144 48 C150 54, 158 54, 164 48"/>
      </g>
      <circle cx="148" cy="40" r="2.5" fill="#FFD84D"/>
      <circle cx="168" cy="40" r="2.5" fill="#FFD84D"/>
      <circle cx="154" cy="50" r="2.5" fill="#FFD84D"/>
      <g stroke="#C95E24" stroke-width="4" fill="none">
        <path d="M75 145 C80 152, 90 152, 95 145 C100 152, 110 152, 115 145"/>
        <path d="M85 160 C90 167, 100 167, 105 160 C110 167, 120 167, 125 160"/>
      </g>
      <circle cx="85" cy="148" r="2.5" fill="#FFD84D"/>
      <circle cx="105" cy="148" r="2.5" fill="#FFD84D"/>
      <circle cx="125" cy="148" r="2.5" fill="#FFD84D"/>
    </g>`
  }

  if (id === 'bodySkin-neon-scales' || id === 'bodySkin-circuit-feathers') {
    return `<g>
      <defs>
        <filter id="circuit-glow-head" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <g stroke="#00F2FE" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none" filter="url(#circuit-glow-head)">
        <path d="M135 45 H155 L165 35 H180"/>
        <path d="M128 65 H142 L150 55"/>
        <path d="M75 145 H105 L120 160 H155 L165 150"/>
        <path d="M85 165 H115 L125 175 H160"/>
      </g>
      <circle cx="180" cy="35" r="3" fill="#FF007F"/>
      <circle cx="150" cy="55" r="3" fill="#00F2FE"/>
      <circle cx="75" cy="145" r="3" fill="#00F2FE"/>
      <circle cx="165" cy="150" r="3" fill="#FF007F"/>
    </g>`
  }

  if (id === 'bodySkin-galaxy-dust' || id === 'bodySkin-star-freckles') {
    return `<g>
      <g fill="#FFFDF4">
        <path d="M134 68 Q138 68 138 64 Q138 68 142 68 Q138 68 138 72 Q138 68 134 68 Z"/>
        <path d="M148 52 Q151 52 151 49 Q151 52 154 52 Q151 52 151 55 Q151 52 148 52 Z"/>
        <path d="M120 152 Q126 152 126 146 Q126 152 132 152 Q126 152 126 158 Q126 152 120 152 Z"/>
      </g>
      <circle cx="128" cy="74" r="2.5" fill="#B99AFF"/>
      <circle cx="144" cy="78" r="2.5" fill="#61C9FF"/>
      <circle cx="138" cy="45" r="2.5" fill="#FF78A8"/>
      <circle cx="105" cy="148" r="3" fill="#B99AFF"/>
      <circle cx="138" cy="142" r="3" fill="#61C9FF"/>
    </g>`
  }

  if (id === 'bodySkin-lotus-speckles') {
    return `<g fill="#FF78A8" stroke="#241A38" stroke-width="2">
      <path d="M134 65 C130 55, 142 55, 144 65 C142 75, 130 75, 134 65 Z"/>
      <path d="M148 48 C144 38, 156 38, 158 48 C156 58, 144 58, 148 48 Z"/>
      <path d="M85 145 C80 135, 95 135, 98 145 C95 155, 80 155, 85 145 Z"/>
      <path d="M125 140 C120 130, 135 130, 138 140 C135 150, 120 150, 125 140 Z"/>
    </g>`
  }

  if (id === 'bodySkin-gold-veins') {
    return `<g stroke="#FFD84D" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" fill="none">
      <path d="M138 35 L146 45 L140 55 L152 65"/>
      <circle cx="146" cy="45" r="2" fill="#FFFDF4" stroke="none"/>
      <path d="M70 148 L95 155 L110 145 L135 160 L155 152"/>
    </g>`
  }

  if (id === 'bodySkin-storm-lines') {
    return `<g stroke="#FFD84D" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" fill="none">
      <path d="M136 45 L144 55 L138 60 L148 72"/>
      <path d="M75 145 L92 152 L85 160 L108 170 L100 176 L118 190"/>
    </g>`
  }

  if (id === 'bodySkin-koi-patches') {
    return `<g>
      <path d="M135 42 C130 32, 152 30, 162 38 C166 48, 148 54, 138 50 Z" fill="#EF4444" opacity="0.9"/>
      <path d="M125 68 C120 58, 138 56, 145 64 C148 72, 135 78, 128 74 Z" fill="#18181B" opacity="0.85"/>
      <path d="M70 148 C65 135, 95 132, 110 142 C115 155, 90 165, 75 160 Z" fill="#EF4444" opacity="0.9"/>
      <path d="M125 155 C120 142, 145 140, 160 148 C168 162, 145 172, 130 168 Z" fill="#18181B" opacity="0.85"/>
    </g>`
  }

  // Fallback Organic Cheek & Body Freckles
  return `<g fill="${primary}" stroke="#241A38" stroke-width="2">
    <circle cx="135" cy="58" r="4"/>
    <circle cx="145" cy="50" r="3.5"/>
    <circle cx="132" cy="72" r="3.5"/>
    <circle cx="85" cy="148" r="6"/>
    <circle cx="115" cy="142" r="5"/>
    <circle cx="145" cy="152" r="6"/>
  </g>`
}

// -------------------------------------------------------------
// AURAS (Animated SVG & Multi-layer Glowing Filters)
// -------------------------------------------------------------
function generateAura(id: string, primary: string, secondary: string) {
  if (id === 'aura-dragon-flame') {
    return `<g>
      <defs>
        <filter id="flame-glow-all" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="b1"/>
          <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="b2"/>
          <feMerge><feMergeNode in="b1"/><feMergeNode in="b2"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <style>
          @keyframes flame-rise-main {
            0%, 100% { transform: translateY(0) scale(1); opacity: 0.85; }
            50% { transform: translateY(-8px) scale(1.06); opacity: 1; }
          }
        </style>
      </defs>
      <g filter="url(#flame-glow-all)" style="animation: flame-rise-main 2s ease-in-out infinite" transform-origin="128 137">
        <path d="M50 160 C30 110, 60 70, 85 85 C95 50, 140 40, 155 70 C180 45, 220 70, 215 110 C235 140, 215 190, 185 200 C155 220, 85 220, 50 160 Z" fill="#FF5B00" opacity="0.35"/>
        <path d="M70 155 C55 120, 80 90, 100 100 C110 70, 145 65, 155 90 C175 75, 205 95, 200 125 C215 150, 195 185, 170 190 C145 205, 95 205, 70 155 Z" fill="#FFD84D" opacity="0.5"/>
      </g>
      <circle cx="65" cy="95" r="3.5" fill="#FFFDF4"/>
      <circle cx="195" cy="80" r="3" fill="#FFFDF4"/>
      <circle cx="210" cy="150" r="4" fill="#FFD84D"/>
      <circle cx="55" cy="170" r="3" fill="#FFD84D"/>
    </g>`
  }

  if (id === 'aura-fireflies') {
    return `<g>
      <defs>
        <filter id="firefly-glow-all" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <style>
          @keyframes firefly-twinkle-main {
            0%, 100% { opacity: 0.3; transform: translateY(0) scale(0.8); }
            50% { opacity: 1; transform: translateY(-6px) scale(1.2); }
          }
        </style>
      </defs>
      <g filter="url(#firefly-glow-all)">
        <circle cx="45" cy="110" r="5" fill="#38EF7D" style="animation: firefly-twinkle-main 1.8s infinite"/>
        <circle cx="75" cy="65" r="4.5" fill="#FFD84D" style="animation: firefly-twinkle-main 2.3s infinite 0.4s"/>
        <circle cx="128" cy="35" r="5.5" fill="#38EF7D" style="animation: firefly-twinkle-main 2.1s infinite 0.8s"/>
        <circle cx="185" cy="55" r="5" fill="#FFD84D" style="animation: firefly-twinkle-main 1.9s infinite 0.2s"/>
        <circle cx="218" cy="105" r="4.5" fill="#38EF7D" style="animation: firefly-twinkle-main 2.5s infinite 0.6s"/>
        <circle cx="225" cy="165" r="5" fill="#FFD84D" style="animation: firefly-twinkle-main 2.0s infinite 1.0s"/>
        <circle cx="55" cy="185" r="4" fill="#38EF7D" style="animation: firefly-twinkle-main 2.2s infinite 0.5s"/>
      </g>
    </g>`
  }

  if (id === 'aura-golden-rays') {
    return `<g>
      <defs>
        <filter id="gold-rays-glow-all" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <style>
          @keyframes rays-spin-main { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        </style>
      </defs>
      <g filter="url(#gold-rays-glow-all)" style="animation: rays-spin-main 16s linear infinite" transform-origin="128 137">
        ${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => {
          const angle = (i * 30 * Math.PI) / 180
          const x2 = 128 + Math.cos(angle) * 110
          const y2 = 137 + Math.sin(angle) * 110
          return `<line x1="128" y1="137" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#FFD84D" stroke-width="4" stroke-linecap="round" opacity="0.6"/>`
        }).join('')}
      </g>
      <circle cx="128" cy="137" r="95" stroke="#FFD84D" stroke-width="3" stroke-dasharray="8 6" fill="none" opacity="0.8"/>
    </g>`
  }

  if (id === 'aura-coffee-steam') {
    return `<g>
      <defs>
        <style>
          @keyframes steam-rise {
            0%, 100% { transform: translateY(0) scale(0.95); opacity: 0.4; }
            50% { transform: translateY(-10px) scale(1.05); opacity: 0.85; }
          }
        </style>
      </defs>
      <g stroke="#BAE6FD" stroke-width="4.5" stroke-linecap="round" fill="none" opacity="0.75" style="animation: steam-rise 2.5s ease-in-out infinite">
        <path d="M65 140 Q55 100 70 70 Q80 40 68 20"/>
        <path d="M195 130 Q210 95 195 65 Q185 35 200 15"/>
        <path d="M128 50 Q118 30 130 10"/>
      </g>
      <ellipse cx="60" cy="80" rx="5" ry="3.5" fill="#78350F" transform="rotate(-20 60 80)"/>
      <ellipse cx="205" cy="75" rx="5" ry="3.5" fill="#78350F" transform="rotate(25 205 75)"/>
    </g>`
  }

  if (id === 'aura-neon-glitch' || id === 'aura-pixel-orbit') {
    return `<g>
      <defs>
        <filter id="neon-glow-all" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <style>@keyframes orbit-spin-all { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }</style>
      </defs>
      <g filter="url(#neon-glow-all)">
        <ellipse cx="128" cy="137" rx="98" ry="78" stroke="#00F2FE" stroke-width="4" stroke-dasharray="16 10" fill="none" opacity="0.85"/>
        <g style="animation: orbit-spin-all 6s linear infinite" transform-origin="128 137">
          <rect x="220" y="132" width="10" height="10" fill="#FF007F"/>
          <rect x="26" y="132" width="10" height="10" fill="#00F2FE"/>
          <rect x="123" y="50" width="10" height="10" fill="#FF007F"/>
          <rect x="123" y="214" width="10" height="10" fill="#00F2FE"/>
        </g>
      </g>
    </g>`
  }

  // Glowing Dynamic Orbit Aura Fallback
  return `<g>
    <defs>
      <filter id="aura-glow-dyn-${hash(id)}" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
      <style>@keyframes aura-spin-dyn-${hash(id)} { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }</style>
    </defs>
    <g filter="url(#aura-glow-dyn-${hash(id)})">
      <ellipse cx="128" cy="137" rx="96" ry="80" stroke="${primary}" stroke-width="3.5" stroke-dasharray="10 8" fill="none" opacity="0.75"/>
      <g style="animation: aura-spin-dyn-${hash(id)} 8s linear infinite" transform-origin="128 137">
        ${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
          const angle = (i * 45 * Math.PI) / 180
          const cx = 128 + Math.cos(angle) * 96
          const cy = 137 + Math.sin(angle) * 80
          return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="5.5" fill="${i % 2 === 0 ? primary : secondary}" stroke="#FFFDF4" stroke-width="1.5"/>`
        }).join('')}
      </g>
    </g>
  </g>`
}

// -------------------------------------------------------------
// FACE (Glasses, Visors, Expressive Features)
// Left eye: (160, 69), Right eye: (191, 72), Beak: (177, 93)
// -------------------------------------------------------------
function generateFace(id: string, primary: string) {
  if (id === 'face-shades' || id === 'face-disco-shades') {
    return `<g>
      <path d="M144 60 H178 C178 78, 172 86, 158 86 C146 86, 144 78, 144 60 Z" fill="#18181B" stroke="#00F2FE" stroke-width="4.5" stroke-linejoin="round"/>
      <path d="M182 62 H208 C208 78, 204 84, 196 84 C186 84, 182 78, 182 62 Z" fill="#18181B" stroke="#00F2FE" stroke-width="4.5" stroke-linejoin="round"/>
      <line x1="178" y1="64" x2="182" y2="64" stroke="#00F2FE" stroke-width="5"/>
      <line x1="148" y1="66" x2="160" y2="62" stroke="#FFFDF4" stroke-width="3.5" stroke-linecap="round"/>
      <line x1="186" y1="68" x2="196" y2="64" stroke="#FFFDF4" stroke-width="3" stroke-linecap="round"/>
    </g>`
  }

  if (id === 'face-office-burnout' || id === 'face-monday-face' || id === 'face-sleepy-eyes') {
    return `<g>
      <ellipse cx="160" cy="84" rx="16" ry="6" fill="#7C3AED" opacity="0.45"/>
      <ellipse cx="192" cy="86" rx="14" ry="5" fill="#7C3AED" opacity="0.45"/>
      <path d="M145 68 Q160 78 175 68" stroke="#241A38" stroke-width="5" stroke-linecap="round" fill="none"/>
      <path d="M180 72 Q192 80 204 72" stroke="#241A38" stroke-width="4.5" stroke-linecap="round" fill="none"/>
      <path d="M138 60 C138 56, 144 56, 144 60 C144 64, 138 64, 138 60 Z" fill="#60A5FA"/>
    </g>`
  }

  if (id === 'face-laser-visor' || id === 'face-cyber-scan' || id === 'face-space-visor') {
    return `<g>
      <defs>
        <filter id="visor-glow-all" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <path d="M140 64 C165 58, 195 60, 212 68 L210 78 C195 72, 165 70, 140 76 Z" fill="#EF4444" stroke="#241A38" stroke-width="4" stroke-linejoin="round" filter="url(#visor-glow-all)"/>
      <line x1="145" y1="70" x2="206" y2="72" stroke="#FFFDF4" stroke-width="2.5" stroke-linecap="round"/>
    </g>`
  }

  if (id === 'face-pixel-eyes') {
    return `<g fill="#18181B">
      <rect x="144" y="64" width="8" height="6"/>
      <rect x="152" y="64" width="8" height="6"/>
      <rect x="160" y="64" width="8" height="6"/>
      <rect x="168" y="64" width="8" height="6"/>
      <rect x="152" y="70" width="8" height="8"/>
      <rect x="160" y="70" width="8" height="8"/>
      <rect x="176" y="64" width="6" height="4"/>
      <rect x="182" y="66" width="8" height="6"/>
      <rect x="190" y="66" width="8" height="6"/>
      <rect x="198" y="66" width="8" height="6"/>
      <rect x="186" y="72" width="8" height="8"/>
      <rect x="194" y="72" width="8" height="8"/>
      <rect x="154" y="66" width="3" height="3" fill="#FFFDF4"/>
      <rect x="188" y="68" width="3" height="3" fill="#FFFDF4"/>
    </g>`
  }

  if (id === 'face-happy' || id === 'face-victory-wink') {
    return `<g>
      <circle cx="152" cy="94" r="6.5" fill="#FF78A8" opacity="0.85"/>
      <circle cx="200" cy="96" r="5.5" fill="#FF78A8" opacity="0.85"/>
      <path d="M152 68 Q162 60 172 68" stroke="#241A38" stroke-width="5" stroke-linecap="round" fill="none"/>
      <path d="M184 72 Q192 65 200 72" stroke="#241A38" stroke-width="4.5" stroke-linecap="round" fill="none"/>
    </g>`
  }

  return `<g>
    <ellipse cx="160" cy="70" rx="18" ry="14" fill="${primary}" fill-opacity="0.35" stroke="#241A38" stroke-width="4"/>
    <ellipse cx="192" cy="73" rx="14" ry="12" fill="${primary}" fill-opacity="0.35" stroke="#241A38" stroke-width="4"/>
    <line x1="178" y1="71" x2="182" y2="71" stroke="#241A38" stroke-width="5"/>
  </g>`
}

// -------------------------------------------------------------
// PETS (Shiba, Corgi, Cats, Dragons, Capybaras)
// -------------------------------------------------------------
function generatePet(id: string, primary: string, secondary: string) {
  const wrapper = (content: string) => `<g>
    <defs>
      <style>
        @keyframes pet-bob-main {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-5px); }
        }
      </style>
    </defs>
    <g style="animation: pet-bob-main 2.2s ease-in-out infinite">
      ${content}
    </g>
  </g>`

  if (id === 'pet-shiba-dog' || id === 'pet-shiba-inu') {
    return wrapper(`<!-- Shiba Inu -->
      <ellipse cx="216" cy="190" rx="20" ry="17" fill="#F59E0B" stroke="#241A38" stroke-width="5"/>
      <path d="M234 184 C242 178, 246 168, 238 164 C232 166, 230 174, 232 182" fill="#F59E0B" stroke="#241A38" stroke-width="4"/>
      <ellipse cx="210" cy="195" rx="12" ry="9" fill="#FFFDF4"/>
      <circle cx="214" cy="174" r="15" fill="#F59E0B" stroke="#241A38" stroke-width="5"/>
      <ellipse cx="214" cy="179" rx="8" ry="6" fill="#FFFDF4"/>
      <polygon points="202,166 200,150 212,160" fill="#F59E0B" stroke="#241A38" stroke-width="4" stroke-linejoin="round"/>
      <polygon points="204,164 202,154 210,161" fill="#FF78A8"/>
      <polygon points="222,160 230,150 228,166" fill="#F59E0B" stroke="#241A38" stroke-width="4" stroke-linejoin="round"/>
      <polygon points="223,161 228,154 226,164" fill="#FF78A8"/>
      <circle cx="208" cy="173" r="2.5" fill="#241A38"/>
      <circle cx="220" cy="173" r="2.5" fill="#241A38"/>
      <polygon points="214,177 212,175 216,175" fill="#241A38"/>
      <circle cx="204" cy="178" r="2" fill="#FF78A8" opacity="0.6"/>
      <circle cx="224" cy="178" r="2" fill="#FF78A8" opacity="0.6"/>
      <path d="M204 186 Q214 190 224 186" stroke="#EF4444" stroke-width="4" stroke-linecap="round"/>
      <circle cx="214" cy="189" r="2.5" fill="#FFD84D"/>`)
  }

  if (id === 'pet-corgi-pup') {
    return wrapper(`<!-- Corgi Pup -->
      <ellipse cx="216" cy="192" rx="21" ry="16" fill="#D97706" stroke="#241A38" stroke-width="5"/>
      <ellipse cx="212" cy="196" rx="12" ry="8" fill="#FFFDF4"/>
      <circle cx="214" cy="174" r="16" fill="#D97706" stroke="#241A38" stroke-width="5"/>
      <polygon points="214,160 211,178 217,178" fill="#FFFDF4"/>
      <ellipse cx="198" cy="160" rx="7" ry="14" fill="#D97706" stroke="#241A38" stroke-width="4" transform="rotate(-25 198 160)"/>
      <ellipse cx="198" cy="160" rx="4" ry="10" fill="#FF78A8" transform="rotate(-25 198 160)"/>
      <ellipse cx="230" cy="160" rx="7" ry="14" fill="#D97706" stroke="#241A38" stroke-width="4" transform="rotate(25 230 160)"/>
      <ellipse cx="230" cy="160" rx="4" ry="10" fill="#FF78A8" transform="rotate(25 230 160)"/>
      <circle cx="208" cy="174" r="2.5" fill="#241A38"/>
      <circle cx="220" cy="174" r="2.5" fill="#241A38"/>
      <circle cx="214" cy="178" r="2.5" fill="#241A38"/>
      <path d="M214 180 Q214 186 217 186 Q219 186 218 180 Z" fill="#FF78A8"/>`)
  }

  if (id === 'pet-calico-cat' || id === 'pet-lucky-black-cat' || id === 'pet-cloud-cat') {
    const isBlack = id === 'pet-lucky-black-cat'
    const isCloud = id === 'pet-cloud-cat'
    const catColor = isBlack ? '#18181B' : '#FFFDF4'
    const eyeColor = isBlack ? '#FFD84D' : '#241A38'

    return wrapper(`<!-- Cat Pet -->
      ${isCloud ? '<ellipse cx="216" cy="202" rx="24" ry="8" fill="#BAE6FD" opacity="0.8"/>' : ''}
      <ellipse cx="216" cy="190" rx="18" ry="16" fill="${catColor}" stroke="#241A38" stroke-width="5"/>
      <path d="M232 188 C242 182, 246 170, 240 165 C236 168, 234 178, 230 186" fill="none" stroke="#241A38" stroke-width="4" stroke-linecap="round"/>
      ${!isBlack && !isCloud ? '<ellipse cx="224" cy="186" rx="7" ry="6" fill="#F59E0B"/><ellipse cx="210" cy="196" rx="6" ry="5" fill="#18181B"/>' : ''}
      <circle cx="214" cy="174" r="14" fill="${catColor}" stroke="#241A38" stroke-width="5"/>
      <polygon points="202,168 200,152 212,162" fill="${catColor}" stroke="#241A38" stroke-width="4" stroke-linejoin="round"/>
      <polygon points="204,166 202,156 210,163" fill="#FF78A8"/>
      <polygon points="220,162 228,152 226,168" fill="${catColor}" stroke="#241A38" stroke-width="4" stroke-linejoin="round"/>
      <polygon points="221,163 226,156 224,166" fill="#FF78A8"/>
      <circle cx="208" cy="174" r="2.5" fill="${eyeColor}"/>
      <circle cx="220" cy="174" r="2.5" fill="${eyeColor}"/>
      <polygon points="214,178 212,176 216,176" fill="#FF78A8"/>
      <line x1="198" y1="176" x2="204" y2="176" stroke="#241A38" stroke-width="2"/>
      <line x1="224" y1="176" x2="230" y2="176" stroke="#241A38" stroke-width="2"/>
      <path d="M206 186 Q214 189 222 186" stroke="#EF4444" stroke-width="3.5" stroke-linecap="round"/>
      <circle cx="214" cy="188" r="3" fill="#FFD84D" stroke="#241A38" stroke-width="1.5"/>`)
  }

  if (id === 'pet-mini-capybara') {
    return wrapper(`<!-- Capybara -->
      <ellipse cx="216" cy="190" rx="22" ry="17" fill="#854D0E" stroke="#241A38" stroke-width="5"/>
      <path d="M200 178 C200 168, 226 168, 228 178 L228 188 C228 194, 200 194, 200 188 Z" fill="#713F12" stroke="#241A38" stroke-width="5"/>
      <line x1="204" y1="176" x2="210" y2="176" stroke="#241A38" stroke-width="3" stroke-linecap="round"/>
      <line x1="218" y1="176" x2="224" y2="176" stroke="#241A38" stroke-width="3" stroke-linecap="round"/>
      <circle cx="211" cy="188" r="1.5" fill="#241A38"/>
      <circle cx="217" cy="188" r="1.5" fill="#241A38"/>
      <circle cx="214" cy="162" r="6" fill="#F59E0B" stroke="#241A38" stroke-width="3"/>
      <circle cx="214" cy="157" r="1.5" fill="#22C55E"/>`)
  }

  if (id === 'pet-baby-dragon') {
    return wrapper(`<!-- Baby Dragon -->
      <ellipse cx="216" cy="190" rx="19" ry="16" fill="#10B981" stroke="#241A38" stroke-width="5"/>
      <path d="M228 180 C238 168, 245 175, 235 188 Z" fill="#34D399" stroke="#241A38" stroke-width="3"/>
      <circle cx="212" cy="172" r="14" fill="#10B981" stroke="#241A38" stroke-width="5"/>
      <polygon points="204,164 200,152 210,160" fill="#FFD84D" stroke="#241A38" stroke-width="3"/>
      <polygon points="218,160 224,152 222,164" fill="#FFD84D" stroke="#241A38" stroke-width="3"/>
      <circle cx="206" cy="172" r="2.5" fill="#241A38"/>
      <circle cx="218" cy="172" r="2.5" fill="#241A38"/>
      <circle cx="200" cy="178" r="3" fill="#EF4444" opacity="0.8"/>`)
  }

  if (id === 'pet-tiny-drone') {
    return wrapper(`<!-- Cyber Drone -->
      <ellipse cx="216" cy="182" rx="18" ry="12" fill="#F8FAFC" stroke="#241A38" stroke-width="4"/>
      <circle cx="216" cy="182" r="6" fill="#00F2FE" stroke="#241A38" stroke-width="2"/>
      <line x1="194" y1="174" x2="204" y2="174" stroke="#64748B" stroke-width="3"/>
      <ellipse cx="198" cy="172" rx="10" ry="2" fill="#94A3B8"/>
      <line x1="228" y1="174" x2="238" y2="174" stroke="#64748B" stroke-width="3"/>
      <ellipse cx="234" cy="172" rx="10" ry="2" fill="#94A3B8"/>
      <path d="M206 194 L216 204 L226 194" stroke="#00F2FE" stroke-width="3" fill="none" opacity="0.6"/>`)
  }

  if (id === 'pet-moon-rabbit') {
    return wrapper(`<!-- Moon Rabbit -->
      <ellipse cx="216" cy="192" rx="17" ry="15" fill="#FFFDF4" stroke="#241A38" stroke-width="4"/>
      <ellipse cx="208" cy="164" rx="5" ry="14" fill="#FFFDF4" stroke="#241A38" stroke-width="3.5" transform="rotate(-15 208 164)"/>
      <ellipse cx="208" cy="164" rx="2.5" ry="9" fill="#FF78A8" transform="rotate(-15 208 164)"/>
      <ellipse cx="222" cy="164" rx="5" ry="14" fill="#FFFDF4" stroke="#241A38" stroke-width="3.5" transform="rotate(15 222 164)"/>
      <ellipse cx="222" cy="164" rx="2.5" ry="9" fill="#FF78A8" transform="rotate(15 222 164)"/>
      <circle cx="210" cy="182" r="2" fill="#241A38"/>
      <circle cx="220" cy="182" r="2" fill="#241A38"/>
      <polygon points="215,185 213,184 217,184" fill="#FF78A8"/>`)
  }

  // Cute Companion Creature Fallback
  return wrapper(`<!-- Cute Creature -->
    <ellipse cx="216" cy="188" rx="19" ry="16" fill="${primary}" stroke="#241A38" stroke-width="5"/>
    <polygon points="204,168 200,154 212,164" fill="${secondary}" stroke="#241A38" stroke-width="3.5" stroke-linejoin="round"/>
    <polygon points="220,164 228,154 226,168" fill="${secondary}" stroke="#241A38" stroke-width="3.5" stroke-linejoin="round"/>
    <circle cx="208" cy="182" r="3" fill="#241A38"/>
    <circle cx="222" cy="182" r="3" fill="#241A38"/>
    <circle cx="209" cy="181" r="1" fill="#FFFDF4"/>
    <circle cx="223" cy="181" r="1" fill="#FFFDF4"/>
    <circle cx="204" cy="188" r="2" fill="#FF78A8" opacity="0.6"/>
    <circle cx="226" cy="188" r="2" fill="#FF78A8" opacity="0.6"/>`)
}

// -------------------------------------------------------------
// TRAILS (Water Ripples, Neon Dash, Fire Sparks)
// -------------------------------------------------------------
function generateTrail(id: string, primary: string) {
  if (id === 'trail-ripples') {
    return `<g>
      <defs>
        <style>@keyframes ripple-flow-main { 0% { stroke-dashoffset: 0; } 100% { stroke-dashoffset: -36; } }</style>
      </defs>
      <g stroke="#61C9FF" stroke-width="7" stroke-linecap="round" fill="none" opacity="0.85" style="animation: ripple-flow-main 1.5s linear infinite">
        <path d="M15 200 C38 186, 75 188, 95 204" stroke-dasharray="16 10"/>
        <path d="M8 214 C36 198, 85 202, 110 218" stroke-dasharray="20 12"/>
        <path d="M22 228 C45 216, 78 218, 98 230" stroke-dasharray="14 8"/>
      </g>
      <circle cx="18" cy="192" r="3" fill="#BAE6FD"/>
      <circle cx="35" cy="184" r="2.5" fill="#BAE6FD"/>
    </g>`
  }

  if (id === 'trail-neon-wake' || id === 'trail-pixel-stream') {
    return `<g>
      <defs>
        <filter id="trail-neon-glow-all" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <style>@keyframes speed-dash-main { 0% { stroke-dashoffset: 0; } 100% { stroke-dashoffset: -40; } }</style>
      </defs>
      <g filter="url(#trail-neon-glow-all)" stroke="#00F2FE" stroke-width="6" stroke-linecap="round" fill="none" style="animation: speed-dash-main 0.8s linear infinite">
        <line x1="8" y1="195" x2="88" y2="195" stroke-dasharray="18 12"/>
        <line x1="4" y1="210" x2="104" y2="210" stroke-dasharray="24 14" stroke="#FF007F"/>
        <line x1="16" y1="225" x2="92" y2="225" stroke-dasharray="16 10"/>
      </g>
    </g>`
  }

  if (id === 'trail-dragon-sparks') {
    return `<g>
      <defs>
        <filter id="fire-glow-trail" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <g filter="url(#fire-glow-trail)">
        <path d="M12 205 Q55 190 92 208" stroke="#FF5B00" stroke-width="10" stroke-linecap="round" fill="none"/>
        <path d="M22 215 Q60 205 85 218" stroke="#FFD84D" stroke-width="6" stroke-linecap="round" fill="none"/>
        <circle cx="25" cy="192" r="3.5" fill="#FFFDF4"/>
        <circle cx="45" cy="186" r="3" fill="#FFD84D"/>
        <circle cx="15" cy="218" r="3" fill="#FF5B00"/>
      </g>
    </g>`
  }

  // Speed Flow Fallback
  return `<g>
    <defs>
      <style>@keyframes stream-flow-dyn { 0% { stroke-dashoffset: 0; } 100% { stroke-dashoffset: -32; } }</style>
    </defs>
    <g stroke="${primary}" stroke-width="7" stroke-linecap="round" fill="none" opacity="0.8" style="animation: stream-flow-dyn 1.4s linear infinite">
      <path d="M12 198 Q50 185 88 202" stroke-dasharray="16 10"/>
      <path d="M6 212 Q55 200 98 216" stroke-dasharray="20 12"/>
      <path d="M20 226 Q55 215 85 228" stroke-dasharray="14 8"/>
    </g>
  </g>`
}

// -------------------------------------------------------------
// NECK
// -------------------------------------------------------------
function generateNeck(id: string, primary: string) {
  if (id === 'neck-red-scarf') {
    return `<g>
      <path d="M106 122 C125 138, 155 134, 168 122 L164 135 C150 148, 120 148, 104 132 Z" fill="#EF4444" stroke="#241A38" stroke-width="6" stroke-linejoin="round"/>
      <path d="M132 136 L122 175 L138 178 L146 138 Z" fill="#DC2626" stroke="#241A38" stroke-width="5" stroke-linejoin="round"/>
      <line x1="124" y1="172" x2="136" y2="175" stroke="#FFD84D" stroke-width="3"/>
    </g>`
  }

  if (id === 'neck-golden-bow') {
    return `<g>
      <polygon points="126,128 140,135 126,142" fill="#FFD84D" stroke="#241A38" stroke-width="4"/>
      <polygon points="154,128 140,135 154,142" fill="#FFD84D" stroke="#241A38" stroke-width="4"/>
      <circle cx="140" cy="135" r="4.5" fill="#10B981" stroke="#241A38" stroke-width="3"/>
    </g>`
  }

  return `<g>
    <path d="M106 122 Q138 140 166 122" stroke="${primary}" stroke-width="8" stroke-linecap="round"/>
    <path d="M106 122 Q138 140 166 122" stroke="#241A38" stroke-width="4" stroke-linecap="round" fill="none"/>
  </g>`
}

// -------------------------------------------------------------
// BACK
// -------------------------------------------------------------
function generateBack(id: string, primary: string) {
  if (id === 'back-dragon-wings') {
    return `<g>
      <path d="M78 140 C55 110, 30 115, 20 135 C35 142, 50 148, 55 162 C40 160, 28 168, 30 178 C50 178, 68 165, 80 152 Z" fill="#EF4444" stroke="#241A38" stroke-width="6" stroke-linejoin="round"/>
      <path d="M78 140 C50 120, 25 125, 20 135" stroke="#FFD84D" stroke-width="4" fill="none"/>
    </g>`
  }

  if (id === 'back-jetpack' || id === 'back-rocket-pack') {
    return `<g>
      <rect x="48" y="125" width="22" height="42" rx="6" fill="#CBD5E1" stroke="#241A38" stroke-width="5"/>
      <path d="M52 167 L46 188 L72 188 L66 167 Z" fill="#FF5B00" stroke="#241A38" stroke-width="4"/>
      <polygon points="52,188 59,202 66,188" fill="#FFD84D"/>
    </g>`
  }

  return `<g>
    <path d="M80 135 C50 115, 25 125, 22 145 C38 152, 55 158, 60 170 C48 168, 35 174, 38 182 C55 182, 72 168, 82 150 Z" fill="${primary}" stroke="#241A38" stroke-width="6" stroke-linejoin="round"/>
  </g>`
}

// -------------------------------------------------------------
// FINISH
// -------------------------------------------------------------
function generateFinish(primary: string, secondary: string) {
  return `<g>
    ${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
      const angle = (i * 45 * Math.PI) / 180
      const x1 = 128 + Math.cos(angle) * 55
      const y1 = 128 + Math.sin(angle) * 55
      const x2 = 128 + Math.cos(angle) * 95
      const y2 = 128 + Math.sin(angle) * 95
      return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${i % 2 === 0 ? primary : secondary}" stroke-width="6" stroke-linecap="round"/>`
    }).join('')}
    <circle cx="128" cy="128" r="18" fill="#FFD84D" stroke="#241A38" stroke-width="4"/>
  </g>`
}

// -------------------------------------------------------------
// NAMEPLATE
// -------------------------------------------------------------
function generateNameplate(primary: string, secondary: string) {
  return `<g>
    <path d="M52 215 C100 226, 156 226, 204 215 L196 242 C152 248, 104 248, 60 242 Z" fill="${primary}" stroke="#241A38" stroke-width="6" stroke-linejoin="round"/>
    <circle cx="72" cy="229" r="4.5" fill="${secondary}"/>
    <circle cx="184" cy="229" r="4.5" fill="${secondary}"/>
  </g>`
}

// Master Asset Resolver
function assetFor(item: CosmeticDefinition): string {
  const { id, slot, color } = item
  if (slot === 'bodyColor') return frame(body(color ?? '#FFD84D'))

  const seed = hash(id)
  const primary = palette[seed % palette.length]!
  const secondary = palette[(seed + 4) % palette.length]!

  let content = ''
  if (slot === 'head') content = generateHead(id, primary, secondary, seed)
  else if (slot === 'outfit') content = generateOutfit(id, primary, secondary, seed)
  else if (slot === 'bodySkin') content = generateBodySkin(id, primary, secondary)
  else if (slot === 'aura') content = generateAura(id, primary, secondary)
  else if (slot === 'pet') content = generatePet(id, primary, secondary)
  else if (slot === 'trail') content = generateTrail(id, primary)
  else if (slot === 'face') content = generateFace(id, primary)
  else if (slot === 'neck') content = generateNeck(id, primary)
  else if (slot === 'back') content = generateBack(id, primary)
  else if (slot === 'finish') content = generateFinish(primary, secondary)
  else if (slot === 'nameplate') content = generateNameplate(primary, secondary)
  else throw new Error(`Unknown slot: ${slot}`)

  return frame(content)
}

// Generate all cosmetic assets and previews
console.log(`Generating ${COSMETIC_CATALOG.length} cosmetics...`)

for (const item of COSMETIC_CATALOG) {
  const outputPath = path.join(process.cwd(), 'public', item.asset)
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  const asset = assetFor(item)
  fs.writeFileSync(outputPath, asset, 'utf8')

  const innerContent = asset.slice(asset.indexOf('>') + 1).replace('</svg>', '').trim()
  const preview = item.slot === 'bodyColor'
    ? asset
    : frame(`<g opacity="0.38">${body('#FFD84D')}</g>\n${innerContent}`)

  const previewOutputPath = path.join(process.cwd(), 'public', item.previewAsset!)
  fs.mkdirSync(path.dirname(previewOutputPath), { recursive: true })
  fs.writeFileSync(previewOutputPath, preview, 'utf8')
}

// Generate UI icons
const uiIcons: Record<string, string> = {
  qp: '<circle cx="128" cy="128" r="88" fill="#FFD84D" stroke="#241A38" stroke-width="14"/><path d="M86 96q42-38 84 0v60q-42 38-84 0Z" fill="#FFF3A6" stroke="#241A38" stroke-width="10"/><circle cx="144" cy="116" r="8" fill="#241A38"/><path d="m170 132 31 13-31 14" fill="#FF9B42" stroke="#241A38" stroke-width="8"/>',
  shop: '<path d="M48 87h160l-14 112H66Z" fill="#61C9FF" stroke="#241A38" stroke-width="14"/><path d="M79 96V74q0-38 49-38t49 38v22" stroke="#FFD84D" stroke-width="14"/><path d="M91 139h74" stroke="#241A38" stroke-width="12"/>',
  wardrobe: '<path d="M55 65h146v151H55Z" fill="#B99AFF" stroke="#241A38" stroke-width="14"/><path d="M128 67v148" stroke="#241A38" stroke-width="10"/><circle cx="111" cy="143" r="7" fill="#FFD84D"/><circle cx="146" cy="143" r="7" fill="#FFD84D"/>',
  collection: '<path d="M48 44h73v166H48q-14 0-14-14V58q0-14 14-14Zm87 0h73q14 0 14 14v138q0 14-14 14h-73Z" fill="#58E6B0" stroke="#241A38" stroke-width="12"/><path d="M128 48v160" stroke="#241A38" stroke-width="10"/>',
  gacha: '<path d="M63 92q0-55 65-55t65 55v89H63Z" fill="#FF78A8" stroke="#241A38" stroke-width="14"/><circle cx="128" cy="112" r="48" fill="#EAF8FF" stroke="#241A38" stroke-width="10"/><path d="M103 112q25-27 50 0-2 36-25 36t-25-36Z" fill="#FFD84D"/>',
  rare: '<path d="m128 26 25 63 68 5-52 44 17 66-58-36-58 36 17-66-52-44 68-5Z" fill="#61C9FF" stroke="#241A38" stroke-width="12"/>',
  legendary: '<path d="m45 76 43 31 40-67 40 67 43-31-18 130H63Z" fill="#FFD84D" stroke="#241A38" stroke-width="13"/><circle cx="128" cy="145" r="24" fill="#FF78A8"/>',
}
fs.mkdirSync(uiRoot, { recursive: true })
for (const [name, content] of Object.entries(uiIcons)) fs.writeFileSync(path.join(uiRoot, `${name}.svg`), frame(content), 'utf8')

console.log(`✓ Successfully generated ${COSMETIC_CATALOG.length} cosmetic SVGs in ${root}`)
