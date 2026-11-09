//! `resolveCollisions(state)` (`simulation.ts:447-493`).

use alloc::collections::BTreeMap;
use alloc::format;
use alloc::string::String;
use alloc::vec::Vec;

use race_protocol::events::{EmptyMeta, EventKind};

use super::events::Emitter;
use super::id_cmp;
use super::state::DuckPhysicsState;
use crate::config::core_balance;
use crate::items::config::item_balance;
use crate::items::{ItemRaceState, LoadoutCombo};
use crate::js_sort::v8_sort_by;
use crate::math::{abs, js_clamp, js_max, js_round, js_sign};

/// Pairwise duck contact: lateral push and speed loss, accumulated over all
/// pairs and applied at the end. `DUCK_COLLISION` is emitted only while
/// events are recorded, at most once per half second per pair key.
pub fn resolve_collisions(
    ducks: &mut [DuckPhysicsState],
    item_state: &ItemRaceState,
    last_collision_event_tick: &mut BTreeMap<String, u32>,
    tick: u32,
    tick_rate: u32,
    emit: &mut Emitter<'_>,
) {
    let mut active: Vec<usize> = (0..ducks.len())
        .filter(|&index| !ducks[index].finished)
        .collect();
    v8_sort_by(&mut active, |&left, &right| {
        id_cmp(
            ducks[left].player_id.as_str(),
            ducks[right].player_id.as_str(),
        )
    });
    // `new Map(active.map((duck) => [duck.playerId, 0]))`, indexed like `active`.
    let mut lateral_delta: Vec<f64> = Vec::from_iter(core::iter::repeat_n(0.0, active.len()));
    let mut speed_delta: Vec<f64> = Vec::from_iter(core::iter::repeat_n(0.0, active.len()));
    let event_gap = js_round(f64::from(tick_rate) * 0.5);

    for left_slot in 0..active.len() {
        for right_slot in (left_slot + 1)..active.len() {
            let left = &ducks[active[left_slot]];
            let right = &ducks[active[right_slot]];
            let progress_distance = abs(left.progress - right.progress);
            let lateral_distance = abs(left.lateral_offset - right.lateral_offset);
            if progress_distance >= core_balance::COLLISION_PROGRESS_RADIUS
                || lateral_distance >= core_balance::COLLISION_LATERAL_RADIUS
            {
                continue;
            }

            let direction = if left.lateral_offset == right.lateral_offset {
                if id_cmp(left.player_id.as_str(), right.player_id.as_str()).is_lt() {
                    -1.0
                } else {
                    1.0
                }
            } else {
                js_sign(left.lateral_offset - right.lateral_offset)
            };
            let overlap = 1.0 - lateral_distance / core_balance::COLLISION_LATERAL_RADIUS;
            let push = core_balance::COLLISION_PUSH * overlap;
            let left_is_fortress = item_state
                .by_player
                .get(left.player_id.as_str())
                .is_some_and(|runtime| runtime.loadout_combo == Some(LoadoutCombo::Fortress));
            let right_is_fortress = item_state
                .by_player
                .get(right.player_id.as_str())
                .is_some_and(|runtime| runtime.loadout_combo == Some(LoadoutCombo::Fortress));
            let left_push = if left_is_fortress {
                push * item_balance::fortress::COLLISION_PUSH_MULTIPLIER
            } else {
                push
            };
            let right_push = if right_is_fortress {
                push * item_balance::fortress::COLLISION_PUSH_MULTIPLIER
            } else {
                push
            };
            let left_speed_loss = if left_is_fortress {
                core_balance::COLLISION_SPEED_LOSS
                    * item_balance::fortress::COLLISION_SPEED_LOSS_MULTIPLIER
            } else {
                core_balance::COLLISION_SPEED_LOSS
            };
            let right_speed_loss = if right_is_fortress {
                core_balance::COLLISION_SPEED_LOSS
                    * item_balance::fortress::COLLISION_SPEED_LOSS_MULTIPLIER
            } else {
                core_balance::COLLISION_SPEED_LOSS
            };
            lateral_delta[left_slot] += direction * left_push;
            lateral_delta[right_slot] -= direction * right_push;
            speed_delta[left_slot] -= left_speed_loss * overlap * left.speed;
            speed_delta[right_slot] -= right_speed_loss * overlap * right.speed;

            let pair_key = format!("{}:{}", left.player_id, right.player_id);
            let recent = last_collision_event_tick
                .get(&pair_key)
                .is_some_and(|&last| f64::from(tick) - f64::from(last) < event_gap);
            if emit.recording() && !recent {
                let (source, target) = (left.player_id.clone(), right.player_id.clone());
                emit.emit(
                    EventKind::DuckCollision(EmptyMeta {}),
                    Some(&source),
                    Some(&target),
                );
                last_collision_event_tick.insert(pair_key, tick);
            }
        }
    }

    for (slot, &index) in active.iter().enumerate() {
        let duck = &mut ducks[index];
        duck.lateral_offset = js_clamp(duck.lateral_offset + lateral_delta[slot], -0.95, 0.95);
        duck.speed = js_max(0.001, duck.speed + speed_delta[slot]);
    }
}
