//! Hand-written JCS (RFC 8785) writer over typed structs (D9).
//!
//! Keys sorted by UTF-16 code units, numbers formatted with `ryu-js`, no
//! `serde_json::Value`. Produces `engineConfigJson` and the `DigestEnvelope`
//! bytes. Goldens include `1e+21`, `5e-7` and `-0`.
//!
//! The writer is streaming: the caller emits object members in canonical
//! order, and the writer *checks* that order (strictly increasing by UTF-16
//! code units, so a duplicate key is also an error) instead of buffering and
//! sorting. Typed structs with a fixed field set list their keys in a `const`
//! array and assert [`keys_sorted_utf16`] at compile time; dynamic maps sort
//! their keys with [`sort_keys_utf16`] / [`sort_by_utf16_key`] first, or use
//! [`JcsWriter::object_unsorted`].
//!
//! Output rules (RFC 8785 section 3.2):
//! - no whitespace;
//! - strings: `"` and `\` escaped, `\b \f \n \r \t` short forms, every other
//!   code point below U+0020 as `\u00xx` (lowercase hex), everything else
//!   (including U+007F, U+2028, U+2029 and non-ASCII) raw UTF-8;
//! - numbers: ECMAScript `Number::toString` via `ryu-js` (`1e+21`, `5e-7`,
//!   `-0` -> `0`, integers without `.0`); NaN and +/-Infinity are an error;
//! - integers are written as JS numbers, so `u64`/`i64` outside
//!   `±(2^53 - 1)` are an error instead of being silently rounded. `usize` has
//!   no impl on purpose (D4(b)).

use alloc::string::String;
use alloc::vec::Vec;
use core::cmp::Ordering;
use core::fmt;

/// Largest integer a JS number holds exactly (`Number.MAX_SAFE_INTEGER`).
pub const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;

/// Errors from [`JcsWriter`]. After any error the writer is poisoned and
/// [`JcsWriter::finish`] fails; discard it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum JcsError {
    /// NaN or +/-Infinity: not representable in JSON (RFC 8785 3.2.2.3).
    NonFiniteNumber,
    /// An integer outside `±(2^53 - 1)`; a JS number would round it.
    UnsafeInteger,
    /// An object key that is not strictly greater (UTF-16 order) than the
    /// previous key of the same object.
    KeyOrder,
    /// A key equal to the previous key of the same object.
    DuplicateKey,
    /// Unbalanced or misplaced call: a value without a key inside an object,
    /// a key outside an object, a second top-level value, a mismatched
    /// `end_*`, or `finish` before the value is complete.
    Structure(&'static str),
    /// A previous call already failed.
    Poisoned,
}

impl fmt::Display for JcsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NonFiniteNumber => f.write_str("JCS: NaN/Infinity are not valid JSON numbers"),
            Self::UnsafeInteger => f.write_str("JCS: integer outside the JS safe integer range"),
            Self::KeyOrder => f.write_str("JCS: object keys not in UTF-16 code unit order"),
            Self::DuplicateKey => f.write_str("JCS: duplicate object key"),
            Self::Structure(what) => write!(f, "JCS: structure error: {what}"),
            Self::Poisoned => f.write_str("JCS: writer used after an earlier error"),
        }
    }
}

impl core::error::Error for JcsError {}

// ---------------------------------------------------------------------------
// UTF-16 key order
// ---------------------------------------------------------------------------

/// Compares two strings by their UTF-16 code units (RFC 8785 3.2.3; the order
/// of JS `<` on strings and of `Array.prototype.sort()` without comparator).
///
/// This differs from byte / `char` order only between U+E000..=U+FFFF and the
/// supplementary planes: `"\u{FB33}" > "\u{1F600}"` in UTF-16.
pub fn utf16_cmp(a: &str, b: &str) -> Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}

/// Sorts keys by UTF-16 code units (stable sort; equal keys keep their order).
pub fn sort_keys_utf16(keys: &mut [&str]) {
    keys.sort_by(|a, b| utf16_cmp(a, b));
}

