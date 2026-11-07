# Hosting the voice service

The Python voice service handles hearing HTTP and WebSocket requests under `/api/live/**`. The base image supports synthetic hearing replay and authorised playback of previously retained audio. To process new private recordings or live microphone input, run a pyannote target with the Community-1 weights and an OpenAI API key. The local pipeline assigns anonymous speaker turns and OpenAI transcribes speech.

## Independent service

Build the standalone Python service from the repository root. The default EC2 deployment uses x86-64 Linux.

```sh
docker buildx build -f infra/docker/Dockerfile --platform linux/amd64 --target voice --tag jude-voice:release --load .
```

The image runs `python -m jude_voice` with `PYTHONPATH=/app/apps/voice`, `VOICE_HOST=0.0.0.0` and `VOICE_PORT=3001`. Put it on a private subnet or application network. Set `VOICE_ORIGIN` on the web service to an internal HTTP origin such as `http://jude-voice:3001`. Set `ORIGIN` to the public HTTPS site on both services. Browsers use the public web origin for hearing HTTP requests and WebSocket upgrades. Each voice request checks the user session and case membership.

Supply the shared PostgreSQL database, S3 originals bucket and KMS key to both services. For private-case transcription, set `OPENAI_API_KEY` and provision the model described below. The service’s `GET /healthz` checks database readiness. Supervise the processes independently, and release a compatible web and voice pair together.

The GitHub Actions release runs both processes in the `release-pyannote` container. Voice listens on loopback. CloudFront serves HTTPS and Caddy forwards requests to the web process. The launcher checks both database health endpoints before starting the proxy.

## Local speaker diarization

The `voice-pyannote` and `release-pyannote` targets install the CPU builds of PyTorch and torchaudio along with pyannote.audio and TorchCodec. They share the same service code as the corresponding baseline targets. Keep the model snapshot outside the source and container build context.

```sh
docker buildx build -f infra/docker/Dockerfile --platform linux/amd64 --target voice-pyannote --tag jude-voice:diarization --load .
```

For the combined EC2 host, publish the `release-pyannote` target instead. Review the model’s gated access terms with the organisation’s Hugging Face account, then download the complete snapshot at revision `3533c8cf8e369892e6b79ff1bf80f7b0286a54ee` using an authorised environment. The snapshot includes `config.yaml`, segmentation and embedding assets. The pipeline supports offline use from a local directory. [Community-1 model card](https://huggingface.co/pyannote/speaker-diarization-community-1)

For GitHub Actions deployments, install the complete snapshot under `/var/lib/jude/models/community-1` on encrypted host storage. Keep the weight files within that directory and give container UID 1000 read access. Set these SecureString values in AWS Systems Manager Parameter Store.

| Parameter | Value |
| --- | --- |
| `/jude-dev/runtime/JUDE_DIARIZATION_MODEL` | `/models/community-1` |
| `/jude-dev/runtime/OPENAI_API_KEY` | The voice service’s OpenAI credential |

The EC2 launcher mounts the snapshot read-only and loads it with networking disabled before replacing the running containers. An inaccessible or incomplete snapshot stops the release at this step. The inference worker uses the same offline mount.

An absent or empty model parameter keeps replay and playback available. For opt-in Hub downloads, set the model parameter to `pyannote/speaker-diarization-community-1` and supply `/jude-dev/runtime/HF_TOKEN` as a SecureString. The voice worker retrieves the pinned revision when processing speech. Keep Hugging Face credentials on the provisioning machine for offline deployments.

For the custom-domain `jude.service` deployment, set `JUDE_DIARIZATION_MODEL=/models/community-1` in its Secrets Manager application secret. For an independent voice container, configure the same read-only bind mount and model path. `JUDE_DIARIZATION_TIMEOUT_MS` sets the inference deadline in milliseconds.

For the Jakarta host deployed by GitHub Actions, temporarily store an authorized Hugging Face read token as the SSM SecureString `/jude-dev/runtime/HF_TOKEN`. Run `infra/deploy/provision-diarization.sh` on that host through SSM. It downloads the pinned snapshot using the current application image, verifies that the pipeline loads without network access, and installs it without replacing an existing model. It does not restart the application.

After provisioning succeeds, remove the temporary `HF_TOKEN` parameter and set `/jude-dev/runtime/JUDE_DIARIZATION_MODEL` to `/models/community-1`. Redeploy using `infra/deploy/run-voice-host.sh`. The deployment validates the model before replacing the running containers and mounts it read-only. The snapshot persists across application deployments. Verify `/capabilities` on voice's internal port 3001 and test both file and live transcription using synthetic speech before accepting private recordings.

When supplying an image tag to the [AWS environment guide](../../web/docs/aws.md), include the selected build target. Keep the compatible image digest and model snapshot revision with the release record.
