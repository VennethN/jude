"""Deterministic replay of the two synthetic hearings."""

import json
import re
from functools import lru_cache
from pathlib import Path

from .repository import VoiceError, invalid

WORD_INTERVAL_MS = 140
FINAL_HOLD_MS = 420


@lru_cache(maxsize=1)
def scripts():
    return json.loads((Path(__file__).parent / "data/replay.json").read_text())


def _reply(graph, line, previous):
    speaker = graph.get("speakers", line["speakerId"]) or {}
    if speaker.get("alias"):
        speaker = graph.get("speakers", speaker["alias"]) or speaker
    role, text = speaker.get("role"), line["text"]
    counsel_asked = previous and previous["speakerId"] == "ph"
    if role == "judge" and re.search(r"pen[ae]sihat hukum", text, re.IGNORECASE):
        reason = "called"
    elif role == "opposing" and counsel_asked and "keberatan" in text.lower():
        reason = "objection"
    elif role == "witness" and counsel_asked:
        reason = "answer"
    else:
        return
    counsel = next((s for s in graph.all("speakers") if s["role"] == "counsel"), None)
    if not counsel:
        return
    findings = [
        f
        for f in graph.all("findings")
        if not f.get("reviewed") and f["status"] in ("potential_inconsistency", "context_needed")
    ]
    findings.sort(key=lambda f: f["hearingId"] != line["hearingId"])
    suggestions = [
        {
            "text": f["question"],
            "basis": {"kind": "finding", "id": f["id"]},
            "why": f["verify"],
            "confidence": 0.83 if f["status"] == "potential_inconsistency" else 0.66,
        }
        for f in findings[:3]
    ]
    suggestions.append(
        {
            "text": "Mohon waktu sebentar untuk memeriksa berkas, Yang Mulia.",
            "basis": {"kind": "procedure"},
            "why": {
                "id": "Memberi waktu untuk memeriksa sumber.",
                "en": "Allows time to examine the source.",
            },
            "confidence": 0.5,
        }
    )
    graph.put(
        "replies",
        {
            "id": "reply-" + line["id"],
            "hearingId": line["hearingId"],
            "statementId": line["id"],
            "forId": counsel["id"],
            "reason": reason,
            "suggestions": suggestions,
        },
    )


def _position(graph, hearing_id, expected):
    if type(expected) is not int or expected < 0:
        invalid()
    hearing = graph.need("hearings", hearing_id)
    if not graph.synthetic or hearing["mode"] != "live":
        raise VoiceError(409, "not_replaying", "This hearing has no active replay.")
    script = scripts()["live" if hearing_id == "h3" else "alternate"]
    lines = [line for line in graph.all("statements") if line["hearingId"] == hearing_id]
    prefix = "replay-" + hearing_id + "-"
    cursor = sum(line["id"].startswith(prefix) for line in lines)
    return script, cursor, lines


def _statement(hearing_id, cursor, entry, lines):
    line = {
        "id": f"replay-{hearing_id}-{cursor}",
        "hearingId": hearing_id,
        "speakerId": entry["speakerId"],
        "text": entry["text"],
        "t": max((line["t"] for line in lines), default=0) + 6,
        "phase": "complete",
    }
    if "legal" in entry:
        line["legal"] = entry["legal"]
    return line


def preview(graph, hearing_id, expected):
    script, cursor, lines = _position(graph, hearing_id, expected)
    if cursor >= len(script):
        return {"cursor": cursor, "done": True}
    line = _statement(hearing_id, cursor, script[cursor], lines)
    turn = {key: line[key] for key in ("id", "speakerId", "text", "t")}
    turn["durationMs"] = WORD_INTERVAL_MS * len(line["text"].split()) + FINAL_HOLD_MS
    return {"cursor": cursor, "done": False, "turn": turn}


def advance(graph, hearing_id, expected):
    script, cursor, lines = _position(graph, hearing_id, expected)
    if cursor != expected or cursor >= len(script):
        return {"cursor": cursor, "done": cursor >= len(script)}
    entry = script[cursor]
    line = _statement(hearing_id, cursor, entry, lines)
    sid = line["id"]
    if not graph.get("speakers", line["speakerId"]):
        graph.put("speakers", {"id": line["speakerId"], "label": "", "role": "unknown", "confirmed": False})
    graph.put("statements", line)
    finding = entry.get("finding")
    if finding and all(graph.get("passages", source["passageId"]) for source in finding["sources"]):
        graph.put(
            "findings",
            {
                **finding,
                "id": "f-" + sid,
                "hearingId": hearing_id,
                "statementId": sid,
                "reviewed": False,
                "note": "",
            },
        )
    for index, edge in enumerate(entry.get("connections", [])):
        if graph.get("passages", edge["to"]["id"]):
            graph.put(
                "connections", {**edge, "id": f"c-{sid}-{index}", "from": {"kind": "statement", "id": sid}}
            )
    _reply(graph, line, lines[-1] if lines else None)
    return {"cursor": cursor + 1, "done": cursor + 1 >= len(script), "pause": entry.get("pause", 1700)}
