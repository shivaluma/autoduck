# syntax=docker/dockerfile:1.7
# ============================================
# AutoDuck: Rust server (crates/server, binary `autoduck`) serving the Vite SPA.
# Rewrite plan Phase 8 (D20, D21). Builds on amd64 and arm64: every tool is built from
# source or comes from the distro, nothing is downloaded per architecture.
#
#   rust     pinned toolchain from rust-toolchain.toml (D27)
#   wasm     browser engine package (crates/race-wasm/pkg, scripts/build-wasm.sh)
#   server   `cargo build --release -p autoduck-server` with the committed .sqlx/ (SQLX_OFFLINE)
#   web      Vite SPA (dist/; Vite copies public/ into it)
#   runtime  debian:bookworm-slim + ca-certificates, sqlite3 (ops backups), tini
# ============================================

ARG RUST_IMAGE=rust:1.99.1-slim-bookworm
# Same Node as CI (NODE_VERSION in .github/workflows/ci.yml); pinned by the multi-arch index digest.
ARG NODE_IMAGE=node:24.14.1-bookworm-slim@sha256:b506e7321f176aae77317f99d67a24b272c1f09f1d10f1761f2773447d8da26c

# --- Rust toolchain (shared by the wasm and server stages) ---
FROM ${RUST_IMAGE} AS rust
WORKDIR /src
COPY rust-toolchain.toml ./
# Installs the channel, components and wasm targets named in rust-toolchain.toml.
RUN rustup show active-toolchain || rustup toolchain install
RUN rustc -vV

# --- Browser engine (crates/race-wasm/pkg) ---
FROM rust AS wasm
# Must equal the wasm-bindgen crate pinned in Cargo.lock (D27; build-wasm.sh checks it).
ARG WASM_BINDGEN_VERSION=0.2.129
RUN --mount=type=cache,id=autoduck-cargo-registry,target=/usr/local/cargo/registry,sharing=locked \
    cargo install wasm-bindgen-cli --version ${WASM_BINDGEN_VERSION} --locked
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
COPY scripts/build-wasm.sh ./scripts/build-wasm.sh
RUN --mount=type=cache,id=autoduck-cargo-registry,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,id=autoduck-target-wasm,target=/src/target,sharing=locked \
    bash scripts/build-wasm.sh --require-bindgen --out-dir /out/pkg

# --- Server binary ---
FROM rust AS server
ENV SQLX_OFFLINE=true
COPY Cargo.toml Cargo.lock ./
COPY .sqlx ./.sqlx
COPY crates ./crates
RUN --mount=type=cache,id=autoduck-cargo-registry,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,id=autoduck-target-server,target=/src/target,sharing=locked \
    cargo build --release --locked -p autoduck-server --bin autoduck && \
    install -D -m 0755 target/release/autoduck /out/autoduck && \
    /out/autoduck --version

# --- Vite SPA (dist/) ---
FROM ${NODE_IMAGE} AS web
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@11.22.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# --ignore-scripts: the SPA bundle needs no install script; Vite's and Tailwind's native parts are
# per-platform optional dependencies.
RUN --mount=type=cache,id=autoduck-pnpm-store,target=/pnpm/store,sharing=locked \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile --ignore-scripts
COPY . .
COPY --from=wasm /out/pkg ./crates/race-wasm/pkg
# Type checking is CI's job (`pnpm build:web` = tsc + vite build); the image needs the bundle only.
# dist/.vite holds the build manifests for CI's bundle check; they are not served.
RUN pnpm exec vite build && rm -rf dist/.vite && test -f dist/index.html

# --- Runtime ---
FROM debian:bookworm-slim AS runtime
# sqlite3 for on-box runbooks (`sqlite3 … ".backup …"`, never cp). tini as PID 1 forwards SIGTERM,
# so the server drains (D21), and reaps children.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates sqlite3 tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=server /out/autoduck /usr/local/bin/autoduck
COPY --from=web /app/dist ./dist
# Boot step 10 compares this manifest with the RaceReplayTrack rows (read-only).
COPY artifacts/replay-tracks/manifest.json ./artifacts/replay-tracks/manifest.json
# /app/data is the autoduck-data volume (SQLite, lock, boot backups, legacy archive);
# /app/tmp/videos is the old, unused autoduck-videos mount point.
# Owned schema mode (plan Phase 9, D14/D15): the first boot records rs-ponr, archives the legacy v2
# tables (VACUUM INTO /app/data/backups/autoduck-legacy-archive-<UTC>.db, verified) and drops them,
# then switches the DB to WAL. From then on the DB is three files: autoduck.db, autoduck.db-wal and
# autoduck.db-shm. Never copy autoduck.db alone (it can miss committed transactions still in the
# -wal): back up with `autoduck backup --force` or `sqlite3 /app/data/autoduck.db ".backup <file>"`,
# or stop the container first and copy all three files together.
RUN mkdir -p /app/data/backups /app/tmp/videos

# Dokploy sets only DATABASE_URL, RACE_SECRET_KEY and the Google ids, so everything else defaults
# here for production (NO_COLOR: plain log lines in Dokploy). Google audiences: GOOGLE_CLIENT_ID
# and/or NEXT_PUBLIC_GOOGLE_CLIENT_ID; the SPA reads the client id at runtime from
# GET /api/auth/google.
ENV AUTODUCK_ENV=production \
    AUTODUCK_SCHEMA_MODE=owned \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_URL="file:/app/data/autoduck.db" \
    AUTODUCK_DIST_DIR=/app/dist \
    AUTODUCK_BACKUP_DIR=/app/data/backups \
    AUTODUCK_REPLAY_MANIFEST=/app/artifacts/replay-tracks/manifest.json \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    NO_COLOR=1

# Stored as RaceReplayTrack.engineCommit when the builder passes it (as SOURCE_COMMIT).
ARG SOURCE_COMMIT=""
ENV GIT_SHA=${SOURCE_COMMIT}

EXPOSE 3000
STOPSIGNAL SIGTERM
# Liveness only (D21): GET /api/health on the local port. The start period covers the lock wait
# (up to 150 s while an old instance drains) plus the boot backup.
HEALTHCHECK --interval=30s --timeout=10s --start-period=180s --retries=3 \
    CMD ["autoduck", "healthcheck", "--timeout", "5"]

ENTRYPOINT ["/usr/bin/tini", "--", "autoduck"]
CMD ["serve"]
