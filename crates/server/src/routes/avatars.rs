//! `GET /api/avatars/{userId}`: serves a user's avatar from our own origin.
//!
//! Ported from `app/api/avatars/[userId]/route.ts` (commit `402676b`). The race canvas (WebGL)
//! can only read images whose host sends CORS headers; Google, Slack and R2 avatars don't, so
//! the canvas loads them through here. Only the URL stored on the user is ever fetched, never
//! one from the request.
//!
//! Same responses as TS (status, plain-text error bodies, `SAFE_HEADERS`), plus a Rust-only
//! SSRF guard (D24) on the remote fetch:
//! - the target must resolve only to public unicast addresses: loopback, private, CGNAT,
//!   link-local, ULA, multicast, documentation, benchmarking, NAT64/6to4/mapped forms of those
//!   and similar ranges are refused ([`is_public_ip`]). DNS answers are checked by our resolver
//!   and the connection uses exactly those checked addresses, so a rebinding answer can't slip
//!   in between check and connect; IP-literal hosts are checked before the request and on every
//!   redirect;
//! - at most [`MAX_REDIRECTS`] redirects, http(s) only; no proxies;
//! - [`TIMEOUT`] for the whole exchange including the body; the body is read with a
//!   [`MAX_BYTES`] cap instead of being buffered whole first.
//!
//! A refused target answers like any failed fetch: `502 Avatar unavailable`.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use axum::Router;
use axum::body::Body;
use axum::extract::rejection::PathRejection;
use axum::extract::{Path, State};
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use reqwest::Url;
use reqwest::dns::{Addrs, Name, Resolve, Resolving};

use crate::auth::base64::node_base64;
use crate::auth::{is_js_whitespace, js_trim};
use crate::http::AppState;

pub const MAX_BYTES: usize = 2 * 1024 * 1024;
pub const TIMEOUT: Duration = Duration::from_millis(6000);
pub const MAX_REDIRECTS: usize = 10;

/// Remote SVGs are served same-origin: forbid scripts in case one is opened directly.
const SAFE_HEADERS: [(&str, &str); 3] = [
    (
        "content-security-policy",
        "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
    ),
    ("x-content-type-options", "nosniff"),
    (
        "cache-control",
        "public, max-age=3600, stale-while-revalidate=86400",
    ),
];

pub fn router() -> Router<AppState> {
    Router::new().route("/avatars/{user_id}", get(get_avatar))
}

/// `new Response('…', { status })`: a plain-text body with the Fetch default content type.
fn text(status: StatusCode, body: &'static str) -> Response {
    (
        status,
        [(header::CONTENT_TYPE, "text/plain;charset=UTF-8")],
        body,
    )
        .into_response()
}

fn image(content_type: &str, body: Vec<u8>) -> Response {
    let Ok(content_type) = HeaderValue::from_str(content_type) else {
        return text(StatusCode::BAD_GATEWAY, "Avatar unavailable");
    };
    let mut response = Response::new(Body::from(body));
    let headers = response.headers_mut();
    for (name, value) in SAFE_HEADERS {
        headers.insert(name, HeaderValue::from_static(value));
    }
    headers.insert(header::CONTENT_TYPE, content_type);
    response
}

/// `Number.parseInt(value, 10)` followed by `Number.isSafeInteger`.
pub fn parse_user_id(value: &str) -> Option<i64> {
    const MAX_SAFE: i64 = (1 << 53) - 1;
    let rest = value.trim_start_matches(is_js_whitespace);
    let (negative, rest) = match rest.as_bytes().first() {
        Some(b'-') => (true, &rest[1..]),
        Some(b'+') => (false, &rest[1..]),
        _ => (false, rest),
    };
    let digits = rest.bytes().take_while(u8::is_ascii_digit);
    let mut magnitude: i64 = 0;
    let mut any = false;
    for digit in digits {
        any = true;
        // Past MAX_SAFE the double parseInt returns is not a safe integer either.
        magnitude = magnitude
            .checked_mul(10)
            .and_then(|m| m.checked_add(i64::from(digit - b'0')))
            .filter(|&m| m <= MAX_SAFE)?;
    }
    any.then_some(if negative { -magnitude } else { magnitude })
}

