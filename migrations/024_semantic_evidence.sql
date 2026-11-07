CREATE TABLE IF NOT EXISTS semantic_case_state (
  case_id TEXT PRIMARY KEY REFERENCES cases(id) ON DELETE CASCADE,
  version INTEGER NOT NULL, model TEXT NOT NULL, synced_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS semantic_evidence (
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, source_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
  model TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0, available_at BIGINT NOT NULL DEFAULT 0,
  lease TEXT, lease_until BIGINT NOT NULL DEFAULT 0, updated_at BIGINT NOT NULL,
  PRIMARY KEY(case_id,kind,source_id)
);
CREATE INDEX IF NOT EXISTS semantic_evidence_due ON semantic_evidence(status,available_at,lease_until);
