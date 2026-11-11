//! Boot schema verifier (D14, C15).
//!
//! The live DDL was built by years of `prisma db push` plus raw `ALTER TABLE`s in
//! `scripts/run-migrations.ts`, so a strict comparison would fail on the first boot. Instead the
//! verifier builds the Prisma baseline ([`crate::db::BASELINE_SQL`]) in an in-memory database and
//! compares normalised `PRAGMA table_xinfo` / `index_list` / `index_info` output:
//!
//! - columns as name-keyed sets of (affinity, notnull, pk, normalised default);
//! - defaults normalised (`true`/`false` → `1`/`0`, wrapping quotes and parentheses stripped,
//!   keywords upper-cased);
//! - named indexes by name, uniqueness and column list; SQLite's automatic indexes by column list.
//!
//! **Fatal** only: a missing live table, or a missing column in a live table (a table the Rust
//! server queries), plus two cases that would make Rust's own statements fail at runtime
//! (review 1, finding 6): a missing unique index that an `ON CONFLICT` target needs
//! ([`CONFLICT_TARGETS`]), and an extra `NOT NULL` column without a default in a live table
//! (every Rust INSERT would fail). Everything else (attribute drift, other missing or extra
//! indexes, extra tables or nullable/defaulted columns, the 11 inert legacy tables) is reported
//! as non-fatal drift and logged.

use std::collections::{BTreeMap, BTreeSet};

use sqlx::{Connection, SqliteConnection};

use super::BASELINE_SQL;

/// Tables the Rust server reads or writes: 25 live Prisma models, `RaceReplayTrack`, and
/// `CommentaryLog` (a v2 table that race detail still reads for old races' commentary, so it is
/// kept by `rs-0010-drop-legacy-v2`).
pub const LIVE_TABLES: [&str; 27] = [
    "AppMigration",
    "CommentaryLog",
    "CosmeticAdminEvent",
    "CosmeticConfig",
    "CosmeticPreset",
    "CurrencyTransaction",
    "GachaPull",
    "PlayerAppearance",
    "PlayerCosmetic",
    "Race",
    "RaceEngineEvent",
    "RaceItemTelemetry",
    "RaceParticipant",
    "RacePickupTelemetry",
    "RaceReplayTrack",
    "RaceWildAction",
    "Season",
    "SeasonLoadout",
    "SeasonPlayer",
    "SeasonPrediction",
    "SeasonRedemption",
    "SeasonReward",
    "SeasonShieldChoice",
    "SeasonWeek",
    "ShopPurchase",
    "ShopRotation",
    "User",
];

/// `INSERT … ON CONFLICT (<columns>)` targets in the Rust code. SQLite refuses such a
/// statement unless a non-partial unique index covers exactly these columns.
pub const CONFLICT_TARGETS: [(&str, &[&str]); 2] = [
    ("PlayerAppearance", &["seasonPlayerId"]),
    ("PlayerCosmetic", &["seasonPlayerId", "cosmeticId"]),
];

/// Legacy v2 tables (D25): never queried by Rust. Archived and dropped by the owned-schema
/// migration `rs-0010-drop-legacy-v2` ([`crate::db::owned`]); once that id is in the ledger the
/// verifier stops expecting them.
pub const LEGACY_TABLES: [&str; 11] = [
    "CommentaryJob",
    "DragonItem",
    "DragonItemEvent",
    "DragonOrb",
    "DragonOrbEvent",
    "DragonSummon",
    "DragonTrade",
    "DragonWeek",
    "MysteryChest",
    "Shield",
    "WeeklyTick",
];

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Affinity {
    Integer,
    Text,
    Blob,
    Real,
    Numeric,
}

/// SQLite's type-affinity rules (§3.1 of the datatype docs).
pub fn affinity(declared: &str) -> Affinity {
    let upper = declared.to_ascii_uppercase();
    if upper.contains("INT") {
        Affinity::Integer
    } else if upper.contains("CHAR") || upper.contains("CLOB") || upper.contains("TEXT") {
        Affinity::Text
    } else if upper.is_empty() || upper.contains("BLOB") {
        Affinity::Blob
    } else if upper.contains("REAL") || upper.contains("FLOA") || upper.contains("DOUB") {
        Affinity::Real
    } else {
        Affinity::Numeric
    }
}