/// Sorts arbitrary items by a string key in UTF-16 code unit order (stable).
pub fn sort_by_utf16_key<T, F>(items: &mut [T], mut key: F)
where
    F: FnMut(&T) -> &str,
{
    items.sort_by(|a, b| utf16_cmp(key(a), key(b)));
}

/// Decodes the scalar value starting at `bytes[i]` of valid UTF-8 and returns
/// `(scalar, encoded_len)`. `const` so key lists can be checked at compile
/// time.
const fn decode_utf8(bytes: &[u8], i: usize) -> (u32, usize) {
    let b0 = bytes[i] as u32;
    if b0 < 0x80 {
        (b0, 1)
    } else if b0 < 0xE0 {
        (((b0 & 0x1F) << 6) | (bytes[i + 1] as u32 & 0x3F), 2)
    } else if b0 < 0xF0 {
        (
            ((b0 & 0x0F) << 12)
                | ((bytes[i + 1] as u32 & 0x3F) << 6)
                | (bytes[i + 2] as u32 & 0x3F),
            3,
        )
    } else {
        (
            ((b0 & 0x07) << 18)
                | ((bytes[i + 1] as u32 & 0x3F) << 12)
                | ((bytes[i + 2] as u32 & 0x3F) << 6)
                | (bytes[i + 3] as u32 & 0x3F),
            4,
        )
    }
}

/// Maps a scalar value to a rank whose integer order equals UTF-16 order of
/// single scalars: U+E000..=U+FFFF sort after every supplementary scalar
/// (whose first unit is a high surrogate, 0xD800..=0xDBFF). Equal scalars
/// keep equal ranks and surrogate pairs preserve scalar order, so comparing
/// rank sequences equals comparing UTF-16 unit sequences.
const fn utf16_rank(c: u32) -> u32 {
    if c >= 0xE000 && c <= 0xFFFF {
        c + 0x0020_0000
    } else {
        c
    }
}

/// `const` version of [`utf16_cmp`].
pub const fn utf16_cmp_const(a: &str, b: &str) -> Ordering {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    let (mut i, mut j) = (0, 0);
    while i < a.len() && j < b.len() {
        let (ca, la) = decode_utf8(a, i);
        let (cb, lb) = decode_utf8(b, j);
        let (ra, rb) = (utf16_rank(ca), utf16_rank(cb));
        if ra < rb {
            return Ordering::Less;
        }
        if ra > rb {
            return Ordering::Greater;
        }
        i += la;
        j += lb;
    }
    if i < a.len() {
        Ordering::Greater
    } else if j < b.len() {
        Ordering::Less
    } else {
        Ordering::Equal
    }
}

/// True when `keys` is strictly increasing in UTF-16 code unit order (sorted
/// and without duplicates). Use in a `const` assertion next to a typed
/// struct's key list:
///
/// ```
/// use race_core::canonical::keys_sorted_utf16;
/// const KEYS: [&str; 3] = ["finishTick", "playerId", "rank"];
/// const _: () = assert!(keys_sorted_utf16(&KEYS));
/// ```
pub const fn keys_sorted_utf16(keys: &[&str]) -> bool {
    let mut i = 1;
    while i < keys.len() {
        if !matches!(utf16_cmp_const(keys[i - 1], keys[i]), Ordering::Less) {
            return false;
        }
        i += 1;
    }
    true
}

// ---------------------------------------------------------------------------
// Scalar formatting
// ---------------------------------------------------------------------------

const HEX_LOWER: &[u8; 16] = b"0123456789abcdef";

/// Appends `s` as a JCS string literal (with quotes).
pub fn push_json_string(out: &mut String, s: &str) {
    out.push('"');
    let bytes = s.as_bytes();
    let mut start = 0;
    for (i, &b) in bytes.iter().enumerate() {
        let short = match b {
            b'"' => "\\\"",
            b'\\' => "\\\\",
            0x08 => "\\b",
            0x0C => "\\f",
            b'\n' => "\\n",
            b'\r' => "\\r",
            b'\t' => "\\t",
            0x00..=0x1F => "",
            _ => continue,
        };
        // Only ASCII bytes reach here, so `start..i` is on char boundaries.
        out.push_str(&s[start..i]);
        if short.is_empty() {
            out.push_str("\\u00");
            out.push(HEX_LOWER[(b >> 4) as usize] as char);
            out.push(HEX_LOWER[(b & 0x0F) as usize] as char);
        } else {
            out.push_str(short);
        }
        start = i + 1;
    }
    out.push_str(&s[start..]);
    out.push('"');
}

