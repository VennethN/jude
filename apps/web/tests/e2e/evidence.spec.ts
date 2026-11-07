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

  await page.getByRole('button', { name: 'Tambah catatan' }).click();
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

test('a phone keeps a grouped evidence map inside the viewport with a readable list below', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/demo/connections?of=statement:s208');
  await expect(page.getByRole('heading', { name: 'Bukti dalam kelompok ini' })).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    map: document.querySelector('.map')!.getBoundingClientRect().width,
    panelY: document.querySelector('.group-panel')!.getBoundingClientRect().top,
    mapBottom: document.querySelector('.map')!.getBoundingClientRect().bottom
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.map).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.panelY).toBeGreaterThan(dimensions.mapBottom);
});

test('undo board deletion keeps its identity and opens the restored board', async ({ page }) => {
  await page.goto('/demo/findings?view=board');
  await page.getByRole('button', { name: 'Papan baru' }).click();
  await page.getByLabel('Nama papan').fill('Catatan persiapan');
  await page.getByRole('button', { name: 'Simpan', exact: true }).click();
  const selector = page.getByRole('combobox', { name: 'Pilih papan' });
  await expect(selector.locator('option:checked')).toHaveText('Catatan persiapan');
  const boardId = await selector.inputValue();
  await page.getByRole('button', { name: 'Hapus papan' }).click();
  await page.getByRole('button', { name: 'Hapus', exact: true }).click();
  await page.getByRole('button', { name: 'Urungkan' }).click();
  await expect(selector).toHaveValue(boardId);
  await expect(selector.locator('option:checked')).toHaveText('Catatan persiapan');
});

test('removing a cited file identifies the lost source and Undo restores the original reference', async ({
  page,
  context
}) => {
  await page.goto('/demo/documents/d1?p=d1p4');
  await expect(page.locator('button.margin-mark[data-pid="d1p4"]')).toBeVisible();
  const library = new URL('.', page.url()).pathname.replace(/\/$/, '');
  const findingUrl = library.replace(/\/documents$/, '/findings/f1');
  await page.getByRole('button', { name: 'Hapus dokumen', exact: true }).click();
  const confirm = page.getByRole('dialog');
  await expect(confirm).toContainText('temuan');
  await confirm.getByRole('button', { name: 'Hapus dokumen', exact: true }).click();
  const undo = page.getByRole('button', { name: 'Urungkan', exact: true });
  await expect(undo).toBeVisible();
  const finding = await context.newPage();
  await finding.goto(findingUrl);
  await expect(finding.getByRole('region', { name: 'Kutipan yang tidak tersedia' })).toContainText(
    'BAP Saksi Rina Hartati · hal. 4'
  );
  await undo.click();
  await expect(page.getByRole('status').getByRole('link', { name: 'Buka' })).toBeVisible();
  await finding.reload();
  await expect(finding.getByRole('region', { name: 'Kutipan yang tidak tersedia' })).toHaveCount(0);
  await expect(finding.locator('.filed blockquote').first()).toContainText('20.00 WIB');
  await finding.close();
});

test('switch between original finding sources using the keyboard and open the selected filing', async ({
  page
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/demo/findings/f1');
  const tabs = page.getByRole('tablist', { name: 'Bandingkan sumber' });
  const initial = tabs.getByRole('tab', { name: /BAP Saksi Rina Hartati/ });
  await expect(initial).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel')).toContainText('menggantikan rekan saya');
  await expect(initial).toBeEnabled();
  await initial.focus();
  await initial.press('ArrowRight');
  const log = tabs.getByRole('tab', { name: /Laporan Log Akses/ });
  await expect(log).toBeFocused();
  await expect(log).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel').locator('mark')).toContainText('20:07:41');
  await page.getByText('Mengapa temuan ini ditampilkan?').click();
  await expect(page.getByRole('heading', { name: 'Ketidakpastian' })).toBeVisible();
  await page.getByRole('tabpanel').getByRole('link', { name: 'Buka halaman 7' }).click();
  await expect(page).toHaveURL(/\/documents\/d3\?p=d3p2$/);
  await expect(page.locator('button.margin-mark[data-pid="d3p2"]')).toBeVisible();
});
