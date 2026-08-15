# Duck Avatar Art System & Canonical Modular Rig
*Dzịt Season 3 — Avatar Customization & Modular Cosmetic Architecture*

---

## 1. Vision & Core Philosophy

The goal of the **Dzịt Avatar System** is to provide a polished modular 2D game-avatar pipeline where cosmetics visually belong to the character rather than appearing as floating vector stickers.

### Visual DNA (Dzịt Identity)
- **Silhouette**: Chunky, rounded, pear-shaped body with a jaunty duck tail and large head.
- **Face & Eyes**: Large expressive eyes, slightly cocked head angle, confident/mischievous expression.
- **Beak & Feet**: Prominent curved orange beak, chunky paddle feet grounded with contact shadow.
- **Tone**: Cute, collectible, slightly chaotic game mascot (combining the appeal of collectible avatars with competitive arcade energy).

---

## 2. Canonical Coordinate Space & ViewBox

Every asset in the Dzịt ecosystem is authored and rendered in a single normalized coordinate space:

$$\mathbf{viewBox} = \begin{bmatrix} 0 & 0 & 512 & 512 \end{bmatrix}$$

### Global Dimensions
- **Canvas Size**: $512 \times 512\,\text{px}$
- **Ground Baseline ($Y_{\text{ground}}$)**: $436\,\text{px}$
- **Ground Contact Shadow**: Ellipse at $(X: 252, Y: 436, R_x: 170, R_y: 30)$, fill `#100A20`, opacity `0.28`.
- **Character Center**: $X = 256, Y = 274$

---

## 3. Semantic Anchor Rig Points

All cosmetics are positioned relative to explicit duck anatomy anchor coordinates derived from the canonical model:

| Anchor Key | Coordinate $(X, Y)$ | Description & Role |
| :--- | :--- | :--- |
| `HEAD_TOP` | $(330, 44)$ | Apex of crown, halos, tall antennas, floating icons |
| `HEAD_CENTER` | $(336, 144)$ | Center of skull volume for hats, caps, helmets, beanies |
| `EYE_LEFT` | $(320, 138)$ | Center of duck's left eye $(R_x: 42, R_y: 50)$ |
| `EYE_RIGHT` | $(382, 144)$ | Center of duck's right eye $(R_x: 32, R_y: 42)$ |
| `EYE_CENTER` | $(352, 140)$ | Midpoint between eyes for eyewear bridges, visors |
| `FACE_CENTER` | $(352, 160)$ | Cheeks, blush, whiskers, face paint |
| `BEAK_ROOT` | $(354, 186)$ | Base where beak meets the skull |
| `BEAK_CENTER` | $(386, 206)$ | Center of beak volume for food, masks, muzzles |
| `BEAK_TIP` | $(464, 214)$ | Tip of beak |
| `NECK` | $(256, 248)$ | Collar line, necklaces, scarves, ties, bowties |
| `CHEST_FRONT` | $(320, 310)$ | Medals, breast pockets, graphic logos, badges |
| `TORSO_CENTER` | $(248, 328)$ | Center of torso for shirts, jackets, armor, robes |
| `BACK_CENTER` | $(144, 286)$ | Attachment for backpacks, jetpacks, capes, wings |
| `TAIL_TIP` | $(84, 322)$ | Origin point for trails, wakes, sparks |
| `WING_FRONT` | $(170, 320)$ | Pivot for front wing sleeve and handheld props |
| `FEET_LEFT` | $(178, 402)$ | Left webbed foot anchor |
| `FEET_RIGHT` | $(238, 402)$ | Right webbed foot anchor |
| `FEET_CENTER` | $(248, 412)$ | Ground contact midpoint |
| `GROUND` | $(256, 436)$ | Base shadow and ground ripples |
| `PET_LEFT` | $(68, 370)$ | Trailing companion pet position |
| `PET_RIGHT` | $(436, 370)$ | Primary companion pet position (sitting beside duck) |
| `AURA_CENTER` | $(256, 274)$ | Center of aura orbit, halo rings, and particle emitters |

---

## 4. Stroke & Outline Standards

