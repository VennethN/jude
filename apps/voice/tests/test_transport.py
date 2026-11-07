"""Verify the public transport and speaker worker without sending any test audio off-host."""

import asyncio
import base64
import os
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, call, patch

from anyio import CancelScope, sleep_forever
from fastapi.testclient import TestClient
from jude_voice import app as transport
from jude_voice.diarization import SpeakerTurn
from jude_voice.providers import wav_header, windows
from jude_voice.speakers import BYTES_PER_SECOND, SpeakerWindow, process_recording


class VoiceTransportTest(unittest.TestCase):
    def setUp(self):
        self.repo = MagicMock()
        self.repo.capture_resume_offset.return_value = 0
        self.enterContext(patch.object(transport, "repo", self.repo))
        self.enterContext(patch.object(transport, "transcription_available", return_value=True))
        self.enterContext(
            patch.dict(os.environ, {"ORIGIN": "http://testserver"})
        )
        self.client = TestClient(transport.app)
        self.addCleanup(self.client.close)

    def test_public_voice_gateway_reports_the_same_readiness_as_the_private_service(self):
        for ready in (True, False):
            with self.subTest(ready=ready), patch.object(transport, "transcription_available", return_value=ready):
                private = self.client.get("/capabilities")
                public = self.client.get("/api/live/capabilities")
                self.assertEqual(public.status_code, 200)
                self.assertEqual(public.json(), {"transcription": ready})
                self.assertEqual(public.json(), private.json())
                self.assertEqual(public.headers["cache-control"], "private, no-store")

    def test_upload_consent_idempotency_and_language(self):
        self.repo.previous_upload.return_value = None
        self.repo.add_recording.return_value = {"id": "recorded"}
        fields = {"title": "Test hearing", "date": "2026-11-07", "lang": "en"}
        files = {"file": ("hearing.wav", b"audio fixture", "audio/wav")}
        with patch.object(transport, "transcribe_file", new_callable=AsyncMock) as transcribe:
            transcribe.return_value = ([{"start": 0, "end": 1, "text": "One", "speaker": "A"}], 1)
            denied = self.client.post("/api/live/c/upload", data=fields, files=files)
            self.assertEqual(denied.status_code, 422)
            transcribe.assert_not_called()
            fields["recordingPermission"] = "true"
            result = self.client.post(
                "/api/live/c/upload", data=fields, files=files, headers={"Idempotency-Key": "one"}
            )
            self.assertEqual(result.status_code, 201)
            self.assertEqual(self.repo.add_recording.call_args.kwargs["language"], "en")
            self.repo.previous_upload.return_value = result.json()
            retry = self.client.post(
                "/api/live/c/upload", data=fields, files=files, headers={"Idempotency-Key": "one"}
            )
            self.assertEqual(retry.json(), result.json())
            transcribe.assert_awaited_once()
            self.repo.add_recording.assert_called_once()

    def test_origin_bounds_and_audio_ranges(self):
        rejected = self.client.post(
            "/api/live/c/h/replay", json={"cursor": 0}, headers={"Origin": "https://external.test"}
        )
        self.assertEqual(rejected.status_code, 403)
        large = self.client.post(
            "/api/live/c/upload", headers={"Content-Length": str(30 * 1024 * 1024)}
        )
        self.assertEqual(large.status_code, 413)
        self.repo.audio.return_value = {
            "turns": [
                {"bytes": 4, "object_key": "a", "start_seconds": 0},
                {"bytes": 4, "object_key": "b", "start_seconds": 2 / 24000},
            ]
        }
        self.repo.storage.get.side_effect = {"a": b"abcd", "b": b"efgh"}.__getitem__
        data = self.client.get("/api/live/c/h/audio", headers={"Range": "bytes=46-49"})
        self.assertEqual((data.status_code, data.content), (206, b"cdef"))
        self.assertEqual(data.headers["content-range"], "bytes 46-49/52")
        self.assertEqual(
            self.client.get("/api/live/c/h/audio", headers={"Range": "bytes=59-"}).status_code, 416
        )
        self.assertEqual(
            self.client.get("/api/live/c/h/audio", headers={"Range": "bytes=-2"}).content, b"gh"
        )
        self.repo.audio.return_value["turns"][1]["start_seconds"] = 1
        gap = self.client.get("/api/live/c/h/audio", headers={"Range": "bytes=48042-48045"})
        self.assertEqual(gap.content, b"\0\0ef")

    def test_replay_preview_requires_a_session_and_a_nonnegative_cursor(self):
        route = "/api/live/demo/h4/replay"
        self.repo.session.side_effect = transport.VoiceError(401, "unauthenticated", "Sign in.")
        self.assertEqual(self.client.get(route, params={"cursor": 0}).status_code, 401)
        self.repo.session.side_effect = None
        self.client.cookies.set("jude_session", "test-cookie")
        for raw in (None, "-1", "true", "1.2", ""):
            with self.subTest(raw=raw):
                bad = self.client.get(route, params={} if raw is None else {"cursor": raw})
                self.assertEqual((bad.status_code, bad.json()["error"]["code"]), (422, "validation"))
        self.repo.replay_preview.assert_not_called()
        response = {"cursor": 9, "done": True}
        self.repo.replay_preview.return_value = response
        result = self.client.get(route, params={"cursor": 7})
        self.assertEqual((result.status_code, result.json()), (200, response))
        self.repo.session.assert_called_with("test-cookie")
        self.repo.replay_preview.assert_called_once_with(self.repo.session.return_value, "demo", "h4", 7)
        self.repo.replay.assert_not_called()
        self.assertEqual(result.headers["cache-control"], "private, no-store")

    def test_continuous_stream_accepts_captures_before_final_result_and_drains(self):
        self.repo.begin_capture.return_value = None
        self.repo.save_stream_result.return_value = {"id": "r1", "statementId": "s1", "segments": []}
        self.repo.complete_capture.side_effect = lambda *a, turn_id, **kw: {"id": turn_id, "statementId": None}

        class Stream:
            def __init__(self, language):
                self.queue = asyncio.Queue()
                self.audio = []
            async def __aenter__(self):
                return self
            async def __aexit__(self, *args):
                pass
            async def send_audio(self, pcm):
                self.audio.append(pcm)
                if len(self.audio) == 2:
                    await self.queue.put({"id": "r1", "partial": False, "start": 0, "end": 2,
                        "text": "Question. Answer.", "segments": [
                            {"start": 0.1, "end": 0.9, "text": "Question.", "speaker": "0"},
                            {"start": 1.1, "end": 1.9, "text": "Answer.", "speaker": "1"}]})
            async def end_audio(self):
                await self.queue.put(None)
            async def events(self):
                while True:
                    event = await self.queue.get()
                    if event is None:
                        return
                    yield event

        with (
            patch.object(transport, "TranscribeStream", Stream),
            self.client.websocket_connect("/api/live/c/h/socket", headers={"Origin": "http://testserver"}) as client,
        ):
            self.assertEqual(client.receive_json()["protocol"], 2)
            pcm = base64.b64encode(b"\x01\x00" * 24000).decode()
            client.send_json({"id": "one", "t": 10, "keep": False, "pcm": pcm})
            self.assertEqual(client.receive_json(), {"type": "accepted", "id": "one"})
            self.repo.complete_capture.assert_not_called()
            client.send_json({"id": "two", "t": 11, "keep": False, "pcm": pcm})
            messages = [client.receive_json() for _ in range(4)]
            self.assertEqual(sorted(m["type"] for m in messages), ["accepted", "ack", "ack", "transcript"])
            client.send_json({"type": "stop"})
            self.assertEqual(client.receive_json(), {"type": "stopped"})
        kwargs = self.repo.save_stream_result.call_args.kwargs
        self.assertEqual([s["start"] for s in kwargs["segments"]], [10.1, 11.1])
        self.assertEqual([s["speaker"] for s in kwargs["segments"]], ["0", "1"])
        self.assertEqual(len(kwargs["epoch"]), 32)
        self.assertEqual(self.repo.begin_capture.call_count, 2)
        self.assertEqual(self.repo.complete_capture.call_count, 2)

    def test_committed_capture_replay_is_not_sent_to_provider(self):
        self.repo.begin_capture.return_value = {"id": "one", "statementId": None}
        stream = MagicMock()
        stream.send_audio = AsyncMock()

        class Stream:
            def __init__(self, language):
                self.done = asyncio.Event()
            async def __aenter__(self): return self
            async def __aexit__(self, *args): pass
            send_audio = stream.send_audio
            async def end_audio(self): self.done.set()
            async def events(self):
                await self.done.wait()
                if False: yield {}

        with (
            patch.object(transport, "TranscribeStream", Stream),
            self.client.websocket_connect("/api/live/c/h/socket", headers={"Origin": "http://testserver"}) as client,
        ):
            client.receive_json()
            client.send_json({"id": "one", "t": 0, "keep": False, "pcm": "AAA="})
            self.assertEqual(client.receive_json(), {"type": "ack", "id": "one", "statementId": None})
            client.send_json({"type": "stop"})
            self.assertEqual(client.receive_json(), {"type": "stopped"})
        stream.send_audio.assert_not_awaited()
        self.repo.save_stream_result.assert_not_called()


