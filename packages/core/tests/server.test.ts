import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { strToU8, zipSync } from 'fflate';
import type {
  AnswerStreamEvent,
  Board,
  CaseDocument,
  CaseRecord,
  SessionInfo,
  Thread,
  Workspace,
} from '../src/domain';
import { browser } from './api-client';
import { transaction } from '../src/server/db';
import { mutateWorkspace, seedOrganization } from '../src/server/cases';
import { runAnalysisWorker } from '../src/server/jobs';
import { purgeExpired, retentionMs } from '../src/server/retention';
import { getOriginal, putOriginal } from '../src/server/providers/storage';
import { meter } from '../src/server/billing';
import { storeFile } from '../src/server/documents';
import { demoAssetsDirectory, repositoryRoot } from '../src/server/workspace-paths';

let temporary: string;
beforeAll(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'jude-api-test-'));
  if (process.env.JUDE_TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.JUDE_TEST_DATABASE_URL;
  else delete process.env.DATABASE_URL;
  process.env.JUDE_DB_PATH = join(temporary, 'test.sqlite');
  process.env.JUDE_FILES_DIR = join(temporary, 'originals');
  delete process.env.JUDE_S3_BUCKET;
  delete process.env.OPENAI_API_KEY;
});
afterAll(async () => {
  await rm(temporary, { recursive: true, force: true });
});

