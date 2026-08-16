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

## 2. Core Visual Hierarchy Rule

At all times and across all cosmetic combinations (especially at small thumbnail sizes like $72\times72$ to $96\times96\,\text{px}$), the avatar must strictly follow this visual hierarchy:

$$\mathbf{FACE} > \mathbf{HERO\ COSMETIC} > \mathbf{BODY / CLOTHING} > \mathbf{AURA} > \mathbf{PET} > \mathbf{TRAIL}$$

### The 1-Second Readability Test
> **At $96\times96\,\text{px}$, the viewer must identify the duck's eye expression and beak in under 1 second.** Only after recognizing the face should the viewer register the thematic role (e.g., "Ah, this is Cyber / Emperor / Astronaut").

---

## 3. Face Safe Zone (`FACE_SAFE_ZONE`)

To guarantee immediate eye contact and facial readability, a dedicated rectangular clearance zone is enforced:

$$\mathbf{FACE\_SAFE\_ZONE} = [X_1: 270, Y_1: 90] \to [X_2: 430, Y_2: 240]$$

```
+-------------------------------------------------------------+
|                     (330, 44) HEAD_TOP                      |
|                                                             |
|           + - - - - - - - - - - - - - - - - - - +           |
|           |        FACE_SAFE_ZONE               |           |
|           |  (320, 138)       (382, 144)        |           |
|           |   Left Eye         Right Eye        |           |
|           |                                     |           |
|           |         (386, 206)                  |           |
|           |          Beak Area                  |           |
|           + - - - - - - - - - - - - - - - - - - +           |
|                                                             |
|                    (248, 328) TORSO                         |
+-------------------------------------------------------------+
```

### Face Safe Zone Rules:
1. **No background shapes, heavy particle emitters, or high-contrast aura geometry may cross through the Face Safe Zone.**
2. **Face cosmetics** (glasses, visors, blush, eyebags) must accentuate or frame the eyes without obliterating the pupils or creating visual clutter.
3. **Headwear brims** (caps, bucket hats, helmets) must stay above $Y = 116$ at the eye baseline so the eyes remain fully visible.
4. **Body skins & tattoos** in the face region must use subtle tinting (opacity $\le 0.45$) rather than opaque high-contrast patterns.

---

## 4. Canonical Coordinate Space & ViewBox

Every asset in the Dzịt ecosystem is authored and rendered in a single normalized coordinate space:

$$\mathbf{viewBox} = \begin{bmatrix} 0 & 0 & 512 & 512 \end{bmatrix}$$

### Global Dimensions
- **Canvas Size**: $512 \times 512\,\text{px}$
- **Ground Baseline ($Y_{\text{ground}}$)**: $436\,\text{px}$
- **Ground Contact Shadow**: Ellipse at $(X: 252, Y: 436, R_x: 170, R_y: 30)$, fill `#100A20`, opacity `0.28`.
- **Character Center**: $X = 256, Y = 274$

---

## 5. Semantic Anchor Rig Points

All cosmetics are positioned relative to explicit duck anatomy anchor coordinates:

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

## 6. Standardized Stroke Hierarchy Tokens

To ensure all assets look like they were drawn by a **single cohesive artist**, arbitrary stroke widths are replaced with strict discrete tokens:

```typescript
export const STROKE_TOKENS = {
  OUTLINE_MAJOR: 14, // Outer silhouette of duck & primary wearables
  OUTLINE_MINOR: 8,  // Secondary anatomy, internal cuts, collars, pet boundaries
  DETAIL: 4,         // Seams, fabric folds, stitches, button details, gloss cuts
  COLOR: '#1B132B',  // Unified Dark Purple-Black outline color
} as const
```

---

## 7. Shading Language & Rarity Discipline

Every asset must obey the 3-value shading language with directional lighting from the **Top-Right** ($\approx 45^\circ$). Visual techniques are strictly gated by rarity tier to avoid aesthetic power creep:

```
+-------------------------------------------------------+
|  1. HIGHLIGHT (10-15% area) - Bright rim/specular      |
|  2. BASE      (55-65% area) - Dominant local color    |
|  3. SHADOW    (25-30% area) - Form occlusion shadow   |
+-------------------------------------------------------+
```

| Tier | Geometry & Style | Shading Language | Special Shaders / FX |
| :--- | :--- | :--- | :--- |
| **Common** | Everyday, grounded, minimal cuts | 2 flat cartoon values | **None** (No glow, no blur) |
| **Uncommon** | Themed occupational accents, ribbons | 2-3 values, crisp highlights | Subtle gloss speculars |
| **Rare** | Stylized cultural & tech silhouettes | 3 values, custom badges & layers | Metallic or enamel sheen |
| **Epic** | Multi-part sci-fi & fantasy armor | 3 values + energy accents | Glow filters (`feGaussianBlur`), neon lines |
| **Legendary** | God-tier mythic, crowns, celestial gear | 3 values + emissive details | Multi-layer animations, gold Kintsugi, galaxy dust |

---

## 8. Disciplined Theme Palette Budget

Each theme or fantasy collection must adhere to a strict **5-token palette budget** to prevent "random RGB gamer gear" visual noise:

$$\mathbf{Theme\ Palette} = \{ \text{PRIMARY}, \text{SECONDARY}, \text{ACCENT}, \text{NEUTRAL}, \text{FX} \}$$

