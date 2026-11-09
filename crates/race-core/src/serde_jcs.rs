//! RFC 8785 JCS text of any `serde::Serialize` value, without
//! `serde_json::Value` (D4(b)).
//!
//! The value is first serialised into a small private tree, then written with
//! object keys sorted by UTF-16 code units (`canonical::utf16_cmp`), numbers
//! as ECMAScript `Number::toString` (`canonical::push_json_number`) and
//! strings as `JSON.stringify` writes them (`canonical::push_json_string`).
//! `None` fields marked `skip_serializing_if` are absent, exactly like a JS
//! `undefined` member; a `None` that serde does serialise is `null`.
//!
//! This is how race events become the `ev-jcs-v1` text the TS oracle hashes
//! (`scripts/oracle/README.md`): the metadata structs in
//! `race_protocol::events` carry the wire key names, and this writer turns any
//! of them into canonical JSON with one generic path.

use alloc::string::{String, ToString};
use alloc::vec::Vec;
use core::fmt;

use serde::ser::{self, Serialize};

use crate::canonical::{JcsError, push_json_number, push_json_string, utf16_cmp};

/// Largest integer a JS number holds exactly.
const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;

/// Why a value could not be written as JCS.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SerdeJcsError {
    /// A number JCS can't represent (NaN, infinity, unsafe integer) or a
    /// duplicate key.
    Jcs(JcsError),
    /// A serde shape JSON has no form for (bytes as map keys, non-string
    /// keys, ...), or a custom serde error.
    Unsupported(String),
}

impl fmt::Display for SerdeJcsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Jcs(error) => write!(f, "{error}"),
            Self::Unsupported(what) => write!(f, "JCS: unsupported value: {what}"),
        }
    }
}

impl core::error::Error for SerdeJcsError {}

impl ser::Error for SerdeJcsError {
    fn custom<T: fmt::Display>(msg: T) -> Self {
        Self::Unsupported(msg.to_string())
    }
}

impl From<JcsError> for SerdeJcsError {
    fn from(error: JcsError) -> Self {
        Self::Jcs(error)
    }
}

/// The intermediate JSON tree. Numbers stay `f64` (JS numbers).
#[derive(Clone, Debug)]
enum Node {
    Null,
    Bool(bool),
    Number(f64),
    String(String),
    Array(Vec<Node>),
    Object(Vec<(String, Node)>),
}

/// The JCS text of `value`.
///
/// # Errors
/// On a non-finite number, an integer above 2^53 - 1, a duplicate object key
/// or a non-JSON serde shape.
pub fn to_jcs_string<T: Serialize + ?Sized>(value: &T) -> Result<String, SerdeJcsError> {
    let node = value.serialize(TreeSerializer)?;
    let mut out = String::new();
    write_node(&mut out, &node)?;
    Ok(out)
}

/// The JCS text of `value` with the top-level object members named in
/// `omit` left out (e.g. `seq` for the `ev-jcs-v1` event digest).
///
/// # Errors
/// As [`to_jcs_string`].
pub fn to_jcs_string_omitting<T: Serialize + ?Sized>(
    value: &T,
    omit: &[&str],
) -> Result<String, SerdeJcsError> {
    let mut node = value.serialize(TreeSerializer)?;
    if let Node::Object(members) = &mut node {
        members.retain(|(key, _)| !omit.contains(&key.as_str()));
    }
    let mut out = String::new();
    write_node(&mut out, &node)?;
    Ok(out)
}

fn write_node(out: &mut String, node: &Node) -> Result<(), SerdeJcsError> {
    match node {
        Node::Null => out.push_str("null"),
        Node::Bool(true) => out.push_str("true"),
        Node::Bool(false) => out.push_str("false"),
        Node::Number(value) => push_json_number(out, *value)?,
        Node::String(value) => push_json_string(out, value),
        Node::Array(items) => {
            out.push('[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                write_node(out, item)?;
            }
            out.push(']');
        }
        Node::Object(members) => {
            let mut order: Vec<&(String, Node)> = members.iter().collect();
            order.sort_by(|a, b| utf16_cmp(&a.0, &b.0));
            out.push('{');
            for (index, (key, value)) in order.iter().enumerate() {
                if index > 0 {
                    if order[index - 1].0 == *key {
                        return Err(JcsError::DuplicateKey.into());
                    }
                    out.push(',');
                }
                push_json_string(out, key);
                out.push(':');
                write_node(out, value)?;
            }
            out.push('}');
        }
    }
    Ok(())
}

