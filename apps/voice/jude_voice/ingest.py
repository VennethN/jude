"""Ordered capture transport with independent durable transcript completion."""

import asyncio
from uuid import uuid4

from anyio import CancelScope

from .providers import ProviderError
from .repository import VoiceError
from .transcribe import TranscribeStream

MAX_IN_FLIGHT = 3
MAX_CAPTURES = 4096
ROTATE_SECONDS = 900


async def write_transaction(fn, *args, **kwargs):
    # Join SQL/file writes before releasing the recorder even during disconnect.
    write = asyncio.create_task(asyncio.to_thread(fn, *args, **kwargs))
    try:
        return await asyncio.shield(write)
    except asyncio.CancelledError:
        with CancelScope(shield=True):
            await write
        raise


async def stream_turns(ws, repo, session, case_id, hearing_id, lease, decode,
                       realtime=None, speakers=None):
    """A socket owns exactly one provider epoch; capture ACKs never mean completion.

    The optional factory exists for transport tests. Legacy speaker grouping is
    deliberately unused: AWS labels already belong to this continuous epoch.
    """
    factory = realtime or TranscribeStream
    epoch = uuid4().hex
    scope = (session, case_id, hearing_id)
    language = "en" if ws.query_params.get("lang") == "en" else "id"
    writer = asyncio.Lock()
    captures = []  # metadata only; PCM is released after each ordered send
    pending = {}
    sent_seconds = 0.0
    last_end = None
    ending = False
    rotate = False
    watermark = 0.0
    allowance_error = None

    async def send(frame):
        async with writer:
            await ws.send_json(frame)

    async def complete(limit):
        for tid, capture in list(pending.items()):
            if capture["end"] > limit + 1e-6:
                continue
            receipt = await write_transaction(repo.complete_capture, *scope,
                lease=lease, epoch=epoch, turn_id=tid)
            del pending[tid]
            await send({**receipt, "type": "ack"})

    def absolute(time, *, end=False):
        # Captures can have gaps (pause/reconnect). Never turn that gap into words.
        for capture in (reversed(captures) if not end else captures):
            if capture["begin"] - 1e-6 <= time <= capture["end"] + 1e-6:
                return capture["start"] + min(max(time - capture["begin"], 0), capture["end"] - capture["begin"])
        raise ProviderError("Transcript timestamp is outside captured audio.")

    def mapped_segments(segments):
        result = []
        for segment in segments:
            # Split at recording gaps using provider words; ordinary capture boundaries
            # stay one speaker run. This also supplies replay's exact word timestamps.
            words = segment.get("words")
            if not words:
                result.append({**segment, "start": absolute(segment["start"]),
                               "end": absolute(segment["end"], end=True)})
                continue
            group = None
            previous_offset = None
            for word in words:
                start = absolute(word["start"])
                end = absolute(word["end"], end=True)
                offset = start - word["start"]
                if group is None or abs(offset - previous_offset) > 1e-5:
                    group = {"start": start, "end": end, "text": word["text"],
                             "speaker": segment.get("speaker"), "words": []}
                    result.append(group)
                else:
                    group["text"] += " " + word["text"]
                    group["end"] = end
                group["words"].append({**word, "start": start, "end": end})
                previous_offset = offset
        return result

    async def heartbeat():
        while True:
            await asyncio.sleep(10)
            await asyncio.to_thread(repo.renew, *scope, lease)

    async with factory(language) as provider:
        async def receive_audio():
            nonlocal sent_seconds, last_end, ending, rotate, allowance_error
            while True:
                frame = await ws.receive_json()
                if frame.get("type") == "stop":
                    ending = True
                    await provider.end_audio()
                    return
                tid, start, pcm, keep = decode(frame)
                if tid in pending:
                    raise ValueError("Duplicate in-flight capture")
                try:
                    receipt = await write_transaction(repo.begin_capture, *scope,
                        lease=lease, epoch=epoch, turn_id=tid, start=start, pcm=pcm, keep=keep)
                except VoiceError as exc:
                    if exc.code != "guest_live_limit" or not captures:
                        raise
                    # Drain only audio already admitted to this AWS epoch, including pending finals.
                    allowance_error = exc
                    ending = True
                    await provider.end_audio()
                    return
                if receipt is not None:
                    await send({**receipt, "type": "ack"})
                    continue
                # Keep begin_capture's original PCM/fingerprint intact. Only the
                # provider input is trimmed to the durable transcript frontier so a
                # reconnect cannot re-recognize the same word with new boundaries.
                offset = await asyncio.to_thread(repo.capture_resume_offset, *scope,
                    lease=lease, turn_id=tid)
                if not isinstance(offset, (int, float)) or not 0 <= offset <= len(pcm) / 48000:
                    raise ValueError("Invalid capture resume offset")
                skipped = min(len(pcm), round(offset * 24000) * 2)
                pcm = pcm[skipped:]
                start += skipped / 48000
                if not pcm:
                    receipt = await write_transaction(repo.complete_capture, *scope,
                        lease=lease, epoch=epoch, turn_id=tid)
                    await send({**receipt, "type": "ack"})
                    continue
                if len(captures) >= MAX_CAPTURES or (last_end is not None and start < last_end - 1e-5):
                    raise ValueError("Capture order or epoch limit exceeded")
                duration = len(pcm) / 48000
                capture = {"id": tid, "start": start, "begin": sent_seconds, "end": sent_seconds + duration}
                captures.append(capture)
                pending[tid] = capture
                sent_seconds += duration
                last_end = start + duration
                await provider.send_audio(pcm)
                await send({"type": "accepted", "id": tid})
                # Bound provider bookkeeping and unresolved capture metadata. The browser
                # drains then opens a fresh epoch, retaining audio until completion.
                if not rotate and (sent_seconds >= ROTATE_SECONDS or
                                   sent_seconds - watermark >= 60 or len(captures) >= MAX_CAPTURES - 4):
                    rotate = True
                    await send({"type": "rotate"})

        async def receive_results():
            nonlocal watermark
            async for event in provider.events():
                if event["partial"]:
                    match = next((c for c in captures if c["end"] > event["start"]), None)
                    if match:
                        await send({"type": "partial", "id": event["id"], "turnId": match["id"],
                                    "t": absolute(event["start"]), "text": event["text"]})
                    continue
                receipt = await write_transaction(repo.save_stream_result, *scope,
                    lease=lease, epoch=epoch, result_id=event["id"], segments=mapped_segments(event["segments"]))
                await send({"type": "transcript", **receipt})
                watermark = max(watermark, event["end"])
                await complete(watermark)
            if not ending:
                raise ProviderError("Transcription ended before recording stopped.")
            await complete(float("inf"))
            if allowance_error is None:
                await send({"type": "stopped"})

        health = asyncio.create_task(heartbeat())
        sender = asyncio.create_task(receive_audio())
        receiver = asyncio.create_task(receive_results())
        try:
            await send({"type": "ready", "protocol": 2, "maxInFlight": MAX_IN_FLIGHT})
            done, _ = await asyncio.wait({health, sender, receiver}, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                task.result()
            if sender not in done and allowance_error is None:
                raise ProviderError("Transcription ended before recording stopped.")
            async with asyncio.timeout(35):
                if allowance_error is not None:
                    await sender
                done, _ = await asyncio.wait({health, receiver}, return_when=asyncio.FIRST_COMPLETED)
                for task in done:
                    task.result()
                if allowance_error is not None:
                    raise allowance_error
        finally:
            with CancelScope(shield=True):
                for task in (health, sender, receiver):
                    task.cancel()
                await asyncio.gather(health, sender, receiver, return_exceptions=True)
