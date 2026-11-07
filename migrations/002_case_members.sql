CREATE TABLE IF NOT EXISTS case_members (
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner','editor','viewer')),
  PRIMARY KEY(case_id,user_id)
);
CREATE INDEX IF NOT EXISTS case_member_user ON case_members(user_id,case_id);
INSERT INTO case_members(case_id,user_id,role)
  SELECT c.id,m.user_id,'owner' FROM cases c JOIN memberships m ON m.org_id=c.org_id WHERE m.role='owner'
  ON CONFLICT(case_id,user_id) DO NOTHING;