fn int_node(negative: bool, magnitude: u64) -> Result<Node, SerdeJcsError> {
    if magnitude > MAX_SAFE_INTEGER {
        return Err(JcsError::UnsafeInteger.into());
    }
    // Exact: `magnitude <= 2^53 - 1`.
    #[allow(clippy::cast_precision_loss)]
    let value = magnitude as f64;
    Ok(Node::Number(if negative { -value } else { value }))
}

struct TreeSerializer;

struct SeqBuilder {
    items: Vec<Node>,
    /// `Some(variant)` for tuple variants (`{"variant": [...]}`).
    variant: Option<&'static str>,
}

struct MapBuilder {
    members: Vec<(String, Node)>,
    pending_key: Option<String>,
    /// `Some(variant)` for struct variants (`{"variant": {...}}`).
    variant: Option<&'static str>,
}

fn wrap_variant(variant: Option<&'static str>, node: Node) -> Node {
    match variant {
        None => node,
        Some(name) => Node::Object(Vec::from([(String::from(name), node)])),
    }
}

impl ser::Serializer for TreeSerializer {
    type Ok = Node;
    type Error = SerdeJcsError;
    type SerializeSeq = SeqBuilder;
    type SerializeTuple = SeqBuilder;
    type SerializeTupleStruct = SeqBuilder;
    type SerializeTupleVariant = SeqBuilder;
    type SerializeMap = MapBuilder;
    type SerializeStruct = MapBuilder;
    type SerializeStructVariant = MapBuilder;

