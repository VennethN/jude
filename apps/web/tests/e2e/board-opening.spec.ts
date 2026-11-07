import { expect, test } from '@playwright/test';
import type { Board, Workspace } from '@jude/core/domain';

test('a fresh board previews evidence, then saves the first accepted finding', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/demo/findings?view=board');
  const caseId = new URL(page.url()).pathname.split('/')[2];
  const boards = async (): Promise<Board[]> =>
    ((await (await page.request.get('/api/cases/' + caseId + '/workspace')).json()) as Workspace).boards;
  const selector = page.getByRole('combobox', { name: 'Pilih papan' });
  await expect(selector.locator('option:checked')).toHaveText('Papan 1');
  const canvas = page.getByRole('region', { name: 'Papan bukti' });
  await expect(canvas.getByRole('button', { name: 'Taruh di papan' })).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Tanya asisten tentang papan' })).toBeDisabled();
  expect(await boards()).toEqual([]);
  await canvas.getByRole('button', { name: 'Perkecil' }).click();
  await expect(canvas.getByRole('button', { name: 'Kembali ke 100%' })).toHaveText('90%');
  await canvas.getByRole('button', { name: 'Kembali ke 100%' }).click();
  await page.getByRole('button', { name: 'Mode papan', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Mode papan' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Mode papan', exact: true })).toBeFocused();
  expect(await boards()).toEqual([]);
  await canvas.getByRole('button', { name: 'Taruh di papan' }).first().click();
  await expect(page.locator('.board-count')).toHaveText('1 kartu · 0 garis');
  const saved = await boards();
  expect(saved).toHaveLength(1);
  expect(saved[0].cards[0].key).toBe('finding:f1');
  await expect(page.getByRole('link', { name: 'Tanya asisten tentang papan' })).toHaveAttribute(
    'href',
    new RegExp('context=board%3A' + saved[0].id),
  );
  await page.reload();
  await expect(selector).toHaveValue(saved[0].id);
  await expect(canvas.getByRole('button', { name: /Jam kedatangan saksi/ })).toBeVisible();
});

test.describe('board on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('suggestions and the source picker remain available without panning a canvas', async ({ page }) => {
    await page.goto('/demo/findings?view=board');
    const suggestions = page.getByRole('region', { name: 'Bukti yang disarankan' });
    await expect(suggestions.getByRole('button', { name: 'Taruh di papan' })).toHaveCount(3);
    await page.getByRole('button', { name: 'Tambahkan', exact: true }).first().tap();
    const picker = page.getByRole('dialog', { name: 'Tambahkan ke papan' });
    await expect(picker).toBeVisible();
    await picker.getByRole('button', { name: 'Dokumen', exact: true }).tap();
    await picker.getByRole('searchbox', { name: 'Cari bukti' }).fill('BAP Saksi Rina');
    await picker
      .getByRole('button', { name: /Dokumen BAP Saksi Rina Hartati/ })
      .first()
      .tap();
    await expect(picker).toHaveCount(0);
    await expect(page.locator('.board-count')).toHaveText('1 kartu · 0 garis');
    await expect(page.locator('.mobile-board')).toContainText('BAP Saksi Rina Hartati');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});
