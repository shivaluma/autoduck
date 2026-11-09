//! [`DbTime`]: the only way server code reads or writes a `DATETIME` column (D13).
//!
//! sqlx is built without `chrono`/`time`, so a `DATETIME` column can only be decoded as `String`
//! or `DbTime`; the compiler enforces the format rules below.
//!
//! - **Encode:** exactly `%Y-%m-%dT%H:%M:%S%.3f+00:00`, the format the Prisma 7 better-sqlite3
//!   adapter writes (verified in `dev.db`). The TS rollback image must read what Rust writes, and
//!   a `T` timestamp must sort with the existing rows (a space-separated value on the same day
//!   sorts before every `T` value).
//! - **Decode:** that format, any RFC 3339 variant (`…Z`, other offsets, 0–9 fraction digits),
//!   SQLite's `YYYY-MM-DD HH:MM:SS[.fff]` (`CURRENT_TIMESTAMP` defaults, always UTC) and epoch
//!   milliseconds (an `INTEGER` value or an all-digit text, as older Prisma engines stored them).
//! - **JSON:** serialises like a JS `Date` (`toISOString()`, `…Z`), which is what the TS routes
//!   send for every `DateTime` field.
//! - **Anything else** (`'yesterday'`, a fractional epoch `1700000000.5`) is a decode error, so
//!   the route answers 500 where Prisma would yield `null` or an odd date. No writer (Prisma,
//!   SQLite defaults, Rust) produces such values; review 3, finding 6 accepted this.

use std::fmt;
use std::time::{SystemTime, UNIX_EPOCH};

use sqlx::error::BoxDynError;
use sqlx::sqlite::{Sqlite, SqliteTypeInfo, SqliteValueRef};
use sqlx::{Decode, Encode, Type, TypeInfo, ValueRef, encode::IsNull};

const MS_PER_DAY: i64 = 86_400_000;
/// 0000-01-01T00:00:00.000Z
const MIN_MS: i64 = -62_167_219_200_000;
/// 9999-12-31T23:59:59.999Z
const MAX_MS: i64 = 253_402_300_799_999;

/// A UTC instant with millisecond precision, stored as Unix epoch milliseconds.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct DbTime(i64);

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
#[error("invalid DATETIME value {value:?}: {reason}")]
pub struct DbTimeError {
    pub value: String,
    pub reason: &'static str,
}

impl DbTime {
    /// `None` outside years 0000–9999 (the 4-digit range the stored format can express).
    pub fn from_unix_ms(ms: i64) -> Option<Self> {
        (MIN_MS..=MAX_MS).contains(&ms).then_some(DbTime(ms))
    }

    pub fn unix_ms(self) -> i64 {
        self.0
    }

    pub fn now() -> Self {
        let ms = match SystemTime::now().duration_since(UNIX_EPOCH) {
            Ok(elapsed) => i64::try_from(elapsed.as_millis()).unwrap_or(MAX_MS),
            Err(before) => -i64::try_from(before.duration().as_millis()).unwrap_or(-MIN_MS),
        };
        DbTime(ms.clamp(MIN_MS, MAX_MS))
    }

    /// The stored form: `2026-02-09T16:45:13.861+00:00`.
    pub fn to_db_string(self) -> String {
        self.format("+00:00")
    }

    /// JS `Date#toISOString()`: `2026-02-09T16:45:13.861Z`.
    pub fn to_iso_string(self) -> String {
        self.format("Z")
    }

    fn format(self, suffix: &str) -> String {
        let days = self.0.div_euclid(MS_PER_DAY);
        let ms_of_day = self.0.rem_euclid(MS_PER_DAY);
        let (year, month, day) = civil_from_days(days);
        let hour = ms_of_day / 3_600_000;
        let minute = ms_of_day / 60_000 % 60;
        let second = ms_of_day / 1000 % 60;
        let milli = ms_of_day % 1000;
        format!(
            "{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{milli:03}{suffix}"
        )
    }

    /// Parses every stored form listed in the module docs.
    pub fn parse(value: &str) -> Result<Self, DbTimeError> {
        let fail = |reason| DbTimeError {
            value: value.to_owned(),
            reason,
        };
        let text = value.trim();
        if text.is_empty() {
            return Err(fail("empty"));
        }

        let digits = text.strip_prefix('-').unwrap_or(text);
        if !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit()) {
            let ms: i64 = text
                .parse()
                .map_err(|_| fail("epoch milliseconds out of range"))?;
            return DbTime::from_unix_ms(ms).ok_or_else(|| fail("epoch milliseconds out of range"));
        }

