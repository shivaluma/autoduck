//! The TS oracle fixtures for the cosmetic economy (`scripts/oracle/dump-cosmetic-fixtures.ts`,
//! `tests/fixtures/cosmetics.json.gz`). Shared by `gacha.rs`, `cosmetics_economy.rs` and
//! `catalog.rs`.
#![allow(dead_code)]

use std::collections::HashSet;
use std::io::Read;
use std::path::PathBuf;
use std::sync::OnceLock;

use autoduck_server::cosmetics::catalog;
use serde_json::Value;
use sha2::{Digest, Sha256};

fn manifest_path(relative: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(relative)
}

/// The parsed fixture. Panics if it was dumped from a different catalog export.
pub fn fixture() -> &'static Value {
    static FIXTURE: OnceLock<Value> = OnceLock::new();
    FIXTURE.get_or_init(|| {
        let gz = std::fs::read(manifest_path("tests/fixtures/cosmetics.json.gz")).unwrap();
        let mut text = String::new();
        flate2::read::GzDecoder::new(gz.as_slice())
            .read_to_string(&mut text)
            .unwrap();
        let fixture: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(fixture["format"], "autoduck-cosmetic-fixtures/1");
        let catalog_text = std::fs::read(manifest_path("data/cosmetic-catalog.json")).unwrap();
        let sha: String = Sha256::digest(&catalog_text)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        assert_eq!(
            fixture["catalogSha256"].as_str().unwrap(),
            sha,
            "fixture was dumped from another catalog: rerun scripts/oracle/dump-cosmetic-fixtures.ts"
        );
        fixture
    })
}

pub fn cases(section: &str) -> &'static [Value] {
    fixture()[section].as_array().unwrap()
}

/// `{ mask, extra }` → the id set (bit i of the hex mask = catalog item i).
pub fn decode_set(value: &Value) -> HashSet<String> {
    let mask = value["mask"].as_str().unwrap();
    let items = &catalog().items;
    let mut set = HashSet::new();
    for (position, digit) in mask.chars().rev().enumerate() {
        let nibble = digit.to_digit(16).unwrap();
        for bit in 0..4 {
            if nibble & (1 << bit) != 0 {
                set.insert(items[position * 4 + bit].id.clone());
            }
        }
    }
    for extra in value["extra"].as_array().unwrap() {
        set.insert(extra.as_str().unwrap().to_owned());
    }
    set
}

pub fn strings(value: &Value) -> Vec<String> {
    value
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item.as_str().unwrap().to_owned())
        .collect()
}

/// A scripted `rng()` over the recorded `k` values (`k / 1_000_000`), counting draws.
pub struct Rolls {
    values: Vec<f64>,
    pub used: usize,
}

impl Rolls {
    pub fn new(value: &Value) -> Self {
        Rolls {
            values: value
                .as_array()
                .unwrap()
                .iter()
                .map(|k| k.as_f64().unwrap() / 1_000_000.0)
                .collect(),
            used: 0,
        }
    }

    pub fn next(&mut self) -> f64 {
        let value = *self
            .values
            .get(self.used)
            .expect("Rust drew more rng() values than TS");
        self.used += 1;
        value
    }

    pub fn exhausted(&self) -> bool {
        self.used == self.values.len()
    }
}
