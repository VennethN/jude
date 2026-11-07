"""Tenant-scoped recording transactions shared with the web workspace."""

import hashlib
import json
import math
import re
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from datetime import date as date_type
from http.cookies import CookieError, SimpleCookie
from pathlib import Path
from uuid import uuid4

from .config import plan_quotas
from .database import Database, Transaction
from .storage import Storage


def now_ms():
    return time.time_ns() // 1_000_000


def iso_time():
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def pack(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


class VoiceError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def not_found():
    raise VoiceError(404, "not_found", "The requested resource was not found.")


def invalid():
    raise VoiceError(422, "validation", "The recording data is invalid.")


def check_number(value, low, high):
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        or not low <= value <= high
    ):
        invalid()
    return value


@dataclass(frozen=True)
class Session:
    user_id: str
    org_id: str
    guest: bool
    token_hash: str = field(repr=False)


@dataclass(frozen=True)
class DiarizationJob:
    case_id: str
    hearing_id: str
    org_id: str
    lease: str


class CaseEntities:
    """The locked case row serialises writes by both Python and the web service."""

    def __init__(self, tx: Transaction, row: dict):
        self.tx, self.id, self.synthetic = tx, row["id"], bool(row["synthetic"])
        self.record = json.loads(row["record"])
        self.record["archived"] = bool(row["archived"])
        self.changed = False

    def all(self, kind):
        rows = self.tx.all(
            "SELECT body FROM case_entities WHERE case_id=? AND kind=? ORDER BY ordinal", (self.id, kind)
        )
        return [json.loads(r["body"]) for r in rows]

    def get(self, kind, entity_id):
        if kind in ("documents", "hearings") and self.tx.one(
            "SELECT id FROM case_trash WHERE case_id=? AND kind=? AND id=?", (self.id, kind, entity_id)
        ):
            return None
        row = self.tx.one(
            "SELECT body FROM case_entities WHERE case_id=? AND kind=? AND id=?", (self.id, kind, entity_id)
        )
        return json.loads(row["body"]) if row else None

    def need(self, kind, entity_id):
        return self.get(kind, entity_id) or not_found()

    def put(self, kind, value):
        self.tx.execute(
            "INSERT INTO case_entities(case_id,kind,id,ordinal,body) "
            "SELECT ?,?,?,COALESCE(MAX(ordinal)+1,0),? FROM case_entities WHERE case_id=? AND kind=? "
            "ON CONFLICT(case_id,kind,id) DO UPDATE SET body=excluded.body",
            (self.id, kind, value["id"], pack(value), self.id, kind),
        )
        self.changed = True
        if kind == "statements" and not self.synthetic and value.get("phase") == "queued":
            self.tx.execute(
                "INSERT INTO analysis_jobs(case_id,statement_id,available_at) VALUES(?,?,?) "
                "ON CONFLICT(case_id,statement_id) DO NOTHING",
                (self.id, value["id"], now_ms()),
            )

    def flush(self):
        if self.changed:
            self.record["updated"] = iso_time()
            self.tx.execute(
                "UPDATE cases SET record=?,version=version+1,updated_at=? WHERE id=?",
                (pack(self.record), now_ms(), self.id),
            )


def _session(tx, token_hash):
    row = tx.one(
        "SELECT s.user_id,s.org_id,u.guest FROM sessions s JOIN users u ON u.id=s.user_id "
        "JOIN memberships m ON m.user_id=s.user_id AND m.org_id=s.org_id WHERE s.token_hash=? AND s.expires_at>?",
        (token_hash, now_ms()),
    )
    if not row:
        raise VoiceError(401, "unauthenticated", "Sign in to access this workspace.")
    return Session(row["user_id"], row["org_id"], bool(row["guest"]), token_hash)


def _private(session, graph):
    if session.guest or graph.synthetic or graph.record.get("label") != "private":
        raise VoiceError(403, "forbidden", "A private case and a signed-in lawyer are required.")


