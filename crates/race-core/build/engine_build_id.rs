// ENGINE_BUILD_ID computation (plan D2, D27), shared by `race-core/build.rs`
// (through `#[path]`) and by race-cli's `tests/build_id.rs`, which recomputes
// the id from the checked-out tree and asserts it equals the compiled
// `race_core::ENGINE_BUILD_ID` (catches a stale id after an mtime-preserving
// restore, review 1 MINOR 5).
//
// The id is sha256 over these frames, in order. Each frame is
// `name \0 len:u64-le bytes`, so concatenations can't collide.
//
// 1. `DOMAIN_TAG`.
// 2. Engine sources: every `*.rs` file under `crates/race-core/src` and
//    `crates/race-protocol/src`, sorted by `/`-separated workspace-relative
//    path. Editor/merge leftovers (`*~`, `*.orig`, `*.rej`, `*.swp`, `#x#`,
//    dotfiles) are ignored. Any other regular file, a symlink or a special
//    file is a hard error: an `include_str!` target must be added to
//    `EXTRA_SOURCE_EXTENSIONS` on purpose.
// 3. Engine build inputs: `crates/race-core/{Cargo.toml,build.rs,
//    build/engine_build_id.rs}` and `crates/race-protocol/Cargo.toml`.
// 4. The behaviour-relevant parts of the workspace `Cargo.toml`
//    (comments and blank lines stripped): the `[workspace.dependencies]`
//    entries of crates in the engine graph, `edition` from
//    `[workspace.package]`, and every `[profile.*]`, `[patch.*]` and
//    `[replace]` section.
// 5. `.cargo/config.toml` at the workspace root, if it exists.
// 6. The engine's resolved dependency graph, each package as
//    `name version source checksum` (source and checksum from `Cargo.lock`),
//    sorted. The graph is what cargo's feature resolver builds for race-core
//    and race-protocol alone (`cargo tree -p race-core -p race-protocol
//    -F race-core/std -e normal --target all --frozen`): normal edges only,
//    every target, the engine's own features. Walking `Cargo.lock` instead is
//    wrong: its edges are the union over every feature any workspace member
//    enables, so a server-only `serde_json/preserve_order` added
//    `indexmap`/`foldhash` under the engine's `serde_json` and changed the id.
//    `--target all` keeps native and wasm on one id; `std` is enabled so the
//    graph is the server's superset of the browser's (std is not hashed).
// 7. The compiler: the `release:`, `commit-hash:` and `LLVM version:` lines of
//    `$RUSTC -vV` (not `host:`, so the Mac and CI agree).
// 8. The `channel` of `rust-toolchain.toml`.
// 9. One byte: whether `ts-compat` is enabled. `std` is deliberately not
//    hashed: the server (std) and the browser (no std) must report the same
//    id. The target triple and profile are not hashed either.

use std::fs;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

pub const DOMAIN_TAG: &[u8] = b"autoduck/engine-build-id/v3\0";

/// Directories whose `*.rs` files are the engine source tree.
pub const SOURCE_DIRS: [&str; 2] = ["crates/race-core/src", "crates/race-protocol/src"];

/// Non-`.rs` files allowed (and hashed) under the source dirs. Add an
/// extension here when a module starts to `include_str!` a sibling file.
pub const EXTRA_SOURCE_EXTENSIONS: [&str; 0] = [];

/// Individual files that are part of the engine build.
pub const BUILD_FILES: [&str; 4] = [
    "crates/race-core/Cargo.toml",
    "crates/race-core/build.rs",
    "crates/race-core/build/engine_build_id.rs",
    "crates/race-protocol/Cargo.toml",
];

/// Workspace crates whose resolved dependency graph is hashed.
pub const ENGINE_CRATES: [&str; 2] = ["race-core", "race-protocol"];

/// Features the engine graph is resolved with (see frame 6).
pub const ENGINE_GRAPH_FEATURES: &str = "race-core/std,race-protocol/std";