        let bytes = text.as_bytes();
        if bytes.len() < 19 {
            return Err(fail("too short"));
        }
        let year = fixed_digits(&bytes[0..4]).ok_or_else(|| fail("bad year"))?;
        let month = fixed_digits(&bytes[5..7]).ok_or_else(|| fail("bad month"))?;
        let day = fixed_digits(&bytes[8..10]).ok_or_else(|| fail("bad day"))?;
        let hour = fixed_digits(&bytes[11..13]).ok_or_else(|| fail("bad hour"))?;
        let minute = fixed_digits(&bytes[14..16]).ok_or_else(|| fail("bad minute"))?;
        let second = fixed_digits(&bytes[17..19]).ok_or_else(|| fail("bad second"))?;
        if bytes[4] != b'-' || bytes[7] != b'-' || bytes[13] != b':' || bytes[16] != b':' {
            return Err(fail("bad separators"));
        }
        if !matches!(bytes[10], b'T' | b't' | b' ') {
            return Err(fail("expected T or a space between date and time"));
        }
        if !(1..=12).contains(&month) {
            return Err(fail("month out of range"));
        }
        if day < 1 || day > days_in_month(year, month) {
            return Err(fail("day out of range"));
        }
        if hour > 23 || minute > 59 || second > 59 {
            return Err(fail("time out of range"));
        }

        let mut rest = &bytes[19..];
        let mut milli = 0i64;
        if let Some((b'.', tail)) = rest.split_first() {
            let count = tail.iter().take_while(|b| b.is_ascii_digit()).count();
            if count == 0 || count > 9 {
                return Err(fail("bad fraction"));
            }
            // Truncate to milliseconds; pad short fractions ("5" = 500 ms).
            for position in 0..3 {
                let digit = tail.get(position).filter(|_| position < count);
                milli = milli * 10 + digit.map_or(0, |d| i64::from(d - b'0'));
            }
            rest = &tail[count..];
        }

        let offset_minutes: i64 = match rest {
            [] | [b'Z'] | [b'z'] => 0,
            [sign @ (b'+' | b'-'), h1, h2, b':', m1, m2]
            | [sign @ (b'+' | b'-'), h1, h2, m1, m2] => {
                let hours = fixed_digits(&[*h1, *h2]).ok_or_else(|| fail("bad offset"))?;
                let minutes = fixed_digits(&[*m1, *m2]).ok_or_else(|| fail("bad offset"))?;
                if hours > 23 || minutes > 59 {
                    return Err(fail("offset out of range"));
                }
                let total = hours * 60 + minutes;
                if *sign == b'-' { -total } else { total }
            }
            _ => return Err(fail("unexpected trailing characters")),
        };

        let days = days_from_civil(year, month, day);
        let ms = days * MS_PER_DAY + hour * 3_600_000 + minute * 60_000 + second * 1000 + milli
            - offset_minutes * 60_000;
        DbTime::from_unix_ms(ms).ok_or_else(|| fail("outside years 0000-9999"))
    }
}

impl fmt::Display for DbTime {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.to_db_string())
    }
}

impl serde::Serialize for DbTime {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_iso_string())
    }
}

impl Type<Sqlite> for DbTime {
    fn type_info() -> SqliteTypeInfo {
        <String as Type<Sqlite>>::type_info()
    }

    fn compatible(ty: &SqliteTypeInfo) -> bool {
        matches!(
            ty.name(),
            "TEXT" | "DATETIME" | "INTEGER" | "NUMERIC" | "DATE"
        )
    }
}

impl<'r> Decode<'r, Sqlite> for DbTime {
    fn decode(value: SqliteValueRef<'r>) -> Result<Self, BoxDynError> {
        let is_integer = value.type_info().name() == "INTEGER";
        if is_integer {
            let ms = <i64 as Decode<Sqlite>>::decode(value)?;
            return DbTime::from_unix_ms(ms).ok_or_else(|| {
                Box::new(DbTimeError {
                    value: ms.to_string(),
                    reason: "epoch milliseconds out of range",
                }) as BoxDynError
            });
        }
        let text = <&str as Decode<Sqlite>>::decode(value)?;
        Ok(DbTime::parse(text)?)
    }
}