def _live(session, graph, hearing_id):
    _private(session, graph)
    hearing = graph.need("hearings", hearing_id)
    if hearing["mode"] != "live":
        raise VoiceError(409, "not_live", "The hearing is no longer live.")
    if hearing.get("closed") or hearing.get("recordingPermission", {}).get("by") != session.user_id:
        raise VoiceError(
            403, "recording_permission", "Recording requires the recording lawyer’s permission."
        )
    return hearing


def _quota(tx, org, seconds=0, size=0, *, live=False):
    row = tx.one("SELECT plan_id,plan_status,trial_ends FROM organizations WHERE id=?", (org,))
    plan = row["plan_id"]
    if row["plan_status"] == "trialing" and (row["trial_ends"] or 0) <= now_ms():
        plan = "basic"
    if live and plan == "basic":
        raise VoiceError(402, "feature_not_in_plan", "Live transcription needs an eligible plan.")
    limits = plan_quotas()[plan]
    period = datetime.now(UTC).strftime("%Y-%m")
    count = tx.one(
        "SELECT amount FROM usage_counts WHERE org_id=? AND period=? AND quota='hours'", (org, period)
    )
    used = count["amount"] if count else 0
    if limits["hours"] is not None and used + math.ceil(seconds * 1000) > limits["hours"] * 3_600_000:
        raise VoiceError(402, "quota_exceeded", "Your transcription hours have been used.")
    if size and limits["storage"] is not None:
        stored = tx.one(
            "SELECT COALESCE(SUM(n),0) AS n FROM ("
            "SELECT a.byte_length AS n FROM attachments a JOIN cases c ON c.id=a.case_id "
            "WHERE c.org_id=? AND c.deleted_at IS NULL AND a.kind IN ('original','audio') AND NOT EXISTS (SELECT 1 FROM case_trash x WHERE x.case_id=a.case_id AND x.id=a.entity_id AND x.kind=CASE WHEN a.kind='audio' THEN 'hearings' ELSE 'documents' END) UNION ALL "
            "SELECT t.bytes AS n FROM voice_turns t JOIN cases c ON c.id=t.case_id "
            "WHERE c.org_id=? AND c.deleted_at IS NULL AND t.object_key IS NOT NULL AND NOT EXISTS (SELECT 1 FROM case_trash x WHERE x.case_id=t.case_id AND x.id=t.hearing_id AND x.kind='hearings')) AS retained",
            (org, org),
        )["n"]
        if stored + size > limits["storage"] * 1_000_000_000:
            raise VoiceError(402, "quota_exceeded", "Your storage allowance has been used.")
    return period


def _meter(tx, org, period, seconds):
    tx.execute(
        "INSERT INTO usage_counts(org_id,period,quota,amount) VALUES(?,?,'hours',?) "
        "ON CONFLICT(org_id,period,quota) DO UPDATE SET amount=usage_counts.amount+excluded.amount",
        (org, period, math.floor(seconds * 1000 + 0.5)),
    )


def _anonymous(graph, hearing_id, statement_id, speaker):
    if speaker is not None and (not isinstance(speaker, str) or not speaker or len(speaker) > 180):
        invalid()
    # A missing prediction cannot establish that two statements were spoken by one person.
    key = (speaker or statement_id).encode()
    prefix = "cluster" if speaker else "pending"
    voice_id = f"voice-{prefix}-" + hashlib.sha256(hearing_id.encode() + b"/" + key).hexdigest()[:32]
    if not graph.get("speakers", voice_id):
        graph.put("speakers", {"id": voice_id, "label": "", "role": "unknown", "confirmed": False})
    return voice_id


def _set_speakers(graph, hearing_id, assignments):
    changed = 0
    for statement_id, speaker in assignments.items():
        line = graph.get("statements", statement_id)
        if not line or line["hearingId"] != hearing_id:
            continue
        previous = graph.get("speakers", line["speakerId"]) or {}
        # Legacy single-placeholder voices from the first recorder remain eligible.
        old_placeholder = line["speakerId"] == f"voice-{hearing_id}-1"
        if not line["speakerId"].startswith("voice-pending-") and not old_placeholder:
            continue
        if (
            previous.get("confirmed")
            or previous.get("alias")
            or previous.get("label")
            or previous.get("role", "unknown") != "unknown"
            or not speaker
        ):
            continue
        line["speakerId"] = _anonymous(graph, hearing_id, statement_id, speaker)
        graph.put("statements", line)
        changed += 1
    return changed


