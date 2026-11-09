//! Google ID token verification, ported from `lib/auth/google.ts` on main (D24, step 0.2).
//!
//! The TS code calls `jose` 6 `jwtVerify(token, createRemoteJWKSet(GOOGLE_JWKS_URL), { issuer,
//! audience, algorithms: ['RS256'], requiredClaims: ['sub','exp','iat'], clockTolerance: 30 })`.
//! This module reproduces that check by check, in the same order, because the order decides
//! whether a bad request answers 401 (token judged) or 503 (Google's keys unavailable):
//!
//! 1. compact form (`a.b.c`), protected header (base64url → strict UTF-8 → JSON object),
//!    `crit`/`b64`, `alg` = `RS256`. A token failing here is judged without fetching keys.
//! 2. key resolution against the JWKS ([`KeySource`]): cached for 10 min, re-fetched once on an
//!    unknown `kid` unless fetched in the last 30 s. A fetch failure (network, non-200, bad
//!    JSON, malformed key set, unusable key) is [`KeysUnavailable`], not a verdict.
//! 3. RS256 signature (`jsonwebtoken`, aws-lc), then the claims set: `sub`/`exp`/`iat`/`aud`/
//!    `iss` present; `iss` one of [`GOOGLE_ISSUERS`]; `aud` one of ours; `iat`/`nbf`/`exp`
//!    numbers; `nbf` ≤ now + 30 s; `exp` > now − 30 s.
//! 4. the route's own checks: `sub` a non-empty string, `azp` (when present) one of ours.
//!
//! Never accepts raw emails, raw JSON or unsigned tokens.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use jsonwebtoken::{Algorithm, DecodingKey};
use serde_json::{Map, Value};

use super::base64::{base64url_encode, jose_base64url};
use super::js_trim;

pub const GOOGLE_ISSUERS: [&str; 2] = ["https://accounts.google.com", "accounts.google.com"];
pub const GOOGLE_JWKS_URL: &str = "https://www.googleapis.com/oauth2/v3/certs";

/// `clockTolerance: 30`.
pub const CLOCK_TOLERANCE_SECS: f64 = 30.0;
/// jose `createRemoteJWKSet` defaults.
pub const JWKS_TIMEOUT: Duration = Duration::from_secs(5);
pub const JWKS_CACHE_MAX_AGE: Duration = Duration::from_secs(600);
pub const JWKS_COOLDOWN: Duration = Duration::from_secs(30);
/// Rust-only cap on the JWKS response body (Google's is ~2 KiB).
const JWKS_MAX_BYTES: usize = 1024 * 1024;

/// `googleAudiences()`: both client ids, trimmed, empty ones dropped, deduplicated in order.
pub fn google_audiences(server: Option<&str>, public: Option<&str>) -> Vec<String> {
    let mut ids: Vec<String> = Vec::new();
    for id in [server, public] {
        let id = js_trim(id.unwrap_or(""));
        if !id.is_empty() && !ids.iter().any(|seen| seen == id) {
            ids.push(id.to_owned());
        }
    }
    ids
}

/// `googleClientId()`: the client id for the browser button (the last audience), or `""`.
pub fn google_client_id(audiences: &[String]) -> &str {
    audiences.last().map_or("", String::as_str)
}

/// `hasGoogleLink()`: a real Google account id is all ASCII digits (`/^\d+$/`).
pub fn has_google_link(google_id: Option<&str>) -> bool {
    google_id.is_some_and(|id| !id.is_empty() && id.bytes().all(|b| b.is_ascii_digit()))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GoogleProfile {
    /// Google's stable account id (`sub`). Always a verified value.
    pub google_id: String,
    pub email: Option<String>,
    pub name: Option<String>,
    pub picture: Option<String>,
    pub email_verified: bool,
}

/// Google's signing keys couldn't be obtained; the credential was not judged either way
/// (`GoogleKeysUnavailableError`).
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("Google signing keys unavailable: {0}")]
pub struct KeysUnavailable(pub String);

