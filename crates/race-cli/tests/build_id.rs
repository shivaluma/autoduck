//! Build-id self-check (review 1 MINOR 5): recomputes `ENGINE_BUILD_ID` from
//! the checked-out tree with the same code `race-core/build.rs` uses and
//! asserts it equals the compiled constant. A mismatch means the build script
//! did not rerun after a change (for example a backdated mtime after a tar,
//! rsync or Docker `COPY` restore over a cached `target/`), so the binary
//! reports an id that does not describe its source.

#![allow(clippy::disallowed_methods, clippy::disallowed_types)]

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[path = "../../race-core/build/engine_build_id.rs"]
#[allow(dead_code)]
mod engine_build_id;

fn workspace_root() -> &'static Path {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("workspace root")
}

fn cargo() -> PathBuf {
    PathBuf::from(env!("CARGO"))
}

fn rustc_vv() -> String {
    race_core::build_id::ENGINE_BUILD_RUSTC.replace('|', "\n")
}

fn compute(root: &Path) -> engine_build_id::BuildId {
    engine_build_id::compute(
        root,
        &rustc_vv(),
        race_core::build_id::ENGINE_BUILD_TS_COMPAT,
        &cargo(),
    )
}

#[test]
fn compiled_build_id_matches_source_tree() {
    assert_eq!(
        compute(workspace_root()).hex,
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

fn engine_graph_names() -> Vec<String> {
    engine_build_id::resolve_engine_graph(&cargo(), workspace_root())
        .into_iter()
        .map(|(name, _)| name)
        .collect()
}

#[test]
fn engine_graph_ignores_tooling_and_server_deps() {
    let names = engine_graph_names();
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
    // Tooling (race-cli, race-wasm), the server and the optional deps the
    // server's features switch on in shared crates (`serde_json/preserve_order`
    // -> indexmap/foldhash; digest's ctutils) must stay out.
    for excluded in [
        "flate2",
        "clap",
        "rayon",
        "ts-rs",
        "wasm-bindgen",
        "anyhow",
        "race-cli",
        "race-wasm",
        "autoduck-server",
        "indexmap",
        "foldhash",
        "hashbrown",
        "ctutils",
        "tokio",
        "sqlx",
    ] {
        assert!(
            !names.iter().any(|n| n == excluded),
            "{excluded} leaked into {names:?}"
        );
    }
}

/// Native and wasm builds must report one id. The build script never reads
/// the target, and the graph is resolved with `--target all`: sha2's
/// `cpufeatures` (x86/aarch64 only, never built for wasm) proves every
/// target's edges are in, so `race-cli build-id` and the wasm package's
/// `engineBuildId()` hash the same packages. CI compares the two ids directly.
#[test]
fn engine_graph_covers_every_target() {
    let names = engine_graph_names();
    assert!(
        names.iter().any(|n| n == "cpufeatures"),
        "cpufeatures missing: the graph is not resolved for every target: {names:?}"
    );
}

fn copy_tree(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for entry in fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let name = entry.file_name();
        if name == "target" || name == "node_modules" {
            continue;
        }
        let dst = to.join(&name);
        if entry.file_type().unwrap().is_dir() {
            copy_tree(&entry.path(), &dst);
        } else {
            fs::copy(entry.path(), &dst).unwrap();
        }
    }
}

fn sync_lock(dir: &Path) {
    let out = Command::new(cargo())
        .current_dir(dir)
        .args(["update", "--workspace", "--offline", "--quiet"])
        .output()
        .expect("cargo update");
    assert!(
        out.status.success(),
        "cargo update --workspace failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

fn lock_package<'a>(
    lock: &'a [engine_build_id::LockPackage],
    name: &str,
) -> &'a engine_build_id::LockPackage {
    lock.iter()
        .find(|p| p.name == name)
        .unwrap_or_else(|| panic!("{name} not in the lock"))
}

/// Copies just the engine crates into a scratch workspace, then adds a crate
/// that pulls unrelated packages into `Cargo.lock` and switches on optional
/// deps of the engine's own dependencies (what the server does). The id must
/// not move, and it must equal the real workspace's id.
#[test]
fn unrelated_lock_packages_do_not_change_the_id() {
    let root = workspace_root();
    let scratch = Path::new(env!("CARGO_TARGET_TMPDIR"))
        .join(format!("build-id-scope-{}", std::process::id()));
    let _ = fs::remove_dir_all(&scratch);
    for file in ["Cargo.toml", "Cargo.lock", "rust-toolchain.toml"] {
        fs::create_dir_all(&scratch).unwrap();
        fs::copy(root.join(file), scratch.join(file)).unwrap();
    }
    if root.join(".cargo/config.toml").is_file() {
        copy_tree(&root.join(".cargo"), &scratch.join(".cargo"));
    }
    for krate in engine_build_id::ENGINE_CRATES {
        copy_tree(
            &root.join("crates").join(krate),
            &scratch.join("crates").join(krate),
        );
    }

    // Engine crates only: the lock loses every server and tooling package.
    sync_lock(&scratch);
    let minimal_lock =
        engine_build_id::parse_lock(&fs::read_to_string(scratch.join("Cargo.lock")).unwrap());
    assert!(!minimal_lock.iter().any(|p| p.name == "indexmap"));
    let minimal = compute(&scratch).hex;

    // Add an unrelated crate: new packages, plus serde_json's preserve_order
    // (adds an indexmap edge under the engine's serde_json in the lock).
    let extra = scratch.join("crates/unrelated");
    fs::create_dir_all(extra.join("src")).unwrap();
    fs::write(extra.join("src/lib.rs"), "").unwrap();
    fs::write(
        extra.join("Cargo.toml"),
        r#"[package]
name = "unrelated"
version.workspace = true
edition.workspace = true
publish = false

[dependencies]
serde_json = { workspace = true, features = ["std", "preserve_order"] }
subtle = { version = "=2.6.1", default-features = false }
"#,
    )
    .unwrap();
    sync_lock(&scratch);
    let extra_lock =
        engine_build_id::parse_lock(&fs::read_to_string(scratch.join("Cargo.lock")).unwrap());
    assert!(
        lock_package(&extra_lock, "serde_json")
            .dependencies
            .iter()
            .any(|d| d.starts_with("indexmap")),
        "the scratch lock should carry the preserve_order edge"
    );
    assert!(extra_lock.iter().any(|p| p.name == "subtle"));
    let with_extra = compute(&scratch).hex;

    let _ = fs::remove_dir_all(&scratch);
    assert_eq!(
        minimal, with_extra,
        "an unrelated lock package changed the id"
    );
    assert_eq!(
        minimal,
        race_core::ENGINE_BUILD_ID,
        "server/tooling packages in the real Cargo.lock change the id"
    );
}

#[test]
fn tree_output_parses_to_unique_pairs() {
    let text = "race-core v0.1.0 (/x/crates/race-core)\nserde v1.0.229\nserde_derive v1.0.229 (proc-macro)\nserde v1.0.229 (*)\n\n";
    assert_eq!(
        engine_build_id::parse_tree_output(text),
        vec![
            ("race-core".to_owned(), "0.1.0".to_owned()),
            ("serde".to_owned(), "1.0.229".to_owned()),
            ("serde_derive".to_owned(), "1.0.229".to_owned()),
        ]
    );
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
