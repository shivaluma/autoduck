//! The Season 3 race-day gate (`lib/season3-schedule.ts`): official races start only on Monday,
//! Vietnam time (UTC+7, no DST).

use std::fmt;
use std::time::{SystemTime, UNIX_EPOCH};

const VIETNAM_OFFSET_MS: i64 = 7 * 60 * 60 * 1000;
const DAY_MS: i64 = 86_400_000;
/// ECMAScript's time-value limit: `new Date(t)` is an Invalid Date beyond ±8.64e15 ms.
const MAX_TIME_MS: i64 = 8_640_000_000_000_000;

/// `Season3ScheduleError` (the admin route answers it with 403).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Season3ScheduleError;

impl fmt::Display for Season3ScheduleError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Giải đua Season 3 chỉ mở vào THỨ HAI hàng tuần (giờ Việt Nam)! 🦆")
    }
}

impl std::error::Error for Season3ScheduleError {}

/// `isVietnamMonday(new Date(epochMs))`. Outside the ECMAScript date range the shifted date is
/// invalid, `getUTCDay()` is NaN, and the answer is `false`.
#[must_use]
pub fn is_vietnam_monday(epoch_ms: i64) -> bool {
    let Some(shifted) = epoch_ms.checked_add(VIETNAM_OFFSET_MS) else {
        return false;
    };
    if !(-MAX_TIME_MS..=MAX_TIME_MS).contains(&epoch_ms)
        || !(-MAX_TIME_MS..=MAX_TIME_MS).contains(&shifted)
    {
        return false;
    }
    // 1970-01-01 was a Thursday (4); Monday is 1.
    (shifted.div_euclid(DAY_MS) + 4).rem_euclid(7) == 1
}

/// Wall-clock milliseconds since the epoch (`Date.now()`).
#[must_use]
pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| {
            i64::try_from(elapsed.as_millis()).unwrap_or(i64::MAX)
        })
}

/// `assertSeason3RaceDay(new Date(epochMs))`.
///
/// # Errors
/// [`Season3ScheduleError`] unless it is Monday in Vietnam.
pub fn assert_season3_race_day(epoch_ms: i64) -> Result<(), Season3ScheduleError> {
    if is_vietnam_monday(epoch_ms) {
        Ok(())
    } else {
        Err(Season3ScheduleError)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn monday_boundaries_in_vietnam() {
        // Monday 2026-08-10 00:00 ICT is Sunday 17:00 UTC.
        let monday_start = 1_786_294_800_000;
        assert!(!is_vietnam_monday(monday_start - 1));
        assert!(is_vietnam_monday(monday_start));
        assert!(is_vietnam_monday(monday_start + DAY_MS - 1));
        assert!(!is_vietnam_monday(monday_start + DAY_MS));
        // Outside the ECMAScript date range: Invalid Date, never Monday.
        assert!(!is_vietnam_monday(MAX_TIME_MS));
        assert!(!is_vietnam_monday(i64::MAX));
        assert!(!is_vietnam_monday(i64::MIN));
    }
}
