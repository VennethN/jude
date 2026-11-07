CREATE TABLE IF NOT EXISTS voice_pending_transcripts (
  case_id TEXT NOT NULL,
  hearing_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  PRIMARY KEY (case_id, hearing_id, turn_id),
  FOREIGN KEY (case_id, hearing_id, turn_id)
    REFERENCES voice_turns(case_id, hearing_id, id) ON DELETE CASCADE
);
