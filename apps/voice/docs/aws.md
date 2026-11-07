# Hosting the voice service

The Python voice service handles hearing HTTP and WebSocket requests under `/api/live/**`. The base image supports synthetic hearing replay and authorised playback of previously retained audio. To process new private recordings or live microphone input, run a pyannote target with the Community-1 weights and an OpenAI API key. The local pipeline assigns anonymous speaker turns and OpenAI transcribes speech.

## Independent service

Build the standalone Python service from the repository root. The default EC2 deployment uses x86-64 Linux.

```sh
docker buildx build --platform linux/amd64 --target voice --tag jude-voice:release --load .
```

The image runs `python -m jude_voice` with `PYTHONPATH=/app/apps/voice`, `VOICE_HOST=0.0.0.0` and `VOICE_PORT=3001`. Put it on a private subnet or application network. Set `VOICE_ORIGIN` on the web service to an internal HTTP origin such as `http://jude-voice:3001`. Set `ORIGIN` to the public HTTPS site on both services. Browsers use the public web origin for hearing HTTP requests and WebSocket upgrades. Each voice request checks the user session and case membership.

Supply the shared PostgreSQL database, S3 originals bucket and KMS key to both services. For private-case transcription, set `OPENAI_API_KEY` and provision the model described below. The service’s `GET /healthz` checks database readiness. Supervise the processes independently, and release a compatible web and voice pair together.

The single-host EC2 target `release` runs the web and voice services as separate processes in one container. Voice listens on loopback in this arrangement. Caddy serves the web application over TLS. The host checks both health endpoints before starting the public proxy.

## Local speaker diarization

The `voice-pyannote` and `release-pyannote` targets install the CPU builds of PyTorch and torchaudio along with pyannote.audio and TorchCodec. They share the same service code as the corresponding baseline targets. Keep the model snapshot outside the source and container build context.

```sh
docker buildx build --platform linux/amd64 --target voice-pyannote --tag jude-voice:diarization --load .
```

For the combined EC2 host, publish the `release-pyannote` target instead. Review the model’s gated access terms with the organisation’s Hugging Face account, then download the complete snapshot at revision `3533c8cf8e369892e6b79ff1bf80f7b0286a54ee` using an authorised environment. The snapshot includes `config.yaml`, segmentation and embedding assets. The pipeline supports offline use from a local directory. [Community-1 model card](https://huggingface.co/pyannote/speaker-diarization-community-1)

On the EC2 host, provision that snapshot at `/var/lib/jude/models/community-1` on encrypted storage readable by UID 1000. Set `JUDE_DIARIZATION_MODEL` to `/models/community-1` in the application secret. A service reload mounts the snapshot read-only at that path. Model access credentials used to acquire the snapshot stay in the provisioning environment. For an independently deployed voice container, configure the same read-only mount and environment value. `JUDE_DIARIZATION_TIMEOUT_MS` adjusts the worker timeout. Benchmark the intended hearing lengths before setting `app_instance_type` and `app_root_volume_gb` for the CPU pipeline.

When supplying an image tag to the [AWS environment guide](../../web/docs/aws.md), include the selected build target. Keep the compatible image digest and model snapshot revision with the release record.
