# Jude core

The web desk and the voice service use this TypeScript package to open the same case record. The public exports `@jude/core/domain` and `@jude/core/plans` contain the shared types, review rules and plan catalogue. Imports under `@jude/core/server/*` belong on the server.

## Case records

A workspace contains a case, hearings, speakers, verbatim statements, findings, source passages, filed documents, evidence connections, boards, conversations, replies and legal references. Each organisation receives its own three labelled synthetic examples. The session maps familiar demonstration references such as `c1` to that organisation’s case IDs. Entity IDs within an example resolve within its case.

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

## Analysis worker

Start `runAnalysisWorker()` from the service process and keep its returned stop function for shutdown. The database transaction that persists a private, final statement with phase `queued` also registers the analysis job. Two worker lanes lease pending jobs, renew their leases during work and recover queued statements after a restart. Database failures retry with backoff. The transcript remains available when analysis cannot produce a grounded finding.

OpenAI calls use a server-side `OPENAI_API_KEY` and optional `OPENAI_PROJECT_ID`. The assistant retrieves the active case’s passages and statements, then checks citations and exact quotes before returning a model answer. With no configured model, the response can present the sources themselves. Guest and synthetic examples use their local source records. The voice service owns recording transport and transcription.

## Verification

Run the service regression suite from the repository root.

```sh
pnpm exec vitest run tests/server.test.ts
```

The suite uses fresh, isolated local storage. Set `JUDE_TEST_DATABASE_URL` to a disposable PostgreSQL database to run the same checks there. Tests create new organisations and cases. They exercise session isolation, multiple workspaces, grants and revocation, concurrent quotas, optimistic board saves, original-file authorization, PDF and DOCX indexing, transcript import, queue recovery and archive round trips.

