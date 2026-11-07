# Jude Voice

Jude Voice is a Python service for private hearing recordings and speaker-labelled transcripts. Amazon Transcribe recognizes live and uploaded speech through its streaming API in Singapore. Python keeps AWS credentials server-side; speaker names remain human-assigned. Counsel can confirm the speaker names and roles in Jude Web.

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

Set `JUDE_TRANSCRIBE_REGION=ap-southeast-1`. The AWS credential chain uses the EC2 instance role in production and your AWS profile locally. Grant `transcribe:StartStreamTranscriptionWebSocket` in that region. No OpenAI or Hugging Face credential is needed for new audio. Amazon Transcribe supplies anonymous speaker labels; counsel assigns names and roles.

Jakarta has no Transcribe streaming endpoint. Audio is processed in Singapore; the application, database, and retained audio remain in Jakarta. Credentials and signed provider URLs stay inside Python. [Amazon Transcribe streaming](https://docs.aws.amazon.com/transcribe/latest/dg/streaming.html) · [AWS endpoints](https://docs.aws.amazon.com/general/latest/gr/transcribe.html)

Set `VOICE_HOST`, `VOICE_PORT` and the public web `ORIGIN` for the deployment. Configure web with an internal `VOICE_ORIGIN`. Both apps share `DATABASE_URL` for PostgreSQL or an absolute `JUDE_DB_PATH` for local SQLite. Local audio uses `JUDE_FILES_DIR`. AWS audio uses a private S3 bucket and KMS key. [AWS deployment](docs/aws.md)

## Recording

Confirm permission for an open hearing before recording or uploading audio. Uploads accept up to 25 MiB and 30 minutes. The voice service separates speech by anonymous speaker and transcribes each passage in its original language. A live microphone acknowledges each turn after it is saved. A disconnected browser queues its pending turns until the connection resumes.

Live audio uses one ordered Amazon Transcribe stream per connection. Final word items are split at every speaker change, preserving an A → B → A conversation as three statements. Names stay human-assigned. Unknown voices stay unidentified, and automatic labels are scoped to their hearing and provider stream; reconnecting does not prove the same person's identity.

The browser keeps pending audio until transcript completion is acknowledged. Stop drains the provider's final results before closing. Uploaded recordings use one stream for the file and retain the provider's speaker transitions. File processing is paced at audio speed.

The optional pyannote Community-1 worker remains available for unresolved recordings created by the previous service. Its model and deployment instructions are in the [AWS guide](docs/aws.md#local-speaker-diarization); it is not required for new Amazon Transcribe recordings.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/live/capabilities` | Check private transcription readiness through the same gateway that handles recordings |
| `GET /capabilities` | Check the same readiness directly on the Python service |
| `POST /api/live/:caseId/:hearingId/replay` | Advance a synthetic hearing using its expected cursor |
| `WS /api/live/:caseId/:hearingId/socket` | Accept microphone audio and acknowledge saved turns |
| `POST /api/live/:caseId/upload` | Transcribe a private audio file into a recorded hearing |
| `GET /api/live/:caseId/:hearingId/audio` | Read a permitted recording with byte-range support |

[Web app](../web/README.md) · [Shared case storage](../../packages/core/README.md)
