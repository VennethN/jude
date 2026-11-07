CREATE VIEW workspace_case_members AS
SELECT cm.case_id, cm.user_id, cm.role
FROM case_members cm
JOIN users u ON u.id = cm.user_id
JOIN cases c ON c.id = cm.case_id
JOIN organizations o ON o.id = c.org_id
WHERE u.guest = 1 OR c.synthetic = 0 OR o.demo_id IS NULL OR (
  c.id <> o.demo_id AND REPLACE(o.demo_refs, '"' || c.id || '"', '') = o.demo_refs
);