impl Encode<'_, Sqlite> for DbTime {
    fn encode_by_ref(
        &self,
        buf: &mut <Sqlite as sqlx::Database>::ArgumentBuffer,
    ) -> Result<IsNull, BoxDynError> {
        <String as Encode<Sqlite>>::encode(self.to_db_string(), buf)
    }
}

fn fixed_digits(bytes: &[u8]) -> Option<i64> {
    bytes.iter().try_fold(0i64, |acc, b| {
        b.is_ascii_digit().then(|| acc * 10 + i64::from(b - b'0'))
    })
}

fn is_leap(year: i64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

fn days_in_month(year: i64, month: i64) -> i64 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if is_leap(year) => 29,
        _ => 28,
    }
}

/// Days since 1970-01-01 for a proleptic Gregorian date (H. Hinnant's algorithm).
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let year_of_era = year - era * 400;
    let month_index = (month + 9) % 12;
    let day_of_year = (153 * month_index + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let shifted = days + 719_468;
    let era = shifted.div_euclid(146_097);
    let day_of_era = shifted - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 {
        month_index + 3
    } else {
        month_index - 9
    };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// xorshift64*: deterministic inputs for the property loops (no extra crates).
    struct Rng(u64);
    impl Rng {
        fn next(&mut self) -> u64 {
            self.0 ^= self.0 >> 12;
            self.0 ^= self.0 << 25;
            self.0 ^= self.0 >> 27;
            self.0.wrapping_mul(0x2545_f491_4f6c_dd1d)
        }
        fn ms(&mut self) -> i64 {
            let span = u64::try_from(MAX_MS - MIN_MS + 1).unwrap();
            MIN_MS + i64::try_from(self.next() % span).unwrap()
        }
    }

    #[test]
    fn known_values_from_dev_db() {
        // The two shapes found by scanning every DATETIME column of dev.db (Prisma text, and
        // SQLite CURRENT_TIMESTAMP in AppMigration.runAt and Shield.earnedAt).
        let prisma = DbTime::parse("2026-02-09T16:45:13.861+00:00").unwrap();
        assert_eq!(prisma.unix_ms(), 1_770_655_513_861);
        assert_eq!(prisma.to_db_string(), "2026-02-09T16:45:13.861+00:00");
        assert_eq!(prisma.to_iso_string(), "2026-02-09T16:45:13.861Z");

        let sqlite = DbTime::parse("2026-04-23 08:12:19").unwrap();
        assert_eq!(sqlite.to_db_string(), "2026-04-23T08:12:19.000+00:00");
        assert_eq!(DbTime::parse("2026-04-23T08:12:19.000Z").unwrap(), sqlite);
        assert_eq!(DbTime::parse("1776931939000").unwrap(), sqlite);
        assert_eq!(DbTime::parse("2026-04-23T15:12:19+07:00").unwrap(), sqlite);
        assert_eq!(DbTime::parse("2026-04-23T01:42:19-0630").unwrap(), sqlite);
    }

    #[test]
    fn epoch_and_edges() {
        assert_eq!(
            DbTime::parse("0").unwrap().to_db_string(),
            "1970-01-01T00:00:00.000+00:00"
        );
        assert_eq!(
            DbTime::parse("-1").unwrap().to_db_string(),
            "1969-12-31T23:59:59.999+00:00"
        );
        assert_eq!(
            DbTime::from_unix_ms(MIN_MS).unwrap().to_db_string(),
            "0000-01-01T00:00:00.000+00:00"
        );
        assert_eq!(
            DbTime::from_unix_ms(MAX_MS).unwrap().to_db_string(),
            "9999-12-31T23:59:59.999+00:00"
        );
        assert!(DbTime::from_unix_ms(MAX_MS + 1).is_none());
        assert!(DbTime::from_unix_ms(MIN_MS - 1).is_none());
        assert_eq!(
            DbTime::parse("2024-02-29T00:00:00Z")
                .unwrap()
                .to_db_string(),
            "2024-02-29T00:00:00.000+00:00"
        );
        assert_eq!(
            DbTime::parse("2026-01-01T00:00:00.5Z").unwrap().unix_ms() % 1000,
            500
        );
        assert_eq!(
            DbTime::parse("2026-01-01T00:00:00.123456789Z")
                .unwrap()
                .unix_ms()
                % 1000,
            123
        );
    }

    #[test]
    fn rejects_garbage() {
        for bad in [
            "",
            "   ",
            "-",
            "2026-02-30T00:00:00Z",
            "2023-02-29 00:00:00",
            "2026-13-01 00:00:00",
            "2026-01-01X00:00:00",
            "2026-01-01T24:00:00Z",
            "2026-01-01T00:60:00Z",
            "2026-01-01T00:00:60Z",
            "2026-01-01T00:00:00.Z",
            "2026-01-01T00:00:00+0",
            "2026-01-01T00:00:00 UTC",
            "2026-01-01T00:00:00.1234567890Z",
            "99999999999999999999",
            "2026-1-01 00:00:00",
            "２０２６-01-01 00:00:00",
        ] {
            assert!(DbTime::parse(bad).is_err(), "accepted {bad:?}");
        }
    }

    #[test]
    fn property_round_trips_every_format() {
        let mut rng = Rng(0x9e37_79b9_7f4a_7c15);
        for _ in 0..200_000 {
            let t = DbTime(rng.ms());
            let stored = t.to_db_string();
            assert_eq!(stored.len(), 29, "{stored}");
            assert_eq!(DbTime::parse(&stored), Ok(t), "{stored}");
            assert_eq!(DbTime::parse(&t.to_iso_string()), Ok(t));
            assert_eq!(DbTime::parse(&t.unix_ms().to_string()), Ok(t));
            // SQLite CURRENT_TIMESTAMP form drops the milliseconds.
            let seconds = DbTime(t.0 - t.0.rem_euclid(1000));
            let space = format!("{} {}", &stored[..10], &stored[11..19]);
            assert_eq!(DbTime::parse(&space), Ok(seconds), "{space}");
            assert_eq!(
                DbTime::parse(&format!("{space}.{:03}", t.0.rem_euclid(1000))),
                Ok(t)
            );
        }
    }

    #[test]
    fn property_civil_conversion_is_a_bijection() {
        for days in days_from_civil(0, 1, 1)..=days_from_civil(9999, 12, 31) {
            let (y, m, d) = civil_from_days(days);
            assert!((1..=12).contains(&m) && d >= 1 && d <= days_in_month(y, m));
            assert_eq!(days_from_civil(y, m, d), days);
        }
    }

    #[test]
    fn property_encoding_sorts_like_time() {
        let mut rng = Rng(42);
        for _ in 0..100_000 {
            let (a, b) = (DbTime(rng.ms()), DbTime(rng.ms()));
            assert_eq!(a.cmp(&b), a.to_db_string().cmp(&b.to_db_string()));
        }
    }

    #[test]
    fn json_matches_js_date() {
        let t = DbTime::parse("2026-02-09T16:45:13.861+00:00").unwrap();
        assert_eq!(
            serde_json::to_string(&t).unwrap(),
            "\"2026-02-09T16:45:13.861Z\""
        );
    }

    #[tokio::test]
    async fn sqlx_decodes_text_integer_and_null() {
        use sqlx::{Connection, Row, sqlite::SqliteConnection};
        let mut conn = SqliteConnection::connect("sqlite::memory:").await.unwrap();
        sqlx::raw_sql(
            r#"CREATE TABLE "T" ("id" INTEGER PRIMARY KEY, "at" DATETIME);
               INSERT INTO "T" VALUES (1, '2026-02-09T16:45:13.861+00:00'), (2, '2026-04-23 08:12:19'),
                 (3, 1776931939000), (4, NULL), (5, '1776931939000');"#,
        )
        .execute(&mut conn)
        .await
        .unwrap();
        let rows = sqlx::query(r#"SELECT "at" FROM "T" ORDER BY "id""#)
            .fetch_all(&mut conn)
            .await
            .unwrap();
        let values: Vec<Option<DbTime>> = rows.iter().map(|row| row.get(0)).collect();
        assert_eq!(
            values[0].unwrap().to_db_string(),
            "2026-02-09T16:45:13.861+00:00"
        );
        assert_eq!(values[1], values[2]);
        assert_eq!(values[2], values[4]);
        assert_eq!(values[3], None);

        let t = DbTime::parse("2026-11-09T01:02:03.004Z").unwrap();
        sqlx::query(r#"INSERT INTO "T" VALUES (6, ?)"#)
            .bind(t)
            .execute(&mut conn)
            .await
            .unwrap();
        let (stored, kind): (String, String) =
            sqlx::query_as(r#"SELECT "at", typeof("at") FROM "T" WHERE "id" = 6"#)
                .fetch_one(&mut conn)
                .await
                .unwrap();
        assert_eq!(stored, "2026-11-09T01:02:03.004+00:00");
        assert_eq!(kind, "text");
    }
}
