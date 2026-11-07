"""Server-only Amazon Transcribe WebSocket transport (no S3 jobs or API keys).

TranscribeStream owns one recognition epoch. Consume events concurrently with
sending audio; end_audio/end_input flushes AWS, then drain events to normal close.
Speaker labels are anonymous and local to this stream, never person identities.
"""

import asyncio
import contextlib
import json
import math
import os
import struct
import zlib

import boto3
from botocore.auth import SigV4QueryAuth
from botocore.awsrequest import AWSRequest
from botocore.eventstream import EventStreamBuffer
from websockets.asyncio.client import connect


class ProviderError(Exception):
    """Sanitized provider failure suitable for the service boundary."""


def _configuration():
    region = os.getenv("JUDE_TRANSCRIBE_REGION", "ap-southeast-1").strip()
    session = boto3.Session()
    # Use the SDK endpoint catalog; Jakarta has no Transcribe endpoint.
    if region not in session.get_available_regions("transcribe"):
        raise ProviderError("Transcription region is not supported.")
    credentials = session.get_credentials()
    if credentials is None:
        raise ProviderError("Transcription is not configured.")
    frozen = credentials.get_frozen_credentials()
    if not frozen.access_key or not frozen.secret_key:
        raise ProviderError("Transcription is not configured.")
    return region, frozen


def transcription_available() -> bool:
    """Check region and IAM credential chain, not authorization or service health.

    May refresh credentials through IMDS/STS; run in a worker thread. No paid
    Transcribe request is made. No OpenAI configuration is consulted.
    """
    try:
        _configuration()
        return True
    except Exception:  # noqa: BLE001 - sanitize external SDK, protocol and network failures
        return False


def _presigned_url(language: str, sample_rate: int) -> str:
    try:
        region, credentials = _configuration()
        code = {"id": "id-ID", "id-ID": "id-ID", "en": "en-US", "en-US": "en-US"}[
            language
        ]
        host = f"transcribestreaming.{region}.amazonaws.com:8443"
        request = AWSRequest(
            method="GET",
            url=f"https://{host}/stream-transcription-websocket",
            headers={"host": host},
            params={
                "language-code": code,
                "media-encoding": "pcm",
                "sample-rate": str(sample_rate),
                "show-speaker-label": "true",
                "enable-partial-results-stabilization": "true",
                "partial-results-stability": "medium",
            },
        )
        # Let botocore encode both the URL and canonical query consistently.
        # Re-encoding token padding only in the canonical query breaks STS IAM
        # credentials while appearing to work with tokenless access keys.
        SigV4QueryAuth(credentials, "transcribe", region, expires=300).add_auth(request)
        return request.url.replace("https://", "wss://", 1)
    except Exception:  # noqa: BLE001 - sanitize external SDK, protocol and network failures
        # Exceptions from credential providers may contain credential URLs.
        raise ProviderError("Transcription is not configured.") from None


def _event(payload: bytes, headers: dict[str, str]) -> bytes:
    encoded = b""
    for name, value in headers.items():
        key, val = name.encode(), value.encode()
        encoded += bytes([len(key)]) + key + b"\x07" + struct.pack(">H", len(val)) + val
    prelude = struct.pack(">II", 16 + len(encoded) + len(payload), len(encoded))
    message = prelude + struct.pack(">I", zlib.crc32(prelude)) + encoded + payload
    return message + struct.pack(">I", zlib.crc32(message))


def audio_event(pcm: bytes) -> bytes:
    return _event(
        pcm,
        {
            ":content-type": "application/octet-stream",
            ":event-type": "AudioEvent",
            ":message-type": "event",
        },
    )


def _time(value, duration: float) -> float:
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("Invalid timestamp")
    return max(0.0, min(duration, number))


