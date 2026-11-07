CREATE TABLE IF NOT EXISTS voice_leases (
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  hearing_id TEXT NOT NULL,
  holder TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  PRIMARY KEY(case_id,hearing_id)
);
CREATE TABLE IF NOT EXISTS voice_turns (
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  hearing_id TEXT NOT NULL,
  id TEXT NOT NULL,
  start_seconds REAL NOT NULL,
  bytes INTEGER NOT NULL,
  object_key TEXT,
  PRIMARY KEY(case_id,hearing_id,id)
);
