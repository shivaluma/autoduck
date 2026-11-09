//! Lane choice: `updateIntent`, `evaluateSmartDesiredLateralOffset` and the
//! brain lane tactics (`simulation.ts:229-445`).

use alloc::vec::Vec;

use race_protocol::config::{ChaosType, ResolvedRaceConfig};
use race_protocol::events::BoostLaneTier;
use race_protocol::ids::{PickupSpawnType, RaceItemId, WildItemId};
use race_protocol::snapshot::PickupState;

use super::create::schedule_impulse;
use super::state::DuckPhysicsState;
use crate::auto_use::Brains;
use crate::config::{base_speed, core_balance};
use crate::items::DuckItemRuntime;
use crate::items::ItemRaceState;
use crate::items::config::item_balance;
use crate::js_sort::v8_sort_by;
use crate::math::{abs, cmp_f64_js, js_clamp, js_max};
use crate::pickups::PickupRaceState;
use crate::rng::DeterministicRng;
use crate::track::RaceTrack;

/// `LANE_GATE_APPETITE` (`simulation.ts:229`).
const LANE_GATE_APPETITE: f64 = 1.2;

/// The read-only parts of the simulation lane choice looks at.
pub struct LaneContext<'a> {
    pub config: &'a ResolvedRaceConfig,
    pub track: &'a RaceTrack,
    /// `state.ducks`, including the duck deciding.
    pub ducks: &'a [DuckPhysicsState],
    pub item_state: &'a ItemRaceState,
    pub brains: &'a Brains,
    pub pickup_state: &'a PickupRaceState,
    pub tick: u32,
}

/// One lane zone of `LaneTactics`.
#[derive(Clone, Copy, Debug, PartialEq)]
struct LaneZone {
    lateral: f64,
    radius: f64,
    weight: f64,
}

/// `LaneTactics` (`simulation.ts:231-238`).
#[derive(Clone, Debug, Default, PartialEq)]
struct LaneTactics {
    avoid: Vec<LaneZone>,
    seek: Vec<LaneZone>,
    break_away_from: Option<f64>,
}

/// `holdsBanana(runtime)` (`simulation.ts:240-242`).
fn holds_banana(runtime: Option<&DuckItemRuntime>) -> bool {
    runtime.is_some_and(|runtime| {
        runtime.has_unused(RaceItemId::Banana)
            || runtime
                .wild_item
                .as_ref()
                .is_some_and(|wild| wild.item_id == WildItemId::Banana)
    })
}

/// `holdsHorn(runtime)` (`simulation.ts:244-246`).
fn holds_horn(runtime: Option<&DuckItemRuntime>) -> bool {
    runtime.is_some_and(|runtime| {
        runtime.has_unused(RaceItemId::QuackHorn)
            || runtime
                .wild_item
                .as_ref()
                .is_some_and(|wild| wild.item_id == WildItemId::QuackHorn)
    })
}

