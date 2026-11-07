import { expect, test } from '@playwright/test';

test('retrying a failed upload retains other failures and their request keys', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/demo/documents');
  let fail = true;
  const requestKeys: string[] = [];
  await page.route('**/api/cases/*/documents', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    requestKeys.push(route.request().headers()['idempotency-key']);
    if (fail) return route.fulfill({ status: 503, json: { error: { message: 'Unggahan belum selesai. Coba lagi.' } } });
    return route.continue();
  });
  const file = (name: string) => ({ name, mimeType: 'text/plain', buffer: Buffer.from('Berkas sintetis untuk uji unggah.') });
  await page.locator('input[type=file]').setInputFiles([file('first.txt'), file('second.txt')]);
  const alerts = page.getByRole('alert');
  await expect(alerts).toHaveCount(2);
  const first = alerts.filter({ hasText: 'first.txt' });
  const second = alerts.filter({ hasText: 'second.txt' });
  // A repeated failure updates the retried row without duplicating or removing other rows.
  await first.getByRole('button', { name: 'Coba lagi' }).click();
  await expect(alerts).toHaveCount(2);
  await expect(first.getByRole('button', { name: 'Coba lagi' })).toBeEnabled();
  fail = false;
  await first.getByRole('button', { name: 'Coba lagi' }).click();
  await expect(page.getByText('first · siap dibuka')).toBeVisible();
  await expect(alerts).toHaveCount(1);
  await expect(second).toBeVisible();
  await page.screenshot({ path: info.outputPath('remaining-upload-failure.png') });
  // A subsequent batch must not silently discard the remaining retry either.
  await page.locator('input[type=file]').setInputFiles(file('third.txt'));
  await expect(page.getByText('third · siap dibuka')).toBeVisible();
  await expect(second).toBeVisible();
  await second.getByRole('button', { name: 'Coba lagi' }).click();
  await expect(page.getByText('second · siap dibuka')).toBeVisible();
  await expect(alerts).toHaveCount(0);
  expect(requestKeys).toHaveLength(6);
  expect(requestKeys[0]).toBeTruthy();
  expect(requestKeys[2]).toBe(requestKeys[0]);
  expect(requestKeys[3]).toBe(requestKeys[0]);
  expect(requestKeys[5]).toBe(requestKeys[1]);
  expect(new Set(requestKeys).size).toBe(3);
});
