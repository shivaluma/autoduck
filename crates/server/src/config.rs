//! Environment configuration. Everything is read once at startup through [`Config::from_env`]
//! (or [`Config::from_lookup`] in tests, so no test mutates the process environment).

use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::PathBuf;
use std::time::Duration;

use crate::db::url::{DatabaseUrlError, parse_database_url};

/// `AUTODUCK_ENV`. Unset means production: the strict choice (absolute DB path, every required
/// TS migration id, the staging sentinel refused).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AppEnv {
    Dev,
    Staging,
    Production,
}

impl AppEnv {
    pub fn as_str(self) -> &'static str {
        match self {
            AppEnv::Dev => "dev",
            AppEnv::Staging => "staging",
            AppEnv::Production => "production",
        }
    }
}

/// `AUTODUCK_SCHEMA_MODE` (D14). `compat` (default) never runs DDL and never writes `rs-*` ledger
/// rows. `owned` additionally needs the `rs-ponr` marker row in `AppMigration`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SchemaMode {
    Compat,
    Owned,
}

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("{name}={value:?} is not valid: {reason}")]
    Invalid {
        name: &'static str,
        value: String,
        reason: &'static str,
    },
    #[error(transparent)]
    DatabaseUrl(#[from] DatabaseUrlError),
}

/// `Debug` is written by hand so the admin secret can never reach a log line
/// (review 2, finding 5).
#[derive(Clone)]
pub struct Config {
    pub env: AppEnv,
    /// Absolute path of the SQLite file (parsed by our own code, D13).
    pub db_path: PathBuf,
    pub bind: SocketAddr,
    /// Built SPA (`dist/`). Missing is allowed: the API still serves, pages return 404.
    pub dist_dir: PathBuf,
    /// D21 instance lock. Defaults to `<db dir>/autoduck.lock` (`/app/data/autoduck.lock`).
    pub lock_path: PathBuf,
    /// How long `serve` retries a held lock before giving up (D21: 150 s).
    pub lock_wait: Duration,
    /// D29 boot backups. Defaults to `<db dir>/backups`, next to the TS `pre-migrate-*` files.
    pub backup_dir: PathBuf,
    /// `AUTODUCK_BACKUP=0` disables the boot backup (tests, read-only media). Default on.
    pub backup_enabled: bool,
    /// `AUTODUCK_ALLOW_EMPTY_DB=1`: boot even when `SeasonPlayer` has no rows.
    pub allow_empty_db: bool,
    pub schema_mode: SchemaMode,
    /// `RACE_SECRET_KEY`, trimmed. Empty means every admin request is refused (fail closed).
    pub race_secret_key: String,
    /// Google OAuth client ids an ID token may be issued for: `GOOGLE_CLIENT_ID` and
    /// `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, trimmed, empty ones dropped, deduplicated, in that order
    /// (`googleAudiences()` in `lib/auth/google.ts` on main). Empty: Google sign-in is off.
    pub google_audiences: Vec<String>,
    /// Where Google's signing keys are fetched. Always Google's URL outside dev;
    /// `AUTODUCK_GOOGLE_JWKS_URL` overrides it in dev only (tests serve a local JWKS).
    pub google_jwks_url: String,
}

/// `"<set>"` / `"<empty>"` instead of a secret's value.
pub(crate) fn redacted(secret: &str) -> &'static str {
    if secret.is_empty() {
        "<empty>"
    } else {
        "<set>"
    }
}

impl std::fmt::Debug for Config {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Destructured so a new field can't be added without deciding how it prints.
        let Config {
            env,
            db_path,
            bind,
            dist_dir,
            lock_path,
            lock_wait,
            backup_dir,
            backup_enabled,
            allow_empty_db,
            schema_mode,
            race_secret_key,
            google_audiences,
            google_jwks_url,
        } = self;
        f.debug_struct("Config")
            .field("env", env)
            .field("db_path", db_path)
            .field("bind", bind)
            .field("dist_dir", dist_dir)
            .field("lock_path", lock_path)
            .field("lock_wait", lock_wait)
            .field("backup_dir", backup_dir)
            .field("backup_enabled", backup_enabled)
            .field("allow_empty_db", allow_empty_db)
            .field("schema_mode", schema_mode)
            .field("race_secret_key", &redacted(race_secret_key))
            .field("google_audiences", google_audiences)
            .field("google_jwks_url", google_jwks_url)
            .finish()
    }
}

impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_lookup(|name| std::env::var(name).ok())
    }

    pub fn from_lookup(lookup: impl Fn(&str) -> Option<String>) -> Result<Self, ConfigError> {
        let get = |name: &str| lookup(name).filter(|value| !value.trim().is_empty());

        let env = match get("AUTODUCK_ENV").as_deref().map(str::trim) {
            None | Some("production") | Some("prod") => AppEnv::Production,
            Some("staging") => AppEnv::Staging,
            Some("dev") | Some("development") | Some("test") => AppEnv::Dev,
            Some(other) => {
                return Err(ConfigError::Invalid {
                    name: "AUTODUCK_ENV",
                    value: other.to_owned(),
                    reason: "expected dev, staging or production",
                });
            }
        };

        let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/"));
        let db_path = match get("DATABASE_URL") {
            Some(url) => parse_database_url(&url, env, &cwd)?,
            // The TS default (prisma.config.ts) is only acceptable for local development.
            None if env == AppEnv::Dev => cwd.join("prisma").join("dev.db"),
            None => return Err(DatabaseUrlError::Missing.into()),
        };
        let db_dir = db_path
            .parent()
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("/"));

        let port = match get("PORT") {
            None => 3000,
            Some(value) => value
                .trim()
                .parse::<u16>()
                .map_err(|_| ConfigError::Invalid {
                    name: "PORT",
                    value,
                    reason: "expected a TCP port",
                })?,
        };
        let host = match get("HOST") {
            None => IpAddr::V4(Ipv4Addr::UNSPECIFIED),
            Some(value) => value
                .trim()
                .parse::<IpAddr>()
                .map_err(|_| ConfigError::Invalid {
                    name: "HOST",
                    value,
                    reason: "expected an IP address",
                })?,
        };

        let lock_wait_secs = match get("AUTODUCK_LOCK_WAIT_SECS") {
            None => 150,
            Some(value) => value
                .trim()
                .parse::<u64>()
                .map_err(|_| ConfigError::Invalid {
                    name: "AUTODUCK_LOCK_WAIT_SECS",
                    value,
                    reason: "expected whole seconds",
                })?,
        };

        let schema_mode = match get("AUTODUCK_SCHEMA_MODE").as_deref().map(str::trim) {
            None | Some("compat") => SchemaMode::Compat,
            Some("owned") => SchemaMode::Owned,
            Some(other) => {
                return Err(ConfigError::Invalid {
                    name: "AUTODUCK_SCHEMA_MODE",
                    value: other.to_owned(),
                    reason: "expected compat or owned",
                });
            }
        };

        Ok(Config {
            env,
            bind: SocketAddr::new(host, port),
            dist_dir: get("AUTODUCK_DIST_DIR")
                .map(|value| cwd.join(value.trim()))
                .unwrap_or_else(|| cwd.join("dist")),
            lock_path: get("AUTODUCK_LOCK_PATH")
                .map(|value| cwd.join(value.trim()))
                .unwrap_or_else(|| db_dir.join("autoduck.lock")),
            lock_wait: Duration::from_secs(lock_wait_secs),
            backup_dir: get("AUTODUCK_BACKUP_DIR")
                .map(|value| cwd.join(value.trim()))
                .unwrap_or_else(|| db_dir.join("backups")),
            backup_enabled: get("AUTODUCK_BACKUP").as_deref().map(str::trim) != Some("0"),
            allow_empty_db: get("AUTODUCK_ALLOW_EMPTY_DB").as_deref().map(str::trim) == Some("1"),
            schema_mode,
            race_secret_key: lookup("RACE_SECRET_KEY")
                .map(|value| crate::auth::js_trim(&value).to_owned())
                .unwrap_or_default(),
            google_audiences: crate::auth::google::google_audiences(
                lookup("GOOGLE_CLIENT_ID").as_deref(),
                lookup("NEXT_PUBLIC_GOOGLE_CLIENT_ID").as_deref(),
            ),
            google_jwks_url: match get("AUTODUCK_GOOGLE_JWKS_URL") {
                Some(url) if env == AppEnv::Dev => url.trim().to_owned(),
                _ => crate::auth::google::GOOGLE_JWKS_URL.to_owned(),
            },
            db_path,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn config(vars: &[(&str, &str)]) -> Result<Config, ConfigError> {
        let map: HashMap<String, String> = vars
            .iter()
            .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
            .collect();
        Config::from_lookup(|name| map.get(name).cloned())
    }

    #[test]
    fn production_requires_database_url() {
        assert!(matches!(
            config(&[]),
            Err(ConfigError::DatabaseUrl(DatabaseUrlError::Missing))
        ));
    }

    #[test]
    fn production_requires_absolute_path() {
        assert!(config(&[("DATABASE_URL", "file:./prisma/dev.db")]).is_err());
        let ok = config(&[("DATABASE_URL", "file:/app/data/autoduck.db")]).unwrap();
        assert_eq!(ok.db_path, PathBuf::from("/app/data/autoduck.db"));
        assert_eq!(ok.lock_path, PathBuf::from("/app/data/autoduck.lock"));
        assert_eq!(ok.backup_dir, PathBuf::from("/app/data/backups"));
        assert_eq!(ok.bind.port(), 3000);
        assert_eq!(ok.env, AppEnv::Production);
        assert_eq!(ok.schema_mode, SchemaMode::Compat);
        assert!(ok.backup_enabled);
        assert!(!ok.allow_empty_db);
    }

    #[test]
    fn dev_defaults_to_prisma_dev_db() {
        let ok = config(&[("AUTODUCK_ENV", "dev")]).unwrap();
        assert!(ok.db_path.ends_with("prisma/dev.db"));
    }

    #[test]
    fn rejects_unknown_values() {
        let url = ("DATABASE_URL", "file:/x.db");
        assert!(config(&[url, ("AUTODUCK_ENV", "prodd")]).is_err());
        assert!(config(&[url, ("AUTODUCK_SCHEMA_MODE", "strict")]).is_err());
        assert!(config(&[url, ("PORT", "http")]).is_err());
    }

    #[test]
    fn secret_is_trimmed_and_google_falls_back() {
        let ok = config(&[
            ("DATABASE_URL", "file:/x.db"),
            ("RACE_SECRET_KEY", "  abc  "),
            ("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "client"),
        ])
        .unwrap();
        assert_eq!(ok.race_secret_key, "abc");
        assert_eq!(ok.google_audiences, ["client"]);
        assert_eq!(ok.google_jwks_url, crate::auth::google::GOOGLE_JWKS_URL);
        let both = config(&[
            ("DATABASE_URL", "file:/x.db"),
            ("GOOGLE_CLIENT_ID", " server "),
            ("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "public"),
            ("AUTODUCK_GOOGLE_JWKS_URL", "http://127.0.0.1:1/jwks"),
        ])
        .unwrap();
        assert_eq!(both.google_audiences, ["server", "public"]);
        // The JWKS override is honoured in dev only.
        assert_eq!(both.google_jwks_url, crate::auth::google::GOOGLE_JWKS_URL);
        let dev = config(&[
            ("AUTODUCK_ENV", "dev"),
            ("AUTODUCK_GOOGLE_JWKS_URL", "http://127.0.0.1:1/jwks"),
        ])
        .unwrap();
        assert_eq!(dev.google_jwks_url, "http://127.0.0.1:1/jwks");
    }
}
