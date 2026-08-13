import type { CosmeticDefinition } from './types'

const cosmetic = (
  id: string,
  name: string,
  slot: CosmeticDefinition['slot'],
  rarity: CosmeticDefinition['rarity'],
  anchor: CosmeticDefinition['anchor'],
  options: Partial<CosmeticDefinition> = {},
): CosmeticDefinition => ({
  id,
  name,
  slot,
  rarity,
  anchor,
  asset: `/cosmetics/v1/${slot}/${id}.svg`,
  previewAsset: `/cosmetics/previews/v1/${id}.svg`,
  shopEligible: true,
  gachaEligible: true,
  tags: ['starter-proof'],
  version: 1,
  ...options,
})

const CORE_CATALOG: CosmeticDefinition[] = [
  cosmetic('body-sunshine', 'Sunshine', 'bodyColor', 'common', 'body', { color: '#FFD84D', collection: 'Pond Basics' }),
  cosmetic('body-tangerine', 'Tangerine', 'bodyColor', 'common', 'body', { color: '#FF9B42', collection: 'Pond Basics' }),
  cosmetic('body-mint', 'Mint Splash', 'bodyColor', 'common', 'body', { color: '#58E6B0', collection: 'Pond Basics' }),
  cosmetic('body-sky', 'Sky Puddle', 'bodyColor', 'common', 'body', { color: '#61C9FF', collection: 'Pond Basics' }),
  cosmetic('body-lavender', 'Lavender Quack', 'bodyColor', 'common', 'body', { color: '#B99AFF', collection: 'Pond Basics' }),
  cosmetic('body-rose', 'Rose Pop', 'bodyColor', 'common', 'body', { color: '#FF78A8', collection: 'Pond Basics' }),
  cosmetic('body-cream', 'Cream Puff', 'bodyColor', 'common', 'body', { color: '#FFF0BD', collection: 'Pond Basics' }),
  cosmetic('body-midnight', 'Midnight Pond', 'bodyColor', 'uncommon', 'body', { color: '#5965A8', collection: 'Pond Basics' }),
  cosmetic('head-cap-red', 'Red Race Cap', 'head', 'common', 'head', { collection: 'Street Duck' }),
  cosmetic('head-bucket-blue', 'Blue Bucket Hat', 'head', 'common', 'head', { collection: 'Street Duck' }),
  cosmetic('head-tiny-crown', 'Tiny Crown', 'head', 'uncommon', 'head', { collection: 'River Royalty' }),
  cosmetic('outfit-tee-white', 'Clean White Tee', 'outfit', 'common', 'body', { collection: 'Pond Basics' }),
  cosmetic('outfit-office-tie', 'Monday Tie', 'outfit', 'common', 'body', { collection: 'Office Survivors' }),
  cosmetic('outfit-raincoat', 'Pond Raincoat', 'outfit', 'uncommon', 'body', { collection: 'Pond Basics' }),
  cosmetic('face-happy', 'Happy Beak', 'face', 'common', 'face', { collection: 'Pond Basics' }),
  cosmetic('face-shades', 'Pond Shades', 'face', 'uncommon', 'face', { collection: 'Street Duck' }),
  cosmetic('trail-ripples', 'Fresh Ripples', 'trail', 'common', 'tail', { collection: 'Pond Basics' }),
  cosmetic('skin-dots', 'Confetti Spots', 'bodySkin', 'rare', 'body', { collection: 'Food Fight' }),
  cosmetic('pet-origami-frog', 'Origami Frog', 'pet', 'rare', 'petRight', { collection: 'Pond Basics', animation: 'hop' }),
  cosmetic('aura-fireflies', 'Pond Fireflies', 'aura', 'epic', 'auraCenter', { collection: 'River Royalty', animation: 'orbit' }),
]

