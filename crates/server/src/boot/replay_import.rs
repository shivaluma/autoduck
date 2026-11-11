//! Boot step 10, `ensure_imported` (plan §4.4 step 9, C7): the historical replay tracks in
//! `artifacts/replay-tracks/manifest.json` against the `RaceReplayTrack` rows.
//!
//! Up to the cutover the TS image imported them on every boot
//! (`scripts/replay-tracks/ensure-imported.ts`), and production already holds a row for every
//! manifest race. The Rust step is a **read-only check**: it writes nothing, never fails the
//! boot, and logs `manifest N, present P, missing M, not in this DB K`. A missing row (a gap
//! appended to the manifest after the cutover) is listed with a warning; importing it needs the
//! TS script from tag `ts-engine-final` (deleted in Phase 9), run against the database file
//! while the server is stopped.

use std::collections::BTreeSet;
use std::path::Path;

use serde::Deserialize;

#[derive(Debug, Default, PartialEq, Eq)]
pub struct ImportCheck {
    /// Races listed in the manifest.
    pub manifest: usize,
    /// Manifest races that have a `RaceReplayTrack` row.
    pub present: usize,
    /// Manifest races that exist in `Race` but have no `RaceReplayTrack` row.
    pub missing: Vec<i64>,
    /// Manifest races this database doesn't have at all (a dev or test DB).
    pub not_in_db: usize,
}

#[derive(Deserialize)]
struct Manifest {
    races: Vec<Entry>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    race_id: i64,
}

/// The race ids of a manifest file.
pub fn manifest_race_ids(path: &Path) -> Result<BTreeSet<i64>, String> {
    let text = std::fs::read_to_string(path).map_err(|error| error.to_string())?;
    let manifest: Manifest = serde_json::from_str(&text).map_err(|error| error.to_string())?;
    Ok(manifest
        .races
        .into_iter()
        .map(|entry| entry.race_id)
        .collect())
}

/// Compares the manifest's races with the database. Read-only.
pub async fn check(
    conn: &mut sqlx::SqliteConnection,
    race_ids: &BTreeSet<i64>,
) -> Result<ImportCheck, sqlx::Error> {
    let races: BTreeSet<i64> = sqlx::query_scalar(r#"SELECT "id" FROM "Race""#)
        .fetch_all(&mut *conn)
        .await?
        .into_iter()
        .collect();
    let tracks: BTreeSet<i64> = sqlx::query_scalar(r#"SELECT "raceId" FROM "RaceReplayTrack""#)
        .fetch_all(&mut *conn)
        .await?
        .into_iter()
        .collect();
    let mut report = ImportCheck {
        manifest: race_ids.len(),
        ..ImportCheck::default()
    };
    for id in race_ids {
        if tracks.contains(id) {
            report.present += 1;
        } else if races.contains(id) {
            report.missing.push(*id);
        } else {
            report.not_in_db += 1;
        }
    }
    Ok(report)
}

/// Step 10 as the boot runs it: logs the outcome, never fails.
pub async fn run(conn: &mut sqlx::SqliteConnection, manifest: &Path) {
    let race_ids = match manifest_race_ids(manifest) {
        Ok(ids) => ids,
        Err(error) => {
            tracing::warn!(path = %manifest.display(), %error, "replay import: manifest unreadable; check skipped");
            return;
        }
    };
    match check(conn, &race_ids).await {
        Ok(report) if report.missing.is_empty() => tracing::info!(
            manifest = report.manifest,
            present = report.present,
            not_in_db = report.not_in_db,
            "replay import: 0 missing (read-only check)"
        ),
        Ok(report) => tracing::warn!(
            manifest = report.manifest,
            present = report.present,
            not_in_db = report.not_in_db,
            missing = ?report.missing,
            "replay import: manifest races without a RaceReplayTrack row; import them with scripts/replay-tracks/ensure-imported.ts while the server is stopped"
        ),
        Err(error) => {
            tracing::warn!(%error, "replay import: check failed; skipped");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_committed_manifest() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../artifacts/replay-tracks/manifest.json");
        let ids = manifest_race_ids(&path).unwrap();
        assert!(ids.len() >= 130, "{} races", ids.len());
        assert!(ids.contains(&113));
    }
}
