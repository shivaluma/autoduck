import { SHOP_PRICES } from '../lib/cosmetics/shop'

const value = (flag: string, fallback: number) => { const index = process.argv.indexOf(flag); return Number(index >= 0 ? process.argv[index + 1] : fallback) }
const weeks = value('--weeks', 12)
const players = value('--players', 8)
const seasons = value('--seasons', 100_000)
let totalEarned = 0
let totalAffordableRare = 0
let totalAffordableEpic = 0
for (let season = 0; season < seasons; season += 1) {
  const balances = Array.from({ length: players }, () => 0)
  for (let week = 0; week < weeks; week += 1) {
    const winner = Math.floor(Math.random() * players)
    balances[winner] += 5
    for (let player = 0; player < players; player += 1) {
      if (Math.random() < 0.25) balances[player] += 2
      if (player === winner && Math.random() < 0.25) balances[player] += 1
    }
  }
  totalEarned += balances.reduce((sum, balance) => sum + balance, 0)
  totalAffordableRare += balances.filter((balance) => balance >= SHOP_PRICES.rare).length
  totalAffordableEpic += balances.filter((balance) => balance >= SHOP_PRICES.epic).length
}
console.log(JSON.stringify({ seasons, weeks, players, averageQpPerPlayer: totalEarned / seasons / players, shareCanBuyRare: totalAffordableRare / seasons / players, shareCanBuyEpic: totalAffordableEpic / seasons / players }, null, 2))
