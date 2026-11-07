"""Synthetic acoustic vectors and PCM; no model downloads or provider calls."""

import asyncio
import base64
import json
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch
from uuid import uuid4

from test_repository import VoiceRepositoryFixture

from jude_voice.app import decode_turn
from jude_voice.ingest import stream_turns
from jude_voice.repository import Repository, anonymous_id, pack
from jude_voice.voiceprints import (
    RATE,
    VoiceprintSession,
    VoiceprintWorker,
    normalized,
    upload_samples,
)


class VoiceprintRepositoryTest(VoiceRepositoryFixture):
    def line(self, label, hearing="hearing", case="case", session=None):
        session = session or self.owner
        lease = self.repo.acquire(session, case, hearing)
        try:
            turn = uuid4().hex
            start = len(self.repo.statements(session, case, hearing)) * 2
            self.repo.begin_capture(session, case, hearing, lease=lease, epoch="test",
                turn_id=turn, start=start, pcm=b"\x10\x00" * 48000, keep=False)
            receipt = self.repo.save_stream_result(session, case, hearing, lease=lease, epoch="test",
                result_id=turn, segments=[{"start": start, "end": start + 2,
                                          "text": "Synthetic statement", "speaker": label}])
            self.repo.complete_capture(session, case, hearing, lease=lease, epoch="test", turn_id=turn)
        finally:
            self.repo.release(case, hearing, lease)
        return receipt["statementId"]

    def match(self, label, vector, hearing="hearing", case="case", session=None, model="synthetic-model"):
        return self.repo.match_voiceprint(session or self.owner, case, hearing,
            source=anonymous_id(hearing, "", "transcribe:test:" + label), embedding=vector, model=model)

    def speaker(self, sid, hearing="hearing", case="case", session=None):
        return next(s["speakerId"] for s in self.repo.statements(session or self.owner, case, hearing) if s["id"] == sid)

    def test_a_b_a_reuses_the_first_voice_even_when_amazon_assigns_a_new_label(self):
        a = self.line("stream-1-label-0")
        first = self.match("stream-1-label-0", [1, 0, 0])
        b = self.line("stream-1-label-1")
        second = self.match("stream-1-label-1", [0, 1, 0])
        a_again = self.line("stream-1-label-2")
        self.assertEqual(self.match("stream-1-label-2", [0.99, 0.02, 0.03]), first)
        next_a = self.line("stream-1-label-2")
        self.assertEqual([self.speaker(s) for s in (a, b, a_again, next_a)], [first, second, first, first])
        self.assertNotEqual(first, second)
        self.assertEqual(self.one("SELECT count(*) AS n FROM voiceprints")["n"], 2)
        self.assertNotIn("embedding", self.one("SELECT body FROM case_entities WHERE id=?", (first,))["body"])

    def test_new_hearing_and_service_restart_reuse_a_confirmed_case_voice(self):
        self.line("epoch-1-speaker-0")
        target = self.match("epoch-1-speaker-0", [1, 0])
        self.execute("UPDATE case_entities SET body=? WHERE kind='speakers' AND id=?",
            (pack({"id": target, "label": "Synthetic witness", "role": "witness", "confirmed": True}), target))
        with self.repo._case(self.owner, "case", "write") as graph:
            graph.put("hearings", {**graph.need("hearings", "hearing"), "id": "hearing-2", "number": 2})
        self.repo = Repository()
        line = self.line("new-epoch-speaker-0", "hearing-2")
        self.assertEqual(self.match("new-epoch-speaker-0", [0.98, 0.02], "hearing-2"), target)
        self.assertEqual(self.speaker(line, "hearing-2"), target)
        label = json.loads(self.one("SELECT body FROM case_entities WHERE id=?", (target,))["body"])
        self.assertEqual(label["label"], "Synthetic witness")
        self.assertTrue(label["confirmed"])

    def test_human_correction_wins_over_an_automatic_match_and_future_binding(self):
        self.line("a")
        self.match("a", [1, 0])
        sid = self.line("corrected")
        source = self.speaker(sid)
        self.execute("UPDATE case_entities SET body=? WHERE id=? AND kind='speakers'",
            (pack({"id": source, "label": "Different witness", "role": "witness", "confirmed": True}), source))
        self.assertEqual(self.match("corrected", [1, 0]), source)
        self.assertEqual(self.speaker(sid), source)
        self.assertEqual(self.speaker(self.line("corrected")), source)

    def test_ambiguous_voice_and_different_model_never_force_a_merge(self):
        self.line("a")
        self.match("a", [1, 0])
        self.line("b")
        self.match("b", [0, 1])
        uncertain = self.line("uncertain")
        original = self.speaker(uncertain)
        self.assertIsNone(self.match("uncertain", [1, 1]))
        self.assertEqual(self.speaker(uncertain), original)
        different = self.line("new-model")
        self.assertEqual(self.match("new-model", [1, 0], model="different-model"), self.speaker(different))

    def test_case_isolation_rechecks_roles_permission_and_revoked_sessions(self):
        self.line("a")
        first = self.match("a", [1, 0])
        other = self.repo.session(f"{3:064x}")
        hearing = {"id": "other-hearing", "caseId": "secret", "number": 1, "mode": "live",
                   "recordingPermission": {"by": other.user_id}}
        self.execute("INSERT INTO case_entities(case_id,kind,id,ordinal,body) VALUES('secret','hearings',?,0,?)",
                     (hearing["id"], pack(hearing)))
        self.line("a", hearing["id"], "secret", other)
        target = self.match("a", [1, 0], hearing["id"], "secret", other)
        self.assertNotEqual(first, target)
        args = {"source": first, "embedding": [1, 0], "model": "synthetic-model"}
        self.expect_error(404, self.repo.match_voiceprint, other, "case", "hearing", **args)
        self.expect_error(403, self.repo.match_voiceprint, self.viewer, "case", "hearing", **args)
        with self.repo._case(self.owner, "case", "write") as graph:
            graph.put("hearings", {**graph.need("hearings", "hearing"), "closed": True})
        self.expect_error(403, self.repo.match_voiceprint, self.owner, "case", "hearing", **args)
        self.execute("DELETE FROM sessions WHERE user_id='owner'")
        self.expect_error(401, self.repo.match_voiceprint, self.owner, "case", "hearing", **args)

    def test_matching_is_idempotent_and_case_deletion_removes_private_profiles(self):
        self.line("a")
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: self.match("a", [1, 0]), range(2)))
        self.assertEqual(results[0], results[1])
        self.assertEqual(self.one("SELECT samples FROM voiceprints")["samples"], 1)
        self.execute("DELETE FROM cases WHERE id='case'")
        self.assertEqual(self.one("SELECT count(*) AS n FROM voiceprints")["n"], 0)
        self.assertEqual(self.one("SELECT count(*) AS n FROM voiceprint_bindings")["n"], 0)


