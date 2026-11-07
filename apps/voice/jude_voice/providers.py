"""Speech recognition and local diarization for a single authorized recording."""

import asyncio
import base64
import json
import os
import struct
import subprocess
import tempfile
from pathlib import Path

import httpx
from websockets.asyncio.client import connect

from .diarization import diarization_available, diarize

MAX_SECONDS = 1800
SAMPLE_RATE = 16000
_JOBS = asyncio.Semaphore(2)
COMMITTED_TURN_MODEL = "gpt-transcribe"
LIVE_TRANSCRIPTION_MODEL = "gpt-live-transcribe"


class ProviderError(Exception):
    pass


def wav_header(byte_length: int, rate: int = 24000) -> bytes:
    if byte_length + 36 > 0xFFFFFFFF:
        return struct.pack(
            "<4sI4s4sIQQQI",
            b"RF64",
            0xFFFFFFFF,
            b"WAVE",
            b"ds64",
            28,
            byte_length + 72,
            byte_length,
            byte_length // 2,
            0,
        ) + struct.pack("<4sIHHIIHH4sI", b"fmt ", 16, 1, 1, rate, rate * 2, 2, 16, b"data", 0xFFFFFFFF)
    return struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        byte_length + 36,
        b"WAVE",
        b"fmt ",
        16,
        1,
        1,
        rate,
        rate * 2,
        2,
        16,
        b"data",
        byte_length,
    )