Consistency of outline weight is vital to make layered assets feel unified:
- **Major Outer Silhouette Stroke**: `14px`, stroke-linejoin `round`, stroke-linecap `round`.
- **Secondary Anatomy / Cut Lines**: `8px` to `10px`.
- **Fine Inner Details / Seams**: `4px` to `6px`.
- **Outline Color**: Dark Purple-Black `#1B132B` (preferred over flat black `#000000` for richer game aesthetic).

---

## 5. Three-Value Cartoon Shading Language

Every opaque cosmetic and body element must adhere to the 3-value shading principle:

```
+-------------------------------------------------------+
|  1. HIGHLIGHT (10-15% area) - Bright rim/specular      |
|  2. BASE      (55-65% area) - Dominant local color    |
|  3. SHADOW    (25-30% area) - Form occlusion shadow   |
+-------------------------------------------------------+
```

- **Light Source**: Directional sunlight coming from the **Top-Right** ($\approx 45^\circ$).
- **Highlights**: Large, intentional shapes on the upper-right skull, top of beak, and shoulder curvature.
- **Shadows**: Clean, graphic crescent shapes on lower-left belly, under-beak neck crease, and under-wing torso.

---

## 6. Palette Token Architecture

Colors are separated from surface Skins. The duck body is driven by semantic palette tokens:

```typescript
export interface DuckPaletteTokens {
  bodyBase: string
  bodyShadow: string
  bodyHighlight: string
  outline: string
  beakBase: string
  beakShadow: string
  beakHighlight: string
  feetBase: string
  feetShadow: string
  eyeWhite: string
  eyePupil: string
  eyeHighlight: string
  blush: string
}
```

### Standard Color Variants:
- **Sunshine**: `#FFD84D` / Shadow `#E5A812` / Highlight `#FFF1A8`
- **Tangerine**: `#FF9B42` / Shadow `#D96A14` / Highlight `#FFC58D`
- **Mint Splash**: `#58E6B0` / Shadow `#2BAF7D` / Highlight `#A3F7D5`
- **Sky Puddle**: `#61C9FF` / Shadow `#2596D4` / Highlight `#BBE8FF`
- **Lavender Quack**: `#B99AFF` / Shadow `#825AD9` / Highlight `#E4D7FF`
- **Rose Pop**: `#FF78A8` / Shadow `#D63F76` / Highlight `#FFBED6`
- **Cream Puff**: `#FFF0BD` / Shadow `#D8C27B` / Highlight `#FFFFFF`
- **Midnight Pond**: `#5965A8` / Shadow `#384279` / Highlight `#9AA4DB`
- **Cyber Cyan**: `#26E6E6` / Shadow `#0EA5A5` / Highlight `#A5FAFA`
- **Ruby**: `#EF4444` / Shadow `#B91C1C` / Highlight `#FCA5A5`
- **Emerald**: `#10B981` / Shadow `#047857` / Highlight `#6EE7B7`

---

## 7. Explicit Deterministic Render Stack

To prevent clipping and ensure accessories naturally interact with body parts, rendering uses explicit named layers:

```
[Layer 1]  AURA_BACK            - Ambient glow, background rings, backdrop runes
[Layer 2]  TRAIL_BACK           - Race wake, ripples, tail sparks (behind duck)
[Layer 3]  PET_BACK             - Flying/floating pet variations positioned behind
[Layer 4]  BACK_ACCESSORY       - Backpacks, wings, capes, jetpacks (behind torso)
[Layer 5]  HEADWEAR_BACK        - Back brims/ribbons of wide hats (e.g. wizard hat back)
[Layer 6]  BASE_DUCK_BODY       - Feet, belly, neck, skull geometry
[Layer 7]  SKIN_OVERLAY         - Galaxy texture, Zombie stitches, Kintsugi veins, Tiger stripes
[Layer 8]  BASE_DUCK_FACE       - Eyes, beak, blush, nostrils
[Layer 9]  CLOTHING_BACK        - Collar backs, hood interiors
[Layer 10] CLOTHING_BODY        - Shirts, jackets, robes, armor plates
[Layer 11] NECK_ACCESSORY       - Scarves, ties, bowties, medallions, lanyards
[Layer 12] FACE_ACCESSORY       - Sunglasses, monocles, goggles, laser visors, face masks
[Layer 13] HEADWEAR_FRONT       - Caps, beanies, crowns, helmets, front brims
[Layer 14] FRONT_WING           - Front wing (or clothed wing sleeve) over torso
[Layer 15] HAND_OR_WING_PROP    - Magic wand, coffee cup, racing flag, trophy
[Layer 16] PET_FRONT            - Companion pet sitting on ground beside duck
[Layer 17] AURA_FRONT           - Front sparkles, dynamic energy wisps, foreground particles
[Layer 18] FRONT_FX             - Race finish effects, splash bursts
[Layer 19] NAMEPLATE            - Floating character badge or pedestal plate
```

