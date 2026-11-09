//! `race-cli oracle diff`: runs the Rust engine on every case of a corpus and
//! compares it, tick by tick, with a TS oracle trace from
//! `scripts/oracle/dump-trace.ts` (gate G1, `scripts/oracle/README.md`).
//!
//! Per case it compares the per-tick `sh1` state-hash prefixes, the per-tick
//! `ev-jcs-v1` event-hash prefixes, `stateChainSha256`, `motionSha256`,
//! `eventsSha256`, `eventCount`, `finished`, `finalTick` and the standings
//! (finish times by f64 bits). A failing case reports the first tick whose
//! state hash and the first tick whose events differ.
//!
//! The trace's host header selects the `js_math` model the engine runs with
//! (`OracleHost`); darwin with V8's default std `pow` is refused. The
//! comparison needs race-core's `ts-compat` (ICU `localeCompare`, V8 maths):
//! `cargo run -p race-cli --release --features ts-compat -- oracle diff ...`.
//! The feature stays opt-in so `cargo build --workspace` never unifies it into
//! `ENGINE_BUILD_ID` (review 1 MINOR 12).
//!
//! Debugging a divergence: `--dump-case <i> --dump-out rust.jsonl` writes the
//! Rust side in the TS `--full-at` format (every `sh1` field by name, raw f64
//! bits, event JCS), and `--ts-full ts.jsonl` (the TS `--full-at` output for
//! the same case) prints the first differing tick, fields and events.

// Without `ts-compat` only the header checks are live; the comparison
// machinery is compiled out.
#![cfg_attr(not(feature = "ts-compat"), allow(dead_code, unused_imports))]

use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Read, Write};

use anyhow::{Context, Result, anyhow, bail};
use serde::Deserialize;

/// The trace format this tool understands.
pub const TRACE_FORMAT: &str = "oracle-trace-v2";

/// First line of every trace (`oracleHost()` in `dump-trace.ts`).
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TraceHeader {
    pub kind: String,
    pub trace_format: String,
    pub state_hash_version: String,
    pub event_digest_version: String,
    pub platform: String,
    pub arch: String,
    pub node: String,
    pub v8: String,
    #[serde(default)]
    pub exec_argv: Vec<String>,
    #[serde(default)]
    pub node_options: String,
    pub use_std_math_pow: bool,
    /// Simulation options the oracle ran with: `"all"` = `--ai-ablation all`
    /// (every duck in `aiAblationPlayerIds`). Absent = default options.
    #[serde(default)]
    pub ai_ablation: Option<String>,
}

/// The host model `oracle diff` hands to the Rust engine
/// (`js_math::OracleHost { target: V8Target::from_name(target), .. }`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct HostModel {
    pub target: &'static str,
    pub use_std_math_pow: bool,
    /// The oracle ran with `--ai-ablation all` (a trace option, not a host
    /// property, but it travels in the same header).
    pub ai_ablation_all: bool,
}

/// Maps a trace header to the host model, refusing hosts `js_math` can't
/// reproduce exactly. `linux_x64_no_fma` selects the no-FMA glibc `pow`,
/// which Node can't report (`process.arch` is `x64` either way).
pub fn host_model(header: &TraceHeader, linux_x64_no_fma: bool) -> Result<HostModel> {
    if header.kind != "header" {
        bail!(
            "trace does not start with a host header (kind {:?})",
            header.kind
        );
    }
    if header.trace_format != TRACE_FORMAT {
        bail!(
            "trace format {:?}, expected {TRACE_FORMAT:?}; regenerate the trace",
            header.trace_format
        );
    }
    if header.state_hash_version != "sh1" || header.event_digest_version != "ev-jcs-v1" {
        bail!(
            "trace uses {} / {}, this tool implements sh1 / ev-jcs-v1",
            header.state_hash_version,
            header.event_digest_version
        );
    }
    let target = match (header.platform.as_str(), header.arch.as_str()) {
        ("linux", "x64") if linux_x64_no_fma => "linux-x64-nofma",
        ("linux", "x64") => "linux-x64",
        ("linux", "arm64") => "linux-arm64",
        ("darwin", "arm64") => "darwin-arm64",
        (platform, arch) => bail!("no js_math model for oracle host {platform}-{arch}"),
    };
    if target == "darwin-arm64" && header.use_std_math_pow {
        bail!(
            "the oracle ran on darwin with V8's default --use-std-math-pow: Apple's pow is not \
             portable (Math.pow(0.5, k/600) differs from k = 844), so G1 can't be exact. Rerun the \
             oracle with `node --no-use-std-math-pow`, or in linux/amd64 (the G1 host)"
        );
    }
    if linux_x64_no_fma && target != "linux-x64-nofma" {
        bail!("--linux-x64-no-fma only applies to a linux-x64 oracle host");
    }
    let ai_ablation_all = match header.ai_ablation.as_deref() {
        None | Some("none") => false,
        Some("all") => true,
        Some(other) => bail!("trace header aiAblation {other:?}: this tool knows none and all"),
    };
    Ok(HostModel {
        target,
        use_std_math_pow: header.use_std_math_pow,
        ai_ablation_all,
    })
}

