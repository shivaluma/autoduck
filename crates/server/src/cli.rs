//! `autoduck` subcommands (plan Phase 3).
//!
//! Exit codes: 0 success, 1 failure (a guard refused, a check failed), 2 not implemented in
//! this build.

use std::io::{Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream};
use std::process::ExitCode;
use std::time::Duration;

use clap::{Parser, Subcommand};

use crate::boot::{self, backup, guards, lock, recovery};
use crate::config::Config;
use crate::db::{Db, migrations, pool, schema};
use crate::http::{self, AppState};

#[derive(Parser, Debug)]
#[command(name = "autoduck", version, about = "AutoDuck server")]
pub struct Cli {
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Subcommand, Debug)]
pub enum Command {
    /// Run the boot guards, then serve HTTP on $HOST:$PORT (default 0.0.0.0:3000).
    Serve,
    /// Read-only: run every DB guard (no lock, no backup, no recovery) and print a report.
    VerifyDb,
    /// Read-only: compare the live schema with the Prisma baseline (D14) and print the drift.
    CheckSchema,
    /// Write a `VACUUM INTO` backup now (same retention and free-space rules as boot).
    Backup {
        /// Ignore the 6-hour minimum age.
        #[arg(long)]
        force: bool,
    },
    /// Liveness probe: GET /api/health on the local server; exit 0 on HTTP 200.
    Healthcheck {
        /// Seconds to wait for the response.
        #[arg(long, default_value_t = 5)]
        timeout: u64,
    },
    /// Seed an empty database with the starter users (refuses a non-empty database).
    Seed,
    /// Not in this build (schema is TS-owned until the point of no return).
    Migrate,
    /// Not in this build.
    DiffSince,
    /// Not in this build (Phase 5).
    VerifyRaces,
    /// Not in this build (Phase 5).
    BackfillTrack,
    /// Not in this build (Phase 5).
    BackfillStats,
    /// Not in this build.
    Sim {
        #[arg(value_parser = ["economy", "gacha"])]
        kind: String,
    },
}

pub fn main() -> ExitCode {
    crate::telemetry::init();
    let cli = Cli::parse();
    let stub = |name: &str| {
        eprintln!("autoduck {name}: not implemented in this build");
        ExitCode::from(2)
    };
    match cli.command {
        Command::Migrate => return stub("migrate"),
        Command::DiffSince => return stub("diff-since"),
        Command::VerifyRaces => return stub("verify-races"),
        Command::BackfillTrack => return stub("backfill-track"),
        Command::BackfillStats => return stub("backfill-stats"),
        Command::Sim { ref kind } => return stub(&format!("sim {kind}")),
        _ => {}
    }

    let config = match Config::from_env() {
        Ok(config) => config,
        Err(error) => {
            tracing::error!(%error, "invalid configuration");
            return ExitCode::FAILURE;
        }
    };

    if let Command::Healthcheck { timeout } = cli.command {
        return healthcheck(&config, Duration::from_secs(timeout));
    }

    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(error) => {
            tracing::error!(%error, "cannot start the async runtime");
            return ExitCode::FAILURE;
        }
    };
    let result = runtime.block_on(async {
        match cli.command {
            Command::Serve => serve(config).await,
            Command::VerifyDb => verify_db(&config).await,
            Command::CheckSchema => check_schema(&config).await,
            Command::Backup { force } => run_backup(&config, force).await,
            Command::Seed => seed(&config).await,
            _ => unreachable!("handled above"),
        }
    });
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            tracing::error!("{error:#}");
            ExitCode::FAILURE
        }
    }
}

