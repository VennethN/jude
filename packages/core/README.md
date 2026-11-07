# Jude core

The web desk and the voice service use this TypeScript package to open the same case record. The public exports `@jude/core/domain` and `@jude/core/plans` contain the shared types, review rules and plan catalogue. Imports under `@jude/core/server/*` belong on the server.

## Case records

A workspace contains a case, hearings, speakers, verbatim statements, findings, source passages, filed documents, evidence connections, boards, conversations, replies and legal references. New registered accounts start with an empty case register. The guest entry imports one private copy of a fictional warehouse case from the shipped `warehouse-v1.jude` archive. Each guest owns a different case UUID. Only this application-owned archive preserves familiar entity IDs within the case. Normal file imports remap their entities.

The archive contains the filed originals, historical testimony and findings, one scheduled hearing and two bilingual exhibits concerning entry at the East Gate. Returning guests who enter the demo receive the current practice case while retaining their previous cases and annotations. `session.demo.refs` resolves the public links. Imported practice exhibits are authorized through the guest case and read from the immutable bundle. Their contents can be exported with that case. Run `node packages/core/scripts/pack-guest-case.mjs` to regenerate the source-controlled archive. Retain earlier bundle versions when changing immutable filed originals.

Use `readWorkspace(orgId, caseId)` for a snapshot. Use `mutateWorkspace(orgId, caseId, edit)` for synchronous edits, or `changeIn(db, orgId, caseId, edit)` inside a larger transaction. Keep provider and file requests outside database transactions. A completed edit increments the case version and persists changed entities atomically. Board edits also require the board’s current version.

## Identity and access

The browser carries an HTTP-only, SameSite session cookie. The database stores its digest and expiry. New passwords use Argon2id. An older scrypt password hash upgrades after successful sign-in.

An account may belong to several organisations. Each session selects one of them. Accepting a team invitation preserves existing memberships and private cases. A member only sees cases granted to them. Viewers can read, editors can change case records and case owners can manage access. Organisation roles govern seats and billing.

A separate HTTP or WebSocket service can import `sessionFromToken` from `@jude/core/server/auth` and `authorizeCase` from `@jude/core/server/cases`. Supply the session returned by the database and the case ID from the route. Check `read`, `write`, or `manage` before opening a source or starting work. The JSON handler accepts the standard Web Request and Response types with a small cookie and session adapter defined in `server/request.ts`.

## Storage and migrations

PostgreSQL uses `DATABASE_URL`. Supply the Jakarta RDS endpoint and database credentials through the service environment, and configure TLS trust for the RDS certificate chain. Development without a connection string uses Node’s SQLite driver and `.jude-data/workspace.sqlite`. Production requires `DATABASE_URL` or an explicit `JUDE_DB_PATH`.

SQL migrations in the repository’s `migrations/` directory run in filename order on the first connection. Each applied filename is recorded in `schema_migrations`. PostgreSQL uses an advisory transaction lock during migration and row locks for concurrent edits. SQLite uses its write transaction and WAL. Add migration files for subsequent schema changes.

| Setting | Purpose |
| --- | --- |
| `JUDE_DB_PATH` | SQLite database path, including `:memory:` for isolated tests |
| `JUDE_FILES_DIR` | Local private originals, default `.jude-data/files` |
| `JUDE_MIGRATIONS_DIR` | SQL migration directory in a packaged installation |
| `JUDE_DEMO_ASSETS_DIR` | Directory containing the synthetic exhibit PDFs and the filed DOCX |
| `JUDE_S3_BUCKET`, `JUDE_S3_KMS_KEY`, `AWS_REGION` | Private S3 object storage, encryption key and region |
| `JUDE_MAIL_FROM`, `AWS_REGION`, `ORIGIN` | SES sender, region and public origin used in reset and invitation links |
| `JUDE_DELETE_GRACE_DAYS` | Time allowed to restore a deleted case or record, default 30 days |

