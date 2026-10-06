import type { CosmeticDefinition } from './types'
import { cosmetic } from './define'
import { SET_CATALOG } from './sets'

/**
 * Duck Closet v2 catalog — every item is hand-designed and its rarity is set by its art budget
 * (see docs/cosmetics-v2-redesign.md). Art lives in scripts/cosmetics/art/<slot>.ts; run
 * `pnpm cosmetics:generate` after editing either side and `pnpm cosmetics:validate` to check them.
 */

const CORE_CATALOG: CosmeticDefinition[] = [
  // Màu
  cosmetic('body-sunshine', 'Sunshine', 'bodyColor', 'common', 'Pond Basics', { color: '#FFD84D' }),
  cosmetic('body-tangerine', 'Tangerine', 'bodyColor', 'common', 'Pond Basics', { color: '#FF9B42' }),
  cosmetic('body-mint', 'Mint Splash', 'bodyColor', 'common', 'Pond Basics', { color: '#58E6B0' }),
  cosmetic('body-sky', 'Sky Puddle', 'bodyColor', 'common', 'Pond Basics', { color: '#61C9FF' }),
  cosmetic('body-rose', 'Rose Pop', 'bodyColor', 'common', 'Pond Basics', { color: '#FF78A8' }),
  cosmetic('body-cream', 'Cream Puff', 'bodyColor', 'common', 'Pond Basics', { color: '#FFF0BD' }),
  cosmetic('body-lime', 'Lime Soda', 'bodyColor', 'common', 'Food Fight', { color: '#B6F23A' }),
  cosmetic('body-peach', 'Peach', 'bodyColor', 'common', 'Food Fight', { color: '#FFB38A' }),
  cosmetic('body-aqua', 'Aqua Splash', 'bodyColor', 'common', 'Pond Basics', { color: '#3EDBF0' }),
  cosmetic('body-lavender', 'Lavender Quack', 'bodyColor', 'uncommon', 'Pond Basics', { color: '#B99AFF' }),
  cosmetic('body-midnight', 'Midnight Pond', 'bodyColor', 'uncommon', 'Cosmic Pond', { color: '#4A5490' }),
  cosmetic('body-matcha', 'Matcha Latte', 'bodyColor', 'uncommon', 'Food Fight', { color: '#9CC46A' }),
  cosmetic('body-coral', 'Coral Reef', 'bodyColor', 'uncommon', 'Pond Basics', { color: '#FF7A6B' }),
  cosmetic('body-bubblegum', 'Bubblegum', 'bodyColor', 'uncommon', 'Food Fight', { color: '#FF8AD8' }),
  cosmetic('body-grape', 'Grape Soda', 'bodyColor', 'uncommon', 'Food Fight', { color: '#8B5CF6' }),
  cosmetic('body-cocoa', 'Cocoa', 'bodyColor', 'uncommon', 'Office Survivors', { color: '#A0694A' }),
  cosmetic('body-mallard', 'Mallard Emerald', 'bodyColor', 'rare', 'Pond Basics', { color: '#1F8F5F' }),
  cosmetic('body-cherry', 'Cherry Gloss', 'bodyColor', 'rare', 'Viet Duck', { color: '#E11D48' }),
  cosmetic('body-sapphire', 'Sapphire', 'bodyColor', 'rare', 'Cosmic Pond', { color: '#2563EB' }),
  cosmetic('body-pearl', 'Pearl', 'bodyColor', 'rare', 'Pond Royalty', { color: '#F3EEF7' }),
  cosmetic('body-ink', 'Ink Duck', 'bodyColor', 'rare', 'Street Duck', { color: '#2A2638' }),
  cosmetic('body-sunset', 'Sunset Ombre', 'bodyColor', 'epic', 'Viet Duck', { color: '#FF7A59' }),
  cosmetic('body-chrome', 'Cyber Chrome', 'bodyColor', 'epic', 'Cyber Quack', { color: '#B8C4D6' }),
  cosmetic('body-golden', 'Golden Duck', 'bodyColor', 'legendary', 'Pond Royalty', { color: '#F2B627' }),

  // Skin
  cosmetic('bodySkin-cheek-freckles', 'Cheek Freckles', 'bodySkin', 'common', 'Pond Basics'),
  cosmetic('bodySkin-racing-stripes', 'Racing Stripes', 'bodySkin', 'common', 'Street Duck'),
  cosmetic('bodySkin-polka-pond', 'Polka Pond', 'bodySkin', 'common', 'Pond Basics'),
  cosmetic('bodySkin-band-aid-hero', 'Band-Aid Hero', 'bodySkin', 'common', 'Office Survivors'),
  cosmetic('bodySkin-tiger-quack', 'Tiger Quack', 'bodySkin', 'uncommon', 'Street Duck'),
  cosmetic('bodySkin-cow-spots', 'Cow Spots', 'bodySkin', 'uncommon', 'Food Fight'),
  cosmetic('bodySkin-koi-patches', 'Koi Patches', 'bodySkin', 'uncommon', 'Viet Duck'),
  cosmetic('bodySkin-street-camo', 'Street Camo', 'bodySkin', 'uncommon', 'Street Duck'),
  cosmetic('bodySkin-me-tattoo', '"MẸ" Sailor Tattoo', 'bodySkin', 'rare', 'Viet Duck'),
  cosmetic('bodySkin-circuit-feathers', 'Circuit Feathers', 'bodySkin', 'rare', 'Cyber Quack'),
  cosmetic('bodySkin-star-constellations', 'Star Constellations', 'bodySkin', 'rare', 'Cosmic Pond'),
  cosmetic('bodySkin-dragon-scale', 'Dragon Scale', 'bodySkin', 'epic', 'Pond Royalty'),
  cosmetic('bodySkin-gold-veins', 'Kintsugi Porcelain', 'bodySkin', 'epic', 'Spirit Lotus'),
  cosmetic('bodySkin-galaxy-dust', 'Galaxy Body', 'bodySkin', 'legendary', 'Cosmic Pond'),

  // Mặt
  cosmetic('face-happy', 'Happy Beak', 'face', 'common', 'Pond Basics'),
  cosmetic('face-sleepy-eyes', 'Sleepy Eyes', 'face', 'common', 'Office Survivors'),
  cosmetic('face-angry-brows', 'Angry Brows', 'face', 'common', 'Street Duck'),
  cosmetic('face-tiny-moustache', 'Tiny Moustache', 'face', 'common', 'Office Survivors'),
  cosmetic('face-monday-face', 'Monday Face', 'face', 'common', 'Office Survivors'),
  cosmetic('face-shades', 'Pond Shades', 'face', 'uncommon', 'Street Duck'),
  cosmetic('face-nerd-glasses', 'Nerd Glasses', 'face', 'uncommon', 'Office Survivors'),
  cosmetic('face-heart-eyes', 'Heart Eyes', 'face', 'uncommon', 'Pond Basics'),
  cosmetic('face-bandit-mask', 'Bandit Mask', 'face', 'uncommon', 'Street Duck'),
  cosmetic('face-swimming-goggles', 'Swim Goggles', 'face', 'uncommon', 'Pond Basics'),
  cosmetic('face-monocle', 'Monocle', 'face', 'rare', 'Pond Royalty'),
  cosmetic('face-aviators', 'Aviators', 'face', 'rare', 'Street Duck'),
  cosmetic('face-pixel-eyes', 'Pixel Shades', 'face', 'rare', 'Cyber Quack'),
  cosmetic('face-laser-visor', 'Laser Visor', 'face', 'epic', 'Cyber Quack'),
  cosmetic('face-kitsune-mask', 'Kitsune Half Mask', 'face', 'epic', 'Spirit Lotus'),
  cosmetic('face-cosmic-eyes', 'Cosmic Eyes', 'face', 'legendary', 'Cosmic Pond'),

  // Nón
  cosmetic('head-cap-red', 'Red Race Cap', 'head', 'common', 'Street Duck'),
  cosmetic('head-bucket-blue', 'Blue Bucket Hat', 'head', 'common', 'Street Duck'),
  cosmetic('head-beanie', 'Beanie', 'head', 'common', 'Pond Basics'),
  cosmetic('head-party-cone', 'Party Cone', 'head', 'common', 'Office Survivors'),
  cosmetic('head-traffic-cone', 'Traffic Cone', 'head', 'common', 'Street Duck'),
  cosmetic('head-paper-boat', 'Newspaper Hat', 'head', 'common', 'Office Survivors'),
  cosmetic('head-sweatband', 'Sweatband', 'head', 'common', 'Street Duck'),
  cosmetic('head-tiny-crown', 'Tiny Crown', 'head', 'uncommon', 'Pond Royalty'),
  cosmetic('head-chef-hat', 'Chef Hat', 'head', 'uncommon', 'Food Fight'),
  cosmetic('head-office-headset', 'Office Headset', 'head', 'uncommon', 'Office Survivors'),
  cosmetic('head-cat-ears', 'Cat Ears', 'head', 'uncommon', 'Pond Basics'),
  cosmetic('head-bamboo-hat', 'Nón Lá', 'head', 'uncommon', 'Viet Duck'),
  cosmetic('head-frog-hood', 'Frog Hood', 'head', 'uncommon', 'Pond Basics'),
  cosmetic('head-cowboy-hat', 'Cowboy Hat', 'head', 'rare', 'Street Duck'),
  cosmetic('head-wizard-hat', 'Wizard Hat', 'head', 'rare', 'Spirit Lotus'),
  cosmetic('head-viking-horns', 'Viking Helm', 'head', 'rare', 'Pond Royalty'),
  cosmetic('head-motorbike-helmet', 'Nón Bảo Hiểm', 'head', 'rare', 'Viet Duck'),
  cosmetic('head-pho-bowl', 'Phở Bowl', 'head', 'rare', 'Food Fight'),
  cosmetic('head-space-dome', 'Space Dome', 'head', 'epic', 'Cosmic Pond'),
  cosmetic('head-cyber-mohawk', 'Cyber Mohawk', 'head', 'epic', 'Cyber Quack'),
  cosmetic('head-dragon-horns', 'Dragon Horns', 'head', 'epic', 'Pond Royalty'),
  cosmetic('head-dragon-emperor-crown', 'Dragon Emperor Crown', 'head', 'legendary', 'Pond Royalty'),

  // Áo
  cosmetic('outfit-tee-white', 'Clean White Tee', 'outfit', 'common', 'Pond Basics'),
  cosmetic('outfit-office-tie', 'Monday Tie', 'outfit', 'common', 'Office Survivors'),
  cosmetic('outfit-pajamas', 'Pajamas', 'outfit', 'common', 'Office Survivors'),
  cosmetic('outfit-sailor-shirt', 'Sailor Shirt', 'outfit', 'common', 'Pond Basics'),
  cosmetic('outfit-football-jersey', 'Football Jersey', 'outfit', 'common', 'Viet Duck'),
  cosmetic('outfit-chef-apron', 'Chef Apron', 'outfit', 'common', 'Food Fight'),
  cosmetic('outfit-raincoat', 'Pond Raincoat', 'outfit', 'uncommon', 'Pond Basics'),
  cosmetic('outfit-dev-hoodie', 'Dev Hoodie', 'outfit', 'uncommon', 'Office Survivors'),
  cosmetic('outfit-pond-lifeguard', 'Pond Lifeguard', 'outfit', 'uncommon', 'Pond Basics'),
  cosmetic('outfit-biker-vest', 'Biker Vest', 'outfit', 'uncommon', 'Street Duck'),
  cosmetic('outfit-detective-coat', 'Detective Coat', 'outfit', 'uncommon', 'Office Survivors'),
  cosmetic('outfit-lucky-ao-dai', 'Lucky Áo Dài', 'outfit', 'rare', 'Viet Duck'),
  cosmetic('outfit-racing-suit', 'Racing Suit', 'outfit', 'rare', 'Street Duck'),
  cosmetic('outfit-boss-blazer', 'Boss Blazer', 'outfit', 'rare', 'Office Survivors'),
  cosmetic('outfit-space-suit', 'Space Suit', 'outfit', 'rare', 'Cosmic Pond'),
  cosmetic('outfit-wizard-robe', 'Wizard Robe', 'outfit', 'rare', 'Spirit Lotus'),
  cosmetic('outfit-quack-knight', 'Quack Knight', 'outfit', 'epic', 'Pond Royalty'),
  cosmetic('outfit-cyber-samurai', 'Cyber Samurai', 'outfit', 'epic', 'Cyber Quack'),
  cosmetic('outfit-spirit-haori', 'Spirit Haori', 'outfit', 'epic', 'Spirit Lotus'),
  cosmetic('outfit-dragon-robe', 'Dragon Robe', 'outfit', 'legendary', 'Pond Royalty'),

  // Pet
  cosmetic('pet-rubber-duckling', 'Rubber Duckling', 'pet', 'common', 'Pond Basics'),
  cosmetic('pet-origami-frog', 'Origami Frog', 'pet', 'common', 'Office Survivors'),
  cosmetic('pet-office-mouse', 'Office Mouse', 'pet', 'common', 'Office Survivors'),
  cosmetic('pet-bread-pigeon', 'Bánh Mì Pigeon', 'pet', 'common', 'Food Fight'),
  cosmetic('pet-shiba-inu', 'Shiba Inu', 'pet', 'uncommon', 'Pond Basics'),
  cosmetic('pet-calico-cat', 'Calico Cat', 'pet', 'uncommon', 'Pond Basics'),
  cosmetic('pet-mini-capybara', 'Mini Capybara', 'pet', 'uncommon', 'Pond Basics'),
  cosmetic('pet-coffee-slime', 'Cà Phê Slime', 'pet', 'uncommon', 'Food Fight'),
  cosmetic('pet-tiny-drone', 'Tiny Drone', 'pet', 'rare', 'Cyber Quack', { animation: 'hover' }),
  cosmetic('pet-golden-carp', 'Golden Carp', 'pet', 'rare', 'Viet Duck', { animation: 'float' }),
  cosmetic('pet-lucky-black-cat', 'Lucky Black Cat', 'pet', 'rare', 'Spirit Lotus', { animation: 'wave' }),
  cosmetic('pet-baby-dragon', 'Baby Dragon', 'pet', 'epic', 'Pond Royalty'),
  cosmetic('pet-neon-jellyfish', 'Neon Jellyfish', 'pet', 'epic', 'Cyber Quack'),
  cosmetic('pet-moon-rabbit', 'Moon Rabbit', 'pet', 'legendary', 'Spirit Lotus'),

  // Aura
  cosmetic('aura-fireflies', 'Pond Fireflies', 'aura', 'common', 'Pond Basics'),
  cosmetic('aura-coffee-steam', 'Coffee Steam', 'aura', 'common', 'Office Survivors'),
  cosmetic('aura-bubble-halo', 'Bubble Halo', 'aura', 'common', 'Pond Basics'),
  cosmetic('aura-lucky-leaves', 'Lucky Leaves', 'aura', 'uncommon', 'Street Duck'),
  cosmetic('aura-lotus-breeze', 'Lotus Breeze', 'aura', 'uncommon', 'Viet Duck'),
  cosmetic('aura-storm-cloud', 'Storm Cloud', 'aura', 'rare', 'Office Survivors', { animation: 'storm' }),
  cosmetic('aura-neon-glitch', 'Neon Glitch', 'aura', 'rare', 'Cyber Quack', { animation: 'glitch' }),
  cosmetic('aura-golden-rays', 'Golden Rays', 'aura', 'epic', 'Pond Royalty'),
  cosmetic('aura-ghost-fog', 'Ghost Fog', 'aura', 'epic', 'Spirit Lotus'),
  cosmetic('aura-dragon-flame', 'Thần Long Flame', 'aura', 'legendary', 'Pond Royalty'),

  // Trail
  cosmetic('trail-ripples', 'Fresh Ripples', 'trail', 'common', 'Pond Basics'),
  cosmetic('trail-bubble-wake', 'Bubble Wake', 'trail', 'common', 'Pond Basics'),
  cosmetic('trail-paper-boats', 'Paper Boats', 'trail', 'common', 'Office Survivors'),
  cosmetic('trail-lotus-petals', 'Lotus Petals', 'trail', 'uncommon', 'Viet Duck'),
  cosmetic('trail-coffee-spill', 'Coffee Spill', 'trail', 'uncommon', 'Office Survivors'),
  cosmetic('trail-neon-wake', 'Neon Wake', 'trail', 'rare', 'Cyber Quack', { animation: 'stream' }),
  cosmetic('trail-pixel-stream', 'Pixel Stream', 'trail', 'rare', 'Cyber Quack', { animation: 'stream' }),
  cosmetic('trail-rainbow-wake', 'Rainbow Wake', 'trail', 'epic', 'Pond Basics'),
  cosmetic('trail-dragon-sparks', 'Dragon Sparks', 'trail', 'epic', 'Pond Royalty'),
  cosmetic('trail-golden-water', 'Golden Wake', 'trail', 'legendary', 'Pond Royalty'),
]

export const COSMETIC_CATALOG: CosmeticDefinition[] = [...CORE_CATALOG, ...SET_CATALOG]

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
