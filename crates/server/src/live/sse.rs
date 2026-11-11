//! `GET /api/races/:id/live`: the SSE v2 stream (D16).
//!
//! - First a `hello` frame (no `id:`), then every logged frame with `id > Last-Event-ID`
//!   (`start`, `clock`, `finished`, `resolved`/`failed`), then new frames as the driver logs
//!   them. `?snapshots=1` adds `snapshot` frames (latest only, no `id:`) and `engine-event`
//!   frames (logged, so they resume too).
//! - A race that is not live answers **204**, which makes `EventSource` stop reconnecting.
//! - The stream ends after `resolved`/`failed` (or when the server shuts down).
//! - Headers: `text/event-stream`, `Cache-Control: no-cache, no-transform`,
//!   `X-Accel-Buffering: no`. There is no compression layer in this server; if one is added it
//!   must skip `text/event-stream` (plan Phase 5: `NotForContentType`).
//! - The `/api` deadline ([`crate::http::headers::API_DEADLINE`]) only bounds the time to the
//!   response head; the streamed body is not under it.
//! - A comment line (`: keep-alive`) every [`KEEP_ALIVE`] keeps proxies from closing the stream.

use std::sync::Arc;
use std::time::Duration;

use axum::body::{Body, Bytes};
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use tokio::sync::mpsc;

use super::session::{Frame, LiveSession};

/// Comment-line interval.
pub const KEEP_ALIVE: Duration = Duration::from_secs(15);

/// Frames queued per subscriber before the writer waits for the socket.
const QUEUE: usize = 64;

/// The response for a subscriber of `session` (or 204 when the race is not live).
#[must_use]
pub fn stream(session: Option<Arc<LiveSession>>, last_event_id: u64, snapshots: bool) -> Response {
    let Some(session) = session else {
        return StatusCode::NO_CONTENT.into_response();
    };
    let (sender, receiver) = mpsc::channel::<Bytes>(QUEUE);
    tokio::spawn(pump(session, last_event_id, snapshots, sender));
    let body = Body::from_stream(futures_util::stream::unfold(
        receiver,
        |mut receiver| async move {
            receiver
                .recv()
                .await
                .map(|bytes| (Ok::<_, std::convert::Infallible>(bytes), receiver))
        },
    ));
    let mut response = Response::new(body);
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/event-stream; charset=utf-8"),
    );
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-cache, no-transform"),
    );
    headers.insert("x-accel-buffering", HeaderValue::from_static("no"));
    response
}

/// Copies frames from the session log to one subscriber until the race ends or the client
/// goes away (a failed send).
async fn pump(
    session: Arc<LiveSession>,
    mut last_sent: u64,
    snapshots: bool,
    sender: mpsc::Sender<Bytes>,
) {
    let mut seq = session.subscribe_seq();
    let mut snapshot = session.subscribe_snapshot();
    // Mark the current values seen: everything up to now is copied from the log below.
    seq.borrow_and_update();
    snapshot.borrow_and_update();
    if send(&sender, &session.hello()).await.is_err() {
        return;
    }
    let mut last_snapshot: Option<Arc<Frame>> = None;
    loop {
        // The latest snapshot first, so the terminal frames (`resolved`/`failed`) stay last.
        if snapshots && !session.is_closed() {
            let latest = snapshot.borrow_and_update().clone();
            if let Some(frame) = latest
                && !last_snapshot
                    .as_ref()
                    .is_some_and(|sent| Arc::ptr_eq(sent, &frame))
            {
                if send(&sender, &frame).await.is_err() {
                    return;
                }
                last_snapshot = Some(frame);
            }
        }
        for frame in session.frames_after(last_sent) {
            last_sent = frame.id;
            if frame.snapshot_only && !snapshots {
                continue;
            }
            if send(&sender, &frame).await.is_err() {
                return;
            }
        }
        if session.is_closed() && session.frames_after(last_sent).is_empty() {
            return;
        }
        tokio::select! {
            changed = seq.changed() => {
                if changed.is_err() {
                    return;
                }
            }
            changed = snapshot.changed(), if snapshots => {
                if changed.is_err() {
                    return;
                }
            }
            () = tokio::time::sleep(KEEP_ALIVE) => {
                if sender.send(Bytes::from_static(b": keep-alive\n\n")).await.is_err() {
                    return;
                }
            }
        }
    }
}

async fn send(sender: &mpsc::Sender<Bytes>, frame: &Frame) -> Result<(), ()> {
    sender
        .send(Bytes::from(frame.to_sse()))
        .await
        .map_err(|_| ())
}

