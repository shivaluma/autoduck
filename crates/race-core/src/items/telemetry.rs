//! Which prep item an event activates or credits:
//! `itemActivationForEvent` / `itemSuccessForEvent`
//! (`packages/race-core/src/items/telemetry.ts`, S3.15). Used by race
//! telemetry, never by the simulation.
//!
//! TS tests `!event.sourcePlayerId` / `event.sourcePlayerId ? ...` for
//! truthiness, so an empty id counts as absent; engine ids are never empty
//! (D6), but the check is kept.

use race_protocol::events::{EventKind, RaceEvent};
use race_protocol::ids::{PlayerId, RaceItemId};

/// `{playerId, itemId}`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ItemEventCredit {
    pub player_id: PlayerId,
    pub item_id: RaceItemId,
}

/// A JS-truthy player id.
fn truthy(id: Option<&PlayerId>) -> Option<&PlayerId> {
    id.filter(|id| !id.as_str().is_empty())
}

fn credit(player_id: &PlayerId, item_id: RaceItemId) -> Option<ItemEventCredit> {
    Some(ItemEventCredit {
        player_id: player_id.clone(),
        item_id,
    })
}

/// `itemActivationForEvent(event)` (`telemetry.ts:3-15`).
#[must_use]
pub fn item_activation_for_event(event: &RaceEvent) -> Option<ItemEventCredit> {
    let source = truthy(event.source_player_id.as_ref())?;
    match &event.kind {
        EventKind::RocketFired(_) => credit(source, RaceItemId::HomingRocket),
        EventKind::BananaDropped(_) => credit(source, RaceItemId::Banana),
        EventKind::NitroStarted(_) => credit(source, RaceItemId::Nitro),
        EventKind::DraftFinStarted(_) => credit(source, RaceItemId::DraftFin),
        EventKind::PaddleBurstStarted(_) => credit(source, RaceItemId::PaddleBurst),
        EventKind::HornUsed(_) => credit(source, RaceItemId::QuackHorn),
        EventKind::BubbleShieldActivated(_) | EventKind::BubblePopped(_) => {
            credit(source, RaceItemId::BubbleShield)
        }
        EventKind::FeatherDodged(_) => credit(source, RaceItemId::Feather),
        // `event.targetPlayerId ?? event.sourcePlayerId` (nullish, not truthy).
        EventKind::ShockAbsorberProc(_) => credit(
            event.target_player_id.as_ref().unwrap_or(source),
            RaceItemId::ShockAbsorber,
        ),
        _ => None,
    }
}

/// `itemSuccessForEvent(event)` (`telemetry.ts:17-29`).
#[must_use]
pub fn item_success_for_event(event: &RaceEvent) -> Option<ItemEventCredit> {
    let source = truthy(event.source_player_id.as_ref());
    let target = truthy(event.target_player_id.as_ref());
    match &event.kind {
        EventKind::RocketHit(_) => credit(source?, RaceItemId::HomingRocket),
        EventKind::BananaHit(_) => credit(source?, RaceItemId::Banana),
        EventKind::NitroStarted(_) => credit(source?, RaceItemId::Nitro),
        EventKind::DraftFinStarted(_) => credit(source?, RaceItemId::DraftFin),
        EventKind::PaddleBurstStarted(_) => credit(source?, RaceItemId::PaddleBurst),
        EventKind::HornUsed(_) => credit(source?, RaceItemId::QuackHorn),
        EventKind::BubblePopped(_) => credit(source?, RaceItemId::BubbleShield),
        EventKind::FeatherDodged(_) => credit(source?, RaceItemId::Feather),
        EventKind::ShockAbsorberProc(_) => credit(target?, RaceItemId::ShockAbsorber),
        // `event.targetPlayerId ? {playerId: event.sourcePlayerId ??
        // event.targetPlayerId, itemId: 'HOMING_ROCKET'} : null`. Quirk kept:
        // every boost break (banana, horn, ...) is credited to the rocket.
        EventKind::BoostBroken(_) => {
            let target = target?;
            credit(
                event.source_player_id.as_ref().unwrap_or(target),
                RaceItemId::HomingRocket,
            )
        }
        _ => None,
    }
}
