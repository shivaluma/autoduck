//! `JSON.stringify` output for a [`serde_json::Value`] built from DB rows or from `JSON.parse`d
//! columns (`Race.engineConfigJson`, `RaceEngineEvent.metadataJson`).
//!
//! TS hands those columns to `NextResponse.json` after `JSON.parse`, so the bytes on the wire are
//! whatever V8 re-serialises, not the stored text. Two things differ from `serde_json`:
//!
//! - **Numbers** are JS doubles printed by `Number#toString` (`1`, not `1.0`; `1e+21`; `-0` → `0`;
//!   integers beyond 2^53 rounded). Non-finite numbers print as `null`.
//! - **Key order** follows JS own-property order: array-index keys (`"0"`, `"17"`, below
//!   2^32 − 1) first in ascending numeric order, then the other keys in insertion order. A
//!   duplicate key keeps its first position with the last value, which `serde_json` with
//!   `preserve_order` already does on parse.
//!
//! Strings escape like `JSON.stringify` (and JCS): `"`, `\`, `\b \f \n \r \t`, other controls as
//! `\u00xx`, everything else raw. Rust strings can't hold lone surrogates, so the one remaining
//! difference (V8 escapes them) can't arise: `serde_json` refuses such input on parse, and the
//! caller answers 500.

use serde_json::{Map, Value};

/// `JSON.parse(text)`, number values kept as `serde_json` parses them (converted on write).
pub fn parse(text: &str) -> Result<Value, serde_json::Error> {
    serde_json::from_str(text)
}

/// `JSON.stringify(value)`.
pub fn stringify(value: &Value) -> String {
    let mut out = String::new();
    write_value(&mut out, value);
    out
}

fn write_value(out: &mut String, value: &Value) {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(true) => out.push_str("true"),
        Value::Bool(false) => out.push_str("false"),
        Value::Number(number) => write_number(out, number.as_f64().unwrap_or(f64::NAN)),
        Value::String(string) => write_string(out, string),
        Value::Array(items) => {
            out.push('[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                write_value(out, item);
            }
            out.push(']');
        }
        Value::Object(map) => write_object(out, map),
    }
}

fn write_object(out: &mut String, map: &Map<String, Value>) {
    let mut index_keys: Vec<(u32, &String, &Value)> = Vec::new();
    let mut other_keys: Vec<(&String, &Value)> = Vec::new();
    for (key, value) in map {
        match array_index(key) {
            Some(index) => index_keys.push((index, key, value)),
            None => other_keys.push((key, value)),
        }
    }
    index_keys.sort_by_key(|(index, _, _)| *index);
    out.push('{');
    let entries = index_keys
        .iter()
        .map(|(_, key, value)| (*key, *value))
        .chain(other_keys);
    for (position, (key, value)) in entries.enumerate() {
        if position > 0 {
            out.push(',');
        }
        write_string(out, key);
        out.push(':');
        write_value(out, value);
    }
    out.push('}');
}

/// ECMAScript array index: the canonical decimal form of an integer in `0..2^32 - 1`.
fn array_index(key: &str) -> Option<u32> {
    let bytes = key.as_bytes();
    if bytes.is_empty() || bytes.len() > 10 || !bytes.iter().all(u8::is_ascii_digit) {
        return None;
    }
    if bytes.len() > 1 && bytes[0] == b'0' {
        return None;
    }
    let value: u64 = key.parse().ok()?;
    if value < u64::from(u32::MAX) {
        u32::try_from(value).ok()
    } else {
        None
    }
}

/// `Number#toString` as used by `JSON.stringify`; NaN and ±Infinity become `null`.
pub fn write_number(out: &mut String, value: f64) {
    if value.is_finite() {
        let mut buffer = ryu_js::Buffer::new();
        out.push_str(buffer.format_finite(value));
    } else {
        out.push_str("null");
    }
}

const HEX_LOWER: &[u8; 16] = b"0123456789abcdef";

fn write_string(out: &mut String, value: &str) {
    out.push('"');
    let mut start = 0;
    for (index, byte) in value.bytes().enumerate() {
        let short = match byte {
            b'"' => "\\\"",
            b'\\' => "\\\\",
            0x08 => "\\b",
            0x0c => "\\f",
            b'\n' => "\\n",
            b'\r' => "\\r",
            b'\t' => "\\t",
            0x00..=0x1f => "",
            _ => continue,
        };
        // Only ASCII bytes get here, so `start..index` lies on char boundaries.
        out.push_str(&value[start..index]);
        if short.is_empty() {
            out.push_str("\\u00");
            out.push(char::from(HEX_LOWER[usize::from(byte >> 4)]));
            out.push(char::from(HEX_LOWER[usize::from(byte & 0x0f)]));
        } else {
            out.push_str(short);
        }
        start = index + 1;
    }
    out.push_str(&value[start..]);
    out.push('"');
}

#[cfg(test)]
mod tests {
    use super::*;

    fn round_trip(text: &str) -> String {
        stringify(&parse(text).unwrap())
    }

    #[test]
    fn numbers_print_like_javascript() {
        // Expected values are `JSON.stringify(JSON.parse(text))` in Node 24.
        assert_eq!(
            round_trip("[1.0,-0,1e21,1e-7,5e-7,0.1,1.5e300,123456789012345678901,-2.50]"),
            "[1,0,1e+21,1e-7,5e-7,0.1,1.5e+300,123456789012345680000,-2.5]"
        );
        assert_eq!(round_trip("9007199254740993"), "9007199254740992");
        assert_eq!(round_trip("18446744073709551615"), "18446744073709552000");
        assert_eq!(round_trip("-9223372036854775808"), "-9223372036854776000");
        assert_eq!(round_trip("100"), "100");
        assert_eq!(round_trip("0.000001"), "0.000001");
        assert_eq!(round_trip("1e20"), "100000000000000000000");
        let mut out = String::new();
        write_number(&mut out, f64::NAN);
        write_number(&mut out, f64::INFINITY);
        assert_eq!(out, "nullnull");
    }

    #[test]
    fn keys_follow_js_property_order() {
        assert_eq!(
            round_trip(
                r#"{"b":1,"2":2,"a":3,"10":4,"01":5,"1":6,"4294967295":7,"4294967294":8,"-1":9}"#
            ),
            r#"{"1":6,"2":2,"10":4,"4294967294":8,"b":1,"a":3,"01":5,"4294967295":7,"-1":9}"#
        );
        // Duplicate keys: first position, last value.
        assert_eq!(round_trip(r#"{"a":1,"b":2,"a":3}"#), r#"{"a":3,"b":2}"#);
        assert_eq!(
            round_trip(r#"{"x":{"z":[{"0":true,"y":null}],"0":"s"}}"#),
            r#"{"x":{"0":"s","z":[{"0":true,"y":null}]}}"#
        );
    }

    #[test]
    fn strings_escape_like_json_stringify() {
        assert_eq!(
            round_trip(r#""q\"b\\s\/\b\f\n\r\t\u0001\u001f\u007f é😀""#),
            "\"q\\\"b\\\\s/\\b\\f\\n\\r\\t\\u0001\\u001f\u{7f}\u{2028}é😀\""
        );
    }

    #[test]
    fn whitespace_and_nesting() {
        assert_eq!(
            round_trip(" { \"a\" : [ 1 , { } , [ ] , \"\" ] } \n"),
            r#"{"a":[1,{},[],""]}"#
        );
        assert!(parse("").is_err());
        assert!(parse("[1,]").is_err());
        assert!(parse(r#""\ud800""#).is_err());
    }
}
