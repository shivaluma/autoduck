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

const COLLECTIONS = [
  'Office Survivors', 'River Royalty', 'Cyber Quack', 'Street Duck',
  'Viet Duck', 'Space Duck', 'Food Fight', 'Cursed Collection',
  'Spirit Realm', 'Star Guardians', 'Blood Moon', 'Arcane Hextech',
  'Reddit Collectibles', 'Coven Gods', 'High Noon',
]
const RARITIES: CosmeticDefinition['rarity'][] = ['common', 'uncommon', 'rare', 'epic', 'legendary']
const EXTRA_NAMES: Record<string, string[]> = {
  bodySkin: [
    'Lotus Speckles', 'River Stripes', 'Pixel Pond', 'Cloud Patches', 'Coffee Stains',
    'Neon Scales', 'Star Freckles', 'Barcode Duck', 'Bamboo Marks', 'Chilli Dots',
    'Moon Craters', 'Circuit Feathers', 'Newsprint', 'Tiger Quack', 'Confetti Rain',
    'Koi Patches', 'Storm Lines', 'Galaxy Dust', 'Lucky Tiles', 'Cursed Scribble',
    'Gold Veins', 'Prism Checks', 'Dragon Scale',
    'Spirit Inks', 'Hextech Runes', 'KDA Iridescent', 'Blood Moon Markings', 'Star Constellations',
    'Snoo Wireframe', 'Coven Bramble', 'Diamond Facets', 'Porcelain Glaze', 'High Noon Brands',
  ],
  face: [
    'Sleepy Eyes', 'Office Burnout', 'Laser Visor', 'Monocle', 'Heart Eyes',
    'Angry Brows', 'Tiny Moustache', 'Star Glasses', 'Swimming Goggles', 'Pixel Eyes',
    'Anime Sparkle', 'Detective Lens', 'Chef Focus', 'Moon Gaze', 'Cyber Scan',
    'Lucky Wink', 'Panic Face', 'Villain Brows', 'Disco Shades', 'Golden Gaze',
    'Ghost Eyes', 'Frog Goggles', 'Diamond Tears', 'Monday Face', 'Victory Wink',
    'Space Visor', 'Chilli Tears', 'Royal Lashes',
    'Spirit Fox Mask', 'KDA Neon Demon Visor', 'Star Guardian Gem', 'Blood Moon Oni Half Mask', 'Rojom Abyss Eyes',
    'Arcane Hextech Monocle', 'Snoo Heart Blush', 'High Noon Smolder', 'Coven Occult Veil', 'PROJECT HUD Reticle',
  ],
  head: [
    'Beanie', 'Office Headset', 'Paper Crown', 'Chef Hat', 'Traffic Cone',
    'Lotus Hat', 'Motorbike Helmet', 'Cowboy Hat', 'Wizard Hat', 'Space Dome',
    'Propeller Cap', 'Viking Horns', 'Detective Hat', 'Party Cone', 'Rice Bowl',
    'Noodle Cup', 'Bamboo Hat', 'Cloud Halo', 'Dev Antenna', 'Cat Ears',
    'Frog Hood', 'Pirate Hat', 'Captain Cap', 'Disco Ball', 'Moon Tiara',
    'Dragon Horns', 'Golden Laurel', 'Cyber Mohawk', 'Bread Beret', 'Coffee Lid',
    'Rocket Helm', 'Fish Crown', 'Storm Cloud', 'Mushroom Cap', 'Lucky Helmet',
    'Neon Fedora', 'Paper Boat', 'Royal Turban', 'Cursed Candle', 'Galaxy Crown',
    'Boss Comb', 'Quackphone', 'Hotpot Lid', 'Victory Wreath', 'Diamond Crown',
    'Satellite Dish', 'Pho Bowl', 'Tiny Pond',
    'Snoo Antenna Glow', 'Spirit Blossom Kanzashi', 'Star Guardian Wings Tiara', 'Blood Moon Horns', 'Reddit Cone Head Prime',
    'PROJECT Cyber Helm', 'Coven Antler Crown', 'Winterblessed Crown', 'High Noon Hellfire Hat', 'Dark Star Singularity',
  ],
  neck: [
    'Office Lanyard', 'Red Scarf', 'Golden Bow', 'Lotus Chain', 'Cyber Collar', 'Royal Cape Clip',
    'Spirit Prayer Beads', 'Star Guardian Ribbon', 'Blood Moon Magatama', 'PROJECT Energy Collar', 'Reddit Diamond Pendant',
    'Coven Raven Skull', 'Arcane Hextech Choker', 'High Noon Bandana', 'KDA Golden Collar', 'Winterblessed Fur Collar',
  ],
  outfit: [
    'Office Shirt', 'Dev Hoodie', 'Street Jacket', 'Chef Apron', 'Space Suit',
    'Wizard Robe', 'Biker Vest', 'Sailor Shirt', 'Lotus Tunic', 'Pixel Armor',
    'Royal Mantle', 'Football Jersey', 'Pajamas', 'Detective Coat', 'Rain Poncho',
    'Noodle Armor', 'Coffee Uniform', 'Dragon Robe', 'Disco Suit', 'Pirate Coat',
    'Cloud Sweater', 'Neon Tracksuit', 'Moon Kimono', 'Racing Suit', 'Golden Tux',
    'Cursed Cloak', 'Bamboo Armor', 'Hotpot Apron', 'Galaxy Jacket', 'Victory Cape',
    'Frog Onesie', 'Bread Suit', 'Storm Coat', 'Diamond Armor', 'Pond Lifeguard',
    'Retro Windbreaker', 'Cyber Samurai', 'Lucky Áo Dài', 'Quack Knight', 'Boss Blazer',
    'Spirit Blossom Haori', 'Star Guardian Sailor Dress', 'KDA Holographic Jacket', 'PROJECT Cyber Exosuit', 'Blood Moon Assassin Garb',
    'Coven Witch Gown', 'High Noon Gunslinger Poncho', 'Reddit Drip Squad Puffer', 'Porcelain Hanfu Robe', 'Winterblessed Regal Coat',
  ],
  back: [
    'Office Backpack', 'Paper Wings', 'Jetpack', 'Bamboo Basket', 'Royal Cape',
    'Dragon Wings', 'Cloud Pack', 'Neon Battery', 'Chef Knives', 'Space Tank',
    'Lucky Flag', 'Cursed Hands', 'Lotus Fan', 'Rocket Pack', 'Disco Speakers', 'Tiny Pond Pack',
    'Spirit Fox Nine Tails', 'Star Guardian Wings', 'PROJECT Cyber Katanas', 'Blood Moon Eclipse Wheel', 'The Hands Spectral Grasp',
    'Coven Raven Wings', 'Dark Star Cosmic Void', 'Reddit Diamond Hands Wings', 'Hextech Jet Boosters', 'High Noon Fiery Shroud',
  ],
  pet: [
    'Rubber Fish', 'Tiny Drone', 'Coffee Slime', 'Baby Dragon', 'Cloud Cat',
    'Pixel Crab', 'Lotus Spirit', 'Space Frog', 'Noodle Worm', 'Golden Carp',
    'Cursed Eye', 'Mini Capybara', 'Office Mouse', 'Neon Jellyfish', 'Bread Pigeon',
    'Tiny Shark', 'Moon Rabbit', 'Hotpot Spirit', 'Shiba Inu', 'Corgi Pup',
    'Calico Cat', 'Lucky Black Cat', 'Golden Retriever', 'Cyber Hamster',
    'Spirit Fox Kiko', 'Star Guardian Dango', 'Reddit Snoo Mini Bot', 'Blood Moon Little Crow', 'Porofessor Poro',
    'Little Legend Pengu', 'PROJECT Cyber Drone', 'Coven Shadow Familiar', 'Cafe Cutie Pastry Pup', 'Arcane Firelight Beetle',
  ],
  aura: [
    'Coffee Steam', 'Royal Sparkles', 'Neon Glitch', 'Lotus Breeze', 'Storm Cloud',
    'Pixel Orbit', 'Golden Rays', 'Ghost Fog', 'Space Dust', 'Chilli Heat',
    'Bubble Halo', 'Dragon Flame', 'Disco Lights', 'Moon Glow', 'Lucky Leaves',
    'Spirit Blossom Petals', 'Star Guardian Stardust', 'Blood Moon Eclipse', 'PROJECT Matrix Grid', 'Coven Dark Eclipse',
    'Dark Star Event Horizon', 'Reddit Upvote Tornado', 'High Noon Hellfire Flare', 'Winterblessed Aurora Ribbon', 'Arcane Hextech Anomaly',
  ],
  trail: [
    'Bubble Wake', 'Neon Wake', 'Lotus Petals', 'Coffee Spill', 'Pixel Stream',
    'Golden Water', 'Storm Foam', 'Rainbow Wake', 'Ghost Ripples', 'Chilli Sauce',
    'Moon Dust', 'Dragon Sparks', 'Paper Boats',
    'Spirit Blossom Sakura', 'Star Guardian Starlight', 'Blood Moon Crimson Ink', 'PROJECT Cyber Glitch', 'Dark Star Void Dust',
    'Reddit Upvote Stream', 'High Noon Sulfur Smoke', 'Winterblessed Snowflakes', 'Arcane Hextech Lightning', 'Porcelain Blue Wave',
  ],
  finish: [
    'Confetti Quack', 'Golden Splash', 'Pixel Explosion', 'Lotus Bloom', 'Dragon Roar',
    'Coffee Burst', 'Moon Landing', 'Neon Victory', 'Storm Strike', 'Royal Fireworks',
    'Star Guardian Starfall', 'Spirit Blossom Torii Bloom', 'Blood Moon Eclipse Burst', 'PROJECT Laser Strike', 'Dark Star Supernova',
    'Reddit Diamond Rocket', 'Arcane Hextech Overdrive', 'High Noon Quickdraw Flare', 'Coven Occult Thorn Burst', 'Winterblessed Aurora Burst',
  ],
  nameplate: [
    'Office Badge', 'River Ribbon', 'Cyber Tag', 'Street Sticker', 'Lotus Frame',
    'Space Panel', 'Golden Plaque', 'Cursed Label', 'Coffee Card', 'Dragon Banner',
    'Moon Plate', 'Victory Sign',
    'Spirit Blossom Shrine', 'Star Guardian Crest', 'Blood Moon Torii Crest', 'PROJECT Cyber Tag', 'Coven Gothic Plaque',
    'Dark Star Void Horizon', 'Reddit Hexagon Avatar Border', 'High Noon Wanted Plate', 'Winterblessed Frost Frame', 'Porcelain Dragon Plinth',
  ],
}

