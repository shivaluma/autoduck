import { ITEM_BALANCE } from './config'

export type IncomingRaceEffect = 'ROCKET' | 'BANANA' | 'QUACK_HORN' | 'NATURAL_OBSTACLE' | 'DUCK_COLLISION'
export type DefenseOutcome = 'HIT' | 'BLOCKED_BUBBLE' | 'DODGED_FEATHER' | 'IMMUNE'

export const ITEM_INTERACTION_MATRIX = {
  ROCKET: { bubbleShield: 'BLOCK', feather: 'NO' },
  BANANA: { bubbleShield: 'BLOCK', feather: 'DODGE' },
  QUACK_HORN: { bubbleShield: 'NO', feather: 'NO' },
  NATURAL_OBSTACLE: { bubbleShield: 'NO', feather: 'NO' },
  DUCK_COLLISION: { bubbleShield: 'NO', feather: 'NO' },
} as const

export interface ItemDefenseState {
  bubbleAvailable: boolean
  featherAvailable: boolean
  itemImmunityUntilTick: number
  rocketProtectionUntilTick: number
}

export function resolveIncomingRaceEffect(
  defense: ItemDefenseState,
  incoming: IncomingRaceEffect,
  tick: number,
  tickRate: number,
): DefenseOutcome {
  if ((incoming === 'ROCKET' || incoming === 'BANANA') && tick < defense.itemImmunityUntilTick) return 'IMMUNE'

  if ((incoming === 'ROCKET' || incoming === 'BANANA') && defense.bubbleAvailable) {
    defense.bubbleAvailable = false
    defense.itemImmunityUntilTick = tick + Math.round(ITEM_BALANCE.bubblePopImmunitySeconds * tickRate)
    return 'BLOCKED_BUBBLE'
  }

  if (incoming === 'BANANA' && defense.featherAvailable) {
    defense.featherAvailable = false
    return 'DODGED_FEATHER'
  }

  if (incoming === 'ROCKET' || incoming === 'BANANA') {
    defense.itemImmunityUntilTick = tick + Math.round(ITEM_BALANCE.hitImmunitySeconds * tickRate)
    if (incoming === 'ROCKET') defense.rocketProtectionUntilTick = tick + Math.round(ITEM_BALANCE.rocketTargetProtectionSeconds * tickRate)
  }
  return 'HIT'
}
