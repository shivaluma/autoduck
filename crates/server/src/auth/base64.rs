//! The two base64 dialects the ported routes depend on, reproduced exactly:
//!
//! - [`jose_base64url`]: how `jose` 6 decodes JWS parts on Node 24 (no `Uint8Array.fromBase64`):
//!   reject `+` and `/`, map `-_` to `+/`, then WHATWG `atob` ("forgiving-base64 decode").
//! - [`node_base64`]: `Buffer.from(input, 'base64')`, used for `data:` avatars. It accepts both
//!   alphabets, skips every other character and stops at the first `=`.

/// The value of a base64 digit in either alphabet (`+/` and `-_`).
fn digit(byte: u8) -> Option<u32> {
    match byte {
        b'A'..=b'Z' => Some(u32::from(byte - b'A')),
        b'a'..=b'z' => Some(u32::from(byte - b'a') + 26),
        b'0'..=b'9' => Some(u32::from(byte - b'0') + 52),
        b'+' | b'-' => Some(62),
        b'/' | b'_' => Some(63),
        _ => None,
    }
}

/// Packs 6-bit digits into bytes, dropping leftover bits (as both decoders do).
fn pack(digits: impl Iterator<Item = u32>) -> Vec<u8> {
    let mut out = Vec::new();
    let mut buffer = 0u32;
    let mut bits = 0u32;
    for value in digits {
        buffer = (buffer << 6) | value;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            // Truncation is the point: keep the top 8 of the buffered bits.
            out.push(((buffer >> bits) & 0xff) as u8);
        }
    }
    out
}

/// WHATWG forgiving-base64 decode (`atob`), standard alphabet only.
pub fn forgiving_base64(input: &str) -> Option<Vec<u8>> {
    let mut data: Vec<u8> = input
        .bytes()
        .filter(|byte| !matches!(byte, b'\t' | b'\n' | b'\x0c' | b'\r' | b' '))
        .collect();
    if data.len().is_multiple_of(4) {
        if data.ends_with(b"==") {
            data.truncate(data.len() - 2);
        } else if data.ends_with(b"=") {
            data.truncate(data.len() - 1);
        }
    }
    if data.len() % 4 == 1 {
        return None;
    }
    let digits = data
        .iter()
        .map(|&byte| match byte {
            b'-' | b'_' => None,
            byte => digit(byte),
        })
        .collect::<Option<Vec<u32>>>()?;
    Some(pack(digits.into_iter()))
}

/// `jose`'s `decodeBase64(encoded, true)` on Node 24.
pub fn jose_base64url(input: &str) -> Option<Vec<u8>> {
    if input.contains(['+', '/']) {
        return None;
    }
    forgiving_base64(&input.replace('-', "+").replace('_', "/"))
}

/// `Buffer.from(input, 'base64')`. Never fails.
pub fn node_base64(input: &str) -> Vec<u8> {
    pack(
        input
            .bytes()
            .take_while(|&byte| byte != b'=')
            .filter_map(digit),
    )
}

/// Unpadded base64url encoding (RFC 4648 §5).
pub fn base64url_encode(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [
            chunk[0],
            chunk.get(1).copied().unwrap_or(0),
            chunk.get(2).copied().unwrap_or(0),
        ];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        for index in 0..=chunk.len() {
            out.push(char::from(
                ALPHABET[((n >> (18 - 6 * index)) & 63) as usize],
            ));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn node_buffer_semantics() {
        // Cases probed against `Buffer.from(s, 'base64')` on Node 24.17.
        let cases: [(&str, &[u8]); 17] = [
            ("QUJD", b"ABC"),
            ("QUI", b"AB"),
            ("QUI=", b"AB"),
            ("Q", b""),
            ("QU JD", b"ABC"),
            ("QUJD=", b"ABC"),
            ("QU=I", b"A"),
            ("QU=IQUJD", b"A"),
            ("Q-_x", &[67, 239, 241]),
            ("Q+/x", &[67, 239, 241]),
            ("QUJ\nD", b"ABC"),
            ("ab$cd", &[105, 183, 29]),
            ("QUJD====QUJD", b"ABC"),
            ("QUL", b"AB"),
            ("AB", &[0]),
            ("ABC", &[0, 16]),
            ("=QUJD", b""),
        ];
        for (input, expected) in cases {
            assert_eq!(node_base64(input), expected, "{input:?}");
        }
    }

    #[test]
    fn jose_base64url_semantics() {
        assert_eq!(jose_base64url("QUJD").as_deref(), Some(&b"ABC"[..]));
        assert_eq!(jose_base64url("QUI").as_deref(), Some(&b"AB"[..]));
        assert_eq!(jose_base64url("QUI=").as_deref(), Some(&b"AB"[..]));
        assert_eq!(jose_base64url("Q-_x").as_deref(), Some(&[67, 239, 241][..]));
        assert_eq!(jose_base64url("QU JD").as_deref(), Some(&b"ABC"[..]));
        assert_eq!(jose_base64url(""), Some(Vec::new()));
        assert_eq!(jose_base64url("Q+/x"), None);
        assert_eq!(jose_base64url("Q"), None);
        assert_eq!(jose_base64url("QUJD="), None);
        assert_eq!(jose_base64url("QU=I"), None);
        assert_eq!(jose_base64url("QUI=="), None);
        assert_eq!(jose_base64url("a$cd"), None);
    }

    #[test]
    fn encode_round_trips() {
        for len in 0..40usize {
            let bytes: Vec<u8> = (0..len)
                .map(|i| u8::try_from((i * 37 + 11) % 256).unwrap())
                .collect();
            let encoded = base64url_encode(&bytes);
            assert!(!encoded.contains('='));
            assert_eq!(jose_base64url(&encoded).unwrap(), bytes);
        }
        assert_eq!(base64url_encode(b"ABC"), "QUJD");
        assert_eq!(base64url_encode(&[0xfb, 0xff]), "-_8");
    }
}
