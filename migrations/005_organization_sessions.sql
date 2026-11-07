CREATE TABLE memberships_next (
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','member')),
  PRIMARY KEY (org_id,user_id)
);
INSERT INTO memberships_next(org_id,user_id,role) SELECT org_id,user_id,role FROM memberships;
DROP TABLE memberships;
ALTER TABLE memberships_next RENAME TO memberships;
CREATE INDEX membership_user ON memberships(user_id);
ALTER TABLE sessions ADD COLUMN org_id TEXT REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE users ADD COLUMN active_org TEXT REFERENCES organizations(id) ON DELETE SET NULL;
UPDATE sessions SET org_id=(SELECT m.org_id FROM memberships m WHERE m.user_id=sessions.user_id LIMIT 1);
UPDATE users SET active_org=(SELECT m.org_id FROM memberships m WHERE m.user_id=users.id LIMIT 1);

