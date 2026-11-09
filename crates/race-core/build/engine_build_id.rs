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
// 6. The engine subgraph of `Cargo.lock`: starting from the `[dependencies]`
//    (normal, not dev or build) declared by race-core and race-protocol,
//    every reachable package as `name version source checksum`, sorted.
//    `ts-rs` is excluded: it only generates `.ts` files and never ships.
// 7. The compiler: the `release:`, `commit-hash:` and `LLVM version:` lines of
//    `$RUSTC -vV` (not `host:`, so the Mac and CI agree).
// 8. The `channel` of `rust-toolchain.toml`.
// 9. One byte: whether `ts-compat` is enabled. `std` is deliberately not
//    hashed: the server (std) and the browser (no std) must report the same
//    id. The target triple and profile are not hashed either.

use std::fs;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

pub const DOMAIN_TAG: &[u8] = b"autoduck/engine-build-id/v2\0";

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

/// Workspace crates whose normal dependencies root the lockfile walk.
pub const ENGINE_CRATES: [&str; 2] = ["race-core", "race-protocol"];

/// Normal dependencies that never reach engine output (std-only codegen).
pub const EXCLUDED_DEPS: [&str; 1] = ["ts-rs"];

/// Everything the build script needs to report back to cargo.
pub struct BuildId {
    pub hex: String,
    /// The normalised compiler lines that were hashed.
    pub rustc: String,
    /// Files to emit as `cargo:rerun-if-changed`.
    pub watch: Vec<PathBuf>,
}

/// Computes the id. `rustc_vv` is the full output of `$RUSTC -vV`.
pub fn compute(root: &Path, rustc_vv: &str, ts_compat: bool) -> BuildId {
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
    let mut roots: Vec<String> = Vec::new();
    for krate in ENGINE_CRATES {
        roots.push(krate.to_owned());
        let manifest = read_string(&root.join(format!("crates/{krate}/Cargo.toml")));
        for dep in normal_dependency_names(&manifest) {
            if !EXCLUDED_DEPS.contains(&dep.as_str()) {
                roots.push(dep);
            }
        }
    }
    let engine_packages = reachable(&lock, &roots);

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

    let mut lock_text = String::new();
    for p in &engine_packages {
        lock_text.push_str(&format!(
            "{} {} {} {}\n",
            p.name,
            p.version,
            p.source.as_deref().unwrap_or("-"),
            p.checksum.as_deref().unwrap_or("-")
        ));
    }
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
                .filter(|e| {
                    let key = entry_key(e);
                    engine_packages.contains(&key) && !EXCLUDED_DEPS.contains(&key)
                })
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

/// Keys of `[dependencies]` and `[target.*.dependencies]` in a crate manifest.
pub fn normal_dependency_names(manifest: &str) -> Vec<String> {
    let mut names = Vec::new();
    for (header, entries) in toml_sections(manifest) {
        let is_normal = header == "dependencies"
            || (header.starts_with("target.") && header.ends_with(".dependencies"));
        if !is_normal {
            continue;
        }
        for entry in entries {
            names.push(entry_key(&entry).to_owned());
        }
    }
    names
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

/// Finds the lock package a dependency spec refers to.
fn resolve_spec<'a>(lock: &'a [LockPackage], spec: &str) -> &'a LockPackage {
    let mut parts = spec.splitn(3, ' ');
    let name = parts.next().unwrap_or("");
    let version = parts.next();
    let matches: Vec<&LockPackage> = lock
        .iter()
        .filter(|p| p.name == name && version.is_none_or(|v| p.version == v))
        .collect();
    match matches.as_slice() {
        [one] => one,
        [] => panic!("ENGINE_BUILD_ID: `{spec}` not found in Cargo.lock"),
        _ => panic!("ENGINE_BUILD_ID: `{spec}` is ambiguous in Cargo.lock"),
    }
}

/// Packages reachable from `roots` (names), sorted by `(name, version)`.
/// `roots[i]` may be a bare name; workspace crates' own lock entries list
/// dev and build dependencies too, so only the roots' named deps are entered.
pub fn reachable<'a>(lock: &'a [LockPackage], roots: &[String]) -> Vec<&'a LockPackage> {
    let mut seen: Vec<&LockPackage> = Vec::new();
    let mut stack: Vec<&LockPackage> = Vec::new();
    for root in roots {
        // A root names either an engine crate or one of its declared deps;
        // the declared dep is resolved through the engine crate's own
        // dependency list so a duplicate (`name version`) picks the right one.
        let spec = ENGINE_CRATES
            .iter()
            .filter_map(|krate| lock.iter().find(|p| p.name == *krate))
            .flat_map(|p| p.dependencies.iter())
            .find(|d| d.split(' ').next() == Some(root.as_str()))
            .cloned()
            .unwrap_or_else(|| root.clone());
        stack.push(resolve_spec(lock, &spec));
    }
    while let Some(pkg) = stack.pop() {
        if seen.iter().any(|p| std::ptr::eq(*p, pkg)) {
            continue;
        }
        seen.push(pkg);
        if ENGINE_CRATES.contains(&pkg.name.as_str()) {
            // Workspace crates: only follow deps that are themselves roots.
            for dep in &pkg.dependencies {
                let name = dep.split(' ').next().unwrap_or("");
                if roots.iter().any(|r| r == name) {
                    stack.push(resolve_spec(lock, dep));
                }
            }
        } else {
            for dep in &pkg.dependencies {
                stack.push(resolve_spec(lock, dep));
            }
        }
    }
    seen.sort_by(|a, b| {
        (a.name.as_str(), a.version.as_str()).cmp(&(b.name.as_str(), b.version.as_str()))
    });
    seen
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
