//! JavaScript value semantics the admin route depends on, on top of [`crate::cosmetics::js`]:
//! numbers on the wire printed by `Number#toString` ([`JsNum`]), `ToNumber` for `Math.max`, and
//! how Prisma 7 coerces a JS value given to an `Int` argument.

use serde::{Serialize, Serializer};
use serde_json::Value;
use serde_json::value::RawValue;

use crate::cosmetics::js::{number_from_string, number_to_string, prisma_int};
use crate::season3::payload::js_string;

/// `Number.MAX_SAFE_INTEGER`: better-sqlite3 binds a larger JS number as REAL, which Prisma then
/// can't read back as `Int`, so values past it are refused (500) rather than written.
pub const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

/// A JS number serialised like `JSON.stringify` (`1`, not `1.0`; non-finite → `null`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct JsNum(pub f64);

impl Serialize for JsNum {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let text = if self.0.is_finite() {
            number_to_string(self.0)
        } else {
            "null".to_owned()
        };
        RawValue::from_string(text)
            .map_err(serde::ser::Error::custom)?
            .serialize(serializer)
    }
}

/// `ToNumber(value)` for a parsed JSON value (`Math.max(1, value)` coerces this way).
#[must_use]
pub fn to_number(value: &Value) -> f64 {
    match value {
        Value::Null => 0.0,
        Value::Bool(flag) => f64::from(u8::from(*flag)),
        Value::Number(number) => number.as_f64().unwrap_or(f64::NAN),
        Value::String(text) => number_from_string(text),
        // ToPrimitive on an array is `join(',')`.
        Value::Array(_) => number_from_string(&js_string(value)),
        Value::Object(_) => f64::NAN,
    }
}

/// `Math.max(1, x)`.
#[must_use]
pub fn max_one(value: f64) -> f64 {
    if value.is_nan() {
        f64::NAN
    } else if value > 1.0 {
        value
    } else {
        1.0
    }
}

/// A JS number handed to a Prisma `Int` argument: truncated, refused when non-finite or outside
/// the safe-integer range (Prisma throws a validation error, or the value can't be read back).
#[must_use]
pub fn int_from_number(value: f64) -> Option<i64> {
    if !value.is_finite() || value.abs() > MAX_SAFE_INTEGER {
        return None;
    }
    prisma_int(value)
}

/// A JSON value handed to a Prisma `Int` argument: only numbers pass (a string, boolean, array
/// or object is a `PrismaClientValidationError`).
#[must_use]
pub fn int_arg(value: Option<&Value>) -> Option<i64> {
    match value {
        Some(Value::Number(number)) => number.as_f64().and_then(int_from_number),
        _ => None,
    }
}

/// `typeof value === 'number' ? value : …` as a double.
#[must_use]
pub fn number(value: Option<&Value>) -> Option<f64> {
    match value {
        Some(Value::Number(number)) => number.as_f64(),
        _ => None,
    }
}

/// `value === id` for a database integer id.
#[must_use]
pub fn equals_id(value: Option<&Value>, id: i64) -> bool {
    // Ids are database integers, exact as doubles.
    #[allow(clippy::cast_precision_loss)]
    let id = id as f64;
    number(value) == Some(id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn to_number_follows_ecmascript() {
        assert_eq!(to_number(&json!(null)), 0.0);
        assert_eq!(to_number(&json!(true)), 1.0);
        assert_eq!(to_number(&json!(" 12 ")), 12.0);
        assert_eq!(to_number(&json!([7])), 7.0);
        assert_eq!(to_number(&json!([])), 0.0);
        assert!(to_number(&json!([1, 2])).is_nan());
        assert!(to_number(&json!({})).is_nan());
        assert!(to_number(&json!("abc")).is_nan());
        assert!(max_one(f64::NAN).is_nan());
        assert_eq!(max_one(-3.0), 1.0);
        assert_eq!(max_one(13.5), 13.5);
    }

    #[test]
    fn numbers_print_like_javascript() {
        let text = serde_json::to_string(&[
            JsNum(2.0),
            JsNum(0.5),
            JsNum(-0.0),
            JsNum(1e21),
            JsNum(f64::NAN),
        ])
        .unwrap();
        assert_eq!(text, "[2,0.5,0,1e+21,null]");
    }

    #[test]
    fn int_arguments() {
        assert_eq!(int_arg(Some(&json!(1.9))), Some(1));
        assert_eq!(int_arg(Some(&json!(-1.5))), Some(-1));
        assert_eq!(int_arg(Some(&json!("1"))), None);
        assert_eq!(int_arg(Some(&json!(true))), None);
        assert_eq!(int_arg(Some(&json!(1e19))), None);
        assert_eq!(int_arg(None), None);
        assert!(equals_id(Some(&json!(3.0)), 3));
        assert!(!equals_id(Some(&json!("3")), 3));
    }
}
