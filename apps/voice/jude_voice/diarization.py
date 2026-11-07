"""Run community-1 locally. Speaker identities are anonymous and scoped to one inference."""

import json
import math
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

MODEL_ID = "pyannote/speaker-diarization-community-1"
MODEL_REVISION = "3533c8cf8e369892e6b79ff1bf80f7b0286a54ee"
MAX_SECONDS = 1800
EXTENSIONS = {"wav", "mp3", "m4a", "mp4", "webm", "mpeg", "mpga", "oga", "ogg", "flac"}
_capacity = threading.BoundedSemaphore(3)
_inference = threading.BoundedSemaphore(1)


@dataclass(frozen=True)
class SpeakerTurn:
    start: float
    end: float
    speaker: str


class DiarizationError(RuntimeError):
    """Safe diagnostic. Worker output never includes testimony or an audio filename."""


def _python():
    return os.getenv("JUDE_DIARIZATION_PYTHON") or sys.executable


def diarization_available():
    model = os.getenv("JUDE_DIARIZATION_MODEL", "")
    if not model or not shutil.which(_python()):
        return False
    if os.getenv("JUDE_DIARIZATION_DEVICE", "cpu") not in {"cpu", "cuda"}:
        return False
    if model == MODEL_ID:
        return bool(os.getenv("HF_TOKEN"))
    return Path(model).is_absolute() and (Path(model) / "config.yaml").is_file()


def speaker_at(turns: list[SpeakerTurn], start: float, end: float) -> str | None:
    """Choose a unique speaker covering at least half the transcript interval."""
    if not math.isfinite(start) or not math.isfinite(end) or end < start or start < 0:
        return None
    if end == start:
        active = {t.speaker for t in turns if t.start <= start < t.end}
        return active.pop() if len(active) == 1 else None
    coverage = defaultdict(float)
    for turn in turns:
        overlap = min(end, turn.end) - max(start, turn.start)
        if overlap > 0:
            coverage[turn.speaker] += overlap
    ordered = sorted(coverage, key=coverage.get, reverse=True)
    if not ordered or coverage[ordered[0]] + 1e-9 < (end - start) / 2:
        return None
    if len(ordered) > 1 and math.isclose(coverage[ordered[0]], coverage[ordered[1]], abs_tol=1e-9):
        return None
    return ordered[0]


def _child_env():
    keys = (
        "PATH",
        "HOME",
        "TMPDIR",
        "LANG",
        "SYSTEMROOT",
        "LD_LIBRARY_PATH",
        "DYLD_LIBRARY_PATH",
        "HF_HOME",
        "HF_HUB_CACHE",
        "SSL_CERT_FILE",
        "REQUESTS_CA_BUNDLE",
        "CUDA_VISIBLE_DEVICES",
        "JUDE_DIARIZATION_MODEL",
        "JUDE_DIARIZATION_DEVICE",
    )
    env = {key: os.environ[key] for key in keys if key in os.environ}
    env.update(
        {
            "PYANNOTE_METRICS_ENABLED": "0",
            "HF_HUB_DISABLE_TELEMETRY": "1",
            "HF_HUB_DISABLE_IMPLICIT_TOKEN": "1",
            "OMP_NUM_THREADS": "2",
            "OPENBLAS_NUM_THREADS": "2",
        }
    )
    if env["JUDE_DIARIZATION_MODEL"] == MODEL_ID:
        env["HF_TOKEN"] = os.environ["HF_TOKEN"]
        for key in ("HTTPS_PROXY", "NO_PROXY"):
            if key in os.environ:
                env[key] = os.environ[key]
    else:
        env["HF_HUB_OFFLINE"] = "1"
    return env


def _timeout():
    try:
        return max(0.05, min(1800, int(os.getenv("JUDE_DIARIZATION_TIMEOUT_MS", "300000")) / 1000))
    except ValueError as exc:
        raise DiarizationError("Invalid diarization timeout.") from exc


def _intervals(items):
    if not isinstance(items, list) or len(items) > 100_000:
        raise ValueError("Invalid intervals")
    prefix = uuid4().hex
    labels = {}
    turns = []
    for item in items:
        start, end, label = item["start"], item["end"], item["speaker"]
        if (
            not isinstance(label, str)
            or not label
            or len(label) > 180
            or isinstance(start, bool)
            or isinstance(end, bool)
            or not math.isfinite(start)
            or not math.isfinite(end)
            or not 0 <= start < end <= MAX_SECONDS + 0.05
        ):
            raise ValueError("Invalid interval")
        if label not in labels:
            labels[label] = f"{prefix}-{len(labels) + 1}"
        turns.append(SpeakerTurn(float(start), float(end), labels[label]))
    return sorted(turns, key=lambda t: (t.start, t.end))