/// Everything the build script needs to report back to cargo.
pub struct BuildId {
    pub hex: String,
    /// The normalised compiler lines that were hashed.
    pub rustc: String,
    /// Files to emit as `cargo:rerun-if-changed`.
    pub watch: Vec<PathBuf>,
}

/// Computes the id. `rustc_vv` is the full output of `$RUSTC -vV`; `cargo`
/// is the cargo binary that resolves the engine graph (`$CARGO`).
pub fn compute(root: &Path, rustc_vv: &str, ts_compat: bool, cargo: &Path) -> BuildId {
    let mut hasher = Sha256::new();
    hasher.update(DOMAIN_TAG);
    let mut watch = Vec::new();

    // 2 + 3. Sources and build files.
    let mut files: Vec<(String, PathBuf)> = Vec::new();
    for dir in SOURCE_DIRS {
        let abs = root.join(dir);
        watch.push(abs.clone());
        collect_sources(root, &abs, &mut files);
    }
    for file in BUILD_FILES {
        let abs = root.join(file);
        watch.push(abs.clone());
        files.push((file.to_owned(), abs));
    }
    files.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));
    for (rel, abs) in &files {
        frame(&mut hasher, rel, &read(abs));
    }

    // 6 is computed first because 4 needs the engine package names.
    let lock_path = root.join("Cargo.lock");
    watch.push(lock_path.clone());
    let lock = parse_lock(&read_string(&lock_path));
    let resolved = resolve_engine_graph(cargo, root);
    let engine_packages = engine_lock_packages(&lock, &resolved);

    // 4. Workspace manifest.
    let manifest_path = root.join("Cargo.toml");
    watch.push(manifest_path.clone());
    let names: Vec<&str> = engine_packages.iter().map(|p| p.name.as_str()).collect();
    let workspace = workspace_manifest_digest_input(&read_string(&manifest_path), &names);
    frame(&mut hasher, "Cargo.toml#engine", workspace.as_bytes());

    // 5. Optional cargo config. Only watched when present: cargo treats a
    // missing rerun-if-changed path as always dirty. Creating the file later
    // is caught by race-cli's build-id self-check test.
    let config_path = root.join(".cargo/config.toml");
    if config_path.is_file() {
        watch.push(config_path.clone());
        frame(&mut hasher, ".cargo/config.toml", &read(&config_path));
    }

    let lock_text = engine_lock_text(&engine_packages);
    frame(&mut hasher, "Cargo.lock#engine", lock_text.as_bytes());

    // 7. Compiler.
    let rustc = normalise_rustc(rustc_vv);
    frame(&mut hasher, "rustc", rustc.as_bytes());

    // 8. Toolchain channel.
    let toolchain_path = root.join("rust-toolchain.toml");
    watch.push(toolchain_path.clone());
    let channel = toolchain_channel(&read_string(&toolchain_path));
    frame(
        &mut hasher,
        "rust-toolchain.toml#channel",
        channel.as_bytes(),
    );

    // 9. Output-changing feature.
    frame(&mut hasher, "feature:ts-compat", &[u8::from(ts_compat)]);

    let digest = hasher.finalize();
    let mut hex = String::with_capacity(64);
    for byte in digest.iter() {
        hex.push(char::from_digit(u32::from(byte >> 4), 16).expect("nibble"));
        hex.push(char::from_digit(u32::from(byte & 0x0f), 16).expect("nibble"));
    }
    BuildId { hex, rustc, watch }
}

fn frame(hasher: &mut Sha256, name: &str, bytes: &[u8]) {
    hasher.update(name.as_bytes());
    hasher.update([0u8]);
    hasher.update((bytes.len() as u64).to_le_bytes());
    hasher.update(bytes);
}

fn read(path: &Path) -> Vec<u8> {
    fs::read(path)
        .unwrap_or_else(|e| panic!("ENGINE_BUILD_ID: cannot read {}: {e}", path.display()))
}

fn read_string(path: &Path) -> String {
    String::from_utf8(read(path))
        .unwrap_or_else(|e| panic!("ENGINE_BUILD_ID: {} is not UTF-8: {e}", path.display()))
}

