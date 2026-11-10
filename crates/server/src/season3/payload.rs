//! The JSON text columns of `SeasonWeek` as the TS code reads and writes them:
//! `chaosPayload` (Chaos groups) and `skippedPlayerIdsJson`.
//!
//! The parsers are copied verbatim into three TS files with two behaviours:
//! - **strict** `parseChaosGroups` (`app/api/season3/route.ts`, `app/api/admin/season3/route.ts`):
//!   the parsed value only if it is an array of arrays;
//! - **lenient** `parseChaosGroups` (`lib/season3-race.ts`): any array.
//!
//! Both swallow invalid JSON. What the routes return is the parsed JSON re-serialised by
//! `JSON.stringify` ([`crate::cosmetics::js::stringify`]), so values are kept as
//! [`serde_json::Value`]. Known divergence (accepted in stage A for request bodies): a number
//! outside f64 (`1e400`) fails `serde_json`, so the payload reads as absent, where `JSON.parse`
//! gives `Infinity` (re-serialised as `null`). No writer stores such text.

use std::fmt;

use serde_json::Value;

use crate::cosmetics::js::{is_integer, number_to_string, stringify};

fn parse(payload: Option<&str>) -> Option<Value> {
    // `if (!payload) return …`: null and "" are both absent.
    let text = payload.filter(|text| !text.is_empty())?;
    serde_json::from_str(text).ok()
}

/// Strict `parseChaosGroups(payload)`: an array whose every element is an array, else `None`.
#[must_use]
pub fn parse_chaos_groups_strict(payload: Option<&str>) -> Option<Value> {
    parse(payload).filter(|value| {
        value
            .as_array()
            .is_some_and(|groups| groups.iter().all(Value::is_array))
    })
}

/// Lenient `parseChaosGroups(payload)` (`lib/season3-race.ts`): any array, else `None`.
#[must_use]
pub fn parse_chaos_groups_lenient(payload: Option<&str>) -> Option<Value> {
    parse(payload).filter(Value::is_array)
}

/// `parseSkippedPlayerIds(payload)`: the integer numbers of a JSON array, in order (duplicates
/// kept; `-0`, `1e21` and integers beyond 2^53 included, as `Number.isInteger` does).
#[must_use]
pub fn parse_skipped_player_ids(payload: Option<&str>) -> Vec<f64> {
    match parse(payload) {
        Some(Value::Array(values)) => values
            .iter()
            .filter(|value| is_integer(Some(value)))
            .filter_map(Value::as_f64)
            .collect(),
        _ => Vec::new(),
    }
}

/// `skippedPlayerIds.includes(userId)` (and `Set#has` on the same numbers).
#[must_use]
pub fn skipped_contains(skipped: &[f64], user_id: i64) -> bool {
    // User ids are database integers, exact as doubles.
    #[allow(clippy::cast_precision_loss)]
    let user_id = user_id as f64;
    skipped.contains(&user_id)
}

/// `JSON.stringify(numbers)` for skipped ids (`-0` prints as `0`).
#[must_use]
pub fn skipped_ids_json(ids: &[f64]) -> String {
    let parts: Vec<String> = ids.iter().map(|&id| number_to_string(id)).collect();
    format!("[{}]", parts.join(","))
}

/// `chaosPayload(groups)` for server-drawn groups: `JSON.stringify(groups)` or `null`.
#[must_use]
pub fn chaos_payload(groups: Option<&[Vec<i64>]>) -> Option<String> {
    groups.map(|groups| {
        let parts: Vec<String> = groups
            .iter()
            .map(|group| {
                let ids: Vec<String> = group.iter().map(ToString::to_string).collect();
                format!("[{}]", ids.join(","))
            })
            .collect();
        format!("[{}]", parts.join(","))
    })
}

/// `chaosPayload(body.groups)` for admin-supplied groups (any JSON array, stored as given).
#[must_use]
pub fn chaos_payload_value(groups: Option<&Value>) -> Option<String> {
    groups.map(stringify)
}

