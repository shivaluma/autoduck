//! `updateRanks(state)` (`simulation.ts:495-503`).

use alloc::vec::Vec;
use core::cmp::Ordering;

use super::id_cmp;
use super::state::DuckPhysicsState;
use crate::js_sort::v8_sort_by;
use crate::math::cmp_f64_js;

/// The rank comparator: finished ducks first by finish time, then racing
/// ducks by progress (descending), ties by `playerId.localeCompare`.
#[must_use]
pub fn rank_order(left: &DuckPhysicsState, right: &DuckPhysicsState) -> Ordering {
    let by_id = || id_cmp(left.player_id.as_str(), right.player_id.as_str());
    match (left.finished, right.finished) {
        (true, true) => {
            // `left.finishTimeMs! - right.finishTimeMs!`: a finished duck
            // always has a finish time.
            let left_time = left
                .finish_time_ms
                .expect("finished duck has a finish time");
            let right_time = right
                .finish_time_ms
                .expect("finished duck has a finish time");
            cmp_f64_js(left_time, right_time).then_with(by_id)
        }
        (true, false) => Ordering::Less,
        (false, true) => Ordering::Greater,
        (false, false) => cmp_f64_js(right.progress, left.progress).then_with(by_id),
    }
}

/// `updateRanks(state)`: 1-based `currentRank` from [`rank_order`].
pub fn update_ranks(ducks: &mut [DuckPhysicsState]) {
    let mut ordered: Vec<usize> = (0..ducks.len()).collect();
    v8_sort_by(&mut ordered, |&left, &right| {
        rank_order(&ducks[left], &ducks[right])
    });
    for (rank, &index) in ordered.iter().enumerate() {
        ducks[index].current_rank = u32::try_from(rank + 1).expect("rank fits in u32");
    }
}
