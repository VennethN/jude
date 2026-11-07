import { createHash } from 'node:crypto';
import type { SessionInfo } from '@jude/core/domain';
import { transaction } from '@jude/core/server/db';
import { billing } from '@jude/core/server/billing';
import { legalDiscoveryMode } from '@jude/core/server/providers/pasal';
import { workspaceScope } from '$lib/workspace/scope';

const allowedCases =
  'FROM cases c JOIN workspace_case_members cm ON cm.case_id=c.id ' +
  'JOIN memberships m ON m.org_id=c.org_id AND m.user_id=cm.user_id ' +
  'WHERE c.org_id=$1 AND cm.user_id=$2 AND c.deleted_at IS NULL';

export async function caseGuard(session: SessionInfo, id: string) {
  const [row] = await transaction((db) =>
    db.query<{ version: number; role: string; synthetic: number; workspace_epoch: string }>(
      'SELECT c.version,cm.role,c.synthetic,c.workspace_epoch ' + allowedCases + ' AND c.id=$3',
      [session.organization.id, session.user.id, id],
    ),
  );
  if (!row) return;
  const legal = legalDiscoveryMode({ caseRecord: { label: row.synthetic ? 'synthetic' : 'private' } });
  return { scope: workspaceScope(session), id, version: JSON.stringify([row.version, row.role, legal, row.workspace_epoch]) };
}

export async function registerGuard(session: SessionInfo) {
  return transaction(async (db) => {
    const rows = await db.query<{ id: string; version: number }>(
      'SELECT c.id,c.version ' + allowedCases + ' ORDER BY c.id',
      [session.organization.id, session.user.id],
    );
    const { usage } = await billing(db, session.organization.id);
    const full = (quota: typeof usage.cases) => quota.limit !== null && quota.used >= quota.limit;
    return {
      registerGuard: {
        scope: workspaceScope(session),
        version: createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
      },
      casesFull: full(usage.cases),
      storageFull: full(usage.storage),
    };
  });
}
