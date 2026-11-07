CREATE TABLE IF NOT EXISTS pasal_metadata_cache (
  cache_key TEXT PRIMARY KEY,
  metadata TEXT NOT NULL,
  expires_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS pasal_metadata_expiry ON pasal_metadata_cache(expires_at);
