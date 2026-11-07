import { randomUUID } from 'node:crypto';
import { beforeAll, afterEach, expect, test, vi } from 'vitest';
import type { CaseRecord, SessionInfo, Workspace } from '../src/domain';
import { mergeWorkspaceSync, type WorkspaceSync } from '../src/workspace-sync';
import { mutateWorkspace } from '../src/server/cases';
import * as database from '../src/server/db';
import { workspaceSync } from '../src/server/workspace-sync';
import { browser } from './api-client';
import { useIsolatedDatabase } from './isolated-db';

useIsolatedDatabase('guest');
beforeAll(() => {
  process.env.JUDE_SEMANTIC_SEARCH = 'false';
});
afterEach(() => vi.restoreAllMocks());
async function fixture() {
  const client = browser();
  const session = await client.ok<SessionInfo>('auth/signup', 'POST', {
    name: 'Counsel', email: randomUUID() + '@example.test', password: 'Workspace-1234', planId: 'pro',
  });
  const record = await client.ok<CaseRecord>('cases', 'POST', { title: 'Fictional transcript' });
  await mutateWorkspace(session.organization.id, record.id, w => {
    w.speakers.push({ id: 'v1', label: '', role: 'unknown', confirmed: false });
    w.documents.push({ id: 'doc', caseId: record.id, title: 'Large existing record', file: 'TXT', size: '128 KB', pages: 1, added: '2026-11-07', kind: { id: 'Catatan', en: 'Record' } });
    w.passages.push({ id: 'passage', docId: 'doc', page: 1, text: 'Existing private evidence. '.repeat(5000) });
  });
  const path = 'cases/' + record.id + '/workspace';
  const initial = await client.ok<WorkspaceSync>(path + '?sync=1');
  if (initial.kind !== 'snapshot') throw new Error('Expected initial snapshot');
  return { client, session, id: record.id, path, initial };
}

function observeQueries() {
  const queries: string[] = [];
  const original = database.transaction;
  vi.spyOn(database, 'transaction').mockImplementation(work => original(db => work({
    ...db,
    query: async (sql, args) => { queries.push(sql); return db.query(sql, args); },
  })));
  return queries;
}

test('live transcript and finding deltas read only changed rows and reconstruct the regular workspace', async () => {
  const { client, session, id, path, initial } = await fixture();
  await mutateWorkspace(session.organization.id, id, w => {
    w.statements.push({ id: 'second', hearingId: 'hearing', speakerId: 'v1', t: 2, text: 'Final words.', phase: 'queued' });
    w.statements.push({ id: 'third', hearingId: 'hearing', speakerId: 'v1', t: 3, text: 'More final words.', phase: 'saved' });
  }, { stream: true });
  await mutateWorkspace(session.organization.id, id, w => {
    w.statements[0].phase = 'complete';
    const copy = { id: 'Periksa catatan.', en: 'Check the record.' };
    w.findings.push({ id: 'finding', hearingId: 'hearing', statementId: 'second', status: 'context_needed',
      title: copy, explanation: copy, verify: copy, question: 'Kapan?', reviewed: false, note: '',
      sources: [{ passageId: 'passage', relation: 'supports', match: 'Existing private evidence.' }] });
  }, { stream: true });
  const queries = observeQueries();
  const delta = await client.ok<WorkspaceSync>(path + '?since=' + initial.cursor);
  expect(delta.kind).toBe('delta');
  expect(queries.some(sql => sql.includes('case_entities'))).toBe(true);
  expect(queries.filter(sql => sql.includes('FROM case_entities')).every(sql => sql.includes('kind=$2 AND id=$3'))).toBe(true);
  vi.restoreAllMocks();
  const merged = mergeWorkspaceSync(initial.workspace, delta);
  const legacy = await client.ok<Workspace>(path);
  expect(merged).toEqual(legacy);
  expect(JSON.stringify(delta).length).toBeLessThan(JSON.stringify(legacy).length / 30);
  expect(legacy).not.toHaveProperty('kind');
  expect(legacy).not.toHaveProperty('cursor');
  const journals = await database.transaction(db => db.query<{ changes: string }>('SELECT changes FROM case_workspace_revisions WHERE case_id=$1', [id]));
  expect(journals.every(row => !row.changes.includes('Final words'))).toBe(true);
  const idleQueries = observeQueries();
  const idle = await client.ok<WorkspaceSync>(path + '?since=' + delta.cursor);
  expect(idle).toMatchObject({ kind: 'delta', upserts: [] });
  expect(idleQueries.some(sql => sql.includes('case_entities'))).toBe(false);
});

