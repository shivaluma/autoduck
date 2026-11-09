//! Commit and digest (D9): `seedCommit = sha256(engineConfigJson)`,
//! `resultDigest = sha256(JCS(DigestEnvelope))`, `trackDefSha256`,
//! `eventsSha256` (excluding meta events and `seq`, D7) and `motionSha256` (a
//! sha256 fold over `state_hash` every 60th tick and the final tick).
//!
//! This module holds the sha256/hex primitives and the JCS-based commit and
//! digest helpers. All hex output is lowercase, 64 characters, the same as
//! Node's `createHash('sha256').digest('hex')`.
//!
//! The `DigestEnvelope`, `eventsSha256` and `motionSha256` producers are built
//! on these helpers once their input types exist (Phase 2).

use alloc::string::String;
use sha2::{Digest, Sha256};

use crate::canonical::{JcsError, JcsValue, to_jcs_string};

/// A raw sha256 digest.
pub type Sha256Bytes = [u8; 32];

const HEX_LOWER: &[u8; 16] = b"0123456789abcdef";

/// sha256 of `bytes`.
pub fn sha256(bytes: &[u8]) -> Sha256Bytes {
    let mut out = [0u8; 32];
    out.copy_from_slice(&Sha256::digest(bytes));
    out
}

/// Lowercase hex of any byte string.
pub fn to_hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        s.push(HEX_LOWER[(b >> 4) as usize] as char);
        s.push(HEX_LOWER[(b & 0x0F) as usize] as char);
    }
    s
}

/// Lowercase hex sha256 of `bytes`.
pub fn sha256_hex(bytes: &[u8]) -> String {
    to_hex(&sha256(bytes))
}

/// `seedCommit = sha256(engineConfigJson)` (D9), where `engine_config_json`
/// is the stored JCS text of the resolved config, hashed byte for byte.
/// Rust counterpart of `createRaceCommit` in `lib/racing/audit.ts`, but over
/// JCS bytes instead of the TS-era `canonicalize` output.
pub fn create_race_commit(engine_config_json: &[u8]) -> String {
    sha256_hex(engine_config_json)
}

/// `resultDigest = sha256(JCS(DigestEnvelope))` (D9) over already-written
/// envelope JCS bytes.
pub fn result_digest(envelope_jcs: &[u8]) -> String {
    sha256_hex(envelope_jcs)
}

/// sha256 hex over the JCS form of a typed value. Use for `trackDefSha256`,
/// `resultDigest` (with the envelope) or any other "digest over JCS".
pub fn jcs_sha256_hex<T: JcsValue + ?Sized>(value: &T) -> Result<String, JcsError> {
    to_jcs_string(value).map(|jcs| sha256_hex(jcs.as_bytes()))
}

/// JCS text and its commit in one step: returns
/// `(engineConfigJson, seedCommit)` for a typed config value.
pub fn jcs_with_commit<T: JcsValue + ?Sized>(value: &T) -> Result<(String, String), JcsError> {
    let jcs = to_jcs_string(value)?;
    let commit = create_race_commit(jcs.as_bytes());
    Ok((jcs, commit))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_known_vectors() {
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(to_hex(&[0x00, 0x0f, 0xa0, 0xff]), "000fa0ff");
    }

    #[test]
    fn digest_over_jcs() {
        // Node: createHash("sha256").update("[1e+21,5e-7,0]").digest("hex")
        let v = [1e21, 5e-7, -0.0];
        let (jcs, commit) = jcs_with_commit(&v).unwrap();
        assert_eq!(jcs, "[1e+21,5e-7,0]");
        assert_eq!(
            commit,
            "4b4cc73776391f822de7b8866680b29d5e87b68318bb0679356e7d5f4e88c6f2"
        );
        assert_eq!(jcs_sha256_hex(&v).unwrap(), commit);
        assert_eq!(result_digest(jcs.as_bytes()), commit);
        assert_eq!(jcs_sha256_hex(&f64::NAN), Err(JcsError::NonFiniteNumber));
    }
}