Development defaults resolve from the nearest ancestor containing `pnpm-workspace.yaml`, including when starting a service inside `apps/web`. Private originals are scoped to organisation, case and entity. The public synthetic exhibit set is supplied under `apps/web/static/demo/documents/`.

PDF ingestion extracts page text. Scanned pages can use Poppler and Tesseract with Indonesian and English language data. DOCX keeps the filed bytes and uses headless LibreOffice for a PDF representation when available. TXT and Markdown become directly inspectable passages. The authenticated original endpoint returns the filed bytes. A `.jude` download includes the source record, originals, derived viewer PDFs, uploaded recordings and retained microphone turns. Import remaps references and checks storage and case quotas before committing.

## HTTP surface

All paths use the `/api` prefix. Case mutations are scoped under `/cases/{caseId}`. The workspace session is required for private endpoints.

| Route | Behaviour |
| --- | --- |
| `POST /auth/signup`, `/auth/login`, `/auth/demo`, `/auth/logout` | Create, resume or end a session |
| `POST /auth/reset`, `/auth/reset/confirm`, `/auth/invite` | Email reset and invitation acceptance |
| `GET /me`, `PATCH /me/prefs` | Session, demo references and personal preferences |
| `GET /orgs`, `POST /org/switch` | List memberships and switch the active organisation with `{orgId}` |
| `GET /org/members`, `POST /org/invitations`, `DELETE /org/members/{id}` | Administrative seat management |
| `GET /plans`, `GET /billing`, `POST /billing/plan` | Catalogue, metered usage and plan selection |
| `GET /cases`, `POST /cases`, `POST /cases/import` | List accessible cases, open a private case or import an archive |
| `GET /cases/{id}/workspace`, `/search`, `/events` | Snapshot, case search and version updates over SSE |
| `GET /cases/{id}/export`, `POST /cases/{id}/archive`, `/unarchive`, `/restore` | Download a case file or change its lifecycle state |
| `PUT /cases/{id}/members/{userId}` | Grant a case role with `{role}` |
| `POST /cases/{id}/documents`, `GET /cases/{id}/documents/{doc}/original` | Multipart upload with a `file` field and authorized retrieval |
| `POST /cases/{id}/hearings`, `…/hearings/import/preview`, `…/hearings/import` | Schedule a hearing, preview a transcript or save its verified turns |
| `PATCH …/findings/{id}`, `…/statements/{id}`, `…/speakers/{id}` | Save review decisions, bookmarks and speaker labels |
| `POST …/connections`, `POST …/boards`, `PUT …/boards/{id}` | Manage pairings and versioned evidence boards |
| `POST …/threads`, `POST …/threads/{id}/messages` | Ask about the case with up to six referenced contexts and inspectable citations |

Send an `Idempotency-Key` when a creation or question might be retried. Errors use `{error: {code, message, retryable}}`. A stale board returns HTTP 409. A quota error returns HTTP 402 with the quota, measured usage and limit.

## Deletion and restoration

Deleting a document or a finished hearing releases its storage allowance immediately. During the configured grace period, the originals and their relationships remain recoverable. Reads hide the removed sources. Findings and historical chat messages keep labelled citation snapshots. Restoring a source checks the current storage allowance and brings back its references, board positions and links, alongside edits made in the interim. Case restoration also checks the organisation’s active case, board and storage limits.

The background service checks expired records on startup and at least hourly. It removes expired case data, derived records, retained microphone segments and originals in bounded batches. Each object key enters a durable deletion queue before its database owner is removed. Failed local or S3 deletes use backoff. Database backups and any independently configured S3 object versions follow the deployment’s backup lifecycle.

## Analysis worker

Start `runAnalysisWorker()` from the service process and keep its returned stop function for shutdown. The database transaction that persists a private, final statement with phase `queued` also registers the analysis job. Two worker lanes lease pending jobs, renew their leases during work and recover queued statements after a restart. Database failures retry with backoff. The transcript remains available when analysis cannot produce a grounded finding.

