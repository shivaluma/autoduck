//! D6 gate: `cargo test -p race-core --features ts-compat --test collate`.
//!
//! Fixtures come from `scripts/oracle/collation-table.ts` (Node's
//! `localeCompare`). The 1M pair stream is regenerated here with the
//! `collate-gen-v1` generator, which must stay in lockstep with `genPair` /
//! `genFormat` in that script; the sha256 in the fixture header proves both
//! sides built the same stream.

use core::cmp::Ordering;

use race_core::collate_compat::{
    MAX_ID_LEN, byte_order, is_id_byte, is_valid_client_action_id, is_valid_id,
};

const ALPHABET: &str = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_:-";

#[test]
fn byte_order_is_str_ord() {
    assert_eq!(byte_order("a", "b"), Ordering::Less);
    assert_eq!(byte_order("B", "a"), Ordering::Less);
    assert_eq!(byte_order("_", "0"), Ordering::Greater);
    assert_eq!(byte_order(":", "0"), Ordering::Greater);
    assert_eq!(byte_order("-", "0"), Ordering::Less);
    assert_eq!(byte_order("p1", "p1"), Ordering::Equal);
    assert_eq!(byte_order("ab", "abc"), Ordering::Less);
}

#[test]
fn id_validation() {
    for byte in 0u8..=255 {
        let expected = byte.is_ascii_digit()
            || byte.is_ascii_lowercase()
            || byte.is_ascii_uppercase()
            || matches!(byte, b'_' | b':' | b'-');
        assert_eq!(is_id_byte(byte), expected, "byte {byte:#04x}");
    }
    assert_eq!(ALPHABET.len(), 65);
    assert!(ALPHABET.bytes().all(is_id_byte));
    assert!(is_valid_id(&ALPHABET[1..]));
    assert!(!is_valid_id(ALPHABET), "65 characters");
    for id in [
        "0",
        "42",
        "duck-7",
        "P1",
        "prep:BANANA",
        "wild:MAGNET",
        "wild:123:gold:pickup-zone-12:z12-a5:999999",
        "hazard:pickup-zone-1:z1-a1:3",
        "__ghost__",
    ] {
        assert!(is_valid_id(id), "{id}");
    }
    let max = "a".repeat(MAX_ID_LEN);
    assert!(is_valid_id(&max));
    for id in ["", " ", "a b", "a.b", "a/b", "ä", "duck#1", "x\n"] {
        assert!(!is_valid_id(id), "{id:?}");
    }
    assert!(!is_valid_id(&"a".repeat(MAX_ID_LEN + 1)));

    assert!(is_valid_client_action_id(
        "0b4f2c1e-7a3d-4e8f-9c21-5d6e7f8a9b0c"
    ));
    assert!(is_valid_client_action_id("abcdefgh"));
    assert!(!is_valid_client_action_id("abcdefg"));
    assert!(!is_valid_client_action_id(&"f".repeat(MAX_ID_LEN + 1)));
    assert!(!is_valid_client_action_id("0b4f2c1e 7a3d"));
}

#[cfg(feature = "ts-compat")]
mod icu {
    use core::cmp::Ordering;
    use std::fmt::Write as _;
    use std::path::PathBuf;

    use race_core::collate_compat::{ICU_ORDER, compare, is_valid_id};
    use sha2::{Digest, Sha256};

    use super::ALPHABET;

    fn fixture(name: &str) -> Vec<u8> {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures")
            .join(name);
        std::fs::read(&path).unwrap_or_else(|error| {
            panic!(
                "{}: {error}; run `node --import tsx scripts/oracle/collation-table.ts`",
                path.display()
            )
        })
    }