const COLLECTIONS = ['Office Survivors', 'River Royalty', 'Cyber Quack', 'Street Duck', 'Viet Duck', 'Space Duck', 'Food Fight', 'Cursed Collection']
const RARITIES: CosmeticDefinition['rarity'][] = ['common', 'uncommon', 'rare', 'epic', 'legendary']
const EXTRA_NAMES: Record<string, string[]> = {
  bodySkin: ['Lotus Speckles', 'River Stripes', 'Pixel Pond', 'Cloud Patches', 'Coffee Stains', 'Neon Scales', 'Star Freckles', 'Barcode Duck', 'Bamboo Marks', 'Chilli Dots', 'Moon Craters', 'Circuit Feathers', 'Newsprint', 'Tiger Quack', 'Confetti Rain', 'Koi Patches', 'Storm Lines', 'Galaxy Dust', 'Lucky Tiles', 'Cursed Scribble', 'Gold Veins', 'Prism Checks', 'Dragon Scale'],
  face: ['Sleepy Eyes', 'Office Burnout', 'Laser Visor', 'Monocle', 'Heart Eyes', 'Angry Brows', 'Tiny Moustache', 'Star Glasses', 'Swimming Goggles', 'Pixel Eyes', 'Anime Sparkle', 'Detective Lens', 'Chef Focus', 'Moon Gaze', 'Cyber Scan', 'Lucky Wink', 'Panic Face', 'Villain Brows', 'Disco Shades', 'Golden Gaze', 'Ghost Eyes', 'Frog Goggles', 'Diamond Tears', 'Monday Face', 'Victory Wink', 'Space Visor', 'Chilli Tears', 'Royal Lashes'],
  head: ['Beanie', 'Office Headset', 'Paper Crown', 'Chef Hat', 'Traffic Cone', 'Lotus Hat', 'Motorbike Helmet', 'Cowboy Hat', 'Wizard Hat', 'Space Dome', 'Propeller Cap', 'Viking Horns', 'Detective Hat', 'Party Cone', 'Rice Bowl', 'Noodle Cup', 'Bamboo Hat', 'Cloud Halo', 'Dev Antenna', 'Cat Ears', 'Frog Hood', 'Pirate Hat', 'Captain Cap', 'Disco Ball', 'Moon Tiara', 'Dragon Horns', 'Golden Laurel', 'Cyber Mohawk', 'Bread Beret', 'Coffee Lid', 'Rocket Helm', 'Fish Crown', 'Storm Cloud', 'Mushroom Cap', 'Lucky Helmet', 'Neon Fedora', 'Paper Boat', 'Royal Turban', 'Cursed Candle', 'Galaxy Crown', 'Boss Comb', 'Quackphone', 'Hotpot Lid', 'Victory Wreath', 'Diamond Crown', 'Satellite Dish', 'Pho Bowl', 'Tiny Pond'],
  neck: ['Office Lanyard', 'Red Scarf', 'Golden Bow', 'Lotus Chain', 'Cyber Collar', 'Royal Cape Clip'],
  outfit: ['Office Shirt', 'Dev Hoodie', 'Street Jacket', 'Chef Apron', 'Space Suit', 'Wizard Robe', 'Biker Vest', 'Sailor Shirt', 'Lotus Tunic', 'Pixel Armor', 'Royal Mantle', 'Football Jersey', 'Pajamas', 'Detective Coat', 'Rain Poncho', 'Noodle Armor', 'Coffee Uniform', 'Dragon Robe', 'Disco Suit', 'Pirate Coat', 'Cloud Sweater', 'Neon Tracksuit', 'Moon Kimono', 'Racing Suit', 'Golden Tux', 'Cursed Cloak', 'Bamboo Armor', 'Hotpot Apron', 'Galaxy Jacket', 'Victory Cape', 'Frog Onesie', 'Bread Suit', 'Storm Coat', 'Diamond Armor', 'Pond Lifeguard', 'Retro Windbreaker', 'Cyber Samurai', 'Lucky Áo Dài', 'Quack Knight', 'Boss Blazer'],
  back: ['Office Backpack', 'Paper Wings', 'Jetpack', 'Bamboo Basket', 'Royal Cape', 'Dragon Wings', 'Cloud Pack', 'Neon Battery', 'Chef Knives', 'Space Tank', 'Lucky Flag', 'Cursed Hands', 'Lotus Fan', 'Rocket Pack', 'Disco Speakers', 'Tiny Pond Pack'],
  pet: ['Rubber Fish', 'Tiny Drone', 'Coffee Slime', 'Baby Dragon', 'Cloud Cat', 'Pixel Crab', 'Lotus Spirit', 'Space Frog', 'Noodle Worm', 'Golden Carp', 'Cursed Eye', 'Mini Capybara', 'Office Mouse', 'Neon Jellyfish', 'Bread Pigeon', 'Tiny Shark', 'Moon Rabbit', 'Hotpot Spirit'],
  aura: ['Coffee Steam', 'Royal Sparkles', 'Neon Glitch', 'Lotus Breeze', 'Storm Cloud', 'Pixel Orbit', 'Golden Rays', 'Ghost Fog', 'Space Dust', 'Chilli Heat', 'Bubble Halo', 'Dragon Flame', 'Disco Lights', 'Moon Glow', 'Lucky Leaves'],
  trail: ['Bubble Wake', 'Neon Wake', 'Lotus Petals', 'Coffee Spill', 'Pixel Stream', 'Golden Water', 'Storm Foam', 'Rainbow Wake', 'Ghost Ripples', 'Chilli Sauce', 'Moon Dust', 'Dragon Sparks', 'Paper Boats'],
  finish: ['Confetti Quack', 'Golden Splash', 'Pixel Explosion', 'Lotus Bloom', 'Dragon Roar', 'Coffee Burst', 'Moon Landing', 'Neon Victory', 'Storm Strike', 'Royal Fireworks'],
  nameplate: ['Office Badge', 'River Ribbon', 'Cyber Tag', 'Street Sticker', 'Lotus Frame', 'Space Panel', 'Golden Plaque', 'Cursed Label', 'Coffee Card', 'Dragon Banner', 'Moon Plate', 'Victory Sign'],
}

