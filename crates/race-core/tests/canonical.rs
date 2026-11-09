//! JCS goldens (D9, Phase 1 gate): 10k cases produced by
//! `scripts/oracle/dump-jcs-goldens.ts` from an ECMAScript reference
//! (`JSON.stringify` for numbers and strings, UTF-16-sorted members for
//! objects). Every case must match byte for byte, and so must its sha256.
//!
//! Regenerate with
//! `node --import tsx scripts/oracle/dump-jcs-goldens.ts`.

use race_core::canonical::{
    JcsError, JcsWriter, keys_sorted_utf16, number_to_string, sort_by_utf16_key, string_to_json,
    utf16_cmp, utf16_cmp_const,
};
use race_core::digest::{create_race_commit, sha256_hex};
use serde::Deserialize;

const GOLDENS: &str = include_str!("fixtures/jcs-goldens.jsonl");
const EXPECTED_CASES: usize = 10_000;

/// Typed input tree (see the generator's header for the format).
#[derive(Deserialize)]
#[serde(tag = "t")]
enum Node {
    #[serde(rename = "n")]
    Number { b: String },
    #[serde(rename = "s")]
    Str { v: String },
    #[serde(rename = "b")]
    Bool { v: bool },
    #[serde(rename = "z")]
    Null,
    #[serde(rename = "a")]
    Array { v: Vec<Node> },
    #[serde(rename = "o")]
    Object { v: Vec<(String, Node)> },
}

#[derive(Deserialize)]
struct Case {
    id: u32,
    kind: String,
    input: Node,
    jcs: String,
    sha256: String,
}

fn bits(hex: &str) -> f64 {
    f64::from_bits(u64::from_str_radix(hex, 16).expect("hex f64 bits"))
}

/// Drives the streaming writer the way typed producers do: object members
/// are sorted with the public helper, then emitted in order.
fn write(w: &mut JcsWriter, node: &Node) -> Result<(), JcsError> {
    match node {
        Node::Null => w.null(),
        Node::Bool { v } => w.bool(*v),
        Node::Str { v } => w.string(v),
        Node::Number { b } => {
            let x = bits(b);
            // Safe integers also go through the integer path, which must
            // agree with the float path.
            if race_core::math::trunc(x) == x && x.abs() <= 9_007_199_254_740_991.0 {
                let mut a = JcsWriter::new();
                a.i64(x as i64)?;
                let mut f = JcsWriter::new();
                f.number(x)?;
                assert_eq!(a.finish()?, f.finish()?, "int vs float path for {b}");
            }
            w.number(x)
        }
        Node::Array { v } => {
            w.begin_array()?;
            for item in v {
                write(w, item)?;
            }
            w.end_array()
        }
        Node::Object { v } => {
            let mut members: Vec<&(String, Node)> = v.iter().collect();
            sort_by_utf16_key(&mut members, |m| m.0.as_str());
            w.begin_object()?;
            for (k, val) in members {
                w.key(k)?;
                write(w, val)?;
            }
            w.end_object()
        }
    }
}

fn load() -> Vec<Case> {
    GOLDENS
        .lines()
        .filter(|l| !l.is_empty())
        .map(|l| serde_json::from_str::<Case>(l).expect("golden line parses"))
        .collect()
}

#[test]
fn jcs_goldens_byte_equal() {
    let cases = load();
    assert_eq!(cases.len(), EXPECTED_CASES, "golden count");

    let mut failures = Vec::new();
    let mut per_kind = std::collections::BTreeMap::<&str, (u32, u32)>::new();
    for case in &cases {
        let mut w = JcsWriter::new();
        let got = write(&mut w, &case.input).and_then(|()| w.finish());
        let ok = match &got {
            Ok(s) => *s == case.jcs && create_race_commit(s.as_bytes()) == case.sha256,
            Err(_) => false,
        };
        let entry = per_kind.entry(case.kind.as_str()).or_default();
        entry.1 += 1;
        if ok {
            entry.0 += 1;
        } else if failures.len() < 20 {
            failures.push(format!(
                "#{} {}: want {:?} got {:?}",
                case.id, case.kind, case.jcs, got
            ));
        }
    }
    let total_ok: u32 = per_kind.values().map(|(ok, _)| ok).sum();
    for (kind, (ok, n)) in &per_kind {
        println!("jcs goldens {kind}: {ok}/{n}");
    }
    println!("jcs goldens total: {total_ok}/{}", cases.len());
    assert!(failures.is_empty(), "mismatches:\n{}", failures.join("\n"));
}

