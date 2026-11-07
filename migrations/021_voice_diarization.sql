CREATE TABLE IF NOT EXISTS voice_diarization_jobs (
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  hearing_id TEXT NOT NULL, available_at BIGINT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
  lease TEXT, lease_until BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (case_id, hearing_id)
);
CREATE INDEX IF NOT EXISTS voice_diarization_available ON voice_diarization_jobs(available_at,lease_until);
INSERT INTO voice_diarization_jobs(case_id,hearing_id,available_at)
  SELECT t.case_id,t.hearing_id,0 FROM voice_turns t JOIN cases c ON c.id=t.case_id
  WHERE t.object_key IS NOT NULL AND c.synthetic=0 GROUP BY t.case_id,t.hearing_id
  ON CONFLICT (case_id,hearing_id) DO NOTHING;

