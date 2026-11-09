//! `race-cli oracle diff` skeleton (Phase 1): reads a TS oracle trace from
//! `scripts/oracle/dump-trace.ts`, validates its host header and selects the
//! `js_math` host model the Rust side must use (review 2 finding 2). The
//! per-case comparison needs Phase 2's `step()`.
//!
//! The model is returned as a `V8Target` *name* (`race_core::js_math::
//! V8Target::from_name`) so this crate does not have to enable race-core's
//! `ts-compat` feature, which would leak into every workspace build through
//! feature unification and change `ENGINE_BUILD_ID` (review 1 MINOR 12).

use std::io::{BufRead, BufReader, Read};

use anyhow::{Context, Result, anyhow, bail};
use serde::Deserialize;

/// The trace format this skeleton understands.
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
}

/// The host model `oracle diff` hands to the Rust engine (Phase 2:
/// `js_math::OracleHost { target: V8Target::from_name(target), .. }`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct HostModel {
    pub target: &'static str,
    pub use_std_math_pow: bool,
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
    Ok(HostModel {
        target,
        use_std_math_pow: header.use_std_math_pow,
    })
}

fn open(path: &str) -> Result<Box<dyn BufRead>> {
    let file = std::fs::File::open(path).with_context(|| format!("open {path}"))?;
    let reader: Box<dyn Read> = if path.ends_with(".gz") {
        Box::new(flate2::read::GzDecoder::new(file))
    } else {
        Box::new(file)
    };
    Ok(Box::new(BufReader::new(reader)))
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
        if line.starts_with(r#"{"kind":"header""#) {
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

/// `race-cli oracle diff --trace <file>`.
pub fn run_diff(trace: &str, linux_x64_no_fma: bool) -> Result<()> {
    let (header, cases) = read_trace_header(trace)?;
    let model = host_model(&header, linux_x64_no_fma)?;
    eprintln!(
        "oracle diff: {cases} cases from {}-{} (node {}, v8 {}); js_math host model {} with {} pow",
        header.platform,
        header.arch,
        header.node,
        header.v8,
        model.target,
        if model.use_std_math_pow {
            "std"
        } else {
            "legacy (fdlibm)"
        }
    );
    bail!("the per-case comparison needs the Rust engine step() (Phase 2)")
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
                use_std_math_pow: false
            }
        );
    }
}
