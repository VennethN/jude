import hashlib
import json
import os
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from jude_voice.repository import Repository, VoiceError, now_ms, pack


class VoiceRepositoryFixture(unittest.TestCase):
    """Uses the same migrations for SQLite and the optional PostgreSQL test DSN."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        updated = patch.dict(
            os.environ,
            {"JUDE_DB_PATH": str(self.root / "state.db"), "JUDE_FILES_DIR": str(self.root / "files")},
        )
        updated.start()
        self.addCleanup(updated.stop)
        os.environ.pop("DATABASE_URL", None)
        os.environ.pop("JUDE_S3_BUCKET", None)
        if dsn := os.getenv("JUDE_TEST_DATABASE_URL"):
            import psycopg
            from psycopg.conninfo import make_conninfo

            schema = "jude_voice_test_" + uuid4().hex
            with psycopg.connect(dsn, autocommit=True) as conn:
                conn.execute(f'CREATE SCHEMA "{schema}"')

            def cleanup_schema():
                with psycopg.connect(dsn, autocommit=True) as conn:
                    conn.execute(f'DROP SCHEMA "{schema}" CASCADE')

            self.addCleanup(cleanup_schema)
            os.environ["DATABASE_URL"] = make_conninfo(dsn, options="-c search_path=" + schema)
        self.repo = Repository()
        self.addCleanup(self.repo.db.close)
        self.assertTrue(self.repo.ready())
        with self.repo.db.transaction(True) as tx:
            for org in ("org-a", "org-b"):
                tx.execute(
                    "INSERT INTO organizations(id,name,plan_id,created_at) VALUES(?,?,'pro',1)", (org, org)
                )
            for i, (name, org, role) in enumerate(
                [
                    ("owner", "org-a", "owner"),
                    ("viewer", "org-a", "member"),
                    ("other", "org-b", "owner"),
                    ("guest", "org-a", "member"),
                ]
            ):
                token = f"{i + 1:064x}"
                tx.execute(
                    "INSERT INTO users(id,name,guest,created_at) VALUES(?,?,?,1)",
                    (name, name, int(name == "guest")),
                )
                tx.execute("INSERT INTO memberships(user_id,org_id,role) VALUES(?,?,?)", (name, org, role))
                tx.execute(
                    "INSERT INTO sessions(token_hash,user_id,org_id,expires_at) VALUES(?,?,?,?)",
                    (hashlib.sha256(token.encode()).hexdigest(), name, org, now_ms() + 86_400_000),
                )
            for cid, org, synthetic in (
                ("case", "org-a", False),
                ("demo", "org-a", True),
                ("secret", "org-b", False),
            ):
                record = {
                    "id": cid,
                    "title": cid,
                    "label": "synthetic" if synthetic else "private",
                    "updated": "",
                    "archived": False,
                }
                tx.execute(
                    "INSERT INTO cases(id,org_id,record,updated_at,synthetic) VALUES(?,?,?,0,?)",
                    (cid, org, pack(record), int(synthetic)),
                )
            for cid, user, role in (
                ("case", "owner", "owner"),
                ("case", "viewer", "viewer"),
                ("case", "guest", "editor"),
                ("demo", "guest", "owner"),
                ("secret", "other", "owner"),
            ):
                tx.execute(
                    "INSERT INTO case_members(case_id,user_id,role) VALUES(?,?,?)", (cid, user, role)
                )
            for cid, hid in (("case", "hearing"), ("demo", "h3")):
                hearing = {
                    "id": hid,
                    "caseId": cid,
                    "number": 1,
                    "title": {"id": "Uji", "en": "Test"},
                    "mode": "live",
                    "recordingPermission": {"by": "owner"},
                }
                tx.execute(
                    "INSERT INTO case_entities(case_id,kind,id,ordinal,body) VALUES(?,'hearings',?,0,?)",
                    (cid, hid, pack(hearing)),
                )
        self.owner = self.repo.session("jude_session=" + f"{1:064x}")
        self.viewer = self.repo.session(f"{2:064x}")
        self.guest = self.repo.session(f"{4:064x}")

    def expect_error(self, status, fn, *args, **kwargs):
        with self.assertRaises(VoiceError) as raised:
            fn(*args, **kwargs)
        self.assertEqual(raised.exception.status, status)
        return raised.exception.code

    def one(self, sql, args=()):
        with self.repo.db.transaction() as tx:
            return tx.one(sql, args)

    def execute(self, sql, args=()):
        with self.repo.db.transaction(True) as tx:
            tx.execute(sql, args)

    def upload(self, key="request", audio=b"audio"):
        return self.repo.add_recording(
            self.owner,
            "case",
            title="Court recording",
            date="2026-11-07",
            filename="hearing.wav",
            mime="audio/wav",
            audio=audio,
            duration=1.5,
            permission=True,
            segments=[
                {"start": 0, "end": 0.5, "text": "First.", "speaker": "group-a"},
                {"start": 0.5, "end": 1.5, "text": "Second.", "speaker": "group-a"},
            ],
            idempotency_key=key,
        )

    def turn(self, name, lease, keep=True, text=None):
        return self.repo.store_turn(
            self.owner,
            "case",
            "hearing",
            lease=lease,
            turn_id=name,
            start=2,
            pcm=b"\x10\x00" * 24_000,
            keep=keep,
            text=name if text is None else text,
        )


class VoiceRepositoryTest(VoiceRepositoryFixture):
    def test_failed_transaction_rolls_back_before_connection_is_reused(self):
        with self.assertRaisesRegex(RuntimeError, "synthetic rollback"), self.repo.db.transaction(True) as tx:
            tx.execute("UPDATE organizations SET name='Uncommitted' WHERE id='org-a'")
            raise RuntimeError("synthetic rollback")
        self.assertEqual(self.one("SELECT name FROM organizations WHERE id='org-a'")["name"], "org-a")
        self.execute("UPDATE organizations SET name='Committed' WHERE id='org-a'")
        self.assertEqual(self.one("SELECT name FROM organizations WHERE id='org-a'")["name"], "Committed")

    @unittest.skipUnless(os.getenv("JUDE_TEST_DATABASE_URL"), "PostgreSQL pool regression")
    def test_postgres_reuses_connections_and_can_reopen_after_shutdown(self):
        pids = {self.one("SELECT pg_backend_pid() AS pid")["pid"] for _ in range(8)}
        self.assertLessEqual(len(pids), 4)
        old_pool = self.repo.db._pool
        self.repo.db.close()
        self.assertTrue(old_pool.closed)
        self.assertNotIn(self.one("SELECT pg_backend_pid() AS pid")["pid"], pids)
        self.assertEqual(self.repo.case(self.owner, "case")["id"], "case")

    def test_tenants_roles_membership_archive_and_session_revocation(self):
        self.assertEqual(self.repo.case(self.viewer, "case")["title"], "case")
        self.expect_error(404, self.repo.case, self.owner, "secret")
        self.expect_error(403, self.repo.check_recording, self.viewer, "case")
        self.expect_error(403, self.repo.check_recording, self.guest, "case")
        self.expect_error(403, self.repo.check_recording, self.guest, "demo")
        self.expect_error(401, self.repo.session, "badcookie")
        self.execute("UPDATE cases SET archived=1 WHERE id='case'")
        self.expect_error(409, self.repo.acquire, self.owner, "case", "hearing")
        self.execute("DELETE FROM memberships WHERE user_id='owner' AND org_id='org-a'")
        self.expect_error(401, self.repo.case, self.owner, "case")

    def test_concurrent_uploads_register_one_original_and_charge_once(self):
        with ThreadPoolExecutor(max_workers=2) as pool:
            recordings = list(pool.map(lambda _: self.upload(), range(2)))
        self.assertEqual(recordings[0]["id"], recordings[1]["id"])
        self.assertEqual(self.repo.previous_upload(self.owner, "case", "request"), recordings[0])
        self.assertEqual(recordings[0]["language"], "id")
        hid = recordings[0]["id"]
        asset = self.repo.audio(self.viewer, "case", hid)
        self.assertEqual(self.repo.storage.get(asset["object_key"]), b"audio")
        self.assertEqual(asset["mime"], "audio/wav")
        self.assertEqual(len([p for p in (self.root / "files").rglob("*") if p.is_file()]), 1)
        statements = self.repo.statements(self.owner, "case", hid)
        self.assertEqual([s["text"] for s in statements], ["First.", "Second."])
        self.assertEqual(statements[0]["speakerId"], statements[1]["speakerId"])
        self.assertEqual(self.one("SELECT count(*) AS n FROM analysis_jobs")["n"], 2)
        self.assertEqual(self.one("SELECT amount FROM usage_counts")["amount"], 1500)
        self.assertEqual(self.one("SELECT version FROM cases WHERE id='case'")["version"], 2)
        self.expect_error(404, self.repo.audio, self.repo.session(f"{3:064x}"), "case", hid)

    def test_atomic_quota_on_competing_uploads_and_trial_downgrade(self):
        self.execute("UPDATE organizations SET plan_id='basic' WHERE id='org-a'")
        self.execute(
            "INSERT INTO attachments(case_id,entity_id,kind,object_key,file_name,mime,byte_length) VALUES('case','previous','original','previous','x','text/plain',999999995)"
        )

        def upload_once(i):
            try:
                return self.upload(str(i))["id"]
            except VoiceError as exc:
                return exc.status

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(upload_once, range(2)))
        self.assertEqual(results.count(402), 1)
        self.assertEqual(self.one("SELECT amount FROM usage_counts")["amount"], 1500)
        self.execute(
            "UPDATE organizations SET plan_id='pro',plan_status='trialing',trial_ends=1 WHERE id='org-a'"
        )
        self.assertEqual(
            self.expect_error(402, self.repo.acquire, self.owner, "case", "hearing"), "feature_not_in_plan"
        )

    def guest_practice(self):
        self.execute("UPDATE organizations SET demo_id='case' WHERE id='org-a'")
        self.execute("UPDATE case_members SET role='owner' WHERE case_id='case' AND user_id='guest'")
        for number, hid in enumerate(("practice-1", "practice-2"), 2):
            hearing = {"id": hid, "caseId": "case", "mode": "live", "recordingPermission": {"by": "guest"}}
            self.execute(
                "INSERT INTO case_entities(case_id,kind,id,ordinal,body) VALUES('case','hearings',?,?,?)",
                (hid, number, pack(hearing)),
            )

    def test_guest_live_requires_the_owned_private_demo_and_personal_consent(self):
        self.guest_practice()
        live = (self.guest, "case", "practice-1")
        self.assertEqual(self.repo.check_recording(*live)["id"], "practice-1")
        self.expect_error(404, self.repo.acquire, self.guest, "secret", "practice-1")
        self.expect_error(403, self.repo.acquire, self.guest, "case", "hearing")
        self.execute("UPDATE organizations SET demo_id='demo' WHERE id='org-a'")
        self.expect_error(403, self.repo.acquire, *live)
        self.expect_error(403, self.repo.acquire, self.guest, "demo", "h3")
        self.execute("UPDATE organizations SET demo_id='case' WHERE id='org-a'")
        self.execute("UPDATE cases SET synthetic=1 WHERE id='case'")
        self.expect_error(403, self.repo.acquire, *live)
        self.execute("UPDATE cases SET synthetic=0 WHERE id='case'")
        self.execute("UPDATE case_members SET role='editor' WHERE case_id='case' AND user_id='guest'")
        self.expect_error(403, self.repo.acquire, *live)
        self.execute("UPDATE case_members SET role='owner' WHERE case_id='case' AND user_id='guest'")
        self.execute("UPDATE organizations SET plan_id='basic' WHERE id='org-a'")
        self.assertEqual(self.expect_error(402, self.repo.acquire, *live), "feature_not_in_plan")
        self.execute("UPDATE organizations SET plan_id='pro' WHERE id='org-a'")
        lease = self.repo.acquire(*live)
        self.execute("UPDATE organizations SET demo_id=NULL WHERE id='org-a'")
        self.expect_error(403, self.repo.renew, *live, lease)
        self.execute("UPDATE organizations SET demo_id='case' WHERE id='org-a'")
        hearing = {**self.repo.check_recording(*live), "mode": "recorded"}
        self.execute("UPDATE case_entities SET body=? WHERE case_id='case' AND id='practice-1'", (pack(hearing),))
        self.assertEqual(self.expect_error(409, self.repo.renew, *live, lease), "not_live")

    def test_guest_practice_keeps_only_transcripts_and_cannot_upload(self):
        self.guest_practice()
        live = (self.guest, "case", "practice-1")
        lease = self.repo.acquire(*live)
        turn = {"lease": lease, "epoch": "epoch-1", "turn_id": "speech", "start": 1, "pcm": b"\x01\0" * 24000}
        self.assertEqual(self.expect_error(403, self.repo.begin_capture, *live, **turn, keep=True), "guest_transcript_only")
        self.expect_error(403, self.repo.check_recording, self.guest, "case")
        self.expect_error(403, self.repo.previous_upload, self.guest, "case", "file")
        self.expect_error(
            403, self.repo.add_recording, self.guest, "case",
            title="Upload", date="2026-11-07", filename="sample.wav", mime="audio/wav", audio=b"audio",
            duration=1, permission=True, segments=[{"start": 0, "end": 1, "text": "Hello", "speaker": "A"}],
        )
        self.assertIsNone(self.repo.begin_capture(*live, **turn, keep=False))
        saved = self.repo.save_stream_result(*live, lease=lease, epoch="epoch-1", result_id="result-one",
            segments=[{"start": 1.0, "end": 1.5, "text": "Testimony.", "speaker": "0"}])
        self.assertIsNotNone(saved["statementId"])
        self.assertEqual(self.repo.capture_resume_offset(*live, lease=lease, turn_id="speech"), 0.5)
        self.repo.complete_capture(*live, lease=lease, epoch="epoch-1", turn_id="speech")
        self.expect_error(403, self.repo.finalize_speakers, *live, {saved["statementId"]: "other"})
        self.assertEqual(self.repo.statements(*live)[0]["text"], "Testimony.")
        self.assertIsNone(self.repo.voice_turns(*live)[0]["object_key"])
        self.expect_error(404, self.repo.audio, *live)
        self.assertFalse(any(p.is_file() for p in (self.root / "files").rglob("*")))

    def test_guest_audio_budget_is_lifetime_sample_accurate_and_atomic_across_hearings(self):
        self.guest_practice()
        hearings = ("practice-1", "practice-2")
        leases = {hid: self.repo.acquire(self.guest, "case", hid) for hid in hearings}
        starts = {f"turn-{index}": 1000 + index * 30 for index in range(9)}
        starts["almost"] = 1600

        def begin(hid, tid, pcm, epoch="epoch-1"):
            return self.repo.begin_capture(
                self.guest, "case", hid, epoch=epoch, lease=leases[hid], turn_id=tid,
                start=starts.get(tid, 2000), pcm=pcm, keep=False
            )

        full = bytes(30 * 48_000)
        for index in range(9):
            begin(hearings[index % 2], f"turn-{index}", full)
        begin(hearings[0], "almost", full[:-2])  # One PCM sample remains.
        self.assertEqual(self.repo.check_recording(self.guest, "case", hearings[0])["id"], hearings[0])
        self.repo.release("case", hearings[0], leases[hearings[0]])
        leases[hearings[0]] = self.repo.acquire(self.guest, "case", hearings[0])
        with ThreadPoolExecutor(max_workers=2) as pool:
            retries = list(pool.map(lambda n: begin(hearings[0], "almost", full[:-2], f"retry-{n}"), range(2)))
        self.assertEqual(retries, [None, None])

        def admit(hid):
            try:
                begin(hid, "final-sample", b"\x01\0")
                return hid
            except VoiceError as exc:
                return (exc.status, exc.code)

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(admit, hearings))
        self.assertEqual(results.count((402, "guest_live_limit")), 1)
        winner = next(hid for hid in hearings if hid in results)
        counter = "SELECT amount FROM usage_counts WHERE org_id='org-a' AND period='lifetime' AND quota='guest_live_pcm_bytes'"
        self.assertEqual(self.one(counter)["amount"], 300 * 48_000)
        self.assertEqual(self.one("SELECT count(*) AS n FROM voice_turns")["n"], 11)
        self.assertEqual(self.expect_error(402, begin, winner, "extra", bytes(2)), "guest_live_limit")
        self.assertEqual(self.expect_error(402, self.repo.check_recording, self.guest, "case", winner), "guest_live_limit")

        # The AWS result watermark survives epoch recovery at the limit, with one durable statement.
        practice = (self.guest, "case", hearings[0])
        segments = [{"start": 1600, "end": 1600.5, "text": "Tercatat.", "speaker": "0"}]
        saved = self.repo.save_stream_result(*practice, lease=leases[hearings[0]], epoch="epoch-1",
                                             result_id="result", segments=segments)
        self.assertIsNone(begin(hearings[0], "almost", full[:-2], "recovery"))
        self.assertEqual(self.repo.capture_resume_offset(*practice, lease=leases[hearings[0]], turn_id="almost"), 0.5)
        recovered = self.repo.save_stream_result(*practice, lease=leases[hearings[0]], epoch="recovery",
                                                 result_id="recovered", segments=segments)
        self.assertEqual(recovered["statementId"], saved["statementId"])
        self.assertEqual(len(self.repo.statements(*practice)), 1)
        # A pending final turn can finish on a replacement socket, and a lost ACK can be replayed.
        self.repo.release("case", winner, leases[winner])
        leases[winner] = self.repo.acquire(self.guest, "case", winner)
        self.assertIsNone(begin(winner, "final-sample", b"\x01\0", "reconnect"))
        receipt = self.repo.complete_capture(self.guest, "case", winner, lease=leases[winner],
                                             epoch="reconnect", turn_id="final-sample")
        self.assertEqual(begin(winner, "final-sample", b"\x01\0", "lost-ack"), receipt)
        self.assertEqual(self.one(counter)["amount"], 300 * 48_000)
        self.execute("DELETE FROM voice_turns WHERE hearing_id='practice-1'")
        self.execute("UPDATE usage_counts SET period='2001-01' WHERE quota='hours'")
        self.assertEqual(self.expect_error(402, begin, winner, "next-month", bytes(2)), "guest_live_limit")
        # The ordinary paid recording path in the same org retains its own plan allowance.
        paid = self.repo.acquire(self.owner, "case", "hearing")
        self.turn("paid", paid)
        self.assertEqual(self.one(counter)["amount"], 300 * 48_000)
        # A second guest's own demo organisation has an independent allowance.
        self.execute("UPDATE users SET guest=1 WHERE id='other'")
        self.execute("UPDATE organizations SET demo_id='secret' WHERE id='org-b'")
        self.execute(
            "INSERT INTO case_entities(case_id,kind,id,ordinal,body) VALUES('secret','hearings','separate',0,?)",
            (pack({"id": "separate", "caseId": "secret", "mode": "live", "recordingPermission": {"by": "other"}}),),
        )
        other = self.repo.session(f"{3:064x}")
        other_lease = self.repo.acquire(other, "secret", "separate")
        self.repo.begin_capture(other, "secret", "separate", lease=other_lease, epoch="other-epoch",
                                turn_id="first", start=0, pcm=bytes(48_000), keep=False)
        self.assertEqual(self.one("SELECT amount FROM usage_counts WHERE org_id='org-b' AND period='lifetime'")["amount"], 48_000)

    def test_recorder_lease_replay_and_finalization(self):
        lease = self.repo.acquire(self.owner, "case", "hearing")
        self.expect_error(409, self.repo.acquire, self.owner, "case", "hearing")
        self.repo.release("case", "hearing", "wrong")
        self.repo.renew(self.owner, "case", "hearing", lease)
        with ThreadPoolExecutor(max_workers=2) as pool:
            first, repeated = list(pool.map(lambda _: self.turn("a", lease), range(2)))
        self.assertEqual(first, repeated)
        self.turn("b", lease)
        self.turn("dropped", lease, False)
        turns = self.repo.voice_turns(self.viewer, "case", "hearing")
        self.assertEqual([bool(t["object_key"]) for t in turns], [True, True, False])
        self.assertEqual(len(self.repo.audio(self.viewer, "case", "hearing")["turns"]), 2)
        self.assertEqual(self.one("SELECT amount FROM usage_counts")["amount"], 3000)
        self.assertIsNone(self.repo.claim_diarization())
        self.execute("UPDATE voice_leases SET expires_at=1")
        self.expect_error(409, self.turn, "c", lease)
        new_lease = self.repo.acquire(self.owner, "case", "hearing")
        self.repo.release("case", "hearing", lease)
        self.repo.renew(self.owner, "case", "hearing", new_lease)
        statements = self.repo.statements(self.owner, "case", "hearing")
        self.assertEqual(len({s["speakerId"] for s in statements}), 3)
        speaker = json.loads(
            self.one(
                "SELECT body FROM case_entities WHERE kind='speakers' AND id=?",
                (statements[1]["speakerId"],),
            )["body"]
        )
        speaker.update(confirmed=True, label="Manually assigned")
        self.execute(
            "UPDATE case_entities SET body=? WHERE kind='speakers' AND id=?", (pack(speaker), speaker["id"])
        )
        hearing = json.loads(
            self.one("SELECT body FROM case_entities WHERE case_id='case' AND kind='hearings'")["body"]
        )
        hearing["mode"] = "recorded"
        self.execute(
            "UPDATE case_entities SET body=? WHERE case_id='case' AND kind='hearings'", (pack(hearing),)
        )
        self.execute("UPDATE voice_diarization_jobs SET available_at=0")
        job = self.repo.claim_diarization()
        self.assertIsNotNone(job)
        self.assertIsNone(self.repo.claim_diarization())
        self.assertEqual(len(self.repo.diarization_inputs(job)["turns"]), 2)
        self.execute("UPDATE voice_diarization_jobs SET lease_until=0")
        replacement = self.repo.claim_diarization()
        self.expect_error(409, self.repo.finish_diarization, job, {})
        self.repo.renew_diarization(replacement)
        assigned = {s["id"]: "anonymous-a" for s in statements}
        self.assertEqual(self.repo.finish_diarization(replacement, assigned), 1)
        self.assertEqual(
            self.repo.finalize_speakers(
                self.owner, "case", "hearing", {s["id"]: "anonymous-a" for s in statements[:2]}
            ),
            0,
        )
        self.assertIsNone(self.repo.claim_diarization())
        lines = self.repo.statements(self.owner, "case", "hearing")
        self.assertNotEqual(lines[0]["speakerId"], statements[0]["speakerId"])
        self.assertEqual(lines[1]["speakerId"], statements[1]["speakerId"])

    def test_reconnecting_microphone_identifies_speech_and_silent_commits(self):
        lease = self.repo.acquire(self.owner, "case", "hearing")
        for turn_id, text, sid in (("said", "Testimony.", "mic-hearing-said"), ("quiet", "", None)):
            with self.subTest(turn=turn_id):
                self.assertIsNone(self.repo.committed_turn(self.owner, "case", "hearing", turn_id))
                received = self.turn(turn_id, lease, keep=False, text=text)
                self.assertEqual(received, {"id": turn_id, "statementId": sid})
                self.assertEqual(self.repo.committed_turn(self.owner, "case", "hearing", turn_id), received)
                self.assertEqual(self.turn(turn_id, lease, text="a retry"), received)
                self.expect_error(403, self.repo.committed_turn, self.viewer, "case", "hearing", turn_id)
        self.assertEqual(len(self.repo.statements(self.owner, "case", "hearing")), 1)

    def test_audio_is_kept_before_recognition_and_out_of_order_retries_charge_once(self):
        lease = self.repo.acquire(self.owner, "case", "hearing")
        kept = {"turn_id": "first", "start": 1.25, "pcm": b"\x01\x00" * 4800, "keep": True}
        transient = {"turn_id": "later", "start": 1.45, "pcm": b"\x02\x00" * 8400, "keep": False}
        def begin(turn):
            return self.repo.begin_turn(self.owner, "case", "hearing", lease=lease, **turn)

        self.assertIsNone(begin(kept))
        self.assertIsNone(begin(transient))
        self.assertIsNone(self.repo.committed_turn(self.owner, "case", "hearing", "first"))
        self.assertEqual(self.repo.statements(self.owner, "case", "hearing"), [])
        captured = self.repo.voice_turns(self.viewer, "case", "hearing")
        self.assertEqual([(t["start_seconds"], t["bytes"]) for t in captured], [(1.25, 9600), (1.45, 16800)])
        self.assertEqual(self.repo.storage.get(captured[0]["object_key"]), kept["pcm"])
        self.assertIsNone(captured[1]["object_key"])
        self.expect_error(409, begin, {**kept, "pcm": transient["pcm"]})

        self.repo.release("case", "hearing", lease)
        lease = self.repo.acquire(self.owner, "case", "hearing")
        self.assertIsNone(begin(kept))
        for tid in ["later", "first"]:
            receipt = self.repo.finish_turn(self.owner, "case", "hearing", lease=lease, turn_id=tid, text=tid)
            self.assertEqual(receipt["statementId"], "mic-hearing-" + tid)
        self.assertEqual([s["text"] for s in self.repo.statements(self.viewer, "case", "hearing")], ["first", "later"])
        self.assertEqual(begin(kept)["statementId"], "mic-hearing-first")
        self.assertEqual(self.one("SELECT amount FROM usage_counts")["amount"], 550)
        self.assertEqual(self.one("SELECT count(*) AS n FROM analysis_jobs")["n"], 2)
        self.assertEqual(self.one("SELECT count(*) AS n FROM voice_pending_transcripts")["n"], 0)

    def test_replay_is_synthetic_case_scoped_and_retry_safe(self):
        with ThreadPoolExecutor(max_workers=2) as pool:
            previews = list(
                pool.map(lambda n: self.repo.replay_preview(self.guest, "demo", "h3", n), [0, 7])
            )
            result = list(pool.map(lambda _: self.repo.replay(self.guest, "demo", "h3", 0), range(2)))
        self.assertEqual(previews[0], previews[1])
        self.assertEqual([r["cursor"] for r in result], [1, 1])
        (line,) = self.repo.statements(self.guest, "demo", "h3")
        self.assertEqual(previews[0]["turn"]["id"], line["id"])
        next_turn = self.repo.replay_preview(self.guest, "demo", "h3", 0)
        self.assertEqual(next_turn["cursor"], 1)
        self.assertNotEqual(next_turn["turn"]["id"], line["id"])
        self.assertEqual(self.one("SELECT version FROM cases WHERE id='demo'")["version"], 2)
        self.assertEqual(self.one("SELECT count(*) AS n FROM analysis_jobs")["n"], 0)
        self.expect_error(409, self.repo.replay, self.owner, "case", "hearing", 0)
        self.expect_error(422, self.repo.replay, self.guest, "demo", "h3", True)

    def capture(self, lease, tid="a", start=10, epoch="epoch-1", keep=True):
        return self.repo.begin_capture(
            self.owner, "case", "hearing", lease=lease, epoch=epoch, turn_id=tid,
            start=start, pcm=b"\x10\x00" * 24_000, keep=keep,
        )

    def recorded_job(self):
        hearing = json.loads(self.one(
            "SELECT body FROM case_entities WHERE case_id='case' AND kind='hearings'"
        )["body"])
        hearing["mode"] = "recorded"
        self.execute("UPDATE case_entities SET body=? WHERE case_id='case' AND kind='hearings'", (pack(hearing),))
        self.execute("UPDATE voice_diarization_jobs SET available_at=0")
        return self.repo.claim_diarization()

    def test_segmented_turn_has_independent_pending_speakers_and_relative_spans(self):
        lease = self.repo.acquire(self.owner, "case", "hearing")
        self.repo.begin_turn(self.owner, "case", "hearing", lease=lease, turn_id="split", start=2,
                             pcm=b"\x00\x00" * 24_000, keep=True)
        kwargs = {"lease": lease, "turn_id": "split", "text": "combined", "segments": [
            {"start": 0, "end": .4, "text": "Pertama.", "speaker": "spk_0"},
            {"start": .4, "end": 1, "text": "Second.", "speaker": "spk_0"},
        ]}
        receipt = self.repo.finish_turn(self.owner, "case", "hearing", **kwargs)
        self.assertEqual(receipt["statementId"], "mic-hearing-split")
        self.assertEqual(self.repo.finish_turn(self.owner, "case", "hearing", **kwargs), receipt)
        lines = self.repo.statements(self.owner, "case", "hearing")
        self.assertEqual([(s["t"], s["text"]) for s in lines], [(2, "Pertama."), (2.4, "Second.")])
        self.assertEqual(lines[1]["id"], "micseg-" + hashlib.sha256(b"mic-hearing-split").hexdigest() + "-2")
        self.assertEqual(len({s["speakerId"] for s in lines}), 2)
        self.assertTrue(all(s["speakerId"].startswith("voice-pending-") for s in lines))
        job = self.recorded_job()
        inputs = self.repo.diarization_inputs(job)
        self.assertEqual(len(inputs["statements"]), 2)
        self.assertEqual(inputs["turns"][0]["statement_spans"], [
            {"statement_id": lines[0]["id"], "start": 0, "end": .4},
            {"statement_id": lines[1]["id"], "start": .4, "end": 1},
        ])
        self.assertEqual(self.repo.finish_diarization(job, {lines[0]["id"]: "acoustic-a", lines[1]["id"]: "acoustic-b"}), 2)

    def test_segment_validation_is_atomic_and_uses_original_pcm_duration(self):
        lease = self.repo.acquire(self.owner, "case", "hearing")
        self.capture(lease, keep=False)
        bad = [None, {}, {"start": 0, "end": 1.01, "text": "x"},
               {"start": -1, "end": 1, "text": "x"}, {"start": 1, "end": 1, "text": "x"},
               {"start": float("nan"), "end": 1, "text": "x"},
               {"start": 0, "end": float("inf"), "text": "x"},
               {"start": False, "end": 1, "text": "x"}, {"start": 0, "end": 1, "text": " "}]
        for segment in bad:
            with self.subTest(segment=segment):
                self.expect_error(422, self.repo.finish_turn, self.owner, "case", "hearing",
                                  lease=lease, turn_id="a", text="fallback", segments=[segment])
        self.assertEqual(self.repo.statements(self.owner, "case", "hearing"), [])
        self.assertEqual(self.one("SELECT count(*) AS n FROM voice_pending_transcripts")["n"], 1)

    def test_stream_result_spans_captures_and_replays_across_epochs_without_duplicates(self):
        lease = self.repo.acquire(self.owner, "case", "hearing")
        self.capture(lease)
        self.capture(lease, "b", 11)
        def resume(tid):
            return self.repo.capture_resume_offset(self.owner, "case", "hearing", lease=lease, turn_id=tid)
        self.assertEqual(resume("b"), 0)
        fingerprint = self.one("SELECT fingerprint FROM voice_pending_transcripts WHERE turn_id='b'")["fingerprint"]
        segments = [{"start": 10.2, "end": 11.2, "text": "Kesaksian."},
                    {"start": 11.2, "end": 11.8, "text": "Response.", "speaker": "spk_1"}]
        def save(epoch="epoch-1", result_id="r", values=segments):
            return self.repo.save_stream_result(self.owner, "case", "hearing", lease=lease,
                                               epoch=epoch, result_id=result_id, segments=values)
        with ThreadPoolExecutor(max_workers=2) as pool:
            receipts = list(pool.map(lambda _: save(), range(2)))
        receipt = receipts[0]
        self.assertEqual(receipt, receipts[1])
        self.assertEqual(resume("a"), 1)
        self.assertAlmostEqual(resume("b"), .8)
        self.assertIsNone(self.repo.committed_turn(self.owner, "case", "hearing", "b"))
        self.assertEqual(self.one("SELECT fingerprint FROM voice_pending_transcripts WHERE turn_id='b'")["fingerprint"], fingerprint)
        self.expect_error(409, self.repo.begin_capture, self.owner, "case", "hearing", lease=lease,
                          epoch="epoch-reconnect", turn_id="b", start=11.8,
                          pcm=b"\x10\x00" * 4800, keep=True)
        self.expect_error(403, self.repo.capture_resume_offset, self.viewer, "case", "hearing", lease=lease, turn_id="b")
        self.expect_error(409, self.repo.capture_resume_offset, self.owner, "case", "hearing", lease="wrong", turn_id="b")
        lines = self.repo.statements(self.owner, "case", "hearing")
        self.assertEqual([(s["t"], s["text"]) for s in lines], [(10.2, "Kesaksian."), (11.2, "Response.")])
        self.assertEqual(len({s["speakerId"] for s in lines}), 2)
        # A human label survives retries and deferred acoustic assignments.
        speaker = json.loads(self.one("SELECT body FROM case_entities WHERE kind='speakers' AND id=?",
                                      (lines[1]["speakerId"],))["body"])
        speaker.update(label="Counsel", confirmed=True)
        self.execute("UPDATE case_entities SET body=? WHERE kind='speakers' AND id=?", (pack(speaker), speaker["id"]))
        for tid in ("a", "b"):
            complete = self.repo.complete_capture(self.owner, "case", "hearing", lease=lease, epoch="epoch-1", turn_id=tid)
            self.assertEqual(complete, {"id": tid, "statementId": None})
            self.assertEqual(self.repo.committed_turn(self.owner, "case", "hearing", tid), complete)
        self.assertAlmostEqual(resume("b"), .8)
        self.capture(lease, epoch="epoch-2")
        self.capture(lease, "b", 11, "epoch-2")
        self.assertEqual(self.one("SELECT fingerprint FROM voice_stream_captures WHERE turn_id='b' AND epoch='epoch-2'")["fingerprint"], fingerprint)
        self.assertEqual(save("epoch-2")["segments"], receipt["segments"])
        self.assertEqual(save("epoch-2", "split", [dict(segments[0], end=10.8)])["statementId"], lines[0]["id"])
        self.assertEqual(self.expect_error(409, save, "epoch-2", "overlap",
                                         [dict(segments[1], end=12)]), "stream_result_overlap")
        self.assertEqual(self.one("SELECT count(*) AS n FROM analysis_jobs")["n"], 2)
        self.assertEqual(self.one("SELECT amount FROM usage_counts")["amount"], 2000)
        job = self.recorded_job()
        inputs = self.repo.diarization_inputs(job)
        self.assertEqual({s["id"] for s in inputs["statements"]}, {s["id"] for s in lines})
        a, b = inputs["turns"]
        self.assertEqual(len(a["statement_spans"]), 1)
        self.assertEqual(len(b["statement_spans"]), 2)
        self.assertAlmostEqual(a["statement_spans"][0]["start"], .2)
        self.assertEqual(a["statement_spans"][0]["end"], 1)
        self.assertEqual(b["statement_spans"][0]["start"], 0)
        self.assertAlmostEqual(b["statement_spans"][0]["end"], .2)
        self.assertEqual(self.repo.finish_diarization(job, {s["id"]: "acoustic" for s in lines}), 1)
        self.assertEqual(self.repo.statements(self.owner, "case", "hearing")[1]["speakerId"], speaker["id"])

    def test_stream_result_rejects_uncaptured_gaps_and_rechecks_authorization(self):
        lease = self.repo.acquire(self.owner, "case", "hearing")
        self.capture(lease, keep=False)
        self.capture(lease, "b", 12, keep=False)
        kwargs = {"lease": lease, "epoch": "epoch-1", "result_id": "r",
                      "segments": [{"start": 10, "end": 12.5, "text": "Gap"}]}
        self.expect_error(422, self.repo.save_stream_result, self.owner, "case", "hearing", **kwargs)
        self.assertEqual(self.one("SELECT count(*) AS n FROM voice_stream_results")["n"], 0)
        kwargs["segments"] = [{"start": 10, "end": 11, "text": "Valid"}]
        for session, case, status in [(self.viewer, "case", 403), (self.owner, "secret", 404)]:
            self.expect_error(status, self.repo.save_stream_result, session, case, "hearing", **kwargs)
            self.expect_error(status, self.repo.complete_capture, session, case, "hearing",
                              lease=lease, epoch="epoch-1", turn_id="a")
        self.repo.save_stream_result(self.owner, "case", "hearing", **kwargs)
        self.execute("UPDATE voice_leases SET expires_at=0")
        self.expect_error(409, self.repo.save_stream_result, self.owner, "case", "hearing", **kwargs)
        lease = self.repo.acquire(self.owner, "case", "hearing")
        kwargs["lease"] = lease
        self.execute("UPDATE case_entities SET body=? WHERE case_id='case' AND kind='hearings'",
                     (pack({"id": "hearing", "mode": "live", "recordingPermission": {"by": "other"}}),))
        self.expect_error(403, self.repo.save_stream_result, self.owner, "case", "hearing", **kwargs)
        self.execute("DELETE FROM sessions WHERE user_id='owner'")
        self.expect_error(401, self.repo.complete_capture, self.owner, "case", "hearing",
                          lease=lease, epoch="epoch-1", turn_id="a")

    def test_native_stream_labels_are_epoch_scoped_and_word_recovery_keeps_new_text(self):
        lease = self.repo.acquire(self.owner, "case", "hearing")
        self.capture(lease)
        self.capture(lease, "b", 11)
        def save(rid, start, end, text, epoch="epoch-1", words=None):
            span = {"start": start, "end": end, "text": text, "speaker": "spk_0"}
            if words is not None:
                span["words"] = words
            return self.repo.save_stream_result(self.owner, "case", "hearing", lease=lease,
                                               epoch=epoch, result_id=rid, segments=[span])
        first = save("r1", 10, 10.5, "Pertama.")
        save("r2", 10.5, 11, "Kedua.")
        lines = self.repo.statements(self.owner, "case", "hearing")
        self.assertEqual(lines[0]["speakerId"], lines[1]["speakerId"])
        self.assertTrue(lines[0]["speakerId"].startswith("voice-cluster-"))
        self.assertEqual(self.one("SELECT count(*) AS n FROM voice_diarization_jobs")["n"], 0)
        self.capture(lease, epoch="epoch-2")
        self.capture(lease, "b", 11, "epoch-2")
        words = [{"start": 10, "end": 10.5, "text": "Pertama."},
                 {"start": 10.5, "end": 11, "text": "Kedua."},
                 {"start": 11, "end": 11.5, "text": "New"},
                 {"start": 11.5, "end": 12, "text": "testimony."}]
        receipt = save("replay", 10, 12, "Pertama. Kedua. New testimony.", "epoch-2", words)
        self.assertEqual(receipt["statementId"], first["statementId"])
        self.assertEqual(len(receipt["segments"]), 3)
        self.assertEqual(save("replay", 10, 12, "changed", "epoch-2"), receipt)
        lines = self.repo.statements(self.owner, "case", "hearing")
        self.assertEqual([s["text"] for s in lines], ["Pertama.", "Kedua.", "New testimony."])
        self.assertEqual(lines[2]["t"], 11)
        self.assertNotEqual(lines[2]["speakerId"], lines[0]["speakerId"])
        self.assertEqual(self.one("SELECT count(*) AS n FROM voice_diarization_jobs")["n"], 0)

    def test_replay_previews_match_every_committed_turn_in_both_hearings(self):
        hearing = {"id": "h4", "caseId": "demo", "mode": "live"}
        self.execute(
            "INSERT INTO case_entities(case_id,kind,id,ordinal,body) VALUES('demo','hearings','h4',1,?)",
            (pack(hearing),),
        )
        seed = {"id": "seed", "hearingId": "h3", "t": 453, "speakerId": "dimas", "text": "Previously."}
        self.execute(
            "INSERT INTO case_entities(case_id,kind,id,ordinal,body) VALUES('demo','statements','seed',0,?)",
            (pack(seed),),
        )
        for hid, first_speaker, start, count in (("h3", "pu", 459, 20), ("h4", "hk", 6, 9)):
            for cursor in range(count):
                with self.subTest(hearing=hid, cursor=cursor):
                    version = self.one("SELECT version FROM cases WHERE id='demo'")
                    totals = self.one("SELECT count(*) AS n FROM case_entities WHERE case_id='demo'")
                    current = self.repo.replay_preview(self.guest, "demo", hid, cursor)
                    self.assertEqual(self.repo.replay_preview(self.guest, "demo", hid, 999), current)
                    self.assertEqual(self.one("SELECT version FROM cases WHERE id='demo'"), version)
                    self.assertEqual(
                        self.one("SELECT count(*) AS n FROM case_entities WHERE case_id='demo'"), totals
                    )
                    turn = current["turn"]
                    self.assertEqual((current["cursor"], current["done"]), (cursor, False))
                    self.assertEqual(set(turn), {"id", "speakerId", "t", "text", "durationMs"})
                    self.assertEqual(turn["durationMs"], len(turn["text"].split()) * 140 + 420)
                    if cursor == 0:
                        self.assertEqual((turn["speakerId"], turn["t"]), (first_speaker, start))
                    committed = self.repo.replay(self.guest, "demo", hid, cursor)
                    self.assertEqual(
                        (committed["cursor"], committed["done"]), (cursor + 1, cursor + 1 == count)
                    )
                    if cursor == 0:
                        self.assertEqual(committed["pause"], 1700)
                    last = self.repo.statements(self.guest, "demo", hid)[-1]
                    for field in ("id", "speakerId", "text", "t"):
                        self.assertEqual(turn[field], last[field])
            self.assertEqual(
                self.repo.replay_preview(self.guest, "demo", hid, 0), {"cursor": count, "done": True}
            )

    def test_only_current_members_can_preview_an_active_synthetic_hearing(self):
        get = self.repo.replay_preview
        self.expect_error(404, get, self.repo.session(f"{3:064x}"), "demo", "h3", 0)
        self.expect_error(404, get, self.owner, "demo", "h3", 0)
        self.expect_error(409, get, self.owner, "case", "hearing", 0)
        self.expect_error(404, get, self.guest, "demo", "missing", 0)
        self.expect_error(422, get, self.guest, "demo", "h3", True)
        self.execute("INSERT INTO case_members(case_id,user_id,role) VALUES('demo','viewer','viewer')")
        self.assertEqual(get(self.viewer, "demo", "h3", 0)["turn"]["id"], "replay-h3-0")
        self.expect_error(403, self.repo.replay, self.viewer, "demo", "h3", 0)
        self.execute("DELETE FROM case_members WHERE case_id='demo' AND user_id='viewer'")
        self.expect_error(404, get, self.viewer, "demo", "h3", 0)
        hearing = {"id": "h3", "caseId": "demo", "mode": "recorded"}
        self.execute(
            "UPDATE case_entities SET body=? WHERE case_id='demo' AND kind='hearings'", (pack(hearing),)
        )
        self.expect_error(409, get, self.guest, "demo", "h3", 0)

    def test_private_storage_and_explicit_consent(self):
        self.expect_error(
            422,
            self.repo.add_recording,
            self.owner,
            "case",
            title="Hearing",
            date="2026-11-07",
            filename="hearing.wav",
            mime="audio/wav",
            audio=b"test",
            segments=[],
            duration=1,
            permission=False,
        )
        with self.assertRaises(ValueError):
            self.repo.storage.put("case/../../bad", b"data", "text/plain")
        self.repo.storage.put("a/c/h/file", b"data", "audio/wav")
        self.assertEqual((self.root / "files/a/c/h/file").stat().st_mode & 0o777, 0o600)
        self.assertIsNone(self.repo.storage.url("a/c/h/file"))
        self.repo.storage.remove("a/c/h/file")
        self.assertFalse((self.root / "files/a/c/h/file").exists())
        self.execute(
            "UPDATE case_entities SET body=? WHERE case_id='case' AND kind='hearings'",
            (pack({"id": "hearing", "mode": "live", "recordingPermission": {"by": "someone-else"}}),),
        )
        self.expect_error(403, self.repo.acquire, self.owner, "case", "hearing")


if __name__ == "__main__":
    unittest.main()
