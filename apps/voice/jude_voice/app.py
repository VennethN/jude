"""Same-origin recording API. Real identities, permissions and sources come from the case store."""

import asyncio
import base64
import binascii
import math
import os
import re
from contextlib import asynccontextmanager, suppress
from datetime import date as date_type
from pathlib import Path

import httpx
from anyio import CancelScope
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import (
    JSONResponse,
    PlainTextResponse,
    RedirectResponse,
    Response,
    StreamingResponse,
)

from .diarization import DiarizationError, diarization_available
from .limits import MAX_UPLOAD, UploadLimit
from .providers import ProviderError, Realtime, transcribe_file, wav_header
from .repository import Repository, VoiceError, statement_id
from .speakers import SpeakerWindow, run_worker

AUDIO_FORMATS = {".mp3", ".wav", ".mp4", ".m4a", ".mpeg", ".mpga", ".webm"}
ID = re.compile(r"^[a-zA-Z0-9_-]{1,90}$")
repo = Repository()


def failure(status, code, message):
    return JSONResponse({"error": {"code": code, "message": message}}, status_code=status)


def allowed_origin(conn):
    origin = conn.headers.get("origin")
    expected = os.getenv("ORIGIN") or ("http://" + conn.headers.get("host", ""))
    return (not origin or origin.rstrip("/") == expected.rstrip("/")) and conn.headers.get(
        "sec-fetch-site"
    ) != "cross-site"


@asynccontextmanager
async def lifespan(_app):
    worker = asyncio.create_task(run_worker(repo))
    try:
        yield
    finally:
        worker.cancel()
        with suppress(asyncio.CancelledError):
            await worker


