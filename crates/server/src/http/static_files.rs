//! The built SPA (`dist/`), served by the same binary (plan Phase 3, "Static serving").
//!
//! - A path whose last segment has no extension (and isn't under `/api`, which never reaches
//!   here) gets `dist/index.html`: client-side routes like `/season-3` or `/admin/season-3`.
//! - A path with an extension is a file; a missing one is a plain 404, never `index.html`.
//! - `index.html` is `Cache-Control: no-cache`. Content-hashed files (Vite's `/assets/*`, and
//!   the content-addressed `/race-tracks/*`) are `public, max-age=31536000, immutable`; other
//!   public files are `public, max-age=0` (what `next start` sends for `public/`).
//! - Only GET and HEAD; `tower_http::services::ServeDir` handles ranges, conditional requests
//!   and path traversal.
//! - Dotfiles (`/.env`, `/.git/…`, also spelled `%2e…`) are 404, except `/.well-known/`
//!   (review 2, finding 9). `dist/` is our own build output, so this is defence in depth.

use std::path::{Path, PathBuf};

use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::{HeaderValue, Method, StatusCode, header};
use axum::response::{IntoResponse, Response};
use tower::ServiceExt;
use tower_http::services::{ServeDir, ServeFile};

use super::AppState;

pub const NO_CACHE: &str = "no-cache";
pub const IMMUTABLE: &str = "public, max-age=31536000, immutable";
pub const REVALIDATE: &str = "public, max-age=0";

const IMMUTABLE_PREFIXES: [&str; 2] = ["/assets/", "/race-tracks/"];

#[derive(Clone, Debug)]
pub struct StaticFiles {
    dir: PathBuf,
    index: PathBuf,
}

impl StaticFiles {
    pub fn new(dir: &Path) -> Self {
        StaticFiles {
            dir: dir.to_path_buf(),
            index: dir.join("index.html"),
        }
    }
}

/// A segment starting with a dot (raw or percent-encoded), outside `/.well-known/`.
pub fn is_hidden(path: &str) -> bool {
    path.split('/').enumerate().any(|(index, segment)| {
        let lower = segment.to_ascii_lowercase();
        let dotted = lower.starts_with('.') || lower.starts_with("%2e");
        dotted && !(index == 1 && lower == ".well-known")
    })
}

/// True when the last path segment has an extension (`/a/b.js`, `/robots.txt`).
pub fn has_extension(path: &str) -> bool {
    path.rsplit('/')
        .next()
        .is_some_and(|segment| segment.contains('.'))
}

fn cache_control(path: &str) -> &'static str {
    if path == "/index.html" {
        NO_CACHE
    } else if IMMUTABLE_PREFIXES
        .iter()
        .any(|prefix| path.starts_with(prefix))
    {
        IMMUTABLE
    } else {
        REVALIDATE
    }
}

fn not_found() -> Response {
    (
        StatusCode::NOT_FOUND,
        [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
        "Not Found",
    )
        .into_response()
}

pub async fn handler(State(state): State<AppState>, request: Request) -> Response {
    // Never the SPA for the API namespace, even for paths the nested router doesn't match
    // (`/api/` with a trailing slash).
    let path = request.uri().path();
    if path == "/api" || path.starts_with("/api/") {
        return crate::error::ApiError::not_found("Not found").into_response();
    }
    if request.method() != Method::GET && request.method() != Method::HEAD {
        return (
            StatusCode::METHOD_NOT_ALLOWED,
            [(header::ALLOW, "GET, HEAD")],
        )
            .into_response();
    }
    let files = state.static_files();
    let path = request.uri().path().to_owned();
    if is_hidden(&path) {
        return not_found();
    }

    let (response, cache) = if has_extension(&path) {
        let response = ServeDir::new(&files.dir)
            .append_index_html_on_directories(false)
            .oneshot(request)
            .await;
        (
            response.map(|response| response.map(Body::new)),
            cache_control(&path),
        )
    } else {
        let response = ServeFile::new(&files.index).oneshot(request).await;
        (response.map(|response| response.map(Body::new)), NO_CACHE)
    };

    let mut response = match response {
        Ok(response) => response,
        Err(error) => {
            tracing::error!(%error, %path, "static file error");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };
    if response.status() == StatusCode::NOT_FOUND {
        return not_found();
    }
    if response.status().is_success() || response.status() == StatusCode::NOT_MODIFIED {
        response
            .headers_mut()
            .insert(header::CACHE_CONTROL, HeaderValue::from_static(cache));
    }
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extension_detection() {
        assert!(has_extension("/assets/index-abc123.js"));
        assert!(has_extension("/robots.txt"));
        assert!(has_extension("/race-tracks/river-01-v2@deadbeef.json"));
        assert!(!has_extension("/"));
        assert!(!has_extension("/season-3"));
        assert!(!has_extension("/season-3/race/12"));
        assert!(!has_extension("/v1.2/page"));
    }

    #[test]
    fn hidden_paths() {
        for path in [
            "/.env",
            "/.git/config",
            "/a/.htaccess",
            "/%2Eenv",
            "/x/%2e%2e/y",
        ] {
            assert!(is_hidden(path), "{path}");
        }
        for path in [
            "/",
            "/robots.txt",
            "/.well-known/security.txt",
            "/v1.2/page",
        ] {
            assert!(!is_hidden(path), "{path}");
        }
    }

    #[test]
    fn cache_rules() {
        assert_eq!(cache_control("/index.html"), NO_CACHE);
        assert_eq!(cache_control("/assets/index-abc123.js"), IMMUTABLE);
        assert_eq!(
            cache_control("/race-tracks/river-01-v2@deadbeef.json"),
            IMMUTABLE
        );
        assert_eq!(
            cache_control("/cosmetics/v2/head/head-cap-red.svg"),
            REVALIDATE
        );
    }
}
