# ============================================
# AutoDuck - Duck Racing System
# Multi-stage Dockerfile for Dokploy deployment
# ============================================

# --- Stage 1: Dependencies ---
FROM node:20-slim AS deps

RUN npm install -g pnpm

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN pnpm install --frozen-lockfile

# --- Stage 2: Builder ---
FROM node:20-slim AS builder

RUN npm install -g pnpm

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build Next.js (standalone output)
RUN pnpm build

# --- Stage 3: Runner ---
FROM mcr.microsoft.com/playwright:v1.49.0-noble AS runner

# Install Xvfb + pnpm + tsx
RUN apt-get update && apt-get install -y \
    xvfb \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm tsx

WORKDIR /app

# Copy standalone Next.js server
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Copy Prisma files (for db push on startup) + all node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/node_modules ./node_modules

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

EXPOSE 3000

CMD ["./start.sh"]
