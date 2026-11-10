//! `race-cli`: native tooling for the Rust engine (Phase 1).
//!
//! `corpus gen` is complete; `corpus pin` maintains the determinism fixture. `oracle diff` runs the Rust engine against a TS
//! oracle trace (needs `--features ts-compat`). `oracle meta` checks Season meta
//! parity (needs `--features ts-compat`). `gate` is a stub that exits with
//! status 2.

// Native-only tool: the D4(b) determinism bans don't apply here.
#![allow(clippy::disallowed_methods, clippy::disallowed_types)]

mod balance;
mod corpus;
mod meta;
mod oracle;
mod pin;

use std::process::ExitCode;

use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "race-cli", version, about = "AutoDuck Rust engine tooling")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Determinism / oracle corpus tools.
    Corpus {
        #[command(subcommand)]
        command: CorpusCommand,
    },
    /// Diff the Rust engine against the TS oracle.
    Oracle {
        #[command(subcommand)]
        command: OracleCommand,
    },
    /// Paired Rust-vs-Rust balance reports (Phase 6, `docs/balance/S3.16.md`).
    Balance {
        #[command(subcommand)]
        command: BalanceCommand,
    },
    /// Run a named gate (G1, G3, ...).
    Gate,
    /// Print race-core's ENGINE_BUILD_ID (CI compares it with the shipped
    /// wasm package's `engineBuildId()`).
    BuildId,
}

#[derive(Subcommand)]
enum CorpusCommand {
    /// Generate corpus configs (includes awkward 17-significant-digit floats).
    Gen {
        /// Number of cases (lines) to write.
        #[arg(long, default_value_t = 2000)]
        count: u64,
        /// Output JSONL path (`-` for stdout).
        #[arg(long, default_value = "corpus.jsonl")]
        out: String,
        /// Root seed (decimal or 0x-hex); defaults to the fixed corpus seed.
        #[arg(long, value_parser = corpus::parse_seed, default_value_t = corpus::DEFAULT_ROOT_SEED)]
        seed: u64,
        /// `full` (everything), `core` (no loadouts, pickups or hazards;
        /// run its oracle with `--ai-ablation all`) or `items` (every item
        /// combo, forced golden boxes, manual wild-item inputs).
        #[arg(long, value_parser = corpus::Profile::parse, default_value = "full")]
        profile: corpus::Profile,
    },
    /// Recompute the pinned whole-race digests of this build's feature set
    /// (`default`, or `tsCompat` with `--features ts-compat`) in the
    /// determinism fixture.
    Pin {
        /// Fixture path.
        #[arg(
            long,
            default_value = "crates/race-core/tests/fixtures/determinism-pinned.json"
        )]
        fixture: String,
        /// Compare only; exit 1 if a digest differs.
        #[arg(long)]
        check: bool,
    },
}

#[derive(Subcommand)]
enum BalanceCommand {
    /// Simulate the fixed balance corpus and write per-race outcomes (JSON).
    Run {
        /// Number of races.
        #[arg(long, default_value_t = 300)]
        cases: u64,
        /// Output JSON path.
        #[arg(long, default_value = "balance.json")]
        out: String,
        /// Set `pickupConfig.goldenBoxProbability` explicitly (default: left
        /// out, so the resolver default applies).
        #[arg(long)]
        golden_box_probability: Option<f64>,
    },
    /// Print the markdown report of `before` -> `after` (two `balance run`
    /// outputs of the same corpus).
    Compare {
        before: String,
        after: String,
        /// Section title.
        #[arg(long, default_value = "Balance comparison")]
        title: String,
    },
}

