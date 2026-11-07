"""Amazon speech recognition for a single authorized recording."""

import asyncio
import os
import struct
import subprocess
import tempfile
from pathlib import Path

from .transcribe import (
    ProviderError,
    TranscribeStream,
    recognize,
    transcription_available,
)

__all__ = [
    "ProviderError",
    "Realtime",
    "TranscribeStream",
    "normalize_audio",
    "transcribe_file",
    "transcription_available",
    "wav_header",
    "windows",
]

MAX_SECONDS = 1800
SAMPLE_RATE = 16000
_JOBS = asyncio.Semaphore(2)


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


async def transcribe_file(data: bytes, suffix: str, language: str):
    """Return (native segments, duration) from one recording-wide AWS stream.

    Speaker labels are anonymous and scoped to this upload. No pyannote model
    is required; the legacy windows and WAV helpers remain available to callers.
    """
    if not await asyncio.to_thread(transcription_available):
        raise ProviderError("Transcription is not configured.")
    async with _JOBS:
        pcm = await asyncio.to_thread(normalize_audio, data, suffix)
        duration = len(pcm) / (SAMPLE_RATE * 2)
        _, result = await recognize(pcm, SAMPLE_RATE, language)
        if not result:
            raise ValueError("No intelligible speech was found.")
        return result, duration


class Realtime:
    """Turn recognizer; each turn owns an AWS stream, never a speaker identity.

    ``segments`` is replaced after each successful call, with timestamps relative
    to the original 24 kHz PCM and anonymous, stream-local AWS speaker labels.
    The caller must reconcile voices acoustically across turns.
    """

    def __init__(self, language: str):
        self.language = language
        self.segments = []
        self._lock = asyncio.Lock()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        pass

    async def transcribe(self, pcm: bytes, partial) -> str:
        async with self._lock:
            self.segments = []
            text, segments = await recognize(pcm, 24000, self.language, partial)
            self.segments = segments
            return text