/// Leftovers from editors and merges that must not change the id.
fn is_ignored_leftover(name: &str) -> bool {
    name.starts_with('.')
        || name.ends_with('~')
        || name.ends_with(".orig")
        || name.ends_with(".rej")
        || name.ends_with(".swp")
        || name.ends_with(".bak")
        || (name.starts_with('#') && name.ends_with('#'))
}

fn collect_sources(root: &Path, dir: &Path, out: &mut Vec<(String, PathBuf)>) {
    let entries = fs::read_dir(dir)
        .unwrap_or_else(|e| panic!("ENGINE_BUILD_ID: cannot list {}: {e}", dir.display()));
    for entry in entries {
        let entry = entry.expect("dir entry");
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if is_ignored_leftover(&name) {
            continue;
        }
        let file_type = entry.file_type().expect("file type");
        if file_type.is_symlink() {
            panic!(
                "ENGINE_BUILD_ID: symlink {} in the engine source tree is not allowed",
                path.display()
            );
        }
        if file_type.is_dir() {
            collect_sources(root, &path, out);
            continue;
        }
        if !file_type.is_file() {
            panic!(
                "ENGINE_BUILD_ID: special file {} in the engine source tree",
                path.display()
            );
        }
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        if ext != "rs" && !EXTRA_SOURCE_EXTENSIONS.contains(&ext) {
            panic!(
                "ENGINE_BUILD_ID: unexpected file {} in the engine source tree; delete it, or add \
                 its extension to EXTRA_SOURCE_EXTENSIONS in crates/race-core/build/engine_build_id.rs",
                path.display()
            );
        }
        let rel = path
            .strip_prefix(root)
            .expect("under root")
            .components()
            .map(|c| c.as_os_str().to_string_lossy().into_owned())
            .collect::<Vec<_>>()
            .join("/");
        out.push((rel, path));
    }
}

/// Removes a `#` comment outside a basic or literal TOML string.
fn strip_toml_comment(line: &str) -> &str {
    let mut in_basic = false;
    let mut in_literal = false;
    let mut escaped = false;
    for (i, c) in line.char_indices() {
        if in_basic {
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if c == '"' {
                in_basic = false;
            }
            continue;
        }
        if in_literal {
            if c == '\'' {
                in_literal = false;
            }
            continue;
        }
        match c {
            '"' => in_basic = true,
            '\'' => in_literal = true,
            '#' => return &line[..i],
            _ => {}
        }
    }
    line
}

/// Net `[`/`{` depth change of a comment-stripped line, ignoring strings.
fn bracket_delta(line: &str) -> i32 {
    let mut depth = 0;
    let mut in_basic = false;
    let mut in_literal = false;
    let mut escaped = false;
    for c in line.chars() {
        if in_basic {
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if c == '"' {
                in_basic = false;
            }
            continue;
        }
        if in_literal {
            if c == '\'' {
                in_literal = false;
            }
            continue;
        }
        match c {
            '"' => in_basic = true,
            '\'' => in_literal = true,
            '[' | '{' => depth += 1,
            ']' | '}' => depth -= 1,
            _ => {}
        }
    }
    depth
}

/// Splits a TOML document into `(header, entries)` where each entry is the
/// comment-stripped, trimmed text of one `key = value` (multi-line values
/// joined with `\n`). Entries before the first header have header `""`.
fn toml_sections(text: &str) -> Vec<(String, Vec<String>)> {
    let mut sections: Vec<(String, Vec<String>)> = vec![(String::new(), Vec::new())];
    let mut pending: Option<(String, i32)> = None;
    for raw in text.lines() {
        let line = strip_toml_comment(raw).trim();
        if line.is_empty() {
            continue;
        }
        if let Some((mut acc, depth)) = pending.take() {
            acc.push('\n');
            acc.push_str(line);
            let depth = depth + bracket_delta(line);
            if depth > 0 {
                pending = Some((acc, depth));
            } else {
                sections.last_mut().expect("section").1.push(acc);
            }
            continue;
        }
        if line.starts_with('[') && !line.contains('=') {
            let header = line
                .trim_start_matches('[')
                .trim_end_matches(']')
                .trim()
                .to_owned();
            sections.push((header, Vec::new()));
            continue;
        }
        let depth = bracket_delta(line);
        if depth > 0 {
            pending = Some((line.to_owned(), depth));
        } else {
            sections
                .last_mut()
                .expect("section")
                .1
                .push(line.to_owned());
        }
    }
    if let Some((acc, _)) = pending {
        panic!("ENGINE_BUILD_ID: unterminated TOML value: {acc}");
    }
    sections
}

