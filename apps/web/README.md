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

Web source, browser tests, Playwright configuration and synthetic document generation live in this directory. `.env.example` documents server settings; it contains no credentials. Copy it to `.env` for Vite development. For `pnpm dev` from the repository root, export the required settings to the shell so both processes receive them. Production loads runtime secrets from SSM.

Run `pnpm test:e2e` from the repository root for browser tests. Shared backend tests live in `packages/core/tests` and run with `pnpm test`. The combined EC2 Dockerfile lives at `infra/docker/Dockerfile`; build it from the repository root to include both apps and shared migrations.

## Design

[PRODUCT.md](PRODUCT.md) describes counsel’s workflow. [DESIGN.md](DESIGN.md) contains the typography, colours and layout. Public, workspace and voice-related browser controls use the same typefaces. The Impeccable CLI is pinned in pnpm. Run these commands at the repository root to install the local Codex skill or check the frontend.

```sh
pnpm design:install
pnpm design:check
```

## Services

OpenAI receives server-side requests for model-generated findings and assistant answers when `OPENAI_API_KEY` is configured. Source-only retrieval and the synthetic case work without credentials. Originals are served privately from local files or AWS S3 using `JUDE_S3_BUCKET`, `JUDE_S3_KMS_KEY` and `AWS_REGION`.

[Voice service](../voice/README.md) · [Shared case core](../../packages/core/README.md) · [AWS hosting](docs/aws.md)