---

## 8. Cosmetic Design Rules & Anatomy Fitting

### 1. Headwear (`head`)
- Hats must sit firmly on the skull line `Y: 88..96` without floating.
- Forward visors (e.g. baseball caps) project forward over the brow line $(X: 344 \to 468, Y: 90 \to 100)$.
- Wide/Tall hats (e.g. Wizard Hat) split into `HEADWEAR_BACK` (back brim) and `HEADWEAR_FRONT` (cone and front brim) so the duck head sits inside the brim.

### 2. Clothing (`outfit`)
- Must follow the torso contour with an explicit collar line $(X: 220..310, Y: 250)$ and side hemline $(X: 84..390, Y: 400)$.
- Must include a defined wing sleeve/pauldron $(X: 136..240, Y: 304..360)$ so the duck's wing looks naturally clothed.

### 3. Face Accessories (`face`)
- Eyewear must align precisely with `EYE_LEFT` $(320, 138)$ and `EYE_RIGHT` $(382, 144)$.
- Frame bridge must cross above the beak $(X: 356, Y: 136)$.
- Glasses must preserve eye readability (semi-transparent lenses, styled frames, or expressive eye cuts).

### 4. Skins (`bodySkin`)
- Skins provide themed surface treatments across **Head, Face, Torso, and Tail**.
- High-priority skins:
  * **Galaxy**: Deep indigo/purple gradient, stardust clusters, nebula rim highlight.
  * **Zombie**: Patchwork mint skin, cartoon stitches, cute bandage on cheek.
  * **Lava**: Charcoal volcanic rock body with glowing magma cracks.
  * **Chrome**: Liquid silver metallic reflections, high-contrast curved speculars.
  * **Tiger**: Iconic three forehead stripes, cheek whiskers, wing bands.
  * **Gold Kintsugi**: Golden ceramic repair veins across skull and body.

### 5. Pets (`pet`)
- Placed on canonical baseline `Y: 370..410`, $X: 436$ (beside duck).
- Proportions: Roughly 25-30% of duck volume so the duck remains the primary hero.
- Idle motion: Smooth transform-based bobbing (`translateY(-6px)`).

