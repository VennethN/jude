import { afterEach, expect, test, vi } from 'vitest';
import type { Statement, Workspace } from '../src/domain';
import { analyzeStatement } from '../src/server/providers/analysis';
import * as provider from '../src/server/providers/openai';

const line: Statement = {
  id: 'spoken', hearingId: 'hearing', speakerId: 'unconfirmed', t: 0,
  text: 'I am Adi Saputera. I first entered the north gate at 23:15.',
};
const copy = { id: 'Bandingkan catatan masuk; identitas perlu dipastikan.', en: 'Compare the entry records; identity remains unconfirmed.' };
function workspace(): Workspace {
  return {
    caseRecord: { id: 'fiction', title: 'Artificial entry comparison', reference: '', label: 'synthetic', summary: copy, client: '', court: '', updated: '' },
    documents: [{ id: 'log', caseId: 'fiction', title: 'Entry record', kind: copy, pages: 12, file: 'TXT', size: '', added: '' }],
    passages: [
      ...Array.from({ length: 10 }, (_, i) => ({ id: 'similar-' + i, docId: 'log', page: i + 1, text: 'Adi Saputera said: I first entered the north gate at 23:15.' })),
      { id: 'observation', docId: 'log', page: 11, text: 'Officer: I checked Adi’s identity and saw him enter the north gate at 20:06.' },
      { id: 'clarification', docId: 'log', page: 12, text: 'Prior clarification: the first entry was at 21:40; no earlier entry that night.' },
    ],
    hearings: [], speakers: [], statements: [], findings: [], connections: [], boards: [], threads: [], replies: [], legal: [], version: 1,
  };
}
function draft() {
  return {
    checkable: true, status: 'potential_inconsistency', said: 'first entered the north gate at 23:15',
    title: copy, explanation: copy, verify: copy, uncertainty: copy, question: 'Apakah ini masuk pertama atau kembali masuk?',
    sources: [{ passageId: 'observation', match: 'saw him enter the north gate at 20:06', relation: 'conflicts' }],
  };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
function model(result: ReturnType<typeof draft>, accept = true) {
  vi.stubEnv('OPENAI_API_KEY', 'test-only');
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected external request'));
  return vi.spyOn(provider, 'structured').mockImplementation(async task => task === 'review' ? { accept } : result);
}

test('retains lower-ranked direct evidence and sends the exact transcript to both model stages', async () => {
  const call = model(draft());
  const found = await analyzeStatement(workspace(), line);
  expect(found?.sources).toEqual(draft().sources);
  expect(call).toHaveBeenCalledTimes(2);
  for (const [, , input] of call.mock.calls) {
    expect(input).toMatchObject({ line: line.text });
    expect((input as { sources: { id: string }[] }).sources.map(s => s.id)).toContain('observation');
    expect((input as { sources: { id: string }[] }).sources.map(s => s.id)).toContain('clarification');
  }
  const sources = (call.mock.calls[0][2] as { sources: { id: string }[] }).sources;
  expect(sources.findIndex(s => s.id === 'observation')).toBeGreaterThanOrEqual(10);
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

test.each([
  ['corrected transcript spelling', (value: ReturnType<typeof draft>) => { value.said = 'I am Adi Saputra'; }],
  ['invented citation', (value: ReturnType<typeof draft>) => { value.sources[0].passageId = 'unretrieved'; }],
  ['inexact quotation', (value: ReturnType<typeof draft>) => { value.sources[0].match = 'saw him enter at 20:06'; }],
  ['judgment of the witness', (value: ReturnType<typeof draft>) => { value.explanation = { ...copy, en: 'The witness is dishonest.' }; }],
])('rejects %s before review', async (_label, change) => {
  const result = draft();
  change(result);
  const call = model(result);
  expect(await analyzeStatement(workspace(), line)).toBeNull();
  expect(call.mock.calls.map(([task]) => task)).toEqual(['analysis']);
});

test('independent reviewer can reject a quotation-valid but misleading comparison', async () => {
  const call = model(draft(), false);
  expect(await analyzeStatement(workspace(), { ...line, text: line.text + ' That was a later return, after my earlier entry.' })).toBeNull();
  expect(call.mock.calls.map(([task]) => task)).toEqual(['analysis', 'review']);
});
