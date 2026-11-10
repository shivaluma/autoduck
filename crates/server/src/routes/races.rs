//! `GET /api/races/{id}` (read side) and `GET /api/races/{id}/track`.
//!
//! - [`detail`]: port of `app/api/races/[id]/route.ts` on `main`, byte for byte: the legacy
//!   constant keys, `lib/racing/public-engine.ts` visibility, players joined by `userId`, the
//!   `replay` block and `postRaceStats` (step 0.5).
//! - [`track`]: port of `app/api/races/[id]/track/route.ts` (plan §4.6): the stored DTRK/1 gzip
//!   bytes with an ETag, immutable only when `?h=` names the current `byteSha256`.
//! - Both take the id through [`parse_race_id`] (`parseRaceIdParam`, canonical ids only).
//! - [`js_json`]: `JSON.stringify` output, since TS re-serialises the stored JSON columns.

pub mod detail;
pub mod js_json;
pub mod track;

use axum::Router;
use axum::routing::get;

use crate::http::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/races/{id}", get(detail::get))
        .route("/races/{id}/track", get(track::get))
}

/// The `[id]` segment of both routes: `parseRaceIdParam` (`lib/racing/race-id.ts` on `main`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RaceIdParam {
    /// Not the canonical decimal form `/^[1-9][0-9]*$/` (`"41abc"`, `"041"`, `"+41"`, `"4.1"`,
    /// `" 41"`, `"1e3"`, `"0"`): 400 `Invalid race ID`.
    Invalid,
    /// Canonical but above Prisma's `Int` range (2^31 − 1), so it can't name a row: 404.
    NotFound,
    Id(i64),
}

/// `parseRaceIdParam(raw)`: only `/^[1-9][0-9]*$/` is an id; one above 2^31 − 1 (or longer than
/// 10 digits) is [`RaceIdParam::NotFound`].
pub fn parse_race_id(segment: &str) -> RaceIdParam {
    const MAX_RACE_ID: i64 = 2_147_483_647;
    let bytes = segment.as_bytes();
    let canonical =
        matches!(bytes.first(), Some(b'1'..=b'9')) && bytes.iter().all(u8::is_ascii_digit);
    if !canonical {
        return RaceIdParam::Invalid;
    }
    if bytes.len() > 10 {
        return RaceIdParam::NotFound;
    }
    match segment.parse::<i64>() {
        Ok(id) if id <= MAX_RACE_ID => RaceIdParam::Id(id),
        _ => RaceIdParam::NotFound,
    }
}

/// ECMAScript `StrWhiteSpaceChar`: WhiteSpace and LineTerminator.
pub(crate) fn is_js_whitespace(c: char) -> bool {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_ids_only() {
        use RaceIdParam::*;
        // `parseRaceIdParam` on main (`lib/racing/race-id.ts`, tests/race-viewer-followups.test.ts).
        let long = "9".repeat(400);
        let cases: &[(&str, RaceIdParam)] = &[
            ("40", Id(40)),
            ("1", Id(1)),
            ("2147483647", Id(2_147_483_647)),
            ("2147483648", NotFound),
            ("9999999999", NotFound),
            ("10000000000", NotFound),
            ("9223372036854775808", NotFound),
            (&long, NotFound),
            ("0", Invalid),
            ("040", Invalid),
            ("41abc", Invalid),
            ("+41", Invalid),
            ("-5", Invalid),
            ("4.1", Invalid),
            (" 41", Invalid),
            ("41 ", Invalid),
            ("1e3", Invalid),
            ("0x1A", Invalid),
            ("", Invalid),
            ("Infinity", Invalid),
            ("\u{0661}\u{0662}", Invalid),
        ];
        for (input, expected) in cases {
            assert_eq!(parse_race_id(input), *expected, "{input:?}");
        }
    }
}