fn open(path: &str) -> Result<Box<dyn BufRead>> {
    let file = std::fs::File::open(path).with_context(|| format!("open {path}"))?;
    let reader: Box<dyn Read> = if path.ends_with(".gz") {
        Box::new(flate2::read::MultiGzDecoder::new(file))
    } else {
        Box::new(file)
    };
    Ok(Box::new(BufReader::new(reader)))
}

fn is_header_line(line: &str) -> bool {
    line.starts_with(r#"{"kind":"header""#)
}

/// Reads the trace, checks that every header (concatenated shards repeat
/// it) agrees, and returns the header with the number of case records.
pub fn read_trace_header(path: &str) -> Result<(TraceHeader, u64)> {
    let mut header: Option<TraceHeader> = None;
    let mut cases = 0u64;
    for (index, line) in open(path)?.lines().enumerate() {
        let line = line.with_context(|| format!("read {path}"))?;
        if line.is_empty() {
            continue;
        }
        if is_header_line(&line) {
            let this: TraceHeader = serde_json::from_str(&line)
                .with_context(|| format!("{path}:{}: header", index + 1))?;
            match &header {
                None => header = Some(this),
                Some(first) if *first == this => {}
                Some(first) => bail!(
                    "{path}:{}: shard header {}-{} node {} differs from {}-{} node {}",
                    index + 1,
                    this.platform,
                    this.arch,
                    this.node,
                    first.platform,
                    first.arch,
                    first.node
                ),
            }
        } else if header.is_none() {
            bail!("{path}: first line is not a host header (trace older than {TRACE_FORMAT}?)");
        } else {
            cases += 1;
        }
    }
    let header = header.ok_or_else(|| anyhow!("{path}: empty trace"))?;
    Ok((header, cases))
}

/// One standing of a trace record.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TraceStanding {
    pub player_id: String,
    pub rank: u32,
    /// Raw f64 bits, big-endian hex.
    pub finish_time_bits: String,
}

/// One case record of a trace (`ok: false` records carry only the error).
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TraceRecord {
    pub case: u64,
    pub ok: bool,
    #[serde(default)]
    pub stage: Option<String>,
    #[serde(default)]
    pub tick: Option<u32>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub finished: bool,
    #[serde(default)]
    pub final_tick: u32,
    #[serde(default)]
    pub max_ticks: u32,
    #[serde(default)]
    pub hash_prefix_bytes: usize,
    #[serde(default)]
    pub event_prefix_bytes: usize,
    #[serde(default)]
    pub state_chain_sha256: String,
    #[serde(default)]
    pub motion_sha256: String,
    #[serde(default)]
    pub event_count: u64,
    #[serde(default)]
    pub events_sha256: String,
    #[serde(default)]
    pub standings: Option<Vec<TraceStanding>>,
    #[serde(default)]
    pub tick_hashes: String,
    #[serde(default)]
    pub tick_event_hashes: String,
}

/// Options of `oracle diff`.
#[derive(Clone, Debug, Default)]
pub struct DiffOptions {
    pub corpus: Option<String>,
    pub trace: Option<String>,
    pub ts_cmd: Option<String>,
    pub linux_x64_no_fma: bool,
    pub show: usize,
    pub report: Option<String>,
    pub dump_case: Option<u64>,
    pub dump_out: Option<String>,
    pub ts_full: Option<String>,
}

/// Outcome of one case.
#[derive(Clone, Debug, PartialEq, Eq)]
enum CaseOutcome {
    Match,
    /// Both sides refused the case (TS threw, Rust could not resolve it).
    BothFailed(String),
    /// TS failed but Rust accepted the config.
    TsFailed(String),
    /// The Rust engine panicked (e.g. an unported `todo!`) or errored.
    RustPanic(String),
    /// Rust could not parse/resolve a config TS accepted.
    RustConfig(String),
    Diverged(Divergence),
}

/// Where a case diverged.
#[derive(Clone, Debug, PartialEq, Eq)]
struct Divergence {
    first_state_tick: Option<u32>,
    first_event_tick: Option<u32>,
    details: Vec<String>,
}

