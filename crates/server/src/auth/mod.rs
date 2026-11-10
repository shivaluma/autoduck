//! Request authentication shared by routes:
//! - [`admin`]: `RACE_SECRET_KEY` checks (constant time, fail closed), like `lib/auth/admin-secret.ts`.
//! - [`player`]: the personal magic-link token (`SeasonPlayer.accessToken`), treated as opaque.
//! - [`google`]: Google ID token verification against Google's JWKS (D24).
//! - [`base64`]: the jose and Node `Buffer` base64 dialects.

pub mod admin;
pub mod base64;
pub mod google;
pub mod player;

/// ECMAScript WhiteSpace or LineTerminator (what `trim()` and `parseInt` skip).
pub fn is_js_whitespace(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202f}'
                | '\u{205f}'
                | '\u{3000}'
                | '\u{feff}'
    )
}

/// `String.prototype.trim()`: strips ECMAScript WhiteSpace and LineTerminator code points.
/// (Rust's `str::trim` differs: it strips U+0085 and keeps U+FEFF.)
pub fn js_trim(value: &str) -> &str {
    value.trim_matches(is_js_whitespace)
}

/// `new URL(request.url).searchParams.get(name)`: the first value, `application/x-www-form-urlencoded`
/// decoding (`+` is a space, invalid UTF-8 becomes U+FFFD).
pub fn query_param(query: Option<&str>, name: &str) -> Option<String> {
    let query = query?;
    query
        .split('&')
        .filter(|pair| !pair.is_empty())
        .map(|pair| pair.split_once('=').unwrap_or((pair, "")))
        .find(|(key, _)| form_decode(key) == name)
        .map(|(_, value)| form_decode(value))
}

fn form_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'+' => {
                out.push(b' ');
                index += 1;
            }
            b'%' => {
                let high = bytes.get(index + 1).copied().and_then(hex);
                let low = bytes.get(index + 2).copied().and_then(hex);
                if let (Some(high), Some(low)) = (high, low) {
                    out.push(high * 16 + low);
                    index += 3;
                } else {
                    out.push(b'%');
                    index += 1;
                }
            }
            byte => {
                out.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trims_like_javascript() {
        assert_eq!(js_trim("\u{feff} abc\u{3000}\n"), "abc");
        assert_eq!(js_trim("\u{85}abc"), "\u{85}abc");
    }

    #[test]
    fn search_params_semantics() {
        let q = Some("token=a%2Bb+c&token=second&secret=%E2%9C%93&empty=&flag&bad=%zz%4");
        assert_eq!(query_param(q, "token").as_deref(), Some("a+b c"));
        assert_eq!(query_param(q, "secret").as_deref(), Some("✓"));
        assert_eq!(query_param(q, "empty").as_deref(), Some(""));
        assert_eq!(query_param(q, "flag").as_deref(), Some(""));
        assert_eq!(query_param(q, "bad").as_deref(), Some("%zz%4"));
        assert_eq!(query_param(q, "missing"), None);
        assert_eq!(query_param(None, "token"), None);
        assert_eq!(
            query_param(Some("t%6Fken=x"), "token").as_deref(),
            Some("x")
        );
        assert_eq!(query_param(Some("x=%FF"), "x").as_deref(), Some("\u{fffd}"));
    }
}