async fn get_avatar(
    State(state): State<AppState>,
    path: Result<Path<String>, PathRejection>,
) -> Response {
    // Invalid UTF-8 in the segment: the same answer as any other non-number (accept-list
    // `path-invalid-utf8`; TS answers 500).
    let Some(user_id) = path.ok().and_then(|Path(raw)| parse_user_id(&raw)) else {
        return text(StatusCode::BAD_REQUEST, "Invalid user");
    };
    let avatar_url = match sqlx::query_scalar!(
        r#"SELECT "avatarUrl" AS "avatar_url" FROM "User" WHERE "id" = ?"#,
        user_id
    )
    .fetch_optional(&state.db().reader)
    .await
    {
        Ok(row) => row.flatten(),
        Err(err) => {
            tracing::error!(error = %err, "avatar lookup failed");
            return text(StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error");
        }
    };
    let avatar_url = avatar_url.as_deref().map(js_trim).unwrap_or("");
    if avatar_url.is_empty() {
        return text(StatusCode::NOT_FOUND, "No avatar");
    }

    if avatar_url.starts_with("data:image/") {
        return data_url(avatar_url);
    }

    let Ok(target) = Url::parse(avatar_url) else {
        return text(StatusCode::UNPROCESSABLE_ENTITY, "Bad avatar");
    };
    if !matches!(target.scheme(), "http" | "https") {
        return text(StatusCode::UNPROCESSABLE_ENTITY, "Bad avatar");
    }
    fetch_remote(guarded_client(), target, true).await
}

/// `/^data:(image\/[\w.+-]+)(;base64)?,([\s\S]*)$/`, then `Buffer.from(…, 'base64')` or
/// `Buffer.from(decodeURIComponent(…))`.
fn data_url(url: &str) -> Response {
    let rest = &url["data:".len()..];
    let subtype_len = rest["image/".len()..]
        .bytes()
        .take_while(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.' | b'+' | b'-'))
        .count();
    if subtype_len == 0 {
        return text(StatusCode::UNPROCESSABLE_ENTITY, "Bad avatar");
    }
    let (mime, rest) = rest.split_at("image/".len() + subtype_len);
    let (base64, payload) = if let Some(payload) = rest.strip_prefix(";base64,") {
        (true, payload)
    } else if let Some(payload) = rest.strip_prefix(',') {
        (false, payload)
    } else {
        return text(StatusCode::UNPROCESSABLE_ENTITY, "Bad avatar");
    };
    let body = if base64 {
        node_base64(payload)
    } else {
        match decode_uri_component(payload) {
            Some(bytes) => bytes,
            // decodeURIComponent throws (URIError) and the TS handler doesn't catch it.
            None => return text(StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error"),
        }
    };
    image(mime, body)
}

/// `decodeURIComponent(value)` re-encoded as UTF-8: every `%XX` decoded, `None` when an escape
/// is malformed or the result isn't valid UTF-8 (where JS throws `URIError`).
fn decode_uri_component(value: &str) -> Option<Vec<u8>> {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = bytes.get(index + 1..index + 3)?;
            let hex = std::str::from_utf8(hex).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(out).ok().map(String::into_bytes)
}

/// True when `ip` is a public unicast address the proxy may connect to.
pub fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => is_public_v4(ip),
        IpAddr::V6(ip) => is_public_v6(ip),
    }
}

fn is_public_v4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    !(a == 0                                   // "this network"
        || a == 10                             // private
        || (a == 100 && (64..=127).contains(&b)) // CGNAT
        || a == 127                            // loopback
        || (a == 169 && b == 254)              // link-local (cloud metadata)
        || (a == 172 && (16..=31).contains(&b)) // private
        || (a == 192 && b == 0 && c == 0)      // IETF protocol assignments
        || (a == 192 && b == 0 && c == 2)      // TEST-NET-1
        || (a == 192 && b == 88 && c == 99)    // 6to4 relay anycast
        || (a == 192 && b == 168)              // private
        || (a == 198 && (b == 18 || b == 19))  // benchmarking
        || (a == 198 && b == 51 && c == 100)   // TEST-NET-2
        || (a == 203 && b == 0 && c == 113)    // TEST-NET-3
        || a >= 224) // multicast, reserved, broadcast
}

