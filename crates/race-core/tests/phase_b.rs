//! Phase B fixes F1-F13 (`docs/balance/S3.16.md`): the S3.16 behaviour of the
//! default build, and the S3.15 behaviour `ts-compat` keeps.

#![allow(clippy::float_cmp)]

use core::cmp::Ordering;

use race_core::sim::id_cmp;

// ---------------------------------------------------------------------------
// F1: byte-order ids
// ---------------------------------------------------------------------------

#[test]
fn f1_ids_order_by_bytes_in_s3_16_and_by_icu_in_ts_compat() {
    // Byte order: ':' (0x3a) > '1' (0x31), 'B' (0x42) < 'a' (0x61),
    // '_' (0x5f) > 'Z' (0x5a). ICU: punctuation before digits, case is a
    // tertiary difference (lowercase first), `_` first of all.
    let cases = [("a:1", "a1"), ("B", "a"), ("_x", "Zx"), ("10", "9")];
    let byte = [
        Ordering::Greater,
        Ordering::Less,
        Ordering::Greater,
        Ordering::Less,
    ];
    let icu = [
        Ordering::Less,
        Ordering::Greater,
        Ordering::Less,
        Ordering::Less,
    ];
    let expected = if race_core::TS_COMPAT { icu } else { byte };
    for ((left, right), want) in cases.into_iter().zip(expected) {
        assert_eq!(id_cmp(left, right), want, "{left} vs {right}");
        assert_eq!(id_cmp(right, left), want.reverse(), "{right} vs {left}");
    }
}

#[test]
fn f1_numeric_ids_order_the_same_in_both_builds() {
    // Production player ids are decimal user ids, where ICU and byte order
    // agree: F1 changes nothing for them.
    let mut ids = ["7", "10", "123", "9", "1", "100", "12"];
    ids.sort_by(|left, right| id_cmp(left, right));
    assert_eq!(ids, ["1", "10", "100", "12", "123", "7", "9"]);
}
