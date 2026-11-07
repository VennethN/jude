"""Verify the public transport and speaker worker without sending any test audio off-host."""

import asyncio
import base64
import json
import os
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, call, patch

from anyio import CancelScope, sleep_forever
from fastapi import WebSocketDisconnect
from fastapi.testclient import TestClient
from jude_voice import app as transport
from jude_voice.diarization import SpeakerTurn
from jude_voice.providers import Realtime, wav_header, windows
from jude_voice.speakers import BYTES_PER_SECOND, SpeakerWindow, process_recording


class VoiceTransportTest(unittest.TestCase):
    def setUp(self):
        self.repo = MagicMock()
        self.enterContext(patch.object(transport, "repo", self.repo))
        self.enterContext(patch.object(transport, "diarization_available", return_value=True))
        self.enterContext(
            patch.dict(os.environ, {"ORIGIN": "http://testserver", "OPENAI_API_KEY": "test"})
        )
        self.client = TestClient(transport.app)
        self.addCleanup(self.client.close)

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

    def test_reconnected_recorder_acknowledges_the_committed_turn_once(self):
        active = threading.Lock()
        holders = iter(["first", "second"])

        def acquire(*_):
            if not active.acquire(blocking=False):
                raise transport.VoiceError(409, "recorder_in_use", "Another recorder is connected.")
            return next(holders)

        self.repo.acquire.side_effect = acquire
        self.repo.release.side_effect = lambda *_: active.release()
        self.repo.turn_exists.side_effect = [False, True]
        recognizer = MagicMock()

        async def transcribe(pcm, partial):
            await partial("heard")
            return "heard"

        recognizer.transcribe = AsyncMock(side_effect=transcribe)
        context = MagicMock()
        context.__aenter__.return_value = recognizer
        pcm = b"\x00\x01" * 24000
        with (
            patch.object(transport, "Realtime", return_value=context),
            patch.object(transport, "SpeakerWindow") as window,
        ):
            window.return_value.label.return_value = {"turn-1": "anonymous-1"}
            def connect():
                return self.client.websocket_connect(
                    "/api/live/c/h/socket?lang=en", headers={"Origin": "http://testserver"}
                )

            with connect() as client:
                self.assertEqual(client.receive_json(), {"type": "ready"})
                turn = {"id": "turn-1", "t": 1.25, "keep": False, "pcm": base64.b64encode(pcm).decode()}
                client.send_json(turn)
                self.assertEqual(client.receive_json()["text"], "heard")
                self.assertEqual(client.receive_json(), {"type": "ack", "id": "turn-1"})
                with self.assertRaises(WebSocketDisconnect) as refused, connect():
                    self.fail("A second microphone must not enter an active hearing")
                self.assertEqual(refused.exception.code, 1008)
                self.repo.release.assert_not_called()

            # A browser resends its pending turn over a new connection after a dropped ack.
            with connect() as replacement:
                self.assertEqual(replacement.receive_json(), {"type": "ready"})
                replacement.send_json(turn)
                self.assertEqual(replacement.receive_json(), {"type": "ack", "id": "turn-1"})
            window.return_value.label.assert_called_once()
        recognizer.transcribe.assert_awaited_once()
        self.assertEqual(self.repo.store_turn.call_args.kwargs["speaker"], "anonymous-1")
        self.assertFalse(self.repo.store_turn.call_args.kwargs["keep"])
        self.assertEqual(self.repo.release.call_args_list, [call("c", "h", "first"), call("c", "h", "second")])
        self.assertFalse(active.locked())


class LeaseCancellationTest(unittest.IsolatedAsyncioTestCase):
    async def test_disconnect_during_handshake_releases_the_acquired_holder(self):
        ws = MagicMock()
        ws.headers = {"host": "testserver", "origin": "http://testserver"}
        ws.cookies = {}
        repo = MagicMock()
        repo.acquire.return_value = "holder"

        async def disconnect():
            scope.cancel()
            await sleep_forever()

        ws.accept = AsyncMock(side_effect=disconnect)
        with (
            patch.object(transport, "repo", repo),
            patch.object(transport, "diarization_available", return_value=True),
            patch.dict(os.environ, {"ORIGIN": "http://testserver", "OPENAI_API_KEY": "test"}),
            CancelScope() as scope,
        ):
            await transport.socket(ws, "case", "hearing")

        repo.release.assert_called_once_with("case", "hearing", "holder")

    async def test_cancelled_handshake_joins_an_inflight_database_acquisition(self):
        loop = asyncio.get_running_loop()
        started = asyncio.Event()
        finish = threading.Event()
        repo = MagicMock()

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


class RealtimeTest(unittest.IsolatedAsyncioTestCase):
    async def test_visible_deltas_accumulate_until_the_committed_transcript(self):
        recognizer = Realtime("id")
        recognizer.socket = AsyncMock()
        prefix = "conversation.item.input_audio_transcription."
        recognizer.socket.recv.side_effect = [
            json.dumps({"type": prefix + "delta", "delta": "Dua "}),
            json.dumps({"type": prefix + "delta", "delta": "kata"}),
            json.dumps({"type": prefix + "completed", "transcript": "Dua kata."}),
        ]
        partial = AsyncMock()
        self.assertEqual(await recognizer.transcribe(b"\0" * 1000, partial), "Dua kata.")
        self.assertEqual([c.args[0] for c in partial.await_args_list], ["Dua ", "Dua kata"])
