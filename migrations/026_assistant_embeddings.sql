CREATE TABLE IF NOT EXISTS assistant_embeddings (
  case_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  model TEXT NOT NULL,
  chunk INTEGER NOT NULL,
  input_hash TEXT NOT NULL,
  vector TEXT NOT NULL,
  PRIMARY KEY (case_id, kind, source_id, model, chunk),
  FOREIGN KEY (case_id, kind, source_id) REFERENCES case_entities(case_id, kind, id) ON DELETE CASCADE
);
