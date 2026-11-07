# Self-hosted speaker diarization

Jude Voice runs the pyannote Community-1 pipeline on the voice host. It decodes the local recording to mono 16 kHz, uses the pipeline’s exclusive speaker intervals and assigns anonymous identifiers scoped to that run. Counsel can confirm a participant’s name and role in the hearing. [Community-1 model card](https://huggingface.co/pyannote/speaker-diarization-community-1)

## Install the CPU runtime

Use a Python 3.11 or 3.12 virtual environment, FFmpeg 4–7 and its shared libraries. On a Linux x86-64 CPU host, run these commands from the repository root. The Apple and CUDA builds of PyTorch have their own wheel instructions. [PyTorch package guide](https://pytorch.org/get-started/previous-versions/) · [TorchCodec compatibility](https://github.com/meta-pytorch/torchcodec#installing-torchcodec)

```sh
python3.11 -m venv apps/voice/.venv
apps/voice/.venv/bin/python -m pip install -r apps/voice/requirements.txt
apps/voice/.venv/bin/python -m pip install --index-url https://download.pytorch.org/whl/cpu torch==2.8.0 torchaudio==2.8.0
apps/voice/.venv/bin/python -m pip install -r apps/voice/requirements-diarization.txt
```

The optional requirements pin pyannote.audio 4.0.4, Torch 2.8.0, torchaudio 2.8.0 and TorchCodec 0.7.0. Debian deployments need the shared libraries for Python and FFmpeg. The optional voice image installs them in its runtime stage. [pyannote.audio release](https://github.com/pyannote/pyannote-audio/releases/tag/4.0.4)

## Provision the model

Use a Hugging Face account authorized for Community-1. Review and accept the model terms on its page. Obtain a scoped read token and use it on the provisioning machine. Download the complete repository snapshot at commit `3533c8cf8e369892e6b79ff1bf80f7b0286a54ee`. Preserve its `config.yaml`, model directories, and weight files. [Pinned Community-1 revision](https://huggingface.co/pyannote/speaker-diarization-community-1/tree/3533c8cf8e369892e6b79ff1bf80f7b0286a54ee)

```sh
# Supply HF_TOKEN to the provisioning environment through its secret manager.
apps/voice/.venv/bin/python -c 'from huggingface_hub import snapshot_download; snapshot_download("pyannote/speaker-diarization-community-1", revision="3533c8cf8e369892e6b79ff1bf80f7b0286a54ee", local_dir="/srv/jude/models/community-1")'
```

Mount that directory read-only on the voice host. Set `JUDE_DIARIZATION_MODEL=/srv/jude/models/community-1`. The worker loads the local weights in offline mode and disables usage telemetry.

For an installation that downloads the pinned model on demand, set `JUDE_DIARIZATION_MODEL=pyannote/speaker-diarization-community-1`, provide `HF_TOKEN` in the voice service environment, and configure a private writable `HF_HOME` cache. Only the approved model identifier enables a Hub download. Audio decoding and inference run locally in either configuration.

| Setting | Use |
| --- | --- |
| `JUDE_DIARIZATION_MODEL` | Absolute path to the provisioned model directory or the approved Hub identifier |
| `JUDE_DIARIZATION_DEVICE` | `cpu` by default, or `cuda` with a compatible GPU, driver and PyTorch wheel |
| `JUDE_DIARIZATION_PYTHON` | Interpreter with the optional dependencies. Defaults to the voice service’s interpreter |
| `JUDE_DIARIZATION_TIMEOUT_MS` | Worker deadline in milliseconds. Defaults to 300000 |
| `HF_TOKEN`, `HF_HOME` | Model-download credentials and cache for the optional Hub path |

## Runtime behaviour and verification

Each voice process permits one active inference and two waiting callers. The worker gets a private temporary directory and a 0600 audio file. The parent cleans up on success, malformed media, worker failure and timeout. A timeout terminates the worker process group. OpenAI and AWS credentials stay outside its environment. An unconfigured model and silence produce empty intervals. Worker failures return a typed `DiarizationError`.

The alignment helper chooses a speaker when the exclusive intervals cover at least half of a transcript segment and produce a unique winner. Ties, gaps and weak coverage keep the speaker unassigned. Repeated inferences use separate identifiers. A recording may contain up to 30 minutes per inference window.

Run the package tests from the repository root. They cover a real FFmpeg decoding of silence, an isolated fixture worker, segment alignment, worker cleanup, timeout, and the recording database. `JUDE_TEST_DATABASE_URL` selects a PostgreSQL test database where the account can create temporary schemas. The default uses disposable SQLite databases.

```sh
PYTHONPATH=apps/voice apps/voice/.venv/bin/python -m unittest discover -s apps/voice/tests -v
```

After the authorized model is mounted, run an inference smoke test using an approved local audio fixture with two speakers. The example prints the count of anonymous speakers and their intervals. [Voice service setup](../README.md)

```sh
PYTHONPATH=apps/voice apps/voice/.venv/bin/python - /path/to/approved-fixture.wav <<'PY'
import sys
from pathlib import Path
from jude_voice.diarization import diarize, diarization_available

if not diarization_available():
    raise SystemExit("Configure an accessible community-1 model first")
source = Path(sys.argv[1])
turns = diarize(source.read_bytes(), source.suffix)
print(len({turn.speaker for turn in turns}), "anonymous speakers")
for turn in turns:
    print(round(turn.start, 2), round(turn.end, 2), turn.speaker)
PY
```

