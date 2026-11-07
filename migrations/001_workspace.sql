CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, demo_id TEXT,
  demo_refs TEXT NOT NULL DEFAULT '{}',
  plan_id TEXT NOT NULL DEFAULT 'basic', cycle TEXT NOT NULL DEFAULT 'monthly',
  plan_status TEXT NOT NULL DEFAULT 'active', trial_ends BIGINT, trial_used INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT UNIQUE, name TEXT NOT NULL, password_hash TEXT,
  guest INTEGER NOT NULL DEFAULT 0, prefs TEXT NOT NULL DEFAULT '{}', created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS memberships (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS session_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS auth_tokens (
  token_hash TEXT PRIMARY KEY, purpose TEXT NOT NULL, subject TEXT NOT NULL, email TEXT NOT NULL,
  role TEXT, expires_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  record TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, updated_at BIGINT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0, synthetic INTEGER NOT NULL DEFAULT 0, deleted_at BIGINT
);
CREATE INDEX IF NOT EXISTS case_org ON cases(org_id, deleted_at, updated_at);
CREATE TABLE IF NOT EXISTS case_entities (
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE, kind TEXT NOT NULL,
  id TEXT NOT NULL, ordinal INTEGER NOT NULL, body TEXT NOT NULL,
  PRIMARY KEY (case_id, kind, id)
);
CREATE INDEX IF NOT EXISTS case_entities_order ON case_entities(case_id, kind, ordinal);
CREATE TABLE IF NOT EXISTS attachments (
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE, entity_id TEXT NOT NULL,
  kind TEXT NOT NULL, object_key TEXT NOT NULL UNIQUE, file_name TEXT NOT NULL, mime TEXT NOT NULL,
  byte_length BIGINT NOT NULL, PRIMARY KEY(case_id,entity_id,kind)
);
CREATE TABLE IF NOT EXISTS case_trash (
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE, kind TEXT NOT NULL,
  id TEXT NOT NULL, body TEXT NOT NULL, deleted_at BIGINT NOT NULL, PRIMARY KEY(case_id,kind,id)
);
CREATE TABLE IF NOT EXISTS usage_counts (
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, period TEXT NOT NULL, quota TEXT NOT NULL,
  amount BIGINT NOT NULL, PRIMARY KEY(org_id,period,quota)
);
CREATE TABLE IF NOT EXISTS idempotency (
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, scope TEXT NOT NULL, key TEXT NOT NULL,
  result TEXT NOT NULL, created_at BIGINT NOT NULL, PRIMARY KEY(org_id,scope,key)
);
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS sales_contacts (
  id TEXT PRIMARY KEY, body TEXT NOT NULL, created_at BIGINT NOT NULL
);

