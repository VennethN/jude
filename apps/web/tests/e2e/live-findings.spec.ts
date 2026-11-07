import { DatabaseSync } from 'node:sqlite';
import { expect } from '@playwright/test';
import type { Finding, Workspace } from '@jude/core/domain';
import type { WorkspaceSync } from '@jude/core/domain';
import { test } from './fixtures/practice';

test('a live finding arrives with its testimony and opens the cited comparison in place', async ({ page, practiceServer }) => {
  await page.setViewportSize({ width: 1484, height: 786 });
  await page.goto('/demo/hearings/h4');
  const path = new URL(page.url()).pathname;
  const [, , caseId, , hearingId] = path.split('/');
  const api = '/api/cases/' + caseId;
  const started = await page.request.post(api + '/hearings/' + hearingId + '/start', {
    headers: { origin: practiceServer.origin }, data: { closed: false, recordingPermission: true },
  });
  expect(started.ok()).toBe(true);
  let eventStreams = 0;
  page.on('request', request => {
    if (new URL(request.url()).pathname === api + '/events') eventStreams++;
  });
  await page.reload();
  const attention = page.locator('[data-tour="live-attention"]');
  await expect(page.locator('.hear-reading .finding-index')).toBeVisible();
  await expect(attention).toHaveCount(0);

  // Simulate a voice turn and the analysis worker delivering its cited result to this isolated database.
  const w: Workspace = await (await page.request.get(api + '/workspace')).json();
  const source = w.passages.find(p => p.id === 'd8p1')!;
  const statementId = 'practice-recognized-turn';
  const text = 'Saya Rina Hartati. Saya baru masuk Gerbang Timur pukul setengah sepuluh malam.';
  const detail = { id: 'Periksa waktu masuk yang dicatat petugas.', en: 'Check the entry time recorded by the gate officer.' };
  const finding: Finding = { id: 'finding-' + statementId, hearingId, statementId, status: 'potential_inconsistency',
    title: detail, explanation: detail, verify: detail, question: 'Pukul berapa Anda masuk Gerbang Timur?',
    said: text, sources: [{ passageId: source.id, relation: 'conflicts', match: '20:07:41' }], reviewed: false, note: '' };
  const refreshed = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === api + '/workspace' && url.searchParams.has('since');
  });
  const db = new DatabaseSync(practiceServer.database);
  try {
    db.exec('BEGIN IMMEDIATE');
    const insert = db.prepare('INSERT INTO case_entities(case_id,kind,id,ordinal,body) VALUES(?,?,?,?,?)');
    insert.run(caseId, 'statements', statementId, w.statements.length, JSON.stringify({
      id: statementId, hearingId, speakerId: 'rina', t: 1, text, phase: 'complete',
    }));
    insert.run(caseId, 'findings', finding.id, w.findings.length, JSON.stringify(finding));
    db.prepare('UPDATE cases SET version=version+1,updated_at=? WHERE id=?').run(Date.now(), caseId);
    db.prepare('INSERT INTO case_workspace_revisions(case_id,version,changes) VALUES(?,?,?)').run(
      caseId, w.version + 1, JSON.stringify([{ kind: 'statements', id: statementId }, { kind: 'findings', id: finding.id }]),
    );
    db.exec('COMMIT');
  } finally { db.close(); }

  const response = await refreshed;
  const bytes = await response.body();
  const delta: WorkspaceSync = JSON.parse(bytes.toString());
  expect(delta.kind).toBe('delta');
  if (delta.kind === 'delta') {
    expect(delta.upserts.map(entry => entry.value.id).sort()).toEqual([finding.id, statementId].sort());
    expect(delta.upserts.some(entry => entry.kind === 'documents' || entry.kind === 'passages')).toBe(false);
  }
  expect(bytes.length).toBeLessThan(Buffer.byteLength(JSON.stringify(w)) / 10);
  console.log('Live workspace transfer: ' + Buffer.byteLength(JSON.stringify(w)) + ' → ' + bytes.length + ' bytes');

  const lead = attention.locator('.lead');
  await expect(lead).toBeVisible({ timeout: 10000 });
  expect(eventStreams).toBe(1);
  await expect(lead).toContainText(finding.title.id);
  await expect(lead).toContainText(finding.question);
  await lead.click();
  const dock = page.getByRole('complementary', { name: 'Temuan', exact: true });
  await expect(dock.getByRole('heading', { name: finding.title.id })).toBeVisible();
  await expect(page).toHaveURL(
    (url) => url.pathname === path && url.searchParams.get('s') === finding.statementId,
  );
  await expect(dock.locator('.written a')).toHaveAttribute(
    'href',
    new RegExp('p=' + finding.sources[0].passageId + '$'),
  );
  const rightGap = await dock.evaluate((el) => innerWidth - el.getBoundingClientRect().right);
  expect(rightGap).toBeGreaterThanOrEqual(16);
  expect(rightGap).toBeLessThanOrEqual(48);
  await page.keyboard.press('Escape');
  await expect(dock).toHaveCount(0);
  await expect(lead).toBeFocused();
});