fn is_public_v6(ip: Ipv6Addr) -> bool {
    let s = ip.segments();
    let embedded = |hi: u16, lo: u16| {
        let [a, b] = hi.to_be_bytes();
        let [c, d] = lo.to_be_bytes();
        Ipv4Addr::new(a, b, c, d)
    };
    // ::/96 (unspecified, loopback, IPv4-compatible) and ::ffff:0:0/96 (IPv4-mapped).
    if s[..5] == [0; 5] && (s[5] == 0 || s[5] == 0xffff) {
        return is_public_v4(embedded(s[6], s[7]));
    }
    // 64:ff9b::/96 NAT64 well-known prefix.
    if s[..6] == [0x64, 0xff9b, 0, 0, 0, 0] {
        return is_public_v4(embedded(s[6], s[7]));
    }
    // 2002::/16 6to4.
    if s[0] == 0x2002 {
        return is_public_v4(embedded(s[1], s[2]));
    }
    // The rest of 0000::/8 is reserved, including ::ffff:0:0:0/96 (SIIT "IPv4-translated",
    // `::ffff:0:7f00:1`, which some stacks route to the embedded IPv4; review 2, finding 2).
    if s[0] & 0xff00 == 0 {
        return false;
    }
    !((s[0] == 0x64 && s[1] == 0xff9b && s[2] == 1) // 64:ff9b:1::/48 local NAT64
        || (s[0] == 0x100 && s[1..4] == [0, 0, 0])  // 100::/64 discard
        || (s[0] == 0x2001 && s[1] < 0x200)         // 2001::/23 IETF (Teredo, benchmarking, ORCHID)
        || (s[0] == 0x2001 && s[1] == 0xdb8)        // documentation
        || (s[0] & 0xfff0) == 0x3ff0                // 3fff::/20 documentation
        || s[0] == 0x5f00                           // 5f00::/16 SRv6 SIDs
        || (s[0] & 0xfe00) == 0xfc00                // fc00::/7 unique local
        || (s[0] & 0xffc0) == 0xfe80                // fe80::/10 link-local
        || (s[0] & 0xffc0) == 0xfec0                // fec0::/10 site-local
        || (s[0] & 0xff00) == 0xff00) // multicast
}

/// An IP-literal host that isn't public. Domain names are checked by [`PublicOnlyResolver`].
/// The URL parser has already canonicalised every IPv4 spelling (`2130706433`, `0x7f.1`).
fn literal_host_blocked(url: &Url) -> bool {
    let Some(host) = url.host_str() else {
        return true;
    };
    let host = host
        .strip_prefix('[')
        .and_then(|h| h.strip_suffix(']'))
        .unwrap_or(host);
    host.parse::<IpAddr>().is_ok_and(|ip| !is_public_ip(ip))
}

/// Resolves with the system resolver and refuses the name if **any** answer isn't public, so
/// a split answer can't steer one of the connection attempts inward.
struct PublicOnlyResolver;

impl Resolve for PublicOnlyResolver {
    fn resolve(&self, name: Name) -> Resolving {
        let host = name.as_str().to_owned();
        Box::pin(async move {
            let addrs: Vec<SocketAddr> =
                tokio::net::lookup_host((host.as_str(), 0)).await?.collect();
            if addrs.is_empty() {
                return Err(format!("{host}: no addresses").into());
            }
            if let Some(blocked) = addrs.iter().find(|addr| !is_public_ip(addr.ip())) {
                tracing::warn!(%host, ip = %blocked.ip(), "avatar fetch refused: non-public address");
                return Err(format!("{host}: non-public address").into());
            }
            Ok(Box::new(addrs.into_iter()) as Addrs)
        })
    }
}

