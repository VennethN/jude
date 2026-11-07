import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Board, CaseDocument, CaseRecord, SessionInfo, Thread, Workspace } from '../src/lib/domain';
import { endpoint } from '../src/lib/server/api';
import { sessionFromToken } from '../src/lib/server/auth';
import { transaction } from '../src/lib/server/db';
import { mutateWorkspace } from '../src/lib/server/cases';
import { runAnalysisWorker } from '../src/lib/server/jobs';

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

function browser() {
  const cookies = new Map<string, string>(),
    ip = randomUUID();
  async function request(path: string, method = 'GET', data?: unknown, key?: string) {
    const url = new URL('/api/' + path, 'http://localhost:5173'),
      headers = new Headers();
    let body: FormData | string | undefined;
    if (data instanceof FormData) body = data;
    else if (data !== undefined) {
      headers.set('content-type', 'application/json');
      body = JSON.stringify(data);
    }
    if (key) headers.set('idempotency-key', key);
    const event = {
      request: new Request(url, { method, headers, body }),
      url,
      params: { path: path.split('?')[0] },
      locals: { session: await sessionFromToken(cookies.get('jude_session')) },
      getClientAddress: () => ip,
      cookies: {
        get: (k: string) => cookies.get(k),
        set: (k: string, v: string) => cookies.set(k, v),
        delete: (k: string) => cookies.delete(k),
      },
    } as unknown as RequestEvent;
    return endpoint(event);
  }
  async function ok<T>(path: string, method = 'GET', data?: unknown, key?: string): Promise<T> {
    const response = await request(path, method, data, key);
    const value = await response.json();
    expect(response.status, JSON.stringify(value)).toBe(200);
    return value as T;
  }
  return { request, ok, cookies };
}

describe('case API', () => {
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
    await a.ok('auth/signup', 'POST', { name: 'Advokat', email, password });
    const key = randomUUID();
    const first = await a.ok<CaseRecord>('cases', 'POST', { title: 'Perkara A' }, key);
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
    const answer = await a.ok<Thread>(base + '/threads/' + t.id + '/messages', 'POST', msg, key);
    expect(answer.messages).toHaveLength(2);
    expect(answer.messages[1].citations?.length).toBeGreaterThan(0);
    expect(
      (await a.ok<Thread>(base + '/threads/' + t.id + '/messages', 'POST', msg, key)).messages,
    ).toHaveLength(2);
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
    await transaction((db) =>
      db.query("UPDATE memberships SET org_id=$1,role='member' WHERE user_id=$2", [
        admin.organization.id,
        user.user.id,
      ]),
    );
    const c = await owner.ok<CaseRecord>('cases', 'POST', { title: 'Restricted' }),
      base = 'cases/' + c.id;
    expect((await member.ok<{ cases: CaseRecord[] }>('cases')).cases).toHaveLength(0);
    expect((await member.request(base + '/workspace')).status).toBe(404);
    await owner.ok(base + '/members/' + user.user.id, 'PUT', { role: 'viewer' });
    expect((await member.ok<Workspace>(base + '/workspace')).caseRecord.id).toBe(c.id);
    expect((await member.request(base, 'PATCH', { title: 'Denied' })).status).toBe(403);
    await owner.ok(base + '/members/' + user.user.id, 'PUT', { role: 'editor' });
    await member.ok(base, 'PATCH', { title: 'Allowed' });
    await owner.ok(base + '/members/' + user.user.id, 'DELETE');
    expect((await member.request(base + '/workspace')).status).toBe(404);
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
});