#[cfg(feature = "ts-compat")]
mod engine {
    //! The Rust side of the diff (needs race-core `ts-compat`).

    use anyhow::{Result, anyhow};
    use race_core::digest::{sha256, to_hex};
    use race_core::hash::{HashFold, state_hash};
    use race_core::js_math::{OracleHost, V8Target};
    use race_core::sim::{
        EngineMath, EventsDigest, SimOptions, Simulation, create_simulation,
        result_from_simulation, step_simulation,
    };
    use race_protocol::config::{RaceConfigInput, ResolvedRaceConfig};

    /// The Rust trace of one case, in the shape of a TS record.
    pub struct RustTrace {
        pub finished: bool,
        pub final_tick: u32,
        pub tick_hashes: Vec<[u8; 32]>,
        pub tick_event_hashes: Vec<[u8; 32]>,
        pub chain: [u8; 32],
        pub motion: [u8; 32],
        pub events_sha256: [u8; 32],
        pub event_count: u64,
        pub standings: Option<Vec<(String, u32, String)>>,
    }

    /// How the Rust engine runs a case: the oracle host's maths plus the
    /// trace's simulation options.
    #[derive(Clone, Copy, Debug)]
    pub struct RunSetup {
        pub host: OracleHost,
        /// `aiAblationPlayerIds` = every player (`--ai-ablation all`).
        pub ai_ablation_all: bool,
    }

    pub fn host(model: super::HostModel) -> Result<RunSetup> {
        let target = V8Target::from_name(model.target)
            .ok_or_else(|| anyhow!("unknown V8 target {}", model.target))?;
        Ok(RunSetup {
            host: OracleHost {
                target,
                use_std_math_pow: model.use_std_math_pow,
            },
            ai_ablation_all: model.ai_ablation_all,
        })
    }

    /// Parses and resolves a corpus line exactly as the TS oracle does
    /// (Zod defaults, `resolve_ts_compat`).
    pub fn parse_config(line: &str) -> Result<ResolvedRaceConfig, String> {
        let input: RaceConfigInput =
            serde_json::from_str(line).map_err(|error| format!("parse: {error}"))?;
        input
            .resolve_ts_compat()
            .map_err(|error| format!("resolve: {error:?}"))
    }

    pub fn new_sim(config: ResolvedRaceConfig, setup: RunSetup) -> Simulation {
        let ai_ablation = if setup.ai_ablation_all {
            config
                .players
                .iter()
                .map(|player| player.player_id.clone())
                .collect()
        } else {
            Vec::new()
        };
        create_simulation(
            config,
            SimOptions {
                record_events: true,
                ai_ablation,
                math: EngineMath::oracle(setup.host),
                ..SimOptions::default()
            },
            None,
        )
    }

    /// Hashes the events emitted since `cursor` (one observation step).
    pub fn observe_events(
        sim: &Simulation,
        cursor: &mut usize,
        digest: &mut EventsDigest,
        mut on_event: impl FnMut(&str),
    ) -> Result<[u8; 32], String> {
        let mut tick_events = String::new();
        for event in &sim.events()[*cursor..] {
            if let Some(text) = digest
                .push(event)
                .map_err(|error| format!("event {}: {error}", event.seq))?
            {
                tick_events.push_str(&text);
                tick_events.push('\n');
                on_event(&text);
            }
        }
        *cursor = sim.events().len();
        Ok(sha256(tick_events.as_bytes()))
    }

    /// Runs one case like `runCase` in `dump-trace.ts`.
    pub fn run(
        config: ResolvedRaceConfig,
        setup: RunSetup,
        max_ticks: u32,
    ) -> Result<RustTrace, String> {
        let mut sim = new_sim(config, setup);
        let mut digest = EventsDigest::new();
        let mut cursor = 0usize;
        let mut chain = HashFold::new();
        let mut motion = HashFold::new();
        let mut tick_hashes = Vec::new();
        let mut tick_event_hashes = Vec::new();
        let mut observe = |sim: &Simulation,
                           cursor: &mut usize,
                           digest: &mut EventsDigest|
         -> Result<[u8; 32], String> {
            let hash = state_hash(sim);
            tick_hashes.push(hash);
            chain.push(sim.tick, &hash);
            if HashFold::is_motion_tick(sim.tick) {
                motion.push(sim.tick, &hash);
            }
            tick_event_hashes.push(observe_events(sim, cursor, digest, |_| {})?);
            Ok(hash)
        };
        let mut last = observe(&sim, &mut cursor, &mut digest)?;
        while !sim.finished && sim.tick < max_ticks {
            step_simulation(&mut sim, None);
            last = observe(&sim, &mut cursor, &mut digest)?;
        }
        motion.push_final(sim.tick, &last);
        let standings = if sim.finished {
            let result = result_from_simulation(&sim).map_err(|error| error.to_string())?;
            Some(
                result
                    .standings
                    .iter()
                    .map(|entry| {
                        (
                            entry.player_id.as_str().to_owned(),
                            entry.rank,
                            format!("{:016x}", entry.finish_time_ms.to_bits()),
                        )
                    })
                    .collect(),
            )
        } else {
            None
        };
        let event_count = digest.count();
        Ok(RustTrace {
            finished: sim.finished,
            final_tick: sim.tick,
            tick_hashes,
            tick_event_hashes,
            chain: *chain.value(),
            motion: *motion.value(),
            events_sha256: digest.finish(),
            event_count,
            standings,
        })
    }

