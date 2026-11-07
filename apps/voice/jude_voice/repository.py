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

from .config import guest_practice, plan_quotas
from .database import Database, Transaction
from .storage import Storage
from .voiceprints import cosine, normalized

PCM_BYTES_PER_SECOND = 48_000


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
        self.owned_demo = row.get("role") == "owner" and row.get("demo_id") == self.id
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


def _private(session, graph, *, guest_live=False):
    allowed = not session.guest or (guest_live and graph.owned_demo)
    if not allowed or graph.synthetic or graph.record.get("label") != "private":
        raise VoiceError(403, "forbidden", "A private case and a signed-in lawyer are required.")


def _live(session, graph, hearing_id):
    _private(session, graph, guest_live=True)
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


def _guest_live_usage(tx, session, byte_count, *, consume=False):
    if not session.guest:
        return
    # Every caller holds the organisation's write lock. Admission and the turn receipt
    # commit together, including when different hearings record for the same guest.
    settings = guest_practice()
    counter = (session.org_id, "lifetime", settings["usageKey"])
    row = tx.one("SELECT amount FROM usage_counts WHERE org_id=? AND period=? AND quota=?", counter)
    if (row["amount"] if row else 0) + byte_count > settings["liveMinutes"] * 60 * PCM_BYTES_PER_SECOND:
        raise VoiceError(402, "guest_live_limit", "The live demo recording allowance has been used.")
    if consume:
        tx.execute(
            "INSERT INTO usage_counts(org_id,period,quota,amount) VALUES(?,?,?,?) "
            "ON CONFLICT(org_id,period,quota) DO UPDATE SET amount=usage_counts.amount+excluded.amount",
            (*counter, byte_count),
        )


def anonymous_id(hearing_id, statement_id, speaker):
    if speaker is not None and (not isinstance(speaker, str) or not speaker or len(speaker) > 512):
        invalid()
    # A missing prediction cannot establish that two statements were spoken by one person.
    key = (speaker or statement_id).encode()
    prefix = "cluster" if speaker else "pending"
    return f"voice-{prefix}-" + hashlib.sha256(hearing_id.encode() + b"/" + key).hexdigest()[:32]


def _anonymous(graph, hearing_id, statement_id, speaker):
    voice_id = anonymous_id(hearing_id, statement_id, speaker)
    if not graph.get("speakers", voice_id):
        graph.put("speakers", {"id": voice_id, "label": "", "role": "unknown", "confirmed": False})
    source = graph.need("speakers", voice_id)
    # Explicit corrections to the original voice override an automatic binding.
    if source.get("confirmed") or source.get("label") or source.get("alias") or source.get("role", "unknown") != "unknown":
        return voice_id
    binding = graph.tx.one(
        "SELECT speaker_id FROM voiceprint_bindings WHERE case_id=? AND hearing_id=? AND source_speaker=?",
        (graph.id, hearing_id, voice_id),
    )
    if binding and graph.get("speakers", binding["speaker_id"]):
        return binding["speaker_id"]
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


def _segment_prefix(canonical_id):
    # Separate namespace prevents a client turn ID from colliding with a suffix.
    # Archive-compatible IDs contain only letters, digits, underscores and hyphens.
    return "micseg-" + hashlib.sha256(canonical_id.encode()).hexdigest()


def _turn_state(graph, hearing_id, turn_id):
    row = graph.tx.one(
        "SELECT t.start_seconds,t.bytes,p.fingerprint,s.id AS statement_id FROM voice_turns t "
        "LEFT JOIN voice_pending_transcripts p ON p.case_id=t.case_id AND p.hearing_id=t.hearing_id AND p.turn_id=t.id "
        "LEFT JOIN case_entities s ON s.case_id=t.case_id AND s.kind='statements' AND s.id=? "
        "WHERE t.case_id=? AND t.hearing_id=? AND t.id=?",
        (statement_id(hearing_id, turn_id), graph.id, hearing_id, turn_id),
    )
    if row:
        row["duration_seconds"] = row["bytes"] / 48_000
    return row