/// `String(value)` for a value that came out of `JSON.parse`.
#[must_use]
pub fn js_string(value: &Value) -> String {
    match value {
        Value::Null => "null".to_owned(),
        Value::Bool(flag) => flag.to_string(),
        Value::Number(number) => number_to_string(number.as_f64().unwrap_or(f64::NAN)),
        Value::String(text) => text.clone(),
        // `Array.prototype.join(',')`: null elements become "".
        Value::Array(items) => items
            .iter()
            .map(|item| {
                if item.is_null() {
                    String::new()
                } else {
                    js_string(item)
                }
            })
            .collect::<Vec<_>>()
            .join(","),
        Value::Object(_) => "[object Object]".to_owned(),
    }
}

/// `executeSeason3Race` reading `chaosPayload` for the resolution: lenient parse, then
/// `groups.map((group) => group.map(String))`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GroupsError {
    /// An element of the payload array is not an array. TS throws a V8 `TypeError` with this
    /// message from `group.map`.
    GroupNotArray,
}

impl fmt::Display for GroupsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::GroupNotArray => f.write_str("group.map is not a function"),
        }
    }
}

impl std::error::Error for GroupsError {}

/// The groups `resolveSeason3Race` hands the Chaos rule, from a stored `chaosPayload`.
///
/// # Errors
/// [`GroupsError::GroupNotArray`] when the payload is an array with a non-array element (an
/// admin can store one through `set-chaos`/`open-week` `groups`).
pub fn chaos_groups_for_resolution(
    payload: Option<&str>,
) -> Result<Option<Vec<Vec<String>>>, GroupsError> {
    let Some(Value::Array(groups)) = parse_chaos_groups_lenient(payload) else {
        return Ok(None);
    };
    groups
        .iter()
        .map(|group| match group {
            Value::Array(members) => Ok(members.iter().map(js_string).collect()),
            _ => Err(GroupsError::GroupNotArray),
        })
        .collect::<Result<Vec<_>, _>>()
        .map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn js_string_matches_string_of_parsed_json() {
        let value: Value = serde_json::from_str(
            r#"[1, 1.5, 1e21, -0, "x", null, true, [1, null, [2, 3]], {"a": 1}]"#,
        )
        .unwrap();
        let strings: Vec<String> = value.as_array().unwrap().iter().map(js_string).collect();
        assert_eq!(
            strings,
            [
                "1",
                "1.5",
                "1e+21",
                "0",
                "x",
                "null",
                "true",
                "1,,2,3",
                "[object Object]"
            ]
        );
    }

    #[test]
    fn resolution_groups_follow_the_lenient_parser() {
        assert_eq!(chaos_groups_for_resolution(None), Ok(None));
        assert_eq!(chaos_groups_for_resolution(Some("")), Ok(None));
        assert_eq!(chaos_groups_for_resolution(Some("nope")), Ok(None));
        assert_eq!(chaos_groups_for_resolution(Some(r#"{"a":1}"#)), Ok(None));
        assert_eq!(
            chaos_groups_for_resolution(Some(r#"[[1,2.0],["3"]]"#)),
            Ok(Some(vec![vec!["1".into(), "2".into()], vec!["3".into()]]))
        );
        assert_eq!(
            chaos_groups_for_resolution(Some("[[1],2]")),
            Err(GroupsError::GroupNotArray)
        );
    }

    #[test]
    fn skipped_ids_keep_integers_only() {
        let ids = parse_skipped_player_ids(Some(r#"[3, 1.5, "2", -0, 1e21, null, 7]"#));
        assert_eq!(skipped_ids_json(&ids), "[3,0,1e+21,7]");
        assert!(skipped_contains(&ids, 7));
        assert!(skipped_contains(&ids, 0));
        assert!(!skipped_contains(&ids, 2));
        assert!(parse_skipped_player_ids(Some("{}")).is_empty());
        assert_eq!(
            chaos_payload(Some(&[vec![3, 1], vec![2]])).as_deref(),
            Some("[[3,1],[2]]")
        );
        assert_eq!(chaos_payload(None), None);
    }
}
