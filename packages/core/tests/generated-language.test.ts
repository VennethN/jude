import { afterEach, describe, expect, it, vi } from 'vitest';
import type { L10n, Workspace } from '../src/domain';
import { cases, documents, findings, passages, speakers, statements } from '../src/server/seed';
import { requestErrorText } from '../../../apps/web/src/lib/request-errors';

vi.mock('../src/server/providers/openai', async importOriginal => ({
  ...await importOriginal<typeof import('../src/server/providers/openai')>(),
  structured: vi.fn(),
}));
import { structured } from '../src/server/providers/openai';
import { analyzeStatement } from '../src/server/providers/analysis';
import { answerQuestion, retrieve } from '../src/server/providers/assistant';
const generate = vi.mocked(structured);
const workspace: Workspace = {
  version: 1, caseRecord: { ...cases[0], label: 'private' }, documents, speakers, statements, passages,
  hearings: [], findings: [], connections: [], boards: [], threads: [], legal: [], replies: [],
};
afterEach(() => { vi.unstubAllEnvs(); generate.mockReset(); });

describe('generated interface content', () => {
  it('uses the same verified source and citation number in both answer languages', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-only');
    const contexts = [{ kind: 'document' as const, id: 'd1' }];
    const sources = await retrieve(workspace, 'gudang', contexts, 'en');
    const quote = sources[0].text;
    generate.mockResolvedValue({ paragraphs: [
      { summary: { id: 'Periksa waktu yang tercatat.', en: 'Check the recorded time.' }, citations: [{ evidence: 1, quote }] },
      { summary: { id: 'Bandingkan dengan keterangan saksi.', en: 'Compare it with the testimony.' }, citations: [{ evidence: 1, quote }] },
    ] });
    const result = await answerQuestion(workspace, 'gudang', contexts, 'en');
    expect(result.mode).toBe('ai');
    const text = result.text as L10n;
    expect(text.id).toContain('Periksa waktu yang tercatat.');
    expect(text.en).toContain('Check the recorded time.');
    for (const version of Object.values(text)) {
      expect(version.match(/\[1\]/g)).toHaveLength(2);
    }
    expect(result.citations).toEqual([{ kind: sources[0].kind, id: sources[0].id }]);
  });
  it('rejects a missing translation or translated evidence quote', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-only');
    generate.mockResolvedValue({ paragraphs: [{ summary: { en: 'Check the record.' }, citations: [{ evidence: 1, quote: passages[0].text }] }] });
    expect((await answerQuestion(workspace, 'gudang', [{ kind: 'documents' }], 'en')).mode).toBe('sources-only');
    generate.mockResolvedValue({ paragraphs: [{ summary: { id: 'Periksa catatan.', en: 'Check the record.' }, citations: [{ evidence: 1, quote: 'This translated evidence does not appear in the original.' }] }] });
    expect((await answerQuestion(workspace, 'gudang', [{ kind: 'documents' }], 'en')).mode).toBe('sources-only');
  });
  it('stores bilingual suggested questions separately from quoted testimony', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-only');
    const line = statements.find(s => s.id === 's208')!;
    const original = findings[0];
    const question = { id: original.question, en: 'When did you arrive at the gate?' };
    generate.mockResolvedValueOnce({ ...original, question, checkable: true }).mockResolvedValueOnce({ accept: true });
    const result = await analyzeStatement({ ...workspace, passages: passages.filter(p => original.sources.some(s => s.passageId === p.id)) }, line);
    expect(result?.question).toBe(question.id);
    expect(result?.questionTranslation).toEqual(question);
    expect(result?.said).toBe(original.said);
    expect(result?.sources).toEqual(original.sources);
  });
});

describe('request messages', () => {
  it('uses the selected language for failures and unknown server errors', () => {
    expect(requestErrorText('forbidden', 'id')).toBe('Anda tidak memiliki izin untuk tindakan ini.');
    expect(requestErrorText('forbidden', 'en')).toBe('You do not have permission for this action.');
    expect(requestErrorText('unknown_private_provider_detail', 'id')).toBe('Permintaan belum dapat diselesaikan. Coba lagi.');
    expect(requestErrorText('unknown_private_provider_detail', 'en')).toBe('The request could not be completed. Try again.');
  });
});