def _receipt(row, turn_id, fingerprint=None):
    if row and row["fingerprint"] is None:
        return {"id": turn_id, "statementId": row["statement_id"]}
    if row and fingerprint is not None and row["fingerprint"] != fingerprint:
        raise VoiceError(409, "turn_conflict", "This turn ID belongs to different audio.")
    return None


def _turns(tx, case_id, hearing_id):
    rows = tx.all(
        "SELECT id,start_seconds,bytes,object_key FROM voice_turns WHERE case_id=? AND hearing_id=? ORDER BY start_seconds,id",
        (case_id, hearing_id),
    )
    for row in rows:
        row["statement_id"] = statement_id(hearing_id, row["id"])
    return rows


def _retained_statements(graph, hearing_id, turns):
    """Map canonical and segmented statements to their original retained PCM."""
    parents = {turn["statement_id"]: turn for turn in turns}
    segment_parents = {_segment_prefix(turn["statement_id"]): turn for turn in turns}
    for turn in turns:
        turn["statement_spans"] = []
    by_turn = {turn["id"]: turn for turn in turns}
    stream_ids = set()
    for span in graph.tx.all(
        "SELECT turn_id,statement_id,start_seconds,end_seconds FROM voice_statement_spans "
        "WHERE case_id=? AND hearing_id=?", (graph.id, hearing_id),
    ):
        if turn := by_turn.get(span["turn_id"]):
            turn["statement_spans"].append({
                "statement_id": span["statement_id"],
                "start": span["start_seconds"], "end": span["end_seconds"],
            })
            stream_ids.add(span["statement_id"])
    statements = []
    for line in graph.all("statements"):
        if line["hearingId"] != hearing_id:
            continue
        if line["id"] in stream_ids:
            statements.append(line)
            continue
        turn = parents.get(line["id"]) or segment_parents.get(re.sub(r"-[1-9][0-9]*$", "", line["id"]))
        if turn is None:
            continue
        span = line.get("voiceSpan", {"start": 0, "end": turn["bytes"] / 48_000})
        turn["statement_spans"].append({"statement_id": line["id"], **span})
        statements.append(line)
    for turn in turns:
        turn["statement_spans"].sort(key=lambda span: (span["start"], span["statement_id"]))
    return statements


def _live_segments(segments, duration):
    if not isinstance(segments, list) or len(segments) > 1000:
        invalid()
    result, total, previous = [], 0, 0
    for segment in segments:
        if not isinstance(segment, dict):
            invalid()
        start = check_number(segment.get("start"), 0, duration)
        end = check_number(segment.get("end"), 0, duration)
        words = segment.get("text")
        if start >= end or start < previous or not isinstance(words, str) or not words.strip():
            invalid()
        total += len(words)
        if total > 30_000:
            invalid()
        speaker = segment.get("speaker")
        if speaker is not None and (not isinstance(speaker, str) or not speaker.strip() or len(speaker) > 180):
            invalid()
        item = {"start": start, "end": end, "text": words.strip(), "speaker": speaker}
        if "words" in segment:
            tokens = segment["words"]
            if not isinstance(tokens, list) or not tokens or len(tokens) > 5000:
                invalid()
            previous_end, token_size = start, 0
            for token in tokens:
                if not isinstance(token, dict):
                    invalid()
                ws = check_number(token.get("start"), start, end)
                we = check_number(token.get("end"), start, end)
                if ws >= we or ws < previous_end or not isinstance(token.get("text"), str) or not token["text"].strip():
                    invalid()
                token_size += len(token["text"])
                if token_size > 30_000:
                    invalid()
                previous_end = we
            item["words"] = tokens
        result.append(item)
        previous = start
    return result


def _stream_key(value):
    if not isinstance(value, str) or not value.strip() or len(value) > 180:
        invalid()
    return value


