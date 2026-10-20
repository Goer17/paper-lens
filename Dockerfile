# ---- Build stage -----------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Install workspace dependencies from the lockfile first so Docker can cache
# this layer when only application source changes.
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY web/package.json web/package.json
RUN npm ci --no-audit --no-fund

COPY server server
COPY web web

# Type-checks both packages and produces server/dist + web/dist.
RUN npm run build

# ---- Runtime stage ---------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    PAPER_READER_DATA=/data

# Only the API's production dependencies are needed at runtime. The web
# bundle is static and already built in the previous stage.
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY web/package.json web/package.json
RUN npm ci --omit=dev --workspace @paperlens/server --include-workspace-root --no-audit --no-fund \
    && npm cache clean --force

COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist

# Run unprivileged. /data holds the SQLite database, PDFs, crops, skills and
# the access token, and should be mounted as a volume.
RUN mkdir -p /data && chown -R node:node /app /data
USER node

VOLUME ["/data"]
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 8787) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "server/dist/index.js"]
