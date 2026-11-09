//! JavaScript semantics the economy routes depend on, so request handling matches the TS
//! handlers byte for byte:
//!
//! - [`parse_body`] is `await request.json()` (UTF-8 with a leading BOM stripped).
//! - [`truthy`] is JS truthiness of a parsed JSON value.
//! - [`number_to_string`] and [`stringify`] are `Number#toString` and `JSON.stringify` of a value that
//!   came out of `JSON.parse` (numbers are doubles; array-index keys come first, ascending).
//! - [`number_from_string`] is `Number(string)`.
//! - [`prisma_int`] is how Prisma 7 coerces a JS number given to an `Int` argument.
//! - [`encode_uri_component`].

use serde_json::Value;

use crate::auth::js_trim;

/// `await request.json()`. `None` when the body isn't JSON (TS throws → 500).
pub fn parse_body(bytes: &[u8]) -> Option<Value> {
    let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
    serde_json::from_slice(bytes).ok()
}

/// JS truthiness: `undefined`, `null`, `false`, `0`, `-0` and `""` are falsy (JSON has no NaN).
pub fn truthy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => false,
        Some(Value::Bool(flag)) => *flag,
        Some(Value::Number(number)) => number.as_f64().is_some_and(|n| n != 0.0),
        Some(Value::String(text)) => !text.is_empty(),
        Some(Value::Array(_) | Value::Object(_)) => true,
    }
}

/// `body.key` where `body` is the parsed request body. Property access on an array, string,
/// number or boolean body yields `undefined`; on `null` it throws (the caller answers 500).
pub fn property<'a>(body: &'a Value, key: &str) -> Option<&'a Value> {
    match body {
        Value::Object(map) => map.get(key),
        _ => None,
    }
}

/// The value as a JS number (`typeof value === 'number'`).
pub fn as_number(value: Option<&Value>) -> Option<f64> {
    match value {
        Some(Value::Number(number)) => number.as_f64(),
        _ => None,
    }
}

/// `Number.isInteger(value)`.
pub fn is_integer(value: Option<&Value>) -> bool {
    as_number(value).is_some_and(|n| n.is_finite() && trunc(n) == n)
}

/// `Math.trunc` (exact; written out because the workspace bans std float methods, D4(a)).
pub fn trunc(value: f64) -> f64 {
    // Every double with magnitude >= 2^52 is already an integer.
    if !value.is_finite() || value.abs() >= 4_503_599_627_370_496.0 {
        return value;
    }
    let truncated = value as i64 as f64;
    if truncated == 0.0 && value.is_sign_negative() {
        -0.0
    } else {
        truncated
    }
}

/// `Number.prototype.toString()` for a double (`-0` → `"0"`, `1e21` → `"1e+21"`).
pub fn number_to_string(value: f64) -> String {
    if value == 0.0 {
        return "0".to_owned();
    }
    ryu_js::Buffer::new().format(value).to_owned()
}

/// `JSON.stringify(value)` for a value produced by `JSON.parse`.
pub fn stringify(value: &Value) -> String {
    let mut out = String::new();
    write_json(value, &mut out);
    out
}

/// A canonical array index (`"0"`, `"17"`, up to 2^32 − 2): V8 orders these keys first.
fn array_index(key: &str) -> Option<u32> {
    if key.is_empty() || (key.len() > 1 && key.starts_with('0')) {
        return None;
    }
    if !key.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    key.parse::<u32>().ok().filter(|index| *index != u32::MAX)
}

