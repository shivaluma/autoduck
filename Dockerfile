# syntax=docker/dockerfile:1.7
# ============================================
# AutoDuck - Duck Racing System
# Multi-stage Dockerfile for Dokploy deployment
# ============================================

# One base for every stage, so better-sqlite3 is compiled against the same
# glibc and Node ABI it runs on. Node 24.14.1 (ICU 78.2, V8 13.6.233.17) is the
# exact runtime of the previous base, mcr.microsoft.com/playwright:v1.59.1-noble,
# which keeps race replays/digests on the same JS engine. Pinned by the
# multi-arch index digest (pushed 2026-04-07).
ARG NODE_IMAGE=node:24.14.1-bookworm-slim@sha256:b506e7321f176aae77317f99d67a24b272c1f09f1d10f1761f2773447d8da26c

# --- Stage 1: Dependencies ---
FROM ${NODE_IMAGE} AS deps

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@11.22.0 --activate

# Toolchain for compiling better-sqlite3 (builder stages only).
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Build better-sqlite3 from source against this base instead of downloading a
# prebuilt binary; node-gyp uses the headers shipped in the image (no download).
RUN --mount=type=cache,id=pnpm-store-node24-bookworm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    env npm_config_build_from_source=better-sqlite3 npm_config_nodedir=/usr/local \
    pnpm install --frozen-lockfile && \
    node -e "const db = require('better-sqlite3')(':memory:'); console.log('better-sqlite3 OK, sqlite', db.prepare('select sqlite_version() v').get().v)"

# Keep only the compiled addon: the runner copies this package dir, and the
# node-gyp intermediates plus the bundled SQLite sources are ~27 MB of dead weight.
RUN B=node_modules/.pnpm/better-sqlite3@12.9.0/node_modules/better-sqlite3 && \
    mv "$B/build/Release/better_sqlite3.node" /tmp/better_sqlite3.node && \
    rm -rf "$B/build" "$B/deps" "$B/src" && \
    mkdir -p "$B/build/Release" && mv /tmp/better_sqlite3.node "$B/build/Release/" && \
    node -e "require('better-sqlite3')(':memory:').close(); console.log('better-sqlite3 OK after prune')"

# --- Stage 1b: Browser engine (crates/race-wasm/pkg) ---
# `pnpm build` needs cargo, the wasm32 target and wasm-bindgen-cli; build the package here so the
# Node builder stays Rust-free. The toolchain comes from rust-toolchain.toml (D27), and the CLI
# version must equal the wasm-bindgen crate pinned in Cargo.lock.
FROM rust:1.99.1-slim-bookworm AS wasm
ARG WASM_BINDGEN_VERSION=0.2.129
WORKDIR /src
COPY rust-toolchain.toml ./
RUN rustup show active-toolchain || rustup toolchain install
RUN --mount=type=cache,id=cargo-registry,target=/usr/local/cargo/registry \
    cargo install wasm-bindgen-cli --version ${WASM_BINDGEN_VERSION} --locked
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
COPY scripts/build-wasm.sh ./scripts/build-wasm.sh
RUN --mount=type=cache,id=cargo-registry,target=/usr/local/cargo/registry \
    bash scripts/build-wasm.sh --require-bindgen --out-dir /out/pkg

# --- Stage 2: Build Next.js ---
FROM deps AS builder

COPY . .
COPY --from=wasm /out/pkg ./crates/race-wasm/pkg

# Generate Prisma client
RUN pnpm exec prisma generate

# Build the Vite SPA (dist/), then Next.js for the API route handlers (standalone output). Until the Rust
# server takes over, Next also serves the SPA: dist/ goes into public/ and next.config.ts falls back to
# public/index.html for every non-API path (plan Phase 4). dist/.vite holds the build manifests (CI's bundle
# check reads them); they are not served.
RUN pnpm build:web && pnpm build:api:next && rm -rf dist/.vite && cp -R dist/. public/