### 6. Auras (`aura`)
- Multi-tier FX structure (`AURA_BACK`, `AURA_PARTICLES`, `AURA_FRONT`).
- Animations use GPU-accelerated CSS `transform` (rotate, scale, translate) and `opacity` for smooth 60fps rendering without CPU filter repaint bottlenecks.
- 12 Game-Inspired Dynamic Visual Concepts:
  1. **Thần Long Bao Thân (Astral Dragon Spirit)**: Celestial mythical dragon body winding from behind the duck to the front, with glowing whiskers, horns, fierce eyes, flaming dragon pearl, and rising embers.
  2. **Phật Quang Vạn Trượng (Sacred Buddha Lotus Mandala)**: Multi-ring sacred halo with 24 golden radiant sunbeam rays, rotating Dharmachakra wheel of light, and blooming golden lotus petals.
  3. **Lôi Thần Sấm Sét (Thunder God Lightning Tempest)**: Crackling jagged electric lightning arcs (cyan, magenta, yellow) zapping violently across dark purple storm plasma clouds.
  4. **Hàn Băng Cực Quang (Glacial Blizzard & Frost Aurora)**: Intricate spinning snowflake mandala behind the head, floating sharp diamond ice shards, and frost spikes rising from the ground.
  5. **Hỏa Diệm Sơn / Super Saiyan (Inferno Flame Burst)**: Multi-layer towering flame peaks (crimson red, blazing orange, golden white core) erupting upwards from the ground baseline with flying spark embers.
  6. **U Hồn Vạn Quỷ (Cursed Phantom Souls & Will-o'-the-Wisps)**: Haunting cute ghost spirits swirling around the duck with will-o'-the-wisp soul fire orbs in emerald green and spectral teal.
  7. **Cyber Matrix HUD (Tactical Hologram & Binary Data)**: Dual counter-rotating holographic tactical HUD rings, target angle brackets, and pulsing digital glitch data streams.
  8. **Hoa Khai Phú Quý (Sakura & Sacred Lotus Cyclone)**: Swirling floral wind vortex carrying glowing pink lotus and cherry blossom petals around a blooming lotus pedestal.
  9. **Cosmic Singularity (Deep Space Nebula & Galaxy Orbit)**: Tilted 3D planetary accretion rings with orbiting celestial moons, gas giants, and stardust constellation crosses.
  10. **Neon Disco Party (Concert Laser Spotlights & Equalizer)**: Sweeping multi-color concert stage lasers, pulsing audio equalizer bounce bars at baseline, and floating vivid neon musical notes.
  11. **Thủy Cung Thần Châu (Aquatic Tidal Wave & Pearl Ocean)**: Swirling ocean current vortex with rising hydrodynamic pearl bubbles and sea foam.
  12. **Kim Tiền Cát Tường (Golden Coin Shower & 4-Leaf Clovers)**: Rotating wealth ring of ancient gold coins with square holes and floating lucky four-leaf clovers.

---

## 9. Thumbnail & Closet Card Consistency

- Every preview card in Duck Closet and Duckdex uses the exact same:
  * Normalized ViewBox `0 0 512 512`.
  * Standardized duck silhouette underlay (opacity `0.35`).
  * Centered camera padding ($24\,\text{px}$).
  * Scoped SVG IDs (`id="cg-mask-${id}"`, `id="cg-filter-${id}"`) preventing SVG DOM namespace collisions.

---

## 10. Rarity Tier Visual Hierarchy & Anti-Inflation Rules

To prevent visual inflation and preserve player excitement for high-tier cosmetics, visual complexity is strictly gated across 5 rarity tiers:

| Tier | Visual Complexity | Geometry & Cut | FX & Shaders | Animation / Extra | Examples |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Common** (Gray / Green) | Clean, minimal, everyday relatable | 2 flat cartoon values, standard outlines | None (no glow, no filters) | Static | Plain White Tee, Red Race Cap, Beanie, Happy Beak, Water Ripples, Rubber Fish |
| **Uncommon** (Blue) | Thematic occupation or street accent | 2-3 values, 1 accent colorway/ribbon | Subtle gloss highlights | Static | Blue Bucket Hat, Monday Tie, Chef Hat, Pond Shades, Calico Cat |
| **Rare** (Purple) | Distinct stylized cut, culture/tech gear | Layered construction, custom badges/pouches | Metallic or enamel accents | Gentle bobbing/flow | Dev Hoodie, Cowboy Hat, Nón Lá, Lucky Áo Dài, Shiba Inu, Tiger Quack Skin |
| **Epic** (Pink) | High fantasy & sci-fi motifs | Multi-part silhouettes, specialized materials | Neon glows, glass dome reflections, energy lines | Keyframed pulse, glowing eyes | Wizard Hat, Cyber Mohawk, Space Suit, Baby Dragon, Dragon Scales Skin |
| **Legendary** (Gold) | God-tier / Mythic prestige | Ornate crowns, paladin plate, celestial relics | Glowing golden mandalas, kintsugi veins, multi-part aura | Dynamic multi-layer animations & particles | Diamond Crown, Quack Knight Armor, Kintsugi Gold Veins, Thần Long Aura, Phật Quang Mandala |

### Anti-Inflation Checklist:
1. **Never give glow filters (`feGaussianBlur`) to Common or Uncommon items.**
2. **Limit complex particle loops to Epic and Legendary auras/trails.**
3. **Keep everyday clothes (tees, hoodies, beanies) grounded so that armored and celestial items feel truly exceptional.**
4. **Preserve the core Dzịt duck silhouette across all items regardless of tier.**