class VoiceprintSamplesTest(unittest.TestCase):
    def test_short_turns_accumulate_and_returning_native_labels_each_get_a_sample(self):
        submit = Mock(return_value=True)
        collector = VoiceprintSession(submit)
        collector.append(b"\x10\x00" * RATE * 10)
        collector.final([{"speaker": "a", "start": 0, "end": 0.5}], str)
        submit.assert_not_called()
        collector.final([{"speaker": "a", "start": 1, "end": 2},
                         {"speaker": "b", "start": 3, "end": 5},
                         {"speaker": "new-a", "start": 6, "end": 8}], str)
        self.assertEqual([c.args[0] for c in submit.call_args_list], ["a", "b", "new-a"])
        self.assertEqual(len(submit.call_args_list[0].args[1]), int(1.5 * RATE * 2))

    def test_overlapping_speech_is_skipped_and_pcm_memory_and_clip_sizes_are_bounded(self):
        submit = Mock(return_value=True)
        collector = VoiceprintSession(submit)
        collector.append(b"\x10\x00" * RATE * 100)
        self.assertEqual(len(collector.audio), 90 * RATE * 2)
        collector.final([{"speaker": "old", "start": 0, "end": 2},
                         {"speaker": "a", "start": 20, "end": 24},
                         {"speaker": "b", "start": 22, "end": 26}], str)
        submit.assert_not_called()
        collector.final([{"speaker": "clear", "start": 30, "end": 40}], str)
        self.assertEqual(len(submit.call_args.args[1]), 6 * RATE * 2)

    def test_upload_uses_the_original_sample_rate_and_zero_or_invalid_vectors_are_rejected(self):
        clips = upload_samples(b"\x10\x00" * 16000 * 5, [{"speaker": "0", "start": 1, "end": 3}], 16000)
        self.assertEqual([(label, len(pcm), rate) for label, pcm, rate in clips], [("0", 64000, 16000)])
        for vector in ([], [0, 0], [float("nan")], [float("inf")], [1e308], [True], ["1"]):
            with self.subTest(vector=vector), self.assertRaises(ValueError):
                normalized(vector)


