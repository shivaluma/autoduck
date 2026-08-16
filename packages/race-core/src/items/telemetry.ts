import type { RaceEvent, RaceItemId } from '../../../race-protocol/src'

export function itemActivationForEvent(event: RaceEvent): { playerId: string; itemId: RaceItemId } | null {
  if (!event.sourcePlayerId) return null
  if (event.type === 'ROCKET_FIRED') return { playerId: event.sourcePlayerId, itemId: 'HOMING_ROCKET' }
  if (event.type === 'BANANA_DROPPED') return { playerId: event.sourcePlayerId, itemId: 'BANANA' }
  if (event.type === 'NITRO_STARTED') return { playerId: event.sourcePlayerId, itemId: 'NITRO' }
  if (event.type === 'DRAFT_FIN_STARTED') return { playerId: event.sourcePlayerId, itemId: 'DRAFT_FIN' }
  if (event.type === 'PADDLE_BURST_STARTED') return { playerId: event.sourcePlayerId, itemId: 'PADDLE_BURST' }
  if (event.type === 'HORN_USED') return { playerId: event.sourcePlayerId, itemId: 'QUACK_HORN' }
  if (event.type === 'BUBBLE_SHIELD_ACTIVATED' || event.type === 'BUBBLE_POPPED') return { playerId: event.sourcePlayerId, itemId: 'BUBBLE_SHIELD' }
  if (event.type === 'FEATHER_DODGED') return { playerId: event.sourcePlayerId, itemId: 'FEATHER' }
  if (event.type === 'SHOCK_ABSORBER_PROC') return { playerId: event.targetPlayerId ?? event.sourcePlayerId, itemId: 'SHOCK_ABSORBER' }
  return null
}

export function itemSuccessForEvent(event: RaceEvent): { playerId: string; itemId: RaceItemId } | null {
  if (event.type === 'ROCKET_HIT') return event.sourcePlayerId ? { playerId: event.sourcePlayerId, itemId: 'HOMING_ROCKET' } : null
  if (event.type === 'BANANA_HIT') return event.sourcePlayerId ? { playerId: event.sourcePlayerId, itemId: 'BANANA' } : null
  if (event.type === 'NITRO_STARTED') return event.sourcePlayerId ? { playerId: event.sourcePlayerId, itemId: 'NITRO' } : null
  if (event.type === 'DRAFT_FIN_STARTED') return event.sourcePlayerId ? { playerId: event.sourcePlayerId, itemId: 'DRAFT_FIN' } : null
  if (event.type === 'PADDLE_BURST_STARTED') return event.sourcePlayerId ? { playerId: event.sourcePlayerId, itemId: 'PADDLE_BURST' } : null
  if (event.type === 'HORN_USED') return event.sourcePlayerId ? { playerId: event.sourcePlayerId, itemId: 'QUACK_HORN' } : null
  if (event.type === 'BUBBLE_POPPED') return event.sourcePlayerId ? { playerId: event.sourcePlayerId, itemId: 'BUBBLE_SHIELD' } : null
  if (event.type === 'FEATHER_DODGED') return event.sourcePlayerId ? { playerId: event.sourcePlayerId, itemId: 'FEATHER' } : null
  if (event.type === 'SHOCK_ABSORBER_PROC') return event.targetPlayerId ? { playerId: event.targetPlayerId, itemId: 'SHOCK_ABSORBER' } : null
  if (event.type === 'BOOST_BROKEN') return event.targetPlayerId ? { playerId: event.sourcePlayerId ?? event.targetPlayerId, itemId: 'HOMING_ROCKET' } : null
  return null
}