def diarize(audio: bytes, extension: str) -> list[SpeakerTurn]:
    if not audio or not diarization_available():
        return []
    suffix = extension.lower().lstrip(".")
    if suffix not in EXTENSIONS or len(audio) > 90 * 1024 * 1024:
        raise DiarizationError("Unsupported diarization input.")
    if not _capacity.acquire(blocking=False):
        raise DiarizationError("The diarization worker is busy.")
    try:
        timeout = _timeout()
        if not _inference.acquire(timeout=timeout):
            raise DiarizationError("Timed out waiting for the diarization worker.")
        try:
            with tempfile.TemporaryDirectory(prefix="jude-diarization-") as directory:
                sample, result = Path(directory) / ("input." + suffix), Path(directory) / "result.json"
                with open(sample, "xb", opener=lambda path, flags: os.open(path, flags, 0o600)) as stream:
                    stream.write(audio)
                cmd = [_python(), str(Path(__file__).resolve()), str(sample), str(result)]
                try:
                    worker = subprocess.Popen(
                        cmd,
                        stdin=subprocess.DEVNULL,
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                        env=_child_env(),
                        start_new_session=True,
                    )
                    try:
                        status = worker.wait(timeout=timeout)
                    except subprocess.TimeoutExpired:
                        try:
                            os.killpg(worker.pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
                        worker.wait()
                        raise DiarizationError("Diarization timed out.")
                    if status or not result.is_file() or result.stat().st_size > 8 * 1024 * 1024:
                        raise DiarizationError(
                            "The local diarization worker could not process the recording."
                        )
                    return _intervals(json.loads(result.read_bytes()))
                except (OSError, ValueError, TypeError, KeyError) as exc:
                    raise DiarizationError(
                        "The local diarization worker returned no usable result."
                    ) from exc
        finally:
            _inference.release()
    finally:
        _capacity.release()


def _run_worker(sample: Path, target: Path):
    # Decode only the supplied local container into bounded 16 kHz mono PCM.
    command = [
        "ffmpeg",
        "-nostdin",
        "-v",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        "-format_whitelist",
        "wav,mp3,matroska,webm,mov,mp4,m4a,3gp,3g2,mj2,mpeg,ogg,flac",
        "-i",
        str(sample),
        "-vn",
        "-sn",
        "-dn",
        "-map",
        "0:a:0",
        "-t",
        str(MAX_SECONDS + 0.1),
        "-ac",
        "1",
        "-ar",
        "16000",
        "-f",
        "s16le",
        "pipe:1",
    ]
    pcm = subprocess.run(
        command, check=True, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL
    ).stdout
    if len(pcm) > MAX_SECONDS * 32000:
        raise ValueError("Audio exceeds the diarization window")
    if not pcm or not any(pcm):
        target.write_text("[]")
        return
    model = os.environ["JUDE_DIARIZATION_MODEL"]
    if model == MODEL_ID:
        from huggingface_hub import constants, snapshot_download

        model = snapshot_download(
            repo_id=MODEL_ID, revision=MODEL_REVISION, token=os.environ.pop("HF_TOKEN")
        )
        os.environ["HF_HUB_OFFLINE"] = "1"
        constants.HF_HUB_OFFLINE = True
    import torch
    from pyannote.audio import Pipeline

    device = os.getenv("JUDE_DIARIZATION_DEVICE", "cpu")
    if device not in {"cpu", "cuda"} or (device == "cuda" and not torch.cuda.is_available()):
        raise ValueError("Requested inference device unavailable")
    pipeline = Pipeline.from_pretrained(model)
    pipeline.to(torch.device(device))
    waveform = (
        torch.frombuffer(bytearray(pcm), dtype=torch.int16).to(torch.float32).div_(32768).unsqueeze(0)
    )
    with torch.inference_mode():
        result = pipeline({"waveform": waveform, "sample_rate": 16000})
    intervals = [
        {"start": max(0.0, segment.start), "end": min(len(pcm) / 32000, segment.end), "speaker": label}
        for segment, _, label in result.exclusive_speaker_diarization.itertracks(yield_label=True)
        if min(len(pcm) / 32000, segment.end) > max(0.0, segment.start)
    ]
    target.write_text(json.dumps(intervals, allow_nan=False))


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(2)
    try:
        os.umask(0o077)
        _run_worker(Path(sys.argv[1]), Path(sys.argv[2]))
    except Exception:  # noqa: BLE001 -- libraries can include paths and tokens in arbitrary errors.
        # Report operational failure to the caller without including media or token details in logs.
        sys.exit(1)
