Corpus `g3-v1/300`: ts S3.15 (1.2.0) vs rust S3.16 (2.0.0), identical configs (seeds, lobbies, loadouts).

Unfinished races: ts 0, rust 0 (pass).

| Loadout cell | n | TS win % | Rust win % | Δ pp | ±SE | verdict (Δ within ±2 pp) |
|---|---|---|---|---|---|---|
| BUBBLE_SHIELD + BANANA | 149/149 | 15.44 | 11.41 | -4.03 | 3.94 | within noise |
| BUBBLE_SHIELD + DRAFT_FIN | 124/124 | 11.29 | 8.87 | -2.42 | 3.82 | within noise |
| BUBBLE_SHIELD + FEATHER | 148/148 | 14.19 | 18.24 | +4.05 | 4.28 | within noise |
| BUBBLE_SHIELD + PADDLE_BURST | 129/129 | 13.18 | 11.63 | -1.55 | 4.10 | pass |
| BUBBLE_SHIELD + QUACK_HORN | 131/131 | 18.32 | 14.50 | -3.82 | 4.57 | within noise |
| BUBBLE_SHIELD + SHOCK_ABSORBER | 126/126 | 11.11 | 10.32 | -0.79 | 3.90 | pass |
| HOMING_ROCKET + BANANA | 122/122 | 13.11 | 11.48 | -1.64 | 4.20 | pass |
| HOMING_ROCKET + DRAFT_FIN | 127/127 | 10.24 | 13.39 | +3.15 | 4.05 | within noise |
| HOMING_ROCKET + FEATHER | 147/147 | 10.20 | 10.20 | +0.00 | 3.53 | pass |
| HOMING_ROCKET + PADDLE_BURST | 131/131 | 11.45 | 15.27 | +3.82 | 4.20 | within noise |
| HOMING_ROCKET + QUACK_HORN | 121/121 | 13.22 | 14.88 | +1.65 | 4.47 | pass |
| HOMING_ROCKET + SHOCK_ABSORBER | 152/152 | 12.50 | 18.42 | +5.92 | 4.13 | within noise |
| NITRO + BANANA | 134/134 | 8.21 | 6.72 | -1.49 | 3.21 | pass |
| NITRO + DRAFT_FIN | 141/141 | 7.80 | 9.22 | +1.42 | 3.32 | pass |
| NITRO + FEATHER | 141/141 | 14.18 | 17.73 | +3.55 | 4.36 | within noise |
| NITRO + PADDLE_BURST | 143/143 | 9.79 | 9.09 | -0.70 | 3.46 | pass |
| NITRO + QUACK_HORN | 113/113 | 7.08 | 4.42 | -2.65 | 3.09 | within noise |
| NITRO + SHOCK_ABSORBER | 121/121 | 23.97 | 17.36 | -6.61 | 5.19 | within noise |
| SPEED | 793/793 | 11.73 | 10.84 | -0.88 | 1.59 | pass |
| DEFENSE | 807/807 | 14.00 | 12.64 | -1.36 | 1.69 | pass |
| ATTACK | 800/800 | 11.75 | 14.00 | +2.25 | 1.67 | within noise |

| Temperament | n | TS win % | Rust win % | Rust ±SE | verdict (Rust in [11.0, 13.8] %) | TS / Rust Chaos loser % |
|---|---|---|---|---|---|---|
| AGGRESSIVE | 584/593 | 12.33 | 12.14 | 1.34 | pass | 22.60 / 26.81 |
| OPPORTUNIST | 632/590 | 11.87 | 11.69 | 1.32 | pass | 27.22 / 27.80 |
| SHOWMAN | 583/604 | 12.69 | 13.91 | 1.41 | within noise | 23.67 / 22.02 |
| TACTICIAN | 601/613 | 13.14 | 12.23 | 1.32 | pass | 26.29 / 23.49 |

| Drama and pacing | TS | Rust | Δ | ±SE | verdict |
|---|---|---|---|---|---|
| lead changes per race | 4.067 | 4.067 | +0.000 | 0.211 | pass (Δ within ±0.4) |
| race duration (s) | 57.621 | 57.620 | -0.000 | 0.052 | info |
| first-to-last spread (s) | 2.539 | 2.554 | +0.015 | 0.061 | info |
| wild-item grants per race | 10.410 | 10.350 | -0.060 | 0.154 | info |
| winner finish p50 (s) | 55.082 | 55.054 | -0.028 | - | info |
| wild-item holder win % | 14.50 | 14.29 | -0.21 | 1.13 | info |

Wild-item grant share (TS → Rust): BANANA 23.8→22.2%, FEATHER 19.4→19.5%, MINI_BUBBLE 19.4→20.0%, MINI_ROCKET 23.0→23.2%, QUACK_HORN 14.3→15.1%.

Loadout cells: 10 pass, 11 within noise, 0 fail. Verdict: **G3 pass (noise-limited)** ("within noise" = outside the threshold by less than 1.96·SE of this run).
