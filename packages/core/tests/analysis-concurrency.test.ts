import { randomUUID } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vitest';
import type { CaseRecord, Hearing, SessionInfo, Statement } from '../src/domain';
import { mutateWorkspace, readWorkspace } from '../src/server/cases';
import { transaction } from '../src/server/db';
import { runAnalysisWorker } from '../src/server/jobs';
import * as model from '../src/server/providers/openai';
import * as voice from '../src/server/voice-capabilities';
import { browser } from './api-client';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

test('later testimony produces a cited finding while the first model call is still pending', async () => {
  vi.stubEnv('DATABASE_URL', '');
  vi.stubEnv('JUDE_DB_PATH', ':memory:');
  vi.stubEnv('JUDE_SEMANTIC_SEARCH', 'false');
  vi.stubEnv('JUDE_PASAL_TOKEN', '');
  vi.stubEnv('OPENAI_API_KEY', 'local-test');
  const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected external request'));
  vi.spyOn(voice, 'transcriptionAvailable').mockResolvedValue(true);

  const client = browser();
  const session = await client.ok<SessionInfo>('auth/signup', 'POST', {
    name: 'Counsel', email: randomUUID() + '@example.test', password: 'Example-1234', planId: 'pro',
  });
  const { id: caseId } = await client.ok<CaseRecord>('cases', 'POST', { title: 'Fictional gate register' });
  const { id: hearingId } = await client.ok<Hearing>('cases/' + caseId + '/hearings', 'POST', {
    flow: 'live', title: 'Witness examination', date: '2026-11-07', recordingPermission: true,
  });
  const org = session.organization.id;
  const speakerId = 'witness';
  const first: Statement = { id: 'turn-open', hearingId, speakerId, t: 0, text: 'The gate opened at eight.', phase: 'queued' };
  const second: Statement = { id: 'turn-close', hearingId, speakerId, t: 2.4, text: 'The gate closed at nine.', phase: 'queued' };
  const turns = [first, second];
  await mutateWorkspace(org, caseId, w => {
    w.speakers.push({ id: speakerId, label: 'Witness', role: 'witness', confirmed: true });
    w.documents.push({
      id: 'register', caseId, title: 'Gate register', kind: { id: 'Catatan', en: 'Record' },
      pages: 1, file: 'TXT', size: '1 KB', added: '2026-11-07',
    });
    for (const turn of turns) w.passages.push({ id: 'log-' + turn.id, docId: 'register', page: 1, text: turn.text });
    w.statements.push(first);
  });

  let releaseFirst!: () => void;
  const heldCall = new Promise<void>(resolve => { releaseFirst = resolve; });
  const requests: string[] = [];
  const copy = { id: 'Bandingkan dengan catatan gerbang.', en: 'Compare with the gate register.' };
  vi.spyOn(model, 'structured').mockImplementation(async (task, _instruction, input) => {
    if (task === 'review') return { accept: true };
    const { line } = input as { line: string };
    const turn = turns.find(turn => turn.text === line);
    if (task !== 'analysis' || !turn) throw new Error('Unexpected model input');
    requests.push(turn.id);
    if (turn.id === first.id) await heldCall;
    return {
      checkable: true, status: 'supported', said: line, title: copy, explanation: copy, verify: copy,
      uncertainty: copy, question: { id: 'Kapan gerbang diperiksa?', en: 'When was the gate checked?' },
      sources: [{ passageId: 'log-' + turn.id, match: line, relation: 'supports' }],
    };
  });

  const jobs = () => transaction(db => db.query<{ statement_id: string; lease: string }>(
    'SELECT statement_id, lease FROM analysis_jobs WHERE case_id=$1', [caseId],
  ));
  const workspace = () => readWorkspace(org, caseId);
  const polling = { timeout: 6000, interval: 50 };
  const stop = runAnalysisWorker();
  try {
    await expect.poll(() => requests, polling).toEqual([first.id]);
    await mutateWorkspace(org, caseId, w => { w.statements.push(second); });

    await expect.poll(async () => (await workspace()).findings.map(f => f.statementId), polling).toEqual([second.id]);
    await expect.poll(jobs, polling).toEqual([{ statement_id: first.id, lease: expect.any(String) }]);
    const pending = await workspace();
    expect(pending.statements.map(s => [s.id, s.phase])).toEqual([[first.id, 'queued'], [second.id, 'complete']]);
    expect(pending.findings[0]).toMatchObject({
      hearingId, said: second.text, sources: [{ passageId: 'log-' + second.id, match: second.text }],
    });

    releaseFirst();
    await expect.poll(jobs, polling).toEqual([]);
    const complete = await workspace();
    expect(complete.statements.map(s => s.phase)).toEqual(['complete', 'complete']);
    expect(complete.findings.map(f => f.statementId).sort()).toEqual([first.id, second.id].sort());
    expect(requests).toEqual([first.id, second.id]);
    expect(network).not.toHaveBeenCalled();
  } finally {
    releaseFirst();
    stop();
  }
});