fn entry_key(entry: &str) -> &str {
    entry
        .split('=')
        .next()
        .unwrap_or("")
        .trim()
        .trim_matches('"')
}

/// The normalised, behaviour-relevant part of the workspace `Cargo.toml`.
pub fn workspace_manifest_digest_input(text: &str, engine_packages: &[&str]) -> String {
    let mut out = String::new();
    for (header, entries) in toml_sections(text) {
        let keep: Vec<&String> = if header == "workspace.dependencies" {
            entries
                .iter()
                .filter(|e| engine_packages.contains(&entry_key(e)))
                .collect()
        } else if header == "workspace.package" {
            entries
                .iter()
                .filter(|e| entry_key(e) == "edition")
                .collect()
        } else if header.starts_with("profile")
            || header.starts_with("patch")
            || header == "replace"
        {
            entries.iter().collect()
        } else {
            Vec::new()
        };
        if keep.is_empty() {
            continue;
        }
        out.push('[');
        out.push_str(&header);
        out.push_str("]\n");
        for entry in keep {
            out.push_str(entry);
            out.push('\n');
        }
    }
    out
}

pub struct LockPackage {
    pub name: String,
    pub version: String,
    pub source: Option<String>,
    pub checksum: Option<String>,
    /// Raw dependency specs: `name`, `name version` or `name version (source)`.
    pub dependencies: Vec<String>,
}

fn unquote(value: &str) -> String {
    value.trim().trim_matches('"').to_owned()
}

pub fn parse_lock(text: &str) -> Vec<LockPackage> {
    let mut packages = Vec::new();
    for (header, entries) in toml_sections(text) {
        if header != "package" {
            continue;
        }
        let mut pkg = LockPackage {
            name: String::new(),
            version: String::new(),
            source: None,
            checksum: None,
            dependencies: Vec::new(),
        };
        for entry in entries {
            let (key, value) = entry.split_once('=').expect("lock entry");
            match key.trim() {
                "name" => pkg.name = unquote(value),
                "version" => pkg.version = unquote(value),
                "source" => pkg.source = Some(unquote(value)),
                "checksum" => pkg.checksum = Some(unquote(value)),
                "dependencies" => {
                    let inner = value.trim().trim_start_matches('[').trim_end_matches(']');
                    for item in inner.split(',') {
                        let item = unquote(item.trim());
                        if !item.is_empty() {
                            pkg.dependencies.push(item);
                        }
                    }
                }
                _ => {}
            }
        }
        assert!(
            !pkg.name.is_empty(),
            "ENGINE_BUILD_ID: lock package without a name"
        );
        packages.push(pkg);
    }
    packages
}

