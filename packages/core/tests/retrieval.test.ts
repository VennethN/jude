import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { caseHits } from '../src/server/case-api';
import { emptyWorkspace, makeCase } from '../src/server/cases';
import { retrieve } from '../src/server/providers/assistant';
import { semanticSources } from '../src/server/semantic-sources';
import type { SemanticMatch } from '../src/server/semantic-index';

const api = vi.hoisted(() => ({
  ready: vi.fn(), search: vi.fn(), embed: vi.fn(),
}));
vi.mock('../src/server/semantic-index', () => ({
  hasSemanticEvidenceIn: api.ready, searchSemanticIn: api.search,
}));
vi.mock('../src/server/providers/embeddings', () => ({
  embeddingsConfigured: () => true, embedEvidence: api.embed,
}));
vi.mock('../src/server/db', () => ({
  transaction: (run: (db: unknown) => unknown) => run({ query: async () => [{ count: 1 }] }),
}));

function fixture() {
  const w = emptyWorkspace(makeCase({title: 'Fictional delivery'}));
  for (const [id, text] of [['receipt', 'The package arrived at noon.'], ['log', 'Peti itu disimpan di lemari.']]) {
    w.documents.push({ id, caseId: w.caseRecord.id, title: id, kind: { id: 'Log', en: 'Log' }, pages: 1, size: '', file: 'TXT', added: '2026-01-01' });
    w.passages.push({ id: id + '-1', docId: id, page: 1, text });
  }
  return w;
}

beforeEach(() => {
  vi.stubEnv('DATABASE_URL', 'mock');
  api.ready.mockResolvedValue(true);
  api.embed.mockResolvedValue([[1]]);
});
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

test('retrieves a paraphrase in a selected document and preserves its exact citation target', async () => {
  const w = fixture();
  const [first, second] = semanticSources(w);
  const results: SemanticMatch[] = [first, second].map(({kind,id,fingerprint}) => ({kind,id,fingerprint,score:0.8}));
  api.search.mockResolvedValue(results);
  const query = 'Where was the crate stored?';
  const chosen = await retrieve(w, query, [{kind:'document', id:'log'}], 'en', 'org');
  expect(api.search.mock.calls[0][1]).toMatchObject({orgId:'org',caseId:w.caseRecord.id,allowed:[{kind:'passage',id:'log-1'}]});
  expect(chosen.map(source => source.text)).toEqual(['Peti itu disimpan di lemari.']);
  const hits = caseHits(w, query, results.slice(1));
  expect(hits).toHaveLength(1);
  expect(hits[0].url).toBe('/case/' + w.caseRecord.id + '/documents/log?p=log-1');
});

test('skips embedding guests and unindexed cases, preserves lexical search after provider failure', async () => {
  const w = fixture();
  w.caseRecord.label = 'synthetic';
  expect((await retrieve(w,'package',[],'en','org'))[0].id).toBe('receipt-1');
  expect(api.ready).not.toHaveBeenCalled();
  w.caseRecord.label = 'private';
  api.ready.mockResolvedValueOnce(false);
  await retrieve(w,'package',[],'en','org');
  expect(api.embed).not.toHaveBeenCalled();
  api.embed.mockRejectedValueOnce(new Error('unavailable'));
  expect((await retrieve(w,'package',[],'en','org')).map(s=>s.id)).toEqual(['receipt-1']);
  expect(api.search).not.toHaveBeenCalled();
});

test('rejects obsolete fingerprints and unrelated vector matches', async () => {
  const w = fixture();
  const [first, second] = semanticSources(w);
  api.search.mockResolvedValue([{...first, score:0.1},{...second, fingerprint:'old', score:0.9}]);
  expect(await retrieve(w,'storage location',[],'en','org')).toEqual([]);
});
