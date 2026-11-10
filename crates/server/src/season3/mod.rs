//! Season 3 meta layer (rewrite plan Phase 3 stage B): a port of `lib/season3.ts`,
//! `lib/season3-schedule.ts`, `lib/season3-race-mapping.ts`, `lib/season3-test-mode.ts`,
//! `lib/racing/loadout.ts`, `lib/racing/golden-reward.ts`, the meta half of
//! `executeSeason3Race` (`lib/season3-race.ts`) and the helpers the season3 routes keep inline.
//!
//! Everything here is pure over data. The DB reads and writes belong to the routes (stage B)
//! and to T2 (Phase 5, D23), which apply a [`resolution::ResolutionPlan`].
//!
//! Module map:
//! - [`cards`]: `CHAOS_CARDS`, `chaosLabel`, the server's [`cards::ChaosCard`] (group ids as the
//!   strings the Chaos rules see), and re-exports of the race-core card draws
//!   (`selectChaosCard`, `prepareChaosCard`, the `chaos:week:N` / `chaos:manual:N:<ms>` flows).
//! - [`resolve`]: `resolveSeason3Race`, `applyScarEconomy`, `resolvePredictions`,
//!   `selectChampion`.
//! - [`news`]: `generateDuckNews` and the recap's QP lines.
//! - [`mapping`]: `mapSeason3RaceRanking`, joined by **userId** (plan Phase 3), not by name.
//! - [`schedule`]: the Monday-in-Vietnam race gate.
//! - [`test_mode`]: `canStartSeason3TestRace`, `getSeason3RaceMode`.
//! - [`payload`]: `parseChaosGroups` (strict and lenient), `parseSkippedPlayerIds`,
//!   `chaosPayload`.
//! - [`player`]: data access for the player routes (`/api/season3`, `/api/season3/redeem`).
//! - [`loadout`]: `parseItemIds`, `serializeItemIds`, `selectAutoLoadout`.
//! - [`balance`]: the admin GET balance-telemetry aggregation.
//! - [`resolution`]: the T2 meta plan (`executeSeason3Race` after the simulation).
//!
//! Parity: `tests/season3_meta.rs` replays the fixture from
//! `scripts/oracle/dump-season3-meta-fixtures.ts` (the TS modules themselves, with
//! `executeSeason3Race` run against a recording Prisma stub).

pub mod admin;
pub mod balance;
pub mod cards;
pub mod loadout;
pub mod mapping;
pub mod news;
pub mod payload;
pub mod player;
pub mod resolution;
pub mod resolve;
pub mod schedule;
pub mod test_mode;

pub use cards::{CHAOS_CARDS, ChaosCard, chaos_label, parse_chaos_type};
pub use race_core::meta::{GHOST_DUCK_NAME, is_ghost_duck};

/// `SEASON3_KEY`.
pub const SEASON3_KEY: &str = "S3";
/// `SEASON3_WEEKS`.
pub const SEASON3_WEEKS: u32 = 12;
/// The `create-season` default name (`body.name ?? …`).
pub const DEFAULT_SEASON_NAME: &str = "ĐUA DZỊT — SEASON 3";

/// One `DEFAULT_SEASON3_REWARDS` entry.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
pub struct DefaultReward {
    pub key: &'static str,
    pub name: &'static str,
    pub cost: i64,
    pub stock: Option<i64>,
}

/// `DEFAULT_SEASON3_REWARDS`, in TS order (also the `SeasonReward` insert order).
pub const DEFAULT_SEASON3_REWARDS: [DefaultReward; 5] = [
    DefaultReward {
        key: "sticker",
        name: "🏷️ Sticker / badge vịt",
        cost: 2,
        stock: None,
    },
    DefaultReward {
        key: "keychain",
        name: "🦆 Móc khóa vịt",
        cost: 4,
        stock: None,
    },
    DefaultReward {
        key: "mini_statue",
        name: "🗿 Tượng vịt mini",
        cost: 6,
        stock: None,
    },
    DefaultReward {
        key: "plush",
        name: "🧸 Gấu bông vịt",
        cost: 8,
        stock: None,
    },
    DefaultReward {
        key: "limited_duck",
        name: "🎁 Limited S3 Duck",
        cost: 10,
        stock: Some(10),
    },
];
