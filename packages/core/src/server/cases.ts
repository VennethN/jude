import { randomUUID } from 'node:crypto';
import type { CaseRecord, CaseSummary, Workspace } from '../domain';
import { needsReview } from '../domain';
import { numberGroupedVoices } from '../speakers';
import { queueStatementIn } from './queue';
import { syncSemanticIndexIn } from './semantic-index';
import { preserveHidden, retainedMarker, withoutRemoved, type RemovedSource } from './retained-evidence';
import { insertRows, transaction, type Database } from './db';
import { ApiError, bilingual, missing, string, type Fields } from './validation';

const groups = [
  'hearings',
  'speakers',
  'statements',
  'findings',
  'documents',
  'passages',
  'connections',
  'boards',
  'threads',
  'legal',
  'replies',
] as const;
type Group = (typeof groups)[number];
interface CaseRow {
  id: string;
  record: string;
  version: number;
  archived: number;
}
type EntityEntry = { kind: Group; id: string; ordinal: number; body: string };
export function emptyWorkspace(caseRecord: CaseRecord): Workspace {
  return {
    caseRecord,
    version: 1,
    hearings: [],
    speakers: [],
    statements: [],
    findings: [],
    documents: [],
    passages: [],
    connections: [],
    boards: [],
    threads: [],
    legal: [],
    replies: [],
  };
}

function entries(workspace: Workspace) {
  const values = new Map<string, EntityEntry>();
  for (const kind of groups) {
    workspace[kind].forEach((entity, ordinal) => {
      values.set(kind + '/' + entity.id, { kind, id: entity.id, ordinal, body: JSON.stringify(entity) });
    });
  }
  return values;
}
async function saveEntries(
  db: Database,
  caseId: string,
  before: Map<string, EntityEntry>,
  workspace: Workspace,
) {
  const after = entries(workspace);
  for (const [key, entry] of after) {
    const prev = before.get(key);
    if (prev?.body === entry.body && prev.ordinal === entry.ordinal) continue;
    await db.query(
      'INSERT INTO case_entities(case_id,kind,id,ordinal,body) VALUES($1,$2,$3,$4,$5) ON CONFLICT(case_id,kind,id) DO UPDATE SET ordinal=excluded.ordinal,body=excluded.body',
      [caseId, entry.kind, entry.id, entry.ordinal, entry.body],
    );
    if (
      entry.kind === 'statements' &&
      workspace.caseRecord.label === 'private' &&
      JSON.parse(entry.body).phase === 'queued'
    )
      await queueStatementIn(db, caseId, entry.id);
  }
  for (const [key, entry] of before) {
    if (!after.has(key))
      await db.query('DELETE FROM case_entities WHERE case_id=$1 AND kind=$2 AND id=$3', [
        caseId,
        entry.kind,
        entry.id,
      ]);
  }
  if (db.forUpdate) {
    const [owner] = await db.query<{ org_id: string }>('SELECT org_id FROM cases WHERE id=$1', [caseId]);
    const removed = await removedSources(db, caseId);
    if (owner) await syncSemanticIndexIn(db, owner.org_id, removed.length ? withoutRemoved(workspace, removed) : workspace);
  }
}
export async function insertWorkspace(db: Database, orgId: string, workspace: Workspace, creator?: string) {
  const record = workspace.caseRecord;
  await db.query(
    'INSERT INTO cases(id,org_id,record,version,updated_at,synthetic) VALUES($1,$2,$3,$4,$5,$6)',
    [
      record.id,
      orgId,
      JSON.stringify(record),
      workspace.version,
      Date.now(),
      Number(record.label === 'synthetic'),
    ],
  );
  await db.query(
    "INSERT INTO case_members(case_id,user_id,role) SELECT $1,user_id,'owner' FROM memberships WHERE org_id=$2 AND (role='owner' OR user_id=$3) ON CONFLICT(case_id,user_id) DO NOTHING",
    [record.id, orgId, creator ?? ''],
  );
  const rows = [...entries(workspace).values()].map(entry => [record.id, entry.kind, entry.id, entry.ordinal, entry.body]);
  await insertRows(db, 'case_entities(case_id,kind,id,ordinal,body)', rows);
  if (record.label === 'private') {
    for (const line of workspace.statements) if (line.phase === 'queued') await queueStatementIn(db, record.id, line.id);
    await syncSemanticIndexIn(db, orgId, workspace);
  }
}
export async function orgLock(db: Database, orgId: string) {
  const rows = await db.query('SELECT id FROM organizations WHERE id=$1' + db.forUpdate, [orgId]);
  if (!rows.length) missing();
}
async function storedWorkspace(
  db: Database,
  orgId: string,
  caseId: string,
  write = false,
  allowArchived = false,
) {
  const [row] = await db.query<CaseRow>(
    'SELECT id,record,version,archived FROM cases WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL' +
      (write ? db.forUpdate : db.forUpdate ? ' FOR SHARE' : ''),
    [caseId, orgId],
  );
  if (!row) missing();
  if (write && row.archived && !allowArchived)
    throw new ApiError(409, 'case_archived', 'Restore the archived case before editing it.');
  const w = emptyWorkspace(JSON.parse(row.record) as CaseRecord);
  w.caseRecord.archived = Boolean(row.archived);
  w.version = row.version;
  const data = await db.query<EntityEntry>(
    'SELECT kind,id,ordinal,body FROM case_entities WHERE case_id=$1 ORDER BY kind,ordinal',
    [caseId],
  );
  for (const entry of data) (w[entry.kind] as { id: string }[]).push(JSON.parse(entry.body));
  numberGroupedVoices(w.speakers);
  return w;
}
async function removedSources(db: Database, caseId: string) {
  return db.query<RemovedSource>(
    "SELECT kind,id FROM case_trash WHERE case_id=$1 AND body=$2 AND kind IN ('documents','hearings')",
    [caseId, retainedMarker],
  );
}

