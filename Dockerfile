# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS workspace
ENV CI=true
WORKDIR /app
RUN npm install -g pnpm@10.33.2
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/
COPY apps/voice/package.json ./apps/voice/
COPY packages/core/package.json ./packages/core/

FROM workspace AS build
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM workspace AS production-dependencies
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

FROM caddy:2-alpine AS proxy
FROM node:24-bookworm-slim AS runtime-base
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 \
    JUDE_MIGRATIONS_DIR=/app/migrations JUDE_DEMO_ASSETS_DIR=/app/apps/web/static/demo/documents
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates ffmpeg fonts-dejavu-core libreoffice-writer poppler-utils \
    tesseract-ocr tesseract-ocr-eng tesseract-ocr-ind \
    && rm -rf /var/lib/apt/lists/*
COPY --from=proxy /usr/bin/caddy /usr/local/bin/caddy

FROM runtime-base AS release
COPY --from=production-dependencies --chown=node:node /app/ ./
COPY --from=build --chown=node:node /app/apps/web/build ./apps/web/build
COPY --from=build --chown=node:node /app/apps/web/static/demo/documents ./apps/web/static/demo/documents
COPY --from=build --chown=node:node /app/apps/voice/dist ./apps/voice/dist
COPY --from=build --chown=node:node /app/packages/core/src ./packages/core/src
COPY --from=build --chown=node:node /app/migrations ./migrations
USER node
EXPOSE 3000
CMD ["node", "apps/voice/dist/server.mjs"]