    fn serialize_bool(self, v: bool) -> Result<Node, SerdeJcsError> {
        Ok(Node::Bool(v))
    }
    fn serialize_i8(self, v: i8) -> Result<Node, SerdeJcsError> {
        self.serialize_i64(i64::from(v))
    }
    fn serialize_i16(self, v: i16) -> Result<Node, SerdeJcsError> {
        self.serialize_i64(i64::from(v))
    }
    fn serialize_i32(self, v: i32) -> Result<Node, SerdeJcsError> {
        self.serialize_i64(i64::from(v))
    }
    fn serialize_i64(self, v: i64) -> Result<Node, SerdeJcsError> {
        int_node(v < 0, v.unsigned_abs())
    }
    fn serialize_u8(self, v: u8) -> Result<Node, SerdeJcsError> {
        self.serialize_u64(u64::from(v))
    }
    fn serialize_u16(self, v: u16) -> Result<Node, SerdeJcsError> {
        self.serialize_u64(u64::from(v))
    }
    fn serialize_u32(self, v: u32) -> Result<Node, SerdeJcsError> {
        self.serialize_u64(u64::from(v))
    }
    fn serialize_u64(self, v: u64) -> Result<Node, SerdeJcsError> {
        int_node(false, v)
    }
    fn serialize_f32(self, v: f32) -> Result<Node, SerdeJcsError> {
        self.serialize_f64(f64::from(v))
    }
    fn serialize_f64(self, v: f64) -> Result<Node, SerdeJcsError> {
        if !v.is_finite() {
            return Err(JcsError::NonFiniteNumber.into());
        }
        Ok(Node::Number(v))
    }
    fn serialize_char(self, v: char) -> Result<Node, SerdeJcsError> {
        Ok(Node::String(v.to_string()))
    }
    fn serialize_str(self, v: &str) -> Result<Node, SerdeJcsError> {
        Ok(Node::String(String::from(v)))
    }
    fn serialize_bytes(self, v: &[u8]) -> Result<Node, SerdeJcsError> {
        Ok(Node::Array(
            v.iter()
                .map(|&byte| Node::Number(f64::from(byte)))
                .collect(),
        ))
    }
    fn serialize_none(self) -> Result<Node, SerdeJcsError> {
        Ok(Node::Null)
    }
    fn serialize_some<T: Serialize + ?Sized>(self, value: &T) -> Result<Node, SerdeJcsError> {
        value.serialize(self)
    }
    fn serialize_unit(self) -> Result<Node, SerdeJcsError> {
        Ok(Node::Null)
    }
    fn serialize_unit_struct(self, _name: &'static str) -> Result<Node, SerdeJcsError> {
        Ok(Node::Null)
    }
    fn serialize_unit_variant(
        self,
        _name: &'static str,
        _index: u32,
        variant: &'static str,
    ) -> Result<Node, SerdeJcsError> {
        Ok(Node::String(String::from(variant)))
    }
    fn serialize_newtype_struct<T: Serialize + ?Sized>(
        self,
        _name: &'static str,
        value: &T,
    ) -> Result<Node, SerdeJcsError> {
        value.serialize(self)
    }
    fn serialize_newtype_variant<T: Serialize + ?Sized>(
        self,
        _name: &'static str,
        _index: u32,
        variant: &'static str,
        value: &T,
    ) -> Result<Node, SerdeJcsError> {
        Ok(wrap_variant(Some(variant), value.serialize(self)?))
    }
    fn serialize_seq(self, len: Option<usize>) -> Result<SeqBuilder, SerdeJcsError> {
        Ok(SeqBuilder {
            items: Vec::with_capacity(len.unwrap_or(0)),
            variant: None,
        })
    }
    fn serialize_tuple(self, len: usize) -> Result<SeqBuilder, SerdeJcsError> {
        self.serialize_seq(Some(len))
    }
    fn serialize_tuple_struct(
        self,
        _name: &'static str,
        len: usize, // usize-ok: function parameter, never stored
    ) -> Result<SeqBuilder, SerdeJcsError> {
        self.serialize_seq(Some(len))
    }
    fn serialize_tuple_variant(
        self,
        _name: &'static str,
        _index: u32,
        variant: &'static str,
        len: usize, // usize-ok: function parameter, never stored
    ) -> Result<SeqBuilder, SerdeJcsError> {
        Ok(SeqBuilder {
            items: Vec::with_capacity(len),
            variant: Some(variant),
        })
    }
    fn serialize_map(self, len: Option<usize>) -> Result<MapBuilder, SerdeJcsError> {
        Ok(MapBuilder {
            members: Vec::with_capacity(len.unwrap_or(0)),
            pending_key: None,
            variant: None,
        })
    }
    fn serialize_struct(
        self,
        _name: &'static str,
        len: usize, // usize-ok: function parameter, never stored
    ) -> Result<MapBuilder, SerdeJcsError> {
        self.serialize_map(Some(len))
    }
    fn serialize_struct_variant(
        self,
        _name: &'static str,
        _index: u32,
        variant: &'static str,
        len: usize, // usize-ok: function parameter, never stored
    ) -> Result<MapBuilder, SerdeJcsError> {
        Ok(MapBuilder {
            members: Vec::with_capacity(len),
            pending_key: None,
            variant: Some(variant),
        })
    }
}

impl SeqBuilder {
    fn push<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), SerdeJcsError> {
        self.items.push(value.serialize(TreeSerializer)?);
        Ok(())
    }
    fn done(self) -> Node {
        wrap_variant(self.variant, Node::Array(self.items))
    }
}

impl ser::SerializeSeq for SeqBuilder {
    type Ok = Node;
    type Error = SerdeJcsError;
    fn serialize_element<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), SerdeJcsError> {
        self.push(value)
    }
    fn end(self) -> Result<Node, SerdeJcsError> {
        Ok(self.done())
    }
}