def normalize_audio(data: bytes, suffix: str) -> bytes:
    """Decode locally, applying duration bounds before any provider request."""
    with tempfile.TemporaryDirectory(prefix="jude-audio-") as folder:
        source = Path(folder) / ("source" + suffix)
        pcm = Path(folder) / "audio.pcm"
        source.write_bytes(data)
        try:
            subprocess.run(
                [
                    os.getenv("JUDE_FFMPEG", "ffmpeg"),
                    "-nostdin",
                    "-v",
                    "error",
                    "-protocol_whitelist",
                    "file,pipe",
                    "-format_whitelist",
                    "wav,mp3,matroska,webm,mov,mp4,m4a,3gp,3g2,mj2,mpeg,ogg,flac",
                    "-i",
                    str(source),
                    "-map",
                    "0:a:0",
                    "-t",
                    str(MAX_SECONDS + 1),
                    "-ac",
                    "1",
                    "-ar",
                    str(SAMPLE_RATE),
                    "-f",
                    "s16le",
                    str(pcm),
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=True,
                timeout=120,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            raise ValueError("The audio could not be decoded.") from exc
        length = pcm.stat().st_size
        if length < 2 or length > MAX_SECONDS * SAMPLE_RATE * 2:
            raise ValueError("The recording must contain up to 30 minutes of audio.")
        return pcm.read_bytes()


def windows(turns, duration: float):
    """Keep each anonymous voice separate and cap the size of each API request."""
    ranges = [(max(0.0, t.start), min(duration, t.end), t.speaker) for t in turns]
    merged = []
    for start, end, speaker in sorted(ranges):
        if end <= start:
            continue
        if (
            merged
            and merged[-1][2] == speaker
            and 0 <= start - merged[-1][1] < 0.35
            and end - merged[-1][0] < 90
        ):
            merged[-1] = (merged[-1][0], end, speaker)
        else:
            merged.append((start, end, speaker))
    for start, end, speaker in merged:
        while start < end:
            stop = min(end, start + 90)
            yield start, stop, speaker
            start = stop


def openai_headers():
    key = os.getenv("OPENAI_API_KEY")
    if not key:
        raise ProviderError("Transcription is not configured.")
    result = {"Authorization": "Bearer " + key}
    if project := os.getenv("OPENAI_PROJECT_ID"):
        result["OpenAI-Project"] = project
    return result


def realtime_transcription_model(requested: str | None = None) -> str:
    if requested == COMMITTED_TURN_MODEL or os.getenv("CHATGPT_TRANSCRIBE", "").strip().lower() == "true":
        return COMMITTED_TURN_MODEL
    return os.getenv("OPENAI_REALTIME_TRANSCRIPTION_MODEL") or LIVE_TRANSCRIPTION_MODEL


async def transcribe_file(data: bytes, suffix: str, language: str):
    headers = openai_headers()
    if not diarization_available():
        raise ProviderError("Provision the pyannote model to process hearing audio.")
    model = os.getenv("OPENAI_TRANSCRIPTION_MODEL") or COMMITTED_TURN_MODEL
    language_field = "languages[]" if model == COMMITTED_TURN_MODEL else "language"
    async with _JOBS:
        pcm = await asyncio.to_thread(normalize_audio, data, suffix)
        duration = len(pcm) / (SAMPLE_RATE * 2)
        turns = await asyncio.to_thread(diarize, wav_header(len(pcm), SAMPLE_RATE) + pcm, ".wav")
        result = []
        async with httpx.AsyncClient(timeout=httpx.Timeout(90, connect=10)) as client:
            for start, stop, speaker in windows(turns, duration):
                chunk = pcm[int(start * SAMPLE_RATE) * 2 : int(stop * SAMPLE_RATE) * 2]
                response = await client.post(
                    "https://api.openai.com/v1/audio/transcriptions",
                    headers=headers,
                    data={
                        "model": model,
                        language_field: language,
                        "response_format": "json",
                    },
                    files={
                        "file": ("turn.wav", wav_header(len(chunk), SAMPLE_RATE) + chunk, "audio/wav")
                    },
                )
                if not response.is_success:
                    raise ProviderError("Transcription service is unavailable.")
                text = response.json().get("text")
                if isinstance(text, str) and text.strip():
                    result.append(
                        {"start": start, "end": stop, "text": text.strip(), "speaker": speaker}
                    )
        if not result:
            raise ValueError("No intelligible speech was found.")
        return result, duration


class Realtime:
    """A provider connection belongs to one authorized microphone session."""

    def __init__(self, language: str, model: str | None = None):
        self.language = language
        self.model = model or realtime_transcription_model()
        self.socket = None

    async def __aenter__(self):
        language_hint = (
            {"languages": [self.language]}
            if self.model in (COMMITTED_TURN_MODEL, LIVE_TRANSCRIPTION_MODEL)
            else {"language": self.language}
        )
        audio_input = {
            "format": {"type": "audio/pcm", "rate": 24000},
            "transcription": {"model": self.model, **language_hint},
            "turn_detection": None,
        }
        self.socket = await connect(
            "wss://api.openai.com/v1/realtime?intent=transcription",
            additional_headers=openai_headers(),
            open_timeout=10,
            max_size=4 * 1024 * 1024,
        )
        try:
            async with asyncio.timeout(15):
                await self.send({
                    "type": "session.update",
                    "session": {"type": "transcription", "audio": {"input": audio_input}},
                })
                while True:
                    event = json.loads(await self.socket.recv())
                    if event.get("type") == "session.updated":
                        return self
                    if event.get("type") == "error":
                        raise ProviderError("Transcription session unavailable.")
        except BaseException:
            await self.socket.close()
            raise

    async def __aexit__(self, *_):
        if self.socket:
            await self.socket.close()

    async def send(self, value):
        await self.socket.send(json.dumps(value))

    async def _transcript_events(self):
        """Match early and late transcription events to this buffer's acknowledged item."""
        item_id = None
        early = {}
        while True:
            event = json.loads(await self.socket.recv())
            kind = event.get("type", "")
            if kind == "error":
                raise ProviderError("Transcription was interrupted.")
            if kind == "input_audio_buffer.committed" and item_id is None:
                item_id = event["item_id"]
                for pending in early.pop(item_id, ()):
                    yield pending
                early.clear()
            elif kind.startswith("conversation.item.input_audio_transcription.") and event.get("item_id"):
                if item_id is None:
                    early.setdefault(event["item_id"], []).append(event)
                elif event["item_id"] == item_id:
                    yield event

    async def transcribe(self, pcm: bytes, partial):
        if not any(pcm):
            return ""
        # A worklet can flush less than 100 ms on stop. Pad only the provider's input.
        pcm = pcm.ljust(4_800, b"\0")
        async with asyncio.timeout(45):
            for index in range(0, len(pcm), 48000):
                await self.send(
                    {
                        "type": "input_audio_buffer.append",
                        "audio": base64.b64encode(pcm[index : index + 48000]).decode(),
                    }
                )
            await self.send({"type": "input_audio_buffer.commit"})
            preview = ""
            async for event in self._transcript_events():
                kind = event["type"]
                if kind == "conversation.item.input_audio_transcription.delta":
                    preview += event.get("delta", "")
                    await partial(preview)
                elif kind == "conversation.item.input_audio_transcription.completed":
                    return str(event.get("transcript", "")).strip()
                elif kind == "conversation.item.input_audio_transcription.failed":
                    raise ProviderError("Transcription was interrupted.")
