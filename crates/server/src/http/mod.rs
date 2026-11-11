//! HTTP: the router, shared state and the server loop.
//!
//! - `/api/*` → API routes ([`crate::routes`], [`health`]); a miss is a JSON 404, never the SPA.
//! - everything else → [`static_files`] (`dist/` with SPA fallback for extensionless paths).
//! - every response gets [`headers::security_headers`]; requests are logged without query
//!   strings ([`headers::request_log`]), since tokens and secrets travel in the query.
//! - slow clients are cut off: request headers (and an idle keep-alive) get
//!   [`HEADER_READ_TIMEOUT`], an `/api` request gets [`headers::API_DEADLINE`] in total
//!   (body included), and request bodies are capped at [`BODY_LIMIT`].

pub mod csp_report;
pub mod headers;
pub mod health;
pub mod static_files;

use std::sync::Arc;
use std::time::Duration;

use axum::Router;
use axum::extract::DefaultBodyLimit;
use axum::middleware;
use axum::routing::get;
use hyper_util::rt::{TokioIo, TokioTimer};
use hyper_util::server::graceful::GracefulShutdown;
use hyper_util::service::TowerToHyperService;

use crate::config::Config;
use crate::db::Db;
use crate::error::ApiError;

#[derive(Clone)]
pub struct AppState(Arc<Inner>);

struct Inner {
    config: Config,
    db: Db,
    static_files: static_files::StaticFiles,
    live: crate::live::LiveHub,
}

impl AppState {
    /// Production state: a live hub with the default options (real-time pacing).
    pub fn new(config: Config, db: Db) -> Self {
        let live = crate::live::LiveHub::new(db.clone(), crate::live::LiveOptions::default());
        Self::with_live(config, db, live)
    }

    /// State with a given live hub (tests: unpaced driver, short countdown).
    pub fn with_live(config: Config, db: Db, live: crate::live::LiveHub) -> Self {
        let static_files = static_files::StaticFiles::new(&config.dist_dir);
        AppState(Arc::new(Inner {
            config,
            db,
            static_files,
            live,
        }))
    }

    /// The live race registry (Phase 5).
    pub fn live(&self) -> &crate::live::LiveHub {
        &self.0.live
    }

    pub fn config(&self) -> &Config {
        &self.0.config
    }

    pub fn db(&self) -> &Db {
        &self.0.db
    }

    pub fn static_files(&self) -> &static_files::StaticFiles {
        &self.0.static_files
    }
}

/// Node closes a connection whose headers take longer than 60 s; hyper's own default is 30 s.
/// It also bounds how long an idle keep-alive connection waits for its next request.
pub const HEADER_READ_TIMEOUT: Duration = Duration::from_secs(30);

/// Every stage-A request body is under 1 KiB (a Google credential is the largest); TS has no
/// limit, axum's default is 2 MiB. Over the limit → JSON 413 (accept-list
/// `body-limit-413`).
pub const BODY_LIMIT: usize = 64 * 1024;

/// How long [`serve`] waits for open connections after SIGTERM before closing the pools.
const DRAIN_TIMEOUT: Duration = Duration::from_secs(30);

async fn api_not_found() -> ApiError {
    ApiError::not_found("Not found")
}

pub fn router(state: AppState) -> Router {
    let api = Router::new()
        .route("/health", get(health::get))
        .route("/csp-report", csp_report::route())
        .merge(crate::routes::router())
        .fallback(api_not_found)
        .layer(middleware::from_fn(headers::api_response))
        .layer(DefaultBodyLimit::max(BODY_LIMIT));

    let routed = Router::new()
        .nest("/api", api)
        .fallback(static_files::handler)
        .with_state(state);

    // These wrap the whole router rather than each route (`Router::layer`): they must see
    // requests before routing (canonical paths) and responses after axum has added `Allow`.
    // The first layer listed is the outermost.
    let service = tower::ServiceBuilder::new()
        .layer(middleware::from_fn(headers::request_log))
        .layer(middleware::from_fn(headers::security_headers))
        .layer(middleware::from_fn(headers::canonical_path))
        .layer(middleware::from_fn(headers::api_methods))
        .service(routed);
    Router::new().fallback_service(service)
}

/// Binds and serves until SIGTERM/SIGINT, then drains connections.
///
/// A hand-written accept loop rather than `axum::serve`: that one gives hyper no timer, so
/// `header_read_timeout` never fires and a client can hold a socket forever by trickling
/// headers (review 2, finding 1).
pub async fn serve(state: AppState) -> std::io::Result<()> {
    let bind = state.config().bind;
    let listener = tokio::net::TcpListener::bind(bind).await?;
    tracing::info!(addr = %listener.local_addr()?, dist = %state.config().dist_dir.display(), "listening");
    let app = router(state.clone());
    let mut builder = hyper::server::conn::http1::Builder::new();
    builder
        .timer(TokioTimer::new())
        .header_read_timeout(HEADER_READ_TIMEOUT)
        .keep_alive(true);
    let graceful = GracefulShutdown::new();
    let shutdown = shutdown_signal();
    tokio::pin!(shutdown);
    loop {
        tokio::select! {
            accepted = listener.accept() => {
                let stream = match accepted {
                    Ok((stream, _peer)) => stream,
                    Err(error) => {
                        // EMFILE and friends: back off instead of spinning.
                        tracing::warn!(%error, "accept failed");
                        tokio::time::sleep(Duration::from_millis(100)).await;
                        continue;
                    }
                };
                let _ = stream.set_nodelay(true);
                let service = TowerToHyperService::new(app.clone());
                let connection = graceful.watch(builder.serve_connection(TokioIo::new(stream), service));
                tokio::spawn(async move {
                    if let Err(error) = connection.await {
                        tracing::debug!(target: "autoduck::http", %error, "connection closed with an error");
                    }
                });
            }
            () = &mut shutdown => break,
        }
    }
    drop(listener);
    // D21: refuse start-race, let running races finish (≤ 120 s) while their SSE streams stay up.
    state.live().shutdown().await;
    if tokio::time::timeout(DRAIN_TIMEOUT, graceful.shutdown())
        .await
        .is_err()
    {
        tracing::warn!("connections still open after the drain timeout; closing anyway");
    }
    tracing::info!("server stopped; closing database pools");
    state.db().close().await;
    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(error) => {
                tracing::error!(%error, "cannot install the SIGTERM handler");
                std::future::pending::<()>().await;
            }
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        () = ctrl_c => {},
        () = terminate => {},
    }
    tracing::info!("shutdown signal received");
}