    #[test]
    fn spot_checks() {
        use Ordering::{Equal, Greater, Less};
        let cases = [
            ("a", "A", Less),
            ("aB", "Ab", Less),
            ("A", "ab", Less),
            ("ab", "Ab", Less),
            ("A", "b", Less),
            ("_", "-", Less),
            ("-", ":", Less),
            (":", "0", Less),
            ("9", "a", Less),
            ("a", "a-", Less),
            ("a-", "a0", Less),
            ("p1", "P1", Less),
            ("p10", "p2", Less),
            ("abc", "ab", Greater),
            ("prep:BANANA", "prep_BANANA", Greater),
            ("duck-10", "duck-9", Less),
            ("10", "9", Less),
            ("z1-a1", "z1_a1", Greater),
            ("same", "same", Equal),
        ];
        for (a, b, expected) in cases {
            assert_eq!(compare(a, b), expected, "{a:?} vs {b:?}");
            assert_eq!(compare(b, a), expected.reverse(), "{b:?} vs {a:?}");
        }
        assert_eq!(
            ICU_ORDER,
            "_-:0123456789aAbBcCdDeEfFgGhHiIjJkKlLmMnNoOpPqQrRsStTuUvVwWxXyYzZ"
        );
    }

    #[test]
    fn out_of_alphabet_is_total_and_after_ids() {
        assert_eq!(compare("a", "a."), Ordering::Less);
        assert_eq!(compare("z", "."), Ordering::Less);
        assert_eq!(compare(".", "/"), Ordering::Less);
        assert_eq!(compare("a.", "a."), Ordering::Equal);
        assert_eq!(compare("\u{e4}", "\u{e5}"), Ordering::Less);
    }

    /// Every id of length <= 2, in Node's `localeCompare` order.
    #[test]
    fn short_ids_match_node_sort() {
        let text = String::from_utf8(fixture("collate-short.txt")).expect("utf-8");
        let node: Vec<&str> = text.lines().collect();
        let n = ALPHABET.len();
        assert_eq!(
            node.len(),
            n + n * n,
            "fixture must list every id of length <= 2"
        );
        for pair in node.windows(2) {
            assert_eq!(
                compare(pair[0], pair[1]),
                Ordering::Less,
                "{:?} !< {:?}",
                pair[0],
                pair[1]
            );
        }
        let mut ours = node.clone();
        ours.reverse();
        ours.sort_by(|a, b| compare(a, b));
        assert_eq!(ours, node);
    }

    // ------------------------------------------------------------------
    // collate-gen-v1 (mirror of scripts/oracle/collation-table.ts)

    const DIGITS: &[u8] = b"0123456789";
    const NONZERO: &[u8] = b"123456789";
    const HEX: &[u8] = b"0123456789abcdef";
    const SMALL: &[u8] = b"aAbB0_:-";
    const PREP_ITEMS: &[&str] = &[
        "NITRO",
        "DRAFT_FIN",
        "PADDLE_BURST",
        "BUBBLE_SHIELD",
        "FEATHER",
        "SHOCK_ABSORBER",
        "HOMING_ROCKET",
        "BANANA",
        "QUACK_HORN",
    ];
    const WILD_ITEMS: &[&str] = &[
        "MINI_NITRO",
        "TAILWIND",
        "MINI_BUBBLE",
        "MINI_ROCKET",
        "BANANA",
        "QUACK_HORN",
        "FEATHER",
        "SLIPSTREAM_MAGNET",
        "MAGNET",
    ];
    const MISC: &[&str] = &[
        "ghost",
        "GHOST",
        "Ghost",
        "ghost-duck",
        "__ghost__",
        "king",
        "KING",
        "race-lab-1",
        "P",
        "p",
        "_",
        "-",
        ":",
        "0",
    ];
    const FORMAT_COUNT: u32 = 12;
    const MAX_LEN: u32 = 64;

    struct XorShift32(u32);

    impl XorShift32 {
        fn next(&mut self) -> u32 {
            let mut x = self.0;
            x ^= x << 13;
            x ^= x >> 17;
            x ^= x << 5;
            self.0 = x;
            x
        }

        fn below(&mut self, n: u32) -> u32 {
            self.next() % n
        }

        fn index(&mut self, len: usize) -> usize {
            let n = u32::try_from(len).expect("small collection");
            usize::try_from(self.below(n)).expect("u32 fits usize")
        }

        fn byte(&mut self, set: &[u8]) -> u8 {
            set[self.index(set.len())]
        }