/// Runs `cargo tree` for the engine crates alone and returns the resolved
/// packages as `(name, version)`, sorted and deduplicated. `--frozen`: the
/// outer build has already brought `Cargo.lock` up to date, and this must
/// never touch the network or rewrite the lock. `cargo tree` takes no build
/// lock, so running it from a build script is safe.
pub fn resolve_engine_graph(cargo: &Path, root: &Path) -> Vec<(String, String)> {
    let mut cmd = std::process::Command::new(cargo);
    cmd.arg("tree")
        .arg("--manifest-path")
        .arg(root.join("Cargo.toml"))
        .args(["--frozen", "--quiet", "-e", "normal", "--target", "all"])
        .args(["--prefix", "none", "--charset", "ascii", "--format", "{p}"])
        .args(["--features", ENGINE_GRAPH_FEATURES]);
    for krate in ENGINE_CRATES {
        cmd.args(["-p", krate]);
    }
    // A target set for the outer build must not narrow the graph.
    cmd.env_remove("CARGO_BUILD_TARGET");
    let output = cmd.output().unwrap_or_else(|e| {
        panic!(
            "ENGINE_BUILD_ID: cannot run `{} tree`: {e}",
            cargo.display()
        )
    });
    assert!(
        output.status.success(),
        "ENGINE_BUILD_ID: `cargo tree` for the engine graph failed:\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
    parse_tree_output(&String::from_utf8(output.stdout).expect("cargo tree output is UTF-8"))
}

/// Parses `cargo tree --prefix none --format {p}` lines
/// (`name vX.Y.Z [(path|proc-macro)] [(*)]`) into sorted, unique
/// `(name, version)` pairs.
pub fn parse_tree_output(text: &str) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let mut parts = line.split_whitespace();
        let name = parts.next().expect("package name");
        let version = parts
            .next()
            .and_then(|v| v.strip_prefix('v'))
            .unwrap_or_else(|| panic!("ENGINE_BUILD_ID: unexpected `cargo tree` line `{line}`"));
        out.push((name.to_owned(), version.to_owned()));
    }
    out.sort();
    out.dedup();
    out
}

/// The lock entries of the resolved engine packages, sorted by
/// `(name, version)`. Every resolved package must have exactly one entry.
pub fn engine_lock_packages<'a>(
    lock: &'a [LockPackage],
    resolved: &[(String, String)],
) -> Vec<&'a LockPackage> {
    let mut out: Vec<&LockPackage> = resolved
        .iter()
        .map(|(name, version)| {
            let matches: Vec<&LockPackage> = lock
                .iter()
                .filter(|p| &p.name == name && &p.version == version)
                .collect();
            match matches.as_slice() {
                [one] => *one,
                [] => panic!("ENGINE_BUILD_ID: `{name} {version}` not found in Cargo.lock"),
                _ => panic!("ENGINE_BUILD_ID: `{name} {version}` is ambiguous in Cargo.lock"),
            }
        })
        .collect();
    out.sort_by(|a, b| {
        (a.name.as_str(), a.version.as_str()).cmp(&(b.name.as_str(), b.version.as_str()))
    });
    out
}

/// The hashed text of frame 6: one `name version source checksum` line per
/// engine package.
pub fn engine_lock_text(packages: &[&LockPackage]) -> String {
    let mut text = String::new();
    for p in packages {
        text.push_str(&format!(
            "{} {} {} {}\n",
            p.name,
            p.version,
            p.source.as_deref().unwrap_or("-"),
            p.checksum.as_deref().unwrap_or("-")
        ));
    }
    text
}

/// The `release:`, `commit-hash:` and `LLVM version:` lines of `rustc -vV`.
pub fn normalise_rustc(vv: &str) -> String {
    let mut out = String::new();
    for prefix in ["release:", "commit-hash:", "LLVM version:"] {
        let line = vv
            .lines()
            .find(|l| l.starts_with(prefix))
            .unwrap_or_else(|| panic!("ENGINE_BUILD_ID: `rustc -vV` has no `{prefix}` line"));
        out.push_str(line.trim());
        out.push('\n');
    }
    out
}

/// The `channel` value of `rust-toolchain.toml`.
pub fn toolchain_channel(text: &str) -> String {
    for (header, entries) in toml_sections(text) {
        if header != "toolchain" {
            continue;
        }
        for entry in entries {
            if entry_key(&entry) == "channel" {
                let (_, value) = entry.split_once('=').expect("channel");
                return unquote(value);
            }
        }
    }
    panic!("ENGINE_BUILD_ID: rust-toolchain.toml has no [toolchain] channel")
}
