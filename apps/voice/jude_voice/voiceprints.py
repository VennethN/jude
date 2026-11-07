"""Case-scoped acoustic matching. Recognition never establishes a person's name."""

import asyncio
import hashlib
import logging
import math
import os
from collections import OrderedDict
from pathlib import Path

MIN_SECONDS = 1.5
MAX_SECONDS = 6
RATE = 24000
LOG = logging.getLogger("uvicorn.error.voiceprints")


def normalized(vector):
    if not isinstance(vector, list) or not 1 <= len(vector) <= 4096:
        raise ValueError("Invalid voiceprint dimension")
    if any(type(x) not in (int, float) or not math.isfinite(x) for x in vector):
        raise ValueError("Invalid voiceprint value")
    norm = math.sqrt(sum(x * x for x in vector))
    if not math.isfinite(norm) or norm < 1e-8:
        raise ValueError("Empty voiceprint")
    return [x / norm for x in vector]


def cosine(a, b):
    return sum(x * y for x, y in zip(a, b, strict=True))


def configured():
    model = os.getenv("JUDE_VOICEPRINT_MODEL", "")
    return bool(model and Path(model).is_file())


class EmbeddingEngine:
    """Load the same whole-clip WeSpeaker embedding engine as the boilerplate."""

    def __init__(self):
        import torch
        from pyannote.audio import Inference, Model

        path = Path(os.environ["JUDE_VOICEPRINT_MODEL"])
        self.model = "wespeaker-sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()
        torch.set_num_threads(2)
        self.torch = torch
        self.inference = Inference(Model.from_pretrained(str(path)), window="whole", device=torch.device("cpu"))

    def embed(self, pcm, sample_rate=RATE):
        torch = self.torch
        waveform = torch.frombuffer(bytearray(pcm), dtype=torch.int16).float().div_(32768).unsqueeze(0)
        with torch.inference_mode():
            vector = self.inference({"waveform": waveform, "sample_rate": sample_rate})
        return normalized(vector.reshape(-1).tolist())


class VoiceprintWorker:
    """Bounded RAM-only clips. Transcript ACKs and recording stop never wait on ML."""

    def __init__(self, repo, engine_factory=EmbeddingEngine):
        self.repo = repo
        self.engine_factory = engine_factory
        self.queue = asyncio.Queue(maxsize=32)
        self.task = None

    def start(self):
        if configured():
            self.task = asyncio.create_task(self.run())

    async def close(self):
        if self.task:
            self.task.cancel()
            await asyncio.gather(self.task, return_exceptions=True)
        while not self.queue.empty():
            self.queue.get_nowait()
            self.queue.task_done()

    def submit(self, scope, hearing_id, source, pcm, sample_rate=RATE):
        if not self.task or self.task.done() or self.queue.full():
            return False
        self.queue.put_nowait((scope, hearing_id, source, pcm, sample_rate))
        return True

    async def run(self):
        try:
            engine = await asyncio.to_thread(self.engine_factory)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 - native labels remain available without the model
            LOG.warning("voiceprint_model_unavailable")
            return
        LOG.info("voiceprint_model_ready")
        while True:
            job = await self.queue.get()
            try:
                (session, case_id), hearing_id, source, pcm, sample_rate = job
                vector = await asyncio.to_thread(engine.embed, pcm, sample_rate)
                await asyncio.to_thread(self.repo.match_voiceprint, session, case_id, hearing_id,
                                        source=source, model=engine.model, embedding=vector)
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 - no private audio, vectors, tokens or names in logs
                LOG.warning("voiceprint_match_unavailable")
            finally:
                job = pcm = vector = None
                self.queue.task_done()


class VoiceprintSession:
    """Keep at most 90 seconds of stream PCM and short per-label speech excerpts."""

    def __init__(self, submit, sample_rate=RATE):
        self.submit = submit
        self.sample_rate = sample_rate
        self.audio = bytearray()
        self.offset = 0
        self.pending = OrderedDict()
        self.completed = set()

    def append(self, pcm):
        self.audio.extend(pcm)
        excess = max(0, len(self.audio) - 90 * self.sample_rate * 2)
        if excess:
            del self.audio[:excess]
            self.offset += excess

    def final(self, segments, source_id):
        for segment in segments:
            label = segment.get("speaker")
            if label is None or label in self.completed or len(self.completed) >= 200:
                continue
            # Overlapping speech is unsuitable for enrollment. Wait for a clean turn.
            if any(other is not segment and other.get("speaker") != label and
                   other["start"] < segment["end"] and other["end"] > segment["start"] for other in segments):
                continue
            start, end = (round(segment[key] * self.sample_rate) * 2 - self.offset for key in ("start", "end"))
            if start < 0 or end > len(self.audio) or end <= start:
                continue
            sample = self.pending.setdefault(label, bytearray())
            room = MAX_SECONDS * self.sample_rate * 2 - len(sample)
            sample.extend(self.audio[start:min(end, start + room)])
            self.pending.move_to_end(label)
            while len(self.pending) > 40:
                self.pending.popitem(last=False)
            if len(sample) >= MIN_SECONDS * self.sample_rate * 2 and self.submit(source_id(label), bytes(sample)):
                self.completed.add(label)
                del self.pending[label]


def upload_samples(pcm, segments, sample_rate):
    """Use already-decoded upload PCM; retain only bounded speech samples."""
    samples = []

    def collect(label, sample):
        if len(samples) >= 32:
            return False
        samples.append((label, sample, sample_rate))
        return True

    collector = VoiceprintSession(collect, sample_rate)
    collector.audio = pcm
    collector.final(segments, lambda label: label)
    return samples