class ContinuousFailureTest(unittest.IsolatedAsyncioTestCase):
    async def test_reconnect_sends_only_unresolved_pcm_suffix_and_maps_absolute_time(self):
        from jude_voice.ingest import stream_turns
        pcm = b"\x01\x00" * 24000
        for offset in (0.5, 1.0):
            with self.subTest(offset=offset):
                frames = asyncio.Queue()
                await frames.put({"id": "capture", "t": 10, "keep": False,
                                  "pcm": base64.b64encode(pcm).decode()})
                await frames.put({"type": "stop"})
                ws = MagicMock(query_params={})
                ws.send_json = AsyncMock()
                ws.receive_json = frames.get
                repo = MagicMock()
                repo.begin_capture.return_value = None
                repo.capture_resume_offset.return_value = offset
                repo.save_stream_result.return_value = {"id": "final", "statementId": "saved"}
                repo.complete_capture.return_value = {"id": "capture", "statementId": None}
                submitted = []

                class Stream:
                    def __init__(self, language): self.done = asyncio.Event()
                    async def __aenter__(self): return self
                    async def __aexit__(self, *args): pass
                    async def send_audio(self, data, sent=submitted): sent.append(data)
                    async def end_audio(self): self.done.set()
                    async def events(self, sent=submitted):
                        await self.done.wait()
                        if sent:
                            yield {"id": "final", "partial": False, "start": 0, "end": 0.5,
                                   "text": "Synthetic tail", "segments": [{"start": 0, "end": 0.5,
                                   "text": "Synthetic tail", "speaker": "0", "words": [
                                   {"start": 0, "end": 0.5, "text": "Synthetic tail"}]}]}

                await stream_turns(ws, repo, object(), "c", "h", "lease", transport.decode_turn, Stream)
                self.assertEqual(repo.begin_capture.call_args.kwargs["pcm"], pcm)
                if offset == 0.5:
                    self.assertEqual(submitted, [pcm[24000:]])
                    segment = repo.save_stream_result.call_args.kwargs["segments"][0]
                    self.assertEqual((segment["start"], segment["end"]), (10.5, 11))
                    self.assertEqual(segment["words"][0]["start"], 10.5)
                else:
                    self.assertEqual(submitted, [])
                    repo.save_stream_result.assert_not_called()
                repo.complete_capture.assert_called_once()

    async def test_provider_failure_never_completes_accepted_capture(self):
        from jude_voice.ingest import stream_turns
        from jude_voice.providers import ProviderError
        ws = MagicMock(query_params={})
        ws.send_json = AsyncMock()
        frames = asyncio.Queue()
        await frames.put({"id": "one", "t": 0, "keep": False, "pcm": "AAA="})
        ws.receive_json = frames.get
        repo = MagicMock()
        repo.capture_resume_offset.return_value = 0
        repo.begin_capture.return_value = None

        class Broken:
            def __init__(self, language): self.sent = asyncio.Event()
            async def __aenter__(self): return self
            async def __aexit__(self, *args): pass
            async def send_audio(self, pcm): self.sent.set()
            async def events(self):
                await self.sent.wait()
                raise ProviderError("Synthetic interruption")
                yield

        with self.assertRaises(ProviderError):
            await stream_turns(ws, repo, object(), "c", "h", "lease", transport.decode_turn, Broken)
        repo.complete_capture.assert_not_called()
        repo.save_stream_result.assert_not_called()
        self.assertIn(call({"type": "accepted", "id": "one"}), ws.send_json.call_args_list)

    async def test_silent_capture_completes_only_after_clean_provider_drain(self):
        from jude_voice.ingest import stream_turns
        frames = asyncio.Queue()
        await frames.put({"id": "silence", "t": 0, "keep": False, "pcm": "AAA="})
        await frames.put({"type": "stop"})
        ws = MagicMock(query_params={})
        ws.send_json = AsyncMock()
        ws.receive_json = frames.get
        repo = MagicMock()
        repo.capture_resume_offset.return_value = 0
        repo.begin_capture.return_value = None
        repo.complete_capture.return_value = {"id": "silence", "statementId": None}

        class Silent:
            def __init__(self, language): self.ended = asyncio.Event()
            async def __aenter__(self): return self
            async def __aexit__(self, *args): pass
            async def send_audio(self, pcm): repo.complete_capture.assert_not_called()
            async def end_audio(self): self.ended.set()
            async def events(self):
                await self.ended.wait()
                if False: yield

        await stream_turns(ws, repo, object(), "c", "h", "lease", transport.decode_turn, Silent)
        self.assertEqual([c.args[0]["type"] for c in ws.send_json.call_args_list],
                         ["ready", "accepted", "ack", "stopped"])
        repo.save_stream_result.assert_not_called()