class VoiceprintWorkerTest(unittest.IsolatedAsyncioTestCase):
    async def test_transcripts_finish_before_matching_and_later_resolve_a_b_a(self):
        fixture = VoiceRepositoryFixture()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        frames = asyncio.Queue()
        for index, value in enumerate((1, 2, 1)):
            pcm = bytes([value, 0]) * RATE * 2
            frames.put_nowait({"id": str(index), "t": index * 2, "keep": False,
                               "pcm": base64.b64encode(pcm).decode()})
        frames.put_nowait({"type": "stop"})
        ws = SimpleNamespace(query_params={}, receive_json=frames.get, send_json=AsyncMock())
        gate = threading.Event()

        def embed(pcm, rate):
            if not gate.wait(5):
                raise TimeoutError("Recorder incorrectly waited on recognition")
            return [1, 0] if pcm[0] == 1 else [0, 1]

        worker = VoiceprintWorker(fixture.repo, lambda: SimpleNamespace(model="test-model", embed=embed))
        with patch("jude_voice.voiceprints.configured", return_value=True):
            worker.start()

        class Stream:
            def __init__(self, language): self.ended = asyncio.Event()
            async def __aenter__(self): return self
            async def __aexit__(self, *args): pass
            async def send_audio(self, data): pass
            async def end_audio(self): self.ended.set()
            async def events(self):
                await self.ended.wait()
                for i in range(3):
                    yield {"id": str(i), "partial": False, "start": i * 2, "end": i * 2 + 2,
                           "segments": [{"start": i * 2, "end": i * 2 + 2, "speaker": str(i),
                                         "text": "Synthetic turn"}]}

        lease = fixture.repo.acquire(fixture.owner, "case", "hearing")
        try:
            await asyncio.wait_for(stream_turns(ws, fixture.repo, fixture.owner, "case", "hearing", lease,
                decode_turn, Stream, voiceprints=worker), 3)
            self.assertEqual(ws.send_json.call_args.args[0]["type"], "stopped")
            self.assertEqual(fixture.one("SELECT count(*) AS n FROM voice_pending_transcripts")["n"], 0)
            with fixture.repo._case(fixture.owner, "case", "write") as graph:
                graph.put("hearings", {**graph.need("hearings", "hearing"), "mode": "recorded"})
            gate.set()
            await asyncio.wait_for(worker.queue.join(), 5)
            labels = [s["speakerId"] for s in fixture.repo.statements(fixture.owner, "case", "hearing")]
            self.assertEqual(labels[0], labels[2])
            self.assertNotEqual(labels[0], labels[1])
        finally:
            gate.set()
            await worker.close()
            fixture.repo.release("case", "hearing", lease)

    async def test_queued_matching_is_independent_of_recorder_stop(self):
        repo = Mock()
        engine = SimpleNamespace(model="synthetic-model", embed=Mock(return_value=[1, 0]))
        worker = VoiceprintWorker(repo, lambda: engine)
        with patch("jude_voice.voiceprints.configured", return_value=True):
            worker.start()
        try:
            self.assertTrue(worker.submit(("session", "case"), "hearing", "source", b"00", 16000))
            await asyncio.wait_for(worker.queue.join(), 5)
            repo.match_voiceprint.assert_called_once_with("session", "case", "hearing",
                source="source", model="synthetic-model", embedding=[1, 0])
            engine.embed.assert_called_once_with(b"00", 16000)
        finally:
            await worker.close()

    async def test_model_failure_keeps_transcription_available_and_bounds_queue(self):
        worker = VoiceprintWorker(Mock(), Mock(side_effect=RuntimeError("synthetic failure")))
        with patch("jude_voice.voiceprints.configured", return_value=True):
            worker.start()
        for _ in range(32):
            self.assertTrue(worker.submit((None, "case"), "hearing", "source", b"00"))
        self.assertFalse(worker.submit((None, "case"), "hearing", "source", b"00"))
        await worker.task
        self.assertFalse(worker.submit((None, "case"), "hearing", "source", b"00"))
        await worker.close()
        self.assertTrue(worker.queue.empty())