    /// `--full-at` lines for the Rust side (field names as `FullDump` in
    /// `dump-trace.ts`, f64 as raw big-endian bits).
    pub fn full_dump(
        case: u64,
        config: ResolvedRaceConfig,
        setup: RunSetup,
        max_ticks: u32,
        mut write: impl FnMut(String) -> Result<()>,
    ) -> Result<()> {
        let mut sim = new_sim(config, setup);
        let mut digest = EventsDigest::new();
        let mut cursor = 0usize;
        loop {
            let mut events = Vec::new();
            observe_events(&sim, &mut cursor, &mut digest, |text| {
                events.push(text.to_owned())
            })
            .map_err(|error| anyhow!(error))?;
            let line = serde_json::json!({
                "case": case,
                "tick": sim.tick,
                "stateSha256": to_hex(&state_hash(&sim)),
                "fields": fields(&sim),
                "events": events.iter().map(|jcs| serde_json::json!({ "jcs": jcs })).collect::<Vec<_>>(),
            });
            write(line.to_string())?;
            if sim.finished || sim.tick >= max_ticks {
                return Ok(());
            }
            step_simulation(&mut sim, None);
        }
    }

    /// The `sh1` fields by name (`visitState` + `FullDump`).
    fn fields(sim: &Simulation) -> Vec<serde_json::Value> {
        use serde_json::json;
        let bits = |value: f64| format!("{:016x}", value.to_bits());
        let mut out = vec![
            json!(["tick", "u32", sim.tick]),
            json!(["finished", "u8", u8::from(sim.finished)]),
            json!(["ducks.length", "u32", sim.ducks.len()]),
        ];
        for (index, duck) in sim.ducks.iter().enumerate() {
            let p = format!("ducks[{index}].");
            out.push(json!([
                format!("{p}playerId"),
                "str",
                duck.player_id.as_str()
            ]));
            for (name, value) in [
                ("progress", duck.progress),
                ("previousProgress", duck.previous_progress),
                ("lateralOffset", duck.lateral_offset),
                ("speed", duck.speed),
                ("acceleration", duck.acceleration),
                ("lateralVelocity", duck.lateral_velocity),
                ("desiredSpeed", duck.desired_speed),
                ("desiredLateralOffset", duck.desired_lateral_offset),
            ] {
                out.push(json!([format!("{p}{name}"), "f64", bits(value)]));
            }
            out.push(json!([format!("{p}currentRank"), "u32", duck.current_rank]));
            out.push(json!([
                format!("{p}nextImpulseTick"),
                "u32",
                duck.next_impulse_tick
            ]));
            out.push(json!([
                format!("{p}finished"),
                "u8",
                u8::from(duck.finished)
            ]));
            match duck.finish_time_ms {
                None => out.push(json!([format!("{p}finishTimeMs.present"), "u8", 0])),
                Some(time) => {
                    out.push(json!([format!("{p}finishTimeMs.present"), "u8", 1]));
                    out.push(json!([format!("{p}finishTimeMs"), "f64", bits(time)]));
                }
            }
            out.push(json!([
                format!("{p}pacingSegments.length"),
                "u32",
                duck.pacing_segments.len()
            ]));
            for (segment, &value) in duck.pacing_segments.iter().enumerate() {
                out.push(json!([
                    format!("{p}pacingSegments[{segment}]"),
                    "f64",
                    bits(value)
                ]));
            }
            out.push(json!([format!("{p}rngState"), "u32", sim.rng_state(index)]));
            out.push(json!([
                format!("{p}activeEffects.length"),
                "u32",
                duck.active_effects.len()
            ]));
            for (effect, value) in duck.active_effects.iter().enumerate() {
                out.push(json!([
                    format!("{p}activeEffects[{effect}]"),
                    "str",
                    value.as_str()
                ]));
            }
        }
        out
    }
}