def statement_id(hearing_id, turn_id):
    value = f"mic-{hearing_id}-{turn_id}"
    return value if len(value) <= 120 else "mic-" + hashlib.sha256(value.encode()).hexdigest()


def _committed_turn(graph, hearing_id, turn_id):
    row = graph.tx.one(
        "SELECT s.id AS statement_id FROM voice_turns t "
        "LEFT JOIN case_entities s ON s.case_id=t.case_id AND s.kind='statements' AND s.id=? "
        "WHERE t.case_id=? AND t.hearing_id=? AND t.id=?",
        (statement_id(hearing_id, turn_id), graph.id, hearing_id, turn_id),
    )
    return {"id": turn_id, "statementId": row["statement_id"]} if row is not None else None


def _turns(tx, case_id, hearing_id):
    rows = tx.all(
        "SELECT id,start_seconds,bytes,object_key FROM voice_turns WHERE case_id=? AND hearing_id=? ORDER BY start_seconds,id",
        (case_id, hearing_id),
    )
    for row in rows:
        row["statement_id"] = statement_id(hearing_id, row["id"])
    return rows


class Repository:
    def __init__(self, database=None, storage=None):
        self.db = database or Database()
        self.storage = storage or Storage()

    def ready(self):
        with self.db.transaction() as tx:
            tx.one("SELECT 1 AS ok")
        return True

    def session(self, cookie: str | None):
        token = cookie or ""
        if "=" in token:
            try:
                jar = SimpleCookie()
                jar.load(token)
                token = jar["jude_session"].value if "jude_session" in jar else ""
            except (CookieError, ValueError):
                token = ""
        if not re.fullmatch(r"[a-f0-9]{64}", token):
            raise VoiceError(401, "unauthenticated", "Sign in to access this workspace.")
        with self.db.transaction() as tx:
            return _session(tx, hashlib.sha256(token.encode()).hexdigest())

    @contextmanager
    def _case(self, session, case_id, mode="read"):
        write = mode == "write"
        if mode not in ("read", "write"):
            raise ValueError("Unsupported case access mode")
        with self.db.transaction(write=write) as tx:
            current = _session(tx, session.token_hash)
            if current != session:
                raise VoiceError(401, "unauthenticated", "Sign in again to access this workspace.")
            if write and tx.postgres:
                tx.one("SELECT id FROM organizations WHERE id=? FOR UPDATE", (current.org_id,))
            row = tx.one(
                "SELECT c.id,c.record,c.synthetic,c.archived,m.role FROM cases c "
                "JOIN case_members m ON m.case_id=c.id JOIN memberships om ON om.org_id=c.org_id AND om.user_id=m.user_id "
                "WHERE c.id=? AND c.org_id=? AND m.user_id=? AND c.deleted_at IS NULL "
                "AND EXISTS (SELECT 1 FROM workspace_case_members visible WHERE visible.case_id=c.id AND visible.user_id=m.user_id)"
                + (" FOR UPDATE OF c FOR SHARE OF m,om" if write and tx.postgres else ""),
                (case_id, current.org_id, current.user_id),
            )
            if not row:
                not_found()
            if write and row["role"] == "viewer":
                raise VoiceError(403, "forbidden", "Your case role does not permit this action.")
            if write and row["archived"]:
                raise VoiceError(409, "case_archived", "Restore the archived case before editing it.")
            graph = CaseEntities(tx, row)
            yield graph
            if write:
                graph.flush()

    def case(self, session, case_id, mode="read"):
        with self._case(session, case_id, mode) as graph:
            return graph.record

    def check_recording(self, session, case_id, hearing_id=None, *, duration=0.001, size=0):
        with self._case(session, case_id, "write") as graph:
            _private(session, graph)
            hearing = _live(session, graph, hearing_id) if hearing_id else graph.record
            _quota(graph.tx, session.org_id, duration, size, live=bool(hearing_id))
            return hearing

    def _previous_upload(self, graph, org, key):
        if not key:
            return None
        if not isinstance(key, str) or len(key) > 100:
            invalid()
        row = graph.tx.one(
            "SELECT result FROM idempotency WHERE org_id=? AND scope=? AND key=?",
            (org, graph.id + "/voice/upload", key),
        )
        return json.loads(row["result"]) if row else None

    def previous_upload(self, session, case_id, key):
        with self._case(session, case_id, "write") as graph:
            _private(session, graph)
            return self._previous_upload(graph, session.org_id, key)

    def add_recording(
        self,
        session,
        case_id,
        *,
        title,
        date,
        filename,
        mime,
        audio,
        segments,
        duration,
        permission,
        idempotency_key=None,
        language="id",
    ):
        if language not in {"id", "en"}:
            invalid()
        if permission is not True:
            raise VoiceError(
                422, "recording_permission", "Judicial permission in an open hearing is required."
            )
        check_number(duration, 0.001, 1800)
        if not isinstance(title, str) or not title.strip() or len(title) > 200 or not isinstance(date, str):
            invalid()
        try:
            date_type.fromisoformat(date)
        except ValueError:
            invalid()
        if (
            not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date)
            or not filename
            or len(filename) > 255
            or Path(filename).name != filename
        ):
            invalid()
        if (
            not isinstance(audio, bytes)
            or not 0 < len(audio) <= 25 * 1024 * 1024
            or not isinstance(segments, list)
            or not 0 < len(segments) <= 12000
        ):
            invalid()
        for segment in segments:
            if not isinstance(segment, dict) or not {"start", "end", "text"} <= segment.keys():
                invalid()
            start = check_number(segment["start"], 0, duration)
            check_number(segment["end"], start, duration + 0.05)
            if (
                not isinstance(segment["text"], str)
                or not segment["text"].strip()
                or len(segment["text"]) > 30000
            ):
                invalid()
        with self._case(session, case_id, "write") as graph:
            _private(session, graph)
            if prior := self._previous_upload(graph, session.org_id, idempotency_key):
                return prior
            _quota(graph.tx, session.org_id, duration, len(audio))
        hid = str(uuid4())
        key = f"{session.org_id}/{case_id}/{hid}/audio"
        self.storage.put(key, audio, mime)
        registered = False
        try:
            with self._case(session, case_id, "write") as graph:
                _private(session, graph)
                if prior := self._previous_upload(graph, session.org_id, idempotency_key):
                    return prior
                period = _quota(graph.tx, session.org_id, duration, len(audio))
                number = max((h["number"] for h in graph.all("hearings")), default=0) + 1
                title = title.strip()
                hearing = {
                    "id": hid,
                    "caseId": case_id,
                    "number": number,
                    "title": {"id": title, "en": title},
                    "date": date,
                    "mode": "recorded",
                    "duration": duration,
                    "language": language,
                    "audio": f"/api/live/{case_id}/{hid}/audio",
                    "recordingPermission": {
                        "by": session.user_id,
                        "at": iso_time(),
                        "text": "Judicial permission in an open hearing confirmed by the recording lawyer.",
                    },
                }
                graph.put("hearings", hearing)
                for segment in segments:
                    sid = str(uuid4())
                    voice = _anonymous(graph, hid, sid, segment.get("speaker"))
                    graph.put(
                        "statements",
                        {
                            "id": sid,
                            "hearingId": hid,
                            "speakerId": voice,
                            "t": segment["start"],
                            "text": segment["text"].strip(),
                            "phase": "queued",
                        },
                    )
                graph.tx.execute(
                    "INSERT INTO attachments(case_id,entity_id,kind,object_key,file_name,mime,byte_length) VALUES(?,?,'audio',?,?,?,?)",
                    (case_id, hid, key, filename, mime, len(audio)),
                )
                _meter(graph.tx, session.org_id, period, duration)
                if idempotency_key:
                    graph.tx.execute(
                        "INSERT INTO idempotency(org_id,scope,key,result,created_at) VALUES(?,?,?,?,?)",
                        (
                            session.org_id,
                            case_id + "/voice/upload",
                            idempotency_key,
                            pack(hearing),
                            now_ms(),
                        ),
                    )
            registered = True
            return hearing
        finally:
            if not registered:
                self.storage.remove(key)

    def acquire(self, session, case_id, hearing_id):
        with self._case(session, case_id, "write") as graph:
            _live(session, graph, hearing_id)
            _quota(graph.tx, session.org_id, 0.001, live=True)
            now, lease = now_ms(), str(uuid4())
            row = graph.tx.one(
                "INSERT INTO voice_leases(case_id,hearing_id,holder,expires_at) VALUES(?,?,?,?) "
                "ON CONFLICT(case_id,hearing_id) DO UPDATE SET holder=excluded.holder,expires_at=excluded.expires_at "
                "WHERE voice_leases.expires_at<=? RETURNING holder",
                (case_id, hearing_id, lease, now + 30_000, now),
            )
            if not row:
                raise VoiceError(409, "recorder_in_use", "Another recorder is connected.")
            return lease

    def renew(self, session, case_id, hearing_id, lease):
        with self._case(session, case_id, "write") as graph:
            _live(session, graph, hearing_id)
            now = now_ms()
            row = graph.tx.one(
                "UPDATE voice_leases SET expires_at=? WHERE case_id=? AND hearing_id=? AND holder=? AND expires_at>? RETURNING holder",
                (now + 30_000, case_id, hearing_id, lease, now),
            )
            if not row:
                raise VoiceError(409, "lease_expired", "The recording session has expired.")

    def release(self, case_id, hearing_id, lease):
        with self.db.transaction(True) as tx:
            tx.execute(
                "DELETE FROM voice_leases WHERE case_id=? AND hearing_id=? AND holder=?",
                (case_id, hearing_id, lease),
            )

    def committed_turn(self, session, case_id, hearing_id, turn_id):
        with self._case(session, case_id, "write") as graph:
            _live(session, graph, hearing_id)
            return _committed_turn(graph, hearing_id, turn_id)

    def _require_lease(self, graph, hearing_id, lease):
        valid = graph.tx.one(
            "SELECT holder FROM voice_leases WHERE case_id=? AND hearing_id=? AND holder=? AND expires_at>?",
            (graph.id, hearing_id, lease, now_ms()),
        )
        if not valid:
            raise VoiceError(409, "lease_expired", "The recording session has expired.")

    def store_turn(
        self, session, case_id, hearing_id, *, lease, turn_id, start, pcm, keep, text, speaker=None
    ):
        if not isinstance(turn_id, str) or not re.fullmatch(r"[\w-]{1,90}", turn_id, flags=re.ASCII):
            invalid()
        if (
            not isinstance(keep, bool)
            or not isinstance(text, str)
            or len(text) > 30_000
            or not 0 < len(pcm) <= 1_500_000
            or len(pcm) % 2
        ):
            invalid()
        check_number(start, 0, 604800)
        sid = statement_id(hearing_id, turn_id)
        result = {"id": turn_id, "statementId": sid if text.strip() else None}
        size = len(pcm) if keep else 0
        duration = len(pcm) / 48_000
        with self._case(session, case_id, "write") as graph:
            _live(session, graph, hearing_id)
            self._require_lease(graph, hearing_id, lease)
            prior = _committed_turn(graph, hearing_id, turn_id)
            if prior is not None:
                return prior
            _quota(graph.tx, session.org_id, duration, size, live=True)
        key = f"{session.org_id}/{case_id}/{hearing_id}/{uuid4()}.pcm" if keep else None
        if key:
            self.storage.put(key, pcm, "application/octet-stream")
        registered = False
        try:
            with self._case(session, case_id, "write") as graph:
                hearing = _live(session, graph, hearing_id)
                self._require_lease(graph, hearing_id, lease)
                existing = _committed_turn(graph, hearing_id, turn_id)
                if existing is not None:
                    return existing
                period = _quota(graph.tx, session.org_id, duration, size, live=True)
                graph.tx.execute(
                    "INSERT INTO voice_turns(case_id,hearing_id,id,start_seconds,bytes,object_key) VALUES(?,?,?,?,?,?)",
                    (case_id, hearing_id, turn_id, start, len(pcm), key),
                )
                if text.strip():
                    voice = _anonymous(graph, hearing_id, sid, speaker)
                    graph.put(
                        "statements",
                        {
                            "id": sid,
                            "hearingId": hearing_id,
                            "speakerId": voice,
                            "t": start,
                            "text": text.strip(),
                            "phase": "queued",
                        },
                    )
                if key:
                    hearing["audio"] = f"/api/live/{case_id}/{hearing_id}/audio"
                    graph.put("hearings", hearing)
                    graph.tx.execute(
                        "INSERT INTO voice_diarization_jobs(case_id,hearing_id,available_at) VALUES(?,?,?) "
                        "ON CONFLICT(case_id,hearing_id) DO UPDATE SET available_at=excluded.available_at,attempts=0",
                        (case_id, hearing_id, now_ms()),
                    )
                _meter(graph.tx, session.org_id, period, duration)
            registered = True
            return result
        finally:
            if key and not registered:
                self.storage.remove(key)

    def voice_turns(self, session, case_id, hearing_id):
        with self._case(session, case_id) as graph:
            graph.need("hearings", hearing_id)
            return _turns(graph.tx, case_id, hearing_id)

    def statements(self, session, case_id, hearing_id):
        with self._case(session, case_id) as graph:
            graph.need("hearings", hearing_id)
            return [line for line in graph.all("statements") if line["hearingId"] == hearing_id]

    def audio(self, session, case_id, hearing_id):
        with self._case(session, case_id) as graph:
            if not graph.need("hearings", hearing_id).get("audio"):
                not_found()
            item = graph.tx.one(
                "SELECT object_key,file_name AS filename,mime,byte_length FROM attachments "
                "WHERE case_id=? AND entity_id=? AND kind='audio'",
                (case_id, hearing_id),
            )
            if item:
                return item
            turns = [t for t in _turns(graph.tx, case_id, hearing_id) if t["object_key"]]
            if not turns:
                not_found()
            return {"turns": turns}

    def replay_preview(self, session, case_id, hearing_id, cursor):
        from .replay import preview

        with self._case(session, case_id) as graph:
            return preview(graph, hearing_id, cursor)

    def replay(self, session, case_id, hearing_id, cursor):
        from .replay import advance

        with self._case(session, case_id, "write") as graph:
            return advance(graph, hearing_id, cursor)

    def finalize_speakers(self, session, case_id, hearing_id, assignments):
        with self._case(session, case_id, "write") as graph:
            _private(session, graph)
            hearing = graph.need("hearings", hearing_id)
            if hearing.get("closed") or hearing.get("recordingPermission", {}).get("by") != session.user_id:
                raise VoiceError(
                    403, "recording_permission", "Only the recording lawyer can finalize the speakers."
                )
            return _set_speakers(graph, hearing_id, assignments)

    def claim_diarization(self):
        now = now_ms()
        with self.db.transaction(True) as tx:
            rows = tx.all(
                "SELECT j.case_id,j.hearing_id,c.org_id,e.body FROM voice_diarization_jobs j JOIN cases c ON c.id=j.case_id "
                "JOIN case_entities e ON e.case_id=j.case_id AND e.kind='hearings' AND e.id=j.hearing_id "
                "WHERE c.archived=0 AND c.synthetic=0 AND c.deleted_at IS NULL AND j.available_at<=? AND j.lease_until<=? AND NOT EXISTS (SELECT 1 FROM case_trash x WHERE x.case_id=j.case_id AND x.id=j.hearing_id AND x.kind='hearings') "
                "ORDER BY j.available_at,j.hearing_id LIMIT 20"
                + (" FOR UPDATE OF j SKIP LOCKED" if tx.postgres else ""),
                (now, now),
            )
            for row in rows:
                args = (row["case_id"], row["hearing_id"])
                hearing = json.loads(row["body"])
                if not hearing.get("recordingPermission", {}).get("by") or hearing.get("closed"):
                    tx.execute("DELETE FROM voice_diarization_jobs WHERE case_id=? AND hearing_id=?", args)
                    continue
                if hearing["mode"] != "recorded":
                    tx.execute(
                        "UPDATE voice_diarization_jobs SET available_at=? WHERE case_id=? AND hearing_id=?",
                        (now + 15_000, *args),
                    )
                    continue
                lease = str(uuid4())
                tx.execute(
                    "UPDATE voice_diarization_jobs SET lease=?,lease_until=?,attempts=attempts+1 WHERE case_id=? AND hearing_id=?",
                    (lease, now + 900_000, *args),
                )
                return DiarizationJob(*args, row["org_id"], lease)
        return None

    @contextmanager
    def _job(self, job):
        with self.db.transaction(True) as tx:
            row = tx.one(
                "SELECT c.id,c.record,c.synthetic,c.archived FROM cases c WHERE id=? AND org_id=? AND synthetic=0 "
                "AND deleted_at IS NULL AND archived=0" + (" FOR UPDATE" if tx.postgres else ""),
                (job.case_id, job.org_id),
            )
            if not row:
                not_found()
            graph = CaseEntities(tx, row)
            lease = tx.one(
                "SELECT attempts FROM voice_diarization_jobs WHERE case_id=? AND hearing_id=? AND lease=? AND lease_until>?"
                + (" FOR UPDATE" if tx.postgres else ""),
                (job.case_id, job.hearing_id, job.lease, now_ms()),
            )
            if not lease:
                raise VoiceError(409, "lease_expired", "The diarization job has expired.")
            hearing = graph.need("hearings", job.hearing_id)
            if (
                hearing.get("closed")
                or hearing["mode"] != "recorded"
                or not hearing.get("recordingPermission", {}).get("by")
            ):
                raise VoiceError(409, "recording_permission", "This hearing is ineligible for diarization.")
            yield graph, lease["attempts"]
            graph.flush()

    def diarization_inputs(self, job):
        with self._job(job) as (graph, _):
            turns = [r for r in _turns(graph.tx, job.case_id, job.hearing_id) if r["object_key"]]
            retained = {r["statement_id"] for r in turns}
            return {
                "turns": turns,
                "statements": [
                    r
                    for r in graph.all("statements")
                    if r["id"] in retained and r["hearingId"] == job.hearing_id
                ],
            }

    def renew_diarization(self, job):
        with self._job(job) as (graph, _):
            graph.tx.execute(
                "UPDATE voice_diarization_jobs SET lease_until=? WHERE case_id=? AND hearing_id=? AND lease=?",
                (now_ms() + 900_000, job.case_id, job.hearing_id, job.lease),
            )

    def finish_diarization(self, job, assignments):
        with self._job(job) as (graph, _):
            retained = {
                r["statement_id"] for r in _turns(graph.tx, job.case_id, job.hearing_id) if r["object_key"]
            }
            count = _set_speakers(
                graph,
                job.hearing_id,
                {sid: speaker for sid, speaker in assignments.items() if sid in retained},
            )
            graph.tx.execute(
                "DELETE FROM voice_diarization_jobs WHERE case_id=? AND hearing_id=? AND lease=?",
                (job.case_id, job.hearing_id, job.lease),
            )
            return count

    def retry_diarization(self, job):
        with self._job(job) as (graph, attempts):
            if attempts >= 4:
                graph.tx.execute(
                    "DELETE FROM voice_diarization_jobs WHERE case_id=? AND hearing_id=? AND lease=?",
                    (job.case_id, job.hearing_id, job.lease),
                )
            else:
                graph.tx.execute(
                    "UPDATE voice_diarization_jobs SET available_at=?,lease=NULL,lease_until=0 "
                    "WHERE case_id=? AND hearing_id=? AND lease=?",
                    (now_ms() + 2000 * 2**attempts, job.case_id, job.hearing_id, job.lease),
                )
