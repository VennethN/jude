# Jude Web

Jude is an Indonesian-first courtroom workspace for examining testimony alongside the original exhibits. The web app owns the public site, accounts, case navigation, document viewer, findings, boards, evidence map and case assistant. Each guest receives an isolated synthetic case.

## Run

From the repository root, install dependencies with Node.js 24 and pnpm 10.33.2.

```sh
pnpm install --frozen-lockfile
pnpm --filter @jude/web dev
```

Open the URL printed by Vite. Sign up or select **Coba perkara contoh**. For live replay and audio transport, install the Python voice dependencies from its README, then run both services using `pnpm dev` from the repository root. To connect a separately hosted voice service, provide its internal URL in `VOICE_ORIGIN`.

```sh
pnpm --filter @jude/web check
pnpm --filter @jude/web build
pnpm --filter @jude/web start
```

The production server listens on `PORT` (default 3000). Its `/healthz` check queries the database. Set `DATABASE_URL` for PostgreSQL, or explicitly set `JUDE_DB_PATH` to test the built app with local SQLite. Both services must share the database and the private file backend. `ORIGIN` is the canonical public origin. Local development uses a private directory under the repository root.

## Project files

Web source, browser tests, Playwright configuration and synthetic document generation live in this directory. Use this app’s `.env.example` as a settings reference. Put `DATABASE_URL` in the repository root’s Git-ignored `.env` to use PostgreSQL with `pnpm dev` or `pnpm start`. Both the web and voice processes receive it. For RDS, include `sslmode=verify-full` and set `sslrootcert` to the local CA bundle’s absolute path. Production loads runtime secrets from SSM.

Run `pnpm test:e2e` from the repository root for browser tests. Shared backend tests live in `packages/core/tests` and run with `pnpm test`. The combined EC2 Dockerfile lives at `infra/docker/Dockerfile`; build it from the repository root to include both apps and shared migrations.

## Design

[PRODUCT.md](PRODUCT.md) describes counsel’s workflow. [DESIGN.md](DESIGN.md) contains the typography, colours and layout. Public, workspace and voice-related browser controls use the same typefaces. The [Impeccable project skill](../../.agents/skills/impeccable/SKILL.md) ships with the repository. The CLI is pinned in pnpm. From the repository root, use the CLI to set up machine-specific hooks or check the frontend.

```sh
pnpm design:install
pnpm design:check
```

## Services

The server calls OpenAI directly. GPT-6.1 Terra generates findings and Assistant answers. With PostgreSQL and `OPENAI_API_KEY`, a background worker embeds private case evidence with `text-embedding-3-small`. Case search, the Assistant, and hearing comparisons combine lexical matches with cosine similarity. Set `JUDE_SEMANTIC_SEARCH=false` to disable embedding requests. Guest examples use local text search. The SQLite Assistant can cache embeddings on demand for private cases; PostgreSQL continues to use its background index. Originals are served privately from local files or AWS S3 using `JUDE_S3_BUCKET`, `JUDE_S3_KMS_KEY` and `AWS_REGION`.

For assistant development, set `OPENAI_API_KEY`, optionally `OPENAI_PROJECT_ID`, and `OPENAI_ASSISTANT_MODEL` (or the shared `OPENAI_MODEL`). The example environment includes `OPENAI_EMBEDDING_MODEL=text-embedding-3-small` for multilingual retrieval and a 6,000-token assistant output budget. Existing `.env` files need no new values unless overriding these defaults. Embeddings use the same case database; migrations apply on startup. See [assistant retrieval and request details](../../packages/core/README.md#assistant-retrieval-and-requests).

The Assistant’s Pasal.id control includes legal references with a question. The synthetic case searches its labelled sample records. For private workspaces, set `JUDE_PASAL_TOKEN` on the web server. The Discovery API returns regulation metadata and links to read the source on Pasal.id. [Pasal.id Discovery API](https://pasal.id/en/api)

The microphone captures mono PCM at 24 kHz. With an available voice socket, sustained speech is sent after 2.4 seconds. A turn can close earlier once 1.2 seconds have elapsed since speech began and the last 0.6 seconds are quiet. While an earlier turn waits for its acknowledgement, continuous speech is saved in windows of up to eight seconds. Each turn stays in the browser’s hearing-scoped IndexedDB queue until the service acknowledges its ID. Pause and Stop also save the worklet’s final partial block. Provider processing and network time add to the capture window.

[Voice service](../voice/README.md) · [Shared case core](../../packages/core/README.md) · [AWS hosting](docs/aws.md)
