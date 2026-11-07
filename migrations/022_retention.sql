CREATE TABLE IF NOT EXISTS purge_objects (
  object_key TEXT PRIMARY KEY, available_at BIGINT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS purge_objects_due ON purge_objects(available_at);
CREATE INDEX IF NOT EXISTS trash_due ON case_trash(deleted_at);
CREATE INDEX IF NOT EXISTS deleted_cases_due ON cases(deleted_at);
