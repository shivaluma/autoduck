//! Aimable items (`packages/race-core/src/items/aim.ts`, S3.15). Bananas can
//! be tossed sideways onto a chaser's line; the Quack Horn blasts one side.
//! Callers without an aim (manual taps, legacy brains) get deterministic
//! defaults.
//!
//! The TS helpers are generic over `T extends AimDuck` and return the
//! filtered ducks. Here they return **indices** into the `ducks` slice, in
//! slice order, so callers can mutate the hit ducks afterwards.

use alloc::vec::Vec;

use race_protocol::events::HornSide;

use crate::math::{abs, js_max, js_min};
use crate::sim::DuckPhysicsState;

/// `AimDuck` (`aim.ts:8-13`).
pub trait AimDuck {
    fn aim_player_id(&self) -> &str;
    fn aim_progress(&self) -> f64;
    fn aim_lateral_offset(&self) -> f64;
    fn aim_finished(&self) -> bool;
}

impl AimDuck for DuckPhysicsState {
    fn aim_player_id(&self) -> &str {
        self.player_id.as_str()
    }
    fn aim_progress(&self) -> f64 {
        self.progress
    }
    fn aim_lateral_offset(&self) -> f64 {
        self.lateral_offset
    }
    fn aim_finished(&self) -> bool {
        self.finished
    }
}

impl<T: AimDuck + ?Sized> AimDuck for &T {
    fn aim_player_id(&self) -> &str {
        (**self).aim_player_id()
    }
    fn aim_progress(&self) -> f64 {
        (**self).aim_progress()
    }
    fn aim_lateral_offset(&self) -> f64 {
        (**self).aim_lateral_offset()
    }
    fn aim_finished(&self) -> bool {
        (**self).aim_finished()
    }
}

/// `clampLateral` (`aim.ts:15`): `Math.max(-0.95, Math.min(0.95, value))`.
#[must_use]
pub fn clamp_lateral(value: f64) -> f64 {
    js_max(-0.95, js_min(0.95, value))
}

/// `aimedBananaLateral(dropperLateral, aimLateral, maxOffset)` (`aim.ts:18-21`):
/// the requested lane, limited to `max_offset` from the dropper's own lane.
#[must_use]
pub fn aimed_banana_lateral(
    dropper_lateral: f64,
    aim_lateral: Option<f64>,
    max_offset: f64,
) -> f64 {
    let Some(aim_lateral) = aim_lateral.filter(|aim| aim.is_finite()) else {
        return dropper_lateral;
    };
    clamp_lateral(
        dropper_lateral
            + js_max(
                -max_offset,
                js_min(max_offset, aim_lateral - dropper_lateral),
            ),
    )
}

/// `side` as the JS number `-1 | 1`.
fn side_sign(side: HornSide) -> f64 {
    f64::from(side.sign())
}

/// `hornSideTargets(horner, ducks, side, progressRadius, sideReach,
/// centerBand, isIgnored)` (`aim.ts:24-39`): indices of the ducks caught by
/// a horn blasting toward `side` (that half-plane plus a narrow band straight
/// ahead/behind), in `ducks` order. `is_ignored` defaults to `|_| false` in
/// TS.
#[must_use]
pub fn horn_side_targets<H: AimDuck + ?Sized, T: AimDuck>(
    horner: &H,
    ducks: &[T],
    side: HornSide,
    progress_radius: f64,
    side_reach: f64,
    center_band: f64,
    mut is_ignored: impl FnMut(&T) -> bool,
) -> Vec<usize> {
    let sign = side_sign(side);
    (0..ducks.len())
        .filter(|&index| {
            let candidate = &ducks[index];
            if candidate.aim_player_id() == horner.aim_player_id()
                || candidate.aim_finished()
                || is_ignored(candidate)
            {
                return false;
            }
            if abs(candidate.aim_progress() - horner.aim_progress()) > progress_radius {
                return false;
            }
            let relative = (candidate.aim_lateral_offset() - horner.aim_lateral_offset()) * sign;
            relative >= -center_band && relative <= side_reach
        })
        .collect()
}

/// `defaultHornSide(horner, ducks, progressRadius, sideReach, centerBand,
/// isIgnored)` (`aim.ts:42-54`): wherever more ducks are; ties toward the
/// middle of the river.
#[must_use]
pub fn default_horn_side<H: AimDuck + ?Sized, T: AimDuck>(
    horner: &H,
    ducks: &[T],
    progress_radius: f64,
    side_reach: f64,
    center_band: f64,
    mut is_ignored: impl FnMut(&T) -> bool,
) -> HornSide {
    let left = horn_side_targets(
        horner,
        ducks,
        HornSide::Left,
        progress_radius,
        side_reach,
        center_band,
        &mut is_ignored,
    )
    .len();
    let right = horn_side_targets(
        horner,
        ducks,
        HornSide::Right,
        progress_radius,
        side_reach,
        center_band,
        &mut is_ignored,
    )
    .len();
    if left != right {
        return if left > right {
            HornSide::Left
        } else {
            HornSide::Right
        };
    }
    if horner.aim_lateral_offset() > 0.0 {
        HornSide::Left
    } else {
        HornSide::Right
    }
}