fn write_json(value: &Value, out: &mut String) {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(flag) => out.push_str(if *flag { "true" } else { "false" }),
        Value::Number(number) => match number.as_f64() {
            Some(n) if n.is_finite() => out.push_str(&number_to_string(n)),
            _ => out.push_str("null"),
        },
        Value::String(text) => {
            out.push_str(&serde_json::to_string(text).unwrap_or_else(|_| "\"\"".to_owned()));
        }
        Value::Array(items) => {
            out.push('[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                write_json(item, out);
            }
            out.push(']');
        }
        Value::Object(map) => {
            let mut indexed: Vec<(u32, &String, &Value)> = map
                .iter()
                .filter_map(|(key, value)| array_index(key).map(|index| (index, key, value)))
                .collect();
            indexed.sort_by_key(|(index, _, _)| *index);
            let named = map.iter().filter(|(key, _)| array_index(key).is_none());
            out.push('{');
            let entries = indexed
                .into_iter()
                .map(|(_, key, value)| (key, value))
                .chain(named);
            for (position, (key, value)) in entries.enumerate() {
                if position > 0 {
                    out.push(',');
                }
                out.push_str(&serde_json::to_string(key).unwrap_or_else(|_| "\"\"".to_owned()));
                out.push(':');
                write_json(value, out);
            }
            out.push('}');
        }
    }
}

/// `Number(text)` (ECMAScript StringToNumber).
pub fn number_from_string(text: &str) -> f64 {
    let text = js_trim(text);
    if text.is_empty() {
        return 0.0;
    }
    for (prefix, radix) in [
        ("0x", 16),
        ("0X", 16),
        ("0o", 8),
        ("0O", 8),
        ("0b", 2),
        ("0B", 2),
    ] {
        if let Some(digits) = text.strip_prefix(prefix) {
            return radix_digits(digits, radix);
        }
    }
    let (sign, unsigned) = match text.as_bytes()[0] {
        b'+' => (1.0, &text[1..]),
        b'-' => (-1.0, &text[1..]),
        _ => (1.0, text),
    };
    if unsigned == "Infinity" {
        return sign * f64::INFINITY;
    }
    if !is_decimal_literal(unsigned) {
        return f64::NAN;
    }
    unsigned
        .parse::<f64>()
        .map_or(f64::NAN, |value| sign * value)
}

fn radix_digits(digits: &str, radix: u32) -> f64 {
    if digits.is_empty() {
        return f64::NAN;
    }
    let mut value = 0.0f64;
    for c in digits.chars() {
        match c.to_digit(radix) {
            Some(digit) => value = value * f64::from(radix) + f64::from(digit),
            None => return f64::NAN,
        }
    }
    value
}

/// StrUnsignedDecimalLiteral without `Infinity`: `1`, `1.`, `.5`, `1.5e-3`, `1E+2`.
fn is_decimal_literal(text: &str) -> bool {
    let bytes = text.as_bytes();
    let mut index = 0;
    let int_start = index;
    while index < bytes.len() && bytes[index].is_ascii_digit() {
        index += 1;
    }
    let mut digits = index - int_start;
    if index < bytes.len() && bytes[index] == b'.' {
        index += 1;
        let frac_start = index;
        while index < bytes.len() && bytes[index].is_ascii_digit() {
            index += 1;
        }
        digits += index - frac_start;
    }
    if digits == 0 {
        return false;
    }
    if index < bytes.len() && (bytes[index] == b'e' || bytes[index] == b'E') {
        index += 1;
        if index < bytes.len() && (bytes[index] == b'+' || bytes[index] == b'-') {
            index += 1;
        }
        let exp_start = index;
        while index < bytes.len() && bytes[index].is_ascii_digit() {
            index += 1;
        }
        if index == exp_start {
            return false;
        }
    }
    index == bytes.len()
}

/// A JS number passed to a Prisma `Int` argument: Prisma 7 truncates the fraction and rejects
/// (validation error → 500) anything outside the signed 64-bit range. Verified against the TS
/// app: `1.7` → `1`, `-1.5` → `-1`, `1e19` → error.
pub fn prisma_int(value: f64) -> Option<i64> {
    const LIMIT: f64 = 9_223_372_036_854_775_808.0; // 2^63
    let truncated = trunc(value);
    (truncated.is_finite() && (-LIMIT..LIMIT).contains(&truncated)).then_some(truncated as i64)
}