/// `laneTacticsFor(state, duck)` (`simulation.ts:248-281`).
fn lane_tactics_for(ctx: &LaneContext<'_>, duck: &DuckPhysicsState) -> LaneTactics {
    let mut tactics = LaneTactics::default();
    let me = ctx.item_state.by_player.get(duck.player_id.as_str());
    let tick = i64::from(ctx.tick);
    let carries_momentum = me.is_some_and(|me| {
        me.has_unused(RaceItemId::Nitro)
            || (me.active_speed_item_id.is_some() && tick < me.boost_until_tick)
    });
    let my_banana = holds_banana(me);
    let my_horn = holds_horn(me);
    let mut pack_laterals: Vec<f64> = Vec::new();
    let mut chaser: Option<&DuckPhysicsState> = None;
    for other in ctx.ducks {
        if other.player_id == duck.player_id
            || other.finished
            || ctx
                .item_state
                .are_teammates(duck.player_id.as_str(), other.player_id.as_str())
        {
            continue;
        }
        let gap = other.progress - duck.progress;
        let runtime = ctx.item_state.by_player.get(other.player_id.as_str());
        if gap > 0.0 && gap < 0.06 && holds_banana(runtime) {
            tactics.avoid.push(LaneZone {
                lateral: other.lateral_offset,
                radius: item_balance::banana::HIT_LATERAL_RADIUS * 1.1,
                weight: 14.0,
            });
        }
        if abs(gap) < 0.06 && carries_momentum && holds_horn(runtime) {
            tactics.avoid.push(LaneZone {
                lateral: other.lateral_offset,
                radius: item_balance::horn::SIDE_REACH * 0.8,
                weight: 6.0,
            });
        }
        if gap < 0.0 && gap > -0.08 && chaser.is_none_or(|chaser| other.progress > chaser.progress)
        {
            chaser = Some(other);
        }
        if abs(gap) < 0.05 {
            pack_laterals.push(other.lateral_offset);
        }
    }
    if let Some(chaser) = chaser {
        if my_banana {
            tactics.seek.push(LaneZone {
                lateral: chaser.lateral_offset,
                radius: 0.12,
                weight: 10.0,
            });
        }
        let chaser_runtime = ctx.item_state.by_player.get(chaser.player_id.as_str());
        if duck.progress - chaser.progress < 0.035
            && abs(chaser.lateral_offset - duck.lateral_offset) < 0.2
            && chaser_runtime.is_some_and(|runtime| runtime.has_unused(RaceItemId::DraftFin))
        {
            tactics.break_away_from = Some(chaser.lateral_offset);
        }
    }
    if my_horn && pack_laterals.len() >= 2 {
        // Stand at the edge of the pack so one directional blast catches everyone.
        let sum = pack_laterals.iter().fold(0.0, |sum, &value| sum + value);
        let count = f64::from(u32::try_from(pack_laterals.len()).expect("pack fits in u32"));
        let centre = sum / count;
        let side = if duck.lateral_offset >= centre {
            1.0
        } else {
            -1.0
        };
        tactics.seek.push(LaneZone {
            lateral: centre + side * 0.35,
            radius: 0.12,
            weight: 8.0,
        });
    }
    tactics
}

/// `scoreLaneTactics(tactics, candidate)` (`simulation.ts:283-289`).
fn score_lane_tactics(tactics: &LaneTactics, candidate: f64) -> f64 {
    let mut score = 0.0;
    for zone in &tactics.avoid {
        if abs(candidate - zone.lateral) <= zone.radius {
            score -= zone.weight;
        }
    }
    for zone in &tactics.seek {
        score += zone.weight * js_max(0.0, 1.0 - abs(candidate - zone.lateral) / zone.radius);
    }
    if let Some(from) = tactics.break_away_from
        && abs(candidate - from) > 0.2
    {
        score += 8.0;
    }
    score
}