/// D14 default normalisation.
pub fn normalize_default(raw: &str) -> String {
    let mut value = raw.trim();
    loop {
        let stripped = value
            .strip_prefix('(')
            .and_then(|inner| inner.strip_suffix(')'))
            .or_else(|| {
                value
                    .strip_prefix('\'')
                    .and_then(|inner| inner.strip_suffix('\''))
            })
            .or_else(|| {
                value
                    .strip_prefix('"')
                    .and_then(|inner| inner.strip_suffix('"'))
            });
        match stripped {
            Some(inner) => value = inner.trim(),
            None => break,
        }
    }
    match value.to_ascii_lowercase().as_str() {
        "true" => "1".to_owned(),
        "false" => "0".to_owned(),
        "current_timestamp" | "current_date" | "current_time" | "null" => {
            value.to_ascii_uppercase()
        }
        _ => value.to_owned(),
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ColumnShape {
    pub declared: String,
    pub affinity: Affinity,
    pub notnull: bool,
    pub pk: i64,
    pub default: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct IndexShape {
    pub unique: bool,
    pub partial: bool,
    pub columns: Vec<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct TableShape {
    pub columns: BTreeMap<String, ColumnShape>,
    /// Named indexes (`CREATE [UNIQUE] INDEX`).
    pub indexes: BTreeMap<String, IndexShape>,
    /// `sqlite_autoindex_*` (UNIQUE/PRIMARY KEY constraints), keyed by their column list, since
    /// their names depend on declaration order.
    pub auto_indexes: BTreeSet<(bool, Vec<String>)>,
}

pub type SchemaShape = BTreeMap<String, TableShape>;

#[derive(Clone, Debug, Default)]
pub struct SchemaReport {
    pub fatal: Vec<String>,
    pub drift: Vec<String>,
}

impl SchemaReport {
    pub fn is_ok(&self) -> bool {
        self.fatal.is_empty()
    }
}

/// Reads the shape of every non-internal table through the table-valued pragma functions (the
/// table name is a bound parameter, never spliced into SQL).
pub async fn introspect(conn: &mut SqliteConnection) -> Result<SchemaShape, sqlx::Error> {
    let tables: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .fetch_all(&mut *conn)
    .await?;

    let mut shape = SchemaShape::new();
    for table in tables {
        let mut entry = TableShape::default();
        let columns: Vec<(String, String, i64, Option<String>, i64, i64)> = sqlx::query_as(
            r#"SELECT name, type, "notnull", dflt_value, pk, hidden FROM pragma_table_xinfo(?) ORDER BY cid"#,
        )
        .bind(&table)
        .fetch_all(&mut *conn)
        .await?;
        for (name, declared, notnull, default, pk, hidden) in columns {
            if hidden == 1 {
                continue; // hidden columns of virtual tables
            }
            entry.columns.insert(
                name,
                ColumnShape {
                    affinity: affinity(&declared),
                    declared,
                    notnull: notnull != 0,
                    pk,
                    default: default.as_deref().map(normalize_default),
                },
            );
        }

        let indexes: Vec<(String, i64, i64)> =
            sqlx::query_as(r#"SELECT name, "unique", partial FROM pragma_index_list(?)"#)
                .bind(&table)
                .fetch_all(&mut *conn)
                .await?;
        for (name, unique, partial) in indexes {
            let columns: Vec<Option<String>> =
                sqlx::query_scalar("SELECT name FROM pragma_index_info(?) ORDER BY seqno")
                    .bind(&name)
                    .fetch_all(&mut *conn)
                    .await?;
            let columns: Vec<String> = columns
                .into_iter()
                .map(|column| column.unwrap_or_else(|| "<expr>".to_owned()))
                .collect();
            if name.starts_with("sqlite_autoindex_") {
                entry.auto_indexes.insert((unique != 0, columns));
            } else {
                entry.indexes.insert(
                    name,
                    IndexShape {
                        unique: unique != 0,
                        partial: partial != 0,
                        columns,
                    },
                );
            }
        }
        shape.insert(table, entry);
    }
    Ok(shape)
}

/// The expected shape: the Prisma baseline built in a private in-memory database.
pub async fn expected_shape() -> Result<SchemaShape, sqlx::Error> {
    let mut conn = SqliteConnection::connect("sqlite::memory:").await?;
    sqlx::raw_sql(BASELINE_SQL).execute(&mut conn).await?;
    let shape = introspect(&mut conn).await?;
    conn.close().await?;
    Ok(shape)
}

/// Compares a live shape with the expected one. Pure, so the rules are unit-tested.
pub fn compare(expected: &SchemaShape, live: &SchemaShape) -> SchemaReport {
    let mut report = SchemaReport::default();
    let live_set: BTreeSet<&str> = LIVE_TABLES.into_iter().collect();

    for (table, want) in expected {
        let required = live_set.contains(table.as_str());
        let Some(have) = live.get(table) else {
            let message = format!("missing table \"{table}\"");
            if required {
                report.fatal.push(message);
            } else {
                report
                    .drift
                    .push(format!("{message} (legacy, not queried)"));
            }
            continue;
        };

        for (column, want_col) in &want.columns {
            let Some(have_col) = have.columns.get(column) else {
                let message = format!("missing column \"{table}\".\"{column}\"");
                if required {
                    report.fatal.push(message);
                } else {
                    report
                        .drift
                        .push(format!("{message} (legacy, not queried)"));
                }
                continue;
            };
            if have_col.affinity != want_col.affinity {
                report.drift.push(format!(
                    "\"{table}\".\"{column}\": affinity {:?} ({}), expected {:?} ({})",
                    have_col.affinity, have_col.declared, want_col.affinity, want_col.declared
                ));
            }
            if have_col.notnull != want_col.notnull {
                report.drift.push(format!(
                    "\"{table}\".\"{column}\": notnull {}, expected {}",
                    have_col.notnull, want_col.notnull
                ));
            }
            if have_col.pk != want_col.pk {
                report.drift.push(format!(
                    "\"{table}\".\"{column}\": pk {}, expected {}",
                    have_col.pk, want_col.pk
                ));
            }
            if have_col.default != want_col.default {
                report.drift.push(format!(
                    "\"{table}\".\"{column}\": default {:?}, expected {:?}",
                    have_col.default, want_col.default
                ));
            }
        }
        for (column, have_col) in &have.columns {
            if want.columns.contains_key(column) {
                continue;
            }
            if required && have_col.notnull && have_col.default.is_none() && have_col.pk == 0 {
                report.fatal.push(format!(
                    "extra column \"{table}\".\"{column}\" is NOT NULL without a default: Rust INSERTs would fail"
                ));
            } else {
                report
                    .drift
                    .push(format!("extra column \"{table}\".\"{column}\""));
            }
        }

        for (name, want_index) in &want.indexes {
            match have.indexes.get(name) {
                None => report
                    .drift
                    .push(format!("missing index \"{name}\" on \"{table}\"")),
                Some(have_index) if have_index != want_index => report.drift.push(format!(
                    "index \"{name}\" on \"{table}\": {have_index:?}, expected {want_index:?}"
                )),
                Some(_) => {}
            }
        }
        for name in have.indexes.keys() {
            if !want.indexes.contains_key(name) {
                report
                    .drift
                    .push(format!("extra index \"{name}\" on \"{table}\""));
            }
        }
        for auto in want.auto_indexes.difference(&have.auto_indexes) {
            report
                .drift
                .push(format!("missing automatic index on \"{table}\" {auto:?}"));
        }
        for auto in have.auto_indexes.difference(&want.auto_indexes) {
            report
                .drift
                .push(format!("extra automatic index on \"{table}\" {auto:?}"));
        }
    }

    for table in live.keys() {
        if !expected.contains_key(table) {
            report.drift.push(format!("extra table \"{table}\""));
        }
    }

    for (table, target) in CONFLICT_TARGETS {
        let Some(have) = live.get(table) else {
            continue; // already fatal as a missing table
        };
        let mut want: Vec<&str> = target.to_vec();
        want.sort();
        let covers = |columns: &[String]| {
            let mut have: Vec<&str> = columns.iter().map(String::as_str).collect();
            have.sort();
            have == want
        };
        let named = have
            .indexes
            .values()
            .any(|index| index.unique && !index.partial && covers(&index.columns));
        let automatic = have
            .auto_indexes
            .iter()
            .any(|(unique, columns)| *unique && covers(columns));
        if !(named || automatic) {
            report.fatal.push(format!(
                "missing unique index on \"{table}\"({}): INSERT … ON CONFLICT needs it",
                target.join(", ")
            ));
        }
    }
    report
}

/// Introspects `conn` and compares it with the baseline. After `rs-0010-drop-legacy-v2` the
/// legacy tables are no longer expected (so they aren't logged as drift on every boot).
pub async fn verify(conn: &mut SqliteConnection) -> Result<SchemaReport, sqlx::Error> {
    let mut expected = expected_shape().await?;
    // A missing ledger is already fatal (missing live table); treat it as "not dropped".
    let dropped: Option<i64> = sqlx::query_scalar(r#"SELECT 1 FROM "AppMigration" WHERE "id" = ?"#)
        .bind(super::owned::DROP_LEGACY_ID)
        .fetch_optional(&mut *conn)
        .await
        .unwrap_or(None);
    if dropped.is_some() {
        for table in LEGACY_TABLES {
            expected.remove(table);
        }
    }
    let live = introspect(conn).await?;
    Ok(compare(&expected, &live))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn affinity_rules() {
        assert_eq!(affinity("INTEGER"), Affinity::Integer);
        assert_eq!(affinity("BIGINT"), Affinity::Integer);
        assert_eq!(affinity("TEXT"), Affinity::Text);
        assert_eq!(affinity("VARCHAR(10)"), Affinity::Text);
        assert_eq!(affinity("BLOB"), Affinity::Blob);
        assert_eq!(affinity(""), Affinity::Blob);
        assert_eq!(affinity("REAL"), Affinity::Real);
        assert_eq!(affinity("DOUBLE PRECISION"), Affinity::Real);
        assert_eq!(affinity("DATETIME"), Affinity::Numeric);
        assert_eq!(affinity("BOOLEAN"), Affinity::Numeric);
    }

    #[test]
    fn default_normalisation() {
        assert_eq!(normalize_default("false"), "0");
        assert_eq!(normalize_default("TRUE"), "1");
        assert_eq!(normalize_default("'pending'"), "pending");
        assert_eq!(normalize_default("(\"x\")"), "x");
        assert_eq!(normalize_default("current_timestamp"), "CURRENT_TIMESTAMP");
        assert_eq!(normalize_default("(0)"), "0");
        assert_eq!(normalize_default(" 5 "), "5");
    }

    #[tokio::test]
    async fn baseline_has_every_table() {
        let expected = expected_shape().await.unwrap();
        assert_eq!(expected.len(), LIVE_TABLES.len() + LEGACY_TABLES.len());
        for table in LIVE_TABLES.iter().chain(LEGACY_TABLES.iter()) {
            assert!(expected.contains_key(*table), "baseline lacks {table}");
        }
        assert_eq!(compare(&expected, &expected).fatal, Vec::<String>::new());
        assert!(compare(&expected, &expected).drift.is_empty());
    }

    #[tokio::test]
    async fn missing_live_column_is_fatal_legacy_is_not() {
        let mut conn = SqliteConnection::connect("sqlite::memory:").await.unwrap();
        sqlx::raw_sql(BASELINE_SQL)
            .execute(&mut conn)
            .await
            .unwrap();
        sqlx::raw_sql(
            r#"ALTER TABLE "Race" DROP COLUMN "liveSnapshotJson";
               DROP TABLE "WeeklyTick";
               DROP INDEX "Race_createdAt_idx";
               CREATE TABLE "Scratch" ("x" INTEGER);"#,
        )
        .execute(&mut conn)
        .await
        .unwrap();
        let report = verify(&mut conn).await.unwrap();
        assert_eq!(
            report.fatal,
            vec![r#"missing column "Race"."liveSnapshotJson""#.to_owned()]
        );
        assert!(report.drift.iter().any(|d| d.contains("WeeklyTick")));
        assert!(
            report
                .drift
                .iter()
                .any(|d| d.contains("Race_createdAt_idx"))
        );
        assert!(
            report
                .drift
                .iter()
                .any(|d| d.contains("extra table \"Scratch\""))
        );

        sqlx::raw_sql(r#"DROP TABLE "RaceReplayTrack""#)
            .execute(&mut conn)
            .await
            .unwrap();
        let report = verify(&mut conn).await.unwrap();
        assert!(
            report
                .fatal
                .contains(&r#"missing table "RaceReplayTrack""#.to_owned())
        );
    }

    #[tokio::test]
    async fn statements_rust_runs_must_still_work() {
        let mut conn = SqliteConnection::connect("sqlite::memory:").await.unwrap();
        sqlx::raw_sql(BASELINE_SQL)
            .execute(&mut conn)
            .await
            .unwrap();
        sqlx::raw_sql(
            r#"DROP INDEX "PlayerCosmetic_seasonPlayerId_cosmeticId_key";
               CREATE INDEX "PlayerCosmetic_pair" ON "PlayerCosmetic"("cosmeticId", "seasonPlayerId");
               ALTER TABLE "Race" ADD COLUMN "nullableExtra" TEXT;
               ALTER TABLE "GachaPull" ADD COLUMN "defaultedExtra" INTEGER NOT NULL DEFAULT 0;
               DROP TABLE "ShopPurchase";
               CREATE TABLE "ShopPurchase" ("id" TEXT NOT NULL PRIMARY KEY, "seasonPlayerId" INTEGER NOT NULL,
                 "rotationId" TEXT NOT NULL, "cosmeticId" TEXT NOT NULL, "price" INTEGER NOT NULL,
                 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "note" TEXT NOT NULL);"#,
        )
        .execute(&mut conn)
        .await
        .unwrap();
        let report = verify(&mut conn).await.unwrap();
        assert_eq!(
            report.fatal,
            vec![
                r#"extra column "ShopPurchase"."note" is NOT NULL without a default: Rust INSERTs would fail"#
                    .to_owned(),
                r#"missing unique index on "PlayerCosmetic"(seasonPlayerId, cosmeticId): INSERT … ON CONFLICT needs it"#
                    .to_owned(),
            ]
        );
        assert!(report.drift.iter().any(|d| d.contains("nullableExtra")));
        assert!(report.drift.iter().any(|d| d.contains("defaultedExtra")));

        // A unique index with the same columns under another name (or order) is enough.
        sqlx::raw_sql(
            r#"CREATE UNIQUE INDEX "pc_unique" ON "PlayerCosmetic"("cosmeticId", "seasonPlayerId");"#,
        )
        .execute(&mut conn)
        .await
        .unwrap();
        let report = verify(&mut conn).await.unwrap();
        assert_eq!(report.fatal.len(), 1, "{:?}", report.fatal);
    }

    #[tokio::test]
    async fn attribute_drift_is_logged_not_fatal() {
        let mut conn = SqliteConnection::connect("sqlite::memory:").await.unwrap();
        // Raw ALTER TABLE style (run-migrations.ts:301): nullable, quoted default, no index.
        sqlx::raw_sql(BASELINE_SQL)
            .execute(&mut conn)
            .await
            .unwrap();
        sqlx::raw_sql(
            r#"DROP TABLE "AppMigration";
               CREATE TABLE "AppMigration" ("id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL,
                 "runAt" DATETIME DEFAULT (CURRENT_TIMESTAMP));"#,
        )
        .execute(&mut conn)
        .await
        .unwrap();
        let report = verify(&mut conn).await.unwrap();
        assert!(report.is_ok(), "{:?}", report.fatal);
        assert_eq!(
            report.drift,
            vec![r#""AppMigration"."runAt": notnull false, expected true"#.to_owned()]
        );
    }
}