/// `encodeURIComponent(text)`.
pub fn encode_uri_component(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric()
            || matches!(
                byte,
                b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')'
            )
        {
            out.push(char::from(byte));
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn truthiness() {
        assert!(!truthy(None));
        for falsy in [json!(null), json!(false), json!(0), json!(-0.0), json!("")] {
            assert!(!truthy(Some(&falsy)), "{falsy}");
        }
        for value in [json!(true), json!(1), json!("0"), json!([]), json!({})] {
            assert!(truthy(Some(&value)), "{value}");
        }
    }

    #[test]
    fn numbers_print_like_javascript() {
        assert_eq!(number_to_string(0.0), "0");
        assert_eq!(number_to_string(-0.0), "0");
        assert_eq!(number_to_string(1.0), "1");
        assert_eq!(number_to_string(3e9), "3000000000");
        assert_eq!(number_to_string(1e21), "1e+21");
        assert_eq!(number_to_string(1.0 / 3.0), "0.3333333333333333");
        assert_eq!(number_to_string(0.1 + 0.2), "0.30000000000000004");
        assert_eq!(number_to_string(1e-7), "1e-7");
        assert_eq!(number_to_string(-2.5), "-2.5");
    }

    #[test]
    fn stringify_matches_json_stringify_of_json_parse() {
        let body: Value = serde_json::from_str(
            r#"{"b":1.0,"2":"x","a":[1e2,-0,null,true],"10":{"z":1,"1":2},"01":3,"b":2,"s":"é\n\u0001"}"#,
        )
        .unwrap();
        assert_eq!(
            stringify(&body),
            r#"{"2":"x","10":{"1":2,"z":1},"b":2,"a":[100,0,null,true],"01":3,"s":"é\n\u0001"}"#
        );
        assert_eq!(stringify(&json!(4294967295u64)), "4294967295");
        let big: Value = serde_json::from_str(r#"{"4294967295":1,"4294967294":2}"#).unwrap();
        assert_eq!(stringify(&big), r#"{"4294967294":2,"4294967295":1}"#);
    }

    #[test]
    fn number_from_string_semantics() {
        let cases: &[(&str, f64)] = &[
            ("1", 1.0),
            (" 1 ", 1.0),
            ("\u{a0}1", 1.0),
            ("0x1F", 31.0),
            ("0b11", 3.0),
            ("0o17", 15.0),
            ("1e0", 1.0),
            ("1.0", 1.0),
            ("1.", 1.0),
            (".1e1", 1.0),
            ("+1", 1.0),
            ("-1", -1.0),
            ("", 0.0),
            ("   ", 0.0),
            ("9007199254740993", 9_007_199_254_740_992.0),
            ("Infinity", f64::INFINITY),
            ("-Infinity", f64::NEG_INFINITY),
        ];
        for (text, expected) in cases {
            assert_eq!(number_from_string(text), *expected, "{text:?}");
        }
        assert!(number_from_string("-0").is_sign_negative());
        for text in [
            "abc", "1_0", "0x", "-0x1", "1e", ".", "inf", "NaN", "1 2", "infinity", "+-1",
        ] {
            assert!(number_from_string(text).is_nan(), "{text:?}");
        }
    }

    #[test]
    fn trunc_matches_math_trunc() {
        assert_eq!(trunc(1.7), 1.0);
        assert_eq!(trunc(-1.7), -1.0);
        assert!(trunc(-0.5).is_sign_negative());
        assert_eq!(trunc(1e300), 1e300);
        assert_eq!(trunc(4_503_599_627_370_495.5), 4_503_599_627_370_495.0);
        assert!(trunc(f64::NAN).is_nan());
    }

    #[test]
    fn prisma_int_truncates_and_bounds() {
        assert_eq!(prisma_int(1.7), Some(1));
        assert_eq!(prisma_int(2.5), Some(2));
        assert_eq!(prisma_int(-1.5), Some(-1));
        assert_eq!(prisma_int(3e10), Some(30_000_000_000));
        assert_eq!(prisma_int(1e19), None);
        assert_eq!(prisma_int(f64::INFINITY), None);
    }

    #[test]
    fn encode_uri_component_matches_js() {
        assert_eq!(
            encode_uri_component("a b+c/é?&=-_.!~*'()"),
            "a%20b%2Bc%2F%C3%A9%3F%26%3D-_.!~*'()"
        );
    }
}