        fn item<'a>(&mut self, set: &[&'a str]) -> &'a str {
            set[self.index(set.len())]
        }
    }

    fn gen_user_id(rng: &mut XorShift32) -> String {
        let len = 1 + rng.below(9);
        let mut out = String::new();
        out.push(char::from(rng.byte(NONZERO)));
        for _ in 1..len {
            out.push(char::from(rng.byte(DIGITS)));
        }
        out
    }

    fn gen_pickup_id(rng: &mut XorShift32) -> String {
        let kind = if rng.below(2) == 0 { "box" } else { "gold" };
        let zone = 1 + rng.below(12);
        let anchor = 1 + rng.below(5);
        format!("{kind}:pickup-zone-{zone}:z{zone}-a{anchor}")
    }

    fn gen_random(rng: &mut XorShift32, set: &[u8], max_len: u32) -> String {
        let len = 1 + rng.below(max_len);
        (0..len).map(|_| char::from(rng.byte(set))).collect()
    }

    fn gen_format(rng: &mut XorShift32, format: u32) -> String {
        match format {
            0 => gen_user_id(rng),
            1 => format!("duck-{}", 1 + rng.below(999)),
            2 => {
                let p = if rng.below(2) == 0 { 'p' } else { 'P' };
                format!("{p}{}", 1 + rng.below(99))
            }
            3 => format!("prep:{}", rng.item(PREP_ITEMS)),
            4 => format!("wild:{}", rng.item(WILD_ITEMS)),
            5 => {
                let race = gen_user_id(rng);
                let pickup = gen_pickup_id(rng);
                let player = gen_user_id(rng);
                format!("wild:{race}:{pickup}:{player}")
            }
            6 => {
                let zone = 1 + rng.below(12);
                let anchor = 1 + rng.below(5);
                let k = 1 + rng.below(3);
                format!("hazard:pickup-zone-{zone}:z{zone}-a{anchor}:{k}")
            }
            7 => {
                let mut out = String::new();
                for len in [8, 4, 4, 4, 12] {
                    if !out.is_empty() {
                        out.push('-');
                    }
                    for _ in 0..len {
                        out.push(char::from(rng.byte(HEX)));
                    }
                }
                out
            }
            8 => gen_random(rng, ALPHABET.as_bytes(), MAX_LEN),
            9 => gen_random(rng, SMALL, 8),
            10 => {
                let variant = rng.below(3);
                let n = 1 + rng.below(12);
                let m = 1 + rng.below(5);
                match variant {
                    0 => format!("z{n}-a{m}"),
                    1 => format!("pickup-zone-{n}"),
                    _ => format!("gate-{n}-lane-{m}"),
                }
            }
            _ => rng.item(MISC).to_owned(),
        }
    }

    fn flip_case(byte: u8) -> u8 {
        if byte.is_ascii_lowercase() {
            byte.to_ascii_uppercase()
        } else {
            byte.to_ascii_lowercase()
        }
    }

    fn gen_pair(rng: &mut XorShift32) -> (String, String) {
        let alphabet = ALPHABET.as_bytes();
        let format = rng.below(FORMAT_COUNT);
        let a = gen_format(rng, format);
        let mut chars = a.clone().into_bytes();
        let len = chars.len();
        let max_len = usize::try_from(MAX_LEN).expect("fits");
        let b = match rng.below(9) {
            0 => gen_format(rng, format),
            1 => {
                let other = rng.below(FORMAT_COUNT);
                gen_format(rng, other)
            }
            2 => {
                let at = rng.index(len);
                chars[at] = rng.byte(alphabet);
                String::from_utf8(chars).expect("ascii")
            }
            3 => {
                for byte in &mut chars {
                    if byte.is_ascii_alphabetic() && rng.below(2) == 1 {
                        *byte = flip_case(*byte);
                    }
                }
                String::from_utf8(chars).expect("ascii")
            }
            4 => {
                if len > 1 {
                    let keep = 1 + rng.index(len - 1);
                    a[..keep].to_owned()
                } else {
                    let mut b = a.clone();
                    b.push(char::from(rng.byte(alphabet)));
                    b
                }
            }
            5 => {
                if len < max_len {
                    let extra = 1 + rng.index((max_len - len).min(3));
                    let mut b = a.clone();
                    for _ in 0..extra {
                        b.push(char::from(rng.byte(alphabet)));
                    }
                    b
                } else {
                    chars[len - 1] = rng.byte(alphabet);
                    String::from_utf8(chars).expect("ascii")
                }
            }
            6 => {
                if len < max_len {
                    let at = rng.index(len + 1);
                    let byte = rng.byte(alphabet);
                    chars.insert(at, byte);
                } else {
                    let at = rng.index(len);
                    chars[at] = rng.byte(alphabet);
                }
                String::from_utf8(chars).expect("ascii")
            }
            7 => a.clone(),
            _ => {
                let flip = rng.index(len);
                chars[flip] = if chars[flip].is_ascii_alphabetic() {
                    flip_case(chars[flip])
                } else {
                    rng.byte(alphabet)
                };
                let at = rng.index(len);
                chars[at] = rng.byte(alphabet);
                String::from_utf8(chars).expect("ascii")
            }
        };
        if rng.below(2) == 1 { (b, a) } else { (a, b) }
    }

    fn code(order: Ordering) -> u8 {
        match order {
            Ordering::Equal => 0,
            Ordering::Less => 1,
            Ordering::Greater => 2,
        }
    }

    /// The D6 gate: 1M generated id pairs, 100% sign-equal to Node's
    /// `localeCompare`.
    #[test]
    fn million_pairs_match_node_locale_compare() {
        let data = fixture("collate-pairs.bin");
        assert!(data.len() >= 48, "fixture header");
        assert_eq!(&data[..8], b"COLLATE1", "fixture magic");
        let seed = u32::from_le_bytes(data[8..12].try_into().expect("4 bytes"));
        let count = u32::from_le_bytes(data[12..16].try_into().expect("4 bytes"));
        let expected_sha = &data[16..48];
        let signs = &data[48..];
        let count_usize = usize::try_from(count).expect("fits");
        assert_eq!(signs.len(), count_usize.div_ceil(4), "packed sign length");
        assert!(
            count >= 1_000_000,
            "gate needs >= 1M pairs, fixture has {count}"
        );

        let mut rng = XorShift32(seed);
        let mut hasher = Sha256::new();
        let mut matched = 0usize;
        let mut byte_order_matched = 0usize;
        let mut invalid = 0usize;
        let mut report = String::new();
        let mut mismatches = 0usize;
        for index in 0..count_usize {
            let (a, b) = gen_pair(&mut rng);
            hasher.update(a.as_bytes());
            hasher.update(b"\n");
            hasher.update(b.as_bytes());
            hasher.update(b"\n");
            invalid += usize::from(!is_valid_id(&a)) + usize::from(!is_valid_id(&b));
            let node = (signs[index / 4] >> ((index % 4) * 2)) & 3;
            let ours = code(compare(&a, &b));
            if ours == node {
                matched += 1;
            } else {
                mismatches += 1;
                if mismatches <= 20 {
                    writeln!(
                        report,
                        "  #{index}: {a:?} vs {b:?}: node={node} rust={ours}"
                    )
                    .expect("write to String");
                }
            }
            byte_order_matched += usize::from(code(a.as_str().cmp(b.as_str())) == node);
        }
        let sha = hasher.finalize();
        assert_eq!(
            sha.as_slice(),
            expected_sha,
            "pair stream differs from the Node generator (collate-gen-v1 out of sync)"
        );
        assert_eq!(invalid, 0, "generator produced ids outside the D6 rule");

        #[allow(clippy::cast_precision_loss)]
        let rate = |n: usize| n as f64 * 100.0 / count as f64;
        println!(
            "collate: {matched}/{count} pairs sign-equal to Node localeCompare ({:.4}%); \
             byte order agrees on {byte_order_matched} ({:.2}%)",
            rate(matched),
            rate(byte_order_matched)
        );
        assert_eq!(
            mismatches, 0,
            "{mismatches} of {count} pairs differ from Node:\n{report}"
        );
    }
}
