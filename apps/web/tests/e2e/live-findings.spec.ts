import { expect, test } from '@playwright/test';
import { needsReview, type Workspace } from '@jude/core/domain';

test('a live finding arrives with its testimony and opens the cited comparison in place', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1484, height: 786 });
  await page.goto('/demo/assistant');
  const { origin, pathname } = new URL(page.url());
  const caseId = pathname.split('/')[2];
  const api = '/api/cases/' + caseId + '/workspace';
  const initial: Workspace = await (await page.request.get(api)).json();
  const hearing = initial.hearings.find((h) => h.number === 3)!;
  const path = '/case/' + caseId + '/hearings/' + hearing.id;
  const replay = '/api/live/' + caseId + '/' + hearing.id + '/replay';

  const initialCount = initial.findings.filter((f) => f.hearingId === hearing.id && needsReview(f)).length;
  for (let cursor = 0; cursor < 3; cursor++) {
    const response = await page.request.post(replay, { headers: { origin }, data: { cursor } });
    expect(response.ok()).toBe(true);
  }
  const before: Workspace = await (await page.request.get(api)).json();
  expect(before.findings.filter((f) => f.hearingId === hearing.id && needsReview(f))).toHaveLength(initialCount);

  await page.goto(path);
  const attention = page.locator('[data-tour="live-attention"]');
  await expect(attention.locator('.calm')).toBeVisible();
  const lead = attention.locator('.lead');
  await expect(lead).toBeVisible({ timeout: 18000 });
  await page.getByRole('button', { name: 'Jeda', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Lanjutkan', exact: true })).toBeVisible();

  const current: Workspace = await (await page.request.get(api)).json();
  const finding = current.findings.find((f) => f.id === 'f-replay-' + hearing.id + '-3')!;
  expect(finding).toBeDefined();
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
