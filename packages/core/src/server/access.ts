import type { SessionInfo } from '../domain';
import type { Database } from './db';
import { transaction } from './db';
import { ApiError, choice, conflict, missing } from './validation';

export type Access = 'read' | 'write' | 'manage';
export async function caseAccess(
  db: Database,
  session: SessionInfo,
  caseId: string,
  mode: Access = 'read',
  includeDeleted = false,
) {
  const [access] = await db.query<{ role: 'owner' | 'editor' | 'viewer' }>(
    'SELECT cm.role FROM case_members cm JOIN cases c ON cm.case_id=c.id JOIN memberships m ON m.user_id=cm.user_id AND m.org_id=c.org_id WHERE c.id=$1 AND c.org_id=$2 AND cm.user_id=$3' +
      (includeDeleted ? '' : ' AND c.deleted_at IS NULL'),
    [caseId, session.organization.id, session.user.id],
  );
  if (!access) missing();
  if ((mode === 'manage' && access.role !== 'owner') || (mode === 'write' && access.role === 'viewer'))
    throw new ApiError(403, 'forbidden', 'Your case role does not permit this action.');
  return access.role;
}
export const authorizeCase = (
  session: SessionInfo,
  caseId: string,
  mode: Access = 'read',
  includeDeleted = false,
) => transaction((db) => caseAccess(db, session, caseId, mode, includeDeleted));

export async function listMembers(db: Database, session: SessionInfo, caseId: string) {
  await caseAccess(db, session, caseId);
  return db.query<{ id: string; name: string; role: string }>(
    'SELECT u.id,u.name,cm.role FROM case_members cm JOIN users u ON cm.user_id=u.id WHERE cm.case_id=$1 ORDER BY u.name',
    [caseId],
  );
}
export async function setCaseMember(
  db: Database,
  session: SessionInfo,
  caseId: string,
  userId: string,
  newRole: unknown,
  remove: boolean,
) {
  await caseAccess(db, session, caseId, 'manage');
  const [belongs] = await db.query('SELECT user_id FROM memberships WHERE org_id=$1 AND user_id=$2', [
    session.organization.id,
    userId,
  ]);
  if (!belongs) missing();
  if (session.user.id === userId) conflict('The case owner cannot remove their own access.');
  if (remove) await db.query('DELETE FROM case_members WHERE case_id=$1 AND user_id=$2', [caseId, userId]);
  else {
    const role = choice(newRole, ['owner', 'editor', 'viewer'], 'role');
    await db.query(
      'INSERT INTO case_members(case_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(case_id,user_id) DO UPDATE SET role=excluded.role',
      [caseId, userId, role],
    );
  }
  return { ok: true };
}