/// `Last-Event-ID` as a frame id (anything unparsable is 0: from the start).
#[must_use]
pub fn last_event_id(headers: &axum::http::HeaderMap) -> u64 {
    headers
        .get("last-event-id")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim().parse().ok())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    //! The stream layer alone (no DB), under `tokio::time::pause`.

    use std::sync::Arc;
    use std::time::Duration;

    use axum::body::Body;
    use http_body_util::BodyExt;
    use serde_json::{Value, json};

    use super::stream;
    use crate::live::session::LiveSession;

    const VERSIONS: (&str, &str, &str) = ("2.0.0", "S3.16", "2.0.0");

    /// Reads SSE events (`event`, `id`, `data`) from a streaming body as they arrive.
    struct Reader {
        body: Body,
        buffer: String,
    }

    #[derive(Debug, PartialEq)]
    struct Event {
        id: Option<u64>,
        event: String,
        data: Value,
    }

    impl Reader {
        fn new(response: axum::response::Response) -> Self {
            Self {
                body: response.into_body(),
                buffer: String::new(),
            }
        }

        /// The next block (event or comment); `None` at the end of the stream.
        async fn block(&mut self) -> Option<String> {
            loop {
                if let Some(end) = self.buffer.find("\n\n") {
                    let block = self.buffer[..end].to_owned();
                    self.buffer.drain(..end + 2);
                    return Some(block);
                }
                let frame = self.body.frame().await?.ok()?;
                if let Ok(data) = frame.into_data() {
                    self.buffer.push_str(std::str::from_utf8(&data).unwrap());
                }
            }
        }

        async fn next(&mut self) -> Option<Event> {
            loop {
                let block = self.block().await?;
                if block.starts_with(':') {
                    continue;
                }
                let mut event = Event {
                    id: None,
                    event: String::new(),
                    data: Value::Null,
                };
                for line in block.lines() {
                    if let Some(id) = line.strip_prefix("id: ") {
                        event.id = Some(id.parse().unwrap());
                    } else if let Some(name) = line.strip_prefix("event: ") {
                        event.event = name.to_owned();
                    } else if let Some(data) = line.strip_prefix("data: ") {
                        event.data = serde_json::from_str(data).unwrap();
                    }
                }
                return Some(event);
            }
        }
    }

    fn session() -> Arc<LiveSession> {
        LiveSession::new(7, true, 1, VERSIONS)
    }

    #[tokio::test(start_paused = true)]
    async fn countdown_start_clock_and_end() {
        let session = session();
        session.set_countdown(tokio::time::Instant::now() + Duration::from_secs(3));
        let mut reader = Reader::new(stream(Some(Arc::clone(&session)), 0, false));
        let hello = reader.next().await.unwrap();
        assert_eq!(hello.event, "hello");
        assert_eq!(hello.id, None);
        assert_eq!(hello.data["state"], "COUNTDOWN");
        assert_eq!(hello.data["countdownEndsInMs"], 3000);
        assert_eq!(
            hello.data["configJcs"],
            Value::Null,
            "D17: no config before RACING"
        );
        assert_eq!(hello.data["raceId"], "7");
        assert_eq!(hello.data["engineBuildId"], race_core::ENGINE_BUILD_ID);
        assert_eq!(hello.data["inputs"], json!([]));

        tokio::time::advance(Duration::from_secs(1)).await;
        let late = Reader::new(stream(Some(Arc::clone(&session)), 0, false))
            .next()
            .await
            .unwrap();
        assert_eq!(late.data["countdownEndsInMs"], 2000);

        tokio::time::advance(Duration::from_secs(2)).await;
        session.start(Arc::from("{\"raceId\":\"7\"}"));
        let start = reader.next().await.unwrap();
        assert_eq!(
            (start.id, start.event.as_str(), start.data.clone()),
            (
                Some(1),
                "start",
                json!({ "configJcs": "{\"raceId\":\"7\"}", "startTick": 0 })
            )
        );
        for tick in [3, 6, 9] {
            session.set_server_tick(tick);
            session.push("engine-event", json!({ "tick": tick }).to_string(), true);
            session.push_json("clock", &json!({ "tick": tick }));
        }
        // engine-event frames are snapshot-only: skipped here, but their ids are consumed.
        let clocks: Vec<(Option<u64>, Value)> = [
            reader.next().await.unwrap(),
            reader.next().await.unwrap(),
            reader.next().await.unwrap(),
        ]
        .into_iter()
        .map(|event| {
            assert_eq!(event.event, "clock");
            (event.id, event.data["tick"].clone())
        })
        .collect();
        assert_eq!(
            clocks,
            [
                (Some(3), json!(3)),
                (Some(5), json!(6)),
                (Some(7), json!(9))
            ]
        );

        // Hello after the start carries the config and the tick.
        let hello = Reader::new(stream(Some(Arc::clone(&session)), 7, false))
            .next()
            .await
            .unwrap();
        assert_eq!(hello.data["state"], "RACING");
        assert_eq!(hello.data["serverTick"], 9);
        assert_eq!(hello.data["configJcs"], "{\"raceId\":\"7\"}");
        assert!(hello.data.get("countdownEndsInMs").is_none());

        session.finished(
            9,
            &json!({ "finalTick": 9, "digest": "d", "standings": [] }),
        );
        session.resolved(&json!({ "finalVerdict": "x" }));
        assert_eq!(reader.next().await.unwrap().event, "finished");
        assert_eq!(reader.next().await.unwrap().event, "resolved");
        assert!(
            reader.next().await.is_none(),
            "the stream ends after resolved"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn last_event_id_resumes_from_the_log() {
        let session = session();
        session.start(Arc::from("{}"));
        for tick in 1..=10 {
            session.push_json("clock", &json!({ "tick": tick }));
        }
        let mut reader = Reader::new(stream(Some(Arc::clone(&session)), 6, false));
        assert_eq!(reader.next().await.unwrap().event, "hello");
        let ids: Vec<u64> = [
            reader.next().await.unwrap(),
            reader.next().await.unwrap(),
            reader.next().await.unwrap(),
            reader.next().await.unwrap(),
            reader.next().await.unwrap(),
        ]
        .iter()
        .map(|event| event.id.unwrap())
        .collect();
        assert_eq!(ids, [7, 8, 9, 10, 11]);
        // A burst far larger than the per-subscriber queue is copied from the log, never lost
        // (D16: no `Lagged` drop).
        for tick in 11..=500 {
            session.push_json("clock", &json!({ "tick": tick }));
        }
        let mut last = 11;
        while last < 501 {
            let event = reader.next().await.unwrap();
            assert_eq!(event.id, Some(last + 1));
            last += 1;
        }
    }

    #[tokio::test(start_paused = true)]
    async fn snapshots_keep_alive_and_no_session() {
        assert_eq!(
            stream(None, 0, false).status(),
            axum::http::StatusCode::NO_CONTENT
        );
        let session = session();
        let response = stream(Some(Arc::clone(&session)), 0, true);
        assert_eq!(
            response.headers()["content-type"],
            "text/event-stream; charset=utf-8"
        );
        assert_eq!(response.headers()["x-accel-buffering"], "no");
        assert_eq!(
            response.headers()["cache-control"],
            "no-cache, no-transform"
        );
        let mut reader = Reader::new(response);
        assert_eq!(reader.next().await.unwrap().event, "hello");
        session.push(
            "engine-event",
            json!({ "type": "ROCKET_FIRED" }).to_string(),
            true,
        );
        session.set_snapshot(json!({ "type": "STATE_SNAPSHOT", "tick": 8 }).to_string());
        // The latest snapshot goes out before the logged frames of the same wake-up.
        let snapshot = reader.next().await.unwrap();
        assert_eq!((snapshot.event.as_str(), snapshot.id), ("snapshot", None));
        let event = reader.next().await.unwrap();
        assert_eq!((event.event.as_str(), event.id), ("engine-event", Some(1)));
        assert_eq!(snapshot.data["tick"], 8);
        // Silence: a comment line every KEEP_ALIVE.
        let block = tokio::time::timeout(super::KEEP_ALIVE * 2, reader.block())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(block, ": keep-alive");
        session.failed();
        assert_eq!(reader.next().await.unwrap().event, "failed");
        assert!(reader.next().await.is_none());
    }

    /// Through the full router: the stream outlives the 30 s `/api` deadline (which only bounds
    /// the response head) under a paused clock.
    #[tokio::test]
    async fn the_api_deadline_does_not_cut_the_stream() {
        use sqlx::Connection;
        use tower::ServiceExt;

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("autoduck.db");
        let mut conn = sqlx::SqliteConnection::connect_with(
            &sqlx::sqlite::SqliteConnectOptions::new()
                .filename(&path)
                .create_if_missing(true),
        )
        .await
        .unwrap();
        sqlx::raw_sql(crate::db::BASELINE_SQL)
            .execute(&mut conn)
            .await
            .unwrap();
        conn.close().await.unwrap();
        let db = crate::db::Db::open(&path).await.unwrap();
        let vars = [
            ("DATABASE_URL", format!("file:{}", path.display())),
            ("AUTODUCK_ENV", "dev".to_owned()),
            (
                "AUTODUCK_DIST_DIR",
                dir.path().join("dist").display().to_string(),
            ),
        ];
        let config = crate::Config::from_lookup(|name| {
            vars.iter()
                .find(|(key, _)| *key == name)
                .map(|(_, value)| value.clone())
        })
        .unwrap();
        let hub = crate::live::LiveHub::new(db.clone(), crate::live::LiveOptions::default());
        let session = hub.register_for_test(7, VERSIONS);
        let app = crate::http::router(crate::http::AppState::with_live(config, db, hub));

        tokio::time::pause();
        let response = app
            .oneshot(
                axum::http::Request::get("/api/races/7/live")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), axum::http::StatusCode::OK);
        let mut reader = Reader::new(response);
        assert_eq!(reader.next().await.unwrap().event, "hello");
        tokio::time::advance(crate::http::headers::API_DEADLINE * 2).await;
        session.start(Arc::from("{}"));
        assert_eq!(reader.next().await.unwrap().event, "start");
        session.failed();
        assert_eq!(reader.next().await.unwrap().event, "failed");
        assert!(reader.next().await.is_none());
    }
}