/// Appends `x` formatted as ECMAScript `Number::toString` (which is what
/// RFC 8785 requires). Fails on NaN and +/-Infinity.
pub fn push_json_number(out: &mut String, x: f64) -> Result<(), JcsError> {
    if !x.is_finite() {
        return Err(JcsError::NonFiniteNumber);
    }
    let mut buf = ryu_js::Buffer::new();
    // ryu-js prints both zeros as "0", matching JSON.stringify(-0).
    out.push_str(buf.format_finite(x));
    Ok(())
}

/// Appends a safe integer. Same output as [`push_json_number`] for the same
/// value, without the float round trip.
fn push_json_safe_int(out: &mut String, negative: bool, magnitude: u64) -> Result<(), JcsError> {
    if magnitude > MAX_SAFE_INTEGER {
        return Err(JcsError::UnsafeInteger);
    }
    if negative && magnitude != 0 {
        out.push('-');
    }
    let mut digits = [0u8; 20];
    let mut n = magnitude;
    let mut len = 0;
    loop {
        digits[len] = b'0' + (n % 10) as u8;
        len += 1;
        n /= 10;
        if n == 0 {
            break;
        }
    }
    while len > 0 {
        len -= 1;
        out.push(digits[len] as char);
    }
    Ok(())
}

/// Formats a single number as JCS (convenience for tests and tooling).
pub fn number_to_string(x: f64) -> Result<String, JcsError> {
    let mut s = String::new();
    push_json_number(&mut s, x)?;
    Ok(s)
}

