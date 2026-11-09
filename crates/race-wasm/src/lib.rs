//! wasm-bindgen glue over `race-core` (D1, D27).
//!
//! Built for the browser by `scripts/build-wasm.sh` with `-C panic=abort`.
//! Phase 1 exports `engineBuildId()`, `versions()` and the perf-harness stub
//! `benchStubResim()` (see `crates/race-wasm/bench/README.md`); Phase 5 adds
//! the live driver and `normalizeConfig(json: &str)` (D8).

use race_protocol::versions;
use serde::Serialize;
use wasm_bindgen::prelude::wasm_bindgen;

/// `ENGINE_BUILD_ID` of the engine compiled into this module (D2). The
/// browser compares it with the server's `hello` frame before predicting.
#[wasm_bindgen(js_name = engineBuildId)]
pub fn engine_build_id() -> String {
    race_core::ENGINE_BUILD_ID.into()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Versions {
    race_engine_version: &'static str,
    race_balance_version: &'static str,
    race_protocol_version: &'static str,
    rng_version: &'static str,
    digest_version: &'static str,
    track_format: &'static str,
    track_version: &'static str,
    pickup_spawn_version: &'static str,
    hazard_balance_version: &'static str,
    race_tick_rate: u32,
    engine_build_id: &'static str,
}

/// All D2 version constants plus the build id, as a JSON object string.
#[wasm_bindgen]
pub fn versions() -> String {
    let v = Versions {
        race_engine_version: versions::RACE_ENGINE_VERSION,
        race_balance_version: versions::RACE_BALANCE_VERSION,
        race_protocol_version: versions::RACE_PROTOCOL_VERSION,
        rng_version: versions::RNG_VERSION,
        digest_version: versions::DIGEST_VERSION,
        track_format: versions::TRACK_FORMAT,
        track_version: versions::TRACK_VERSION,
        pickup_spawn_version: versions::PICKUP_SPAWN_VERSION,
        hazard_balance_version: versions::HAZARD_BALANCE_VERSION,
        race_tick_rate: versions::RACE_TICK_RATE,
        engine_build_id: race_core::ENGINE_BUILD_ID,
    };
    serde_json::to_string(&v).expect("versions serialise")
}

/// Phase 1 perf-harness stub (plan §3 Phase 1, "Measurement"; C9 catch-up).
///
/// Re-simulates `ticks` fixed steps for `ducks` ducks with float work shaped
/// like `stepSimulation`: an xorshift32 impulse schedule, smoothstep pacing,
/// river currents, speed and lateral response with JS-style clamps, an O(n²)
/// neighbour pass with `hypot`, per-duck `exp`/`powf` (the AI utility and
/// brain curves), a stable rank sort and an FNV state fold every 60 ticks.
/// `work` repeats the per-duck AI block to scale the load. It returns a
/// checksum so nothing is optimised away.
///
/// This is **not** the engine: it only sizes the catch-up budget before the
/// port exists, and its float results are not part of any determinism
/// contract (it uses std `exp`/`powf`, not race-core's libm wrappers).
#[wasm_bindgen(js_name = benchStubResim)]
pub fn bench_stub_resim(ducks: u32, ticks: u32, work: u32, seed: u32) -> f64 {
    stub::resim(ducks as usize, ticks, work, seed)
}

mod stub {
    const TICK_RATE: f64 = 60.0;
    const DT: f64 = 1.0 / TICK_RATE;
    /// Slower than the real 56 s target so no duck finishes inside 5,400
    /// ticks: the harness times the worst case (a full 90 s re-sim).
    const BASE_SPEED: f64 = 1.0 / 100.0;

    #[derive(Clone)]
    struct Duck {
        progress: f64,
        lateral: f64,
        speed: f64,
        acceleration: f64,
        lateral_velocity: f64,
        desired_speed: f64,
        desired_lateral: f64,
        pacing: [f64; 4],
        next_impulse: u32,
        rng: u32,
        rank: u32,
        finished: bool,
    }

    fn next_u32(state: &mut u32) -> u32 {
        let mut v = *state;
        v ^= v << 13;
        v ^= v >> 17;
        v ^= v << 5;
        *state = v;
        v
    }

    fn next_f64(state: &mut u32) -> f64 {
        f64::from(next_u32(state)) / 4_294_967_296.0
    }

    fn range(state: &mut u32, lo: f64, hi: f64) -> f64 {
        lo + (hi - lo) * next_f64(state)
    }

    fn clamp_js(v: f64, lo: f64, hi: f64) -> f64 {
        let v = if v < lo { lo } else { v };
        if v > hi { hi } else { v }
    }

    fn pacing(segments: &[f64; 4], progress: f64) -> f64 {
        let p = clamp_js(progress, 0.0, 1.0);
        let width = 0.25;
        let first = width * 0.5;
        let last = 1.0 - width * 0.5;
        if p <= first {
            return segments[0];
        }
        if p >= last {
            return segments[3];
        }
        let n = (p - first) / width;
        let mut index = n as usize;
        if index > 2 {
            index = 2;
        }
        let t = n - index as f64;
        let smooth = t * t * (3.0 - 2.0 * t);
        segments[index] + (segments[index + 1] - segments[index]) * smooth
    }

    fn current(progress: f64) -> (f64, f64) {
        if (0.14..0.24).contains(&progress) {
            (1.035, 0.05)
        } else if (0.42..0.52).contains(&progress) {
            (0.97, -0.06)
        } else if (0.7..0.82).contains(&progress) {
            (1.045, 0.04)
        } else {
            (1.0, 0.0)
        }
    }

    pub fn resim(count: usize, ticks: u32, work: u32, seed: u32) -> f64 {
        let count = count.clamp(1, 64);
        let mut ducks: Vec<Duck> = (0..count)
            .map(|i| {
                let mut rng = (seed ^ (i as u32).wrapping_mul(0x9E37_79B9)) | 1;
                let mut pacing = [0.0; 4];
                let mut sum = 0.0;
                for slot in &mut pacing {
                    *slot = range(&mut rng, -0.18, 0.18);
                    sum += *slot;
                }
                let mean = sum / 4.0;
                for slot in &mut pacing {
                    *slot = 1.0 + (*slot - mean);
                }
                let lateral = -0.75 + 1.5 * (i as f64) / ((count.max(2) - 1) as f64);
                Duck {
                    progress: 0.0,
                    lateral,
                    speed: BASE_SPEED * pacing[0],
                    acceleration: 0.0,
                    lateral_velocity: 0.0,
                    desired_speed: BASE_SPEED * range(&mut rng, 0.97, 1.03),
                    desired_lateral: lateral,
                    pacing,
                    next_impulse: 30 + next_u32(&mut rng) % 36,
                    rng,
                    rank: i as u32 + 1,
                    finished: false,
                }
            })
            .collect();
        let mut order: Vec<usize> = (0..count).collect();
        let mut fold: u64 = 0xcbf2_9ce4_8422_2325;
        for tick in 1..=ticks {
            for i in 0..count {
                if ducks[i].finished {
                    continue;
                }
                // AI block: neighbour scan with hypot plus utility curves.
                let mut utility = 0.0;
                for _ in 0..work.max(1) {
                    for j in 0..count {
                        if i == j {
                            continue;
                        }
                        let dp = (ducks[j].progress - ducks[i].progress) * 42.0;
                        let dl = ducks[j].lateral - ducks[i].lateral;
                        let distance = race_core::math::hypot(dp, dl);
                        utility += race_core::math::exp(-distance * 1.7)
                            * race_core::math::pow(1.0 + distance, 0.65);
                    }
                }
                let d = &mut ducks[i];
                if tick >= d.next_impulse {
                    d.desired_speed = BASE_SPEED * range(&mut d.rng, 0.97, 1.03);
                    d.acceleration = range(&mut d.rng, -0.03, 0.03) * BASE_SPEED;
                    d.desired_lateral =
                        clamp_js(range(&mut d.rng, -0.8, 0.8) + utility * 1e-3, -0.9, 0.9);
                    d.next_impulse = tick + 30 + next_u32(&mut d.rng) % 36;
                }
                let (speed_mul, lateral_force) = current(d.progress);
                let target = d.desired_speed * pacing(&d.pacing, d.progress) + d.acceleration;
                d.speed += (target - d.speed) * 1.65 * DT;
                let desired_lv = (d.desired_lateral - d.lateral) * 2.5 + lateral_force;
                d.lateral_velocity += (desired_lv - d.lateral_velocity) * 2.8 * DT;
                d.lateral_velocity = clamp_js(d.lateral_velocity, -0.85, 0.85);
                d.lateral = clamp_js(d.lateral + d.lateral_velocity * DT, -0.95, 0.95);
                let step = d.speed * speed_mul * DT;
                d.progress += if step > 0.0 { step } else { 0.0 };
                if d.progress >= 1.0 {
                    d.progress = 1.0;
                    d.finished = true;
                }
            }
            // Collisions: pairwise push within a small radius.
            for i in 0..count {
                for j in (i + 1)..count {
                    let dp = ducks[j].progress - ducks[i].progress;
                    let dl = ducks[j].lateral - ducks[i].lateral;
                    if dp.abs() < 0.009 && dl.abs() < 0.18 {
                        let push = if dl >= 0.0 { 0.02 } else { -0.02 };
                        ducks[i].lateral = clamp_js(ducks[i].lateral - push, -0.95, 0.95);
                        ducks[j].lateral = clamp_js(ducks[j].lateral + push, -0.95, 0.95);
                        ducks[i].speed *= 0.992;
                        ducks[j].speed *= 0.992;
                    }
                }
            }
            // Stable rank sort (progress desc, index asc).
            order.sort_by(|&a, &b| {
                ducks[b]
                    .progress
                    .partial_cmp(&ducks[a].progress)
                    .unwrap_or(core::cmp::Ordering::Equal)
                    .then(a.cmp(&b))
            });
            for (rank, &index) in order.iter().enumerate() {
                ducks[index].rank = rank as u32 + 1;
            }
            if tick % 60 == 0 {
                for d in &ducks {
                    for bits in [d.progress.to_bits(), d.lateral.to_bits(), d.speed.to_bits()] {
                        fold = (fold ^ bits).wrapping_mul(0x0100_0000_01b3);
                    }
                    fold = (fold ^ u64::from(d.rank)).wrapping_mul(0x0100_0000_01b3);
                }
            }
            if ducks.iter().all(|d| d.finished) {
                break;
            }
        }
        let mut checksum = (fold >> 11) as f64;
        for d in &ducks {
            checksum += d.progress + d.lateral;
        }
        checksum
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn versions_json_names_engine_version() {
        let json = super::versions();
        assert!(json.contains("\"raceEngineVersion\":\"2.0.0\""));
        assert!(json.contains("\"raceTickRate\":60"));
    }

    #[test]
    fn bench_stub_is_deterministic_and_finite() {
        let a = super::bench_stub_resim(8, 600, 1, 7);
        let b = super::bench_stub_resim(8, 600, 1, 7);
        assert!(a.is_finite());
        assert_eq!(a.to_bits(), b.to_bits());
        assert_ne!(a.to_bits(), super::bench_stub_resim(8, 600, 1, 8).to_bits());
    }
}
