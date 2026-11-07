import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import { Client } from 'pg';
import type { CaseRecord, ContextRef, LegalRef, SessionInfo, Thread, Workspace } from '../src/domain';
import { mutateWorkspace } from '../src/server/cases';
import { transaction } from '../src/server/db';
import { runAnalysisWorker } from '../src/server/jobs';
import * as model from '../src/server/providers/openai';
import { legal as sampleLaws } from '../src/server/seed';
import { browser } from './api-client';

const ttl = 30 * 24 * 60 * 60 * 1000;
const secret = 'Private witness Riana at 08123456789';
const excludedContent = 'Article content outside the discovery metadata';
const uri = '/akn/id/act/uu/1981/8';
const rootHref = '/peraturan/uu/uu-no-8-tahun-1981';
const href = rootHref + '/pasal-185';
const work = {
  frbr_uri: uri,
  type: 'UU',
  number: '8',
  year: 1981,
  title: 'Hukum Acara Pidana',
  status: 'berlaku',
};
const hit = {
  work,
  snippet: excludedContent,
  matching_pasals: ['185'],
  best_passage: { version: 1, pasal_number: '185', href, work_href: rootHref },
};

let testDatabase: Client | undefined;
const schema = 'jude_pasal_test_' + randomUUID().replaceAll('-', '');

beforeAll(async () => {
  const postgres = process.env.JUDE_TEST_DATABASE_URL;
  if (postgres) {
    testDatabase = new Client({ connectionString: postgres });
    await testDatabase.connect();
    await testDatabase.query('CREATE SCHEMA "' + schema + '"');
    const dsn = new URL(postgres);
    dsn.searchParams.set('options', '-c search_path=' + schema);
    process.env.DATABASE_URL = dsn.href;
  } else {
    delete process.env.DATABASE_URL;
    process.env.JUDE_DB_PATH = ':memory:';
  }
  delete process.env.OPENAI_API_KEY;
});

