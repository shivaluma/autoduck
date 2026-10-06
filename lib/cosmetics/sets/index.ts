import { SAKURA_SPIRIT_ITEMS } from './sakura-spirit'
import { STARLIGHT_SQUAD_ITEMS } from './starlight-squad'
import { NEON_PROTOCOL_ITEMS } from './neon-protocol'
import { IDOL_POP_ITEMS } from './idol-pop'
import { DUSK_OUTLAW_ITEMS } from './dusk-outlaw'
import type { CosmeticDefinition } from '../types'

/** Themed collections (see docs/cosmetics-v2-redesign.md · Themed sets). */
export const SET_CATALOG: CosmeticDefinition[] = [
  ...SAKURA_SPIRIT_ITEMS,
  ...STARLIGHT_SQUAD_ITEMS,
  ...NEON_PROTOCOL_ITEMS,
  ...IDOL_POP_ITEMS,
  ...DUSK_OUTLAW_ITEMS,
]