def _replay_parts(span, existing):
    old = sorted((line for line in existing if line["streamSpan"]["start"] < span["end"]
                  and line["streamSpan"]["end"] > span["start"]),
                 key=lambda line: line["streamSpan"]["start"])
    if not old:
        return [span], []

    def covered(start, end):
        for line in old:
            interval = line["streamSpan"]
            if interval["start"] > start + 1e-6:
                break
            start = max(start, interval["end"])
        return start + 1e-6 >= end

    if covered(span["start"], span["end"]):
        return [], old
    if not span.get("words"):
        raise VoiceError(409, "stream_result_overlap", "Word timestamps are required to recover overlapping speech.")
    parts, pending = [], []

    def flush():
        if pending:
            parts.append({**span, "start": pending[0]["start"], "end": pending[-1]["end"],
                          "text": " ".join(word["text"].strip() for word in pending)})
            pending.clear()

    for word in span["words"]:
        if covered(word["start"], word["end"]):
            flush()
        elif any(line["streamSpan"]["start"] < word["end"] and line["streamSpan"]["end"] > word["start"] for line in old):
            raise VoiceError(409, "stream_result_overlap", "A recovered word crosses finalized speech.")
        else:
            pending.append(word)
    flush()
    return parts, old


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
                "SELECT c.id,c.record,c.synthetic,c.archived,m.role,o.demo_id FROM cases c JOIN organizations o ON o.id=c.org_id "
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
            if hearing_id:
                hearing = _live(session, graph, hearing_id)
                _guest_live_usage(graph.tx, session, 2)  # Preflight requires room for one PCM16 sample.
            else:
                _private(session, graph)
                hearing = graph.record
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
            return _receipt(_turn_state(graph, hearing_id, turn_id), turn_id)

    def _require_lease(self, graph, hearing_id, lease):
        valid = graph.tx.one(
            "SELECT holder FROM voice_leases WHERE case_id=? AND hearing_id=? AND holder=? AND expires_at>?",
            (graph.id, hearing_id, lease, now_ms()),
        )
        if not valid:
            raise VoiceError(409, "lease_expired", "The recording session has expired.")

    def begin_turn(self, session, case_id, hearing_id, *, lease, turn_id, start, pcm, keep):
        """Persist authorised capture and meter the original samples before model work begins."""
        if not isinstance(turn_id, str) or not re.fullmatch(r"[\w-]{1,90}", turn_id, flags=re.ASCII):
            invalid()
        if not isinstance(keep, bool) or not isinstance(pcm, bytes) or not 0 < len(pcm) <= 1_500_000 or len(pcm) % 2:
            invalid()
        check_number(start, 0, 604800)
        size = len(pcm) if keep else 0
        duration = len(pcm) / PCM_BYTES_PER_SECOND
        digest = hashlib.sha256()
        digest.update(f"{float(start).hex()}:{int(keep)}:".encode())
        digest.update(pcm)
        fingerprint = digest.hexdigest()
        with self._case(session, case_id, "write") as graph:
            _live(session, graph, hearing_id)
            self._require_lease(graph, hearing_id, lease)
            if session.guest and keep:
                raise VoiceError(403, "guest_transcript_only", "The guest demo saves transcripts only.")
            prior = _turn_state(graph, hearing_id, turn_id)
            if prior is not None:
                return _receipt(prior, turn_id, fingerprint)
            _guest_live_usage(graph.tx, session, len(pcm))
            _quota(graph.tx, session.org_id, duration, size, live=True)
        key = f"{session.org_id}/{case_id}/{hearing_id}/{uuid4()}.pcm" if keep else None
        if key:
            self.storage.put(key, pcm, "application/octet-stream")
        registered = False
        try:
            with self._case(session, case_id, "write") as graph:
                hearing = _live(session, graph, hearing_id)
                self._require_lease(graph, hearing_id, lease)
                existing = _turn_state(graph, hearing_id, turn_id)
                if existing is not None:
                    return _receipt(existing, turn_id, fingerprint)
                period = _quota(graph.tx, session.org_id, duration, size, live=True)
                _guest_live_usage(graph.tx, session, len(pcm), consume=True)
                graph.tx.execute(
                    "INSERT INTO voice_turns(case_id,hearing_id,id,start_seconds,bytes,object_key) VALUES(?,?,?,?,?,?)",
                    (case_id, hearing_id, turn_id, start, len(pcm), key),
                )
                graph.tx.execute(
                    "INSERT INTO voice_pending_transcripts(case_id,hearing_id,turn_id,fingerprint) VALUES(?,?,?,?)",
                    (case_id, hearing_id, turn_id, fingerprint),
                )
                hearing["duration"] = max(hearing.get("duration") or 0, start + duration)
                if key:
                    hearing["audio"] = f"/api/live/{case_id}/{hearing_id}/audio"
                graph.put("hearings", hearing)
                _meter(graph.tx, session.org_id, period, duration)
            registered = True
            return None
        finally:
            if key and not registered:
                self.storage.remove(key)

    def finish_turn(self, session, case_id, hearing_id, *, lease, turn_id, text, speaker=None, segments=None):
        """Commit trusted provider segments in seconds relative to the captured PCM.

        Callers must not pass client-supplied segments. Provider speaker labels (and
        the legacy speaker argument) do not establish identity across stream calls.
        """
        if not isinstance(text, str) or len(text) > 30_000:
            invalid()
        with self._case(session, case_id, "write") as graph:
            _live(session, graph, hearing_id)
            self._require_lease(graph, hearing_id, lease)
            captured = _turn_state(graph, hearing_id, turn_id)
            if not captured:
                not_found()
            done = _receipt(captured, turn_id)
            if done is not None:
                return done
            spans = _live_segments(segments, captured["duration_seconds"]) if segments is not None else (
                [{"start": 0, "end": captured["duration_seconds"], "text": text.strip()}] if text.strip() else []
            )
            sid = statement_id(hearing_id, turn_id) if spans else None
            for index, span in enumerate(spans):
                segment_id = sid if index == 0 else f"{_segment_prefix(sid)}-{index + 1}"
                graph.put("statements", {
                    "id": segment_id, "hearingId": hearing_id,
                    "speakerId": _anonymous(graph, hearing_id, segment_id, None),
                    "t": captured["start_seconds"] + span["start"],
                    "voiceSpan": {"start": span["start"], "end": span["end"]},
                    "text": span["text"], "phase": "queued",
                })
            graph.tx.execute(
                "DELETE FROM voice_pending_transcripts WHERE case_id=? AND hearing_id=? AND turn_id=?",
                (case_id, hearing_id, turn_id),
            )
            graph.tx.execute(
                "INSERT INTO voice_diarization_jobs(case_id,hearing_id,available_at) "
                "SELECT case_id,hearing_id,? FROM voice_turns WHERE case_id=? AND hearing_id=? AND id=? AND object_key IS NOT NULL "
                "ON CONFLICT(case_id,hearing_id) DO UPDATE SET available_at=excluded.available_at,attempts=0",
                (now_ms(), case_id, hearing_id, turn_id),
            )
            return {"id": turn_id, "statementId": sid}

    def match_voiceprint(self, session, case_id, hearing_id, *, source, model, embedding):
        """Match only this case's voices; explicit human labels remain authoritative."""
        vector = normalized(embedding)
        _stream_key(model)
        with self._case(session, case_id, "write") as graph:
            _private(session, graph)
            hearing = graph.need("hearings", hearing_id)
            if hearing.get("closed") or hearing.get("recordingPermission", {}).get("by") != session.user_id:
                raise VoiceError(403, "recording_permission", "Only the recording lawyer may match this audio.")
            speaker = graph.need("speakers", source)
            lines = [line for line in graph.all("statements")
                     if line["hearingId"] == hearing_id and line["speakerId"] == source]
            prior = graph.tx.one(
                "SELECT speaker_id FROM voiceprint_bindings WHERE case_id=? AND hearing_id=? AND source_speaker=?",
                (case_id, hearing_id, source),
            )
            if prior:
                return prior["speaker_id"]
            if not lines:
                return None
            profiles = graph.tx.all("SELECT * FROM voiceprints WHERE case_id=? AND model=?", (case_id, model))
            fixed = (speaker.get("confirmed") or speaker.get("label") or speaker.get("alias")
                     or speaker.get("role", "unknown") != "unknown")
            target = speaker.get("alias") or source
            ranked = {}
            for profile in profiles:
                candidate = graph.get("speakers", profile["speaker_id"])
                old = json.loads(profile["embedding"])
                if not candidate or len(old) != len(vector):
                    continue
                key = candidate.get("alias") or candidate["id"]
                ranked[key] = max(ranked.get(key, -1), cosine(vector, normalized(old)))
            scores = sorted(ranked.items(), key=lambda item: item[1], reverse=True)
            if not fixed and scores and scores[0][1] >= 0.55:
                # A near tie is not evidence that two people are the same person.
                if len(scores) > 1 and scores[0][1] - scores[1][1] < 0.05:
                    return None
                target = scores[0][0]
            existing = next((profile for profile in profiles if profile["speaker_id"] == target), None)
            if existing:
                old = json.loads(existing["embedding"])
                if len(old) != len(vector):
                    return None
                count = min(existing["samples"], 49)
                vector = normalized([a * count + b for a, b in zip(old, vector, strict=True)])
                graph.tx.execute("UPDATE voiceprints SET embedding=?,samples=? WHERE case_id=? AND speaker_id=? AND model=?",
                                 (pack(vector), count + 1, case_id, target, model))
            elif len(profiles) < 200:
                graph.tx.execute("INSERT INTO voiceprints(case_id,speaker_id,model,embedding) VALUES(?,?,?,?)",
                                 (case_id, target, model, pack(vector)))
            else:
                return None
            graph.tx.execute(
                "INSERT INTO voiceprint_bindings(case_id,hearing_id,source_speaker,speaker_id) VALUES(?,?,?,?)",
                (case_id, hearing_id, source, target),
            )
            if not fixed and source != target:
                for line in lines:
                    line["speakerId"] = target
                    graph.put("statements", line)
            return target

    def begin_capture(self, session, case_id, hearing_id, *, lease, epoch, turn_id, start, pcm, keep):
        """Persist PCM before streaming; reconnects may attach it to another epoch."""
        _stream_key(epoch)
        receipt = self.begin_turn(
            session, case_id, hearing_id, lease=lease, turn_id=turn_id, start=start, pcm=pcm, keep=keep,
        )
        digest = hashlib.sha256(f"{float(start).hex()}:{int(keep)}:".encode() + pcm).hexdigest()
        with self._case(session, case_id, "write") as graph:
            _live(session, graph, hearing_id)
            self._require_lease(graph, hearing_id, lease)
            previous = graph.tx.one(
                "SELECT fingerprint FROM voice_stream_captures WHERE case_id=? AND hearing_id=? AND turn_id=?",
                (case_id, hearing_id, turn_id),
            )
            if previous and previous["fingerprint"] != digest:
                raise VoiceError(409, "turn_conflict", "This capture ID belongs to different audio.")
            graph.tx.execute(
                "INSERT INTO voice_stream_captures(case_id,hearing_id,turn_id,epoch,fingerprint) VALUES(?,?,?,?,?) "
                "ON CONFLICT(case_id,hearing_id,epoch,turn_id) DO NOTHING",
                (case_id, hearing_id, turn_id, epoch, digest),
            )
        return receipt

    def capture_resume_offset(self, session, case_id, hearing_id, *, lease, turn_id):
        """Replay only audio after the last durably finalized word in this capture."""
        with self._case(session, case_id, "write") as graph:
            _live(session, graph, hearing_id)
            self._require_lease(graph, hearing_id, lease)
            captured = _turn_state(graph, hearing_id, turn_id)
            if not captured:
                not_found()
            row = graph.tx.one(
                "SELECT MAX(end_seconds) AS endpoint FROM voice_statement_spans "
                "WHERE case_id=? AND hearing_id=? AND turn_id=?",
                (case_id, hearing_id, turn_id),
            )
            return min(captured["duration_seconds"], float(row["endpoint"] or 0))

    def complete_capture(self, session, case_id, hearing_id, *, lease, epoch, turn_id):
        """Acknowledge a capture after ingest's final-result watermark passes it."""
        _stream_key(epoch)
        with self._case(session, case_id, "write") as graph:
            _live(session, graph, hearing_id)
            self._require_lease(graph, hearing_id, lease)
            if not graph.tx.one(
                "SELECT turn_id FROM voice_stream_captures WHERE case_id=? AND hearing_id=? AND epoch=? AND turn_id=?",
                (case_id, hearing_id, epoch, turn_id),
            ):
                not_found()
            graph.tx.execute(
                "DELETE FROM voice_pending_transcripts WHERE case_id=? AND hearing_id=? AND turn_id=?",
                (case_id, hearing_id, turn_id),
            )
            return {"id": turn_id, "statementId": None}

    def save_stream_result(self, session, case_id, hearing_id, *, lease, epoch, result_id, segments):
        """Atomically save a final trusted result in absolute hearing seconds.

        Stream epoch/result IDs deduplicate provider retries. Already-covered audio
        reuses statements across epochs; partial overlaps require absolute word
        timestamps. AWS labels identify speakers within this epoch only. Capture
        receipts are separate and must follow ingest's final-result watermark.
        """
        _stream_key(epoch)
        _stream_key(result_id)
        with self._case(session, case_id, "write") as graph:
            _live(session, graph, hearing_id)
            self._require_lease(graph, hearing_id, lease)
            prior = graph.tx.one(
                "SELECT receipt FROM voice_stream_results WHERE case_id=? AND hearing_id=? AND epoch=? AND result_id=?",
                (case_id, hearing_id, epoch, result_id),
            )
            if prior:
                return json.loads(prior["receipt"])
            captures = graph.tx.all(
                "SELECT t.id,t.start_seconds,t.bytes,t.object_key FROM voice_turns t "
                "JOIN voice_stream_captures c ON c.case_id=t.case_id AND c.hearing_id=t.hearing_id AND c.turn_id=t.id "
                "WHERE c.case_id=? AND c.hearing_id=? AND c.epoch=? ORDER BY t.start_seconds,t.id",
                (case_id, hearing_id, epoch),
            )
            if not captures:
                not_found()
            spans = _live_segments(segments, max(t["start_seconds"] + t["bytes"] / 48_000 for t in captures))
            existing = [line for line in graph.all("statements")
                        if line["hearingId"] == hearing_id and "streamSpan" in line]
            receipt_segments, retained = {}, False
            recovered = []
            for span in spans:
                parts, reused = _replay_parts(span, existing)
                recovered.extend(parts)
                for line in reused:
                    receipt_segments[line["id"]] = {"statementId": line["id"], **line["streamSpan"]}
            base = "stream-" + hashlib.sha256(pack([hearing_id, epoch, result_id]).encode()).hexdigest()
            # Validate even fully replayed intervals against this epoch's captures.
            for span in spans:
                covered = span["start"]
                for capture in captures:
                    start = max(span["start"], capture["start_seconds"])
                    end = min(span["end"], capture["start_seconds"] + capture["bytes"] / 48_000)
                    if start >= end:
                        continue
                    if start > covered + 1e-6:
                        invalid()
                    covered = max(covered, end)
                if covered + 1e-6 < span["end"]:
                    invalid()
            for index, span in enumerate(recovered):
                sid = base if index == 0 else f"{base}-segment-{index + 1}"
                absolute = {"start": span["start"], "end": span["end"]}
                graph.put("statements", {
                    "id": sid, "hearingId": hearing_id,
                    "speakerId": _anonymous(graph, hearing_id, sid,
                                            f"transcribe:{epoch}:{span['speaker']}" if span.get("speaker") else None),
                    "t": span["start"], "streamSpan": absolute,
                    "text": span["text"], "phase": "queued",
                })
                receipt_segments[sid] = {"statementId": sid, **absolute}
                for capture in captures:
                    start = max(span["start"], capture["start_seconds"])
                    end = min(span["end"], capture["start_seconds"] + capture["bytes"] / 48_000)
                    if start >= end:
                        continue
                    graph.tx.execute(
                        "INSERT INTO voice_statement_spans(case_id,hearing_id,turn_id,statement_id,start_seconds,end_seconds) "
                        "VALUES(?,?,?,?,?,?)",
                        (case_id, hearing_id, capture["id"], sid,
                         start - capture["start_seconds"], end - capture["start_seconds"]),
                    )
                    retained = retained or (bool(capture["object_key"]) and not span.get("speaker"))
            ordered = sorted(receipt_segments.values(), key=lambda span: (span["start"], span["statementId"]))
            receipt = {"id": result_id, "statementId": ordered[0]["statementId"] if ordered else None, "segments": ordered}
            graph.tx.execute(
                "INSERT INTO voice_stream_results(case_id,hearing_id,epoch,result_id,receipt) VALUES(?,?,?,?,?)",
                (case_id, hearing_id, epoch, result_id, pack(receipt)),
            )
            if retained:
                graph.tx.execute(
                    "INSERT INTO voice_diarization_jobs(case_id,hearing_id,available_at) VALUES(?,?,?) "
                    "ON CONFLICT(case_id,hearing_id) DO UPDATE SET available_at=excluded.available_at,attempts=0",
                    (case_id, hearing_id, now_ms()),
                )
            return receipt

    def store_turn(self, session, case_id, hearing_id, *, lease, turn_id, start, pcm, keep, text, speaker=None):
        if not isinstance(text, str) or len(text) > 30_000:
            invalid()
        prior = self.begin_turn(session, case_id, hearing_id, lease=lease, turn_id=turn_id, start=start, pcm=pcm, keep=keep)
        return prior or self.finish_turn(session, case_id, hearing_id, lease=lease, turn_id=turn_id, text=text, speaker=speaker)

    def voice_turns(self, session, case_id, hearing_id):
        with self._case(session, case_id) as graph:
            graph.need("hearings", hearing_id)
            return _turns(graph.tx, case_id, hearing_id)

    def statements(self, session, case_id, hearing_id):
        with self._case(session, case_id) as graph:
            graph.need("hearings", hearing_id)
            return sorted(
                (line for line in graph.all("statements") if line["hearingId"] == hearing_id),
                key=lambda line: (line["t"], line["id"]),
            )

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
            return {
                "turns": turns,
                "statements": _retained_statements(graph, job.hearing_id, turns),
            }

    def renew_diarization(self, job):
        with self._job(job) as (graph, _):
            graph.tx.execute(
                "UPDATE voice_diarization_jobs SET lease_until=? WHERE case_id=? AND hearing_id=? AND lease=?",
                (now_ms() + 900_000, job.case_id, job.hearing_id, job.lease),
            )

    def finish_diarization(self, job, assignments):
        with self._job(job) as (graph, _):
            turns = [r for r in _turns(graph.tx, job.case_id, job.hearing_id) if r["object_key"]]
            retained = {r["id"] for r in _retained_statements(graph, job.hearing_id, turns)}
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
