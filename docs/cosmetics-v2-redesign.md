# Duck Closet v2 — cosmetic redesign plan

Status: implemented 2026-10-05 · Owner: web · Replaces the v1 generated catalog (391 items)

## 1. Why v1 feels cheap

Audit of `public/cosmetics/v1` rendered per slot (2026-10-05):

| Problem | Evidence |
|---|---|
| Filler art | `generateHead` has ~28 bespoke branches for 61 hats; the other ~33 fall back to the same tinted baseball cap. ~40 of 53 outfits are the same torso blob recolored. Only 13 of 24 trail SVGs are unique. Skins are 3–5 dots. |
| Rarity is noise | `generatedRarity(index)` assigns rarity by list position: Diamond Crown = common, Golden Tux = common, Corgi Pup = legendary. Colors come from `hash(id)`, so "Golden" items can be teal. |
| Doesn't fit the duck | Overlays never clip to the body, so skins/outfits float. Pets are ~5% of duck volume (contract says 18–28%). Hex fallback palette in `getDuckPalette` gives every non-canonical color a yellow shadow. |
| Muddy thumbnails | Closet previews draw the base duck at 32% opacity, so every tile reads as an olive duck with a small sticker. Items are never shown on the player's own duck. |
| Names over-promise | Riot/Reddit-branded lines (KDA, Star Guardian, Arcane, PROJECT, Poro, Pengu, Snoo) render as generic shapes and carry trademark risk. |
| Unwearable drops | `neck`, `back`, `finish`, `nameplate` are shop/gacha-eligible but have no closet tab. |

## 2. Principles

1. **Every item is drawn once, on purpose.** No fallback branch, no hash-picked colors. The validator fails if two items in a slot produce the same SVG after stripping colors (catches recolor filler).
2. **Rarity = art budget**, set by hand per item:

   | Tier | Budget |
   |---|---|
   | Common | One clear silhouette, 2 values (base + shadow), no gradients. Everyday/funny. |
   | Uncommon | + highlight + one material detail (stitching, print, ribbon). |
   | Rare | Multi-part build, material sheen gradient (metal, enamel, glass), secondary accent. |
   | Epic | Layered set-piece + emissive glow and/or idle animation. |
   | Legendary | Unique silhouette readable at 72px, multi-layer animation, part of a matching set. |
3. **Fits the duck.** Skins and outfits clip to the shared body/head paths exported from `avatar-rig.ts`. Shadow and highlight are derived from each color in HSL, never hardcoded. Hats sit on the skull line and stay above eye level. Pets hit 18–28% volume at `PET_RIGHT`.
4. **Original collections only**: Pond Basics, Office Survivors, Street Duck, Viet Duck, Cyber Quack, Cosmic Pond, Pond Royalty, Spirit Lotus, Food Fight.
5. **Previews show your duck.** Closet tiles render the item on the player's current appearance at full opacity, framed per tab (Nón zooms on the head, Áo on the torso). Static previews (shop, Duckdex) use the same per-slot crop on a full-opacity Sunshine duck.

## 3. Curated catalog — 122 items

Kept v1 IDs are marked ✓, which avoids migration for them. Rarity totals: C 38 · U 32 · R 26 · E 18 · L 8. This covers the shop pool minimums (6/6/6/3/2).

### Màu (bodyColor) — 16
- **C**: Sunshine ✓, Tangerine ✓, Mint Splash ✓, Sky Puddle ✓, Rose Pop ✓, Cream Puff ✓
- **U**: Lavender Quack ✓, Midnight Pond ✓, Matcha Latte (cream belly two-tone), Coral Reef
- **R**: Mallard (green head, chestnut chest, grey body), Pearl (iridescent sheen), Ink Duck (black with white belly)
- **E**: Sunset Ombre (magenta→orange body gradient), Cyber Chrome (chrome reflection bands)
- **L**: Golden Duck (metallic gold, animated glints) — Pond Royalty set

### Skin (bodySkin) — 14
- **C**: Cheek Freckles, Racing Stripes, Polka Pond, Band-Aid Hero
- **U**: Tiger Quack ✓, Cow Spots, Koi Patches ✓, Street Camo
- **R**: "MẸ" Sailor Tattoo, Circuit Feathers ✓ (glowing traces), Star Constellations ✓
- **E**: Dragon Scale ✓ (full scale tiling and belly plates), Kintsugi Porcelain ✓ (kept the `bodySkin-gold-veins` ID; white glaze, gold cracks)
- **L**: Galaxy Body (animated nebula clipped to the silhouette) — Cosmic Pond set

### Mặt (face) — 16
- **C**: Happy Beak ✓, Sleepy Eyes ✓, Angry Brows ✓, Tiny Moustache ✓, Monday Face ✓ (eye bags)
- **U**: Pond Shades ✓, Nerd Glasses (taped), Heart Eyes ✓, Bandit Mask, Swim Goggles ✓
- **R**: Monocle ✓ (gold chain), Aviators (gradient lenses), Pixel Shades ✓
- **E**: Laser Visor ✓ (animated scanline), Kitsune Half Mask
- **L**: Cosmic Eyes (galaxy irises, star pupils, glow) — Cosmic Pond set

