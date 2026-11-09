//! Ghost ducks: `packages/race-core/src/ghost.ts` (S3.15).
//!
//! A ghost races like any duck but never appears in the standings and can't
//! be targeted by rockets.

use alloc::vec::Vec;

use race_protocol::config::ResolvedRaceConfig;
use race_protocol::ids::PlayerId;

/// `ghostPlayerIdsFromConfig(config)` (`ghost.ts:3-5`): the ghost ids in
/// `config.players` order (a JS `Set` iterates in insertion order).
#[must_use]
pub fn ghost_player_ids_from_config(config: &ResolvedRaceConfig) -> Vec<PlayerId> {
    let mut ids: Vec<PlayerId> = Vec::new();
    for player in &config.players {
        if player.is_ghost && !ids.contains(&player.player_id) {
            ids.push(player.player_id.clone());
        }
    }
    ids
}

/// `isGhostPlayerId(config, playerId)` (`ghost.ts:7-9`).
#[must_use]
pub fn is_ghost_player_id(config: &ResolvedRaceConfig, player_id: &str) -> bool {
    config
        .players
        .iter()
        .any(|player| player.player_id.as_str() == player_id && player.is_ghost)
}