/// Formats a single string as a JCS string literal.
pub fn string_to_json(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    push_json_string(&mut out, s);
    out
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

#[derive(Debug)]
struct Frame {
    is_object: bool,
    len: u32,
    /// Objects: a key was written and its value is pending.
    awaiting_value: bool,
    /// Objects: previous key (for the order check). Reused allocation.
    last_key: String,
}

/// Streaming JCS writer. See the module docs for the contract.
///
/// ```
/// use race_core::canonical::JcsWriter;
/// let mut w = JcsWriter::new();
/// w.begin_object()?;
/// w.key("a")?;
/// w.number(1e21)?;
/// w.key("b")?;
/// w.begin_array()?;
/// w.number(5e-7)?;
/// w.number(-0.0)?;
/// w.string("é\n")?;
/// w.end_array()?;
/// w.end_object()?;
/// assert_eq!(w.finish()?, "{\"a\":1e+21,\"b\":[5e-7,0,\"é\\n\"]}");
/// # Ok::<(), race_core::canonical::JcsError>(())
/// ```
#[derive(Debug, Default)]
pub struct JcsWriter {
    out: String,
    stack: Vec<Frame>,
    /// Frames popped earlier, kept to reuse their `last_key` allocations.
    spare: Vec<Frame>,
    root_written: bool,
    poisoned: bool,
}

impl JcsWriter {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_capacity(bytes: usize) -> Self {
        Self {
            out: String::with_capacity(bytes),
            ..Self::default()
        }
    }

    fn fail<T>(&mut self, e: JcsError) -> Result<T, JcsError> {
        self.poisoned = true;
        Err(e)
    }

    /// Validates the position of a value and writes the separator before it.
    fn before_value(&mut self) -> Result<(), JcsError> {
        if self.poisoned {
            return Err(JcsError::Poisoned);
        }
        match self.stack.last_mut() {
            None => {
                if self.root_written {
                    return self.fail(JcsError::Structure("second top-level value"));
                }
                self.root_written = true;
            }
            Some(top) if top.is_object => {
                if !top.awaiting_value {
                    return self.fail(JcsError::Structure("object value without key"));
                }
                top.awaiting_value = false;
                top.len += 1;
            }
            Some(top) => {
                if top.len > 0 {
                    self.out.push(',');
                }
                top.len += 1;
            }
        }
        Ok(())
    }

    fn push_frame(&mut self, is_object: bool) {
        let mut frame = self.spare.pop().unwrap_or(Frame {
            is_object,
            len: 0,
            awaiting_value: false,
            last_key: String::new(),
        });
        frame.is_object = is_object;
        frame.len = 0;
        frame.awaiting_value = false;
        frame.last_key.clear();
        self.stack.push(frame);
    }

    fn pop_frame(&mut self, is_object: bool) -> Result<(), JcsError> {
        if self.poisoned {
            return Err(JcsError::Poisoned);
        }
        match self.stack.last() {
            Some(top) if top.is_object == is_object && !top.awaiting_value => {}
            Some(top) if top.awaiting_value => {
                return self.fail(JcsError::Structure("object closed after a key"));
            }
            _ => return self.fail(JcsError::Structure("mismatched end")),
        }
        if let Some(frame) = self.stack.pop() {
            self.spare.push(frame);
        }
        self.out.push(if is_object { '}' } else { ']' });
        Ok(())
    }

    pub fn begin_object(&mut self) -> Result<(), JcsError> {
        self.before_value()?;
        self.out.push('{');
        self.push_frame(true);
        Ok(())
    }

    /// Writes the next member key. Keys must be strictly increasing in
    /// UTF-16 code unit order within one object.
    pub fn key(&mut self, key: &str) -> Result<(), JcsError> {
        if self.poisoned {
            return Err(JcsError::Poisoned);
        }
        let err = match self.stack.last() {
            Some(top) if top.is_object && !top.awaiting_value => {
                if top.len == 0 {
                    None
                } else {
                    match utf16_cmp(&top.last_key, key) {
                        Ordering::Less => None,
                        Ordering::Equal => Some(JcsError::DuplicateKey),
                        Ordering::Greater => Some(JcsError::KeyOrder),
                    }
                }
            }
            Some(top) if top.is_object => Some(JcsError::Structure("key after key")),
            _ => Some(JcsError::Structure("key outside an object")),
        };
        if let Some(e) = err {
            return self.fail(e);
        }
        if let Some(top) = self.stack.last_mut() {
            if top.len > 0 {
                self.out.push(',');
            }
            top.awaiting_value = true;
            top.last_key.clear();
            top.last_key.push_str(key);
        }
        push_json_string(&mut self.out, key);
        self.out.push(':');
        Ok(())
    }

    pub fn end_object(&mut self) -> Result<(), JcsError> {
        self.pop_frame(true)
    }

    pub fn begin_array(&mut self) -> Result<(), JcsError> {
        self.before_value()?;
        self.out.push('[');
        self.push_frame(false);
        Ok(())
    }

    pub fn end_array(&mut self) -> Result<(), JcsError> {
        self.pop_frame(false)
    }

    pub fn null(&mut self) -> Result<(), JcsError> {
        self.before_value()?;
        self.out.push_str("null");
        Ok(())
    }

    pub fn bool(&mut self, v: bool) -> Result<(), JcsError> {
        self.before_value()?;
        self.out.push_str(if v { "true" } else { "false" });
        Ok(())
    }

    pub fn string(&mut self, v: &str) -> Result<(), JcsError> {
        self.before_value()?;
        push_json_string(&mut self.out, v);
        Ok(())
    }

    /// Writes a finite `f64`; NaN/Infinity poison the writer.
    pub fn number(&mut self, v: f64) -> Result<(), JcsError> {
        if !v.is_finite() {
            return self.fail(JcsError::NonFiniteNumber);
        }
        self.before_value()?;
        push_json_number(&mut self.out, v)
    }

    pub fn u32(&mut self, v: u32) -> Result<(), JcsError> {
        self.u64(u64::from(v))
    }

    pub fn i32(&mut self, v: i32) -> Result<(), JcsError> {
        self.i64(i64::from(v))
    }

    /// Writes an integer that must be at most `2^53 - 1`.
    pub fn u64(&mut self, v: u64) -> Result<(), JcsError> {
        if v > MAX_SAFE_INTEGER {
            return self.fail(JcsError::UnsafeInteger);
        }
        self.before_value()?;
        push_json_safe_int(&mut self.out, false, v)
    }

    /// Writes an integer that must be within `±(2^53 - 1)`.
    pub fn i64(&mut self, v: i64) -> Result<(), JcsError> {
        if v.unsigned_abs() > MAX_SAFE_INTEGER {
            return self.fail(JcsError::UnsafeInteger);
        }
        self.before_value()?;
        push_json_safe_int(&mut self.out, v < 0, v.unsigned_abs())
    }

    /// Writes any [`JcsValue`].
    pub fn value<T: JcsValue + ?Sized>(&mut self, v: &T) -> Result<(), JcsError> {
        let r = v.write_jcs(self);
        if r.is_err() {
            self.poisoned = true;
        }
        r
    }

    /// `key(k)` followed by `value(v)`.
    pub fn field<T: JcsValue + ?Sized>(&mut self, k: &str, v: &T) -> Result<(), JcsError> {
        self.key(k)?;
        self.value(v)
    }

    /// `field(k, v)` when `v` is `Some`; nothing when `None` (the JS
    /// `undefined`-member convention). Use plain [`field`](Self::field) with
    /// an `Option` to get `null` instead.
    pub fn field_opt<T: JcsValue>(&mut self, k: &str, v: Option<&T>) -> Result<(), JcsError> {
        match v {
            Some(v) => self.field(k, v),
            None => Ok(()),
        }
    }

    /// Writes a whole object from members in any order: sorts them by UTF-16
    /// key order, then writes them. Duplicate keys are an error.
    pub fn object_unsorted(
        &mut self,
        members: &mut [(&str, &dyn JcsValue)],
    ) -> Result<(), JcsError> {
        sort_by_utf16_key(members, |m| m.0);
        self.begin_object()?;
        for (k, v) in members.iter() {
            self.key(k)?;
            self.value(*v)?;
        }
        self.end_object()
    }

    /// Bytes written so far (may be an incomplete document).
    pub fn as_str(&self) -> &str {
        &self.out
    }

    /// Returns the document. Fails if the writer is poisoned, nothing was
    /// written, or an object/array is still open.
    pub fn finish(self) -> Result<String, JcsError> {
        if self.poisoned {
            return Err(JcsError::Poisoned);
        }
        if !self.stack.is_empty() {
            return Err(JcsError::Structure("unclosed object or array"));
        }
        if !self.root_written {
            return Err(JcsError::Structure("empty document"));
        }
        Ok(self.out)
    }

    /// [`finish`](Self::finish) as bytes.
    pub fn finish_bytes(self) -> Result<Vec<u8>, JcsError> {
        self.finish().map(String::into_bytes)
    }
}

// ---------------------------------------------------------------------------
// Typed values
// ---------------------------------------------------------------------------

/// A value with a canonical JCS form. Implement it for typed structs by
/// writing fields in UTF-16 key order (assert the order with
/// [`keys_sorted_utf16`] in a `const`).
pub trait JcsValue {
    fn write_jcs(&self, w: &mut JcsWriter) -> Result<(), JcsError>;
}

/// Serialises one value to a JCS string.
pub fn to_jcs_string<T: JcsValue + ?Sized>(v: &T) -> Result<String, JcsError> {
    let mut w = JcsWriter::new();
    w.value(v)?;
    w.finish()
}

/// Serialises one value to JCS bytes (UTF-8).
pub fn to_jcs_vec<T: JcsValue + ?Sized>(v: &T) -> Result<Vec<u8>, JcsError> {
    to_jcs_string(v).map(String::into_bytes)
}

impl<T: JcsValue + ?Sized> JcsValue for &T {
    fn write_jcs(&self, w: &mut JcsWriter) -> Result<(), JcsError> {
        (**self).write_jcs(w)
    }
}

impl JcsValue for f64 {
    fn write_jcs(&self, w: &mut JcsWriter) -> Result<(), JcsError> {
        w.number(*self)
    }
}

macro_rules! jcs_small_int {
    ($($t:ty => $m:ident),*) => {$(
        impl JcsValue for $t {
            fn write_jcs(&self, w: &mut JcsWriter) -> Result<(), JcsError> {
                w.$m((*self).into())
            }
        }
    )*};
}
jcs_small_int!(u8 => u32, u16 => u32, u32 => u32, i8 => i32, i16 => i32, i32 => i32);

impl JcsValue for u64 {
    fn write_jcs(&self, w: &mut JcsWriter) -> Result<(), JcsError> {
        w.u64(*self)
    }
}

impl JcsValue for i64 {
    fn write_jcs(&self, w: &mut JcsWriter) -> Result<(), JcsError> {
        w.i64(*self)
    }
}

impl JcsValue for bool {
    fn write_jcs(&self, w: &mut JcsWriter) -> Result<(), JcsError> {
        w.bool(*self)
    }
}

impl JcsValue for str {
    fn write_jcs(&self, w: &mut JcsWriter) -> Result<(), JcsError> {
        w.string(self)
    }
}

impl JcsValue for String {
    fn write_jcs(&self, w: &mut JcsWriter) -> Result<(), JcsError> {
        w.string(self)
    }
}

/// `None` is `null`. For "omit when absent" use [`JcsWriter::field_opt`].
impl<T: JcsValue> JcsValue for Option<T> {
    fn write_jcs(&self, w: &mut JcsWriter) -> Result<(), JcsError> {
        match self {
            Some(v) => v.write_jcs(w),
            None => w.null(),
        }
    }
}

impl<T: JcsValue> JcsValue for [T] {
    fn write_jcs(&self, w: &mut JcsWriter) -> Result<(), JcsError> {
        w.begin_array()?;
        for v in self {
            v.write_jcs(w)?;
        }
        w.end_array()
    }
}

impl<T: JcsValue, const N: usize> JcsValue for [T; N] {
    fn write_jcs(&self, w: &mut JcsWriter) -> Result<(), JcsError> {
        self.as_slice().write_jcs(w)
    }
}

impl<T: JcsValue> JcsValue for Vec<T> {
    fn write_jcs(&self, w: &mut JcsWriter) -> Result<(), JcsError> {
        self.as_slice().write_jcs(w)
    }
}

/// Sorted string-keyed maps. `BTreeMap<String, _>` iterates in byte order,
/// which differs from UTF-16 order, so the keys are re-sorted here.
impl<V: JcsValue> JcsValue for alloc::collections::BTreeMap<String, V> {
    fn write_jcs(&self, w: &mut JcsWriter) -> Result<(), JcsError> {
        let mut members: Vec<(&str, &V)> = self.iter().map(|(k, v)| (k.as_str(), v)).collect();
        sort_by_utf16_key(&mut members, |m| m.0);
        w.begin_object()?;
        for (k, v) in members {
            w.field(k, v)?;
        }
        w.end_object()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::vec;

    fn num(x: f64) -> String {
        number_to_string(x).unwrap()
    }

    #[test]
    fn numbers_follow_ecmascript() {
        assert_eq!(num(0.0), "0");
        assert_eq!(num(-0.0), "0");
        assert_eq!(num(1.0), "1");
        assert_eq!(num(-1.5), "-1.5");
        assert_eq!(num(1e21), "1e+21");
        assert_eq!(num(1e20), "100000000000000000000");
        assert_eq!(num(5e-7), "5e-7");
        assert_eq!(num(1e-6), "0.000001");
        assert_eq!(num(9007199254740992.0), "9007199254740992");
        assert_eq!(num(f64::MIN_POSITIVE), "2.2250738585072014e-308");
        assert_eq!(num(5e-324), "5e-324");
        assert_eq!(num(0.1 + 0.2), "0.30000000000000004");
        assert_eq!(number_to_string(f64::NAN), Err(JcsError::NonFiniteNumber));
        assert_eq!(
            number_to_string(f64::INFINITY),
            Err(JcsError::NonFiniteNumber)
        );
        assert_eq!(
            number_to_string(f64::NEG_INFINITY),
            Err(JcsError::NonFiniteNumber)
        );
    }

    #[test]
    fn rfc8785_appendix_b() {
        let cases: [(u64, &str); 24] = [
            (0x0000000000000000, "0"),
            (0x8000000000000000, "0"),
            (0x0000000000000001, "5e-324"),
            (0x8000000000000001, "-5e-324"),
            (0x7fefffffffffffff, "1.7976931348623157e+308"),
            (0xffefffffffffffff, "-1.7976931348623157e+308"),
            (0x4340000000000000, "9007199254740992"),
            (0xc340000000000000, "-9007199254740992"),
            (0x4430000000000000, "295147905179352830000"),
            (0x44b52d02c7e14af5, "9.999999999999997e+22"),
            (0x44b52d02c7e14af6, "1e+23"),
            (0x44b52d02c7e14af7, "1.0000000000000001e+23"),
            (0x444b1ae4d6e2ef4e, "999999999999999700000"),
            (0x444b1ae4d6e2ef4f, "999999999999999900000"),
            (0x444b1ae4d6e2ef50, "1e+21"),
            (0x3eb0c6f7a0b5ed8c, "9.999999999999997e-7"),
            (0x3eb0c6f7a0b5ed8d, "0.000001"),
            (0x41b3de4355555553, "333333333.3333332"),
            (0x41b3de4355555554, "333333333.33333325"),
            (0x41b3de4355555555, "333333333.3333333"),
            (0x41b3de4355555556, "333333333.3333334"),
            (0x41b3de4355555557, "333333333.33333343"),
            (0xbecbf647612f3696, "-0.0000033333333333333333"),
            (0x43143ff3c1cb0959, "1424953923781206.2"),
        ];
        for (bits, want) in cases {
            assert_eq!(num(f64::from_bits(bits)), want, "bits {bits:#018x}");
        }
    }

    #[test]
    fn strings_escape_per_rfc8785() {
        assert_eq!(string_to_json(""), "\"\"");
        assert_eq!(string_to_json("\"\\/"), "\"\\\"\\\\/\"");
        assert_eq!(
            string_to_json("\u{8}\u{c}\n\r\t\u{0}\u{1f}\u{b}\u{7f}"),
            "\"\\b\\f\\n\\r\\t\\u0000\\u001f\\u000b\u{7f}\""
        );
        assert_eq!(string_to_json("é\u{2028}🦆"), "\"é\u{2028}🦆\"");
        assert_eq!(
            string_to_json("€$\u{f}\nA'B\"\\\\\"/"),
            "\"€$\\u000f\\nA'B\\\"\\\\\\\\\\\"/\""
        );
    }

    #[test]
    fn utf16_order_matches_rfc_example() {
        let mut keys = vec![
            "\u{20ac}",
            "\r",
            "\u{fb33}",
            "1",
            "\u{1f600}",
            "\u{80}",
            "\u{f6}",
        ];
        sort_keys_utf16(&mut keys);
        assert_eq!(
            keys,
            [
                "\r",
                "1",
                "\u{80}",
                "\u{f6}",
                "\u{20ac}",
                "\u{1f600}",
                "\u{fb33}"
            ]
        );
        assert!(keys_sorted_utf16(&keys));
        // Byte order would put U+1F600 last.
        assert_eq!(utf16_cmp("\u{1f600}", "\u{fb33}"), Ordering::Less);
        assert_eq!(utf16_cmp_const("\u{1f600}", "\u{fb33}"), Ordering::Less);
        assert!(!keys_sorted_utf16(&["b", "a"]));
        assert!(!keys_sorted_utf16(&["a", "a"]));
        assert!(keys_sorted_utf16(&["", "a", "aa", "b"]));
    }

    const ENVELOPE_KEYS: [&str; 12] = [
        "balanceVersion",
        "configCommit",
        "digestVersion",
        "durationTicks",
        "engineVersion",
        "eventsSha256",
        "motionSha256",
        "protocolVersion",
        "rngVersion",
        "standings",
        "trackDefSha256",
        "trackVersion",
    ];
    const _: () = assert!(keys_sorted_utf16(&ENVELOPE_KEYS));

    #[test]
    fn writer_rejects_bad_structure_and_order() {
        let mut w = JcsWriter::new();
        w.begin_object().unwrap();
        w.key("b").unwrap();
        w.null().unwrap();
        assert_eq!(w.key("a"), Err(JcsError::KeyOrder));
        assert_eq!(w.null(), Err(JcsError::Poisoned));
        assert_eq!(w.finish(), Err(JcsError::Poisoned));

        let mut w = JcsWriter::new();
        w.begin_object().unwrap();
        w.field("a", &1u32).unwrap();
        assert_eq!(w.key("a"), Err(JcsError::DuplicateKey));

        let mut w = JcsWriter::new();
        w.begin_object().unwrap();
        assert!(matches!(w.null(), Err(JcsError::Structure(_))));

        let mut w = JcsWriter::new();
        assert!(matches!(w.key("a"), Err(JcsError::Structure(_))));

        let mut w = JcsWriter::new();
        w.begin_array().unwrap();
        assert!(matches!(w.end_object(), Err(JcsError::Structure(_))));

        let mut w = JcsWriter::new();
        w.null().unwrap();
        assert!(matches!(w.null(), Err(JcsError::Structure(_))));

        let mut w = JcsWriter::new();
        w.begin_array().unwrap();
        assert!(matches!(w.finish(), Err(JcsError::Structure(_))));

        assert!(matches!(
            JcsWriter::new().finish(),
            Err(JcsError::Structure(_))
        ));

        let mut w = JcsWriter::new();
        w.begin_array().unwrap();
        assert_eq!(w.number(f64::NAN), Err(JcsError::NonFiniteNumber));
        assert_eq!(w.finish(), Err(JcsError::Poisoned));

        assert_eq!(to_jcs_string(&(1u64 << 53)), Err(JcsError::UnsafeInteger));
        assert_eq!(to_jcs_string(&-(1i64 << 53)), Err(JcsError::UnsafeInteger));
        assert_eq!(to_jcs_string(&i64::MIN), Err(JcsError::UnsafeInteger));
    }

    #[test]
    fn typed_values_and_helpers() {
        assert_eq!(
            to_jcs_string(&MAX_SAFE_INTEGER).unwrap(),
            "9007199254740991"
        );
        assert_eq!(
            to_jcs_string(&-(MAX_SAFE_INTEGER as i64)).unwrap(),
            "-9007199254740991"
        );
        assert_eq!(to_jcs_string(&0i64).unwrap(), "0");
        assert_eq!(to_jcs_string(&i32::MIN).unwrap(), "-2147483648");
        assert_eq!(to_jcs_string(&vec![Some(1.5), None]).unwrap(), "[1.5,null]");

        let mut w = JcsWriter::new();
        let (a, b, c): (u32, &str, [bool; 2]) = (7, "x", [true, false]);
        w.object_unsorted(&mut [("\u{fb33}", &a), ("\u{1f600}", &b), ("1", &c)])
            .unwrap();
        assert_eq!(
            w.finish().unwrap(),
            "{\"1\":[true,false],\"\u{1f600}\":\"x\",\"\u{fb33}\":7}"
        );

        let mut m = alloc::collections::BTreeMap::new();
        m.insert(String::from("\u{fb33}"), 1u32);
        m.insert(String::from("\u{1f600}"), 2u32);
        assert_eq!(
            to_jcs_string(&m).unwrap(),
            "{\"\u{1f600}\":2,\"\u{fb33}\":1}"
        );

        let mut w = JcsWriter::new();
        w.begin_object().unwrap();
        w.field_opt::<u32>("a", None).unwrap();
        w.field_opt("b", Some(&2u32)).unwrap();
        w.end_object().unwrap();
        assert_eq!(w.finish().unwrap(), "{\"b\":2}");
    }
}
