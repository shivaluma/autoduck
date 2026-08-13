import type { RaceEvent, RaceItemId } from '../../../race-protocol/src'

export function itemActivationForEvent(event: RaceEvent): { playerId: string; itemId: RaceItemId } | null {
  if (!event.sourcePlayerId) return null
  if (event.type === 'ROCKET_FIRED') return { playerId: event.sourcePlayerId, itemId: 'HOMING_ROCKET' }
  if (event.type === 'BANANA_DROPPED') return { playerId: event.sourcePlayerId, itemId: 'BANANA' }
  if (event.type === 'NITRO_STARTED') return { playerId: event.sourcePlayerId, itemId: 'NITRO' }
  if (event.type === 'HORN_USED') return { playerId: event.sourcePlayerId, itemId: 'QUACK_HORN' }
  if (event.type === 'BUBBLE_POPPED') return { playerId: event.sourcePlayerId, itemId: 'BUBBLE_SHIELD' }
  if (event.type === 'FEATHER_DODGED') return { playerId: event.sourcePlayerId, itemId: 'FEATHER' }
  return null
}

export function itemSuccessForEvent(event: RaceEvent): { playerId: string; itemId: RaceItemId } | null {
  if (!event.sourcePlayerId) return null
  if (event.type === 'ROCKET_HIT') return { playerId: event.sourcePlayerId, itemId: 'HOMING_ROCKET' }
  if (event.type === 'BANANA_HIT') return { playerId: event.sourcePlayerId, itemId: 'BANANA' }
  if (event.type === 'NITRO_STARTED') return { playerId: event.sourcePlayerId, itemId: 'NITRO' }
  if (event.type === 'HORN_USED') return { playerId: event.sourcePlayerId, itemId: 'QUACK_HORN' }
  if (event.type === 'BUBBLE_POPPED') return { playerId: event.sourcePlayerId, itemId: 'BUBBLE_SHIELD' }
  if (event.type === 'FEATHER_DODGED') return { playerId: event.sourcePlayerId, itemId: 'FEATHER' }
  return null
}
