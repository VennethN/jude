import { afterEach, expect, test, vi } from 'vitest';
import { emptyWorkspace, makeCase } from '../src/server/cases';
import { answerQuestion, type Source } from '../src/server/providers/assistant';
import { checkedParagraph, composeAnswer, readParagraphs, type AnswerParagraph } from '../src/server/providers/answer-paragraphs';
import { isCaseSummary, summaryEvidence } from '../src/server/providers/case-summary';

const model = vi.hoisted(() => vi.fn());
vi.mock('../src/server/providers/openai', async (original) => ({
  ...await original<typeof import('../src/server/providers/openai')>(), structured: model,
}));
afterEach(() => { vi.unstubAllEnvs(); model.mockReset(); });

const primary: Source[] = [
  { kind: 'passage', id: 'register', text: 'Pukul 09.40 WIB, register ditandatangani.', group: 'Register' },
  { kind: 'statement', id: 'memory', text: 'Selesai sekitar pukul 09.20 WIB.', group: 'Nara' },
];
const proof = [
  { evidence: 1, quote: 'register ditandatangani' },
  { evidence: 2, quote: 'sekitar pukul 09.20' },
];

function fixture() {
  const w = emptyWorkspace(makeCase({ title: 'Handover at the dock' }));
  w.documents.push({ id: 'records', caseId: w.caseRecord.id, title: 'Register', kind: { id: 'Log', en: 'Log' }, pages: 1, size: '', file: 'TXT', added: '2026-01-01' });
  w.passages.push({ id: 'register', docId: 'records', page: 1, text: primary[0].text });
  w.statements.push({ id: 'memory', hearingId: 'hearing', speakerId: 'nara', t: 60, text: primary[1].text });
  return w;
}

test('English and Indonesian whole-case prompts include both records even with no matching query words', async () => {
  const w = fixture();
  const question = 'Ringkas perkara ini dan hal yang masih belum pasti.';
  expect(isCaseSummary(question, [])).toBe(true);
  expect(isCaseSummary('Summarize the case', [{ kind: 'document', id: 'records' }])).toBe(false);
  expect(summaryEvidence(w, primary, 'id').sources).toEqual(primary);
  const whole = await answerQuestion(w, question, [{ kind: 'case' }], 'id', false);
  expect(whole.citations?.map(s => s.id)).toEqual(['register', 'memory']);
  const focused = await answerQuestion(w, question, [{ kind: 'document', id: 'records' }], 'id', false);
  expect(focused.citations?.map(s => s.id)).toEqual(['register']);
  expect(model).not.toHaveBeenCalled();
});

test('streams one-paragraph answers before completion and checks every quoted source', async () => {
  const value = { citations: proof, summary: { en: 'Nara recalled completion before the time recorded for signing.', id: 'Menurut Nara pekerjaan selesai sebelum waktu tanda tangan yang tercatat.' } };
  const original = JSON.stringify({ paragraphs: [value] });
  const partials: string[] = [];
  vi.stubEnv('OPENAI_API_KEY', 'test');
  model.mockImplementation(async (_task, _instructions, _input, _schema, delta: (token: string) => void) => {
    const end = original.indexOf('the time recorded');
    delta(original.slice(0, end));
    expect(partials.length).toBeGreaterThan(0);
    expect(partials[0]).toContain('Nara recalled');
    expect(partials[0]).not.toContain('signing');
    delta(original.slice(end));
    return { paragraphs: [value] };
  });
  const result = await answerQuestion(fixture(), 'Summarize the case.', [], 'en', true, undefined, message => { if (typeof message.text !== 'string') partials.push(message.text.en); });
  expect(result.mode).toBe('ai');
  expect(result.text).toEqual({ en: value.summary.en + ' [1] [2]', id: value.summary.id + ' [1] [2]' });
  expect(result.citations?.map(s => s.id)).toEqual(['register', 'memory']);
  expect(partials.at(-1)).toBe(value.summary.en + ' [1] [2]');
});

test('fragmented strings, nested quotations and repeated proofs retain their source numbering', () => {
  const evidence = [{ ...primary[0], text: 'Nara wrote "signed {at} the gate" in her log.' }];
  const citation = { evidence: 1, quote: '"signed {at} the gate"' };
  const part = { citations: [citation, citation], summary: { id: 'Lokasi penandatanganan tercantum dalam catatan.', en: 'The log identifies the signing location.' } };
  const complete: AnswerParagraph[] = [];
  const previews: string[] = [];
  const parse = readParagraphs('id', value => {
    expect(checkedParagraph(value, evidence)).toBe(true);
    complete.push(value as AnswerParagraph);
  }, value => {
    if (checkedParagraph(value, evidence, 'id')) previews.push(value.summary.id);
  });
  for (const ch of JSON.stringify({ paragraphs: [part] })) parse(ch);
  expect(previews.length).toBeGreaterThan(0);
  expect(complete).toEqual([part]);
  const result = composeAnswer('id', complete, evidence);
  expect(result.text).toEqual({ id: part.summary.id + ' [1]', en: part.summary.en + ' [1]' });
  expect(result.citations).toHaveLength(1);
});

test('neither partial previews nor the finished answer publish an invented quotation', async () => {
  const invalid = { citations: [{ evidence: 1, quote: 'time certified independently' }], summary: { en: 'Both times were certified by the recorder.', id: 'Kedua waktu disahkan oleh pencatat.' } };
  vi.stubEnv('OPENAI_API_KEY', 'test');
  model.mockImplementation(async (_task, _instructions, _input, _schema, delta: (token: string) => void) => {
    for (const c of JSON.stringify({ paragraphs: [invalid] })) delta(c);
    return { paragraphs: [invalid] };
  });
  const onPartial = vi.fn();
  const result = await answerQuestion(fixture(), 'Summarize the case.', [], 'en', true, undefined, onPartial);
  expect(onPartial).not.toHaveBeenCalled();
  expect(result.mode).toBe('sources-only');
  expect(result.text).not.toContain('certified');
});