OpenAI calls use a server-side `OPENAI_API_KEY` and optional `OPENAI_PROJECT_ID`. The default text model is `gpt-6.1-sol`. A PostgreSQL worker indexes private document passages, finalized testimony and findings with `text-embedding-3-small` in 1,536 dimensions. It backfills existing cases and reindexes changed evidence. The active case palette, Assistant and hearing analysis combine lexical and cosine ranks. Selected Assistant contexts restrict candidate sources before scoring. Numbered citations and exact quotes are checked against the original evidence.

PostgreSQL can calculate exact cosine similarity over native real arrays with the application role. With the `vector` extension installed it uses pgvector’s cosine operator, including for earlier embeddings. Set `JUDE_SEMANTIC_SEARCH=false` to disable embedding requests. Guest workspaces and unindexed PostgreSQL cases use text matches. The SQLite Assistant can index evidence on demand as described below. The organization-wide search directory uses literal matches. The voice service owns recording transport and transcription.

## Assistant retrieval and requests

Private assistant requests combine keyword ranking with multilingual embeddings (`OPENAI_EMBEDDING_MODEL`, default `text-embedding-3-small`). PostgreSQL reuses the background index described above. For local SQLite development, the Assistant caches 512-dimensional embeddings in `assistant_embeddings`, scoped to the case and source, with cascade deletion. Model and content hashes prevent reuse after source changes. Both paths honor `JUDE_SEMANTIC_SEARCH=false`. No separate vector service is required.

The SQLite cache uses 5,000-byte source chunks with up to 200 characters of overlap. Each question indexes at most 96 missing chunks in batches of 24; subsequent questions resume the remainder. PostgreSQL indexing continues in its background worker. Partial indexing and provider failures are disclosed in the saved answer. Selected contexts constrain retrieval. Up to eight recent messages help interpret follow-ups; prior answers never count as evidence. Exact source text and bounded conversation history go to the configured OpenAI project. Final quotations must match the supplied source verbatim, and cited records and case access are checked again before saving. Low positive cosine scores remain candidates for assistant answers across languages; insufficient evidence produces no answer or citations. The case search palette retains its existing relevance cutoff.

`OPENAI_ASSISTANT_MODEL` overrides `OPENAI_MODEL`. `OPENAI_ASSISTANT_MAX_OUTPUT_TOKENS` defaults to 6,000 (including reasoning), accepts 512–16,000, and can be tuned for the chosen model. Without an AI key, keyword retrieval remains available. Pasal Discovery supplies public regulation metadata and links, not full article text in the model's answer context. It sends reconstructed public identifiers or fixed legal vocabulary, never raw private case text. Discovery accepts current and legacy result shapes and reports failures separately from no matches.

Questions accept at most 6,000 characters. Send `Accept: application/x-ndjson` for the existing typed event protocol: `status` events report reading/retrieving/answering/legal/saving phases, `partial` events contain evidence-checked previews, and `complete` contains the saved thread. The `error` event carries a code, status and message. Ordinary JSON clients remain supported. Accepted keyed requests survive a disconnected subscriber so the same idempotency key can resume the result. The Stop control explicitly posts to `/cases/{caseId}/threads/{threadId}/cancel` with that key to abort provider work. Stopping before saving does not append messages or consume an application question; a response already saved remains available. Shared generation is bounded to two minutes.

Browser drafts are kept in session storage by user, case and conversation, including selected contexts and the Pasal toggle. They survive refresh and dock closure within the tab. Clear the field to discard a draft. Provider credentials remain server-side.

## Verification

Run the service regression suite from the repository root.

```sh
pnpm test -- packages/core/tests/server.test.ts
```

The suite uses fresh, isolated local storage. Set `JUDE_TEST_DATABASE_URL` to a disposable PostgreSQL database to run the same checks there. Tests create new organisations and cases. They exercise session isolation, multiple workspaces, grants and revocation, concurrent quotas, optimistic board saves, original-file authorization, PDF and DOCX indexing, transcript import, queue recovery and archive round trips.

