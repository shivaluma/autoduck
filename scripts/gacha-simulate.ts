import { GACHA_CONFIG, rollRarity } from '../lib/cosmetics/gacha'

const pullsArg = process.argv.findIndex((arg) => arg === '--pulls')
const pulls = Number(pullsArg >= 0 ? process.argv[pullsArg + 1] : 1_000_000)
if (!Number.isInteger(pulls) || pulls < 1) throw new Error('--pulls must be a positive integer')

const rarity = { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 }
const pityTriggers = { rare: 0, epic: 0, legendary: 0 }
const pity = { rarePity: 0, epicPity: 0, legendaryPity: 0 }

for (let index = 0; index < pulls; index += 1) {
  if (pity.legendaryPity >= GACHA_CONFIG.pity.legendary) pityTriggers.legendary += 1
  else if (pity.epicPity >= GACHA_CONFIG.pity.epic) pityTriggers.epic += 1
  else if (pity.rarePity >= GACHA_CONFIG.pity.rare) pityTriggers.rare += 1
  const rolledRarity = rollRarity(pity)
  rarity[rolledRarity] += 1
  const rank = ['common', 'uncommon', 'rare', 'epic', 'legendary'].indexOf(rolledRarity)
  pity.rarePity = rank >= 2 ? 0 : pity.rarePity + 1
  pity.epicPity = rank >= 3 ? 0 : pity.epicPity + 1
  pity.legendaryPity = rank >= 4 ? 0 : pity.legendaryPity + 1
}

console.log(JSON.stringify({ pulls, rarity, rates: Object.fromEntries(Object.entries(rarity).map(([key, value]) => [key, value / pulls])), pityTriggers, finalPity: pity }, null, 2))