const EXTRA_BODY_COLORS: Array<[string, string]> = [
  ['Lime Soda', '#B9F45D'], ['Ocean', '#368BCB'], ['Coral', '#FF6F61'], ['Plum', '#8D5AA7'],
  ['Coffee', '#9A6948'], ['Lotus', '#F4A7C5'], ['Silver', '#B9C3D2'], ['Emerald', '#2DBE79'],
  ['Ruby', '#CB4052'], ['Cyber Cyan', '#26E6E6'], ['Royal Purple', '#673AB7'], ['Chilli', '#EF3E36'],
  ['Galaxy', '#39406E'], ['Peach', '#FFB38A'], ['Bamboo', '#78A84B'], ['Ghost', '#DDEAF2'],
  ['Spirit Blossom Lotus', '#FFC0D9'], ['Star Guardian Blue', '#85E3FF'], ['Blood Moon Crimson', '#991B1B'], ['Void Purple', '#6B21A8'],
  ['Hextech Blue', '#0284C7'], ['Snoo Cosmic Abyss', '#1E1B4B'], ['WSB Diamond Mint', '#34D399'], ['Coven Bone White', '#F1F5F9'],
  ['High Noon Sulfur', '#EA580C'], ['Porcelain Cobalt', '#2563EB'],
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