/// `evaluateSmartDesiredLateralOffset(state, duck, rng)` (`simulation.ts:291-435`).
#[must_use]
#[allow(clippy::too_many_lines)]
pub fn evaluate_smart_desired_lateral_offset(
    ctx: &LaneContext<'_>,
    duck: &DuckPhysicsState,
    rng: &mut DeterministicRng,
) -> f64 {
    const CANDIDATE_LANES: [f64; 9] = [
        -0.75, -0.6375, -0.50, -0.2125, 0.0, 0.2125, 0.50, 0.6375, 0.75,
    ];
    let preferred = rng.range(-0.80, 0.80);
    let mut candidates: Vec<f64> = Vec::from(CANDIDATE_LANES);
    candidates.push(preferred);
    candidates.push(duck.lateral_offset);

    let item_runtime = ctx.item_state.by_player.get(duck.player_id.as_str());
    let has_draft_fin =
        item_runtime.is_some_and(|runtime| runtime.has_unused(RaceItemId::DraftFin));
    let has_shield = item_runtime
        .is_some_and(|runtime| runtime.bubble_available || runtime.wild_bubble_available);
    let has_feather = item_runtime
        .is_some_and(|runtime| runtime.feather_available || runtime.wild_feather_available);

    let brain = ctx.brains.get(duck.player_id.as_str());
    // Lane tactics push a duck forward, which is wrong in REVERSE.
    let tactics = match brain {
        Some(brain)
            if !brain.ablated && ctx.config.chaos_config.chaos_type != ChaosType::Reverse =>
        {
            Some(lane_tactics_for(ctx, duck))
        }
        _ => None,
    };

    let mut best_candidate = duck.lateral_offset;
    let mut highest_score = f64::NEG_INFINITY;

    for &candidate in &candidates {
        // 1. Organic wander preference + edge penalty + lane stability.
        let mut score = 10.0 - abs(candidate - preferred) * 4.0;
        if abs(candidate) > 0.82 {
            score -= 18.0;
        }
        score += (1.0 - abs(candidate - duck.lateral_offset)) * 3.0;

        // 2. Crowd avoidance.
        for other in ctx.ducks {
            if other.player_id == duck.player_id || other.finished {
                continue;
            }
            let d_progress = abs(duck.progress - other.progress);
            if d_progress < 0.065 {
                let d_lateral = abs(candidate - other.lateral_offset);
                if d_lateral < 0.24 {
                    let proximity_weight = (1.0 - d_progress / 0.065) * (1.0 - d_lateral / 0.24);
                    score -= proximity_weight * 36.0;
                    if other.progress > duck.progress && d_progress < 0.035 && d_lateral < 0.12 {
                        score -= 24.0;
                    }
                }
            }
        }

        // 3. Drafting behind the nearest duck ahead.
        if has_draft_fin {
            let mut ahead: Vec<&DuckPhysicsState> = ctx
                .ducks
                .iter()
                .filter(|c| {
                    !c.finished
                        && c.player_id != duck.player_id
                        && c.progress > duck.progress
                        && c.progress - duck.progress <= 0.035
                })
                .collect();
            v8_sort_by(&mut ahead, |left, right| {
                cmp_f64_js(left.progress, right.progress)
            });
            if let Some(ahead) = ahead.first()
                && abs(candidate - ahead.lateral_offset) <= 0.08
            {
                score += 26.0;
            }
        }

        // 4. Boost gate lanes.
        if let Some(upcoming_gate) =
            ctx.track.boost_gates.iter().find(|gate| {
                gate.progress > duck.progress && gate.progress - duck.progress <= 0.095
            })
        {
            let d_gate = upcoming_gate.progress - duck.progress;
            let proximity_weight = 1.0 - d_gate / 0.095;
            let target_lane = upcoming_gate.lane_at(candidate);

            let gate_reward = match target_lane.tier {
                BoostLaneTier::Hyper => 36.0,
                BoostLaneTier::Super => 24.0,
                BoostLaneTier::Standard => 12.0,
                BoostLaneTier::Neutral => 2.0,
            };

            let mut competitors_in_lane = 0.0;
            for other in ctx.ducks {
                if other.player_id == duck.player_id || other.finished {
                    continue;
                }
                let other_progress_dist = abs(duck.progress - other.progress);
                if other_progress_dist < 0.07
                    && other.lateral_offset >= target_lane.min_lateral - 0.06
                    && other.lateral_offset <= target_lane.max_lateral + 0.06
                {
                    competitors_in_lane += 1.0;
                }
            }

            let crowd_penalty = match target_lane.tier {
                BoostLaneTier::Hyper => competitors_in_lane * 22.0,
                BoostLaneTier::Super => competitors_in_lane * 14.0,
                BoostLaneTier::Standard => competitors_in_lane * 8.0,
                BoostLaneTier::Neutral => competitors_in_lane * 3.0,
            };

            let lane_alignment_bonus =
                (1.0 - abs(candidate - target_lane.center_lateral) / 0.25) * 5.0;
            let appetite = if tactics.is_some() {
                LANE_GATE_APPETITE
            } else {
                1.0
            };
            score += (gate_reward * appetite - crowd_penalty / appetite + lane_alignment_bonus)
                * proximity_weight;
        }

        // 5. Bananas and hazards.
        for banana in &ctx.item_state.bananas {
            let d_progress = banana.progress - duck.progress;
            if d_progress > 0.0
                && d_progress < 0.045
                && abs(candidate - banana.lateral_offset) <= banana.hit_lateral_radius * 1.4
            {
                score -= if has_shield {
                    20.0
                } else if has_feather {
                    40.0
                } else {
                    55.0
                };
            }
        }
        for hazard in &ctx.pickup_state.hazards {
            let d_progress = hazard.progress - duck.progress;
            if d_progress > 0.0
                && d_progress < 0.05
                && abs(candidate - hazard.lateral_offset) <= hazard.radius * 1.3
            {
                score -= 45.0;
            }
        }

        // 6. Box attraction.
        if let Some(runtime) = item_runtime
            && runtime.regular_pickup_count < ctx.pickup_state.config.regular_pickup_cap
            && runtime.wild_item.is_none()
        {
            for pickup in &ctx.pickup_state.pickups {
                if pickup.state != PickupState::Active {
                    continue;
                }
                let d_progress = pickup.progress - duck.progress;
                if d_progress > 0.0
                    && d_progress < 0.055
                    && abs(candidate - pickup.lateral_offset) <= 0.14
                {
                    score += if pickup.spawn_type == PickupSpawnType::GoldenBox {
                        42.0
                    } else {
                        22.0
                    };
                }
            }
        }

        // 7. Brain lane tactics.
        if let Some(tactics) = &tactics {
            score += score_lane_tactics(tactics, candidate);
        }

        // 8. Jitter.
        score += rng.range(-1.5, 1.5);

        if score > highest_score {
            highest_score = score;
            best_candidate = candidate;
        }
    }

    js_clamp(best_candidate + rng.range(-0.03, 0.03), -0.85, 0.85)
}