impl ser::SerializeTuple for SeqBuilder {
    type Ok = Node;
    type Error = SerdeJcsError;
    fn serialize_element<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), SerdeJcsError> {
        self.push(value)
    }
    fn end(self) -> Result<Node, SerdeJcsError> {
        Ok(self.done())
    }
}

impl ser::SerializeTupleStruct for SeqBuilder {
    type Ok = Node;
    type Error = SerdeJcsError;
    fn serialize_field<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), SerdeJcsError> {
        self.push(value)
    }
    fn end(self) -> Result<Node, SerdeJcsError> {
        Ok(self.done())
    }
}

impl ser::SerializeTupleVariant for SeqBuilder {
    type Ok = Node;
    type Error = SerdeJcsError;
    fn serialize_field<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), SerdeJcsError> {
        self.push(value)
    }
    fn end(self) -> Result<Node, SerdeJcsError> {
        Ok(self.done())
    }
}

/// Map keys must serialise to strings (JSON object keys).
fn key_string<T: Serialize + ?Sized>(key: &T) -> Result<String, SerdeJcsError> {
    match key.serialize(TreeSerializer)? {
        Node::String(key) => Ok(key),
        other => Err(SerdeJcsError::Unsupported(alloc::format!(
            "non-string map key {other:?}"
        ))),
    }
}

impl MapBuilder {
    fn done(self) -> Node {
        wrap_variant(self.variant, Node::Object(self.members))
    }
}

impl ser::SerializeMap for MapBuilder {
    type Ok = Node;
    type Error = SerdeJcsError;
    fn serialize_key<T: Serialize + ?Sized>(&mut self, key: &T) -> Result<(), SerdeJcsError> {
        self.pending_key = Some(key_string(key)?);
        Ok(())
    }
    fn serialize_value<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), SerdeJcsError> {
        let key = self
            .pending_key
            .take()
            .ok_or_else(|| SerdeJcsError::Unsupported(String::from("map value without key")))?;
        self.members.push((key, value.serialize(TreeSerializer)?));
        Ok(())
    }
    fn end(self) -> Result<Node, SerdeJcsError> {
        Ok(self.done())
    }
}

impl ser::SerializeStruct for MapBuilder {
    type Ok = Node;
    type Error = SerdeJcsError;
    fn serialize_field<T: Serialize + ?Sized>(
        &mut self,
        key: &'static str,
        value: &T,
    ) -> Result<(), SerdeJcsError> {
        self.members
            .push((String::from(key), value.serialize(TreeSerializer)?));
        Ok(())
    }
    fn end(self) -> Result<Node, SerdeJcsError> {
        Ok(self.done())
    }
}

impl ser::SerializeStructVariant for MapBuilder {
    type Ok = Node;
    type Error = SerdeJcsError;
    fn serialize_field<T: Serialize + ?Sized>(
        &mut self,
        key: &'static str,
        value: &T,
    ) -> Result<(), SerdeJcsError> {
        self.members
            .push((String::from(key), value.serialize(TreeSerializer)?));
        Ok(())
    }
    fn end(self) -> Result<Node, SerdeJcsError> {
        Ok(self.done())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Serialize;

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Sample {
        zeta: u32,
        alpha_beta: f64,
        #[serde(skip_serializing_if = "Option::is_none")]
        absent: Option<u32>,
        present_null: Option<u32>,
        list: Vec<&'static str>,
    }

    #[test]
    fn sorts_keys_and_omits_skipped_none() {
        let text = to_jcs_string(&Sample {
            zeta: 3,
            alpha_beta: 1.0,
            absent: None,
            present_null: None,
            list: Vec::from(["a\"b", "ü"]),
        })
        .unwrap();
        assert_eq!(
            text,
            r#"{"alphaBeta":1,"list":["a\"b","ü"],"presentNull":null,"zeta":3}"#
        );
    }

    #[test]
    fn rejects_non_finite() {
        assert!(to_jcs_string(&f64::NAN).is_err());
        assert_eq!(to_jcs_string(&-0.0f64).unwrap(), "0");
        assert_eq!(to_jcs_string(&1e21f64).unwrap(), "1e+21");
    }
}