/// Hex of the first `bytes` bytes of a hash.
#[cfg(feature = "ts-compat")]
fn hex_prefix(hash: &[u8; 32], bytes: usize) -> String {
    race_core::digest::to_hex(&hash[..bytes.min(32)])
}

/// First index where the TS prefixes (`width` hex chars each) and the Rust
/// hashes disagree, comparing prefixes of `bytes` bytes.
#[cfg(feature = "ts-compat")]
fn first_mismatch(ts: &str, width: usize, bytes: usize, rust: &[[u8; 32]]) -> Option<u32> {
    let ts_count = ts.len().checked_div(width).unwrap_or(0);
    (0..ts_count.max(rust.len()))
        .find(|&tick| {
            let ts = ts.get(tick * width..(tick + 1) * width);
            let rust = rust.get(tick).map(|hash| hex_prefix(hash, bytes));
            ts != rust.as_deref()
        })
        .map(|tick| u32::try_from(tick).unwrap_or(u32::MAX))
}

/// Compares one TS record with the Rust run of the same corpus line.
#[cfg(feature = "ts-compat")]
fn compare_case(record: &TraceRecord, line: Option<&str>, host: engine::RunSetup) -> CaseOutcome {
    use std::panic::{AssertUnwindSafe, catch_unwind};
    let Some(line) = line else {
        return CaseOutcome::RustConfig(format!("case {} is not in the corpus", record.case));
    };
    let config = match engine::parse_config(line) {
        Ok(config) => config,
        Err(error) if !record.ok => return CaseOutcome::BothFailed(error),
        Err(error) => return CaseOutcome::RustConfig(error),
    };
    if !record.ok {
        return CaseOutcome::TsFailed(format!(
            "{} at tick {}: {}",
            record.stage.as_deref().unwrap_or("?"),
            record.tick.unwrap_or(0),
            record.error.as_deref().unwrap_or("?")
        ));
    }
    let max_ticks = record.max_ticks;
    let run = catch_unwind(AssertUnwindSafe(|| engine::run(config, host, max_ticks)));
    let trace = match run {
        Ok(Ok(trace)) => trace,
        Ok(Err(error)) => return CaseOutcome::RustPanic(format!("error: {error}")),
        Err(payload) => {
            let message = payload
                .downcast_ref::<String>()
                .cloned()
                .or_else(|| {
                    payload
                        .downcast_ref::<&str>()
                        .map(|text| (*text).to_owned())
                })
                .unwrap_or_else(|| "non-string panic".to_owned());
            return CaseOutcome::RustPanic(message);
        }
    };

    let first_state_tick = first_mismatch(
        &record.tick_hashes,
        record.hash_prefix_bytes * 2,
        record.hash_prefix_bytes,
        &trace.tick_hashes,
    );
    let first_event_tick = first_mismatch(
        &record.tick_event_hashes,
        record.event_prefix_bytes * 2,
        record.event_prefix_bytes,
        &trace.tick_event_hashes,
    );
    let to_hex = race_core::digest::to_hex;
    let mut details = Vec::new();
    if trace.finished != record.finished {
        details.push(format!(
            "finished: ts {} rust {}",
            record.finished, trace.finished
        ));
    }
    if trace.final_tick != record.final_tick {
        details.push(format!(
            "finalTick: ts {} rust {}",
            record.final_tick, trace.final_tick
        ));
    }
    if to_hex(&trace.chain) != record.state_chain_sha256 {
        details.push("stateChainSha256 differs".to_owned());
    }
    if to_hex(&trace.motion) != record.motion_sha256 {
        details.push("motionSha256 differs".to_owned());
    }
    if trace.event_count != record.event_count {
        details.push(format!(
            "eventCount: ts {} rust {}",
            record.event_count, trace.event_count
        ));
    }
    if to_hex(&trace.events_sha256) != record.events_sha256 {
        details.push("eventsSha256 differs".to_owned());
    }
    let ts_standings = record.standings.as_ref().map(|standings| {
        standings
            .iter()
            .map(|entry| {
                (
                    entry.player_id.clone(),
                    entry.rank,
                    entry.finish_time_bits.clone(),
                )
            })
            .collect::<Vec<_>>()
    });
    if ts_standings != trace.standings {
        details.push("standings differ".to_owned());
    }
    if details.is_empty() && first_state_tick.is_none() && first_event_tick.is_none() {
        CaseOutcome::Match
    } else {
        CaseOutcome::Diverged(Divergence {
            first_state_tick,
            first_event_tick,
            details,
        })
    }
}