### Core Showcase Palettes:
1. **Royal Emperor**:
   - `PRIMARY`: Sunshine Gold (`#FFD84D`)
   - `SECONDARY`: Royal Navy (`#1E293B`)
   - `ACCENT`: Imperial Crimson (`#EF4444`)
   - `NEUTRAL`: Slate Dark (`#0F172A`)
   - `FX`: Golden Mandala Glow (`#FDE047`)
2. **Viet Duck**:
   - `PRIMARY`: Jade Mint (`#58E6B0`)
   - `SECONDARY`: Bamboo Straw (`#F4E0A5`)
   - `ACCENT`: Lotus Rose (`#FF78A8`)
   - `NEUTRAL`: Deep Forest Green (`#065F46`)
   - `FX`: Lotus Petal Breeze (`#FDA4AF`)
3. **Cyber Duck**:
   - `PRIMARY`: Cyber Cyan (`#00F2FE`)
   - `SECONDARY`: Deep Midnight (`#0B0F19`)
   - `ACCENT`: Neon Magenta (`#FF007F`)
   - `NEUTRAL`: Dark Indigo (`#1E1B4B`)
   - `FX`: Hologram HUD Cyan/Pink Glow (`#38BDF8`)
4. **Dragon King**:
   - `PRIMARY`: Ruby Crimson (`#DC2626`)
   - `SECONDARY`: Charcoal Red (`#7F1D1D`)
   - `ACCENT`: Emperor Gold (`#FFD84D`)
   - `NEUTRAL`: Ink Purple (`#1B132B`)
   - `FX`: Blazing Dragon Flame (`#F59E0B`)
5. **Space Voyager**:
   - `PRIMARY`: Cosmic Slate (`#39406E`)
   - `SECONDARY`: Spacecraft White (`#F8FAFC`)
   - `ACCENT`: Starlight Cyan (`#38BDF8`)
   - `NEUTRAL`: Deep Void (`#0F172A`)
   - `FX`: Nebula Purple / Comet Gold (`#C084FC`)

---

## 9. Pet Visual Contract

Companion pets must be charming sidekicks that never compete with or overpower the hero duck:

1. **Volume & Scale Contract**:
   - **Normal Pet**: $18\% - 28\%$ of duck volume.
   - **Large Pet**: Maximum $35\%$ of duck volume.
2. **Anchor Position**: Ground contact baseline $(X: 436, Y: 370..400)$.
3. **Contrast Discipline**: Pets must have slightly softer contrast and saturation than the duck's face to ensure the viewer's focal point remains on the duck.
4. **Stroke Hierarchy**: Outlines use `OUTLINE_MINOR` ($8\,\text{px}$) and details use `DETAIL` ($4\,\text{px}$).

---

## 10. Aura Visual Budget & Silhouette Clearance Gap

Auras must provide rich environmental atmosphere without swallowing the duck in visual noise:

| Aura Tier | Visual Budget & Rules |
| :--- | :--- |
| **Common** | 2–4 subtle floating particles or ambient ripples. |
| **Rare** | Small subtle halo or thin concentric ring with $\le 0.65$ opacity. |
| **Epic** | Halo ring + gentle orbiting particles + front ground accent. |
| **Legendary** | Grand thematic motif (Astral Dragon, Sacred Mandala, Blizzard) with an explicit **Silhouette Clearance Gap** ($0.25..0.40$ center opacity) behind the duck body. |

---

## 11. Deterministic Multi-Layer Render Stacking

Cosmetics render in strict z-order to guarantee deterministic layering and occlusion:

| Render Step | Z-Index | Layer Slot | Role & Content |
| :--- | :--- | :--- | :--- |
| 1 | `10` | `nameplate` | Base pedestal / nameplate under the duck |
| 2 | `20` | `aura` (Back) | Background halo, dragon coils, mandala rays, storm clouds |
| 3 | `30` | `trail` | Water ripples, speed wakes, fire sparks behind tail tip |
| 4 | `40` | `back` | Backpacks, jetpacks, capes, dragon wings |
| 5 | `50` | `bodyColor` | Base duck body (feet, tail, torso, head, beak, eyes) |
| 6 | `60` | `bodySkin` | Surface textures, tattoos, stripes, circuits, scales |
| 7 | `70` | `outfit` | Shirts, hoodies, suits, robes, armor |
| 8 | `80` | `neck` | Scarves, ties, necklaces, bowties |
| 9 | `90` | `face` | Eyewear, sunglasses, laser visors, blush, masks |
| 10 | `100` | `head` | Hats, crowns, helmets, beanies, antennas |
| 11 | `110` | `pet` | Companion pets beside the duck |
| 12 | `120` | `finish` | Foreground celebratory fireworks and finish effects |

---

## 12. Dual QA Testing Protocol

To prevent regressions and ensure both artistic cohesion and modular compatibility, two separate testing environments are maintained:

1. **Artistic Showcase (`/dev/avatar-showcase`)**:
   - Curated full fantasy builds (Royal Emperor, Viet Duck, Cyber Duck, Dragon King, Space Voyager, etc.).
   - Multi-scale readability checks ($72\,\text{px}$ Thumbnail, $140\,\text{px}$ Card, $280\,\text{px}$ Hero).
   - Dynamic 12-Aura visual showcase.

2. **Systemic Compatibility Matrix (`/dev/avatar-compatibility`)**:
   - Isolated single-slot compatibility checks (`Base + Hat`, `Base + Face`, `Base + Outfit`).
   - Cross-slot interaction matrix (`Hat + Face`, `Outfit + Neck`, `Large Hat + Aura`, `Skin + Hat`).
   - Verifies anchor alignment, occlusion cleanliness, and zero unwanted overlaps across unexpected mix-and-match pairs.