describe('case API', () => {
  test('only the recording lawyer can end a hearing after pending audio is cleared', async () => {
    const owner = browser(), outsider = browser();
    const session = await owner.ok<SessionInfo>('auth/signup', 'POST', {
      name: 'Recording lawyer', email: randomUUID() + '@example.test', password: 'Recording-1234',
    });
    await outsider.ok<SessionInfo>('auth/signup', 'POST', {
      name: 'Other lawyer', email: randomUUID() + '@example.test', password: 'Recording-1234',
    });
    const c = await owner.ok<CaseRecord>('cases', 'POST', { title: 'Pending capture' });
    const base = 'cases/' + c.id;
    const hearing = await owner.ok<{ id: string }>(base + '/hearings', 'POST', {
      title: 'Recording', date: '2026-11-07', flow: 'schedule',
    });
    const permission = { by: session.user.id, at: new Date().toISOString(), text: 'Permission granted' };
    await mutateWorkspace(session.organization.id, c.id, (w) => {
      const h = w.hearings.find(h => h.id === hearing.id)!;
      h.mode = 'live';
      h.recordingPermission = permission;
    });
    await transaction(async (db) => {
      await db.query('INSERT INTO voice_turns(case_id,hearing_id,id,start_seconds,bytes) VALUES($1,$2,$3,0,48000)',
        [c.id, hearing.id, 'pending']);
      await db.query('INSERT INTO voice_pending_transcripts(case_id,hearing_id,turn_id,fingerprint) VALUES($1,$2,$3,$4)',
        [c.id, hearing.id, 'pending', 'original-pcm']);
    });
    const end = base + '/hearings/' + hearing.id + '/end';
    expect((await outsider.request(end, 'POST')).status).toBe(404);
    const blocked = await owner.request(end, 'POST');
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({ error: { code: 'audio_pending' } });
    expect((await owner.ok<Workspace>(base + '/workspace')).hearings.find(h => h.id === hearing.id)!.mode).toBe('live');
    await transaction(db => db.query('DELETE FROM voice_pending_transcripts WHERE case_id=$1 AND hearing_id=$2', [c.id, hearing.id]));
    await mutateWorkspace(session.organization.id, c.id, (w) => {
      w.hearings.find(h => h.id === hearing.id)!.recordingPermission = { ...permission, by: 'another-lawyer' };
    });
    expect((await owner.request(end, 'POST')).status).toBe(403);
    await mutateWorkspace(session.organization.id, c.id, (w) => {
      w.hearings.find(h => h.id === hearing.id)!.recordingPermission = permission;
    });
    expect((await owner.ok<{ mode: string }>(end, 'POST')).mode).toBe('recorded');
  });
  test('each visitor has an isolated demo and their cookie resumes it', async () => {
    const a = browser(),
      b = browser();
    expect((await a.request('cases')).status).toBe(401);
    const me = await a.ok<SessionInfo>('auth/demo', 'POST'),
      other = await b.ok<SessionInfo>('auth/demo', 'POST');
    expect(me.demo!.caseId).not.toBe(other.demo!.caseId);
    expect((await a.ok<SessionInfo>('auth/demo', 'POST')).demo).toEqual(me.demo);
    const path = 'cases/' + me.demo!.caseId;
    expect((await b.request(path + '/workspace')).status).toBe(404);
    expect((await b.request(path + '/findings/f1', 'PATCH', { reviewed: true })).status).toBe(404);
    const ws = await a.ok<Workspace>(path + '/workspace');
    expect(ws.findings[0].sources.length).toBeGreaterThan(0);
    expect(ws.documents.length).toBe(5);
    await a.ok(path + '/findings/f1', 'PATCH', { reviewed: true, note: 'Cek halaman empat.' });
    expect((await a.ok<Workspace>(path + '/workspace')).findings.find((f) => f.id === 'f1')!.note).toBe(
      'Cek halaman empat.',
    );
    expect(
      (await b.ok<Workspace>('cases/' + other.demo!.caseId + '/workspace')).findings.find(
        (f) => f.id === 'f1',
      )!.note,
    ).toBe('');
    await a.ok('auth/logout', 'POST');
    expect((await a.request(path + '/workspace')).status).toBe(401);
  });
  test('account sessions, archive and cross-request quotas survive retries', async () => {
    const a = browser(),
      email = randomUUID() + '@example.test',
      password = 'Pribadi-1234';
    const session = await a.ok<SessionInfo>('auth/signup', 'POST', { name: 'Advokat', email, password });
    expect(session.demo).toBeNull();
    expect((await a.ok<{ cases: CaseRecord[] }>('cases')).cases).toEqual([]);
    const key = randomUUID();
    const first = await a.ok<CaseRecord>('cases', 'POST', { title: 'Perkara A' }, key);
    // Reproduce the example records created by an older release for an account with real work.
    const legacy = await transaction(async (db) => {
      await seedOrganization(db, session.organization.id);
      return db.query<{ id: string }>('SELECT id FROM cases WHERE org_id=$1 AND synthetic=1', [session.organization.id]);
    });
    expect(legacy.length).toBeGreaterThan(1);
    expect((await a.ok<SessionInfo>('me')).demo).toBeNull();
    expect((await a.ok<{ cases: CaseRecord[] }>('cases')).cases.map(c => c.id)).toEqual([first.id]);
    expect((await a.ok<{ cases: unknown[] }>('search?q=Gudang')).cases).toEqual([]);
    for (const {id} of legacy) expect((await a.request('cases/' + id + '/workspace')).status).toBe(404);
    expect((await a.ok<CaseRecord>('cases', 'POST', { title: 'Perkara A' }, key)).id).toBe(first.id);
    const attempts = await Promise.all([
      a.request('cases', 'POST', { title: 'Perkara B' }),
      a.request('cases', 'POST', { title: 'Perkara C' }),
    ]);
    expect(attempts.map((v) => v.status).sort()).toEqual([200, 402]);
    await a.ok('cases/' + first.id + '/archive', 'POST');
    expect((await a.request('cases/' + first.id, 'PATCH', { title: 'x' })).status).toBe(409);
    await a.ok('cases/' + first.id + '/unarchive', 'POST');
    await a.ok('me/prefs', 'PATCH', { lang: 'en', theme: 'night' });
    await a.ok('auth/logout', 'POST');
    expect((await a.request('auth/login', 'POST', { email, password: 'wrong' })).status).toBe(401);
    const again = await a.ok<SessionInfo>('auth/login', 'POST', { email, password });
    expect(again.prefs.theme).toBe('night');
    expect((await a.ok<Workspace>('cases/' + first.id + '/workspace')).caseRecord.title).toBe('Perkara A');
  });
  test('board versions, source references and undo remain scoped to the case', async () => {
    const a = browser(),
      session = await a.ok<SessionInfo>('auth/demo', 'POST'),
      base = 'cases/' + session.demo!.caseId;
    expect((await a.ok<Workspace>(base + '/workspace')).boards).toEqual([]);
    const activations = await Promise.all(['f1', 'f3'].map((id) => a.ok<Board>(base + '/boards/first', 'POST', {
      name: 'Papan 1', card: { kind: 'finding', id },
    })));
    expect(activations[0].id).toBe(activations[1].id);
    const initialBoards = (await a.ok<Workspace>(base + '/workspace')).boards;
    expect(initialBoards).toHaveLength(1);
    expect(initialBoards[0].cards.map((c) => c.id).sort()).toEqual(['f1', 'f3']);
    await a.ok(base + '/boards/' + initialBoards[0].id, 'DELETE');
    expect((await a.request(base + '/boards/first', 'POST', {name:'Papan 1', card:{kind:'finding',id:'absent'}})).status).toBe(422);
    expect((await a.ok<Workspace>(base + '/workspace')).boards).toEqual([]);
    const b = await a.ok<Board>(base + '/boards', 'POST', { name: 'Garis waktu' });
    const path = base + '/boards/' + b.id;
    const card = { key: 'finding:f1', kind: 'finding', id: 'f1', x: 0, y: 0, note: 'Periksa' };
    const results = await Promise.all([
      a.request(path, 'PUT', { version: 1, cards: [card] }),
      a.request(path, 'PUT', { version: 1, cards: [card] }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      (
        await a.request(base + '/connections', 'POST', {
          from: { kind: 'passage', id: 'missing' },
          to: { kind: 'statement', id: 's208' },
          relation: 'supports',
        })
      ).status,
    ).toBe(422);
    await a.ok(path, 'DELETE');
    await a.ok(path + '/restore', 'POST');
    expect((await a.ok<Board>(path)).cards[0].note).toBe('Periksa');
    const t = await a.ok<Thread>(base + '/threads', 'POST', {}),
      key = randomUUID();
    const msg = {
      text: 'Kapan kartu masuk di Gerbang Timur?',
      contexts: [{ kind: 'passage', id: 'd3p2' }],
      lang: 'id',
    };
    const messagePath = base + '/threads/' + t.id + '/messages';
    const live = await a.request(messagePath, 'POST', msg, key, 'application/x-ndjson');
    expect(live.headers.get('content-type')).toContain('application/x-ndjson');
    const frames = (await live.text()).trim().split('\n').map(line => JSON.parse(line) as AnswerStreamEvent);
    expect(frames[0]).toEqual({ type: 'status', phase: 'reading' });
    expect(frames.filter(event => event.type !== 'status').map(event => event.type)).toEqual(['partial', 'complete']);
    const preview = frames.find(event => event.type === 'partial')!.message;
    expect(preview.mode).toBe('sources-only');
    const answer = await a.ok<Thread>(messagePath, 'POST', msg, key);
    expect(answer.messages).toHaveLength(2);
    expect(answer.messages[1].citations?.length).toBeGreaterThan(0);
    expect(answer.messages[1].citations).toEqual(preview.citations);
    expect(answer.messages[1].text).toEqual(preview.text);
    expect(frames.at(-1)).toEqual({ type: 'complete', thread: answer });
    const replay = await a.request(messagePath, 'POST', msg, key, 'application/x-ndjson');
    expect((await replay.text()).trim().split('\n').map(line => JSON.parse(line))).toEqual([
      { type: 'status', phase: 'reading' }, { type: 'complete', thread: answer },
    ]);
    const invalid = await a.request(messagePath, 'POST', { ...msg, contexts: [{ kind: 'statement', id: 'absent' }] }, undefined, 'application/x-ndjson');
    expect(invalid.status).toBe(422);
    const outsider = browser();
    await outsider.ok('auth/demo', 'POST');
    expect((await outsider.request(messagePath, 'POST', msg, key, 'application/x-ndjson')).status).toBe(404);
  });
  test('case roles apply to lists, individual reads and mutations', async () => {
    const owner = browser(),
      member = browser();
    const admin = await owner.ok<SessionInfo>('auth/signup', 'POST', {
      name: 'Owner',
      email: randomUUID() + '@example.test',
      password: 'Case-Owner9',
    });
    const user = await member.ok<SessionInfo>('auth/signup', 'POST', {
      name: 'Member',
      email: randomUUID() + '@example.test',
      password: 'Case-Member9',
    });
    const personal = await member.ok<CaseRecord>('cases', 'POST', { title: 'Personal workspace' }),
      token = randomUUID();
    await owner.ok('billing/plan', 'POST', { planId: 'firm', cycle: 'monthly' });
    const tokenHash = createHash('sha256').update(token).digest('hex');
    await transaction((db) =>
      db.query(
        "INSERT INTO auth_tokens(token_hash,purpose,subject,email,role,expires_at) VALUES($1,'invite',$2,$3,'member',$4)",
        [tokenHash, admin.organization.id, user.user.email, Date.now() + 60000],
      ),
    );
    const outsider = browser();
    expect(
      (
        await outsider.request('auth/invite', 'POST', {
          token,
          name: 'Unauthorised',
          password: 'wrong passphrase',
        })
      ).status,
    ).toBe(401);
    const invited = await member.ok<SessionInfo>('auth/invite', 'POST', { token });
    expect(invited.user.id).toBe(user.user.id);
    expect(invited.organization.id).toBe(admin.organization.id);
    const c = await owner.ok<CaseRecord>('cases', 'POST', { title: 'Restricted' }),
      base = 'cases/' + c.id;
    expect((await member.ok<{ cases: CaseRecord[] }>('cases')).cases).toEqual([]);
    expect((await member.request(base + '/workspace')).status).toBe(404);
    await owner.ok(base + '/members/' + user.user.id, 'PUT', { role: 'viewer' });
    expect((await member.ok<Workspace>(base + '/workspace')).caseRecord.id).toBe(c.id);
    expect((await member.request(base, 'PATCH', { title: 'Denied' })).status).toBe(403);
    await owner.ok(base + '/members/' + user.user.id, 'PUT', { role: 'editor' });
    await member.ok(base, 'PATCH', { title: 'Allowed' });
    await owner.ok(base + '/members/' + user.user.id, 'DELETE');
    expect((await member.request(base + '/workspace')).status).toBe(404);
    expect((await member.ok<{ organizations: { id: string }[] }>('orgs')).organizations).toHaveLength(2);
    await member.ok('org/switch', 'POST', { orgId: user.organization.id });
    expect((await member.ok<Workspace>('cases/' + personal.id + '/workspace')).caseRecord.title).toBe(
      'Personal workspace',
    );
    await owner.ok('org/members/' + user.user.id, 'DELETE');
    expect((await member.request('org/switch', 'POST', { orgId: admin.organization.id })).status).toBe(404);
    expect((await member.ok<SessionInfo>('me')).organization.id).toBe(user.organization.id);
  });
  test('queued final statements recover after restart without a model provider', async () => {
    const a = browser(),
      session = await a.ok<SessionInfo>('auth/signup', 'POST', {
        name: 'Counsel',
        email: randomUUID() + '@example.test',
        password: 'Evidence-1234',
      });
    const c = await a.ok<CaseRecord>('cases', 'POST', { title: 'Private docket' }),
      path = 'cases/' + c.id;
    expect(
      (
        await a.request(path + '/hearings', 'POST', {
          flow: 'live',
          date: '2026-11-04',
          title: 'Closed',
          closed: true,
          recordingPermission: true,
        })
      ).status,
    ).toBe(422);
    const h = await a.ok<{ id: string }>(path + '/hearings/import', 'POST', {
      title: 'Hearing',
      date: '2026-11-04',
      turns: [{ speaker: 'Witness', time: 0, text: 'The door was closed.' }],
    });
    await mutateWorkspace(session.organization.id, c.id, (w) => {
      w.statements[0].phase = 'queued';
    });
    const jobs = await transaction((db) =>
      db.query('SELECT statement_id FROM analysis_jobs WHERE case_id=$1', [c.id]),
    );
    expect(jobs).toHaveLength(1);
    await transaction((db) => db.query('DELETE FROM analysis_jobs WHERE case_id=$1', [c.id]));
    const stop = runAnalysisWorker();
    try {
      await expect
        .poll(
          async () =>
            (await a.ok<Workspace>(path + '/workspace')).statements.find((s) => s.hearingId === h.id)?.phase,
          { timeout: 6000, interval: 100 },
        )
        .toBe('saved');
    } finally {
      stop();
    }
  });

  test('private originals, transcript import and .jude round trips preserve source text', async () => {
    const a = browser(),
      outsider = browser();
    await a.ok('auth/demo', 'POST');
    await outsider.ok('auth/demo', 'POST');
    const c = await a.ok<CaseRecord>('cases', 'POST', { title: 'Perkara uji' }),
      base = 'cases/' + c.id;
    const form = new FormData();
    form.set(
      'file',
      new File(['Log akses gudang.\n\nCatatan gerbang pukul 20.00.'], 'log.txt', { type: 'text/plain' }),
    );
    const doc = await a.ok<CaseDocument>(base + '/documents', 'POST', form);
    const file = await a.request(base + '/documents/' + doc.id + '/original');
    expect(await file.text()).toContain('20.00');
    expect((await outsider.request(base + '/documents/' + doc.id + '/original')).status).toBe(404);
    const preview = new FormData();
    preview.set(
      'file',
      new File(['WEBVTT\n\n00:01.000 --> 00:03.000\n<v Saksi>Gerbang tertutup.\n'], 'sidang.vtt'),
    );
    const parsed = await a.ok<{ turns: { text: string }[] }>(
      base + '/hearings/import/preview',
      'POST',
      preview,
    );
    expect(parsed.turns[0].text).toBe('Gerbang tertutup.');
    await a.ok(base + '/hearings/import', 'POST', {
      title: 'Persidangan',
      date: '2026-11-04',
      turns: parsed.turns,
    });
    const zip = await a.request(base + '/export');
    expect(zip.status).toBe(200);
    const upload = new FormData();
    upload.set('file', new File([await zip.arrayBuffer()], 'case.jude'));
    const restored = await a.ok<CaseRecord>('cases/import', 'POST', upload);
    const data = await a.ok<Workspace>('cases/' + restored.id + '/workspace');
    expect(restored.id).not.toBe(c.id);
    expect(data.documents[0].id).not.toBe(doc.id);
    expect(data.passages[1].docId).toBe(data.documents[0].id);
    expect(data.statements[0].text).toBe('Gerbang tertutup.');
    expect(
      (await a.request('cases/' + restored.id + '/documents/' + data.documents[0].id + '/original')).status,
    ).toBe(200);
  });
  test('a case stored in a ZIP manifest restores its originals and linked testimony, including from a folder', async () => {
    const client = browser();
    await client.ok('auth/demo', 'POST');
    const original = 'Packing list, sheet 1.';
    const digest = createHash('sha256').update(original).digest('hex');
    const manifest = {
      format: 'jude', version: 1, kind: 'case',
      case: { id: 'c1', title: 'Harbour exercise', created_at: '2026-11-07' },
      documents: [{ id: 'd1', case_id: 'c1', name: 'Packing list', mime: 'text/plain', pages: 1, file: 'originals/d1', sha256: digest }],
      sources: [{ id: 'p1', document_id: 'd1', page: 1, text: original }],
      hearings: [{ id: 'h1', case_id: 'c1', title: 'Hearing', date: '2026-11-07', kind: 'imported' }],
      segments: [{ id: 's1', hearing_id: 'h1', speaker: 'Witness A', start: 3, end: 6, text: 'One sheet.' }],
      links: [{ id: 'pair', source_id: 's1', target_id: 'p1', relation: 'supports', confirmed: true, basis: 'manual', source_quote: 'One sheet.', target_quote: 'sheet 1' }],
    };
    function form(bytes: string) {
      const zip = zipSync({
        'Case export/manifest.json': strToU8(JSON.stringify(manifest)),
        'Case export/originals/d1': strToU8(bytes),
        '__MACOSX/._manifest.json': strToU8(''),
      });
      const form = new FormData();
      form.set('file', new File([new Uint8Array(zip)], 'export.jude.zip', { type: 'application/zip' }));
      return form;
    }
    const damaged = await client.request('cases/import', 'POST', form('Incomplete'));
    expect(damaged.status).toBe(422);
    expect((await damaged.json()).error.code).toBe('archive_integrity');
    const imported = await client.ok<CaseRecord>('cases/import', 'POST', form(original));
    const base = 'cases/' + imported.id;
    const workspace = await client.ok<Workspace>(base + '/workspace');
    expect(workspace.statements[0]).toMatchObject({ t: 3, speakerId: workspace.speakers[0].id, hearingId: workspace.hearings[0].id });
    expect(workspace.passages[0]).toMatchObject({ text: original, docId: workspace.documents[0].id });
    expect(workspace.connections[0]).toMatchObject({
      from: { kind: 'statement', id: workspace.statements[0].id },
      to: { kind: 'passage', id: workspace.passages[0].id }, reviewed: true,
    });
    expect(await (await client.request(base + '/documents/' + workspace.documents[0].id + '/original')).text()).toBe(original);
  });
  test('synthetic originals and all linked records round-trip through the archive', async () => {
    const a = browser(),
      session = await a.ok<SessionInfo>('auth/demo', 'POST'),
      source = 'cases/' + session.demo!.caseId;
    expect(repositoryRoot(join(repositoryRoot(), 'apps/web'))).toBe(repositoryRoot());
    const original = await a.request(source + '/documents/d4/original');
    expect(original.headers.get('content-type')).toContain('wordprocessingml');
    expect([...new Uint8Array(await original.arrayBuffer()).slice(0, 2)]).toEqual([80, 75]);
    await a.ok(source + '/findings/f1', 'PATCH', { reviewed: true, note: 'Reviewed source' });
    const zip = await a.request(source + '/export');
    expect(zip.status).toBe(200);
    const f = new FormData();
    f.set('file', new File([await zip.arrayBuffer()], 'synthetic.jude'));
    const imported = await a.ok<CaseRecord>('cases/import', 'POST', f);
    const w = await a.ok<Workspace>('cases/' + imported.id + '/workspace');
    const finding = w.findings.find((item) => item.note === 'Reviewed source')!;
    expect(finding.reviewed).toBe(true);
    expect(w.statements.some((s) => s.id === finding.statementId)).toBe(true);
    expect(w.passages.some((p) => p.id === finding.sources[0].passageId)).toBe(true);
    expect(w.threads.filter((t) => t.sample)).toHaveLength(4);
    const sourceDoc = w.documents.find((d) => d.file === 'DOCX')!;
    expect(sourceDoc.original).toContain(imported.id);
    expect(sourceDoc.pdf).toContain('/viewer');
  });

  test('archive transfers include private recordings and only retained microphone turns', async () => {
    const a = browser(),
      session = await a.ok<SessionInfo>('auth/demo', 'POST'),
      org = session.organization.id;
    const c = await a.ok<CaseRecord>('cases', 'POST', { title: 'Private recording' }),
      base = 'cases/' + c.id;
    const h = await a.ok<{ id: string }>(base + '/hearings/import', 'POST', {
      title: 'Recording',
      date: '2026-11-07',
      turns: [{ speaker: 'Counsel', time: 0, text: 'A statement.' }],
    });
    const audio = new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 65, 86, 69]),
      pcm = new Uint8Array([0, 0, 3, 0]);
    const prefix = [org, c.id, h.id].join('/');
    await putOriginal(prefix + '/audio', audio, 'audio/wav');
    await putOriginal(prefix + '/turn-one.pcm', pcm, 'application/octet-stream');
    await transaction(async (db) => {
      await storeFile(db, {
        case_id: c.id,
        entity_id: h.id,
        kind: 'audio',
        object_key: prefix + '/audio',
        file_name: 'hearing.wav',
        mime: 'audio/wav',
        byte_length: audio.length,
      });
      await db.query(
        'INSERT INTO voice_turns(case_id,hearing_id,id,start_seconds,bytes,object_key) VALUES($1,$2,$3,0,4,$4),($1,$2,$5,1,8,NULL)',
        [c.id, h.id, 'turn-one', prefix + '/turn-one.pcm', 'turn-two'],
      );
      await meter(db, org, 'hours', 0.5);
    });
    const bill = await a.ok<{ usage: { hours: { used: number }; storage: { used: number } } }>('billing');
    expect(bill.usage.hours.used).toBeCloseTo(0.5 / 3600);
    expect(bill.usage.storage.used).toBe((audio.length + pcm.length) / 1e9);
    const zip = await a.request(base + '/export'),
      form = new FormData();
    form.set('file', new File([await zip.arrayBuffer()], 'recording.jude'));
    const restored = await a.ok<CaseRecord>('cases/import', 'POST', form);
    const state = await a.ok<Workspace>('cases/' + restored.id + '/workspace'),
      restoredHearing = state.hearings[0];
    expect(restoredHearing.audio).toBe('/api/live/' + restored.id + '/' + restoredHearing.id + '/audio');
    expect(await getOriginal([org, restored.id, restoredHearing.id, 'audio'].join('/'))).toEqual(
      Buffer.from(audio),
    );
    const turns = await transaction((db) =>
      db.query<{ object_key: string | null }>(
        'SELECT object_key FROM voice_turns WHERE case_id=$1 ORDER BY start_seconds',
        [restored.id],
      ),
    );
    expect(await getOriginal(turns[0].object_key!)).toEqual(Buffer.from(pcm));
    expect(turns[1].object_key).toBeNull();
  });
  test('source removal preserves review history, archive snapshots, board edits and overlapping Undo', async () => {
    const a = browser(),
      me = await a.ok<SessionInfo>('auth/demo', 'POST'),
      base = 'cases/' + me.demo!.caseId;
    const docPath = base + '/documents/d1';
    const board = await a.ok<Board>(base + '/boards', 'POST', { name: 'Preparation' });
    const boardPath = base + '/boards/' + board.id;
    const card = {
      key: 'passage:d1p4',
      kind: 'passage',
      id: 'd1p4',
      x: 10,
      y: 20,
      note: 'Keep this position',
    };
    await a.ok(boardPath, 'PUT', { version: board.version, cards: [card] });
    const deleted = await a.ok<{ citedFindings: number }>(docPath, 'DELETE');
    expect(deleted.citedFindings).toBeGreaterThan(0);
    let state = await a.ok<Workspace>(base + '/workspace');
    expect(state.passages.some((p) => p.docId === 'd1')).toBe(false);
    expect((await a.request(docPath + '/original')).status).toBe(404);
    expect(state.boards.find((b) => b.id === board.id)!.cards).toHaveLength(0);
    const lost = state.findings.find((f) => f.unavailableSources?.some((s) => s.passageId === 'd1p4'))!;
    expect(lost).toBeDefined();
    const patched = await a.ok<typeof lost>(base + '/findings/' + lost.id, 'PATCH', {
      note: 'Checked the missing exhibit',
    });
    expect(patched.sources.some((s) => s.passageId === 'd1p4')).toBe(false);
    expect(
      state.threads
        .flatMap((t) => t.messages.flatMap((m) => m.citations ?? []))
        .some((c) => c.unavailable && c.snapshot),
    ).toBe(true);
    await a.ok(boardPath, 'PUT', {
      version: state.boards.find((b) => b.id === board.id)!.version,
      cards: [],
      name: 'Updated preparation',
    });
    const zip = await a.request(base + '/export'),
      form = new FormData();
    form.set('file', new File([await zip.arrayBuffer()], 'removed.jude'));
    const clone = await a.ok<CaseRecord>('cases/import', 'POST', form);
    const copy = await a.ok<Workspace>('cases/' + clone.id + '/workspace');
    expect(copy.findings.some((f) => f.unavailableSources?.length)).toBe(true);
    expect(
      copy.threads
        .flatMap((t) => t.messages.flatMap((m) => m.citations ?? []))
        .some((c) => c.unavailable && c.snapshot),
    ).toBe(true);
    await a.ok(base + '/hearings/h2', 'DELETE');
    expect((await a.ok<Workspace>(base + '/workspace')).statements.some((s) => s.hearingId === 'h2')).toBe(
      false,
    );
    await a.ok(docPath + '/restore', 'POST');
    await a.ok(base + '/hearings/h2/restore', 'POST');
    state = await a.ok<Workspace>(base + '/workspace');
    expect(state.findings.find((f) => f.id === lost.id)).toMatchObject({
      note: 'Checked the missing exhibit',
    });
    expect(state.findings.find((f) => f.id === lost.id)!.sources.some((s) => s.passageId === 'd1p4')).toBe(
      true,
    );
    expect(state.boards.find((b) => b.id === board.id)!.cards[0]).toMatchObject(card);
    expect(state.boards.find((b) => b.id === board.id)!.name).toBe('Updated preparation');
  });
  test('deletion releases storage immediately and the retention worker purges originals and case data', async () => {
    const a = browser(),
      me = await a.ok<SessionInfo>('auth/demo', 'POST');
    const c = await a.ok<CaseRecord>('cases', 'POST', { title: 'Retention' }),
      base = 'cases/' + c.id;
    const file = new FormData(),
      content = 'Original hearing note for retention.';
    file.set('file', new File([content], 'proof.txt', { type: 'text/plain' }));
    const doc = await a.ok<CaseDocument>(base + '/documents', 'POST', file, 'proof-file');
    const docPath = base + '/documents/' + doc.id,
      key = [me.organization.id, c.id, doc.id, 'original'].join('/');
    const usage = async () =>
      (await a.ok<{ usage: { storage: { used: number } } }>('billing')).usage.storage.used;
    expect(await usage()).toBe(content.length / 1e9);
    await a.ok(docPath, 'DELETE');
    expect(await usage()).toBe(0);
    await a.ok(docPath + '/restore', 'POST');
    expect(await usage()).toBe(content.length / 1e9);
    await a.ok(docPath, 'DELETE');
    await transaction((db) =>
      db.query('UPDATE case_trash SET deleted_at=$1 WHERE case_id=$2 AND id=$3', [
        Date.now() - retentionMs() - 1000,
        c.id,
        doc.id,
      ]),
    );
    await purgeExpired();
    await expect(getOriginal(key)).rejects.toThrow();
    expect((await a.request(docPath + '/restore', 'POST')).status).toBe(404);
    expect(
      await transaction((db) =>
        db.query('SELECT id FROM case_entities WHERE case_id=$1 AND id=$2', [c.id, doc.id]),
      ),
    ).toHaveLength(0);
    const replacement = await a.ok<CaseDocument>(base + '/documents', 'POST', file);
    const replacementKey = [me.organization.id, c.id, replacement.id, 'original'].join('/');
    await a.ok(base, 'DELETE');
    await a.ok(base + '/restore', 'POST');
    expect(await getOriginal(replacementKey)).toEqual(Buffer.from(content));
    await a.ok(base, 'DELETE');
    await transaction((db) =>
      db.query('UPDATE cases SET deleted_at=$1 WHERE id=$2', [Date.now() - retentionMs() - 1000, c.id]),
    );
    await purgeExpired();
    await expect(getOriginal(replacementKey)).rejects.toThrow();
    expect(await transaction((db) => db.query('SELECT id FROM cases WHERE id=$1', [c.id]))).toHaveLength(0);
    expect((await a.request(base + '/restore', 'POST')).status).toBe(404);
    const queuedKey = 'retention-test/' + randomUUID();
    const directoryAtKey = join(temporary, 'originals', queuedKey);
    await mkdir(directoryAtKey, { recursive: true });
    await transaction((db) =>
      db.query('INSERT INTO purge_objects(object_key,available_at) VALUES($1,0)', [queuedKey]),
    );
    await purgeExpired();
    expect(
      (
        await transaction((db) =>
          db.query<{ attempts: number }>('SELECT attempts FROM purge_objects WHERE object_key=$1', [
            queuedKey,
          ]),
        )
      )[0].attempts,
    ).toBe(1);
    await rm(directoryAtKey, { recursive: true, force: true });
    await transaction((db) =>
      db.query('UPDATE purge_objects SET available_at=0 WHERE object_key=$1', [queuedKey]),
    );
    await purgeExpired();
    expect(
      await transaction((db) =>
        db.query('SELECT object_key FROM purge_objects WHERE object_key=$1', [queuedKey]),
      ),
    ).toHaveLength(0);
  });
  test('indexes the filed PDF and DOCX without remote services', async () => {
    const a = browser();
    await a.ok('auth/demo', 'POST');
    const c = await a.ok<CaseRecord>('cases', 'POST', { title: 'Intake' }),
      base = 'cases/' + c.id;
    for (const [name, mime] of [
      ['d1.pdf', 'application/pdf'],
      ['d4.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ]) {
      const bytes = await readFile(join(demoAssetsDirectory(), name));
      const form = new FormData();
      form.set('file', new File([new Uint8Array(bytes)], name, { type: mime }));
      const doc = await a.ok<CaseDocument>(base + '/documents', 'POST', form);
      const w = await a.ok<Workspace>(base + '/workspace');
      expect(doc.status).toBe('ready');
      const text = w.passages.filter((p) => p.docId === doc.id);
      expect(text.length).toBeGreaterThan(0);
      expect(text.map((p) => p.text).join(' ')).toContain(name === 'd1.pdf' ? 'Hartati' : 'Dakwaan');
      expect(
        new Uint8Array(await (await a.request(base + '/documents/' + doc.id + '/original')).arrayBuffer()),
      ).toEqual(new Uint8Array(bytes));
    }
  }, 60000);
});