/// Reads the corpus lines (case index = 0-based line number).
#[cfg(feature = "ts-compat")]
fn read_corpus(path: &str) -> Result<Vec<String>> {
    let mut lines = Vec::new();
    for line in open(path)?.lines() {
        lines.push(line.with_context(|| format!("read {path}"))?);
    }
    Ok(lines)
}

/// Runs `--ts-cmd` to produce the trace: `<ts-cmd> --corpus <corpus> --out <trace>`.
fn run_ts_cmd(ts_cmd: &str, corpus: &str, trace: &str) -> Result<()> {
    eprintln!("oracle diff: running TS oracle: {ts_cmd} --corpus {corpus} --out {trace}");
    let status = std::process::Command::new("sh")
        .arg("-c")
        .arg(format!("{ts_cmd} --corpus \"$1\" --out \"$2\""))
        .arg("sh")
        .arg(corpus)
        .arg(trace)
        .status()
        .with_context(|| format!("run {ts_cmd}"))?;
    // dump-trace exits 1 when some case failed on the TS side; those
    // records are still written and compared.
    if !(status.success() || status.code() == Some(1)) {
        bail!("TS oracle command failed: {status}");
    }
    Ok(())
}

/// `race-cli oracle diff`. Returns whether every case matched.
pub fn run_diff(options: &DiffOptions) -> Result<bool> {
    let trace_path = match (&options.trace, &options.ts_cmd, &options.corpus) {
        (Some(trace), Some(cmd), Some(corpus)) => {
            run_ts_cmd(cmd, corpus, trace)?;
            trace.clone()
        }
        (None, Some(cmd), Some(corpus)) => {
            let trace = format!("{corpus}.oracle-trace.jsonl.gz");
            run_ts_cmd(cmd, corpus, &trace)?;
            trace
        }
        (Some(trace), None, _) => trace.clone(),
        (Some(_), Some(_), None) => bail!("--ts-cmd needs --corpus"),
        (None, _, _) => bail!("pass --trace <file>, or --ts-cmd <cmd> with --corpus"),
    };
    let (header, cases) = read_trace_header(&trace_path)?;
    let model = host_model(&header, options.linux_x64_no_fma)?;
    eprintln!(
        "oracle diff: {cases} cases from {}-{} (node {}, v8 {}); js_math host model {} with {} pow{}",
        header.platform,
        header.arch,
        header.node,
        header.v8,
        model.target,
        if model.use_std_math_pow {
            "std"
        } else {
            "legacy (fdlibm)"
        },
        if model.ai_ablation_all {
            "; AI ablated for every duck"
        } else {
            ""
        }
    );
    let Some(corpus_path) = options.corpus.as_deref() else {
        bail!("--corpus is required for the comparison (the trace holds hashes only)");
    };
    run_engine_diff(options, &trace_path, corpus_path, model)
}

#[cfg(not(feature = "ts-compat"))]
fn run_engine_diff(_: &DiffOptions, _: &str, _: &str, _: HostModel) -> Result<bool> {
    bail!(
        "race-core was built without `ts-compat` (byte-order ids, libm maths), so it cannot match \
         the TS oracle; rerun with `cargo run -p race-cli --release --features ts-compat -- oracle diff ...`"
    )
}

