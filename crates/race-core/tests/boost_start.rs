//! F10 (`docs/balance/S3.16.md`): a speed boost's natural `*_ENDED` event
//! carries its own boost's start, never an earlier Nitro's.

#![allow(clippy::float_cmp)]

#[path = "support/whitebox.rs"]
mod whitebox;

use race_core::items::engine::{SpeedStartExtras, finish_speed_boost, try_apply_prep_speed_boost};
use race_protocol::events::EventKind;
use race_protocol::ids::RaceItemId;
use whitebox::{Harness, literal_runtime, pid};

#[test]
fn f10_ended_events_carry_only_their_own_boost_start() {
    let mut harness = Harness::new();
    let mut runtime = literal_runtime(&[RaceItemId::Nitro, RaceItemId::PaddleBurst]);
    let duck = pid("a");
    let nitro = SpeedStartExtras {
        start_progress: Some(0.4),
        start_rank: Some(3),
        ..SpeedStartExtras::default()
    };
    try_apply_prep_speed_boost(
        &mut runtime,
        &duck,
        RaceItemId::Nitro,
        1.3,
        1.0,
        0,
        60,
        &mut harness.emitter(0),
        nitro,
    );
    finish_speed_boost(&mut runtime, &duck, 60, 60, &mut harness.emitter(60));
    try_apply_prep_speed_boost(
        &mut runtime,
        &duck,
        RaceItemId::PaddleBurst,
        1.15,
        1.0,
        61,
        60,
        &mut harness.emitter(61),
        SpeedStartExtras::default(),
    );
    finish_speed_boost(&mut runtime, &duck, 121, 60, &mut harness.emitter(121));

    let ended: Vec<(Option<f64>, Option<u32>)> = harness
        .events()
        .iter()
        .filter_map(|event| match &event.kind {
            EventKind::NitroEnded(meta)
            | EventKind::DraftFinEnded(meta)
            | EventKind::PaddleBurstEnded(meta) => Some((meta.start_progress, meta.start_rank)),
            _ => None,
        })
        .collect();
    assert_eq!(ended.len(), 2, "{ended:?}");
    assert_eq!(ended[0], (Some(0.4), Some(3)));
    if race_core::TS_COMPAT {
        // S3.15: the Paddle Burst end reports the earlier Nitro's start.
        assert_eq!(ended[1], (Some(0.4), Some(3)));
    } else {
        assert_eq!(ended[1], (None, None));
    }
}
