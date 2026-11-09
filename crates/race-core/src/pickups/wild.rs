//! Using a held box item: `activateWildItem` and the `HELD_HANDLERS`
//! (`pickups/engine.ts:374-493`). **M2 hook: the guards are ported, the
//! handlers are not.**
//!
//! The guards (`NO_ITEM`, `ITEM_CHANGED`, `SILENCED`) are exact, so manual
//! inputs replay correctly while no duck can hold a box item (pickups off).
//!
//! TS sources to port here (M2): `createWildRocket` (`:374`),
//! `createWildBanana` (`:386`), `wildHornReach` (`:405`), `HELD_HANDLERS`
//! (`:414-476`), the `NOT_USEABLE` check against `WILD_ITEM_CATALOG`
//! (`pickups/catalog.ts`), and the success tail of `activateWildItem`
//! (`:488-492`: clear `wildItem`, emit `WILD_ITEM_USED` /
//! `WILD_ITEM_AUTO_USED`).

use race_protocol::events::{HornSide, WildUseFailure};
use race_protocol::ids::PlayerId;

use crate::items::ItemRaceState;
use crate::sim::{DuckPhysicsState, Emitter};

/// `'MANUAL' | 'AUTO'`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WildUseMode {
    Manual,
    Auto,
}

/// The `input` of `activateWildItem` (`pickups/engine.ts:478`).
#[derive(Clone, Debug, PartialEq)]
pub struct WildUseInput<'a> {
    pub player_id: &'a PlayerId,
    pub wild_item_instance_id: &'a str,
    pub target_player_id: Option<&'a PlayerId>,
    pub aim_lateral: Option<f64>,
    pub horn_side: Option<HornSide>,
}

/// `WildUseResult` (`pickups/engine.ts:69-73`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WildUseResult {
    pub ok: bool,
    pub reason: Option<WildUseFailure>,
    pub target_player_id: Option<PlayerId>,
}

impl WildUseResult {
    #[must_use]
    pub const fn failed(reason: WildUseFailure) -> Self {
        Self {
            ok: false,
            reason: Some(reason),
            target_player_id: None,
        }
    }
}

/// `activateWildItem(itemState, ducks, input, tick, tickRate, mode, emit)`
/// (`pickups/engine.ts:478-493`).
///
/// # Panics
/// Until M2 lands, when the duck holds the named item and is not silenced.
#[allow(clippy::too_many_arguments)]
pub fn activate_wild_item(
    item_state: &mut ItemRaceState,
    ducks: &mut [DuckPhysicsState],
    input: &WildUseInput<'_>,
    tick: u32,
    tick_rate: u32,
    mode: WildUseMode,
    emit: &mut Emitter<'_>,
) -> WildUseResult {
    let _ = (tick_rate, mode, emit);
    let duck_exists = ducks
        .iter()
        .any(|candidate| candidate.player_id == *input.player_id);
    let Some(runtime) = item_state.by_player.get(input.player_id.as_str()) else {
        return WildUseResult::failed(WildUseFailure::NoItem);
    };
    let Some(wild) = runtime.wild_item.as_ref() else {
        return WildUseResult::failed(WildUseFailure::NoItem);
    };
    if !duck_exists {
        return WildUseResult::failed(WildUseFailure::NoItem);
    }
    if wild.instance_id != input.wild_item_instance_id {
        return WildUseResult::failed(WildUseFailure::ItemChanged);
    }
    if i64::from(tick) < runtime.silenced_until_tick {
        return WildUseResult::failed(WildUseFailure::Silenced);
    }
    todo!("M2: port the HELD_HANDLERS of activateWildItem (pickups/engine.ts:484-492)")
}
