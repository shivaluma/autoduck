//! `lib/season3-test-mode.ts`: test races run during prep without claiming or mutating the
//! official week.

/// `canStartSeason3TestRace(status)`: prep is `open` or `locked`.
#[must_use]
pub fn can_start_test_race(status: &str) -> bool {
    status == "open" || status == "locked"
}

/// `getSeason3RaceMode(testMode)`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RaceMode {
    pub claims_official_week: bool,
    pub mutates_season: bool,
}

/// `getSeason3RaceMode(testMode)`.
#[must_use]
pub fn race_mode(test_mode: bool) -> RaceMode {
    RaceMode {
        claims_official_week: !test_mode,
        mutates_season: !test_mode,
    }
}
