import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import type { CaseRecord, Workspace } from '../src/domain';
import { emptyWorkspace, insertWorkspace, mutateWorkspace } from '../src/server/cases';
import { transaction, type Database } from '../src/server/db';
import { removeSourceIn, restoreSourceIn } from '../src/server/retention';
import { embeddingChunks, semanticSources } from '../src/server/semantic-sources';
import { ensureSemanticStorageIn, hasSemanticEvidenceIn, runSemanticIndexBatch, searchSemanticIn, vectorLiteral } from '../src/server/semantic-index';

// All embeddings in these tests are local deterministic vectors. Never use a model key.
vi.mock('../src/server/providers/embeddings', () => ({
  embeddingsConfigured: () => process.env.JUDE_SEMANTIC_SEARCH !== 'false',
  embeddingModel: () => process.env.JUDE_TEST_EMBEDDING_MODEL || 'text-embedding-3-small',
  embedEvidence: () => { throw new Error('A local embedding stub is required by this test.'); },
}));

function workspace(label: CaseRecord['label'] = 'private') {
  const id = randomUUID();
  const w = emptyWorkspace({ id, label, title: 'Perkara', reference: '', client: '', court: '', summary: { id: '', en: '' }, updated: new Date().toISOString() });
  w.documents.push({ id: 'doc', caseId: id, title: 'Catatan', kind: { id: 'Dokumen', en: 'Document' }, pages: 1, file: 'TXT', size: '1 KB', added: '2026-01-01' });
  w.hearings.push({ id: 'hearing', caseId: id, number: 1, title: { id: 'Sidang', en: 'Hearing' }, date: '2026-01-01', mode: 'imported' });
  w.passages.push({ id: 'passage', docId: 'doc', page: 1, text: 'Mobil meninggalkan gerbang.' });
  w.statements.push({ id: 'statement', hearingId: 'hearing', speakerId: 'speaker', t: 1, text: 'Gedung memiliki dua lantai.' });
  w.findings.push({ id: 'finding', hearingId: 'hearing', statementId: 'statement', status: 'insufficient_evidence', title: { id: 'Periksa', en: 'Check' }, explanation: { id: 'Periksa catatan.', en: 'Check the record.' }, verify: { id: '', en: '' }, sources: [], reviewed: false, note: '', isNew: true });
  return w;
}
const unit = (axis = 0) => Array.from({ length: 1536 }, (_, i) => Number(i === axis));
const embed = async (texts: string[]) => texts.map((t) => unit(t.includes('Mobil') ? 0 : 1));

describe('semantic source boundaries', () => {
  test('preserves all UTF-8 text across bounded embedding chunks', () => {
    const text = '🧑🏽‍⚖️Perkara—證據\n'.repeat(1800);
    const chunks = embeddingChunks(text);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.join('')).toBe(text);
    expect(chunks.every((part) => Buffer.byteLength(part, 'utf8') <= 6000)).toBe(true);
  });
  test('includes evidence only from private cases and validates parent ownership', () => {
    expect(semanticSources(workspace('synthetic'))).toEqual([]);
    const w = workspace();
    expect(semanticSources(w).map((s) => s.kind).sort()).toEqual(['finding', 'passage', 'statement']);
    w.documents[0].caseId = 'another-case';
    w.hearings[0].caseId = 'another-case';
    expect(semanticSources(w)).toEqual([]);
  });
  test('fingerprints refresh text and location but ignore review notes', () => {
    const w = workspace(), initial = semanticSources(w);
    w.statements[0].note = 'Personal note, never part of embeddings.';
    expect(semanticSources(w)).toEqual(initial);
    w.passages[0].page = 2;
    expect(semanticSources(w)[0].fingerprint).not.toBe(initial[0].fingerprint);
    w.statements[0].text = 'Revised testimony.';
    expect(semanticSources(w)[1].fingerprint).not.toBe(initial[1].fingerprint);
  });
  test('SQLite declines semantic storage and stock PostgreSQL uses native arrays', async () => {
    const query = vi.fn(async (_sql: string): Promise<Record<string, unknown>[]> => []);
    expect(await ensureSemanticStorageIn({ forUpdate: '', query } as Database)).toBe(false);
    expect(query).not.toHaveBeenCalled();
    query.mockImplementation(async (sql) => sql.includes('SELECT to_regclass') ? [{ present: null }] : []);
    expect(await ensureSemanticStorageIn({ forUpdate: ' FOR UPDATE', query } as Database)).toBe(true);
    expect(query.mock.calls.some((call) => String(call[0]).includes('embedding REAL[]'))).toBe(true);
  });
  test('rejects invalid vector shape, nonfinite values and zero vectors', () => {
    expect(() => vectorLiteral([1])).toThrow();
    expect(() => vectorLiteral(Array(1536).fill(0))).toThrow();
    const vector = unit(); vector[1] = NaN;
    expect(() => vectorLiteral(vector)).toThrow();
    expect(vectorLiteral(unit())).toMatch(/^\[1,0,/);
  });
});