# --- Stage 3: Runner ---
FROM ${NODE_IMAGE} AS runner

# sqlite3 CLI for on-box runbooks (`sqlite3 ... ".backup ..."`, never cp).
# openssl: Prisma picks its schema-engine binary (`prisma db push` at boot) by the
# libssl it detects; without it every prisma call warns and falls back to openssl-1.1.x.
# ca-certificates: system trust store, as the old Playwright base had, so outbound
# TLS still works if NODE_OPTIONS ever adds --use-openssl-ca / --use-system-ca.
RUN apt-get update && apt-get install -y --no-install-recommends sqlite3 openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g prisma@7.7.0 tsx@4.21.0 dotenv@17.4.2

WORKDIR /app

# Copy standalone Next.js server
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules/.pnpm/@prisma+adapter-better-sqlite3@7.7.0 ./node_modules/.pnpm/@prisma+adapter-better-sqlite3@7.7.0
COPY --from=builder /app/node_modules/.pnpm/@prisma+driver-adapter-utils@7.7.0 ./node_modules/.pnpm/@prisma+driver-adapter-utils@7.7.0
COPY --from=builder /app/node_modules/.pnpm/@prisma+debug@7.7.0 ./node_modules/.pnpm/@prisma+debug@7.7.0
COPY --from=builder /app/node_modules/.pnpm/better-sqlite3@12.9.0 ./node_modules/.pnpm/better-sqlite3@12.9.0

# Prisma config is evaluated at startup and imports packages not traced by Next.
RUN mkdir -p ./node_modules/@prisma && \
    PRISMA_CLIENT_DIR="$(find ./node_modules/.pnpm -maxdepth 1 -type d -name '@prisma+client@7.7.0_*' | head -n 1)" && \
    ln -s "$(npm root -g)/prisma" ./node_modules/prisma && \
    ln -s "$(npm root -g)/dotenv" ./node_modules/dotenv && \
    ln -s "../.pnpm/$(basename "$PRISMA_CLIENT_DIR")/node_modules/@prisma/client" ./node_modules/@prisma/client && \
    ln -s "../.pnpm/@prisma+adapter-better-sqlite3@7.7.0/node_modules/@prisma/adapter-better-sqlite3" ./node_modules/@prisma/adapter-better-sqlite3 && \
    for link in ./node_modules/prisma ./node_modules/dotenv ./node_modules/@prisma/client ./node_modules/@prisma/adapter-better-sqlite3; do \
      test -e "$link" || { echo "dangling symlink: $link -> $(readlink "$link")" >&2; exit 1; }; \
    done

# Copy Prisma files used by startup migrations and the generated client.
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts

# Startup migrations (scripts/run-migrations.ts), seed and ops scripts, plus the
# lib/ modules they import.
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/package.json ./package.json

# Historical replay tracks imported at boot by scripts/replay-tracks/ensure-imported.ts (plan step 0.6).
# Their geometry files (public/race-tracks) come with ./public above. The import's post-race stats use
# src/ and packages/ (zod is their only dependency; Next's standalone output doesn't carry it).
COPY --from=builder /app/artifacts/replay-tracks ./artifacts/replay-tracks
COPY --from=builder /app/src ./src
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/node_modules/.pnpm/zod@4.3.6/node_modules/zod ./node_modules/zod

# Copy startup script
COPY scripts/start.sh ./start.sh
RUN chmod +x ./start.sh

# Create data directory for SQLite persistence
RUN mkdir -p /app/data

# Environment
ENV NODE_ENV=production
# LANG and LC_ALL both pinned (as in the old Playwright base) so ICU's default
# locale stays en-US even if the deploy env sets LANG/LC_*: race-core and chaos
# order ties with localeCompare, and a vi-VN collator would change race results.
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV DATABASE_URL="file:/app/data/autoduck.db"
ENV NODE_OPTIONS="--experimental-require-module"

EXPOSE 3000

CMD ["./start.sh"]
