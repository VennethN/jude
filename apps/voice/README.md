# Jude Voice

Jude Voice is a Python service for private hearing recordings and speaker-labelled transcripts. It runs pyannote Community-1 on the voice host to distinguish speakers. OpenAI transcribes speech directly through its file and Realtime APIs. Counsel can confirm the speaker names and roles in Jude Web.

## Run the service

Use Python 3.11 or 3.12 and FFmpeg. From the repository root:

```sh
python3 -m venv apps/voice/.venv
apps/voice/.venv/bin/python -m pip install -r apps/voice/requirements.txt
PYTHONPATH=apps/voice apps/voice/.venv/bin/python -m jude_voice
```

The service listens on `127.0.0.1:3001` by default. `GET /healthz` checks database access. The synthetic case exercises real session, replay and persistence paths with the base install. From the repository root, `pnpm dev` runs both apps and `pnpm test:voice` runs the Python suite. A Python-only checkout can run `PYTHONPATH=apps/voice apps/voice/.venv/bin/python -m unittest discover -s apps/voice/tests -v`.

The service-specific `.env.example` lists runtime settings. From the repository root, `pnpm dev`, `pnpm start` and `pnpm voice:start` load the root `.env`, including the shared `DATABASE_URL`. When launching Python directly, export the settings into its environment. Production receives secrets from SSM. The shared EC2 image is built from `infra/docker/Dockerfile` using the repository root as its build context.

## Enable private audio

Install the pinned ML dependencies in the voice environment. On Linux CPU hosts, install the CPU torch and torchaudio wheels first:

```sh
apps/voice/.venv/bin/python -m pip install --index-url https://download.pytorch.org/whl/cpu torch==2.8.0 torchaudio==2.8.0
apps/voice/.venv/bin/python -m pip install -r apps/voice/requirements-diarization.txt
```

Accept the Community-1 model terms and provision a snapshot on the voice host. Set `JUDE_DIARIZATION_MODEL` to its absolute directory. To retrieve the pinned revision using an authorized Hugging Face account, set the value to `pyannote/speaker-diarization-community-1` and supply `HF_TOKEN`. Local model loading works offline. Set `OPENAI_API_KEY` in the voice environment and optionally `OPENAI_PROJECT_ID`. [Community-1 model and access terms](https://huggingface.co/pyannote/speaker-diarization-community-1)

For the live hearing experiment, set `CHATGPT_TRANSCRIBE=true` in the root `.env` or the voice service environment and restart voice. New microphone sessions use the exact `gpt-transcribe` model. It begins recognition after each audio turn is committed and can emit partial text before the final transcript. With the switch unset or `false`, microphone sessions use `OPENAI_REALTIME_TRANSCRIPTION_MODEL` if configured, otherwise `gpt-live-transcribe`. [Realtime transcription](https://developers.openai.com/api/docs/guides/realtime-transcription)

To try the model on one authorized recording, append `transcription=gpt-transcribe` to the hearing WebSocket query. This is the only client-selectable model. Other values use the voice host’s configured model. The authenticated `ready` frame reports the choice in `transcriptionModel`, alongside `maxInFlight`. All turns on that connection share the choice.

Uploads use `OPENAI_TRANSCRIPTION_MODEL`, which defaults to `gpt-transcribe`. Both recording paths send the hearing’s Indonesian or English language hint. [File transcription](https://developers.openai.com/api/docs/guides/speech-to-text)

Set `VOICE_HOST`, `VOICE_PORT` and the public web `ORIGIN` for the deployment. Configure web with an internal `VOICE_ORIGIN`. Both apps share `DATABASE_URL` for PostgreSQL or an absolute `JUDE_DB_PATH` for local SQLite. Local audio uses `JUDE_FILES_DIR`. AWS audio uses a private S3 bucket and KMS key. [AWS deployment](docs/aws.md)

## Recording

Confirm permission for an open hearing before recording or uploading audio. Uploads accept up to 25 MiB and 30 minutes. The voice service separates speech by anonymous speaker and transcribes each passage in its original language. A live microphone acknowledges each turn after it is saved. A disconnected browser queues its pending turns until the connection resumes.

When the lawyer retains a live recording, a leased worker processes the saved turns after the hearing ends. Transcript-only mode groups speakers using short-lived acoustic context in memory during the connection. Interrupted sessions and uncertain matches can leave separate anonymous labels for counsel to review. Hand-confirmed labels are preserved.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/live/capabilities` | Check private transcription readiness through the same gateway that handles recordings |
| `GET /capabilities` | Check the same readiness directly on the Python service |
| `POST /api/live/:caseId/:hearingId/replay` | Advance a synthetic hearing using its expected cursor |
| `WS /api/live/:caseId/:hearingId/socket` | Accept microphone audio and acknowledge saved turns |
| `POST /api/live/:caseId/upload` | Transcribe a private audio file into a recorded hearing |
| `GET /api/live/:caseId/:hearingId/audio` | Read a permitted recording with byte-range support |

[Web app](../web/README.md) · [Shared case storage](../../packages/core/README.md)