const vectorUrl = process.env.JUDE_TEST_VECTOR_DATABASE_URL || process.env.JUDE_TEST_DATABASE_URL;
describe.skipIf(!vectorUrl)('PostgreSQL semantic indexing (native arrays or pgvector)', () => {
  const orgs: string[] = [];
  const schema = 'semantic_test_' + randomUUID().replaceAll('-', '');
  let administrator: Pool | undefined;
  beforeAll(async () => {
    administrator = new Pool({ connectionString: vectorUrl, max: 1 });
    await administrator.query('CREATE SCHEMA ' + schema);
    const url = new URL(vectorUrl!);
    url.searchParams.set('options', '-csearch_path=' + schema);
    process.env.DATABASE_URL = url.toString();
    await transaction(async (db) => expect(await ensureSemanticStorageIn(db)).toBe(true));
  });
  afterAll(async () => {
    await transaction(async (db) => {
      for (const org of orgs) await db.query('DELETE FROM organizations WHERE id=$1', [org]);
    });
    delete process.env.JUDE_TEST_EMBEDDING_MODEL;
    await administrator?.query('DROP SCHEMA ' + schema + ' CASCADE');
    await administrator?.end();
  });
  async function save(w: Workspace) {
    const org = randomUUID(); orgs.push(org);
    await transaction(async (db) => {
      await db.query('INSERT INTO organizations(id,name,created_at) VALUES($1,$2,$3)', [org, 'Semantic test', Date.now()]);
      await insertWorkspace(db, org, w);
    });
    return org;
  }
  async function drain(custom = embed) {
    for (let i = 0; i < 12; i++) if (!(await runSemanticIndexBatch({ embed: custom }))) return;
    throw new Error('Index queue did not drain in bounded test passes.');
  }
  test('indexes asynchronously, isolates cases and filters scope before top K', async () => {
    const a = workspace(), b = workspace(), orgA = await save(a), orgB = await save(b);
    expect(await transaction((db) => hasSemanticEvidenceIn(db, orgA, a.caseRecord.id))).toBe(false);
    await drain();
    expect(await transaction((db) => hasSemanticEvidenceIn(db, orgA, a.caseRecord.id))).toBe(true);
    const search = (orgId: string, caseId: string, allowed?: { kind: string; id: string }[]) => transaction((db) => searchSemanticIn(db, { orgId, caseId, vector: unit(), limit: 1, allowed }));
    expect((await search(orgA, a.caseRecord.id))[0]).toMatchObject({ kind: 'passage', id: 'passage', score: 1 });
    expect(await search(orgB, a.caseRecord.id)).toEqual([]);
    expect((await search(orgA, a.caseRecord.id, [{ kind: 'statement', id: 'statement' }]))[0]).toMatchObject({ kind: 'statement', id: 'statement', score: 0 });
    expect(await search(orgA, a.caseRecord.id, [])).toEqual([]);
    expect((await search(orgB, b.caseRecord.id))[0].id).toBe('passage');
  });
  test('revisions invalidate old fingerprints; soft delete and restore refresh sources', async () => {
    const w = workspace(), org = await save(w), id = w.caseRecord.id;
    await drain();
    await mutateWorkspace(org, id, (current) => { current.passages[0].text = 'Gedung baru.'; });
    const search = () => transaction((db) => searchSemanticIn(db, { orgId: org, caseId: id, vector: unit(), limit: 5, allowed: [{ kind: 'passage', id: 'passage' }] }));
    expect(await search()).toEqual([]);
    await drain();
    expect((await search())[0].score).toBe(0);
    await transaction((db) => removeSourceIn(db, org, id, 'documents', 'doc'));
    expect(await search()).toEqual([]);
    await transaction((db) => restoreSourceIn(db, org, id, 'documents', 'doc'));
    expect(await search()).toEqual([]);
    await drain();
    expect((await search())[0].id).toBe('passage');
  });
  test('reimport replaces source IDs and out-of-band voice writes are backfilled', async () => {
    const w = workspace(); w.statements = []; w.findings = [];
    const org = await save(w), id = w.caseRecord.id;
    await drain();
    await mutateWorkspace(org, id, (current) => { current.passages = [{ ...current.passages[0], id: 'reimported', text: 'Gedung baru.' }]; });
    expect(await transaction((db) => db.query('SELECT 1 FROM semantic_vectors WHERE case_id=$1', [id]))).toEqual([]);
    await drain();
    await transaction(async (db) => {
      await db.query('INSERT INTO case_entities(case_id,kind,id,ordinal,body) VALUES($1,$2,$3,$4,$5)', [id, 'statements', 'voice-turn', 0, JSON.stringify({ id: 'voice-turn', hearingId: 'hearing', speakerId: 'speaker', t: 2, text: 'Mobil tiba di sidang.' })]);
      await db.query('UPDATE cases SET version=version+1 WHERE id=$1', [id]);
    });
    await drain();
    const hits = await transaction((db) => searchSemanticIn(db, { orgId: org, caseId: id, vector: unit(), limit: 5 }));
    expect(hits.map((h) => h.id).sort()).toEqual(['reimported', 'voice-turn']);
    await transaction((db) => db.query('DELETE FROM cases WHERE id=$1', [id]));
    expect(await transaction((db) => db.query('SELECT 1 FROM semantic_vectors WHERE case_id=$1', [id]))).toEqual([]);
  });
  test('an explicit provider opt-out leaves durable work queued without external requests', async () => {
    const w = workspace(); w.statements = []; w.findings = [];
    const org = await save(w), id = w.caseRecord.id, stub = vi.fn(embed);
    process.env.JUDE_SEMANTIC_SEARCH = 'false';
    try {
      expect(await runSemanticIndexBatch({ embed: stub })).toBe(0);
      expect(stub).not.toHaveBeenCalled();
    } finally {
      delete process.env.JUDE_SEMANTIC_SEARCH;
    }
    await drain();
    expect(await transaction((db) => hasSemanticEvidenceIn(db, org, id))).toBe(true);
  });
  test('a concurrent revision cannot publish an old embedding', async () => {
    const w = workspace(); w.statements = []; w.findings = [];
    const org = await save(w), id = w.caseRecord.id;
    await runSemanticIndexBatch({ embed: async (texts) => {
      await mutateWorkspace(org, id, (current) => { current.passages[0].text = 'Gedung pengganti.'; });
      return embed(texts);
    } });
    expect(await transaction((db) => hasSemanticEvidenceIn(db, org, id))).toBe(false);
    await drain();
    expect(await transaction((db) => hasSemanticEvidenceIn(db, org, id))).toBe(true);
  });
  test('failed jobs stop after four attempts and a revision resets the retry budget', async () => {
    const w = workspace(); w.statements = []; w.findings = [];
    const org = await save(w), id = w.caseRecord.id, failing = vi.fn(async () => { throw new Error('offline'); });
    for (let i = 0; i < 5; i++) {
      await transaction((db) => db.query('UPDATE semantic_evidence SET available_at=0 WHERE case_id=$1', [id]));
      await runSemanticIndexBatch({ embed: failing });
    }
    expect(failing).toHaveBeenCalledTimes(4);
    const [row] = await transaction((db) => db.query<{ status: string; attempts: number }>('SELECT status,attempts FROM semantic_evidence WHERE case_id=$1', [id]));
    expect(row).toMatchObject({ status: 'failed', attempts: 4 });
    await mutateWorkspace(org, id, (current) => { current.passages[0].text += ' Revisi.'; });
    await drain();
    expect(await transaction((db) => hasSemanticEvidenceIn(db, org, id))).toBe(true);
  });
  test('long source chunks all survive storage and collapse to a single ranked source', async () => {
    const w = workspace(); w.statements = []; w.findings = [];
    w.passages[0].text = 'Gedung '.repeat(1800) + 'Mobil';
    const org = await save(w), id = w.caseRecord.id;
    await drain();
    const rows = await transaction((db) => db.query('SELECT chunk FROM semantic_vectors WHERE case_id=$1', [id]));
    expect(rows.length).toBeGreaterThan(1);
    const hits = await transaction((db) => searchSemanticIn(db, { orgId: org, caseId: id, vector: unit(), limit: 10 }));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ id: 'passage', score: 1 });
  });
  test('model changes backfill all current sources and invalidate the previous model', async () => {
    const w = workspace(); const org = await save(w), id = w.caseRecord.id;
    await drain();
    process.env.JUDE_TEST_EMBEDDING_MODEL = 'replacement-model';
    expect(await transaction((db) => hasSemanticEvidenceIn(db, org, id))).toBe(false);
    await drain();
    expect(await transaction((db) => hasSemanticEvidenceIn(db, org, id))).toBe(true);
    delete process.env.JUDE_TEST_EMBEDDING_MODEL;
  });
  test('synthetic cases never enqueue or call the embedding provider', async () => {
    const w = workspace('synthetic'), org = await save(w);
    const rows = await transaction((db) => db.query('SELECT 1 FROM semantic_evidence WHERE case_id=$1', [w.caseRecord.id]));
    expect(rows).toEqual([]);
    expect(await transaction((db) => hasSemanticEvidenceIn(db, org, w.caseRecord.id))).toBe(false);
  });
  test('native rows remain searchable when a pgvector typed column is available', async () => {
    const w = workspace(); w.statements = []; w.findings = [];
    const org = await save(w), id = w.caseRecord.id;
    await drain();
    await transaction(async (db) => {
      const columns = await db.query("SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('semantic_vectors') AND attname='embedding_vector' AND NOT attisdropped");
      if (columns.length) await db.query('UPDATE semantic_vectors SET embedding_vector=NULL WHERE case_id=$1', [id]);
      const hits = await searchSemanticIn(db, { orgId: org, caseId: id, vector: unit(), limit: 1 });
      expect(hits[0]).toMatchObject({ id: 'passage', score: 1 });
    });
  });
});
