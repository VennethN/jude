"""Filesystem and database settings shared with the web service."""

import json
import os
from functools import lru_cache
from pathlib import Path


def workspace_root() -> Path:
    for start in (Path(__file__).resolve(), Path.cwd().resolve()):
        for candidate in (start, *start.parents):
            if (candidate / "packages/core/src/plan-quotas.json").is_file():
                return candidate
    raise RuntimeError("Cannot locate the Jude workspace root")


def db_path() -> str:
    explicit = os.getenv("JUDE_DB_PATH")
    if explicit:
        return explicit
    if os.getenv("NODE_ENV") == "production":
        raise RuntimeError("Configure DATABASE_URL or JUDE_DB_PATH")
    return str(workspace_root() / ".jude-data/workspace.sqlite")


def migration_dir() -> Path:
    return (
        Path(os.environ["JUDE_MIGRATIONS_DIR"])
        if os.getenv("JUDE_MIGRATIONS_DIR")
        else workspace_root() / "migrations"
    )


def files_dir() -> Path:
    return (
        Path(os.environ["JUDE_FILES_DIR"])
        if os.getenv("JUDE_FILES_DIR")
        else workspace_root() / ".jude-data/files"
    )


@lru_cache(maxsize=1)
def plan_quotas() -> dict:
    return json.loads((workspace_root() / "packages/core/src/plan-quotas.json").read_text())


@lru_cache(maxsize=1)
def guest_practice() -> dict:
    return json.loads((workspace_root() / "packages/core/src/guest-practice.json").read_text())
