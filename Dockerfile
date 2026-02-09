# AutoDuck - Zero-Touch Duck Racing System
# Docker image with Playwright + Xvfb for headless browser automation

FROM mcr.microsoft.com/playwright:v1.49.0-noble

# Install Xvfb for virtual framebuffer (required for non-headless browser on server)
RUN apt-get update && apt-get install -y \
    xvfb \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN npm install -g pnpm

WORKDIR /app

# Copy dependency files first for better caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy the rest of the app
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build Next.js
RUN pnpm build

# Environment variables
ENV DISPLAY=:99
ENV SIMULATE_RACE=false
ENV NODE_ENV=production

# Expose port
EXPOSE 3000

# Start Xvfb and the app
CMD Xvfb :99 -screen 0 1280x720x24 & pnpm start
