//! `ENGINE_BUILD_ID` (D2): sha256 (lowercase hex) computed by `build.rs` over
//! the race-core and race-protocol sources, the engine part of the workspace
//! manifest and of `Cargo.lock`, the compiler version and the toolchain
//! channel (see `build/engine_build_id.rs`). It ties running code to a stored
//! race and is stored with every race, but is kept out of the result digest
//! (D9).

/// Build id of this engine, 64 lowercase hex characters.
pub const ENGINE_BUILD_ID: &str = env!("ENGINE_BUILD_ID");

/// The compiler lines hashed into [`ENGINE_BUILD_ID`] (`release:`,
/// `commit-hash:`, `LLVM version:`), joined with `|`. Lets the build-id
/// self-check recompute the id from the source tree.
#[doc(hidden)]
pub const ENGINE_BUILD_RUSTC: &str = env!("ENGINE_BUILD_RUSTC");

/// Whether this build hashed the `ts-compat` feature into the id.
#[doc(hidden)]
pub const ENGINE_BUILD_TS_COMPAT: bool = cfg!(feature = "ts-compat");

#[cfg(test)]
mod tests {
    use super::ENGINE_BUILD_ID;

    #[test]
    fn build_id_is_sha256_hex() {
        assert_eq!(ENGINE_BUILD_ID.len(), 64);
        assert!(
            ENGINE_BUILD_ID
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        );
    }
}
