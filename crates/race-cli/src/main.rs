//! `race-cli`: native tooling for the Rust engine (Phase 1).
//!
//! `corpus gen` is complete. `oracle diff` validates the trace host header
//! and stops before the comparison (Phase 2). `oracle meta` checks Season meta
//! parity (needs `--features ts-compat`). `gate` is a stub that exits with
//! status 2.

// Native-only tool: the D4(b) determinism bans don't apply here.
#![allow(clippy::disallowed_methods, clippy::disallowed_types)]

mod corpus;
mod meta;
mod oracle;

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
    },
}

#[derive(Subcommand)]
enum OracleCommand {
    /// Compare per-tick state hashes with `scripts/oracle/dump-trace.ts` output.
    ///
    /// Phase 1 skeleton: validates the trace's host header and selects the
    /// js_math host model; the comparison needs Phase 2's engine.
    Diff {
        /// Trace from dump-trace.ts (`.jsonl` or `.jsonl.gz`).
        #[arg(long)]
        trace: String,
        /// The linux-x64 oracle host has no FMA (Node can't report it).
        #[arg(long)]
        linux_x64_no_fma: bool,
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
            command: CorpusCommand::Gen { count, out, seed },
        } => match corpus::run_gen(count, &out, seed) {
            Ok(()) => ExitCode::SUCCESS,
            Err(err) => {
                eprintln!("race-cli corpus gen: {err:#}");
                ExitCode::FAILURE
            }
        },
        Command::Oracle {
            command:
                OracleCommand::Diff {
                    trace,
                    linux_x64_no_fma,
                },
        } => match oracle::run_diff(&trace, linux_x64_no_fma) {
            Ok(()) => ExitCode::SUCCESS,
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
