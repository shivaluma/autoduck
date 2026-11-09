//! Auto-use candidate types (`packages/race-core/src/auto-use/types.ts:6-34`).
//! `RaceObjectiveContext` is in [`super::objective`].

use alloc::string::String;

use race_protocol::events::{AiIntent, AutoUseReason, HornSide};
use race_protocol::ids::{ItemKey, PlayerId};

/// `'PREP' | 'WILD'`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CandidateSource {
    Prep,
    Wild,
}

/// `'USE' | 'DISCARD'`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CandidateAction {
    Use,
    Discard,
}

/// `AutoUseCandidate` (`types.ts:15-32`). M3 decides how to model
/// `AutoUseCandidateDraft` (the same without `playerId`).
#[derive(Clone, Debug, PartialEq)]
pub struct AutoUseCandidate {
    pub player_id: PlayerId,
    pub item_key: String,
    /// `RaceItemId | WildItemId`.
    pub item_id: ItemKey,
    pub source: CandidateSource,
    pub action: CandidateAction,
    pub score: f64,
    pub target_player_id: Option<PlayerId>,
    pub reason: AutoUseReason,
    pub bypass_threshold: Option<bool>,
    pub wild_item_instance_id: Option<String>,
    /// Shown as an `AI_INTENT` event when it fires.
    pub intent: Option<AiIntent>,
    /// Banana: lane to toss the peel onto.
    pub aim_lateral: Option<f64>,
    /// Quack Horn: side to blast.
    pub horn_side: Option<HornSide>,
}
