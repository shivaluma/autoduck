//! `race-cli`: native tooling for the Rust engine.
//!
//! `corpus gen` writes config corpora; `corpus pin` maintains the determinism
//! fixture. `balance` holds the balance modes (Phase 6), `compare` gate G3,
//! `fuzz` the random-config gate and `golden` the frozen digests of the
//! `golden-version` CI job. `gate` is a stub that exits with status 2. The TS
//! oracle commands (`oracle diff`, `oracle meta`) were removed with the TS
//! engine in Phase 9.

// Native-only tool: the D4(b) determinism bans don't apply here.
#![allow(clippy::disallowed_methods, clippy::disallowed_types)]

mod balance;
mod codegen;
mod corpus;
mod drama;
mod fuzz;
mod golden;
mod modes;
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
    /// Paired Rust-vs-Rust balance reports (Phase 6, `docs/balance/S3.16.md`).
    Balance {
        #[command(subcommand)]
        command: BalanceCommand,
    },
    /// Gate G3: compare a TS S3.15 run (`scripts/oracle/g3-balance.ts`)
    /// with a Rust run (`balance mixed --corpus`) of the same G3 corpus.
    /// Prints the markdown report; exits 1 if a metric fails.
    Compare {
        /// TS run (`.json` or `.json.gz`).
        ts: String,
        /// Rust run (`.json` or `.json.gz`).
        rs: String,
    },
    /// Random configs through the shipped engine: 0 panics, 0 non-finishing
    /// races, 0 non-finite values.
    Fuzz {
        /// Number of configs.
        #[arg(long, default_value_t = 2000)]
        cases: u64,
        /// First case index.
        #[arg(long, default_value_t = 0)]
        start: u64,
        /// Root seed (decimal or 0x-hex).
        #[arg(long, value_parser = corpus::parse_seed, default_value_t = fuzz::FUZZ_ROOT_SEED)]
        seed: u64,
        /// Mutate every config adversarially first (extreme numbers, bad
        /// ids, bad Chaos groups, late or unknown manual inputs, ...).
        #[arg(long)]
        adversarial: bool,
    },
    /// Frozen golden digests per engine/balance version (`golden-version`).
    Golden {
        #[command(subcommand)]
        command: GoldenCommand,
        /// Golden fixture.
        #[arg(long, global = true, default_value = golden::DEFAULT_FIXTURE)]
        fixture: String,
        /// Fixture whose case lines are digested.
        #[arg(long, global = true, default_value = golden::DEFAULT_CASES)]
        cases: String,
        /// Toolchain file whose hash is frozen.
        #[arg(long, global = true, default_value = golden::DEFAULT_TOOLCHAIN)]
        toolchain: String,
    },
    /// Run a named gate (G1, G3, ...).
    Gate,
    /// Export the race-core catalogs and protocol versions for the browser
    /// (`src/engine/generated/{catalog,versions}.json`, plan D19).
    Codegen {
        /// Output directory.
        #[arg(long, default_value = "src/engine/generated")]
        out: String,
    },
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
enum GoldenCommand {
    /// Fail if this build's digests or toolchain differ from the frozen
    /// entry of its version, or if the version has no entry.
    Check,
    /// Freeze this version's digests (never rewrites a frozen digest).
    Freeze,
}

