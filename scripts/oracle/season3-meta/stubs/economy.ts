// The real reward calculation; only the DB write is recorded.
import { harness } from './harness'

export { QUACK_ECONOMY, calculateOfficialRaceQuackRewards } from '../../../../lib/cosmetics/economy'

export async function applyQuackTransaction(_tx: unknown, input: unknown) {
  harness().record('applyQuackTransaction', input)
  return {}
}
