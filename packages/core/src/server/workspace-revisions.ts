import type { Database } from './db';
import type { WorkspaceGroup } from '../workspace-sync';

export type RevisionEntity = { kind: WorkspaceGroup; id: string };
export async function recordWorkspaceRevision(db: Database, caseId: string, version: number, changes: RevisionEntity[]) {
  // IDs only: case text remains in its original authorized entity rows.
  await db.query('INSERT INTO case_workspace_revisions(case_id,version,changes) VALUES($1,$2,$3)',
    [caseId, version, JSON.stringify(changes)]);
  await db.query('DELETE FROM case_workspace_revisions WHERE case_id=$1 AND version<=$2', [caseId, version - 128]);
}