app = FastAPI(title="Jude Voice", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
app.add_middleware(UploadLimit)


@app.get("/capabilities")
async def capabilities():
    return {"transcription": bool(os.getenv("OPENAI_API_KEY")) and diarization_available()}


@app.middleware("http")
async def protections(request: Request, call_next):
    if request.method != "GET" and not allowed_origin(request):
        return failure(403, "forbidden", "Open this action from Jude.")
    response = await call_next(request)
    response.headers["Cache-Control"] = "private, no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@app.exception_handler(VoiceError)
async def voice_error(_, exc):
    return failure(exc.status, exc.code, exc.message)


@app.exception_handler(httpx.RequestError)
@app.exception_handler(ProviderError)
@app.exception_handler(DiarizationError)
async def provider_error(_, exc):
    return failure(503, "provider_unavailable", "The audio processor is unavailable.")


@app.get("/healthz")
async def health():
    try:
        await asyncio.to_thread(repo.ready)
        return PlainTextResponse("ok", headers={"Cache-Control": "no-store", "X-Jude-Revision": os.getenv("JUDE_REVISION", "development")})
    except Exception:  # noqa: BLE001 - either configured database driver can fail a readiness probe
        return PlainTextResponse("unavailable", status_code=503)


async def user(conn):
    return await asyncio.to_thread(repo.session, conn.cookies.get("jude_session"))


@app.get("/api/live/{case_id}/{hearing_id}/replay")
async def replay_preview(case_id: str, hearing_id: str, request: Request):
    session = await user(request)
    raw = request.query_params.get("cursor", "")
    try:
        if not re.fullmatch(r"[0-9]+", raw):
            raise ValueError()
        cursor = int(raw)
    except ValueError:
        return failure(422, "validation", "A replay cursor is required.")
    return await asyncio.to_thread(repo.replay_preview, session, case_id, hearing_id, cursor)


@app.post("/api/live/{case_id}/{hearing_id}/replay")
async def replay(case_id: str, hearing_id: str, request: Request):
    session = await user(request)
    try:
        body = await request.json()
        cursor = body["cursor"]
        if type(cursor) is not int or cursor < 0:
            raise ValueError()
    except (ValueError, TypeError, KeyError):
        return failure(422, "validation", "A replay cursor is required.")
    return await asyncio.to_thread(repo.replay, session, case_id, hearing_id, cursor)


@app.post("/api/live/{case_id}/upload")
async def upload(case_id: str, request: Request):
    session = await user(request)
    key = request.headers.get("idempotency-key")
    if key:
        previous = await asyncio.to_thread(repo.previous_upload, session, case_id, key)
        if previous is not None:
            return JSONResponse(previous, status_code=201)
    await asyncio.to_thread(repo.check_recording, session, case_id)
    async with request.form(max_files=1, max_fields=8, max_part_size=MAX_UPLOAD) as form:
        file = form.get("file")
        title = str(form.get("title") or "").strip()
        recording_date = str(form.get("date") or "")
        permission = str(form.get("recordingPermission") or "").lower() == "true"
        try:
            date_type.fromisoformat(recording_date)
        except ValueError:
            return failure(422, "validation", "Choose a valid hearing date.")
        if not file or not hasattr(file, "read") or not title or len(title) > 200 or not permission:
            return failure(
                422, "recording_permission", "Provide a title and confirm the recording permission."
            )
        suffix = Path(file.filename or "").suffix.lower()
        if suffix not in AUDIO_FORMATS:
            return failure(422, "validation", "Choose a supported audio file.")
        data = await file.read(MAX_UPLOAD + 1)
        if not data or len(data) > MAX_UPLOAD:
            return failure(413, "file_too_large", "Audio must contain up to 25 MB.")
        language = "en" if form.get("lang") == "en" else "id"
        await asyncio.to_thread(repo.check_recording, session, case_id, size=len(data))
        try:
            segments, duration = await transcribe_file(data, suffix, language)
        except (ValueError, TypeError):
            return failure(
                422, "validation", "The file must have readable speech and fit within 30 minutes."
            )
        result = await asyncio.to_thread(
            repo.add_recording,
            session,
            case_id,
            title=title,
            date=recording_date,
            filename=Path(file.filename or "audio").name,
            mime=file.content_type or "application/octet-stream",
            audio=data,
            segments=segments,
            duration=duration,
            permission=True,
            idempotency_key=key,
            language=language,
        )
        return JSONResponse(result, status_code=201)


def byte_range(raw, total):
    if raw is None:
        return 0, total - 1, 200
    match = re.fullmatch(r"bytes=(\d*)-(\d*)", raw)
    if not match or not any(match.groups()):
        raise ValueError()
    a, b = match.groups()
    start = int(a) if a else max(0, total - int(b))
    end = min(total - 1, int(b)) if a and b else total - 1
    if start < 0 or start > end or start >= total:
        raise ValueError()
    return start, end, 206


def live_audio_pieces(turns):
    # Transcript timestamps include pauses and time before a microphone joins the hearing.
    # Represent gaps as virtual silence so seeking a citation never requires storing empty audio.
    cursor = 0
    pieces = []
    for turn in turns:
        start = round(float(turn["start_seconds"]) * 24000) * 2
        length = int(turn["bytes"])
        if start > cursor:
            pieces.append((None, None, 0, start - cursor))
            cursor = start
        skip = min(length, max(0, cursor - start))
        if skip < length:
            pieces.append((None, turn["object_key"], skip, length - skip))
            cursor += length - skip
    header = wav_header(cursor)
    return [(header, None, 0, len(header)), *pieces]


@app.get("/api/live/{case_id}/{hearing_id}/audio")
async def audio(case_id: str, hearing_id: str, request: Request):
    session = await user(request)
    record = await asyncio.to_thread(repo.audio, session, case_id, hearing_id)
    if "turns" in record:
        pieces = live_audio_pieces(record["turns"])
        mime = "audio/wav"
    else:
        url = await asyncio.to_thread(repo.storage.url, record["object_key"])
        if url:
            return RedirectResponse(url, status_code=307)
        pieces = [(None, record["object_key"], 0, record["byte_length"])]
        mime = record["mime"]

    total = sum(length for _, _, _, length in pieces)
    try:
        start, end, status = byte_range(request.headers.get("range"), total)
    except ValueError:
        return Response(status_code=416, headers={"Content-Range": f"bytes */{total}"})

    async def body():
        offset = 0
        for data, key, skip, length in pieces:
            if offset > end:
                return
            left = max(start - offset, 0)
            right = min(end + 1 - offset, length)
            if left < right:
                if data is None and key is None:
                    remaining = right - left
                    while remaining:
                        size = min(remaining, 64 * 1024)
                        yield bytes(size)
                        remaining -= size
                else:
                    chunk = data if data is not None else await asyncio.to_thread(repo.storage.get, key)
                    yield chunk[skip + left : skip + right]
            offset += length

    headers = {"Accept-Ranges": "bytes", "Content-Length": str(end - start + 1)}
    if status == 206:
        headers["Content-Range"] = f"bytes {start}-{end}/{total}"
    return StreamingResponse(body(), status_code=status, media_type=mime, headers=headers)


def decode_turn(turn):
    if (
        not isinstance(turn, dict)
        or not isinstance(turn.get("id"), str)
        or not ID.fullmatch(turn["id"])
    ):
        raise ValueError()
    t = turn.get("t")
    if (
        type(t) not in (int, float)
        or not math.isfinite(t)
        or not 0 <= t <= 604800
        or type(turn.get("keep")) is not bool
    ):
        raise ValueError()
    raw = turn.get("pcm")
    if not isinstance(raw, str) or len(raw) > 2_000_000:
        raise ValueError()
    pcm = base64.b64decode(raw, validate=True)
    if not pcm or len(pcm) % 2:
        raise ValueError()
    return turn["id"], float(t), pcm, turn["keep"]


@asynccontextmanager
async def recording_lease(session, case_id, hearing_id):
    # A cancelled await cannot roll back a transaction already running in a thread.
    acquisition = asyncio.create_task(asyncio.to_thread(repo.acquire, session, case_id, hearing_id))

    async def release():
        await asyncio.wait({acquisition})
        # The acquisition error reaches the caller at entry. Only a committed holder is released.
        if not acquisition.cancelled() and acquisition.exception() is None:
            await asyncio.to_thread(repo.release, case_id, hearing_id, acquisition.result())

    try:
        yield await asyncio.shield(acquisition)
    finally:
        # AnyIO disconnect scopes repeatedly cancel awaits. Uvicorn can also cancel
        # the asyncio task directly at shutdown. Join the release in either case.
        with CancelScope(shield=True):
            cleanup = asyncio.create_task(release())
            try:
                await asyncio.shield(cleanup)
            except asyncio.CancelledError:
                await cleanup
                raise


@app.websocket("/api/live/{case_id}/{hearing_id}/socket")
async def socket(ws: WebSocket, case_id: str, hearing_id: str):
    if (
        not ws.headers.get("origin")
        or not allowed_origin(ws)
        or not os.getenv("OPENAI_API_KEY")
        or not diarization_available()
    ):
        await ws.close(code=1008)
        return
    try:
        session = await user(ws)
        async with recording_lease(session, case_id, hearing_id) as lease:
            await ws.accept()
            await receive_turns(ws, session, case_id, hearing_id, lease)
    except WebSocketDisconnect:
        pass
    except VoiceError:
        await ws.close(code=1008)


async def receive_turns(ws, session, case_id, hearing_id, lease):
    async def heartbeat():
        try:
            while True:
                await asyncio.sleep(10)
                await asyncio.to_thread(repo.renew, session, case_id, hearing_id, lease)
        except VoiceError:
            with suppress(RuntimeError):
                await ws.close(code=1008)

    task = asyncio.create_task(heartbeat())
    speakers = SpeakerWindow()
    try:
        async with Realtime("en" if ws.query_params.get("lang") == "en" else "id") as recognizer:
            await ws.send_json({"type": "ready"})
            while True:
                turn_id, start, pcm, keep = decode_turn(await ws.receive_json())
                receipt = await asyncio.to_thread(repo.committed_turn, session, case_id, hearing_id, turn_id)
                if receipt is None:
                    caption = {"type": "partial", "id": statement_id(hearing_id, turn_id), "t": start}
                    text = await recognizer.transcribe(
                        pcm, lambda words, frame=caption: ws.send_json({**frame, "text": words})
                    )
                    # Kept recordings get a full hearing pass when the lawyer ends the hearing.
                    # Transcript-only sessions can use brief acoustic context until disconnect.
                    speaker = None
                    if text and not keep:
                        labels = await asyncio.to_thread(speakers.label, [(turn_id, pcm)])
                        speaker = labels.get(turn_id)
                    receipt = await asyncio.to_thread(
                        repo.store_turn,
                        session,
                        case_id,
                        hearing_id,
                        lease=lease,
                        turn_id=turn_id,
                        start=start,
                        pcm=pcm,
                        keep=keep,
                        text=text,
                        speaker=speaker,
                    )
                ack = {"type": "ack", "id": turn_id}
                if receipt["statementId"] is not None:
                    ack["statementId"] = receipt["statementId"]
                await ws.send_json(ack)
    except WebSocketDisconnect:
        pass
    except (ValueError, binascii.Error, KeyError):
        with suppress(RuntimeError):
            await ws.close(code=1003)
    except Exception:  # noqa: BLE001 - close the stream without exposing model or database errors
        with suppress(RuntimeError, WebSocketDisconnect):
            await ws.send_json({"type": "error", "code": "transcription_interrupted"})
            await ws.close(code=1011)
    finally:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
