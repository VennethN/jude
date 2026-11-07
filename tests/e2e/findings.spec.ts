import { expect, test } from '@playwright/test';

test('all four finding labels retain a different shape in paper and night', async ({ page }) => {
  await page.goto('/demo/findings/f1');
  const base = new URL(page.url()).pathname.replace(/\/f1$/, '');
  const samples = [
    {
      id: 'f1',
      status: 'potential_inconsistency',
      label: 'Berbeda dari sumber',
      paper: 'rgb(242, 220, 174)',
      night: 'rgb(68, 49, 15)'
    },
    {
      id: 'f3',
      status: 'context_needed',
      label: 'Perlu konteks',
      paper: 'rgb(228, 229, 237)',
      night: 'rgb(39, 42, 60)'
    },
    {
      id: 'f2',
      status: 'supported',
      label: 'Didukung sumber',
      paper: 'rgb(222, 234, 220)',
      night: 'rgb(28, 53, 39)'
    },
    {
      id: 'f4',
      status: 'insufficient_evidence',
      label: 'Bukti belum cukup',
      paper: 'rgb(233, 232, 224)',
      night: 'rgb(42, 42, 37)'
    }
  ];
  for (const theme of ['paper', 'night'] as const) {
    const preferences = await page.request.patch('/api/me/prefs', { data: { theme } });
    expect(preferences.ok()).toBe(true);
    for (const sample of samples) {
      await page.goto(base + '/' + sample.id);
      const chip = page.locator('.detail .status-chip[data-status="' + sample.status + '"]');
      await expect(page.locator('.desk')).toHaveAttribute('data-theme', theme);
      await expect(chip).toHaveText(sample.label);
      await expect(chip).toHaveCSS('background-color', sample[theme]);
      const shape = chip.locator('.status-shape');
      if (sample.status === 'potential_inconsistency') await expect(shape).not.toHaveCSS('transform', 'none');
      if (sample.status === 'context_needed') await expect(shape).toHaveCSS('border-top-width', '2px');
      if (sample.status === 'supported') await expect(shape).toHaveCSS('border-radius', '50%');
      if (sample.status === 'insufficient_evidence') await expect(shape).toHaveCSS('height', '2px');
    }
  }
});

test('the selected finding follows its review status and its original hearing order', async ({ page }) => {
  await page.goto('/demo/findings');
  await expect(page.locator('.queue .meta')).toHaveText([
    'Berbeda dari sumber · 00:14:32',
    'Berbeda dari sumber · 00:18:02',
    'Perlu konteks · 00:42:30'
  ]);
  await expect(page.locator('.hearing-group')).toHaveText('Sidang 2 · Pemeriksaan saksi Rina Hartati');
  await page.locator('.queue .finding-card').first().click();
  await page.getByRole('button', { name: 'Tandai diperiksa' }).click();
  await expect(page.locator('.queue-tabs a[aria-current]')).toContainText('Sudah dicek');
  await expect(page.locator('.queue .finding-card[aria-current] .review-mark')).toHaveClass(/\bdone\b/);
  await expect(page.locator('.finding-meta .checked')).toHaveText('Sudah dicek');
  await page.reload();
  await expect(page.locator('.finding-meta .checked')).toBeVisible();
  await page.getByRole('button', { name: 'Buka kembali' }).click();
  await expect(page.locator('.queue-tabs a[aria-current]')).toContainText('Perlu dicek');
  await expect(page.locator('.finding-meta .checked')).toHaveCount(0);
});

test('the phone review editor opens from the keyboard and retains its note after closing the sheet', async ({
  page
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/demo/findings');
  await page.locator('.queue .finding-card').first().click();
  const sheet = page.getByRole('dialog', { name: 'Temuan', exact: true });
  await expect(sheet.locator('.dialog-head .finding-pager')).toBeVisible();
  await expect(sheet.getByLabel('Catatan pemeriksaan')).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Temuan berikutnya' }).focus();
  await page.keyboard.press('n');
  const note = sheet.getByLabel('Catatan pemeriksaan');
  await expect(note).toBeFocused();
  await note.fill('Tanyakan tentang log malam itu.');
  await sheet.getByRole('button', { name: 'Simpan catatan' }).click();
  await expect(sheet.getByRole('status')).toContainText('Perubahan tersimpan');
  await sheet.getByRole('button', { name: 'Tutup', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await page.locator('.queue .finding-card').first().click();
  await expect(sheet.getByLabel('Catatan pemeriksaan')).toHaveValue('Tanyakan tentang log malam itu.');
});