def normalize_result(result: dict, duration: float) -> dict:
    """Preserve anonymous speakers and stream-relative word times for replay trim.

    Words come from AWS items only; transcript-only fallbacks omit ``words``.
    The caller maps these times to recording-absolute time alongside segments.
    """
    start = _time(result.get("StartTime", 0), duration)
    end = max(start, _time(result.get("EndTime", start), duration))
    alternatives = result.get("Alternatives") or []
    alternative = alternatives[0] if alternatives else {}
    text = str(alternative.get("Transcript", "")).strip()
    segments = []
    for item in alternative.get("Items", []):
        content = str(item.get("Content", ""))
        if not content:
            continue
        if item.get("Type") == "punctuation":
            if segments:
                segments[-1]["text"] += content
                segments[-1]["words"][-1]["text"] += content
            continue
        item_start = _time(item.get("StartTime", start), duration)
        item_end = max(item_start, _time(item.get("EndTime", end), duration))
        speaker = item.get("Speaker")
        # Absence of an AWS label stays unknown. Labels are not names.
        speaker = str(speaker) if speaker is not None else None
        word = {"start": item_start, "end": item_end, "text": content}
        if segments and segments[-1]["speaker"] == speaker:
            segments[-1]["text"] += " " + content
            segments[-1]["end"] = max(segments[-1]["end"], item_end)
            segments[-1]["words"].append(word)
        else:
            segments.append(
                {
                    "start": item_start,
                    "end": item_end,
                    "text": content,
                    "speaker": speaker,
                    "words": [word],
                }
            )
    if not segments and text:
        segments = [{"start": start, "end": end, "text": text, "speaker": None}]
    # AWS can emit zero-duration or overlapping pronunciation items (notably
    # formatted numbers). Preserve their wording in a neighboring timed token,
    # using only the union of supplied times, so repository replay validation
    # does not reject an otherwise valid result.
    for segment in segments:
        if "words" not in segment:
            continue
        tokens = []
        for word in segment["words"]:
            if tokens and (
                word["start"] < tokens[-1]["end"]
                or word["start"] == word["end"]
                or tokens[-1]["start"] == tokens[-1]["end"]
            ):
                previous = tokens[-1]
                previous["start"] = min(previous["start"], word["start"])
                previous["end"] = max(previous["end"], word["end"])
                previous["text"] += " " + word["text"]
            else:
                tokens.append(dict(word))
        segment["words"] = tokens
        segment["start"] = min(word["start"] for word in tokens)
        segment["end"] = max(word["end"] for word in tokens)
    if not text:
        segments = []
    elif any(segment["start"] >= segment["end"] for segment in segments):
        # No word timing can locate a wholly empty speaker span. Retain the
        # authoritative transcript at the real result bounds, without guessing
        # a speaker for mixed voices or manufacturing a positive duration.
        speakers = {segment["speaker"] for segment in segments}
        segments = (
            [
                {
                    "start": start,
                    "end": end,
                    "text": text,
                    "speaker": next(iter(speakers)) if len(speakers) == 1 else None,
                    "words": [{"start": start, "end": end, "text": text}],
                }
            ]
            if end > start
            else []
        )
    return {
        "id": str(result["ResultId"]),
        "start": start,
        "end": end,
        "partial": bool(result.get("IsPartial", False)),
        "text": text,
        "segments": segments,
    }