test('unknown cursors, missing revisions and ordinary mutations recover with full authorized snapshots', async () => {
  const { client, session, id, path, initial } = await fixture();
  expect(await client.ok<WorkspaceSync>(path + '?since=broken')).toMatchObject({ kind: 'snapshot' });
  await mutateWorkspace(session.organization.id, id, w => { w.caseRecord.title = 'Changed outside the stream'; });
  expect(await client.ok<WorkspaceSync>(path + '?since=' + initial.cursor)).toMatchObject({ kind: 'snapshot' });
  const baseline = await client.ok<WorkspaceSync>(path + '?sync=1');
  await mutateWorkspace(session.organization.id, id, w => {
    w.statements.push({ id: 'new', hearingId: 'h', speakerId: 'v1', t: 1, text: 'Final.', phase: 'saved' });
  }, { stream: true });
  await database.transaction(db => db.query('DELETE FROM case_workspace_revisions WHERE case_id=$1', [id]));
  expect(await client.ok<WorkspaceSync>(path + '?since=' + baseline.cursor)).toMatchObject({ kind: 'snapshot' });
});

test('cursor scope, role, epoch, legal settings, trash projection and lost access cannot reuse a delta', async () => {
  const { client, session, id, path, initial } = await fixture();
  await database.transaction(db => db.query("UPDATE case_members SET role='viewer' WHERE case_id=$1 AND user_id=$2", [id, session.user.id]));
  expect(await client.ok<WorkspaceSync>(path + '?since=' + initial.cursor)).toMatchObject({ kind: 'snapshot' });
  await database.transaction(db => db.query("UPDATE cases SET workspace_epoch='recreated' WHERE id=$1", [id]));
  expect(await client.ok<WorkspaceSync>(path + '?since=' + initial.cursor)).toMatchObject({ kind: 'snapshot' });
  const baseline = await client.ok<WorkspaceSync>(path + '?sync=1');
  vi.stubEnv('JUDE_PASAL_TOKEN', 'local-settings-change');
  expect(await client.ok<WorkspaceSync>(path + '?since=' + baseline.cursor)).toMatchObject({ kind: 'snapshot' });
  vi.unstubAllEnvs();
  await database.transaction(db => db.query('INSERT INTO case_trash(case_id,kind,id,body,deleted_at) VALUES($1,$2,$3,$4,$5)', [id, 'documents', 'doc', '{"retained":true}', Date.now()]));
  const projected = await client.ok<WorkspaceSync>(path + '?since=' + baseline.cursor);
  expect(projected.kind).toBe('snapshot');
  if (projected.kind === 'snapshot') {
    expect(projected.workspace.documents).toEqual([]);
    expect(projected.workspace.passages).toEqual([]);
  }
  const other = await fixture();
  expect(await other.client.ok<WorkspaceSync>(other.path + '?since=' + initial.cursor)).toMatchObject({ kind: 'snapshot' });
  await expect(workspaceSync({ ...session, user: { ...session.user, id: other.session.user.id } }, id, initial.cursor)).rejects.toMatchObject({ status: 404 });
  await database.transaction(db => db.query('DELETE FROM case_members WHERE case_id=$1 AND user_id=$2', [id, session.user.id]));
  expect((await client.request(path + '?since=' + initial.cursor)).status).toBe(404);
});

test('reordered or mismatched local snapshots reject a delta and leave the old snapshot untouched', async () => {
  const { initial } = await fixture();
  const before = structuredClone(initial.workspace);
  const change: WorkspaceSync = { kind: 'delta', cursor: 'next', from: before.version, version: before.version + 1, caseRecord: before.caseRecord,
    upserts: [{ kind: 'speakers', ordinal: 3, value: before.speakers[0] }] };
  expect(() => mergeWorkspaceSync(before, change)).toThrow('order changed');
  expect(before).toEqual(initial.workspace);
  expect(() => mergeWorkspaceSync({ ...before, version: 999 }, change)).toThrow('no longer matches');
});