#[derive(Subcommand)]
enum OracleCommand {
    /// Run the Rust engine on a corpus and compare it tick by tick with a TS
    /// oracle trace from `scripts/oracle/dump-trace.ts` (gate G1). Build with
    /// `--features ts-compat`. On macOS run the oracle with
    /// `node --no-use-std-math-pow` (the header is checked).
    Diff {
        /// Corpus from `corpus gen` (case = 0-based line).
        #[arg(long)]
        corpus: Option<String>,
        /// Trace from dump-trace.ts (`.jsonl` or `.jsonl.gz`). With
        /// `--ts-cmd`, the trace is written here first.
        #[arg(long)]
        trace: Option<String>,
        /// Command that runs the TS oracle; `--corpus <corpus> --out
        /// <trace>` is appended (e.g. `node --no-use-std-math-pow --import
        /// tsx scripts/oracle/dump-trace.ts`).
        #[arg(long)]
        ts_cmd: Option<String>,
        /// The linux-x64 oracle host has no FMA (Node can't report it).
        #[arg(long)]
        linux_x64_no_fma: bool,
        /// How many failing cases to print.
        #[arg(long, default_value_t = 20)]
        show: usize,
        /// Write a JSON report of every failing case here.
        #[arg(long)]
        report: Option<String>,
        /// Instead of diffing, write the Rust `--full-at` dump of this case.
        #[arg(long)]
        dump_case: Option<u64>,
        /// Output of `--dump-case` (default `case-<i>.rust.full.jsonl`).
        #[arg(long)]
        dump_out: Option<String>,
        /// With `--dump-case`: the TS `--full-at` dump of the same case;
        /// prints the first differing tick, fields and events.
        #[arg(long)]
        ts_full: Option<String>,
    },
    /// Check Season meta parity (Chaos rules and card draws, toggle-skip,
    /// auto-loadouts, validateLoadout, catalog) against the TS fixture from
    /// `scripts/oracle/dump-meta-fixtures.ts`. Build with `--features ts-compat`.
    Meta {
        /// Fixture path (`.json.gz` or `.json`).
        #[arg(long, default_value = meta::DEFAULT_FIXTURE)]
        fixture: String,
        /// How many mismatching cases to print.
        #[arg(long, default_value_t = 20)]
        show: usize,
    },
}

fn not_implemented(name: &str) -> ExitCode {
    eprintln!("race-cli {name}: not implemented");
    ExitCode::from(2)
}

fn main() -> ExitCode {
    match Cli::parse().command {
        Command::Corpus {
            command:
                CorpusCommand::Gen {
                    count,
                    out,
                    seed,
                    profile,
                },
        } => match corpus::run_gen(count, &out, seed, profile) {
            Ok(()) => ExitCode::SUCCESS,
            Err(err) => {
                eprintln!("race-cli corpus gen: {err:#}");
                ExitCode::FAILURE
            }
        },
        Command::Corpus {
            command: CorpusCommand::Pin { fixture, check },
        } => match pin::run_pin(&fixture, check) {
            Ok(()) => ExitCode::SUCCESS,
            Err(err) => {
                eprintln!("race-cli corpus pin: {err:#}");
                ExitCode::FAILURE
            }
        },
        Command::Oracle {
            command:
                OracleCommand::Diff {
                    corpus,
                    trace,
                    ts_cmd,
                    linux_x64_no_fma,
                    show,
                    report,
                    dump_case,
                    dump_out,
                    ts_full,
                },
        } => match oracle::run_diff(&oracle::DiffOptions {
            corpus,
            trace,
            ts_cmd,
            linux_x64_no_fma,
            show,
            report,
            dump_case,
            dump_out,
            ts_full,
        }) {
            Ok(true) => ExitCode::SUCCESS,
            Ok(false) => ExitCode::FAILURE,
            Err(err) => {
                eprintln!("race-cli oracle diff: {err:#}");
                ExitCode::from(2)
            }
        },
        Command::Oracle {
            command: OracleCommand::Meta { fixture, show },
        } => match meta::run_meta(&fixture, show) {
            Ok(()) => ExitCode::SUCCESS,
            Err(err) => {
                eprintln!("race-cli oracle meta: {err:#}");
                ExitCode::FAILURE
            }
        },
        Command::Balance {
            command:
                BalanceCommand::Run {
                    cases,
                    out,
                    golden_box_probability,
                },
        } => match balance::run(
            &balance::RunOptions {
                cases,
                golden_box_probability,
            },
            &out,
        ) {
            Ok(()) => ExitCode::SUCCESS,
            Err(err) => {
                eprintln!("race-cli balance run: {err:#}");
                ExitCode::FAILURE
            }
        },
        Command::Balance {
            command:
                BalanceCommand::Compare {
                    before,
                    after,
                    title,
                },
        } => match balance::compare(&before, &after, &title) {
            Ok(text) => {
                print!("{text}");
                ExitCode::SUCCESS
            }
            Err(err) => {
                eprintln!("race-cli balance compare: {err:#}");
                ExitCode::FAILURE
            }
        },
        Command::Gate => not_implemented("gate"),
        Command::BuildId => {
            println!("{}", race_core::ENGINE_BUILD_ID);
            if race_core::build_id::ENGINE_BUILD_TS_COMPAT {
                eprintln!("race-cli build-id: this build has race-core/ts-compat enabled");
            }
            ExitCode::SUCCESS
        }
    }
}