class TranscribeStream:
    """One ordered mono s16le PCM stream; one sender and one event consumer.

    send_audio accepts arbitrary even-sized buffers and sends at most 100 ms per
    event, paced at audio speed. Times refer to submitted PCM, excluding padding.
    end_audio (alias end_input) sends the empty event and starts a 30s drain limit.
    Normal close without outstanding partials completes events(); interruptions,
    bad CRCs, malformed/truncated events and AWS errors raise ProviderError.
    """

    def __init__(self, language: str, sample_rate: int = 24000):
        if sample_rate not in (16000, 24000):
            raise ValueError("Expected 16 or 24 kHz mono PCM.")
        self.language = language
        self.sample_rate = sample_rate
        self.socket = None
        self._lock = asyncio.Lock()
        self._ended = asyncio.Event()
        self._consuming = False
        self._used = False
        self._bytes = 0
        self._pending_audio = bytearray()
        self._next_send = 0.0
        self._drain_deadline = None

    async def __aenter__(self):
        if self._used:
            raise ProviderError("Transcription stream cannot be reused.")
        self._used = True
        try:
            url = await asyncio.to_thread(
                _presigned_url, self.language, self.sample_rate
            )
            self.socket = await connect(
                url, open_timeout=10, close_timeout=5, max_size=4 * 1024 * 1024
            )
        except Exception:  # noqa: BLE001 - sanitize external SDK, protocol and network failures
            raise ProviderError("Transcription session unavailable.") from None
        return self

    async def __aexit__(self, *_):
        if self.socket is not None:
            with contextlib.suppress(Exception):
                await self.socket.close()
            self.socket = None

    async def send_audio(self, pcm: bytes):
        if len(pcm) % 2:
            raise ValueError("PCM must contain complete 16-bit samples.")
        async with self._lock:
            if self.socket is None or self._ended.is_set():
                raise ProviderError("Transcription stream is not open.")
            size = self.sample_rate // 10 * 2
            try:
                self._pending_audio.extend(pcm)
                while len(self._pending_audio) >= size:
                    chunk = bytes(self._pending_audio[:size])
                    del self._pending_audio[:size]
                    await self._send_chunk(chunk)
            except Exception:  # noqa: BLE001 - sanitize external SDK, protocol and network failures
                raise ProviderError("Transcription was interrupted.") from None

    async def _send_chunk(self, chunk):
        loop = asyncio.get_running_loop()
        if not self._next_send:
            self._next_send = loop.time()
        await asyncio.sleep(max(0, self._next_send - loop.time()))
        # Advance before send: a response can arrive while send yields.
        self._bytes += len(chunk)
        await self.socket.send(audio_event(chunk))
        # Keep an audio clock so scheduler/network overhead doesn't accumulate
        # across a 30-minute upload. After a stall, don't burst a backlog.
        self._next_send = max(
            self._next_send + len(chunk) / (self.sample_rate * 2), loop.time()
        )

    async def end_audio(self):
        async with self._lock:
            if self._ended.is_set():
                return
            if self.socket is None:
                raise ProviderError("Transcription stream is not open.")
            try:
                if self._pending_audio:
                    await self._send_chunk(bytes(self._pending_audio))
                    self._pending_audio.clear()
                await asyncio.sleep(
                    max(0, self._next_send - asyncio.get_running_loop().time())
                )
                self._drain_deadline = asyncio.get_running_loop().time() + 30
                self._ended.set()
                await self.socket.send(audio_event(b""))
            except Exception:  # noqa: BLE001 - sanitize external SDK, protocol and network failures
                raise ProviderError("Transcription was interrupted.") from None

    async def end_input(self):
        await self.end_audio()

    async def events(self):
        if self._consuming or self.socket is None:
            raise ProviderError("Transcription events require one open consumer.")
        self._consuming = True
        buffer = EventStreamBuffer()
        pending_bytes = 0
        pending_results = set()
        finalized = set()
        try:
            # A deadline can be installed while recv is already waiting.
            async with asyncio.timeout(None) as deadline:

                async def watch_end():
                    await self._ended.wait()
                    deadline.reschedule(self._drain_deadline)

                watcher = asyncio.create_task(watch_end())
                try:
                    async for raw in self.socket:
                        if not isinstance(raw, bytes):
                            raise TypeError("Expected binary AWS event")
                        pending_bytes += len(raw)
                        if pending_bytes > 4 * 1024 * 1024:
                            raise ValueError("AWS event exceeds limit")
                        buffer.add_data(raw)
                        for message in buffer:
                            pending_bytes -= message.prelude.total_length
                            if message.headers.get(":message-type") in (
                                "exception",
                                "error",
                            ):
                                raise ProviderError(
                                    "Transcription service is unavailable."
                                )
                            if message.headers.get(":event-type") != "TranscriptEvent":
                                continue
                            payload = json.loads(message.payload)
                            for result in payload["Transcript"]["Results"]:
                                event = normalize_result(
                                    result, self._bytes / (self.sample_rate * 2)
                                )
                                identifier = event["id"]
                                if identifier in finalized:
                                    continue
                                if event["partial"]:
                                    pending_results.add(identifier)
                                else:
                                    pending_results.discard(identifier)
                                    finalized.add(identifier)
                                yield event
                    if not self._ended.is_set() or pending_bytes or pending_results:
                        raise ProviderError("Transcription ended before completion.")
                finally:
                    watcher.cancel()
                    await asyncio.gather(watcher, return_exceptions=True)
        except Exception:  # noqa: BLE001 - sanitize external SDK, protocol and network failures
            raise ProviderError("Transcription was interrupted.") from None


async def recognize(pcm: bytes, sample_rate: int, language: str, partial=None):
    """Finite-buffer helper returning (text, native segments); no persistent IDs.

    Realtime microphone ingestion should use TranscribeStream directly to retain
    recognition context and avoid per-turn streaming minimum charges.
    """
    if len(pcm) % 2:
        raise ValueError("PCM must contain complete 16-bit samples.")
    if not any(pcm):
        return "", []
    duration = len(pcm) / (sample_rate * 2)
    audio = pcm.ljust(sample_rate // 10 * 2, b"\0")
    results = {}
    async with asyncio.timeout(duration + 45):
        async with TranscribeStream(language, sample_rate) as stream:

            async def send():
                await stream.send_audio(audio)
                await stream.end_audio()

            sender = asyncio.create_task(send())

            # Observe send failures promptly rather than waiting for remote close.
            async def receive():
                async for event in stream.events():
                    results[event["id"]] = event
                    if partial is not None and event["partial"]:
                        await partial(
                            " ".join(
                                r["text"]
                                for r in sorted(
                                    results.values(),
                                    key=lambda r: (r["start"], r["end"]),
                                )
                                if r["text"]
                            )
                        )

            receiver = asyncio.create_task(receive())
            try:
                await asyncio.gather(sender, receiver)
            finally:
                sender.cancel()
                receiver.cancel()
                await asyncio.gather(sender, receiver, return_exceptions=True)
    final = sorted(
        (r for r in results.values() if not r["partial"]),
        key=lambda r: (r["start"], r["end"]),
    )
    segments = []
    for result in final:
        for segment in result["segments"]:
            segment = dict(segment)
            segment["start"] = min(duration, segment["start"])
            segment["end"] = min(duration, segment["end"])
            if "words" in segment:
                segment["words"] = [
                    {
                        **word,
                        "start": min(duration, word["start"]),
                        "end": min(duration, word["end"]),
                    }
                    for word in segment["words"]
                ]
            segments.append(segment)
    return " ".join(r["text"] for r in final if r["text"]), segments