export async function workspaceIn(db: Database, orgId: string, caseId: string, write = false) {
  const raw = await storedWorkspace(db, orgId, caseId, write);
  const removed = await removedSources(db, caseId);
  return removed.length ? withoutRemoved(raw, removed) : raw;
}

export async function purgeSourcesIn(db: Database, orgId: string, caseId: string, removed: RemovedSource[]) {
  const raw = await storedWorkspace(db, orgId, caseId, true, true);
  const pruned = withoutRemoved(raw, removed);
  await saveEntries(db, caseId, entries(raw), pruned);
  await db.query(
    "DELETE FROM analysis_jobs WHERE case_id=$1 AND NOT EXISTS (SELECT 1 FROM case_entities e WHERE e.case_id=analysis_jobs.case_id AND e.kind='statements' AND e.id=analysis_jobs.statement_id)",
    [caseId],
  );
}

export async function changeIn<T>(
  db: Database,
  orgId: string,
  caseId: string,
  edit: (workspace: Workspace) => T,
) {
  const raw = await storedWorkspace(db, orgId, caseId, true);
  const removed = await removedSources(db, caseId);
  const initial = removed.length ? withoutRemoved(raw, removed) : undefined;
  const workspace = initial ? structuredClone(initial) : raw;
  const before = entries(raw);
  const previousRecord = JSON.stringify(workspace.caseRecord);
  const result = edit(workspace);
  const stored = initial ? structuredClone(workspace) : workspace;
  if (initial) preserveHidden(raw, initial, stored);
  const after = entries(stored);
  if (
    before.size === after.size &&
    [...after].every(
      ([key, value]) => before.get(key)?.body === value.body && before.get(key)?.ordinal === value.ordinal,
    ) &&
    previousRecord === JSON.stringify(workspace.caseRecord)
  )
    return result;
  workspace.version++;
  workspace.caseRecord.updated = new Date().toISOString();
  await db.query('UPDATE cases SET record=$1,version=$2,updated_at=$3 WHERE id=$4', [
    JSON.stringify(workspace.caseRecord),
    workspace.version,
    Date.now(),
    caseId,
  ]);
  await saveEntries(db, caseId, before, stored);
  return result;
}
export const readWorkspace = (orgId: string, caseId: string) =>
  transaction((db) => workspaceIn(db, orgId, caseId));
export function mutateWorkspace<T>(orgId: string, caseId: string, edit: (workspace: Workspace) => T) {
  return transaction((db) => changeIn(db, orgId, caseId, edit));
}

export function makeCase(fields: Fields): CaseRecord {
  return {
    id: randomUUID(),
    title: string(fields.title, 'title', 200),
    reference: string(fields.reference, 'reference', 200, true),
    label: 'private',
    court: string(fields.court, 'court', 240, true),
    client: string(fields.client, 'client', 150, true),
    summary: bilingual(fields.summary, 'summary', 4000, true),
    updated: new Date().toISOString(),
  };
}
export function patchCase(workspace: Workspace, fields: Fields) {
  const item = workspace.caseRecord;
  if ('title' in fields) item.title = string(fields.title, 'title', 200);
  if ('reference' in fields) item.reference = string(fields.reference, 'reference', 200, true);
  if ('client' in fields) item.client = string(fields.client, 'client', 150, true);
  if ('court' in fields) item.court = string(fields.court, 'court', 240, true);
  if ('summary' in fields) item.summary = bilingual(fields.summary, 'summary', 4000, true);
  return item;
}
export async function listCases(db: Database, orgId: string, userId: string, term = '') {
  const records = await db.query<CaseRow>(
    'SELECT c.id,c.record,c.version,c.archived FROM cases c JOIN workspace_case_members cm ON c.id=cm.case_id WHERE c.org_id=$1 AND cm.user_id=$2 AND c.deleted_at IS NULL ORDER BY c.updated_at DESC,c.id ASC',
    [orgId, userId],
  );
  const summaries: CaseSummary[] = [];
  for (const record of records) {
    const info: CaseRecord = JSON.parse(record.record);
    if (
      term &&
      !(info.title + ' ' + info.reference + ' ' + info.court + ' ' + info.client)
        .toLowerCase()
        .includes(term.toLowerCase())
    )
      continue;
    const w = await workspaceIn(db, orgId, record.id);
    summaries.push({
      ...w.caseRecord,
      counts: {
        hearings: w.hearings.filter((h) => h.mode !== 'scheduled').length,
        documents: w.documents.length,
        needsLook: w.findings.filter(needsReview).length,
      },
      live: w.hearings.find((h) => h.mode === 'live') ?? null,
    });
  }
  return summaries.sort((a, b) => b.updated.localeCompare(a.updated) || a.title.localeCompare(b.title));
}

export async function idempotent<T>(
  db: Database,
  orgId: string,
  scope: string,
  key: string | null,
  run: () => Promise<T>,
) {
  if (!key) return run();
  string(key, 'Idempotency-Key', 100);
  await orgLock(db, orgId);
  const [prior] = await db.query<{ result: string }>(
    'SELECT result FROM idempotency WHERE org_id=$1 AND scope=$2 AND key=$3',
    [orgId, scope, key],
  );
  if (prior) return JSON.parse(prior.result) as T;
  const value = await run();
  await db.query('INSERT INTO idempotency(org_id,scope,key,result,created_at) VALUES($1,$2,$3,$4,$5)', [
    orgId,
    scope,
    key,
    JSON.stringify(value),
    Date.now(),
  ]);
  return value;
}

export { authorizeCase } from './access';
