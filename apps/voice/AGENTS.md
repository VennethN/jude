# Working on Jude Voice

Implement the service in Python. Voice owns pyannote speaker diarization, OpenAI transcription, audio persistence, recording permission and synthetic replay. The browser microphone belongs to Jude Web. Read README.md for local setup and the web service contract.

Keep model credentials server-side. Case audio and inferred speaker labels belong to their originating hearing. Verify session, case role and recording permission in the backend. Use the shared SQL migration ledger and run the Python suite against SQLite and PostgreSQL for database changes.

Use Conventional Commits 1.0.0. Write each subject as `type(scope): short description` and commit completed changes progressively.
