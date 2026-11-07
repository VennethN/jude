import { createHash, randomUUID } from 'node:crypto';
import type { CaseRecord, SessionInfo } from '../domain';
import { workspaceGroups, type WorkspaceSync, type WorkspaceUpsert } from '../workspace-sync';
import { caseAccess } from './access';
import { workspaceIn } from './cases';
import { transaction, type Database } from './db';
import { legalDiscoveryMode } from './providers/pasal';
import { missing } from './validation';
import type { RevisionEntity } from './workspace-revisions';

type CaseState = { record: string; version: number; archived: number; workspace_epoch: string };
function decode(value: string | null): { version: number; context: string } | undefined {
  try {
    if (!value || value.length > 1024) return;
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString());
    if (Number.isSafeInteger(parsed.version) && parsed.version >= 1 && typeof parsed.context === 'string') return parsed;
  } catch { /* Unknown cursors use an authorized full snapshot. */ }
}

export async function workspaceSync(session: SessionInfo, caseId: string, since: string | null): Promise<WorkspaceSync> {
  return transaction(async db => {
    const org = session.organization.id;
    const role = await caseAccess(db, session, caseId);
    const [row] = await db.query<CaseState>(
      'SELECT record,version,archived,workspace_epoch FROM cases WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL' + db.forUpdate,
      [caseId, org],
    );
    if (!row) missing();
    if (!row.workspace_epoch) {
      row.workspace_epoch = randomUUID();
      await db.query('UPDATE cases SET workspace_epoch=$1 WHERE id=$2', [row.workspace_epoch, caseId]);
    }
    const record = JSON.parse(row.record) as CaseRecord;
    record.archived = Boolean(row.archived);
    const legal = legalDiscoveryMode({ caseRecord: record });
    const context = createHash('sha256').update(JSON.stringify([
      org, session.user.id, caseId, role, row.workspace_epoch, legal, record.archived,
    ])).digest('hex');
    const cursor = Buffer.from(JSON.stringify({ version: row.version, context })).toString('base64url');
    const previous = decode(since);
    // Retained evidence rewrites related findings, boards and citations. Keep that projection on
    // the existing full read path, including revisions created while an item is in the trash.
    const trash = await db.query('SELECT id FROM case_trash WHERE case_id=$1 LIMIT 1', [caseId]);
    if (!trash.length && previous?.context === context && previous.version <= row.version && row.version - previous.version <= 128) {
      const upserts = await changedEntities(db, caseId, previous.version, row.version);
      if (upserts) return { kind: 'delta', cursor, from: previous.version, version: row.version, caseRecord: record, upserts };
    }
    const workspace = await workspaceIn(db, org, caseId);
    workspace.legalDiscovery = legal;
    return { kind: 'snapshot', cursor, workspace };
  });
}

async function changedEntities(db: Database, caseId: string, from: number, to: number): Promise<WorkspaceUpsert[] | undefined> {
  if (from === to) return [];
  const revisions = await db.query<{ version: number; changes: string }>(
    'SELECT version,changes FROM case_workspace_revisions WHERE case_id=$1 AND version>$2 AND version<=$3 ORDER BY version',
    [caseId, from, to],
  );
  if (revisions.length !== to - from || revisions.some((revision, index) => revision.version !== from + index + 1)) return;
  const changed = new Map<string, RevisionEntity>();
  try {
    for (const revision of revisions) {
      const entries: RevisionEntity[] = JSON.parse(revision.changes);
      if (!Array.isArray(entries)) return;
      for (const entry of entries) {
        if (!workspaceGroups.includes(entry.kind) || typeof entry.id !== 'string') return;
        changed.set(entry.kind + '/' + entry.id, entry);
      }
    }
  } catch { return; }
  if (changed.size > 512) return;
  const upserts: WorkspaceUpsert[] = [];
  const entries = [...changed.values()];
  for (let offset = 0; offset < entries.length; offset += 100) {
    const batch = entries.slice(offset, offset + 100);
    const match = batch.map((_, index) => '(kind=$' + (index * 2 + 2) + ' AND id=$' + (index * 2 + 3) + ')').join(' OR ');
    const rows = await db.query<{ kind: RevisionEntity['kind']; id: string; ordinal: number; body: string }>(
      'SELECT kind,id,ordinal,body FROM case_entities WHERE case_id=$1 AND (' + match + ')',
      [caseId, ...batch.flatMap(entry => [entry.kind, entry.id])],
    );
    if (rows.length !== batch.length) return;
    for (const entry of rows) upserts.push({ kind: entry.kind, ordinal: entry.ordinal, value: JSON.parse(entry.body) } as WorkspaceUpsert);
  }
  return upserts;
}
