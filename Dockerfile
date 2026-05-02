# ── Stage 1: Build frontend ───────────────────────────────────────────────────
FROM oven/bun:1 AS builder

WORKDIR /app

# Install dependencies (workspace-aware)
COPY package.json bun.lock bunfig.toml ./
COPY console/ai-proxy-dashboard/package.json ./console/ai-proxy-dashboard/
RUN bun install --frozen-lockfile

# Copy source and build frontend static assets
COPY . .
RUN bun run build

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM oven/bun:1 AS runner

WORKDIR /app

# Copy only what's needed at runtime
COPY --from=builder /app/package.json /app/bun.lock /app/bunfig.toml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/drizzle.config.ts ./

ENV PORT=3000
EXPOSE 3000

CMD ["bun", "run", "src/server.ts"]