async fn serve(config: Config) -> anyhow::Result<()> {
    // A `test-rng` build makes gacha rolls and ids predictable once AUTODUCK_TEST_RNG_SEED is
    // set, so such a binary refuses to serve anywhere but dev (review 2, finding 7). The
    // Phase 7 image build must not enable the feature (open item in phase3-notes).
    if cfg!(feature = "test-rng") && config.env != crate::config::AppEnv::Dev {
        anyhow::bail!(
            "this binary was built with the `test-rng` feature and only serves with AUTODUCK_ENV=dev (got {})",
            config.env.as_str()
        );
    }
    let booted = boot::run(&config).await?;
    let boot::Booted {
        db,
        lock,
        recovery: _,
    } = booted;
    let state = AppState::new(config, db);
    http::serve(state).await?;
    drop(lock);
    Ok(())
}

/// The read-only connection `verify-db` and `check-schema` use, probed once. A read-only
/// connection can't roll back a hot journal (left by a process killed mid-write), and SQLite
/// then reports the opaque "attempt to write a readonly database" (code 776); say what it
/// means instead (review 1, finding 2).
async fn open_for_check(path: &std::path::Path) -> anyhow::Result<sqlx::SqliteConnection> {
    let probe = async {
        let mut conn = pool::connect_read_only(path).await?;
        sqlx::query("SELECT COUNT(*) FROM sqlite_master")
            .execute(&mut conn)
            .await?;
        Ok::<_, sqlx::Error>(conn)
    };
    match probe.await {
        Ok(conn) => Ok(conn),
        Err(error) => {
            let journal = std::path::PathBuf::from(format!("{}-journal", path.display()));
            if journal.metadata().is_ok_and(|meta| meta.len() > 0) {
                anyhow::bail!(
                    "{} has a hot rollback journal ({}): a write was interrupted. Start the server \
                     (its writer rolls the journal back) or open the file read-write once, then \
                     re-run. SQLite said: {error}",
                    path.display(),
                    journal.display()
                );
            }
            Err(error.into())
        }
    }
}

async fn verify_db(config: &Config) -> anyhow::Result<()> {
    let mut failures = Vec::new();
    println!("database: {}", config.db_path.display());
    guards::check_exists(&config.db_path)?;
    let mut conn = open_for_check(&config.db_path).await?;

    match guards::check_not_empty(&mut conn, &config.db_path, config.allow_empty_db).await {
        Ok(players) => println!("players: {players}"),
        Err(error) => failures.push(error.to_string()),
    }
    match guards::check_sentinel(&mut conn, config.env).await {
        Ok(sentinel) => println!(
            "staging sentinel ({}): {}",
            config.env.as_str(),
            sentinel.as_deref().unwrap_or("none")
        ),
        Err(error) => failures.push(error.to_string()),
    }
    match guards::check_integrity(&mut conn).await {
        Ok(()) => println!("integrity_check: ok"),
        Err(error) => failures.push(error.to_string()),
    }
    let report = schema::verify(&mut conn).await?;
    println!(
        "schema: {} fatal, {} non-fatal drift",
        report.fatal.len(),
        report.drift.len()
    );
    for drift in &report.drift {
        println!("  drift: {drift}");
    }
    for fatal in &report.fatal {
        println!("  FATAL: {fatal}");
        failures.push(fatal.clone());
    }
    let applied = migrations::applied_ids(&mut conn).await?;
    let missing = migrations::missing_required(&applied);
    println!(
        "TS migrations: {} applied, {} required, {} missing",
        applied.len(),
        migrations::required_ts_migrations().len(),
        missing.len()
    );
    for id in &missing {
        println!("  missing: {id}");
    }
    if !missing.is_empty() && config.env != crate::config::AppEnv::Dev {
        failures.push(format!(
            "missing required TS migrations: {}",
            missing.join(", ")
        ));
    }
    let (candidates, stuck) = recovery::dry_run(&mut conn).await?;
    println!(
        "recovery: {} engine>=2 race(s) to recover {candidates:?}; TS-era stuck {stuck:?} (never modified)",
        candidates.len()
    );

    if failures.is_empty() {
        println!("verify-db: OK");
        Ok(())
    } else {
        for failure in &failures {
            println!("FAILED: {failure}");
        }
        anyhow::bail!("verify-db: {} check(s) failed", failures.len())
    }
}

