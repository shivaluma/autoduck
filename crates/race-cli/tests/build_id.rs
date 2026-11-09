//! Build-id self-check (review 1 MINOR 5): recomputes `ENGINE_BUILD_ID` from
//! the checked-out tree with the same code `race-core/build.rs` uses and
//! asserts it equals the compiled constant. A mismatch means the build script
//! did not rerun after a change (for example a backdated mtime after a tar,
//! rsync or Docker `COPY` restore over a cached `target/`), so the binary
//! reports an id that does not describe its source.

#![allow(clippy::disallowed_methods, clippy::disallowed_types)]

use std::path::Path;

#[path = "../../race-core/build/engine_build_id.rs"]
#[allow(dead_code)]
mod engine_build_id;

fn workspace_root() -> &'static Path {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("workspace root")
}

#[test]
fn compiled_build_id_matches_source_tree() {
    let rustc_vv = race_core::build_id::ENGINE_BUILD_RUSTC.replace('|', "\n");
    let id = engine_build_id::compute(
        workspace_root(),
        &rustc_vv,
        race_core::build_id::ENGINE_BUILD_TS_COMPAT,
    );
    assert_eq!(
        id.hex,
        race_core::ENGINE_BUILD_ID,
        "ENGINE_BUILD_ID is stale; run `cargo clean -p race-core` and rebuild"
    );
}

#[test]
fn compiler_line_matches_rustc_on_path() {
    // The rustc that runs this test (rustup resolves rust-toolchain.toml) must
    // be the one the engine was built with.
    let Ok(out) = std::process::Command::new("rustc")
        .arg("-vV")
        .current_dir(workspace_root())
        .output()
    else {
        return;
    };
    let vv = String::from_utf8(out.stdout).expect("utf8");
    assert_eq!(
        engine_build_id::normalise_rustc(&vv)
            .trim_end()
            .replace('\n', "|"),
        race_core::build_id::ENGINE_BUILD_RUSTC
    );
}

#[test]
fn engine_lock_subgraph_ignores_tooling_deps() {
    let root = workspace_root();
    let lock =
        engine_build_id::parse_lock(&std::fs::read_to_string(root.join("Cargo.lock")).unwrap());
    let mut roots = Vec::new();
    for krate in engine_build_id::ENGINE_CRATES {
        roots.push(krate.to_owned());
        let manifest =
            std::fs::read_to_string(root.join(format!("crates/{krate}/Cargo.toml"))).unwrap();
        roots.extend(
            engine_build_id::normal_dependency_names(&manifest)
                .into_iter()
                .filter(|d| !engine_build_id::EXCLUDED_DEPS.contains(&d.as_str())),
        );
    }
    let names: Vec<String> = engine_build_id::reachable(&lock, &roots)
        .iter()
        .map(|p| p.name.clone())
        .collect();
    for expected in [
        "race-core",
        "race-protocol",
        "serde",
        "serde_json",
        "libm",
        "ryu-js",
        "sha2",
    ] {
        assert!(
            names.iter().any(|n| n == expected),
            "{expected} missing from {names:?}"
        );
    }
    for excluded in [
        "flate2",
        "clap",
        "rayon",
        "ts-rs",
        "wasm-bindgen",
        "anyhow",
        "race-cli",
        "race-wasm",
    ] {
        assert!(
            !names.iter().any(|n| n == excluded),
            "{excluded} leaked into {names:?}"
        );
    }
}

#[test]
fn workspace_manifest_input_keeps_only_engine_parts() {
    let text = r#"
[workspace]
members = ["crates/*"]

[workspace.package]
version = "0.1.0" # bumping this must not change the id
edition = "2024"

[workspace.dependencies]
serde = { version = "=1", features = [
    "derive", # comment
] }
clap = { version = "=4" }

[profile.release]
panic = "unwind"
"#;
    let out = engine_build_id::workspace_manifest_digest_input(text, &["serde"]);
    assert_eq!(
        out,
        "[workspace.package]\nedition = \"2024\"\n[workspace.dependencies]\nserde = { version = \"=1\", features = [\n\"derive\",\n] }\n[profile.release]\npanic = \"unwind\"\n"
    );
}