afterAll(async () => {
  if (!testDatabase) return;
  try {
    await testDatabase.query('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE');
  } finally {
    await testDatabase.end();
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function network(answer: (url: URL) => Response) {
  const credential = 'test-only-' + randomUUID();
  vi.stubEnv('JUDE_PASAL_TOKEN', credential);
  const controller = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    expect(request.method).toBe('GET');
    expect(request.redirect).toBe('error');
    expect(request.headers.get('authorization')).toBe('Bearer ' + credential);
    expect(request.url).not.toContain(credential);
    const url = new URL(request.url);
    expect(url.origin).toBe('https://pasal.id');
    return answer(url);
  });
  return controller;
}

async function caseThread(synthetic = false) {
  const client = browser();
  const session = synthetic
    ? await client.ok<SessionInfo>('auth/demo', 'POST')
    : await client.ok<SessionInfo>('auth/signup', 'POST', {
        name: 'Counsel',
        email: randomUUID() + '@example.test',
        password: 'Docket-1234',
      });
  const caseId = synthetic
    ? session.demo!.caseId
    : (await client.ok<CaseRecord>('cases', 'POST', { title: 'Riana private docket' })).id;
  const base = 'cases/' + caseId;
  const thread = await client.ok<Thread>(base + '/threads', 'POST', {});
  const messages = base + '/threads/' + thread.id + '/messages';
  const send = (
    text: string,
    settings: { withLegal?: boolean; contexts?: ContextRef[] } = {},
    key?: string,
  ) => client.ok<Thread>(messages, 'POST', { text, lang: 'en', ...settings }, key);
  const workspace = () => client.ok<Workspace>(base + '/workspace');
  return { client, base, messages, send, workspace, session, caseId };
}

test('private messages resolve public identifiers only and save immutable, case-local law references', async () => {
  const c = await caseThread();
  await c.client.ok(c.base + '/hearings/import', 'POST', {
    title: 'Deposition',
    date: '2026-10-08',
    turns: [{ speaker: 'Witness', time: 5, text: secret + ' cited KUHAP Pasal 185.' }],
  });
  const [statement] = (await c.workspace()).statements;
  const contexts: ContextRef[] = [{ kind: 'statement', id: statement.id }];
  await mutateWorkspace(c.session.organization.id, c.caseId, (w) => {
    w.legal.push({ ...sampleLaws[0] });
    w.statements[0].legal = [sampleLaws[0].id];
  });
  let status = 'berlaku';
  const requests: URL[] = [];
  network((url) => {
    requests.push(url);
    if (url.pathname === '/api/v1/search') {
      expect([...url.searchParams]).toEqual([
        ['q', 'Pasal 185 KUHAP'],
        ['limit', '3'],
      ]);
      return Response.json({ results: [hit, hit, { ...hit, work: { ...work, title: 'Wrong legal code' } }] });
    }
    expect(url.pathname).toBe('/api/v1/laws' + uri);
    return Response.json({ work: { ...work, status }, articles: [{ text: excludedContent }] });
  });
  expect((await c.workspace()).legalDiscovery).toBe('available');
  const key = randomUUID();
  const question = secret + ' asks about the cited article.';
  const thread = await c.send(question, { contexts }, key);
  const answer = thread.messages[1];
  expect(answer.citations).toEqual([{ kind: 'statement', id: statement.id }]);
  expect(answer.text).toContain(secret);
  expect(answer.legal).toEqual([expect.stringMatching(/^pasal-[a-f0-9]{32}$/)]);
  expect(requests).toHaveLength(2);
  const id = answer.legal![0];
  const snapshot = await c.client.ok<LegalRef>(c.base + '/legal/' + id);
  expect(snapshot).toMatchObject({
    provider: 'pasal',
    article: 'Pasal 185',
    sourceUrl: 'https://pasal.id' + href,
  });
  expect(snapshot.summary.en).toContain('berlaku');
  expect(JSON.stringify(snapshot)).not.toContain(excludedContent);
  expect((await c.send(question, { contexts }, key)).messages).toEqual(thread.messages);
  expect((await c.send('Pasal 185 KUHAP? ' + secret)).messages.at(-1)?.legal).toEqual([id]);
  const outsider = await caseThread();
  expect((await outsider.client.request(c.base + '/legal/' + id)).status).toBe(404);
  expect((await outsider.workspace()).legal).toEqual([]);
  expect(requests).toHaveLength(2);
  const cached = await transaction((db) =>
    db.query<{ cache_key: string; metadata: string; expires_at: number | string }>(
      'SELECT cache_key, metadata, expires_at FROM pasal_metadata_cache',
    ),
  );
  const ours = cached.filter((row) => row.metadata.includes(uri));
  expect(ours).toHaveLength(2);
  for (const row of ours) {
    expect(row.cache_key).toMatch(/^(search|work):[a-f0-9]{64}$/);
    expect(Number(row.expires_at) - Date.now()).toBeGreaterThan(ttl - 10000);
    expect(Number(row.expires_at) - Date.now()).toBeLessThanOrEqual(ttl);
    expect(row.metadata).not.toContain(excludedContent);
    expect(row.metadata).not.toContain(secret);
  }
  await transaction(async (db) => {
    for (const row of ours)
      await db.query('UPDATE pasal_metadata_cache SET expires_at=0 WHERE cache_key=$1', [row.cache_key]);
  });
  status = 'dicabut';
  expect((await c.send('KUHAP, Pasal 185?', { contexts })).messages.at(-1)?.legal).toEqual([id]);
  expect(requests).toHaveLength(4);
  expect(await c.client.ok(c.base + '/legal/' + id)).toEqual(snapshot);
  expect((await outsider.send('KUHAP, Pasal 185?')).messages[1].legal).toEqual([id]);
  expect((await outsider.client.ok<LegalRef>(outsider.base + '/legal/' + id)).summary.en).toContain(
    'dicabut',
  );
  expect(requests).toHaveLength(4);
});

test('synthetic discovery uses the six labelled examples and respects the message toggle', async () => {
  const fetch = network(() => Response.error());
  const c = await caseThread(true);
  const initial = await c.workspace();
  expect(initial.legalDiscovery).toBe('sample');
  expect(initial.legal).toHaveLength(6);
  expect(initial.legal.every((row) => row.provider === 'sample')).toBe(true);
  expect((await c.send('Pasal 185 KUHAP')).messages.at(-1)?.legal).toEqual(['lg1']);
  expect((await c.send('Pasal 185 KUHAP', { withLegal: false })).messages.at(-1)?.legal).toBeUndefined();
  expect((await c.send('Pasal 9876 KUHAP')).messages.at(-1)?.legal).toBeUndefined();
  expect((await c.client.request(c.messages, 'POST', { text: 'Pasal 185', withLegal: 'false' })).status).toBe(
    422,
  );
  expect(fetch).not.toHaveBeenCalled();
});

test('provider outages, missing keys and non-regulatory private questions preserve grounded answers', async () => {
  vi.stubEnv('JUDE_PASAL_TOKEN', undefined);
  const c = await caseThread();
  await c.client.ok(c.base + '/hearings/import', 'POST', {
    title: 'Notes',
    date: '2026-10-08',
    turns: [{ speaker: 'Witness', time: 1, text: secret }],
  });
  const contexts: ContextRef[] = [{ kind: 'statement', id: (await c.workspace()).statements[0].id }];
  expect((await c.workspace()).legalDiscovery).toBe('unavailable');
  expect((await c.send('Pasal 809', { contexts })).messages.at(-1)).toMatchObject({
    mode: 'sources-only',
    citations: contexts,
  });
  const fetch = network(() => new Response(null, { status: 429 }));
  expect((await c.send(secret, { contexts })).messages.at(-1)?.legal).toBeUndefined();
  expect(
    (await c.send('Undang-Undang No. 5 Tahun 2025', { withLegal: false, contexts })).messages.at(-1)?.legal,
  ).toBeUndefined();
  expect(fetch).not.toHaveBeenCalled();
  const answer = (await c.send(secret + ' UU 5/2025', { contexts })).messages.at(-1)!;
  expect(new URL(String(fetch.mock.calls[0][0])).searchParams.get('q')).toBe('UU Nomor 5 Tahun 2025');
  expect(answer.text).toContain(secret);
  expect(answer.legal).toBeUndefined();
  expect((await c.workspace()).legalDiscovery).toBe('unavailable');
  expect((await c.send('Pasal 809', { contexts })).messages.at(-1)?.legal).toBeUndefined();
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('discovery validates article locators and caps the shared metadata cache', async () => {
  const c = await caseThread();
  const term = 'ketenagakerjaan';
  const raw = {
    ...work,
    frbr_uri: '/akn/id/act/uu/2003/13',
    number: '13',
    year: 2003,
    title: 'Ketenagakerjaan',
  };
  const requests = network((url) => {
    if (url.pathname.startsWith('/api/v1/laws/')) return new Response(null, { status: 503 });
    const q = url.searchParams.get('q');
    if (q === term)
      return Response.json({
        results: [
          {
            work: { ...raw, status_uncertain: true },
            best_passage: {
              version: 1,
              pasal_number: '89',
              href: 'https://example.org/not-a-source',
              work_href: '/peraturan/uu/uu-no-13-tahun-2003',
            },
          },
        ],
      });
    expect(q).toBe('Pasal 998 UU Nomor 13 Tahun 2003');
    return Response.json({
      results: [
        { work: raw, matching_pasals: ['800'], best_passage: { version: 9, pasal_number: '998', href } },
        { ...hit, work, matching_pasals: ['998'] },
      ],
    });
  });
  const now = Date.now();
  await transaction(async (db) => {
    for (let i = 0; i < 258; i++)
      await db.query(
        'INSERT INTO pasal_metadata_cache(cache_key,metadata,expires_at) VALUES($1,$2,$3) ON CONFLICT(cache_key) DO NOTHING',
        ['bound-test-' + i, '[]', now + 60000],
      );
    await db.query('UPDATE pasal_metadata_cache SET expires_at=0 WHERE cache_key=$1', ['bound-test-0']);
  });
  const result = (await c.send(secret + ' asks about employment law.')).messages[1].legal!;
  expect(requests).toHaveBeenCalledTimes(2);
  const ref = await c.client.ok<LegalRef>(c.base + '/legal/' + result[0]);
  expect(ref.sourceUrl).toBe('https://pasal.id/peraturan/uu/uu-no-13-tahun-2003');
  expect(ref.summary.en).not.toContain('berlaku');
  expect((await c.send('Pasal 998 UU No. 13 Tahun 2003')).messages.at(-1)?.legal).toBeUndefined();
  const rows = await transaction((db) =>
    db.query<{ cache_key: string }>('SELECT cache_key FROM pasal_metadata_cache'),
  );
  expect(rows.length).toBeLessThanOrEqual(256);
  expect(rows.map((row) => row.cache_key)).not.toContain('bound-test-0');
});

test.each(['verified', 'uncited', 'outage'] as const)(
  'finding analysis retains the source comparison and hearing line with %s legal discovery',
  async (scenario) => {
    const c = await caseThread();
    const said = 'Saya menandatangani daftar kehadiran.';
    const quote =
      scenario === 'uncited'
        ? 'Daftar kehadiran telah diserahkan.'
        : 'Daftar kehadiran mencatat Pasal ' +
          (scenario === 'verified' ? '288' : '289') +
          ' UU Nomor 20 Tahun 2025.';
    const h = await c.client.ok<{ id: string }>(c.base + '/hearings/import', 'POST', {
      title: 'Examination',
      date: '2026-10-08',
      turns: [{ speaker: 'Witness', time: 8, text: secret + ' KUHAP Pasal 994. ' + said }],
    });
    const [line] = (await c.workspace()).statements;
    const docId = randomUUID(),
      passageId = randomUUID();
    await mutateWorkspace(c.session.organization.id, c.caseId, (w) => {
      w.documents.push({
        id: docId,
        caseId: c.caseId,
        title: 'Private attendance record',
        kind: { id: 'Catatan', en: 'Record' },
        pages: 1,
        file: 'TXT',
        size: '1 KB',
        added: '2026-10-08',
      });
      w.passages.push({
        id: passageId,
        docId,
        page: 1,
        text: secret + ' cites KUHP Pasal 995 outside the finding quotation. ' + quote,
      });
      w.statements[0].phase = 'queued';
    });
    const l10n = { id: 'Periksa dokumen pendukung.', en: 'Check the supporting record.' };
    const question = { id: 'Dapatkah Anda memeriksa tanggalnya?', en: 'Could you check the date?' };
    const ai = vi.spyOn(model, 'structured').mockImplementation(async (task) =>
      task === 'review'
        ? { accept: true }
        : {
            checkable: true,
            status: 'context_needed',
            said,
            title: l10n,
            explanation: l10n,
            verify: l10n,
            uncertainty: l10n,
            question,
            sources: [{ passageId, match: quote, relation: 'context' }],
          },
    );
    vi.stubEnv('OPENAI_API_KEY', 'test-only-review');
    const urls: URL[] = [];
    const provider = network((url) => {
      urls.push(url);
      if (scenario === 'outage') return new Response(null, { status: 503 });
      const item = { ...work, frbr_uri: '/akn/id/act/uu/2025/20', number: '20', year: 2025 };
      const page = '/peraturan/uu/uu-no-20-tahun-2025';
      return url.pathname === '/api/v1/search'
        ? Response.json({
            results: [
              {
                work: item,
                matching_pasals: ['288'],
                best_passage: { version: 1, pasal_number: '288', href: page + '/pasal-288', work_href: page },
              },
            ],
          })
        : Response.json({ work: item, articles: [{ text: excludedContent }] });
    });

    const stop = runAnalysisWorker();
    try {
      await expect
        .poll(async () => (await c.workspace()).findings.length, { timeout: 7000, interval: 70 })
        .toBe(1);
      await expect
        .poll(async () =>
          transaction((db) => db.query('SELECT lease FROM analysis_jobs WHERE case_id=$1', [c.caseId])),
        )
        .toHaveLength(0);
    } finally {
      stop();
    }
    expect(ai.mock.calls.map((call) => call[0])).toEqual(['analysis', 'review']);
    const result = await c.workspace();
    const finding = result.findings[0];
    expect(finding).toMatchObject({
      hearingId: h.id,
      statementId: line.id,
      said,
      question: question.id,
      questionTranslation: question,
      sources: [{ passageId, match: quote, relation: 'context' }],
    });
    expect(result.connections).toHaveLength(1);
    expect(result.statements[0].phase).toBe('complete');
    if (scenario === 'verified') {
      expect(finding.legal).toEqual([expect.stringMatching(/^pasal-/)]);
      expect(result.statements[0].legal).toEqual(finding.legal);
      const [id] = finding.legal!;
      expect(await c.client.ok(c.base + '/legal/' + id)).toMatchObject({
        provider: 'pasal',
        article: 'Pasal 288',
      });
      const outsider = browser();
      await outsider.ok('auth/demo', 'POST');
      expect((await outsider.request(c.base + '/legal/' + id)).status).toBe(404);
    } else {
      expect(finding.legal).toBeUndefined();
      expect(result.statements[0].legal).toBeUndefined();
    }
    if (scenario === 'uncited') expect(provider).not.toHaveBeenCalled();
    else {
      expect(urls[0].searchParams.get('q')).toBe(
        'Pasal ' + (scenario === 'verified' ? '288' : '289') + ' UU Nomor 20 Tahun 2025',
      );
      expect(urls.map((url) => decodeURIComponent(url.href)).join(' ')).not.toMatch(
        /Riana|081234|994|995|kehadiran|testimony/,
      );
    }
  },
);