class LeaseCancellationTest(unittest.IsolatedAsyncioTestCase):
    async def test_disconnect_during_handshake_releases_the_acquired_holder(self):
        ws = MagicMock()
        ws.headers = {"host": "testserver", "origin": "http://testserver"}
        ws.cookies = {}
        repo = MagicMock()
        repo.capture_resume_offset.return_value = 0
        repo.acquire.return_value = "holder"

        async def disconnect():
            scope.cancel()
            await sleep_forever()

        ws.accept = AsyncMock(side_effect=disconnect)
        with (
            patch.object(transport, "repo", repo),
            patch.object(transport, "transcription_available", return_value=True),
            patch.dict(os.environ, {"ORIGIN": "http://testserver"}),
            CancelScope() as scope,
        ):
            await transport.socket(ws, "case", "hearing")

        repo.release.assert_called_once_with("case", "hearing", "holder")

    async def test_cancelled_handshake_joins_an_inflight_database_acquisition(self):
        loop = asyncio.get_running_loop()
        started = asyncio.Event()
        finish = threading.Event()
        repo = MagicMock()
        repo.capture_resume_offset.return_value = 0

        def acquire(*_):
            loop.call_soon_threadsafe(started.set)
            if not finish.wait(5):
                raise TimeoutError("The test did not release the database transaction")
            return "committed-holder"

        async def connect():
            async with transport.recording_lease(None, "case", "hearing"):
                self.fail("The cancelled connection must not start recording")

        repo.acquire.side_effect = acquire
        with patch.object(transport, "repo", repo):
            task = asyncio.create_task(connect())
            try:
                await asyncio.wait_for(started.wait(), 5)
                task.cancel()
            finally:
                finish.set()
            with self.assertRaises(asyncio.CancelledError):
                await asyncio.wait_for(task, 5)
        repo.release.assert_called_once_with("case", "hearing", "committed-holder")


