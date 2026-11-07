"""SQLite/PostgreSQL transactions and the shared, serialised migration ledger."""

import os
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4

from .config import db_path, migration_dir


class Transaction:
    def __init__(self, connection, postgres: bool):
        self.connection = connection
        self.postgres = postgres

    def execute(self, sql: str, args=()):
        return self.connection.execute(sql.replace("?", "%s") if self.postgres else sql, args)

    def one(self, sql: str, args=()):
        row = self.execute(sql, args).fetchone()
        return dict(row) if row is not None else None

    def all(self, sql: str, args=()):
        return [dict(row) for row in self.execute(sql, args).fetchall()]


class Database:
    def __init__(self):
        self.url = os.getenv("DATABASE_URL")
        self.path = None if self.url else db_path()
        self._initialized = False
        self._migration_lock = threading.Lock()
        self._anchor = None
        if self.path == ":memory:":
            self.path = f"file:jude-voice-{uuid4()}?mode=memory&cache=shared"
            self._anchor = sqlite3.connect(self.path, uri=True, check_same_thread=False)

    def _connect(self):
        if self.url:
            import psycopg
            from psycopg.rows import dict_row

            return psycopg.connect(self.url, row_factory=dict_row, connect_timeout=8)
        if self._anchor is None:
            Path(self.path).parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        conn = sqlite3.connect(self.path, timeout=10, isolation_level=None, uri=self._anchor is not None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    @contextmanager
    def _transaction(self, write=False):
        conn = self._connect()
        try:
            if not self.url:
                conn.execute("BEGIN IMMEDIATE" if write else "BEGIN")
            yield Transaction(conn, bool(self.url))
            conn.commit()
        except BaseException:
            conn.rollback()
            raise
        finally:
            conn.close()

    def ready(self):
        if self._initialized:
            return
        with self._migration_lock:
            if self._initialized:
                return
            if not self.url:
                conn = self._connect()
                try:
                    conn.execute("PRAGMA journal_mode=WAL")
                finally:
                    conn.close()
            with self._transaction(True) as tx:
                if tx.postgres:
                    tx.execute("SELECT pg_advisory_xact_lock(1937446201)")
                tx.execute("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY)")
                done = {r["name"] for r in tx.all("SELECT name FROM schema_migrations")}
                for path in sorted(migration_dir().glob("[0-9]*.sql")):
                    if path.name in done:
                        continue
                    for statement in path.read_text().split(";"):
                        if statement.strip():
                            tx.execute(statement)
                    tx.execute("INSERT INTO schema_migrations(name) VALUES(?)", (path.name,))
            self._initialized = True

    @contextmanager
    def transaction(self, write=False):
        self.ready()
        with self._transaction(write) as tx:
            yield tx
