//! Duck brains: seeded temperament plus race memory
//! (`packages/race-core/src/auto-use/brain.ts`, S3.15).
//!
//! Ported: the temperament table, `createDuckBrains` (it emits
//! `DUCK_TEMPERAMENT` at race start), `newBrain`, `grudgeWeight` and
//! `noteBrainEvent` (every emitted event goes through it). `noteNeighbours`
//! is ported too; only the evaluation (M3) calls it.

use race_protocol::config::ResolvedRaceConfig;
use race_protocol::events::{AiIntent, Temperament};
use race_protocol::ids::{ItemKey, PlayerId, RaceItemId};

use crate::math::{abs, js_min};
use crate::rng::{create_race_rng, engine_stream};
use crate::sim::{DuckPhysicsState, EngineMath, IdMap};

/// `TEMPERAMENTS` (`brain.ts:9`), in TS order (the RNG indexes it).
pub const TEMPERAMENTS: [Temperament; 4] = [
    Temperament::Aggressive,
    Temperament::Tactician,
    Temperament::Opportunist,
    Temperament::Showman,
];

/// `TemperamentTraits` (`brain.ts:12-27`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TemperamentTraits {
    pub aggression: f64,
    pub patience: f64,
    pub opportunism: f64,
    pub clutch: f64,
    pub vengeance: f64,
    pub reaction_scale: f64,
    /// `plannedWindow`: a partial record; items not listed are absent.
    pub planned_window: &'static [(RaceItemId, f64)],
}

impl TemperamentTraits {
    /// `traits.plannedWindow[itemId]` (`undefined` when absent).
    #[must_use]
    pub fn planned_window(&self, item_id: RaceItemId) -> Option<f64> {
        self.planned_window
            .iter()
            .find(|(id, _)| *id == item_id)
            .map(|&(_, value)| value)
    }
}

use RaceItemId::{Banana, DraftFin, HomingRocket, Nitro, PaddleBurst, QuackHorn};

/// `TEMPERAMENT_TRAITS[temperament]` (`brain.ts:29-46`).
#[must_use]
pub const fn temperament_traits(temperament: Temperament) -> TemperamentTraits {
    match temperament {
        Temperament::Aggressive => TemperamentTraits {
            aggression: 1.0,
            patience: 0.2,
            opportunism: 0.4,
            clutch: 0.3,
            vengeance: 1.0,
            reaction_scale: 0.85,
            planned_window: &[
                (Nitro, 0.3),
                (HomingRocket, 0.25),
                (Banana, 0.2),
                (QuackHorn, 0.22),
                (DraftFin, 0.2),
                (PaddleBurst, 0.65),
            ],
        },
        Temperament::Tactician => TemperamentTraits {
            aggression: 0.4,
            patience: 1.0,
            opportunism: 0.5,
            clutch: 0.5,
            vengeance: 0.3,
            reaction_scale: 1.0,
            planned_window: &[
                (Nitro, 0.45),
                (HomingRocket, 0.35),
                (Banana, 0.35),
                (QuackHorn, 0.35),
                (DraftFin, 0.4),
                (PaddleBurst, 0.7),
            ],
        },
        Temperament::Opportunist => TemperamentTraits {
            aggression: 0.6,
            patience: 0.5,
            opportunism: 1.0,
            clutch: 0.4,
            vengeance: 0.5,
            reaction_scale: 0.75,
            planned_window: &[
                (Nitro, 0.4),
                (HomingRocket, 0.25),
                (Banana, 0.25),
                (QuackHorn, 0.25),
                (DraftFin, 0.25),
                (PaddleBurst, 0.65),
            ],
        },
        Temperament::Showman => TemperamentTraits {
            aggression: 0.5,
            patience: 0.8,
            opportunism: 0.4,
            clutch: 1.0,
            vengeance: 0.6,
            reaction_scale: 1.1,
            planned_window: &[
                (Nitro, 0.55),
                (HomingRocket, 0.45),
                (Banana, 0.45),
                (QuackHorn, 0.4),
                (DraftFin, 0.55),
                (PaddleBurst, 0.8),
            ],
        },
    }
}

/// `NEUTRAL_TRAITS` (`brain.ts:107-109`).
pub const NEUTRAL_TRAITS: TemperamentTraits = TemperamentTraits {
    aggression: 0.5,
    patience: 0.0,
    opportunism: 0.5,
    clutch: 0.5,
    vengeance: 0.0,
    reaction_scale: 1.0,
    planned_window: &[],
};

/// One grudge (`brain.ts:66`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Grudge {
    pub weight: f64,
    pub tick: u32,
}

/// `DuckBrain` (`brain.ts:61-78`).
#[derive(Clone, Debug, PartialEq)]
pub struct DuckBrain {
    pub player_id: PlayerId,
    pub temperament: Temperament,
    pub traits: TemperamentTraits,
    /// attackerId -> grudge (a JS `Map`, insertion-ordered).
    pub grudges: IdMap<Grudge>,
    /// neighbourId -> decision samples spent close together.
    pub neighbour_samples: IdMap<u32>,
    pub rival_id: Option<PlayerId>,
    pub intent: Option<AiIntent>,
    pub intent_target_id: Option<PlayerId>,
    /// `string | null` in TS: `String(itemId)` of a prep or wild item.
    pub intent_item_id: Option<ItemKey>,
    /// `-Infinity` until the first announced intent.
    pub last_intent_tick: f64,
    pub held_item_id: Option<RaceItemId>,
    /// Balance tooling only (`aiAblationPlayerIds`).
    pub ablated: bool,
}

