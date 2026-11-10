//! Computes `ENGINE_BUILD_ID` (D2, D27) and exposes it as the
//! `ENGINE_BUILD_ID` compile-time env var read by `src/build_id.rs`.
//!
//! The hashing lives in `build/engine_build_id.rs` so race-cli's
//! `tests/build_id.rs` can recompute the id from the tree and compare it with
//! the compiled constant. See that file for exactly what is hashed.

use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

#[path = "build/engine_build_id.rs"]
mod engine_build_id;

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let root = manifest_dir
        .parent()
        .and_then(Path::parent)
        .expect("race-core lives at <root>/crates/race-core")
        .to_path_buf();

    let rustc = env::var("RUSTC").unwrap_or_else(|_| "rustc".to_owned());
    let output = Command::new(&rustc)
        .arg("-vV")
        .output()
        .unwrap_or_else(|e| panic!("ENGINE_BUILD_ID: cannot run `{rustc} -vV`: {e}"));
    assert!(
        output.status.success(),
        "ENGINE_BUILD_ID: `{rustc} -vV` failed"
    );
    let rustc_vv = String::from_utf8(output.stdout).expect("rustc -vV is UTF-8");

    let ts_compat = env::var_os("CARGO_FEATURE_TS_COMPAT").is_some();
    let cargo = PathBuf::from(env::var_os("CARGO").unwrap_or_else(|| "cargo".into()));
    let id = engine_build_id::compute(&root, &rustc_vv, ts_compat, &cargo);

    for path in &id.watch {
        println!("cargo:rerun-if-changed={}", path.display());
    }
    println!("cargo:rerun-if-env-changed=RUSTC");
    println!("cargo:rustc-env=ENGINE_BUILD_ID={}", id.hex);
    // `\n` can't go through rustc-env; the self-check test splits on `|`.
    println!(
        "cargo:rustc-env=ENGINE_BUILD_RUSTC={}",
        id.rustc.trim_end().replace('\n', "|")
    );
}