### Nón (head) — 22
- **C**: Red Race Cap ✓, Blue Bucket Hat ✓, Beanie ✓, Party Cone ✓, Traffic Cone ✓, Paper Boat ✓, Sweatband
- **U**: Tiny Crown ✓, Chef Hat ✓, Office Headset ✓, Cat Ears ✓, Nón Lá ✓ (was Bamboo Hat), Frog Hood ✓
- **R**: Cowboy Hat ✓, Wizard Hat ✓, Viking Horns ✓, Nón Bảo Hiểm ✓ (was Motorbike Helmet), Phở Bowl ✓ (noodles, chopsticks, steam)
- **E**: Space Dome ✓ (glass reflection, antenna light), Cyber Mohawk ✓ (neon glow), Dragon Horns ✓ (gold tips)
- **L**: Dragon Emperor Crown (jewels, dragon crest, animated glint) — Pond Royalty set

### Áo (outfit) — 20
- **C**: Clean White Tee ✓, Monday Tie ✓, Pajamas ✓, Sailor Shirt ✓, Football Jersey ✓, Chef Apron ✓
- **U**: Pond Raincoat ✓, Dev Hoodie ✓, Pond Lifeguard ✓, Biker Vest ✓, Detective Coat ✓
- **R**: Lucky Áo Dài ✓, Racing Suit ✓, Boss Blazer ✓, Space Suit ✓, Wizard Robe ✓
- **E**: Quack Knight ✓ (plate armor), Cyber Samurai ✓ (neon seams), Spirit Haori
- **L**: Dragon Robe ✓ (gold-embroidered long bào, animated shimmer) — Pond Royalty set

### Pet — 14
- **C**: Rubber Duckling, Origami Frog ✓, Office Mouse ✓, Bread Pigeon ✓
- **U**: Shiba Inu ✓, Calico Cat ✓, Mini Capybara ✓ (yuzu hat), Cà Phê Slime ✓ (was Coffee Slime)
- **R**: Tiny Drone ✓ (spinning rotors), Golden Carp ✓ (floating koi), Lucky Black Cat ✓ (waving paw)
- **E**: Baby Dragon ✓ (flapping, ember), Neon Jellyfish ✓ (pulse float)
- **L**: Moon Rabbit ✓ (sits on a floating crescent with a star lantern) — Spirit Lotus set

### Aura — 10
- **C**: Pond Fireflies ✓, Coffee Steam ✓, Bubble Halo ✓
- **U**: Lucky Leaves ✓, Lotus Breeze ✓
- **R**: Storm Cloud ✓, Neon Glitch ✓
- **E**: Golden Rays ✓ (rotating), Ghost Fog ✓ (orbiting wisps)
- **L**: Dragon Flame ✓ (coiled dragon behind the duck, animated flame, face-safe gap)

### Trail — 10
- **C**: Fresh Ripples ✓, Bubble Wake ✓, Paper Boats ✓
- **U**: Lotus Petals ✓, Coffee Spill ✓
- **R**: Neon Wake ✓, Pixel Stream ✓
- **E**: Rainbow Wake ✓, Dragon Sparks ✓
- **L**: Golden Wake ✓ (was Golden Water: liquid gold with coins)

Starter grants are unchanged. Every ID in `STARTER_COSMETIC_IDS` survives.

## 4. Retired items and migration

- `neck`, `back`, `finish`, `nameplate` leave the catalog. The slot columns stay in the schema for later.
- App migration `2026-10-05-001-cosmetics-v2-catalog` runs idempotently, in one transaction per player:
  1. Retired owned ID with an explicit equivalent (e.g. `head-bamboo-hat` keeps its ID; `body-snoo-cosmic-abyss` → `body-ink`) → grant the equivalent.
  2. Otherwise refund `SHOP_PRICES[v1 rarity]` QP via an idempotent `CurrencyTransaction` (`cosmetics-v2-refund:<player>:<id>`).
  3. Delete the retired `PlayerCosmetic` rows. Rewrite `PlayerAppearance` and every `CosmeticPreset.appearanceJson` through the map, and drop unmapped slots (bodyColor falls back to Sunshine).
  4. Leave `GachaPull`, `ShopPurchase` and `CosmeticAdminEvent` untouched as audit history. Rotations skip unknown IDs already.
- Back up the SQLite DB before deploying. The v1 asset folder is deleted once v2 ships, because no v2 page references it.

## 5. Implementation

1. **Rig**: export body/head/belly/wing clip paths and an HSL `derivePalette(base)` from `avatar-rig.ts`. Body colors declare regions (head/chest/belly) and finish (solid, gradient, metallic).
2. **Art modules**: `scripts/cosmetics/art/<slot>.ts`, one draw function per catalog ID, with shared helpers (`shadeShape`, `sheen`, `glow`, `stitch`, `animate`). Output goes to `public/cosmetics/v2/<slot>/<id>.svg` and per-slot cropped previews.
3. **Catalog**: explicit literal list in `lib/cosmetics/catalog.ts` (no generated rarity), `version: 2`.
4. **Closet**: live on-duck tiles framed per tab, rarity border and gem, sorted rarest first, owned/total count per tab, equipped-item caption. Tiles drop aura/pet/trail (and the outfit on Màu/Skin) so the item being picked stays visible. A "MỚI" badge is not done yet, because the closet does not receive `isNew`.
5. **Validation**: every ID has art and vice versa, every slot covers all 5 rarities, recolor-duplicate guard, previews exist.
6. **QA**: `/dev/cosmetics` and the contact sheet re-rendered. Dev pages, `render-*` scripts and Phaser presets updated to v2 IDs.
7. **Order**: rig + closet + Nón (quality bar) → Màu, Mặt, Áo → Skin, Pet → Aura, Trail → migration + cleanup.
