//! `ChaosUtility` (`packages/race-core/src/auto-use/chaos-utility.ts`).
//! **M3 hook: only the constructor is ported.**
//!
//! Phase A keeps its memo caches as **plain fields** with the TS hit/miss
//! conditions: `snapshot` is reused while the ranking fingerprint
//! (`ducks.length + Σ progress·(index + 1.618) + (finished ? 7 : 0)`)
//! compares `===` equal, and `outcomeCache` is cleared whenever a new
//! snapshot is taken. `Math.exp` (`:107,131`) must go through
//! `sim::EngineMath::exp`.

use alloc::vec::Vec;

use race_protocol::config::{ChaosType, RaceChaosConfig};
use race_protocol::ids::PlayerId;

/// `ChaosUtility` state. M3 adds `snapshot` and `outcomeCache` here.
#[derive(Clone, Debug, PartialEq)]
pub struct ChaosUtility {
    /// `config.chaosConfig?.type ?? 'NORMAL'`.
    pub mode: ChaosType,
    /// `prepared.targetPlayerId`.
    pub target_player_id: Option<PlayerId>,
    /// `prepared.groups`.
    pub groups: Vec<Vec<PlayerId>>,
}

impl ChaosUtility {
    /// `new ChaosUtility(config)` (`chaos-utility.ts:37-43`). An absent
    /// `chaosConfig` is the resolved default (`NORMAL`, no target, no groups).
    #[must_use]
    pub fn new(chaos: &RaceChaosConfig) -> Self {
        Self {
            mode: chaos.chaos_type,
            target_player_id: chaos.target_player_id.clone(),
            groups: chaos.groups.clone(),
        }
    }
}
