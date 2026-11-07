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


class VoiceRepositoryTest(unittest.TestCase):
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
