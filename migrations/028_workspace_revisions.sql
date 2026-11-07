ALTER TABLE cases ADD COLUMN workspace_epoch TEXT NOT NULL DEFAULT '';
CREATE TABLE case_workspace_revisions (
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  changes TEXT NOT NULL,
  PRIMARY KEY(case_id,version)
);