const EXTRA_BODY_COLORS: Array<[string, string]> = [
  ['Lime Soda', '#B9F45D'], ['Ocean', '#368BCB'], ['Coral', '#FF6F61'], ['Plum', '#8D5AA7'],
  ['Coffee', '#9A6948'], ['Lotus', '#F4A7C5'], ['Silver', '#B9C3D2'], ['Emerald', '#2DBE79'],
  ['Ruby', '#CB4052'], ['Cyber Cyan', '#26E6E6'], ['Royal Purple', '#673AB7'], ['Chilli', '#EF3E36'],
  ['Galaxy', '#39406E'], ['Peach', '#FFB38A'], ['Bamboo', '#78A84B'], ['Ghost', '#DDEAF2'],
]

function slug(value: string) {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

function generatedRarity(index: number): CosmeticDefinition['rarity'] {
  if (index % 23 === 22) return 'legendary'
  if (index % 11 === 10) return 'epic'
  if (index % 5 === 4) return 'rare'
  return RARITIES[index % 3]!
}

const EXTRA_CATALOG = [
  ...EXTRA_BODY_COLORS.map(([name, color], index) => cosmetic(`body-${slug(name)}`, name, 'bodyColor', generatedRarity(index), 'body', { color, collection: COLLECTIONS[index % COLLECTIONS.length] })),
  ...Object.entries(EXTRA_NAMES).flatMap(([slot, names]) => names.map((name, index) => {
    const typedSlot = slot as CosmeticDefinition['slot']
    const anchor = ({ bodySkin: 'body', face: 'face', head: 'head', neck: 'neck', outfit: 'body', back: 'back', pet: 'petRight', aura: 'auraCenter', trail: 'tail', finish: 'auraCenter', nameplate: 'body' } as const)[typedSlot as keyof typeof EXTRA_NAMES] ?? 'body'
    return cosmetic(`${slot}-${slug(name)}`, name, typedSlot, generatedRarity(index + slot.length), anchor, {
      collection: COLLECTIONS[(index + slot.length) % COLLECTIONS.length],
      tags: [slug(COLLECTIONS[(index + slot.length) % COLLECTIONS.length]!), typedSlot],
      animation: ['pet', 'aura', 'trail', 'finish'].includes(typedSlot) ? 'procedural' : undefined,
    })
  })),
]

export const COSMETIC_CATALOG: CosmeticDefinition[] = [...CORE_CATALOG, ...EXTRA_CATALOG]

export const COSMETIC_BY_ID = new Map(COSMETIC_CATALOG.map((item) => [item.id, item]))

export const STARTER_COSMETIC_IDS = [
  'body-sunshine', 'body-tangerine', 'body-mint', 'body-sky',
  'body-lavender', 'body-rose', 'body-cream', 'body-midnight',
  'head-cap-red', 'head-bucket-blue', 'head-tiny-crown',
  'outfit-tee-white', 'outfit-office-tie', 'outfit-raincoat',
  'face-happy', 'face-shades', 'trail-ripples',
] as const

export const DEFAULT_APPEARANCE = {
  bodyColorId: 'body-sunshine',
  faceId: 'face-happy',
  headId: 'head-cap-red',
  outfitId: 'outfit-tee-white',
  trailId: 'trail-ripples',
} as const
