# Working on Jude

Jude is an Indonesian-first courtroom workspace. Preserve source wording in both interface languages. Link findings and answers to the exact case record and keep synthetic examples labelled.

Start with apps/web/PRODUCT.md and apps/web/DESIGN.md for interface work. Apply Impeccable to the public pages and workspace, then inspect actual desktop and phone renders. Keep private case material in the server boundary. Every mutation checks the current organisation and case.

Use Conventional Commits 1.0.0. Write each subject as `type(scope): short description`. Use `feat` for a capability and `fix` for a correction. Use `!` or a `BREAKING CHANGE:` footer for an incompatible change. Commit completed slices progressively and stage only their files.

Run `pnpm check`, `pnpm test`, `pnpm build`, and the relevant browser tests before handoff.

## Voice service

Implement the service in Python. Voice owns pyannote speaker diarization, OpenAI transcription, audio persistence, recording permission and synthetic replay. The browser microphone belongs to Jude Web. Read apps/voice/README.md for local setup and the web service contract.

Keep model credentials server-side. Case audio and inferred speaker labels belong to their originating hearing. Verify session, case role and recording permission in the backend. Use the shared SQL migration ledger and run the Python suite against SQLite and PostgreSQL for database changes.

Use Conventional Commits 1.0.0. Write each subject as `type(scope): short description` and commit completed changes progressively.

## Repository structure

Keep web source, browser tests, environment examples and web tooling in apps/web. Keep Python service files in apps/voice and shared domain/server code and tests in packages/core. Shared database migrations live in migrations. Infrastructure, shared Docker builds, deployment tools and architecture diagrams live in infra. Root files are workspace configuration and orchestration. Frontend, API and Python voice run on Jakarta EC2; do not add Amplify hosting. Never commit secrets.
