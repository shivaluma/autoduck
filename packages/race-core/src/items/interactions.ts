import { ITEM_BALANCE } from './config'

export type IncomingRaceEffect = 'ROCKET' | 'MINI_ROCKET' | 'BANANA' | 'WILD_BANANA' | 'MINOR_HAZARD' | 'QUACK_HORN' | 'NATURAL_OBSTACLE' | 'DUCK_COLLISION'
export type DefenseOutcome = 'HIT' | 'BLOCKED_BUBBLE' | 'BLOCKED_MINI_BUBBLE' | 'DODGED_FEATHER' | 'DODGED_WILD_FEATHER' | 'IMMUNE'

export const ITEM_INTERACTION_MATRIX = {
  ROCKET: { bubbleShield: 'BLOCK', feather: 'NO' },
  BANANA: { bubbleShield: 'BLOCK', feather: 'DODGE' },
  QUACK_HORN: { bubbleShield: 'NO', feather: 'NO' },
  NATURAL_OBSTACLE: { bubbleShield: 'NO', feather: 'NO' },
  DUCK_COLLISION: { bubbleShield: 'NO', feather: 'NO' },
  MINI_ROCKET: { bubbleShield: 'BLOCK', feather: 'NO' },
  WILD_BANANA: { bubbleShield: 'BLOCK', feather: 'DODGE' },
  MINOR_HAZARD: { bubbleShield: 'NO', feather: 'DODGE' },
} as const

export interface ItemDefenseState {
  bubbleAvailable: boolean
  featherAvailable: boolean
  itemImmunityUntilTick: number
  rocketProtectionUntilTick: number
  wildBubbleAvailable?: boolean
  wildBubbleUntilTick?: number
  wildFeatherAvailable?: boolean
  wildFeatherUntilTick?: number
}

export function resolveIncomingRaceEffect(
  defense: ItemDefenseState,
  incoming: IncomingRaceEffect,
  tick: number,
  tickRate: number,
): DefenseOutcome {
  const offensive = incoming === 'ROCKET' || incoming === 'MINI_ROCKET' || incoming === 'BANANA' || incoming === 'WILD_BANANA'
  const rocket = incoming === 'ROCKET' || incoming === 'MINI_ROCKET'
  const banana = incoming === 'BANANA' || incoming === 'WILD_BANANA'
  if (offensive && tick < defense.itemImmunityUntilTick) return 'IMMUNE'

  if (offensive && defense.wildBubbleAvailable && tick < (defense.wildBubbleUntilTick ?? 0)) {
    defense.wildBubbleAvailable = false
    defense.itemImmunityUntilTick = tick + Math.round(ITEM_BALANCE.bubblePopImmunitySeconds * tickRate)
    return 'BLOCKED_MINI_BUBBLE'
  }

  if (offensive && defense.bubbleAvailable) {
    defense.bubbleAvailable = false
    defense.itemImmunityUntilTick = tick + Math.round(ITEM_BALANCE.bubblePopImmunitySeconds * tickRate)
    return 'BLOCKED_BUBBLE'
  }

  if ((banana || incoming === 'MINOR_HAZARD') && defense.wildFeatherAvailable && tick < (defense.wildFeatherUntilTick ?? 0)) {
    defense.wildFeatherAvailable = false
    return 'DODGED_WILD_FEATHER'
  }

  if (banana && defense.featherAvailable) {
    defense.featherAvailable = false
    return 'DODGED_FEATHER'
  }

  if (offensive) {
    defense.itemImmunityUntilTick = tick + Math.round(ITEM_BALANCE.hitImmunitySeconds * tickRate)
    if (rocket) defense.rocketProtectionUntilTick = tick + Math.round(ITEM_BALANCE.rocketTargetProtectionSeconds * tickRate)
  }
  return 'HIT'
}