/// A parsed JSON Web Key Set (`createLocalJWKSet`): an object whose `keys` is an array of
/// objects. Individual keys are only validated when a token selects them, as in jose.
#[derive(Debug, Clone)]
pub struct Jwks {
    keys: Vec<Map<String, Value>>,
}

enum Resolved<'a> {
    /// `JWKSNoMatchingKey`: the remote set may be re-fetched once.
    NoMatch,
    /// `JWKSMultipleMatchingKeys`: rejected (jose 6 `jwtVerify` doesn't iterate candidates).
    Ambiguous,
    One(&'a Map<String, Value>),
}

impl Jwks {
    pub fn from_value(value: Value) -> Result<Self, KeysUnavailable> {
        let malformed = || KeysUnavailable("JSON Web Key Set malformed".into());
        let Value::Object(mut set) = value else {
            return Err(malformed());
        };
        let Some(Value::Array(keys)) = set.remove("keys") else {
            return Err(malformed());
        };
        let keys = keys
            .into_iter()
            .map(|key| match key {
                Value::Object(key) => Ok(key),
                _ => Err(malformed()),
            })
            .collect::<Result<_, _>>()?;
        Ok(Jwks { keys })
    }

    /// `isUsableJWK` for `alg = RS256` (`entry.kty = ['RSA']`, no `crv`), then the count rule.
    fn resolve(&self, kid: Option<&Value>) -> Resolved<'_> {
        let usable = |jwk: &&Map<String, Value>| {
            let ext_ok = matches!(jwk.get("ext"), None | Some(Value::Bool(_)));
            let ops_ok = match jwk.get("key_ops") {
                None => true,
                Some(Value::Array(ops)) => {
                    let strings: Option<Vec<&str>> = ops.iter().map(Value::as_str).collect();
                    strings.is_some_and(|ops| {
                        ops.iter()
                            .enumerate()
                            .all(|(index, op)| ops.iter().position(|o| o == op) == Some(index))
                            && ops.contains(&"verify")
                    })
                }
                Some(_) => false,
            };
            let kty_ok = jwk.get("kty").and_then(Value::as_str) == Some("RSA");
            let kid_ok = match kid {
                None => true,
                Some(Value::String(kid)) => jwk.get("kid").and_then(Value::as_str) == Some(kid),
                Some(_) => false,
            };
            let alg_ok = match jwk.get("alg") {
                None => true,
                Some(alg) => alg.as_str() == Some("RS256"),
            };
            let use_ok = match jwk.get("use") {
                None => true,
                Some(value) => value.as_str() == Some("sig"),
            };
            ext_ok && ops_ok && kty_ok && kid_ok && alg_ok && use_ok
        };
        let mut candidates = self.keys.iter().filter(usable);
        match (candidates.next(), candidates.next()) {
            (None, _) => Resolved::NoMatch,
            (Some(key), None) => Resolved::One(key),
            (Some(_), Some(_)) => Resolved::Ambiguous,
        }
    }
}

/// Imports the selected JWK as an RS256 public key. Like WebCrypto under jose, a key that can't
/// be imported, is private, or is shorter than 2048 bits is a key problem (503), not a verdict.
fn import_rsa(jwk: &Map<String, Value>) -> Result<DecodingKey, KeysUnavailable> {
    let unusable = |why: &str| KeysUnavailable(format!("unusable Google signing key: {why}"));
    if jwk.contains_key("d") {
        return Err(unusable("JSON Web Key Set members must be public keys"));
    }
    let component = |name: &str| {
        jwk.get(name)
            .and_then(Value::as_str)
            .and_then(jose_base64url)
            .filter(|bytes| !bytes.is_empty())
            .ok_or_else(|| unusable(name))
    };
    let n = component("n")?;
    let e = component("e")?;
    let significant = n.iter().position(|&b| b != 0).map_or(&[][..], |i| &n[i..]);
    let bits = significant.first().map_or(0, |&first| {
        significant.len() * 8 - first.leading_zeros() as usize
    });
    if bits < 2048 {
        return Err(unusable(
            "RS256 requires key modulusLength to be 2048 bits or larger",
        ));
    }
    Ok(DecodingKey::from_rsa_raw_components(&n, &e))
}