#[cfg(feature = "ts-compat")]
#[allow(clippy::too_many_lines)]
fn run_engine_diff(
    options: &DiffOptions,
    trace_path: &str,
    corpus_path: &str,
    model: HostModel,
) -> Result<bool> {
    use rayon::prelude::*;

    let host = engine::host(model)?;
    let corpus = read_corpus(corpus_path)?;

    if let Some(case) = options.dump_case {
        let out = options
            .dump_out
            .clone()
            .unwrap_or_else(|| format!("case-{case}.rust.full.jsonl"));
        let line = corpus
            .get(usize::try_from(case)?)
            .ok_or_else(|| anyhow!("case {case} is not in the corpus"))?;
        let config = engine::parse_config(line).map_err(|error| anyhow!(error))?;
        let max_ticks = race_core::config::maximum_ticks(config.tick_rate);
        let mut file = std::io::BufWriter::new(
            std::fs::File::create(&out).with_context(|| format!("create {out}"))?,
        );
        engine::full_dump(case, config, host, max_ticks, |line| {
            writeln!(file, "{line}")?;
            Ok(())
        })?;
        file.flush()?;
        eprintln!("oracle diff: wrote the Rust full dump of case {case} to {out}");
        if let Some(ts_full) = &options.ts_full {
            compare_full(ts_full, &out)?;
        }
        return Ok(true);
    }

    // Panics are caught and reported per case; silence the default printer.
    let previous_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(|_| {}));

    let mut totals: BTreeMap<&'static str, u64> = BTreeMap::new();
    let mut panic_kinds: BTreeMap<String, u64> = BTreeMap::new();
    let mut shown = 0usize;
    let mut failures = Vec::new();
    let mut reader = open(trace_path)?;
    let mut chunk: Vec<TraceRecord> = Vec::new();
    let mut done = false;
    let started = std::time::Instant::now();
    while !done {
        chunk.clear();
        while chunk.len() < 256 {
            let mut line = String::new();
            if reader.read_line(&mut line)? == 0 {
                done = true;
                break;
            }
            let line = line.trim_end();
            if line.is_empty() || is_header_line(line) {
                continue;
            }
            chunk.push(serde_json::from_str(line).context("trace record")?);
        }
        let outcomes: Vec<(u64, CaseOutcome)> = chunk
            .par_iter()
            .map(|record| {
                let line = usize::try_from(record.case)
                    .ok()
                    .and_then(|index| corpus.get(index))
                    .map(String::as_str);
                (record.case, compare_case(record, line, host))
            })
            .collect();
        for (case, outcome) in outcomes {
            let key = match &outcome {
                CaseOutcome::Match => "match",
                CaseOutcome::BothFailed(_) => "both-failed",
                CaseOutcome::TsFailed(_) => "ts-failed",
                CaseOutcome::RustPanic(message) => {
                    let kind = message
                        .split(" (")
                        .next()
                        .unwrap_or(message)
                        .trim_start_matches("not yet implemented: ")
                        .to_owned();
                    *panic_kinds.entry(kind).or_default() += 1;
                    "rust-panic"
                }
                CaseOutcome::RustConfig(_) => "rust-config",
                CaseOutcome::Diverged(_) => "diverged",
            };
            *totals.entry(key).or_default() += 1;
            if !matches!(outcome, CaseOutcome::Match | CaseOutcome::BothFailed(_)) {
                if shown < options.show {
                    shown += 1;
                    eprintln!("  case {case}: {}", describe(&outcome));
                }
                failures.push((case, outcome));
            }
        }
    }
    std::panic::set_hook(previous_hook);

    let total: u64 = totals.values().sum();
    let matched = totals.get("match").copied().unwrap_or(0);
    println!(
        "oracle diff: {matched}/{total} cases bit-exact ({:.1}s)",
        started.elapsed().as_secs_f64()
    );
    for (key, count) in &totals {
        println!("  {key:>12}: {count}");
    }
    for (kind, count) in &panic_kinds {
        println!("  rust panic {count:>5} x {kind}");
    }
    if let Some(report) = &options.report {
        let lines: Vec<serde_json::Value> = failures
            .iter()
            .map(
                |(case, outcome)| serde_json::json!({ "case": case, "outcome": describe(outcome) }),
            )
            .collect();
        std::fs::write(
            report,
            serde_json::to_string_pretty(&serde_json::json!({
                "total": total,
                "match": matched,
                "totals": totals,
                "failures": lines,
            }))?,
        )
        .with_context(|| format!("write {report}"))?;
    }
    Ok(total > 0 && failures.is_empty())
}

fn describe(outcome: &CaseOutcome) -> String {
    match outcome {
        CaseOutcome::Match => "match".to_owned(),
        CaseOutcome::BothFailed(error) => format!("both failed: {error}"),
        CaseOutcome::TsFailed(error) => format!("TS failed, Rust did not: {error}"),
        CaseOutcome::RustPanic(message) => format!("Rust panicked: {message}"),
        CaseOutcome::RustConfig(error) => format!("Rust config error: {error}"),
        CaseOutcome::Diverged(divergence) => format!(
            "diverged: first state tick {}, first event tick {}{}{}",
            divergence
                .first_state_tick
                .map_or_else(|| "-".to_owned(), |tick| tick.to_string()),
            divergence
                .first_event_tick
                .map_or_else(|| "-".to_owned(), |tick| tick.to_string()),
            if divergence.details.is_empty() {
                ""
            } else {
                "; "
            },
            divergence.details.join(", ")
        ),
    }
}

/// One `--full-at` line (TS or Rust).
#[cfg(feature = "ts-compat")]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FullLine {
    tick: u32,
    state_sha256: String,
    fields: Vec<(String, String, serde_json::Value)>,
    events: Vec<FullEvent>,
}

#[cfg(feature = "ts-compat")]
#[derive(Deserialize)]
struct FullEvent {
    jcs: String,
}

