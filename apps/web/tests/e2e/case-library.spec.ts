import { expect, test } from '@playwright/test';

test('case cards link findings independently and search by number', async ({ page, baseURL }) => {
  const demo = await page.request.post('/api/auth/demo', { headers: { origin: baseURL! } });
  expect(demo.ok()).toBe(true);
  const account = await demo.json();
  await page.goto('/cases');
  const active = page.getByRole('list', { name: 'Perkara aktif' });
  await expect(active.getByRole('article')).toHaveCount(3);
  const live = active.getByRole('article').filter({ hasText: 'Langsung' });
  await expect(live).toContainText('3 sidang');
  await expect(live.getByRole('link', { name: '3 perlu dicek' })).toHaveAttribute('href', '/case/' + account.demo.caseId + '/findings');
  const search = page.getByRole('searchbox', { name: 'Cari perkara' });
  await search.fill(' 087/pid ');
  await expect(active.getByRole('article')).toHaveCount(1);
  await expect(active).toContainText('Perkara Penipuan Arisan Daring');
  await search.fill('no cases match this reference');
  await expect(active).toContainText('Tidak ada perkara yang cocok.');
  await page.goto('/case/absent-case-register-test');
  await expect(page).toHaveURL(/\/cases\?notice=case-unavailable$/);
  await expect(page.getByText('Perkara itu tidak ditemukan, atau Anda tidak punya akses.')).toBeVisible();
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('a new private file can be found and restored from its archive', async ({ page, baseURL }) => {
    const demo = await page.request.post('/api/auth/demo', { headers: { origin: baseURL! } });
    expect(demo.ok()).toBe(true);
    await page.goto('/cases');
    const createButton = page.getByRole('button', { name: 'Perkara baru' });
    await expect(createButton).toHaveCSS('min-height', '44px');
    await createButton.click();
    const dialog = page.getByRole('dialog', { name: 'Tambah perkara' });
    await expect(dialog.getByRole('button', { name: /Impor arsip/ })).toBeVisible();
    await expect(dialog.getByRole('link', { name: /Buka perkara contoh/ })).toBeVisible();
    await dialog.getByRole('button', { name: /Mulai perkara kosong/ }).click();
    await page.getByLabel('Judul perkara').fill('Berkas pengujian');
    await page.getByLabel('Nomor perkara (opsional)').fill('REG-712');
    await page.getByRole('button', { name: 'Buat perkara' }).click();
    await page.waitForURL(/\/case\/[\w-]+$/);
    const caseId = new URL(page.url()).pathname.split('/').pop();
    expect((await page.request.post('/api/cases/' + caseId + '/archive', { headers: { origin: baseURL! } })).ok()).toBe(true);
    await page.goto('/cases');
    await page.getByRole('searchbox').fill('reg-712');
    const archive = page.locator('details');
    await expect(archive).toHaveAttribute('open', '');
    await expect(archive.getByRole('link', { name: 'Berkas pengujian' })).toBeVisible();
    await archive.getByRole('button', { name: 'Pulihkan dari arsip' }).click();
    await expect(page.getByRole('article')).toContainText('Perkara privat');
    await expect(page.getByRole('link', { name: 'Berkas pengujian' })).toBeFocused();
    await expect(page.getByRole('status').filter({ hasText: 'Perkara dipulihkan dari arsip.' })).toBeVisible();
  });
});
