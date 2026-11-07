import { createHash, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import type { CaseRecord, SessionInfo, Workspace } from '../src/domain';
import { emptyWorkspace, insertWorkspace, makeCase } from '../src/server/cases';
import { bundledArchiveFiles } from '../src/server/bundled-case';
import { transaction } from '../src/server/db';
import * as documents from '../src/server/documents';
import { browser } from './api-client';

const schema = 'jude_guest_' + randomUUID().replaceAll('-', '');
let pg: Client | undefined;
beforeAll(async () => {
  const dsn = process.env.JUDE_TEST_DATABASE_URL;
  if (dsn) {
    pg = new Client({ connectionString: dsn });
    await pg.connect();
    await pg.query('CREATE SCHEMA "' + schema + '"');
    const url = new URL(dsn);
    url.searchParams.set('options', '-c search_path=' + schema);
    process.env.DATABASE_URL = url.href;
  } else {
    delete process.env.DATABASE_URL;
    process.env.JUDE_DB_PATH = ':memory:';
  }
});
afterAll(async () => {
  if (pg) {
    await pg.query('DROP SCHEMA "' + schema + '" CASCADE');
    await pg.end();
  }
});

test('each new guest gets one editable case with linked historical records, two sourced accounts and a startable hearing', async () => {
  const a = browser(), b = browser();
  const [first, second] = await Promise.all([a.ok<SessionInfo>('auth/demo','POST'), b.ok<SessionInfo>('auth/demo','POST')]);
  const {caseId, refs} = first.demo!, path = 'cases/' + caseId;
  expect(caseId).not.toBe(second.demo!.caseId);
  expect((await a.ok<{cases: CaseRecord[]}>('cases')).cases.map(c => [c.id,c.label])).toEqual([[caseId,'private']]);
  expect(refs).toMatchObject({c1:caseId,practice:caseId,d3:'d3',d3p2:'d3p2',h2:'h2',s208:'s208',f1:'f1',h4:'h4'});
  const w = await a.ok<Workspace>(path+'/workspace');
  expect(w.hearings.map(h => [h.id,h.mode])).toEqual([['h1','imported'],['h2','recorded'],['h3','recorded'],['h4','scheduled']]);
  expect(w.statements.every(line => line.phase === 'saved')).toBe(true);
  expect(w.passages.find(p => p.id===refs.d3p2)).toMatchObject({docId:refs.d3,page:7,text:expect.stringContaining('20:07:41')});
  expect(w.findings.find(f => f.id===refs.f1)?.sources.map(s => s.passageId)).toContain(refs.d3p2);
  expect(w.passages.find(p => p.id===refs.d8p2)?.text).toContain('saw Rina Hartati enter');
  expect(w.passages.find(p => p.id===refs.d9p2)?.text).toContain('I first entered at 21:30');
  expect(w.boards).toEqual([]);
  const archive = await bundledArchiveFiles();
  for (const key of ['d3','d4','d8','d9']) {
    const doc = w.documents.find(v => v.id===refs[key])!;
    const reply = await a.request(path+'/documents/'+doc.id+'/original');
    const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
    expect(reply.status).toBe(200);
    expect(digest(new Uint8Array(await reply.arrayBuffer()))).toBe(digest(archive['documents/'+key+'/original.'+doc.file.toLowerCase()]));
    if (key==='d8'||key==='d9') {
      const source = new TextDecoder().decode(archive['documents/'+key+'/original.txt']);
      for (const p of w.passages.filter(p=>p.docId===doc.id)) expect(source).toContain(p.text);
    }
  }
  expect((await b.request(path+'/documents/'+refs.d8+'/original')).status).toBe(404);
  await a.ok(path+'/findings/'+refs.f1,'PATCH',{note:'guest-specific review'});
  expect((await b.ok<Workspace>('cases/'+second.demo!.caseId+'/workspace')).findings.find(f => f.id===refs.f1)?.note).toBe('');
});

test('concurrent upgrades preserve edits and bookmarks in the prior guest case and install one practice archive', async () => {
  const client = browser(), session = await client.ok<SessionInfo>('auth/demo','POST');
  const org = session.organization.id;
  const prior = emptyWorkspace({ ...makeCase({title:'Legacy guest notes'}), label:'synthetic' });
  prior.caseRecord.summary.en = 'Saved by the original guest';
  await transaction(async db => {
    await insertWorkspace(db,org,prior,session.user.id);
    await db.query('UPDATE organizations SET demo_id=$1,demo_refs=$2 WHERE id=$3',[prior.caseRecord.id,JSON.stringify({c1:prior.caseRecord.id,d3:'old-scoped-document'}),org]);
    await db.query('DELETE FROM cases WHERE id=$1 AND org_id=$2',[session.demo!.caseId,org]);
  });
  const before = await client.ok<SessionInfo>('me');
  expect(before.demo?.caseId).toBe(prior.caseRecord.id);
  const [first,second] = await Promise.all([client.ok<SessionInfo>('auth/demo','POST'),client.ok<SessionInfo>('auth/demo','POST')]);
  expect(first.demo).toEqual(second.demo);
  expect(first.demo!.refs['old-scoped-document']).toBe('d3');
  expect(first.demo!.caseId).not.toBe(prior.caseRecord.id);
  expect((await client.ok<Workspace>('cases/'+prior.caseRecord.id+'/workspace')).caseRecord.summary.en).toBe('Saved by the original guest');
  const cases=(await client.ok<{cases:CaseRecord[]}>('cases')).cases;
  expect(cases.map(c=>c.label).sort()).toEqual(['private','synthetic']);
});

test('a failed exhibit install rolls back the organization, its session and every case row', async () => {
  const counts = () => transaction(db => db.query<{cases:number;orgs:number;sessions:number;documents:number}>(
    'SELECT (SELECT count(*) FROM cases) AS cases,(SELECT count(*) FROM organizations) AS orgs,(SELECT count(*) FROM sessions) AS sessions,(SELECT count(*) FROM attachments) AS documents'));
  const prior = await counts(), client = browser();
  const failure = vi.spyOn(documents,'storeFile').mockRejectedValueOnce(new Error('simulated interrupted import'));
  try {
    expect((await client.request('auth/demo','POST')).status).toBe(500);
    expect(await counts()).toEqual(prior);
    expect(client.cookies.has('jude_session')).toBe(false);
  } finally { failure.mockRestore(); }
  expect((await client.ok<SessionInfo>('auth/demo','POST')).demo).toBeTruthy();
});

test('signed-in lawyers can enter the demo route without installing any archive in their organization', async () => {
  const client = browser();
  const account = await client.ok<SessionInfo>('auth/signup', 'POST', {name:'Counsel',email:randomUUID()+'@example.test',password:'Case-practice-22'});
  expect(account.demo).toBeNull();
  expect((await client.ok<SessionInfo>('auth/demo','POST')).demo).toBeNull();
  expect((await client.ok<{cases:CaseRecord[]}>('cases')).cases).toEqual([]);
});