/// `itemState.brains`: one brain per `config.players` entry, in that order.
pub type Brains = IdMap<DuckBrain>;

/// Half-life of a grudge (`brain.ts:80`).
pub const GRUDGE_HALF_LIFE_SECONDS: f64 = 10.0;

/// `createDuckBrains(config)` (`brain.ts:82-88`). Stream label
/// `temperament:<playerId>` (F2; `ts-compat`: `temperament:<raceId>:<playerId>`).
#[must_use]
pub fn create_duck_brains(config: &ResolvedRaceConfig) -> Brains {
    config
        .players
        .iter()
        .map(|player| {
            let mut rng = create_race_rng(
                config.seed.as_str(),
                &engine_stream(
                    "temperament",
                    config.race_id.as_str(),
                    player.player_id.as_str(),
                ),
            );
            let temperament = TEMPERAMENTS[rng.index(TEMPERAMENTS.len())];
            (
                player.player_id.clone(),
                new_brain(player.player_id.clone(), temperament),
            )
        })
        .collect()
}

/// `newBrain(playerId, temperament)` (`brain.ts:90-104`).
#[must_use]
pub fn new_brain(player_id: PlayerId, temperament: Temperament) -> DuckBrain {
    DuckBrain {
        player_id,
        temperament,
        traits: temperament_traits(temperament),
        grudges: IdMap::new(),
        neighbour_samples: IdMap::new(),
        rival_id: None,
        intent: None,
        intent_target_id: None,
        intent_item_id: None,
        last_intent_tick: f64::NEG_INFINITY,
        held_item_id: None,
        ablated: false,
    }
}

/// `grudgeWeight(brain, attackerId, tick, tickRate)` (`brain.ts:111-115`).
#[must_use]
pub fn grudge_weight(
    brain: Option<&DuckBrain>,
    attacker_id: &str,
    tick: u32,
    tick_rate: u32,
    math: EngineMath,
) -> f64 {
    let Some(grudge) = brain.and_then(|brain| brain.grudges.get(attacker_id)) else {
        return 0.0;
    };
    grudge.weight
        * math.pow(
            0.5,
            (f64::from(tick) - f64::from(grudge.tick))
                / (GRUDGE_HALF_LIFE_SECONDS * f64::from(tick_rate)),
        )
}

/// `HOSTILE_EVENTS` (`brain.ts:117`).
const HOSTILE_EVENTS: [&str; 6] = [
    "ROCKET_HIT",
    "BANANA_HIT",
    "MINI_ROCKET_HIT",
    "WILD_BANANA_HIT",
    "MOMENTUM_STOLEN",
    "BOOST_BROKEN",
];

/// `noteBrainEvent(brains, type, sourcePlayerId, targetPlayerId, tick,
/// tickRate)` (`brain.ts:120-136`): whoever hurt you becomes a grudge.
pub fn note_brain_event(
    brains: &mut Brains,
    event_type: &str,
    source_player_id: Option<&str>,
    target_player_id: Option<&str>,
    tick: u32,
    tick_rate: u32,
    math: EngineMath,
) {
    let (Some(source), Some(target)) = (source_player_id, target_player_id) else {
        return;
    };
    if source == target {
        return;
    }
    let (attacker_id, victim_id) = if HOSTILE_EVENTS.contains(&event_type) {
        // ROCKET_HIT etc. are attacker -> victim; BOOST_BROKEN victim -> attacker.
        if event_type == "BOOST_BROKEN" {
            (target, source)
        } else {
            (source, target)
        }
    } else if event_type == "ITEM_SILENCED" {
        (target, source)
    } else {
        return;
    };
    let Some(brain) = brains.get(victim_id) else {
        return;
    };
    let increment = if event_type == "BOOST_BROKEN" || event_type == "ITEM_SILENCED" {
        0.5
    } else {
        1.0
    };
    let weight = grudge_weight(Some(brain), attacker_id, tick, tick_rate, math) + increment;
    let attacker = PlayerId::new(attacker_id).expect("event player ids are valid ids");
    let brain = brains.get_mut(victim_id).expect("brain looked up above");
    brain.grudges.insert(
        attacker,
        Grudge {
            weight: js_min(3.0, weight),
            tick,
        },
    );
}

/// `noteNeighbours(brain, ducks, me)` (`brain.ts:139-148`): the rival is the
/// duck this duck keeps trading places with.
pub fn note_neighbours(brain: &mut DuckBrain, ducks: &[DuckPhysicsState], my_progress: f64) {
    for other in ducks {
        if other.player_id == brain.player_id || other.finished {
            continue;
        }
        if abs(other.progress - my_progress) > 0.015 {
            continue;
        }
        let samples = brain
            .neighbour_samples
            .get(other.player_id.as_str())
            .copied()
            .unwrap_or(0)
            + 1;
        brain
            .neighbour_samples
            .insert(other.player_id.clone(), samples);
        let rival_samples = match &brain.rival_id {
            Some(rival) => brain
                .neighbour_samples
                .get(rival.as_str())
                .copied()
                .unwrap_or(0),
            None => 0,
        };
        if samples >= 6 && samples > rival_samples {
            brain.rival_id = Some(other.player_id.clone());
        }
    }
}
