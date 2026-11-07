CREATE TABLE IF NOT EXISTS voiceprints (
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  speaker_id TEXT NOT NULL,
  model TEXT NOT NULL,
  embedding TEXT NOT NULL,
  samples INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (case_id, speaker_id, model)
);
CREATE TABLE IF NOT EXISTS voiceprint_bindings (
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  hearing_id TEXT NOT NULL,
  source_speaker TEXT NOT NULL,
  speaker_id TEXT NOT NULL,
  PRIMARY KEY (case_id, hearing_id, source_speaker)
);
