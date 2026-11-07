# Jude

Jude gives Indonesian counsel a case file for examining testimony, hearing transcripts and original exhibits. A finding opens the two phrases being compared and their sources. Lawyers can record their review, organise evidence on a board and ask a question about the current case.

## Run locally

Use Node.js 24 LTS and pnpm 10.33.2.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open the address printed by Vite. **Coba perkara contoh** opens a separate synthetic workspace for the visitor. The example works without service credentials. Create an account to manage private cases. Local development stores data under `.jude-data/`.

## Workspace

| Package | Responsibility |
| --- | --- |
| `apps/web` | SvelteKit pages, browser microphone capture, bilingual interface and HTTP routes |
| `apps/voice` | Recording transport, OpenAI transcription, replay and the production Node entry |
| `packages/core` | Case data and permissions, evidence, accounts, private files, AI analysis and jobs |
| `migrations` | Append-only database changes |
| `infra` | AWS deployment and Jakarta PostgreSQL infrastructure |

## Verification

```sh
pnpm check
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

Start the built service with `pnpm start`. Set `DATABASE_URL` for PostgreSQL or an explicit `JUDE_DB_PATH` to run the production build against a temporary local SQLite file. `GET /healthz` checks database access. The Node entry serves the web app and recording WebSocket on the same origin.

## Providers

Use the server environment for credentials. The OpenAI project key enables Responses for evidence analysis and case answers, Realtime for microphone audio, and the transcription endpoint for recordings. Set `OPENAI_MODEL`, `OPENAI_TRANSCRIPTION_MODEL` and `OPENAI_REALTIME_TRANSCRIPTION_MODEL` to models enabled in your OpenAI project. Without a key, the assistant returns matching source extracts.

AWS provides compute, PostgreSQL and private files. Set `JUDE_S3_BUCKET`, `JUDE_S3_KMS_KEY` and `AWS_REGION` for S3. Local originals otherwise use `JUDE_FILES_DIR`. Optional email delivery uses SES with `JUDE_MAIL_FROM` and a verified sender. `ORIGIN` identifies the canonical HTTPS address. Configure prices and payment service before collecting payment.

[OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs) · [OpenAI transcription](https://developers.openai.com/api/docs/guides/realtime-transcription) · [AWS deployment](docs/aws.md)