/// Prints the first tick where the two full dumps differ, with the fields
/// and events that differ there.
#[cfg(feature = "ts-compat")]
fn compare_full(ts_path: &str, rust_path: &str) -> Result<()> {
    let mut ts = open(ts_path)?.lines();
    let mut rust = open(rust_path)?.lines();
    loop {
        let (Some(ts_line), Some(rust_line)) = (ts.next(), rust.next()) else {
            println!("full dumps agree on every common tick");
            return Ok(());
        };
        let ts_line: FullLine = serde_json::from_str(&ts_line?).context("TS full line")?;
        let rust_line: FullLine = serde_json::from_str(&rust_line?).context("Rust full line")?;
        let events_differ = ts_line.events.len() != rust_line.events.len()
            || ts_line
                .events
                .iter()
                .zip(&rust_line.events)
                .any(|(a, b)| a.jcs != b.jcs);
        if ts_line.state_sha256 == rust_line.state_sha256 && !events_differ {
            continue;
        }
        println!(
            "first difference at tick {} (rust tick {})",
            ts_line.tick, rust_line.tick
        );
        let mut shown = 0;
        for index in 0..ts_line.fields.len().max(rust_line.fields.len()) {
            let a = ts_line.fields.get(index);
            let b = rust_line.fields.get(index);
            if a != b {
                println!("  field {index}: ts {a:?} rust {b:?}");
                shown += 1;
                if shown >= 20 {
                    break;
                }
            }
        }
        if events_differ {
            for index in 0..ts_line.events.len().max(rust_line.events.len()) {
                let a = ts_line.events.get(index).map(|event| event.jcs.as_str());
                let b = rust_line.events.get(index).map(|event| event.jcs.as_str());
                if a != b {
                    println!("  event {index}:\n    ts   {a:?}\n    rust {b:?}");
                }
            }
        }
        return Ok(());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn header(platform: &str, arch: &str, std_pow: bool) -> TraceHeader {
        TraceHeader {
            kind: "header".into(),
            trace_format: TRACE_FORMAT.into(),
            state_hash_version: "sh1".into(),
            event_digest_version: "ev-jcs-v1".into(),
            platform: platform.into(),
            arch: arch.into(),
            node: "24.17.0".into(),
            v8: "13.6.233.17-node.49".into(),
            exec_argv: vec![],
            node_options: String::new(),
            use_std_math_pow: std_pow,
            ai_ablation: None,
        }
    }

    #[test]
    fn maps_hosts_and_refuses_darwin_std_pow() {
        let model = |p, a, s, nofma| host_model(&header(p, a, s), nofma).map(|m| m.target);
        assert_eq!(model("linux", "x64", true, false).unwrap(), "linux-x64");
        assert_eq!(
            model("linux", "x64", true, true).unwrap(),
            "linux-x64-nofma"
        );
        assert_eq!(model("linux", "arm64", true, false).unwrap(), "linux-arm64");
        assert_eq!(
            model("darwin", "arm64", false, false).unwrap(),
            "darwin-arm64"
        );
        assert!(model("darwin", "arm64", true, false).is_err());
        assert!(model("win32", "x64", true, false).is_err());
        assert!(model("linux", "arm64", true, true).is_err());
        let mut old = header("linux", "x64", true);
        old.trace_format = "oracle-trace-v1".into();
        assert!(host_model(&old, false).is_err());
    }

    #[test]
    fn real_header_line_parses() {
        let line = r#"{"kind":"header","traceFormat":"oracle-trace-v2","stateHashVersion":"sh1","eventDigestVersion":"ev-jcs-v1","platform":"darwin","arch":"arm64","node":"24.17.0","v8":"13.6.233.17-node.49","execArgv":["--no-use-std-math-pow","--import","tsx"],"nodeOptions":"","useStdMathPow":false}"#;
        let parsed: TraceHeader = serde_json::from_str(line).unwrap();
        assert_eq!(
            host_model(&parsed, false).unwrap(),
            HostModel {
                target: "darwin-arm64",
                use_std_math_pow: false,
                ai_ablation_all: false,
            }
        );
        let ablated = line.replace(
            r#""useStdMathPow":false}"#,
            r#""useStdMathPow":false,"aiAblation":"all"}"#,
        );
        let parsed: TraceHeader = serde_json::from_str(&ablated).unwrap();
        assert!(host_model(&parsed, false).unwrap().ai_ablation_all);
        let bogus = line.replace(
            r#""useStdMathPow":false}"#,
            r#""useStdMathPow":false,"aiAblation":"some"}"#,
        );
        let parsed: TraceHeader = serde_json::from_str(&bogus).unwrap();
        assert!(host_model(&parsed, false).is_err());
    }
}