#[test]
fn goldens_cover_the_edge_cases() {
    let cases = load();
    for want in [
        "1e+21",
        "5e-7",
        "-5e-7",
        "100000000000000000000",
        "999999999999999900000",
        "0.000001",
        "9.999999999999997e-7",
        "9007199254740992",
        "9007199254740991",
        "9007199254740994",
        "-9007199254740991",
        "5e-324",
        "2.2250738585072014e-308",
        "1.7976931348623157e+308",
    ] {
        assert!(
            cases.iter().any(|c| c.kind == "number" && c.jcs == want),
            "goldens lack {want}"
        );
    }
    // -0 is present and serialises as 0.
    let neg_zero = cases
        .iter()
        .find(|c| matches!(&c.input, Node::Number { b } if b == "8000000000000000"))
        .expect("goldens contain -0");
    assert_eq!(neg_zero.jcs, "0");
    let subnormals = cases
        .iter()
        .filter(|c| {
            matches!(&c.input, Node::Number { b } if {
                let x = bits(b);
                x != 0.0 && x.abs() < f64::MIN_POSITIVE
            })
        })
        .count();
    assert!(subnormals >= 300, "only {subnormals} subnormals");
}

#[test]
fn utf16_helpers_agree_on_golden_keys() {
    let cases = load();
    let mut keys: Vec<&str> = Vec::new();
    fn collect<'a>(n: &'a Node, out: &mut Vec<&'a str>) {
        match n {
            Node::Object { v } => {
                for (k, val) in v {
                    out.push(k);
                    collect(val, out);
                }
            }
            Node::Array { v } => v.iter().for_each(|x| collect(x, out)),
            Node::Str { v } => out.push(v),
            _ => {}
        }
    }
    for c in &cases {
        collect(&c.input, &mut keys);
    }
    keys.sort();
    keys.dedup();
    let mut sorted = keys.clone();
    sort_by_utf16_key(&mut sorted, |k| *k);
    assert!(keys_sorted_utf16(&sorted));
    for pair in sorted.windows(2) {
        assert_eq!(
            utf16_cmp(pair[0], pair[1]),
            utf16_cmp_const(pair[0], pair[1])
        );
    }
    // Spot-check the const comparator on every adjacent pair of the
    // byte-sorted list too (different neighbours than the UTF-16 list).
    for pair in keys.windows(2) {
        assert_eq!(
            utf16_cmp(pair[0], pair[1]),
            utf16_cmp_const(pair[0], pair[1])
        );
    }
}

#[test]
// The RFC input literal is deliberately over-precise (it rounds to 333333333.3333333).
#[allow(clippy::excessive_precision)]
fn rfc8785_full_example() {
    // RFC 8785 section 3.2.2 input, written with the typed writer.
    let mut w = JcsWriter::new();
    w.begin_object().unwrap();
    w.key("literals").unwrap();
    w.begin_array().unwrap();
    w.null().unwrap();
    w.bool(true).unwrap();
    w.bool(false).unwrap();
    w.end_array().unwrap();
    w.key("numbers").unwrap();
    w.begin_array().unwrap();
    for x in [
        333333333.33333329,
        1e30,
        4.50,
        2e-3,
        0.000000000000000000000000001,
    ] {
        w.number(x).unwrap();
    }
    w.end_array().unwrap();
    w.key("string").unwrap();
    w.string("\u{20ac}$\u{000F}\u{000a}A'\u{0042}\u{0022}\u{005c}\\\"/")
        .unwrap();
    w.end_object().unwrap();
    assert_eq!(
        w.finish().unwrap(),
        r#"{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\u000f\nA'B\"\\\\\"/"}"#
    );
}

#[test]
fn non_finite_and_misc() {
    assert_eq!(number_to_string(f64::NAN), Err(JcsError::NonFiniteNumber));
    assert_eq!(
        number_to_string(-f64::INFINITY),
        Err(JcsError::NonFiniteNumber)
    );
    assert_eq!(string_to_json("\u{1}"), "\"\\u0001\"");
    assert_eq!(
        sha256_hex(b"{}"),
        "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a"
    );
}
