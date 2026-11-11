//! `autoduck seed`: the non-CI path of `prisma/seed.ts`, explicit only.
//!
//! Refuses a non-empty database (any `User` or `SeasonPlayer` row). The destructive `CI=true`
//! upsert path is not ported (plan Phase 3). The schema must already exist (compat mode never
//! runs DDL); seed a fresh file created by `prisma db push` or the baseline SQL.

use crate::db::{Db, DbTime};

struct SeedUser {
    name: &'static str,
    scars: i64,
    shields: i64,
    shields_used: i64,
    total_khaos: i64,
    avatar_url: Option<&'static str>,
}

const PLAYERS: [SeedUser; 8] = [
    SeedUser {
        name: "Zịt Dũng",
        scars: 1,
        shields: 0,
        shields_used: 3,
        total_khaos: 7,
        avatar_url: None,
    },
    SeedUser {
        name: "Zịt Lợi",
        scars: 1,
        shields: 0,
        shields_used: 5,
        total_khaos: 11,
        avatar_url: None,
    },
    SeedUser {
        name: "Zịt Minh",
        scars: 1,
        shields: 0,
        shields_used: 4,
        total_khaos: 9,
        avatar_url: None,
    },
    SeedUser {
        name: "Zịt Tâm",
        scars: 1,
        shields: 1,
        shields_used: 4,
        total_khaos: 11,
        avatar_url: None,
    },
    SeedUser {
        name: "Zịt Tân",
        scars: 1,
        shields: 2,
        shields_used: 2,
        total_khaos: 9,
        avatar_url: None,
    },
    SeedUser {
        name: "Zịt Thanh",
        scars: 0,
        shields: 1,
        shields_used: 4,
        total_khaos: 10,
        avatar_url: None,
    },
    SeedUser {
        name: "Zịt Tuấn",
        scars: 1,
        shields: 1,
        shields_used: 6,
        total_khaos: 15,
        avatar_url: None,
    },
    // The Immortal Duck.
    SeedUser {
        name: "Thomas",
        scars: 0,
        shields: 9999,
        shields_used: 0,
        total_khaos: 0,
        avatar_url: Some("https://api.dicebear.com/9.x/bottts-neutral/svg?seed=Thomas"),
    },
];

#[derive(Debug, thiserror::Error)]
pub enum SeedError {
    #[error(
        "database already contains data ({users} users, {players} season players); refusing to seed"
    )]
    NotEmpty { users: i64, players: i64 },
    #[error(transparent)]
    Sql(#[from] sqlx::Error),
}

/// Inserts the seed users (and their legacy shields) in one `BEGIN IMMEDIATE` transaction.
/// Returns the number of users created.
pub async fn seed(db: &Db) -> Result<usize, SeedError> {
    let mut tx = db.begin_write().await?;
    let users = sqlx::query_scalar!(r#"SELECT COUNT(*) AS "n!: i64" FROM "User""#)
        .fetch_one(&mut *tx)
        .await?;
    let players = sqlx::query_scalar!(r#"SELECT COUNT(*) AS "n!: i64" FROM "SeasonPlayer""#)
        .fetch_one(&mut *tx)
        .await?;
    if users > 0 || players > 0 {
        return Err(SeedError::NotEmpty { users, players });
    }
    // The legacy v2 `Shield` table is dropped by the owned-schema migration
    // `rs-0010-drop-legacy-v2`; seed its rows only where it still exists.
    let legacy_shields: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'Shield'")
            .fetch_optional(&mut *tx)
            .await?;
    let now = DbTime::now();
    for player in &PLAYERS {
        let user_id = sqlx::query_scalar!(
            r#"INSERT INTO "User" ("name", "avatarUrl", "scars", "shields", "shieldsUsed", "totalKhaos",
                 "cleanStreak", "isBoss", "bossSince", "createdAt", "updatedAt")
               VALUES (?, ?, ?, ?, ?, ?, 0, 0, NULL, ?, ?)
               RETURNING "id" AS "id!: i64""#,
            player.name,
            player.avatar_url,
            player.scars,
            player.shields,
            player.shields_used,
            player.total_khaos,
            now,
            now
        )
        .fetch_one(&mut *tx)
        .await?;
        if legacy_shields.is_some() && player.shields > 0 && player.shields < 9999 {
            for _ in 0..player.shields {
                sqlx::query!(
                    r#"INSERT INTO "Shield" ("ownerId", "earnedAt", "charges", "weeksUnused", "status")
                       VALUES (?, ?, 5, 0, 'active')"#,
                    user_id,
                    now
                )
                .execute(&mut *tx)
                .await?;
            }
        }
        tracing::info!(name = player.name, "created");
    }
    tx.commit().await?;
    Ok(PLAYERS.len())
}
