//! `GET /api/races/{id}` (read side) and `GET /api/races/{id}/track`.
//!
//! - [`detail`]: port of `app/api/races/[id]/route.ts` on `main`, byte for byte: the legacy
//!   constant keys, `lib/racing/public-engine.ts` visibility, players joined by `userId`. `main`
//!   has no `replay` block yet (plan step 0.5), so neither does this route.
//! - [`track`]: plan §4.6 (`main` has no track route): the stored DTRK/1 gzip bytes with an
//!   ETag, immutable only when `?h=` names the current `byteSha256`.
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

/// What `parseInt(id)` (no radix) followed by `prisma.race.findUnique({ where: { id } })` does
/// with a path segment.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RaceIdParam {
    /// `isNaN(parseInt(id))`: TS answers 400 `Invalid race ID`.
    Invalid,
    /// A number Prisma refuses ("Unable to fit value … into a 64-bit signed integer"): TS throws
    /// inside its try block and answers 500.
    OutOfRange,
    Id(i64),
}

/// `parseInt(segment)` (ECMAScript `parseInt` with radix undefined) plus Prisma's `Int` filter
/// check.
///
/// Leading JS whitespace is skipped, one sign is allowed, `0x`/`0X` switches to base 16, and
/// parsing stops at the first invalid digit (`"12abc"` → 12, `"1e3"` → 1). The integer is
/// rounded to a double like V8 does, then Prisma accepts it only inside `(-2^63, 2^63)`.
pub fn parse_race_id(segment: &str) -> RaceIdParam {
    const TWO_POW_63: f64 = 9_223_372_036_854_775_808.0;
    let trimmed = segment.trim_start_matches(is_js_whitespace);
    let (negative, rest) = match trimmed.as_bytes().first() {
        Some(b'-') => (true, &trimmed[1..]),
        Some(b'+') => (false, &trimmed[1..]),
        _ => (false, trimmed),
    };
    let (radix, digits) = match rest.get(..2) {
        Some("0x" | "0X") => (16, &rest[2..]),
        _ => (10, rest),
    };
    let digits: Vec<u32> = digits.chars().map_while(|c| c.to_digit(radix)).collect();
    if digits.is_empty() {
        return RaceIdParam::Invalid;
    }
    // Exact value while it fits; anything wider than u128 is far outside Prisma's range.
    let mut exact: Option<u128> = Some(0);
    for digit in digits {
        exact = exact
            .and_then(|value| value.checked_mul(u128::from(radix)))
            .and_then(|value| value.checked_add(u128::from(digit)));
    }
    let Some(exact) = exact else {
        return RaceIdParam::OutOfRange;
    };
    // `as f64` rounds to nearest, ties to even: the double `parseInt` returns. Prisma's check is
    // symmetric (`-2^63` is refused too: checked against the TS route).
    #[allow(clippy::cast_precision_loss)]
    let magnitude = exact as f64;
    if magnitude >= TWO_POW_63 {
        return RaceIdParam::OutOfRange;
    }
    #[allow(clippy::cast_possible_truncation)]
    let magnitude = magnitude as i64;
    let value = if negative { -magnitude } else { magnitude };
    RaceIdParam::Id(value)
}

/// ECMAScript `StrWhiteSpaceChar`: WhiteSpace and LineTerminator.
fn is_js_whitespace(c: char) -> bool {
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
    fn parse_int_semantics() {
        use RaceIdParam::*;
        // Expected values checked against `parseInt` + Prisma through the TS route on main.
        let long = "9".repeat(400);
        let cases: &[(&str, RaceIdParam)] = &[
            ("40", Id(40)),
            ("040", Id(40)),
            (" \t\u{feff}\u{3000}40x", Id(40)),
            ("12abc", Id(12)),
            ("1e3", Id(1)),
            ("1.9", Id(1)),
            ("+7", Id(7)),
            ("-5", Id(-5)),
            ("-0", Id(0)),
            ("0x1A", Id(26)),
            ("-0X1f", Id(-31)),
            ("0x", Invalid),
            ("0xg", Invalid),
            ("abc", Invalid),
            ("", Invalid),
            ("-", Invalid),
            ("+-1", Invalid),
            ("Infinity", Invalid),
            ("\u{85}1", Invalid),
            ("١٢", Invalid),
            ("2147483648", Id(2_147_483_648)),
            ("9007199254740993", Id(9_007_199_254_740_992)),
            ("9223372036854775295", Id(9_223_372_036_854_774_784)),
            ("9223372036854775296", OutOfRange),
            ("9223372036854775807", OutOfRange),
            ("-9223372036854775295", Id(-9_223_372_036_854_774_784)),
            ("-9223372036854775296", OutOfRange),
            ("-9223372036854775808", OutOfRange),
            ("-9223372036854775809", OutOfRange),
            ("-9223372036854776833", OutOfRange),
            ("0x7fffffffffffffff", OutOfRange),
            ("99999999999999999999", OutOfRange),
            (&long, OutOfRange),
        ];
        for (input, expected) in cases {
            assert_eq!(parse_race_id(input), *expected, "parseInt({input:?})");
        }
    }
}
