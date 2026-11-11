//! Database layer: URL parsing, [`DbTime`], pools, schema verification and the TS migration
//! ledger. Identifiers are always double-quoted; booleans are 0/1; every INSERT sets
//! `createdAt`/`updatedAt` explicitly with [`DbTime::now`] (D13).

pub mod migrations;
pub mod owned;
pub mod pool;
pub mod schema;
pub mod time;
pub mod url;

pub use pool::Db;
pub use time::DbTime;

/// The Prisma baseline (`prisma migrate diff --from-empty`, with `IF NOT EXISTS`). It is never
/// executed against a real database; the schema verifier builds it in memory. The production
/// schema was made by Prisma and is adopted as-is by the first owned boot ([`owned`]).
pub const BASELINE_SQL: &str = include_str!("../../migrations/0001_baseline.sql");
