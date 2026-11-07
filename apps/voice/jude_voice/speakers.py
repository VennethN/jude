"""Apply anonymous pyannote speaker labels to transcript turns within one hearing."""

import asyncio
import logging
from collections import OrderedDict
from uuid import uuid4

from .diarization import diarization_available, diarize, speaker_at
from .providers import wav_header

LOG = logging.getLogger(__name__)
BYTES_PER_SECOND = 24000 * 2
BATCH_BYTES = BYTES_PER_SECOND * 180
MAX_ANCHORS = 8
ANCHOR_SECONDS = 2


class SpeakerWindow:
    """Keep brief acoustic context in RAM to associate voices across processing windows."""

    def __init__(self):
        self.anchors = OrderedDict()

    def label(self, chunks):
        anchors = list(self.anchors.items())
        audio = bytearray()
        anchor_spans = []
        for label, sample in anchors:
            start = len(audio) / BYTES_PER_SECOND
            audio.extend(sample)
            anchor_spans.append((label, start, len(audio) / BYTES_PER_SECOND))
        beginning = len(audio) / BYTES_PER_SECOND
        spans = []
        for statement_id, pcm in chunks:
            start = len(audio) / BYTES_PER_SECOND
            audio.extend(pcm)
            spans.append((statement_id, start, len(audio) / BYTES_PER_SECOND))
        if not spans:
            return {}
        turns = diarize(wav_header(len(audio)) + audio, ".wav")
        labels = {}
        for label, start, end in anchor_spans:
            local = speaker_at(turns, start, end)
            if local:
                labels.setdefault(local, label)
        assigned = {}
        for statement_id, start, end in spans:
            local = speaker_at(turns, start, end)
            if local and statement_id:
                assigned[statement_id] = labels.setdefault(local, uuid4().hex)
        # Only speech predicted inside this new window can refresh an anchor.
        for turn in sorted(turns, key=lambda item: item.end - item.start):
            if turn.speaker not in labels or turn.start < beginning or turn.end - turn.start < 0.7:
                continue
            start = int(turn.start * 24000) * 2
            stop = int(min(turn.end, turn.start + ANCHOR_SECONDS) * 24000) * 2
            label = labels[turn.speaker]
            self.anchors[label] = bytes(audio[start:stop])
            self.anchors.move_to_end(label)
        while len(self.anchors) > MAX_ANCHORS:
            self.anchors.popitem(last=False)
        return assigned


def process_recording(repo, job):
    inputs = repo.diarization_inputs(job)
    statements = {line["id"] for line in inputs["statements"]}
    window = SpeakerWindow()
    batch, size, assignments = [], 0, {}
    for turn in inputs["turns"]:
        if size >= BATCH_BYTES:
            assignments.update(window.label(batch))
            batch, size = [], 0
        statement_id = turn["statement_id"]
        pcm = repo.storage.get(turn["object_key"])
        batch.append((statement_id if statement_id in statements else None, pcm))
        size += len(pcm)
    assignments.update(window.label(batch))
    repo.finish_diarization(job, assignments)


async def run_worker(repo):
    async def renew(job):
        while True:
            await asyncio.sleep(180)
            await asyncio.to_thread(repo.renew_diarization, job)

    while True:
        try:
            job = await asyncio.to_thread(repo.claim_diarization) if diarization_available() else None
            if job is None:
                await asyncio.sleep(5)
                continue
            heartbeat = asyncio.create_task(renew(job))
            try:
                await asyncio.to_thread(process_recording, repo, job)
            except Exception:  # noqa: BLE001 - release and reschedule any failed job
                LOG.warning("Retrying a speaker diarization job")
                await asyncio.to_thread(repo.retry_diarization, job)
            finally:
                heartbeat.cancel()
                await asyncio.gather(heartbeat, return_exceptions=True)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 - either database driver can disconnect between jobs
            LOG.warning("Speaker worker is waiting for its case store")
            await asyncio.sleep(5)
