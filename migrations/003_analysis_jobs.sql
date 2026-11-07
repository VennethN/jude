CREATE TABLE IF NOT EXISTS analysis_jobs (
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE, statement_id TEXT NOT NULL,
  available_at BIGINT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
  lease TEXT, lease_until BIGINT NOT NULL DEFAULT 0, PRIMARY KEY (case_id,statement_id)
);
CREATE INDEX IF NOT EXISTS analysis_available ON analysis_jobs(available_at,lease_until);

