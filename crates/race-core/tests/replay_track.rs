//! Rust DTRK/1 recorder and encoder against the TS fixture
//! (`fixtures/replay-track/*`, plan Phase 5 gate "Track encoder"), plus the
//! `RaceRun` digest and `trackDefSha256`.
//!
//! - Every build: the TS fixture payload is decoded, each tick's world is
//!   pushed through the Rust `TrackRecorder`, and the Rust encoder must
//!   reproduce the TS bytes exactly.
//! - `ts-compat` (the faithful S3.15 port): the Rust engine re-simulates the
//!   fixture config live and its recording must equal the TS bytes too.
//! - A Rust race records, self-checks and decodes within quantisation.

#![allow(clippy::disallowed_types)] // serde_json::Value is fine in tests.

use std::io::Read;
use std::path::PathBuf;

use flate2::read::GzDecoder;
use race_core::replay::{
    RaceRun, TRACK_GEOMETRY_ID, TrackMeta, TrackRecorder, decode_track, encode_and_check,
    encode_track, rust_track_meta, track_def_jcs, track_def_sha256,
};
use race_core::sim::{SimOptions, digest_case, parse_corpus_line};
use race_core::track::create_river_track;
use race_protocol::replay_track::read_container;

fn repo() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn fixture_payload() -> Vec<u8> {
    let gz = std::fs::read(repo().join("fixtures/replay-track/short-race.dtrk.gz")).unwrap();
    let mut payload = Vec::new();
    GzDecoder::new(&gz[..]).read_to_end(&mut payload).unwrap();
    payload
}

fn meta_of(payload: &[u8]) -> TrackMeta {
    let header = read_container(payload).unwrap().header;
    TrackMeta {
        race_id: header.race_id,
        tick_rate: header.tick_rate,
        track_version: header.track_version,
        track_geometry: header.track_geometry,
        engine: header.engine,
        source: header.source,
        fidelity: header.fidelity,
        result_digest: header.result_digest,
    }
}