class SpeakersTest(unittest.TestCase):
    def test_anonymous_labels_are_matched_through_an_anchor(self):
        pcm = b"\x01" * BYTES_PER_SECOND
        window = SpeakerWindow()
        with patch(
            "jude_voice.speakers.diarize",
            side_effect=[
                [SpeakerTurn(0, 1, "first-run-0")],
                [
                    SpeakerTurn(0, 1, "new-run-8"),
                    SpeakerTurn(1, 2, "new-run-8"),
                    SpeakerTurn(2, 3, "new-run-5"),
                ],
            ],
        ):
            first = window.label([("one", pcm)])
            second = window.label([("two", pcm), ("three", pcm)])
        self.assertEqual(first["one"], second["two"])
        self.assertNotEqual(second["two"], second["three"])
        self.assertNotIn("first-run-0", first.values())

    def test_retained_recording_maps_audio_offsets_to_the_original_turns(self):
        repo = MagicMock()
        repo.capture_resume_offset.return_value = 0
        job = SimpleNamespace(hearing_id="h")
        repo.diarization_inputs.return_value = {
            "turns": [
                {"id": "one", "statement_id": "mic-h-one", "object_key": "k1"},
                {"id": "two", "statement_id": "mic-h-two", "object_key": "k2"},
            ],
            "statements": [{"id": "mic-h-one"}, {"id": "mic-h-two"}],
        }
        repo.storage.get.return_value = b"\x00" * BYTES_PER_SECOND
        with patch(
            "jude_voice.speakers.diarize", return_value=[SpeakerTurn(0, 1, "A"), SpeakerTurn(1, 2, "B")]
        ):
            process_recording(repo, job)
        assignments = repo.finish_diarization.call_args.args[1]
        self.assertEqual(set(assignments), {"mic-h-one", "mic-h-two"})
        self.assertNotEqual(assignments["mic-h-one"], assignments["mic-h-two"])

    def test_short_and_long_speaker_passages_keep_their_origins(self):
        turns = [SpeakerTurn(0.1, 1.5, "A"), SpeakerTurn(1.7, 2.1, "A"), SpeakerTurn(3.1, 94.0, "B")]
        self.assertEqual(list(windows(turns, 94)), [(0.1, 2.1, "A"), (3.1, 93.1, "B"), (93.1, 94, "B")])
        self.assertEqual(list(windows([], 3)), [])
        self.assertEqual(wav_header(10)[36:44], b"data\x0a\x00\x00\x00")