/// Where the verifier gets Google's keys.
pub enum KeySource<'a> {
    /// A fixed key set (`createLocalJWKSet`), for tests.
    Local(&'a Jwks),
    /// The cached remote set (`createRemoteJWKSet`).
    Remote(&'a RemoteJwks),
}

#[derive(Debug)]
struct Cached {
    fetched_at: Instant,
    jwks: Arc<Jwks>,
}

/// `createRemoteJWKSet` with jose's defaults: 5 s timeout, 10 min cache, 30 s cooldown before
/// re-fetching for an unknown `kid`, no redirects, concurrent reloads coalesced (callers wait
/// on the same fetch through the async mutex).
#[derive(Debug)]
pub struct RemoteJwks {
    url: String,
    client: reqwest::Client,
    state: tokio::sync::Mutex<Option<Cached>>,
}

impl RemoteJwks {
    pub fn new(url: &str) -> Self {
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(JWKS_TIMEOUT)
            .user_agent(concat!("autoduck/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("the JWKS HTTP client must build");
        RemoteJwks {
            url: url.to_owned(),
            client,
            state: tokio::sync::Mutex::new(None),
        }
    }

    /// The process-wide cached set for `url` (one per URL, like the TS module-level cache).
    pub fn shared(url: &str) -> Arc<RemoteJwks> {
        static REGISTRY: OnceLock<Mutex<BTreeMap<String, Arc<RemoteJwks>>>> = OnceLock::new();
        let registry = REGISTRY.get_or_init(Default::default);
        let mut registry = registry.lock().unwrap_or_else(|poison| poison.into_inner());
        registry
            .entry(url.to_owned())
            .or_insert_with(|| Arc::new(RemoteJwks::new(url)))
            .clone()
    }

    async fn fetch(&self) -> Result<Jwks, KeysUnavailable> {
        let unavailable = |error: &dyn std::fmt::Display| KeysUnavailable(error.to_string());
        let mut response = self
            .client
            .get(&self.url)
            .header(
                reqwest::header::ACCEPT,
                "application/json, application/jwk-set+json",
            )
            .send()
            .await
            .map_err(|error| unavailable(&error))?;
        if response.status() != reqwest::StatusCode::OK {
            return Err(KeysUnavailable(
                "Expected 200 OK from the JSON Web Key Set HTTP response".into(),
            ));
        }
        let mut body = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| unavailable(&error))?
        {
            body.extend_from_slice(&chunk);
            if body.len() > JWKS_MAX_BYTES {
                return Err(KeysUnavailable(
                    "JSON Web Key Set response too large".into(),
                ));
            }
        }
        // `response.json()`: UTF-8 decode (BOM stripped, invalid bytes replaced), JSON.parse.
        let text = String::from_utf8_lossy(&body);
        let text = text.strip_prefix('\u{feff}').unwrap_or(&text);
        let value: Value = serde_json::from_str(text).map_err(|_| {
            KeysUnavailable("Failed to parse the JSON Web Key Set HTTP response as JSON".into())
        })?;
        Jwks::from_value(value)
    }

    /// The cached set, re-fetched when missing or older than the cache max age.
    async fn current(&self) -> Result<(Instant, Arc<Jwks>), KeysUnavailable> {
        let mut state = self.state.lock().await;
        if let Some(cached) = state.as_ref()
            && cached.fetched_at.elapsed() < JWKS_CACHE_MAX_AGE
        {
            return Ok((cached.fetched_at, cached.jwks.clone()));
        }
        let jwks = Arc::new(self.fetch().await?);
        let fetched_at = Instant::now();
        *state = Some(Cached {
            fetched_at,
            jwks: jwks.clone(),
        });
        Ok((fetched_at, jwks))
    }

    /// After an unknown `kid`: re-fetch unless the set was fetched within the cooldown. Returns
    /// `None` while cooling down. If another caller re-fetched meanwhile, uses that set.
    async fn reload_for_unknown_kid(
        &self,
        seen: Instant,
    ) -> Result<Option<Arc<Jwks>>, KeysUnavailable> {
        let mut state = self.state.lock().await;
        if let Some(cached) = state.as_ref() {
            if cached.fetched_at != seen {
                return Ok(Some(cached.jwks.clone()));
            }
            if cached.fetched_at.elapsed() < JWKS_COOLDOWN {
                return Ok(None);
            }
        }
        let jwks = Arc::new(self.fetch().await?);
        *state = Some(Cached {
            fetched_at: Instant::now(),
            jwks: jwks.clone(),
        });
        Ok(Some(jwks))
    }
}

/// Picks the verification key. `Ok(None)`: the token is rejected (no or ambiguous match).
async fn resolve_key(
    source: &KeySource<'_>,
    kid: Option<&Value>,
) -> Result<Option<DecodingKey>, KeysUnavailable> {
    let pick = |jwks: &Jwks| match jwks.resolve(kid) {
        Resolved::NoMatch => Ok(Err(())),
        Resolved::Ambiguous => Ok(Ok(None)),
        Resolved::One(jwk) => import_rsa(jwk).map(|key| Ok(Some(key))),
    };
    match source {
        KeySource::Local(jwks) => Ok(pick(jwks)?.unwrap_or(None)),
        KeySource::Remote(remote) => {
            let (seen, jwks) = remote.current().await?;
            match pick(&jwks)? {
                Ok(key) => Ok(key),
                Err(()) => match remote.reload_for_unknown_kid(seen).await? {
                    Some(jwks) => Ok(pick(&jwks)?.unwrap_or(None)),
                    None => Ok(None),
                },
            }
        }
    }
}

/// `JSON.parse(strictDecoder.decode(bytes))` as a plain object.
fn json_object(bytes: &[u8]) -> Option<Map<String, Value>> {
    let text = std::str::from_utf8(bytes).ok()?;
    // TextDecoder (ignoreBOM: false) drops one leading BOM.
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    match serde_json::from_str(text).ok()? {
        Value::Object(map) => Some(map),
        _ => None,
    }
}

fn now_secs() -> f64 {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis());
    // `Math.floor(Date.now() / 1000)`; whole seconds fit an f64 exactly.
    (millis / 1000) as f64
}

/// `validateNumericDate`: absent is fine, present must be a JSON number.
fn numeric_date(claims: &Map<String, Value>, claim: &str) -> Result<Option<f64>, ()> {
    match claims.get(claim) {
        None => Ok(None),
        Some(Value::Number(number)) => number.as_f64().map(Some).ok_or(()),
        Some(_) => Err(()),
    }
}

/// `validateClaimsSet` with our options, at time `now` (whole seconds).
fn claims_valid(claims: &Map<String, Value>, audience: &[String], now: f64) -> bool {
    if ["iss", "aud", "iat", "exp", "sub"]
        .iter()
        .any(|claim| !claims.contains_key(*claim))
    {
        return false;
    }
    let iss_ok = claims
        .get("iss")
        .and_then(Value::as_str)
        .is_some_and(|iss| GOOGLE_ISSUERS.contains(&iss));
    if !iss_ok {
        return false;
    }
    let aud_ok = match claims.get("aud") {
        Some(Value::String(aud)) => audience.iter().any(|ours| ours == aud),
        Some(Value::Array(auds)) => audience
            .iter()
            .any(|ours| auds.iter().any(|aud| aud.as_str() == Some(ours))),
        _ => false,
    };
    if !aud_ok {
        return false;
    }
    let (Ok(_iat), Ok(nbf), Ok(exp)) = (
        numeric_date(claims, "iat"),
        numeric_date(claims, "nbf"),
        numeric_date(claims, "exp"),
    ) else {
        return false;
    };
    if nbf.is_some_and(|nbf| nbf > now + CLOCK_TOLERANCE_SECS) {
        return false;
    }
    !exp.is_some_and(|exp| exp <= now - CLOCK_TOLERANCE_SECS)
}

/// The protected-header checks jose makes before resolving a key. Returns `(kid, b64)`.
fn check_header(header: &Map<String, Value>) -> Option<(Option<&Value>, bool)> {
    let mut b64 = true;
    if let Some(crit) = header.get("crit") {
        let Value::Array(crit) = crit else {
            return None;
        };
        if crit.is_empty() {
            return None;
        }
        for parameter in crit {
            match parameter.as_str() {
                // The only recognised extension; it must be present and a boolean.
                Some("b64") => match header.get("b64") {
                    Some(Value::Bool(value)) => b64 = *value,
                    _ => return None,
                },
                _ => return None,
            }
        }
    }
    if header.get("alg").and_then(Value::as_str) != Some("RS256") {
        return None;
    }
    Some((header.get("kid"), b64))
}

/// `verifyGoogleIdToken(credential, { audience, keys })`.
///
/// `Ok(None)` for anything that doesn't verify; `Err` only when Google's keys are unavailable.
pub async fn verify_google_id_token(
    credential: &str,
    audience: &[String],
    keys: KeySource<'_>,
) -> Result<Option<GoogleProfile>, KeysUnavailable> {
    verify_at(credential, audience, keys, now_secs()).await
}

async fn verify_at(
    credential: &str,
    audience: &[String],
    keys: KeySource<'_>,
    now: f64,
) -> Result<Option<GoogleProfile>, KeysUnavailable> {
    let token = js_trim(credential);
    let audience: Vec<String> = audience.iter().filter(|a| !a.is_empty()).cloned().collect();
    if token.is_empty() || audience.is_empty() {
        return Ok(None);
    }
    let mut parts = token.split('.');
    let (Some(header_part), Some(payload_part), Some(signature_part), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return Ok(None);
    };
    let Some(header) = jose_base64url(header_part).and_then(|bytes| json_object(&bytes)) else {
        return Ok(None);
    };
    let Some((kid, b64)) = check_header(&header) else {
        return Ok(None);
    };

    let Some(key) = resolve_key(&keys, kid).await? else {
        return Ok(None);
    };

    // The signing input must be ASCII (jose `encodeAsciiMember`); the header part already is.
    if !payload_part.is_ascii() {
        return Ok(None);
    }
    let Some(signature) = jose_base64url(signature_part) else {
        return Ok(None);
    };
    let signing_input = format!("{header_part}.{payload_part}");
    let verified = jsonwebtoken::crypto::verify(
        &base64url_encode(&signature),
        signing_input.as_bytes(),
        &key,
        Algorithm::RS256,
    )
    .unwrap_or(false);
    // `JWTs MUST NOT use unencoded payload`.
    if !verified || !b64 {
        return Ok(None);
    }

    let Some(claims) = jose_base64url(payload_part).and_then(|bytes| json_object(&bytes)) else {
        return Ok(None);
    };
    if !claims_valid(&claims, &audience, now) {
        return Ok(None);
    }

    let Some(sub) = claims
        .get("sub")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
    else {
        return Ok(None);
    };
    // When present, azp must be one of our clients too.
    if let Some(azp) = claims.get("azp") {
        match azp.as_str() {
            Some(azp) if audience.iter().any(|ours| ours == azp) => {}
            _ => return Ok(None),
        }
    }
    let string = |claim: &str| claims.get(claim).and_then(Value::as_str);
    let email = string("email")
        .map(|email| js_trim(&email.to_lowercase()).to_owned())
        .filter(|email| !email.is_empty());
    Ok(Some(GoogleProfile {
        google_id: sub.to_owned(),
        email,
        name: string("name").map(str::to_owned),
        picture: string("picture").map(str::to_owned),
        email_verified: claims.get("email_verified") == Some(&Value::Bool(true)),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn audiences_and_client_id() {
        assert_eq!(
            google_audiences(Some("server-id"), Some("public-id")),
            ["server-id", "public-id"]
        );
        assert_eq!(
            google_client_id(&google_audiences(Some("server-id"), Some("public-id"))),
            "public-id"
        );
        assert_eq!(
            google_audiences(Some(" same-id "), Some("same-id")),
            ["same-id"]
        );
        assert!(google_audiences(None, None).is_empty());
        assert!(google_audiences(Some("  "), Some("")).is_empty());
        assert_eq!(google_client_id(&[]), "");
        assert_eq!(google_audiences(None, Some("p")), ["p"]);
    }

    #[test]
    fn google_link_is_numeric() {
        assert!(has_google_link(Some("109876543210987654321")));
        assert!(!has_google_link(Some("duck@example.com")));
        assert!(!has_google_link(Some("google-user-123")));
        assert!(!has_google_link(Some("")));
        assert!(!has_google_link(None));
        assert!(!has_google_link(Some("١٢٣")));
    }

    fn claims(value: Value) -> Map<String, Value> {
        match value {
            Value::Object(map) => map,
            _ => unreachable!(),
        }
    }

    #[test]
    fn claim_rules_match_jose() {
        let aud = vec!["ours".to_owned()];
        let now = 1_000_000.0;
        let base = serde_json::json!({
            "iss": "accounts.google.com", "aud": "ours", "sub": "1", "iat": now, "exp": now + 60.0,
        });
        assert!(claims_valid(&claims(base.clone()), &aud, now));
        let with = |key: &str, value: Value| {
            let mut map = claims(base.clone());
            map.insert(key.to_owned(), value);
            map
        };
        let without = |key: &str| {
            let mut map = claims(base.clone());
            map.remove(key);
            map
        };
        // Expiry with 30 s tolerance: exp <= now - 30 fails.
        assert!(claims_valid(&with("exp", (now - 29.0).into()), &aud, now));
        assert!(!claims_valid(&with("exp", (now - 30.0).into()), &aud, now));
        assert!(!claims_valid(&with("exp", "9999999999".into()), &aud, now));
        // nbf: > now + 30 fails.
        assert!(claims_valid(&with("nbf", (now + 30.0).into()), &aud, now));
        assert!(!claims_valid(&with("nbf", (now + 31.0).into()), &aud, now));
        // iat must be a number but may be in the future (no maxTokenAge).
        assert!(claims_valid(&with("iat", (now + 9999.0).into()), &aud, now));
        assert!(!claims_valid(&with("iat", Value::Null), &aud, now));
        for key in ["iss", "aud", "iat", "exp", "sub"] {
            assert!(!claims_valid(&without(key), &aud, now), "{key}");
        }
        // null counts as present for `sub` (the route then rejects it).
        assert!(claims_valid(&with("sub", Value::Null), &aud, now));
        assert!(claims_valid(
            &with("aud", serde_json::json!(["x", "ours"])),
            &aud,
            now
        ));
        assert!(!claims_valid(
            &with("aud", serde_json::json!(["x"])),
            &aud,
            now
        ));
        assert!(!claims_valid(
            &with("iss", "https://evil.example.com".into()),
            &aud,
            now
        ));
    }

    #[test]
    fn header_rules_match_jose() {
        let header = |value: Value| claims(value);
        assert!(check_header(&header(serde_json::json!({"alg": "RS256"}))).is_some());
        assert!(check_header(&header(serde_json::json!({"alg": "none"}))).is_none());
        assert!(check_header(&header(serde_json::json!({"alg": "HS256"}))).is_none());
        assert!(check_header(&header(serde_json::json!({"alg": "RS256", "crit": []}))).is_none());
        assert!(
            check_header(&header(
                serde_json::json!({"alg": "RS256", "crit": ["exp"]})
            ))
            .is_none()
        );
        assert!(
            check_header(&header(
                serde_json::json!({"alg": "RS256", "crit": ["b64"]})
            ))
            .is_none()
        );
        assert_eq!(
            check_header(&header(
                serde_json::json!({"alg": "RS256", "crit": ["b64"], "b64": false})
            ))
            .map(|(_, b64)| b64),
            Some(false)
        );
    }
}
