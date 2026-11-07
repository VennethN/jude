CREATE TABLE IF NOT EXISTS voice_stream_captures (
  case_id TEXT NOT NULL,
  hearing_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  epoch TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  PRIMARY KEY (case_id, hearing_id, epoch, turn_id),
  FOREIGN KEY (case_id, hearing_id, turn_id)
    REFERENCES voice_turns(case_id, hearing_id, id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS voice_stream_results (
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  hearing_id TEXT NOT NULL,
  epoch TEXT NOT NULL,
  result_id TEXT NOT NULL,
  receipt TEXT NOT NULL,
  PRIMARY KEY (case_id, hearing_id, epoch, result_id)
);
CREATE TABLE IF NOT EXISTS voice_statement_spans (
  case_id TEXT NOT NULL,
  hearing_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  statement_id TEXT NOT NULL,
  start_seconds REAL NOT NULL,
  end_seconds REAL NOT NULL,
  PRIMARY KEY (case_id, hearing_id, turn_id, statement_id),
  FOREIGN KEY (case_id, hearing_id, turn_id)
    REFERENCES voice_turns(case_id, hearing_id, id) ON DELETE CASCADE
);
