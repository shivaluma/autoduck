//! Tracing setup. `RUST_LOG` overrides the default filter (`info`, sqlx statements at `warn`).
//! Logs go to stderr so CLI subcommands keep stdout for their reports.

use tracing_subscriber::EnvFilter;

pub const DEFAULT_FILTER: &str = "info,sqlx=warn,tower_http=warn";

pub fn init() {
    let filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(DEFAULT_FILTER));
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_writer(std::io::stderr)
        .with_target(false)
        .try_init();
}
