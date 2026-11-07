import { expect, test } from '@playwright/test';

test('open a marked PDF passage, inspect the record, then review its finding', async ({ page }) => {
  await page.goto('/demo/documents/d1?p=d1p4');
  const marker = page.locator('button.margin-mark[data-pid="d1p4"]');
  await expect(marker).toBeVisible();
  await marker.click();

  const inspector = page.getByRole('dialog');
  await expect(inspector).toContainText('sedikit setelah pukul 20.00 WIB');
  await inspector.getByRole('link', { name: /Jam kedatangan saksi/ }).click();
  await expect(page).toHaveURL(/\/findings\/f1$/);
  await expect(page.locator('.spoken blockquote')).toContainText('jam setengah sepuluh malam');
  await expect(page.locator('.filed blockquote').first()).toContainText('20.00 WIB');

  await page.getByLabel('Catatan pemeriksaan').fill('Periksa catatan kartu gerbang sebelum bertanya.');
  await page.getByRole('button', { name: 'Tandai diperiksa' }).click();
  await expect(page.getByRole('button', { name: 'Buka kembali' })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Catatan pemeriksaan')).toHaveValue(
    'Periksa catatan kartu gerbang sebelum bertanya.'
  );
});

test('keep an original upload and open its indexed text from the case library', async ({ page }) => {
  await page.goto('/demo/documents');
  const content = 'Catatan pengecekan\n\nDaftar kunci telah dicatat pada buku serah terima.';
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Unggah dokumen' }).click()
  ]);
  await chooser.setFiles({
    name: 'Daftar serah terima.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(content, 'utf8')
  });
  await page.getByRole('status').getByRole('link', { name: 'Buka', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Daftar serah terima' })).toBeVisible();
  await expect(page.locator('.transcript')).toContainText('buku serah terima');
  const original = await page.getByRole('link', { name: 'Unduh asli' }).getAttribute('href');
  const response = await page.request.get(original!);
  expect(response.ok()).toBeTruthy();
  expect((await response.body()).toString('utf8')).toBe(content);
});

test('a phone keeps a grouped evidence map inside its own scrolling viewport', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/demo/connections?of=statement:s208');
  await expect(page.getByRole('heading', { name: 'Pasangan dalam kelompok' })).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    map: document.querySelector('.map')!.scrollWidth
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.map).toBeGreaterThan(dimensions.viewport);
});