#[derive(Subcommand)]
enum BalanceCommand {
    /// How predictable a race is while it runs: who leads / trails at each
    /// checkpoint against who wins / finishes last, lead and last-place
    /// changes, photo finishes (8-duck production lobbies).
    Drama {
        /// Number of races.
        #[arg(long, default_value_t = 2000)]
        races: u64,
    },
    /// Mixed-loadout lobbies: loadout cells, temperaments, drama and wild
    /// items (replaces balance-temperaments.ts and the drama reports).
    Mixed {
        /// Number of races (ignored with `--corpus`).
        #[arg(long, default_value_t = 2000)]
        races: u64,
        /// Ducks per race.
        #[arg(long, default_value_t = 8)]
        players: usize,
        /// Chaos card for every race.
        #[arg(long, default_value = "NORMAL")]
        chaos: String,
        /// Run the configs of this JSONL corpus (`balance g3-corpus`).
        #[arg(long)]
        corpus: Option<String>,
        /// Write the per-race outcomes here (the input of `compare`).
        #[arg(long)]
        out: Option<String>,
    },
    /// Paired loadout matrix (replaces balance-matrix.ts).
    Matrix {
        /// Seeds per lobby (each runs all 18 loadouts).
        #[arg(long, default_value_t = 100)]
        seeds: u64,
        #[arg(long, default_value_t = 8)]
        players: usize,
        /// Comma-separated lobbies.
        #[arg(
            long,
            default_value = "MIXED,SPEED,DEFENSE,ATTACK",
            value_delimiter = ','
        )]
        lobbies: Vec<String>,
    },
    /// Paired wild-item value audit (replaces balance-wild-items.ts).
    Wild {
        /// Seeds (each runs the control plus every wild item).
        #[arg(long, default_value_t = 200)]
        seeds: u64,
        #[arg(long, default_value_t = 8)]
        players: usize,
    },
    /// Write the G3 corpus (JSONL configs both engines run).
    G3Corpus {
        #[arg(long, default_value_t = 300)]
        races: u64,
        #[arg(long, default_value_t = 8)]
        players: usize,
        #[arg(long, default_value = "NORMAL")]
        chaos: String,
        #[arg(long, default_value = "g3-corpus.jsonl")]
        out: String,
    },
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

fn not_implemented(name: &str) -> ExitCode {
    eprintln!("race-cli {name}: not implemented");
    ExitCode::from(2)
}

fn status(name: &str, result: anyhow::Result<()>) -> ExitCode {
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("race-cli {name}: {err:#}");
            ExitCode::FAILURE
        }
    }
}

fn report(name: &str, result: anyhow::Result<String>) -> ExitCode {
    status(name, result.map(|text| print!("{text}")))
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
        Command::Balance {
            command: BalanceCommand::Drama { races },
        } => match drama::run(races) {
            Ok(text) => {
                print!("{text}");
                ExitCode::SUCCESS
            }
            Err(err) => {
                eprintln!("race-cli balance drama: {err:#}");
                ExitCode::FAILURE
            }
        },
        Command::Balance {
            command:
                BalanceCommand::Mixed {
                    races,
                    players,
                    chaos,
                    corpus,
                    out,
                },
        } => report(
            "balance mixed",
            modes::run_mixed(&modes::MixedOptions {
                races,
                players,
                chaos,
                corpus,
                out,
            }),
        ),
        Command::Balance {
            command:
                BalanceCommand::Matrix {
                    seeds,
                    players,
                    lobbies,
                },
        } => report(
            "balance matrix",
            modes::run_matrix(seeds, players, &lobbies),
        ),
        Command::Balance {
            command: BalanceCommand::Wild { seeds, players },
        } => report("balance wild", modes::run_wild(seeds, players)),
        Command::Balance {
            command:
                BalanceCommand::G3Corpus {
                    races,
                    players,
                    chaos,
                    out,
                },
        } => status(
            "balance g3-corpus",
            modes::run_g3_corpus(races, players, &chaos, &out),
        ),
        Command::Compare { ts, rs } => match modes::compare(&ts, &rs) {
            Ok((text, ok)) => {
                print!("{text}");
                if ok {
                    ExitCode::SUCCESS
                } else {
                    ExitCode::FAILURE
                }
            }
            Err(err) => {
                eprintln!("race-cli compare: {err:#}");
                ExitCode::from(2)
            }
        },
        Command::Fuzz {
            cases,
            start,
            seed,
            adversarial,
        } => status("fuzz", fuzz::run(cases, start, seed, adversarial)),
        Command::Golden {
            command,
            fixture,
            cases,
            toolchain,
        } => match command {
            GoldenCommand::Check => {
                status("golden check", golden::check(&fixture, &cases, &toolchain))
            }
            GoldenCommand::Freeze => status(
                "golden freeze",
                golden::freeze(&fixture, &cases, &toolchain),
            ),
        },
        Command::Gate => not_implemented("gate"),
        Command::Codegen { out } => match codegen::run_codegen(&out) {
            Ok(()) => ExitCode::SUCCESS,
            Err(err) => {
                eprintln!("race-cli codegen: {err:#}");
                ExitCode::FAILURE
            }
        },
        Command::BuildId => {
            println!("{}", race_core::ENGINE_BUILD_ID);
            if race_core::build_id::ENGINE_BUILD_TS_COMPAT {
                eprintln!("race-cli build-id: this build has race-core/ts-compat enabled");
            }
            ExitCode::SUCCESS
        }
    }
}