fn build_client(guarded: bool) -> reqwest::Client {
    let redirect = reqwest::redirect::Policy::custom(move |attempt| {
        if attempt.previous().len() >= MAX_REDIRECTS {
            return attempt.error("too many redirects");
        }
        let url = attempt.url();
        if !matches!(url.scheme(), "http" | "https") {
            tracing::warn!(
                scheme = url.scheme(),
                "avatar redirect refused: not http(s)"
            );
            return attempt.error("redirect to a non-http(s) URL");
        }
        if guarded && literal_host_blocked(url) {
            tracing::warn!(host = ?url.host_str(), "avatar redirect refused: non-public address");
            return attempt.error("redirect to a non-public address");
        }
        attempt.follow()
    });
    let builder = reqwest::Client::builder()
        .no_proxy()
        .redirect(redirect)
        .timeout(TIMEOUT)
        .user_agent(concat!("autoduck-avatar-proxy/", env!("CARGO_PKG_VERSION")));
    let builder = if guarded {
        builder.dns_resolver(Arc::new(PublicOnlyResolver))
    } else {
        builder
    };
    builder.build().expect("the avatar HTTP client must build")
}

fn guarded_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| build_client(true))
}

/// The remote half of the TS handler: `fetch` with a 6 s abort, image types only, 2 MiB cap.
async fn fetch_remote(client: &reqwest::Client, target: Url, guarded: bool) -> Response {
    if guarded && literal_host_blocked(&target) {
        tracing::warn!(host = ?target.host_str(), "avatar fetch refused: non-public address");
        return text(StatusCode::BAD_GATEWAY, "Avatar unavailable");
    }
    let unavailable = || text(StatusCode::BAD_GATEWAY, "Avatar unavailable");
    let too_large = || text(StatusCode::PAYLOAD_TOO_LARGE, "Avatar too large");
    let Ok(mut upstream) = client
        .get(target)
        .header(reqwest::header::ACCEPT, "image/*")
        .send()
        .await
    else {
        return unavailable();
    };
    // `headers.get('content-type')?.split(';')[0]?.trim() ?? ''` (case kept, as in TS).
    let content_type = upstream
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .map(|value| String::from_utf8_lossy(value.as_bytes()).into_owned())
        .unwrap_or_default();
    let content_type = js_trim(content_type.split(';').next().unwrap_or("")).to_owned();
    if !upstream.status().is_success() || !content_type.starts_with("image/") {
        return unavailable();
    }
    if upstream
        .content_length()
        .is_some_and(|declared| declared > MAX_BYTES as u64)
    {
        return too_large();
    }
    let mut body = Vec::new();
    loop {
        match upstream.chunk().await {
            Ok(Some(chunk)) => {
                if body.len() + chunk.len() > MAX_BYTES {
                    return too_large();
                }
                body.extend_from_slice(&chunk);
            }
            Ok(None) => break,
            Err(_) => return unavailable(),
        }
    }
    image(&content_type, body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::routing::get as get_route;

    #[test]
    fn parse_int_semantics() {
        assert_eq!(parse_user_id("12"), Some(12));
        assert_eq!(parse_user_id("12abc"), Some(12));
        assert_eq!(parse_user_id("  \u{feff}7"), Some(7));
        assert_eq!(parse_user_id("+5"), Some(5));
        assert_eq!(parse_user_id("-3"), Some(-3));
        assert_eq!(parse_user_id("-0"), Some(0));
        assert_eq!(parse_user_id("1e3"), Some(1));
        assert_eq!(parse_user_id("0x10"), Some(0));
        assert_eq!(
            parse_user_id("9007199254740991"),
            Some(9_007_199_254_740_991)
        );
        assert_eq!(parse_user_id("9007199254740992"), None);
        assert_eq!(parse_user_id("99999999999999999999999"), None);
        assert_eq!(parse_user_id("abc"), None);
        assert_eq!(parse_user_id(""), None);
        assert_eq!(parse_user_id("-"), None);
        assert_eq!(parse_user_id(" - 1"), None);
    }

    #[test]
    fn uri_component_decoding() {
        assert_eq!(decode_uri_component("a%20b+c").unwrap(), b"a b+c");
        assert_eq!(decode_uri_component("%3Csvg%3E").unwrap(), b"<svg>");
        assert_eq!(decode_uri_component("%C3%A9").unwrap(), "é".as_bytes());
        assert_eq!(decode_uri_component("é").unwrap(), "é".as_bytes());
        assert!(decode_uri_component("%").is_none());
        assert!(decode_uri_component("%zz").is_none());
        assert!(decode_uri_component("%C3").is_none());
        assert!(decode_uri_component("%ED%A0%80").is_none());
    }

    #[test]
    fn public_address_classification() {
        let blocked = [
            "0.0.0.0",
            "10.1.2.3",
            "100.64.0.1",
            "127.0.0.1",
            "169.254.169.254",
            "172.16.0.1",
            "172.31.255.255",
            "192.0.0.8",
            "192.0.2.1",
            "192.168.1.1",
            "198.18.0.1",
            "198.51.100.1",
            "203.0.113.9",
            "224.0.0.1",
            "255.255.255.255",
            "::",
            "::1",
            "::ffff:127.0.0.1",
            "::ffff:10.0.0.1",
            "::127.0.0.1",
            "::ffff:0:7f00:1",
            "::ffff:0:808:808",
            "1::1",
            "64:ff9b::a9fe:a9fe",
            "2002:7f00:1::",
            "2001::1",
            "2001:db8::1",
            "fc00::1",
            "fd12:3456::1",
            "fe80::1",
            "fec0::1",
            "ff02::1",
        ];
        for ip in blocked {
            assert!(!is_public_ip(ip.parse().unwrap()), "{ip} must be refused");
        }
        let allowed = [
            "8.8.8.8",
            "142.250.72.1",
            "172.32.0.1",
            "100.128.0.1",
            "2001:4860:4860::8888",
            "2606:4700::1111",
            "::ffff:8.8.8.8",
            "2002:0808:0808::",
        ];
        for ip in allowed {
            assert!(is_public_ip(ip.parse().unwrap()), "{ip} must be allowed");
        }
    }

    #[test]
    fn literal_hosts_are_checked() {
        for url in [
            "http://127.0.0.1/a.png",
            "http://2130706433/a.png",
            "http://0x7f.1/a.png",
            "http://[::1]/a.png",
            "http://[::ffff:169.254.169.254]/",
            "https://10.0.0.1:8443/x",
        ] {
            assert!(literal_host_blocked(&Url::parse(url).unwrap()), "{url}");
        }
        assert!(!literal_host_blocked(
            &Url::parse("https://lh3.googleusercontent.com/a/x").unwrap()
        ));
        assert!(!literal_host_blocked(
            &Url::parse("http://8.8.8.8/").unwrap()
        ));
    }

    #[tokio::test]
    async fn resolver_refuses_names_pointing_inward() {
        let resolved = PublicOnlyResolver
            .resolve("localhost".parse().unwrap())
            .await;
        assert!(resolved.is_err());
    }

    #[tokio::test]
    async fn guarded_fetch_refuses_loopback() {
        // Literal and DNS forms both fail before any connection is made.
        for url in ["http://127.0.0.1:9/a.png", "http://localhost:9/a.png"] {
            let response = fetch_remote(guarded_client(), Url::parse(url).unwrap(), true).await;
            assert_eq!(response.status(), StatusCode::BAD_GATEWAY, "{url}");
        }
    }

    async fn upstream() -> String {
        let big = vec![b'x'; MAX_BYTES + 1];
        let app = Router::new()
            .route(
                "/ok.png",
                get_route(|| async { ([(header::CONTENT_TYPE, "image/png; q=1")], "PNG") }),
            )
            .route(
                "/page",
                get_route(|| async { ([(header::CONTENT_TYPE, "text/html")], "<html>") }),
            )
            .route(
                "/upper.png",
                get_route(|| async { ([(header::CONTENT_TYPE, "Image/PNG")], "PNG") }),
            )
            .route(
                "/missing.png",
                get_route(|| async {
                    (
                        StatusCode::NOT_FOUND,
                        [(header::CONTENT_TYPE, "image/png")],
                        "",
                    )
                }),
            )
            .route(
                "/big.png",
                get_route(move || {
                    let big = big.clone();
                    async move { ([(header::CONTENT_TYPE, "image/png")], big) }
                }),
            )
            .route(
                "/redirect",
                get_route(|| async { (StatusCode::FOUND, [(header::LOCATION, "/ok.png")], "") }),
            )
            .route(
                "/slow.png",
                get_route(|| async {
                    tokio::time::sleep(TIMEOUT + Duration::from_secs(2)).await;
                    ([(header::CONTENT_TYPE, "image/png")], "late")
                }),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        format!("http://{addr}")
    }

    /// A raw HTTP/1.1 server that sends more than `MAX_BYTES` with no `Content-Length`, so
    /// only the streaming cap can stop it.
    async fn unsized_upstream() -> String {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            while let Ok((mut socket, _)) = listener.accept().await {
                tokio::spawn(async move {
                    let mut request = [0u8; 4096];
                    let _ = socket.read(&mut request).await;
                    let head =
                        "HTTP/1.1 200 OK\r\ncontent-type: image/png\r\nconnection: close\r\n\r\n";
                    if socket.write_all(head.as_bytes()).await.is_err() {
                        return;
                    }
                    let chunk = vec![b'y'; 64 * 1024];
                    for _ in 0..(MAX_BYTES / chunk.len() + 4) {
                        if socket.write_all(&chunk).await.is_err() {
                            return;
                        }
                    }
                });
            }
        });
        format!("http://{addr}/unsized.png")
    }

    async fn body_of(response: Response) -> Vec<u8> {
        use http_body_util::BodyExt;
        response
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes()
            .to_vec()
    }

    #[tokio::test]
    async fn remote_fetch_matches_the_ts_handler() {
        let base = upstream().await;
        let client = build_client(false);
        let get = |path: &str| {
            let url = Url::parse(&format!("{base}{path}")).unwrap();
            let client = client.clone();
            async move { fetch_remote(&client, url, false).await }
        };

        let ok = get("/ok.png").await;
        assert_eq!(ok.status(), StatusCode::OK);
        assert_eq!(ok.headers()[header::CONTENT_TYPE], "image/png");
        assert_eq!(ok.headers()[header::X_CONTENT_TYPE_OPTIONS], "nosniff");
        assert_eq!(
            ok.headers()[header::CACHE_CONTROL],
            "public, max-age=3600, stale-while-revalidate=86400"
        );
        assert!(
            ok.headers()[header::CONTENT_SECURITY_POLICY]
                .to_str()
                .unwrap()
                .ends_with("sandbox")
        );
        assert_eq!(body_of(ok).await, b"PNG");

        let redirected = get("/redirect").await;
        assert_eq!(redirected.status(), StatusCode::OK);

        for (path, status) in [
            ("/page", StatusCode::BAD_GATEWAY),
            ("/upper.png", StatusCode::BAD_GATEWAY),
            ("/missing.png", StatusCode::BAD_GATEWAY),
            ("/big.png", StatusCode::PAYLOAD_TOO_LARGE),
        ] {
            let response = get(path).await;
            assert_eq!(response.status(), status, "{path}");
        }
        let unsized_url = Url::parse(&unsized_upstream().await).unwrap();
        assert_eq!(
            fetch_remote(&client, unsized_url, false).await.status(),
            StatusCode::PAYLOAD_TOO_LARGE
        );
    }

    #[tokio::test]
    async fn remote_fetch_times_out() {
        let base = upstream().await;
        let started = std::time::Instant::now();
        let response = fetch_remote(
            &build_client(false),
            Url::parse(&format!("{base}/slow.png")).unwrap(),
            false,
        )
        .await;
        assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
        assert!(started.elapsed() < TIMEOUT + Duration::from_secs(1));
    }

    #[test]
    fn data_urls() {
        let ok = data_url("data:image/png;base64,UE5H");
        assert_eq!(ok.status(), StatusCode::OK);
        assert_eq!(ok.headers()[header::CONTENT_TYPE], "image/png");
        let svg = data_url("data:image/svg+xml,%3Csvg%3E");
        assert_eq!(svg.status(), StatusCode::OK);
        assert_eq!(svg.headers()[header::CONTENT_TYPE], "image/svg+xml");
        for bad in [
            "data:image/,abc",
            "data:image/png;charset=utf-8;base64,UE5H",
            "data:image/png;base64x,UE5H",
            "data:image/png",
        ] {
            assert_eq!(
                data_url(bad).status(),
                StatusCode::UNPROCESSABLE_ENTITY,
                "{bad}"
            );
        }
        assert_eq!(
            data_url("data:image/svg+xml,%E0%A4%A").status(),
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }
}