#[test]
fn rust_encoder_reproduces_the_ts_fixture_bytes() {
    let payload = fixture_payload();
    let fixture: serde_json::Value = serde_json::from_slice(
        &std::fs::read(repo().join("fixtures/replay-track/short-race.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(
        race_core::digest::sha256_hex(&payload),
        fixture["byteSha256"].as_str().unwrap()
    );
    let decoded = decode_track(&payload).unwrap();
    assert_eq!(decoded.last_tick(), 3498);
    let mut recorder = TrackRecorder::new(decoded.header.ducks.clone());
    for tick in 0..decoded.sample_count {
        recorder.push(tick, &decoded.world_at(tick).unwrap());
    }
    let recording = recorder.finalize().unwrap();
    assert_eq!(recording.order_violations, 0);
    let encoded = encode_track(&recording, &meta_of(&payload)).unwrap();
    assert_eq!(encoded.len(), payload.len());
    assert!(
        encoded == payload,
        "Rust DTRK bytes differ from the TS fixture"
    );
}

/// The faithful S3.15 port re-simulates the fixture race; recorded live, it
/// gives the TS bytes (header metadata taken from the fixture).
#[cfg(feature = "ts-compat")]
#[test]
fn ts_compat_live_recording_equals_the_ts_fixture() {
    let payload = fixture_payload();
    let fixture: serde_json::Value = serde_json::from_slice(
        &std::fs::read(repo().join("fixtures/replay-track/short-race.json")).unwrap(),
    )
    .unwrap();
    let line = serde_json::to_string(&fixture["config"]).unwrap();
    let case = parse_corpus_line(&line).unwrap();
    let mut run = RaceRun::new(case.config, SimOptions::default(), true);
    run.run_to_end().unwrap();
    assert_eq!(run.tick(), 3498);
    let recording = run.take_recording().unwrap().unwrap();
    let encoded = encode_track(&recording, &meta_of(&payload)).unwrap();
    assert!(
        encoded == payload,
        "live ts-compat recording differs from the TS fixture"
    );
}

fn pinned_lines() -> Vec<(String, String)> {
    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("fixtures/determinism-pinned.json")).unwrap();
    fixture["cases"]
        .as_array()
        .unwrap()
        .iter()
        .map(|case| {
            (
                case["id"].as_str().unwrap().to_owned(),
                case["line"].as_str().unwrap().to_owned(),
            )
        })
        .collect()
}

#[test]
fn rust_race_records_self_checks_and_round_trips() {
    // A `full` case (pickups, hazards, rockets) and an `items` case (manual inputs).
    for wanted in ["full-0112", "items-0040"] {
        let (_, line) = pinned_lines()
            .into_iter()
            .find(|(id, _)| id == wanted)
            .unwrap();
        let case = parse_corpus_line(&line).unwrap();
        let options = SimOptions {
            manual_inputs: case.manual_inputs.clone(),
            ..SimOptions::default()
        };
        let mut run = RaceRun::new(case.config.clone(), options.clone(), true);
        let mut worlds = Vec::new();
        while !run.finished() {
            run.step();
            if run.tick().is_multiple_of(500) {
                worlds.push((run.tick(), race_core::sim::snapshot_world(run.simulation())));
            }
        }
        let outcome = run.outcome().unwrap();
        let recording = run.take_recording().unwrap().unwrap();
        let meta = rust_track_meta(&outcome.result, Some(outcome.result_digest.clone()), None);
        let track = encode_and_check(&recording, &meta, &outcome.result, run.tick()).unwrap();
        assert_eq!(track.tick_count, run.tick());
        let decoded = decode_track(&track.payload).unwrap();
        assert_eq!(
            decoded.header.track_geometry.as_deref(),
            Some(TRACK_GEOMETRY_ID)
        );
        assert_eq!(
            decoded.header.engine.build.as_deref(),
            Some(race_core::ENGINE_BUILD_ID)
        );
        for (tick, world) in worlds {
            let got = decoded.world_at(tick).unwrap();
            for duck in &world.ducks {
                let back = got
                    .ducks
                    .iter()
                    .find(|d| d.player_id == duck.player_id)
                    .unwrap();
                assert!((back.progress - duck.progress).abs() <= 1.0 / 16_777_216.0);
                assert!((back.speed - duck.speed).abs() <= 1.0 / 16_777_216.0);
                assert!((back.lateral_offset - duck.lateral_offset).abs() <= 1.0 / 32_767.0);
                assert_eq!(back.rank, duck.rank);
                assert_eq!(back.active_effects, duck.active_effects);
                assert_eq!(back.wild_item, duck.wild_item);
                assert_eq!(back.regular_pickup_count, duck.regular_pickup_count);
            }
            assert_eq!(got.pickups, world.pickups);
            assert_eq!(got.hazards, world.hazards);
            assert_eq!(got.bananas, world.bananas);
            assert_eq!(got.rockets.len(), world.rockets.len());
        }

        // The run's digest folds agree with the pinned-fixture digest of the
        // same race, and a second run reproduces the result digest.
        let reference = digest_case(case.config.clone(), options.clone()).unwrap();
        assert_eq!(outcome.envelope.events_sha256, reference.events_sha256);
        assert_eq!(outcome.envelope.motion_sha256, reference.motion_sha256);
        assert_eq!(outcome.envelope.duration_ticks, reference.final_tick);
        let mut again = RaceRun::new(case.config, options, false);
        again.run_to_end().unwrap();
        assert_eq!(
            again.outcome().unwrap().result_digest,
            outcome.result_digest
        );
    }
}

#[test]
fn track_def_matches_the_committed_geometry_file() {
    let path = repo().join(format!("public/race-tracks/{TRACK_GEOMETRY_ID}.json"));
    let bytes = std::fs::read(&path).unwrap();
    let sha = race_core::digest::sha256_hex(&bytes);
    assert!(TRACK_GEOMETRY_ID.ends_with(&format!("@{}", &sha[..8])));
    let file: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let expected = race_core::serde_jcs::to_jcs_string(&file["sim"]).unwrap();
    let track = create_river_track("river-01-v2");
    assert_eq!(track_def_jcs(&track).unwrap(), expected);
    assert_eq!(track_def_sha256(&track).unwrap().len(), 64);
}

#[test]
fn recorder_disables_itself_instead_of_failing() {
    let mut recorder = TrackRecorder::new(vec!["1".parse().unwrap()]);
    let world = race_protocol::snapshot::RaceWorld {
        ducks: Vec::new(),
        pickups: Vec::new(),
        hazards: Vec::new(),
        rockets: Vec::new(),
        bananas: Vec::new(),
    };
    recorder.push(0, &world);
    assert!(recorder.disabled());
    recorder.push(1, &world);
    assert!(recorder.finalize().is_err());
}
