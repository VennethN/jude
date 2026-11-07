# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS workspace
ENV CI=true
WORKDIR /app
RUN npm install -g pnpm@10.33.2
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/
COPY packages/core/package.json ./packages/core/

FROM workspace AS web-build
RUN pnpm install --frozen-lockfile
COPY apps/web ./apps/web
COPY packages/core/src ./packages/core/src
COPY migrations ./migrations
RUN pnpm --filter @jude/web build

FROM workspace AS web-dependencies
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

FROM caddy:2-alpine AS proxy
FROM node:24-bookworm-slim AS web-runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates ffmpeg fonts-dejavu-core libreoffice-writer poppler-utils \
    tesseract-ocr tesseract-ocr-eng tesseract-ocr-ind \
    && rm -rf /var/lib/apt/lists/*
COPY --from=proxy /usr/bin/caddy /usr/local/bin/caddy

FROM web-runtime AS web
ARG JUDE_REVISION=development
ENV JUDE_REVISION=$JUDE_REVISION
LABEL org.opencontainers.image.revision=$JUDE_REVISION
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 \
    JUDE_MIGRATIONS_DIR=/app/migrations JUDE_DEMO_ASSETS_DIR=/app/apps/web/static/demo/documents
COPY --from=web-dependencies --chown=node:node /app/ ./
COPY --from=web-build --chown=node:node /app/apps/web/build ./apps/web/build
COPY --chown=node:node apps/web/server.mjs apps/web/voice-gateway.mjs ./apps/web/
COPY --chown=node:node packages/core/src ./packages/core/src
COPY --chown=node:node migrations ./migrations
COPY --chown=node:node apps/web/static/demo/documents ./apps/web/static/demo/documents
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.mjs"]

FROM debian:bookworm-slim AS voice-dependencies
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates ffmpeg libgomp1 libpython3.11 libsndfile1 python3 python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 1000 jude && useradd --uid 1000 --gid jude --create-home jude
ENV PATH=/opt/jude-voice/bin:$PATH PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
COPY apps/voice/requirements.txt /tmp/voice-requirements.txt
RUN python3 -m venv /opt/jude-voice && pip install --no-cache-dir -r /tmp/voice-requirements.txt

FROM voice-dependencies AS diarization-dependencies
COPY apps/voice/requirements-diarization.txt /tmp/diarization-requirements.txt
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch==2.8.0 torchaudio==2.8.0 \
    && pip install --no-cache-dir -r /tmp/diarization-requirements.txt \
    && python -c "from torchcodec.decoders import AudioDecoder; from pyannote.audio import Pipeline"

FROM voice-dependencies AS voice
ARG JUDE_REVISION=development
ENV JUDE_REVISION=$JUDE_REVISION
LABEL org.opencontainers.image.revision=$JUDE_REVISION
ENV VOICE_HOST=0.0.0.0 VOICE_PORT=3001 PYTHONPATH=/app/apps/voice JUDE_MIGRATIONS_DIR=/app/migrations
COPY --chown=jude:jude apps/voice/jude_voice ./apps/voice/jude_voice
COPY --chown=jude:jude migrations ./migrations
COPY --chown=jude:jude packages/core/src/plan-quotas.json ./packages/core/src/plan-quotas.json
USER jude
EXPOSE 3001
CMD ["python", "-m", "jude_voice"]

FROM voice AS voice-pyannote
COPY --from=diarization-dependencies /opt/jude-voice /opt/jude-voice

FROM web AS combined
USER root
RUN apt-get update && apt-get install -y --no-install-recommends python3 libgomp1 libpython3.11 libsndfile1 \
    && rm -rf /var/lib/apt/lists/*
ENV PATH=/opt/jude-voice/bin:$PATH PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app/apps/voice VOICE_HOST=127.0.0.1 VOICE_PORT=3001
COPY --from=voice /opt/jude-voice /opt/jude-voice
COPY --from=voice --chown=node:node /app/apps/voice/jude_voice ./apps/voice/jude_voice
COPY --chown=node:node scripts/start.mjs scripts/voice.mjs ./scripts/
USER node
CMD ["node", "scripts/start.mjs"]

FROM combined AS release-pyannote
COPY --from=diarization-dependencies /opt/jude-voice /opt/jude-voice

FROM combined AS release
