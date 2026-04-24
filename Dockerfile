# syntax=docker/dockerfile:1.7
# ============================================
# AutoDuck - Duck Racing System
# Multi-stage Dockerfile for Dokploy deployment
# ============================================

# --- Stage 1: Dependencies (same Node/runtime as Playwright runner) ---
FROM mcr.microsoft.com/playwright:v1.59.1-noble AS deps

RUN corepack enable && corepack prepare pnpm@10.20.0 --activate

# Install build tools for native modules (better-sqlite3).
RUN apt-get update && apt-get install -y \
    xvfb python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile

# --- Stage 2: Build Next.js ---
FROM deps AS builder

COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build Next.js (standalone output)
RUN pnpm build

# --- Stage 3: Runner (Playwright for browser automation) ---
FROM mcr.microsoft.com/playwright:v1.59.1-noble AS runner

RUN npm install -g prisma@7.7.0 tsx@4.21.0 dotenv@17.4.2

WORKDIR /app

# Copy standalone Next.js server
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Prisma config is evaluated at startup and imports packages not traced by Next.
RUN ln -s "$(npm root -g)/prisma" ./node_modules/prisma && \
    ln -s "$(npm root -g)/dotenv" ./node_modules/dotenv

# Copy Prisma files used by startup migrations and the generated client.
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts

# Copy commentary worker + AI modules
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/package.json ./package.json

# Copy startup script
COPY scripts/start.sh ./start.sh
RUN chmod +x ./start.sh

# Create data directory for SQLite persistence
RUN mkdir -p /app/data /app/tmp/videos

# Environment
ENV NODE_ENV=production
ENV DISPLAY=:99
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV DATABASE_URL="file:/app/data/autoduck.db"
ENV NODE_OPTIONS="--experimental-require-module"

EXPOSE 3000

CMD ["./start.sh"]