/// `updateIntent(state, duck)` (`simulation.ts:437-445`): a new impulse when
/// the duck's timer is due.
pub fn update_intent(
    ctx: &LaneContext<'_>,
    duck_index: usize, // usize-ok: function parameter, never stored
    rng: &mut DeterministicRng,
) -> Option<IntentUpdate> {
    let duck = &ctx.ducks[duck_index];
    if ctx.tick < duck.next_impulse_tick {
        return None;
    }
    let base_speed = base_speed();
    let desired_speed = base_speed
        * rng.range(
            1.0 - core_balance::SPEED_VARIATION,
            1.0 + core_balance::SPEED_VARIATION,
        );
    let acceleration = rng.range(
        -core_balance::ACCELERATION_VARIATION,
        core_balance::ACCELERATION_VARIATION,
    ) * base_speed;
    let desired_lateral_offset = evaluate_smart_desired_lateral_offset(ctx, duck, rng);
    let next_impulse_tick = schedule_impulse(rng, ctx.tick, ctx.config.tick_rate);
    Some(IntentUpdate {
        desired_speed,
        acceleration,
        desired_lateral_offset,
        next_impulse_tick,
    })
}

/// What `updateIntent` writes into the duck.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct IntentUpdate {
    pub desired_speed: f64,
    pub acceleration: f64,
    pub desired_lateral_offset: f64,
    pub next_impulse_tick: u32,
}

impl IntentUpdate {
    /// Writes the update into `duck`.
    pub fn apply(self, duck: &mut DuckPhysicsState) {
        duck.desired_speed = self.desired_speed;
        duck.acceleration = self.acceleration;
        duck.desired_lateral_offset = self.desired_lateral_offset;
        duck.next_impulse_tick = self.next_impulse_tick;
    }
}