async fn check_schema(config: &Config) -> anyhow::Result<()> {
    guards::check_exists(&config.db_path)?;
    let mut conn = open_for_check(&config.db_path).await?;
    let report = schema::verify(&mut conn).await?;
    for drift in &report.drift {
        println!("drift: {drift}");
    }
    for fatal in &report.fatal {
        println!("FATAL: {fatal}");
    }
    println!(
        "check-schema: {} fatal, {} non-fatal",
        report.fatal.len(),
        report.drift.len()
    );
    if report.is_ok() {
        Ok(())
    } else {
        anyhow::bail!("schema verification failed")
    }
}

async fn run_backup(config: &Config, force: bool) -> anyhow::Result<()> {
    guards::check_exists(&config.db_path)?;
    let db = Db::open(&config.db_path).await?;
    let mut writer = db.writer.acquire().await?;
    let mut policy = backup::BackupPolicy::default();
    if force {
        policy.min_age = Duration::ZERO;
    }
    let outcome = backup::run(&mut writer, &config.db_path, &config.backup_dir, &policy).await;
    drop(writer);
    // Same rule as the boot: rotate old backups out only when the source is sound.
    let integrity = match db.reader.acquire().await {
        Ok(mut reader) => guards::check_integrity(&mut reader)
            .await
            .map_err(anyhow::Error::from),
        Err(error) => Err(error.into()),
    };
    db.close().await;
    match &integrity {
        Ok(()) => {
            backup::prune_old(&config.backup_dir, policy.keep);
        }
        Err(error) => eprintln!("integrity_check failed, old backups kept: {error:#}"),
    }
    match outcome {
        backup::BackupOutcome::Written { path, .. } => {
            println!("{}", path.display());
            Ok(())
        }
        backup::BackupOutcome::SkippedRecent { newest, .. } => {
            println!(
                "skipped: {} is younger than 6 h (use --force)",
                newest.display()
            );
            Ok(())
        }
        other => anyhow::bail!("backup not written: {other:?}"),
    }
}

async fn seed(config: &Config) -> anyhow::Result<()> {
    guards::check_exists(&config.db_path)?;
    let Some(_lock) = lock::try_acquire(&config.lock_path)? else {
        anyhow::bail!(
            "{} is held by a running instance ({}); refusing to seed",
            config.lock_path.display(),
            lock::holder(&config.lock_path)
        );
    };
    let db = Db::open(&config.db_path).await?;
    let result = crate::seed::seed(&db).await;
    db.close().await;
    let created = result?;
    println!("seeded {created} users");
    Ok(())
}

fn healthcheck(config: &Config, timeout: Duration) -> ExitCode {
    let ip = match config.bind.ip() {
        IpAddr::V4(ip) if ip.is_unspecified() => IpAddr::V4(Ipv4Addr::LOCALHOST),
        IpAddr::V6(ip) if ip.is_unspecified() => IpAddr::V6(std::net::Ipv6Addr::LOCALHOST),
        ip => ip,
    };
    let addr = SocketAddr::new(ip, config.bind.port());
    let probe = || -> std::io::Result<String> {
        let mut stream = TcpStream::connect_timeout(&addr, timeout)?;
        stream.set_read_timeout(Some(timeout))?;
        stream.set_write_timeout(Some(timeout))?;
        stream.write_all(
            b"GET /api/health HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
        )?;
        let mut head = [0u8; 64];
        let read = stream.read(&mut head)?;
        Ok(String::from_utf8_lossy(&head[..read]).into_owned())
    };
    match probe() {
        Ok(head) if head.starts_with("HTTP/1.1 200") || head.starts_with("HTTP/1.0 200") => {
            ExitCode::SUCCESS
        }
        Ok(head) => {
            eprintln!(
                "healthcheck: unexpected response from {addr}: {:?}",
                head.lines().next().unwrap_or("")
            );
            ExitCode::FAILURE
        }
        Err(error) => {
            eprintln!("healthcheck: {addr}: {error}");
            ExitCode::FAILURE
        }
    }
}
