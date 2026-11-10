//! `generateDuckNews` (`lib/season3.ts`) and the QP lines `executeSeason3Race` appends to the
//! weekly recap.

use crate::auth::js_trim;
use crate::cosmetics::economy::{QuackReason, QuackReward};

use super::cards::{ChaosType, chaos_label};

/// `generateDuckNews(args)` input. `None` and `Some("")` both mean "no name" (JS falsy).
#[derive(Clone, Copy, Debug)]
pub struct DuckNewsInput<'a> {
    pub week_number: i64,
    pub scar_victims: &'a [&'a str],
    pub protected_players: &'a [&'a str],
    pub chaos_type: ChaosType,
    pub chaos_target_name: Option<&'a str>,
    pub king_name: Option<&'a str>,
    pub prediction_winners: &'a [&'a str],
}

/// `generateDuckNews(args)`: four paragraphs joined by a blank line; empty ones are dropped.
#[must_use]
pub fn generate_duck_news(input: &DuckNewsInput<'_>) -> String {
    let victims = if input.scar_victims.is_empty() {
        "Nobody".to_owned()
    } else {
        input.scar_victims.join(" & ")
    };
    let protected_text = if input.protected_players.is_empty() {
        String::new()
    } else {
        let lines: Vec<String> = input
            .protected_players
            .iter()
            .map(|name| format!("{name} mất Shield để không bị làm dzịt."))
            .collect();
        format!(" {}", lines.join(" "))
    };
    let prediction_text = if input.prediction_winners.is_empty() {
        String::new()
    } else {
        format!(
            " {} prediction chính xác!",
            input.prediction_winners.join(" & ")
        )
    };
    let king_text = match input.king_name {
        Some(name) if !name.is_empty() => format!(" {name} chiếm ngôi King of the Pond."),
        _ => String::new(),
    };
    let target_text = match input.chaos_target_name {
        Some(name) if !name.is_empty() => format!(" — {name}"),
        _ => String::new(),
    };
    let tail = format!("{king_text}{protected_text}{prediction_text}");
    let parts = [
        format!("📰 DUCK NEWS — WEEK {}", input.week_number),
        format!("☠️ {victims} got ducked."),
        format!("{}{target_text}.", chaos_label(input.chaos_type)),
        js_trim(&tail).to_owned(),
    ];
    parts
        .iter()
        .filter(|part| !part.is_empty())
        .map(String::as_str)
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// One recap line per QP reward (`executeSeason3Race`):
/// `<label> — <name or "User N"> +<amount> QP`.
#[must_use]
pub fn quack_reward_line(reward: &QuackReward, player_name: Option<&str>) -> String {
    let label = match reward.reason {
        QuackReason::RaceWin => "🏆 Race Winner",
        QuackReason::PredictionWin => "🔮 Correct Prediction",
        QuackReason::PerfectWeek => "🎰 PERFECT WEEK",
    };
    let name = player_name.map_or_else(|| format!("User {}", reward.player_id), str::to_owned);
    format!("{label} — {name} +{} QP", reward.amount)
}

/// The Golden Quack Box recap line; test races say `(test)` instead of granting QP.
#[must_use]
pub fn golden_box_line(player_name: &str, is_test: bool) -> String {
    format!(
        "🪙 Golden Quack Box — {player_name}{}",
        if is_test { " (test)" } else { " +1 QP" }
    )
}

/// `Race.finalVerdict` after resolve.
#[must_use]
pub fn final_verdict(scar_victim_names: &[&str]) -> String {
    if scar_victim_names.is_empty() {
        return "Khiên đã cứu hết người bị phạt.".to_owned();
    }
    scar_victim_names
        .iter()
        .map(|name| format!("{name} bị làm dzịt"))
        .collect::<Vec<_>>()
        .join(" & ")
}
